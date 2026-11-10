import { memo, useEffect, useRef, useState } from 'react';
import { Bookmark, ChevronRight, LayoutGrid, List, RotateCcw, RotateCw, Search, X } from 'lucide-react';
import type { PDFDoc } from '../../lib/pdf';
import { getPage, type PageSize } from './PageView';

export type SideTab = 'pages' | 'outline' | 'search';

interface Props {
  doc: PDFDoc;
  sizes: PageSize[];
  tab: SideTab;
  setTab: (t: SideTab) => void;
  current: number;
  rotationOf: (n: number) => number;
  rotatePage: (n: number, delta: number) => void;
  hlCount: Record<number, number>;
  bookmarks: number[];
  toggleBookmark: (n: number) => void;
  goTo: (n: number, y?: number) => void;
  query: string;
  setQuery: (q: string) => void;
  searchFocus: number;
}

export function Sidebar(p: Props) {
  return (
    <aside className="side-panel left">
      <div className="panel-tabs">
        <div className="segmented full">
          <button className={p.tab === 'pages' ? 'on' : ''} onClick={() => p.setTab('pages')}>
            <LayoutGrid size={14} /> Pages
          </button>
          <button className={p.tab === 'outline' ? 'on' : ''} onClick={() => p.setTab('outline')}>
            <List size={14} /> Outline
          </button>
          <button className={p.tab === 'search' ? 'on' : ''} onClick={() => p.setTab('search')}>
            <Search size={14} /> Search
          </button>
        </div>
      </div>
      <div className="panel-body">
        {p.tab === 'pages' && <Thumbs {...p} />}
        {p.tab === 'outline' && <Outline doc={p.doc} goTo={p.goTo} />}
        {p.tab === 'search' && <SearchPanel doc={p.doc} goTo={p.goTo} query={p.query} setQuery={p.setQuery} focus={p.searchFocus} />}
      </div>
    </aside>
  );
}

/* ----------------------------- Thumbnails ----------------------------- */
function Thumbs({ doc, sizes, current, rotationOf, rotatePage, hlCount, goTo, bookmarks, toggleBookmark }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-thumb="${current}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [current]);
  return (
    <div className="thumbs" ref={listRef}>
      {bookmarks.length > 0 && (
        <div className="bm-strip">
          <div className="bm-label">
            <Bookmark size={12} /> Bookmarks
          </div>
          <div className="bm-chips">
            {[...bookmarks].sort((a, b) => a - b).map((n) => (
              <button key={n} className={'bm-chip' + (n === current ? ' on' : '')} onClick={() => goTo(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
      {sizes.map((s, i) => (
        <Thumb
          key={i}
          doc={doc}
          n={i + 1}
          size={s}
          rotation={rotationOf(i + 1)}
          active={current === i + 1}
          count={hlCount[i + 1] || 0}
          bookmarked={bookmarks.includes(i + 1)}
          onBookmark={() => toggleBookmark(i + 1)}
          onClick={() => goTo(i + 1)}
          onRotate={(d) => rotatePage(i + 1, d)}
        />
      ))}
    </div>
  );
}

const THUMB_W = 132;
const Thumb = memo(function Thumb({
  doc, n, size, rotation, active, count, bookmarked, onClick, onRotate, onBookmark,
}: {
  doc: PDFDoc; n: number; size: PageSize; rotation: number; active: boolean; count: number; bookmarked: boolean;
  onClick: () => void; onRotate: (d: number) => void; onBookmark: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const rotated = rotation % 180 !== 0;
  const aspect = rotated ? size.w / size.h : size.h / size.w;

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '300px 0px' });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || src) return;
    let cancelled = false;
    (async () => {
      const page = await getPage(doc, n);
      const scale = (THUMB_W * 2) / size.w;
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      try {
        await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
      } catch {
        return;
      }
      if (!cancelled) setSrc(c.toDataURL('image/jpeg', 0.8));
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, src, doc, n, size.w]);

  return (
    <div className={'thumb' + (active ? ' active' : '')} data-thumb={n} ref={ref}>
      <button className="thumb-img" onClick={onClick} style={{ aspectRatio: `1 / ${aspect}` }} aria-label={`Page ${n}`}>
        {src ? (
          <img
            src={src}
            alt=""
            style={
              rotated
                ? { width: `${100 * aspect}%`, height: `${100 / aspect}%`, transform: `translate(-50%, -50%) rotate(${rotation}deg)`, position: 'absolute', left: '50%', top: '50%' }
                : { transform: `rotate(${rotation}deg)` }
            }
          />
        ) : (
          <div className="thumb-skel shimmer" />
        )}
        {count > 0 && <span className="thumb-badge">{count}</span>}
      </button>
      <button
        className={'thumb-bm' + (bookmarked ? ' on' : '')}
        aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this page'}
        aria-pressed={bookmarked}
        onClick={onBookmark}
      >
        <Bookmark size={13} fill={bookmarked ? 'currentColor' : 'none'} />
      </button>
      <div className="thumb-foot">
        <button className="icon-btn sm" aria-label="Rotate page left" data-tip="Rotate left" onClick={() => onRotate(-90)}>
          <RotateCcw size={13} />
        </button>
        <span className="thumb-num">{n}</span>
        <button className="icon-btn sm" aria-label="Rotate page right" data-tip="Rotate right" onClick={() => onRotate(90)}>
          <RotateCw size={13} />
        </button>
      </div>
    </div>
  );
});

/* ------------------------------- Outline ------------------------------ */
interface OItem { title: string; page: number | null; items: OItem[] }

async function resolveOutline(doc: PDFDoc, items: Awaited<ReturnType<PDFDoc['getOutline']>>): Promise<OItem[]> {
  if (!items) return [];
  return Promise.all(
    items.map(async (it) => {
      let page: number | null = null;
      try {
        const dest = typeof it.dest === 'string' ? await doc.getDestination(it.dest) : it.dest;
        if (dest && dest[0]) {
          const ref = dest[0];
          page = typeof ref === 'number' ? ref + 1 : (await doc.getPageIndex(ref)) + 1;
        }
      } catch {
        /* ignore */
      }
      return { title: it.title, page, items: await resolveOutline(doc, it.items) };
    }),
  );
}

function Outline({ doc, goTo }: { doc: PDFDoc; goTo: (n: number) => void }) {
  const [items, setItems] = useState<OItem[] | null>(null);
  useEffect(() => {
    doc.getOutline().then((o) => resolveOutline(doc, o)).then(setItems);
  }, [doc]);
  if (!items) return <div className="panel-empty">Loading…</div>;
  if (!items.length)
    return (
      <div className="panel-empty">
        <List size={22} />
        <div>This document has no outline.</div>
      </div>
    );
  return (
    <div className="outline">
      {items.map((it, i) => (
        <OutlineNode key={i} item={it} depth={0} goTo={goTo} />
      ))}
    </div>
  );
}

function OutlineNode({ item, depth, goTo }: { item: OItem; depth: number; goTo: (n: number) => void }) {
  const [open, setOpen] = useState(depth < 1);
  const has = item.items.length > 0;
  return (
    <div>
      <div className="outline-row" style={{ paddingLeft: 6 + depth * 14 }}>
        <button className={'outline-chev' + (open ? ' open' : '')} style={{ visibility: has ? 'visible' : 'hidden' }} onClick={() => setOpen((o) => !o)} aria-label="Toggle">
          <ChevronRight size={13} />
        </button>
        <button className={'outline-title' + (depth === 0 ? ' top' : '')} onClick={() => item.page && goTo(item.page)}>
          <span>{item.title}</span>
          {item.page && <span className="outline-page">{item.page}</span>}
        </button>
      </div>
      {has && open && item.items.map((c, i) => <OutlineNode key={i} item={c} depth={depth + 1} goTo={goTo} />)}
    </div>
  );
}

/* ------------------------------- Search ------------------------------- */
interface Hit { page: number; before: string; match: string; after: string }
const textCache = new WeakMap<PDFDoc, Map<number, string>>();

async function pageText(doc: PDFDoc, n: number) {
  let m = textCache.get(doc);
  if (!m) textCache.set(doc, (m = new Map()));
  let t = m.get(n);
  if (t === undefined) {
    const page = await getPage(doc, n);
    const tc = await page.getTextContent();
    t = tc.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? ' ' : '') : '')).join('').replace(/\s+/g, ' ');
    m.set(n, t);
  }
  return t;
}

function SearchPanel({ doc, goTo, query, setQuery, focus }: { doc: PDFDoc; goTo: (n: number) => void; query: string; setQuery: (q: string) => void; focus: number }) {
  const [input, setInput] = useState(query);
  const [hits, setHits] = useState<Hit[]>([]);
  const [progress, setProgress] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focus]);

  useEffect(() => {
    const q = input.trim();
    const t = setTimeout(() => setQuery(q.length >= 2 ? q : ''), 250);
    return () => clearTimeout(t);
  }, [input, setQuery]);

  useEffect(() => {
    let stale = false;
    setHits([]);
    if (!query) return;
    (async () => {
      const needle = query.toLowerCase();
      const out: Hit[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const text = await pageText(doc, n);
        if (stale) return;
        const lower = text.toLowerCase();
        let i = lower.indexOf(needle);
        let perPage = 0;
        while (i >= 0 && perPage < 20) {
          out.push({
            page: n,
            before: (i > 40 ? '…' : '') + text.slice(Math.max(0, i - 40), i),
            match: text.slice(i, i + needle.length),
            after: text.slice(i + needle.length, i + needle.length + 60),
          });
          perPage++;
          i = lower.indexOf(needle, i + needle.length);
        }
        if (n % 10 === 0 || n === doc.numPages) {
          setHits([...out]);
          setProgress(n / doc.numPages);
        }
      }
    })();
    return () => {
      stale = true;
    };
  }, [query, doc]);

  return (
    <div className="search-panel">
      <label className="search-field panel-search">
        <Search size={14} />
        <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search in document" />
        {input && (
          <button className="icon-btn sm" onClick={() => setInput('')} aria-label="Clear">
            <X size={13} />
          </button>
        )}
      </label>
      {query && (
        <div className="search-meta">
          {progress < 1 ? 'Searching…' : `${hits.length}${hits.length >= 20 * doc.numPages ? '+' : ''} result${hits.length === 1 ? '' : 's'}`}
        </div>
      )}
      <div className="search-results">
        {hits.map((h, i) => (
          <button key={i} className="search-hit-row" onClick={() => goTo(h.page)}>
            <span className="search-page">p. {h.page}</span>
            <span className="search-snippet">
              {h.before}
              <mark>{h.match}</mark>
              {h.after}
            </span>
          </button>
        ))}
        {query && progress >= 1 && !hits.length && <div className="panel-empty">No matches for “{query}”.</div>}
      </div>
    </div>
  );
}
