import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NOTE_REF, NotePopup, noteFor, type NotePeek } from './NotePopup';
import { fillCachedMermaid, renderMarkdown, renderMermaidIn, type TocItem } from '../../lib/markdown';
import { useSettings } from '../../lib/settings';
import { isTauri, openExternal } from '../../lib/desktop';
import { listDocs } from '../../lib/db';
import { toast } from '../ui/ui';
import { openPdfAt } from '../../lib/appState';

interface Props {
  source: string;
  className?: string;
  style?: React.CSSProperties;
  onToc?: (toc: TocItem[]) => void;
  /** Called synchronously after the HTML is (re)written, e.g. to paint highlights. */
  decorate?: (root: HTMLElement) => void;
  /** Called just before following a link inside the document (so the reader can offer a way back). */
  onJump?: () => void;
  /** A checkbox was ticked or unticked; `line` is where its list item (or table row) starts in `source`, 0-based; `col` is the table column. */
  onToggleTask?: (line: number, checked: boolean, col?: number) => void;
}

export const MarkdownView = forwardRef<HTMLDivElement | null, Props>(function MarkdownView({ source, className, style, onToc, decorate, onJump, onToggleTask }, fwd) {
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(fwd, () => ref.current!, []);
  const decorateRef = useRef(decorate);
  decorateRef.current = decorate;
  const { theme } = useSettings();
  const { html, toc } = useMemo(() => renderMarkdown(source), [source]);

  useLayoutEffect(() => {
    onToc?.(toc);
  }, [toc, onToc]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    fillCachedMermaid(el);
    markMissingImages(el);
    decorateRef.current?.(el);
    let stale = false;
    renderMermaidIn(el, () => stale);
    return () => {
      stale = true;
    };
  }, [html, theme]);

  // note popups: hover a note marker (mouse) for a moment, or click / tap it to pin the card
  const [peek, setPeek] = useState<NotePeek | null>(null);
  const hoverTimer = useRef(0);
  const overCard = useRef(false);
  const closePeek = useCallback(() => setPeek(null), []);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  useEffect(() => setPeek(null), [html]);

  const showNote = (a: HTMLAnchorElement, pinned: boolean) => {
    const n = ref.current && noteFor(ref.current, a);
    if (n) setPeek({ ...n, anchor: a.getBoundingClientRect(), pinned });
    return !!n;
  };
  const jumpTo = (id: string) => {
    const target = ref.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
    if (!target) return;
    onJump?.();
    setPeek(null);
    target.scrollIntoView({ behavior: 'smooth', block: target.classList.contains('note-num') || target.closest('sup') ? 'center' : 'start' });
    const flash = target.closest('p, li, h1, h2, h3, h4') ?? target;
    flash.classList.remove('jump-flash');
    void (flash as HTMLElement).offsetWidth;
    flash.classList.add('jump-flash');
  };
  const onOver = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>(NOTE_REF);
    if (!a || peek?.pinned) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => showNote(a, false), 260);
  };
  const onOut = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest(NOTE_REF)) return;
    clearTimeout(hoverTimer.current);
    setTimeout(() => !overCard.current && setPeek((p) => (p && !p.pinned ? null : p)), 120);
  };

  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    // task lists: the click on the box itself (a click on its label is passed on to the box)
    if (t instanceof HTMLInputElement && t.classList.contains('task-list-item-checkbox')) {
      const table = t.dataset.col !== undefined;
      const line = Number(table ? t.dataset.line : t.closest<HTMLElement>('li[data-line]')?.dataset.line);
      if (!onToggleTask || !Number.isFinite(line)) e.preventDefault();
      else onToggleTask(line, t.checked, table ? Number(t.dataset.col) : undefined);
      return;
    }
    const noteRef = t.closest<HTMLAnchorElement>(NOTE_REF);
    if (noteRef) {
      e.preventDefault();
      clearTimeout(hoverTimer.current);
      if (!showNote(noteRef, true)) jumpTo(decodeURIComponent(noteRef.hash.slice(1)));
      return;
    }
    const copy = t.closest<HTMLButtonElement>('.code-copy');
    if (copy) {
      const code = copy.parentElement?.querySelector('code')?.textContent ?? '';
      navigator.clipboard.writeText(code);
      copy.textContent = 'Copied';
      copy.classList.add('done');
      setTimeout(() => {
        copy.textContent = 'Copy';
        copy.classList.remove('done');
      }, 1400);
      return;
    }
    const link = t.closest<HTMLAnchorElement>('a[href]');
    const href = link?.getAttribute('href') ?? '';
    if (link && /^(https?:|mailto:|tel:)/i.test(href)) {
      // web links open in the browser (in the app a link would otherwise replace Folio itself)
      if (isTauri) {
        e.preventDefault();
        openExternal(link.href);
      }
      return;
    }
    if (link && href && !href.startsWith('#')) {
      // a link to another file, e.g. [next](chapter-2.md): open it from the library if it's there
      e.preventDefault();
      openLibraryLink(href);
      return;
    }
    const a = t.closest<HTMLAnchorElement>('a[href^="#"]');
    if (a) {
      e.preventDefault();
      jumpTo(decodeURIComponent(a.hash.slice(1)));
    }
  };

  return (
    <>
      <div ref={ref} className={'prose ' + (className ?? '')} style={style} onClick={onClick} onMouseOver={onOver} onMouseOut={onOut} />
      {peek && (
        <NotePopup
          peek={peek}
          onGo={jumpTo}
          onClose={closePeek}
          onHoverChange={(inside) => {
            overCard.current = inside;
            if (!inside) setPeek((p) => (p && !p.pinned ? null : p));
          }}
        />
      )}
    </>
  );
});

/** Opens the library document a relative link names ("notes/chapter 2.md" → "chapter 2"). */
async function openLibraryLink(href: string) {
  let file = href.split(/[?#]/)[0];
  try {
    file = decodeURIComponent(file);
  } catch {
    /* keep it as written */
  }
  file = file.split(/[\\/]/).pop() ?? file;
  const stem = file.replace(/\.(md|markdown|mdown|mkd|txt|pdf)$/i, '').trim().toLowerCase();
  const kind = /\.pdf$/i.test(file) ? 'pdf' : /\.(md|markdown|mdown|mkd|txt)$/i.test(file) ? 'md' : null;
  const docs = await listDocs();
  const doc = docs.find((d) => d.name.trim().toLowerCase() === stem && (!kind || d.kind === kind)) ?? docs.find((d) => d.name.trim().toLowerCase() === stem);
  const page = Number(/[#&]page=(\d+)/i.exec(href)?.[1]);
  if (doc && doc.kind === 'pdf' && page > 0) openPdfAt(doc.id, page);
  else if (doc) location.hash = `/${doc.kind}/${doc.id}`;
  else toast(`“${file}” isn’t in your library`);
}

/** Pictures that point at files Folio doesn't have (e.g. ./images/fig.png) become a quiet label. */
function markMissingImages(root: HTMLElement) {
  root.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    if (/^(data:|blob:|https?:)/i.test(src)) return;
    const label = document.createElement('span');
    label.className = 'img-missing';
    label.textContent = img.alt || src.split(/[\\/]/).pop() || 'picture';
    label.title = `Picture not included in this document: ${src}`;
    img.replaceWith(label);
  });
}
