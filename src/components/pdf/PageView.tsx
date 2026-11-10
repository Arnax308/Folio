import { memo, useEffect, useRef, useState } from 'react';
import { pdfjs, rotationTransform, type PDFDoc } from '../../lib/pdf';
import type { Highlight } from '../../lib/types';

export interface PageSize { w: number; h: number }

interface Props {
  doc: PDFDoc;
  num: number;
  size: PageSize;
  scale: number;
  rotation: number;
  visible: boolean;
  highlights: Highlight[];
  activeId: string | null;
  flashId: string | null;
  search: string;
  bookmarked?: boolean;
}

const pageCache = new WeakMap<PDFDoc, Map<number, Promise<pdfjs.PDFPageProxy>>>();
export function getPage(doc: PDFDoc, n: number) {
  let m = pageCache.get(doc);
  if (!m) pageCache.set(doc, (m = new Map()));
  let p = m.get(n);
  if (!p) m.set(n, (p = doc.getPage(n)));
  return p;
}

/**
 * Marks every occurrence of `q` in the text layer. Matches may run across several spans and
 * across line breaks (pdf.js puts a <br> after each line), so the page text is searched as one string.
 */
function markSearch(layer: HTMLElement, q: string) {
  layer.querySelectorAll('mark.search-hit').forEach((m) => {
    const p = m.parentNode!;
    p.replaceChild(document.createTextNode(m.textContent || ''), m);
    p.normalize();
  });
  const needle = q.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!needle) return;

  const nodes: Text[] = [];
  const starts: number[] = [];
  let hay = '';
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const data = (n as Text).data;
      nodes.push(n as Text);
      starts.push(hay.length);
      // one haystack character per source character, so offsets map straight back to the node
      for (const ch of data) hay += ch.length === 1 ? ((ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch).replace(/\s/, ' ')) : ch;
    } else if ((n as Element).tagName === 'BR' && hay && !hay.endsWith(' ')) {
      hay += ' '; // a line break reads as a space
    }
  }

  const hits: [number, number][] = [];
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) hits.push([i, i + needle.length]);

  // Wrap from the end so earlier offsets stay valid while text nodes are split.
  for (let h = hits.length - 1; h >= 0; h--) {
    const [from, to] = hits[h];
    for (let k = nodes.length - 1; k >= 0; k--) {
      const base = starts[k];
      const len = nodes[k].data.length;
      if (base >= to || base + len <= from) continue;
      const s = Math.max(0, from - base);
      const e = Math.min(len, to - base);
      let target = nodes[k];
      if (e < target.length) target.splitText(e);
      if (s > 0) target = target.splitText(s);
      const m = document.createElement('mark');
      m.className = 'search-hit';
      target.parentNode!.insertBefore(m, target);
      m.appendChild(target);
    }
  }
}

function PageViewImpl({ doc, num, size, scale, rotation, visible, highlights, activeId, flashId, search, bookmarked }: Props) {
  const canvasWrap = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(0);
  const [rendered, setRendered] = useState(false);
  const [textReady, setTextReady] = useState(0);

  const w = size.w * scale;
  const h = size.h * scale;
  const rotated = rotation % 180 !== 0;

  // Render canvas + text layer when visible
  useEffect(() => {
    if (!visible) return;
    if (renderedRef.current === scale) return;
    const first = !renderedRef.current;
    let cancelled = false;
    let task: pdfjs.RenderTask | null = null;
    let textLayer: pdfjs.TextLayer | null = null;
    const t = setTimeout(async () => {
      const page = await getPage(doc, num);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const vp = page.getViewport({ scale: scale * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      const ctx = canvas.getContext('2d', { alpha: false })!;
      task = page.render({ canvasContext: ctx, viewport: vp });
      try {
        await task.promise;
      } catch {
        return;
      }
      if (cancelled) return;
      canvasWrap.current?.replaceChildren(canvas);
      renderedRef.current = scale;
      setRendered(true);

      const tl = textRef.current;
      if (tl) {
        tl.replaceChildren();
        textLayer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent({ includeMarkedContent: true, disableNormalization: true }),
          container: tl,
          viewport: page.getViewport({ scale }),
        });
        try {
          await textLayer.render();
          const end = document.createElement('div');
          end.className = 'endOfContent';
          tl.append(end);
          if (!cancelled) setTextReady((n) => n + 1);
        } catch {
          /* cancelled */
        }
      }
    }, first ? 0 : 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
      task?.cancel();
      textLayer?.cancel();
    };
  }, [visible, scale, doc, num]);

  // Free memory for far-away pages
  useEffect(() => {
    if (visible || !rendered) return;
    const t = setTimeout(() => {
      canvasWrap.current?.replaceChildren();
      textRef.current?.replaceChildren();
      renderedRef.current = 0;
      setRendered(false);
    }, 1500);
    return () => clearTimeout(t);
  }, [visible, rendered]);

  useEffect(() => {
    if (textRef.current && textReady) markSearch(textRef.current, search);
  }, [search, textReady]);

  return (
    <div
      className="page"
      data-page={num}
      style={{ width: rotated ? h : w, height: rotated ? w : h }}
    >
      <div
        className="page-surface"
        style={{
          width: w,
          height: h,
          transform: rotationTransform(rotation, w, h),
          ['--scale-factor' as string]: scale,
        }}
      >
        <div className="canvas-wrap" ref={canvasWrap} />
        <div className="hl-layer">
          {highlights.map((hl) =>
            hl.rects.map((r, i) => (
              <div
                key={hl.id + i}
                className={`hl hl-${hl.color}${hl.id === activeId ? ' active' : ''}${hl.id === flashId ? ' flash' : ''}`}
                style={{ left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' }}
              />
            )),
          )}
          {highlights
            .filter((hl) => hl.note.trim())
            .map((hl) => {
              const r = hl.rects[hl.rects.length - 1];
              if (!r) return null;
              return (
                <span
                  key={hl.id + 'n'}
                  className={`hl-note-dot hl-${hl.color}`}
                  style={{ left: `calc(${(r.x + r.w) * 100}% + 3px)`, top: r.y * 100 + '%' }}
                />
              );
            })}
        </div>
        <div className="textLayer" ref={textRef} />
      </div>
      {!rendered && <div className="page-skeleton" />}
      {bookmarked && <span className="page-ribbon" aria-label="Bookmarked" />}
    </div>
  );
}

export const PageView = memo(PageViewImpl);
