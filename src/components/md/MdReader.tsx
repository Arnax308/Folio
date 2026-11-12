import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Download, List, PenLine, Search, StickyNote } from 'lucide-react';
import type { Route } from '../../App';
import { getDoc, getMarkdown, getMdState, patchDoc, saveMdState, uid } from '../../lib/db';
import { wordCount, type TocItem } from '../../lib/markdown';
import { CONTEXT, indexText, locate, rangeToOffsets, unwrapAll, wrapOffsets } from '../../lib/mdAnchor';
import { useSettings, useTouchUI } from '../../lib/settings';
import { isInteractive } from '../../lib/gestures';
import { openPalette, useDocTitle, usePaletteProvider, type PaletteItem } from '../../lib/appState';
import type { Annotation, DocMeta, HighlightColor, MdHighlight } from '../../lib/types';
import { createMarkdown } from '../../lib/importer';
import { DisplayMenu } from '../ui/DisplayMenu';
import { download, toast } from '../ui/ui';
import { HighlightPopover, highlightsToMarkdown, NotesPanel, SelectionToolbar } from '../pdf/Annotations';
import { MarkdownView } from './MarkdownView';

const MARK = 'mark.md-hl';
const mdSort = (h: MdHighlight) => h.start;
const mdLabel = (h: MdHighlight) => h.section || 'Introduction';

export default function MdReader({ id, go }: { id: string; go: (r: Route) => void }) {
  const s = useSettings();
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const touch = useTouchUI();
  // On touch the contents and notes are drawers over the text, so start with the text alone.
  const [tocOpen, setTocOpen] = useState(() => window.innerWidth > 1100 && !touch);
  const [notesOpen, setNotesOpen] = useState(false);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [progress, setProgress] = useState(0);
  const [hls, setHls] = useState<MdHighlight[] | null>(null);
  const [detached, setDetached] = useState<Set<string>>(() => new Set());
  const [sel, setSel] = useState<DOMRect | null>(null);
  const [pop, setPop] = useState<{ id: string; x: number; y: number; focus: boolean } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [lastColor, setLastColor] = useState<HighlightColor>('yellow');
  const scroller = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const selRange = useRef<Range | null>(null);

  useEffect(() => {
    (async () => {
      const m = await getDoc(id);
      if (!m) return go({ view: 'library' });
      const [md, st] = await Promise.all([getMarkdown(id), getMdState(id)]);
      setMeta(m);
      setHls(st.highlights);
      setText(md);
      patchDoc(id, { openedAt: Date.now() });
    })();
  }, [id, go]);

  useEffect(() => {
    if (!hls) return;
    const t = setTimeout(() => saveMdState(id, { highlights: hls }), 300);
    return () => clearTimeout(t);
  }, [hls, id]);

  /* ------------------------- Paint highlights ------------------------- */
  const paintState = useRef({ hls, popId: pop?.id, flash });
  paintState.current = { hls, popId: pop?.id, flash };

  const decorate = useCallback((root: HTMLElement) => {
    const { hls, popId, flash } = paintState.current;
    unwrapAll(root, MARK);
    if (!hls?.length) return;
    const lost = new Set<string>();
    for (const h of hls) {
      const idx = indexText(root);
      const pos = locate(idx.text, h);
      if (!pos) {
        lost.add(h.id);
        continue;
      }
      const marks = wrapOffsets(idx, pos.start, pos.end, () => {
        const m = document.createElement('mark');
        m.className = `md-hl mdh-${h.color}${h.id === popId ? ' active' : ''}${h.id === flash ? ' flash' : ''}`;
        m.dataset.hl = h.id;
        return m;
      });
      if (h.note.trim() && marks.length) marks[marks.length - 1].classList.add('has-note');
    }
    setDetached((prev) => (prev.size === lost.size && [...lost].every((x) => prev.has(x)) ? prev : lost));
  }, []);

  useLayoutEffect(() => {
    if (article.current) decorate(article.current);
  }, [hls, pop?.id, flash, decorate]);

  /* ------------------------- Reading position ------------------------- */
  useEffect(() => {
    if (restored.current || text === null || !meta || !scroller.current) return;
    restored.current = true;
    const sc = scroller.current;
    requestAnimationFrame(() => {
      if (meta.progress > 0.01 && meta.progress < 0.99) sc.scrollTop = meta.progress * (sc.scrollHeight - sc.clientHeight);
    });
  }, [text, meta]);

  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => patchDoc(id, { progress }), 500);
    return () => clearTimeout(t);
  }, [progress, id]);

  const onScroll = useCallback(() => {
    const sc = scroller.current;
    if (!sc) return;
    const max = sc.scrollHeight - sc.clientHeight;
    setProgress(max > 0 ? sc.scrollTop / max : 1);
    if (selRange.current) setSel(selRange.current.getBoundingClientRect());
    const heads = article.current?.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id]');
    if (!heads) return;
    let cur = '';
    const line = sc.getBoundingClientRect().top + sc.clientHeight * 0.3;
    heads.forEach((h) => {
      if (h.getBoundingClientRect().top <= line) cur = h.id;
    });
    setActiveId(cur || heads[0]?.id || '');
  }, []);

  /* ----------------------------- Selection ---------------------------- */
  const clearSel = useCallback(() => {
    selRange.current = null;
    setSel(null);
  }, []);

  const checkSelection = useCallback(() => {
    const s = window.getSelection();
    const root = article.current;
    if (!s || s.isCollapsed || !s.rangeCount || !root) return clearSel();
    const r = s.getRangeAt(0);
    if (!root.contains(r.commonAncestorContainer) || !s.toString().trim()) return clearSel();
    selRange.current = r;
    setSel(r.getBoundingClientRect());
  }, [clearSel]);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const onChange = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) return clearSel();
      // Touch: a long-press selection (and dragging its handles) only shows up here.
      if (touch) {
        clearTimeout(t);
        t = setTimeout(checkSelection, 280);
      }
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      clearTimeout(t);
      document.removeEventListener('selectionchange', onChange);
    };
  }, [clearSel, checkSelection, touch]);

  // Opening a drawer brings the toolbar back.
  useEffect(() => {
    if (tocOpen || notesOpen) setChromeHidden(false);
  }, [tocOpen, notesOpen]);

  const createHighlight = useCallback(
    (color: HighlightColor, withNote = false) => {
      const root = article.current;
      const range = selRange.current;
      if (!root || !range) return;
      // measure on an undecorated copy of the text index (marks don't change text content)
      const idx = indexText(root);
      const pos = rangeToOffsets(root, range, idx);
      if (!pos) return;
      let section = '';
      root.querySelectorAll<HTMLElement>('h1, h2, h3').forEach((h) => {
        const hr = document.createRange();
        hr.selectNodeContents(h);
        const o = rangeToOffsets(root, hr, idx);
        if (o && o.start <= pos.start) section = h.textContent?.trim() ?? '';
      });
      const hl: MdHighlight = {
        id: uid(),
        color,
        text: idx.text.slice(pos.start, pos.end),
        prefix: idx.text.slice(Math.max(0, pos.start - CONTEXT), pos.start),
        suffix: idx.text.slice(pos.end, pos.end + CONTEXT),
        start: pos.start,
        section,
        note: '',
        createdAt: Date.now(),
      };
      const b = range.getBoundingClientRect();
      window.getSelection()?.removeAllRanges();
      clearSel();
      setLastColor(color);
      setHls((list) => [...(list ?? []), hl]);
      if (withNote) setPop({ id: hl.id, x: b.left + b.width / 2, y: b.bottom, focus: true });
    },
    [clearSel],
  );

  const updateHl = useCallback((hid: string, patch: Partial<Annotation>) => {
    setHls((list) => list?.map((h) => (h.id === hid ? { ...h, ...patch } : h)) ?? list);
  }, []);
  const deleteHl = useCallback((hid: string) => {
    setHls((list) => list?.filter((h) => h.id !== hid) ?? list);
    setPop((p) => (p?.id === hid ? null : p));
  }, []);

  const onArticleClick = (e: React.MouseEvent) => {
    const s = window.getSelection();
    if (s && !s.isCollapsed) return;
    const m = (e.target as HTMLElement).closest<HTMLElement>(MARK);
    if (m?.dataset.hl) return setPop({ id: m.dataset.hl, x: e.clientX, y: e.clientY, focus: false });
    // Touch: tapping the text hides / shows the toolbar.
    if (touch && !isInteractive(e.target) && !(e.target as HTMLElement).closest('.code-block, .table-wrap')) setChromeHidden((h) => !h);
  };

  const jumpTo = useCallback((h: MdHighlight) => {
    if (touch) setNotesOpen(false);
    const m = article.current?.querySelector<HTMLElement>(`${MARK}[data-hl="${h.id}"]`);
    if (!m) return toast('That passage has changed since you highlighted it');
    m.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(h.id);
    setTimeout(() => setFlash((f) => (f === h.id ? null : f)), 1800);
  }, [touch]);

  /* ----------------------------- Keyboard ----------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'e') go({ view: 'edit', id });
      if (e.key === 't') setTocOpen((o) => !o);
      if (e.key === 'n') setNotesOpen((o) => !o);
      if (e.key === 'h' && selRange.current) createHighlight(lastColor);
      if (e.key === 'Escape' && !pop && !sel) go({ view: 'library' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, id, createHighlight, lastColor, pop, sel]);

  useDocTitle(meta?.name);
  const paletteProvider = useCallback(
    (): PaletteItem[] => [
      ...toc.map((t) => ({
        id: 'md-h-' + t.id,
        title: t.text,
        group: 'Headings',
        hint: 'H' + t.level,
        run: () => article.current?.querySelector(`[id="${CSS.escape(t.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      })),
      { id: 'md-edit', title: 'Edit this document', hint: 'E', group: 'This document', run: () => go({ view: 'edit', id }) },
      { id: 'md-notes', title: 'Show or hide notes', hint: 'N', group: 'This document', keywords: 'highlights panel', run: () => setNotesOpen((o) => !o) },
    ],
    [toc, go, id],
  );
  usePaletteProvider('md', paletteProvider);

  const exportMd = () => meta && hls && highlightsToMarkdown(meta.name, hls, mdSort, mdLabel);

  const words = text ? wordCount(text) : 0;
  const minutes = Math.max(1, Math.round(words / 230));
  const minLevel = Math.min(...toc.map((t) => t.level), 3);
  const popHl = pop && hls?.find((h) => h.id === pop.id);

  return (
    <div className={'reader md-reader' + (chromeHidden ? ' chrome-hidden' : '')}>
      <header className="reader-bar">
        <div className="bar-left">
          <button className="icon-btn" data-tip="Library" aria-label="Back to library" onClick={() => go({ view: 'library' })}>
            <ArrowLeft size={18} />
          </button>
          <button className={'icon-btn' + (tocOpen ? ' active' : '')} data-tip="Contents  T" aria-label="Toggle contents" onClick={() => setTocOpen((o) => !o)}>
            <List size={17} />
          </button>
          <div className="doc-title">{meta?.name}</div>
        </div>
        <div className="bar-center">
          <span className="read-time">{minutes} min read</span>
        </div>
        <div className="bar-right">
          {touch && (
            <button className="icon-btn" aria-label="Search and go to" onClick={openPalette}>
              <Search size={17} />
            </button>
          )}
          <button className="icon-btn" data-tip="Download .md" aria-label="Download" onClick={() => meta && text !== null && download(meta.name + '.md', text)}>
            <Download size={17} />
          </button>
          <DisplayMenu mode="md" />
          <button className={'icon-btn' + (notesOpen ? ' active' : '')} data-tip="Notes  N" aria-label="Toggle notes" onClick={() => setNotesOpen((o) => !o)}>
            <StickyNote size={17} />
            {!!hls?.length && <span className="btn-badge">{hls.length}</span>}
          </button>
          <button className="btn btn-quiet edit-btn" onClick={() => go({ view: 'edit', id })}>
            <PenLine size={15} /> Edit
          </button>
        </div>
        <div className="progress-line">
          <div style={{ transform: `scaleX(${progress})` }} />
        </div>
      </header>

      <div className="reader-body">
        {tocOpen && (
          <aside className="side-panel left toc-panel">
            <div className="toc-label">Contents</div>
            <nav className="toc">
              {toc.length === 0 && <div className="panel-empty">No headings</div>}
              {toc.map((t) => (
                <a
                  key={t.id}
                  href={'#' + t.id}
                  className={'toc-item l' + (t.level - minLevel) + (activeId === t.id ? ' on' : '')}
                  onClick={(e) => {
                    e.preventDefault();
                    if (touch) setTocOpen(false);
                    article.current?.querySelector(`[id="${CSS.escape(t.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  {t.text}
                </a>
              ))}
            </nav>
          </aside>
        )}
        <div
          className="scroller md-scroller"
          ref={scroller}
          onScroll={onScroll}
          onPointerUp={() => setTimeout(checkSelection, 0)}
          onKeyUp={(e) => e.shiftKey && checkSelection()}
        >
          {text !== null && hls && (
            <div className="md-page fade-in" style={{ '--measure': s.mdWidth + 'ch' } as React.CSSProperties} onClick={onArticleClick}>
              <div className="md-meta">
                <span className="kind-pill">Markdown</span>
                <span>{words.toLocaleString()} words</span>
                <span className="dot" />
                <span>{minutes} min</span>
              </div>
              <MarkdownView
                ref={article}
                source={text}
                onToc={setToc}
                decorate={decorate}
                className={s.mdFont === 'serif' ? 'serif' : 'sans'}
                style={{ fontSize: s.mdSize }}
              />
            </div>
          )}
        </div>
        {touch && (tocOpen || notesOpen) && (
          <div
            className="drawer-scrim"
            onClick={() => {
              setTocOpen(false);
              setNotesOpen(false);
            }}
          />
        )}
        {notesOpen && hls && (
          <NotesPanel
            highlights={hls}
            activeId={pop?.id ?? flash}
            sortKey={mdSort}
            label={mdLabel}
            isDetached={(h) => detached.has(h.id)}
            emptyHint="Select any passage and pick a colour. Add notes to remember why it mattered."
            onJump={jumpTo}
            onChange={updateHl}
            onDelete={deleteHl}
            onExport={() => meta && download(`${meta.name} — notes.md`, exportMd() || '')}
            onExportNote={async () => {
              if (!meta) return;
              await createMarkdown(`Notes — ${meta.name}`, exportMd() || '');
              toast('Saved to your library as Markdown');
            }}
          />
        )}
      </div>

      {sel && (
        <SelectionToolbar
          below={touch}
          rect={sel}
          lastColor={lastColor}
          onColor={(c) => createHighlight(c)}
          onNote={() => createHighlight(lastColor, true)}
          onCopy={() => {
            navigator.clipboard.writeText(window.getSelection()?.toString() ?? '');
            toast('Copied');
          }}
        />
      )}

      {pop && popHl && (
        <HighlightPopover
          key={pop.id}
          hl={popHl}
          label={mdLabel(popHl)}
          x={pop.x}
          y={pop.y}
          autoFocus={pop.focus}
          onChange={(p) => updateHl(pop.id, p)}
          onDelete={() => deleteHl(pop.id)}
          onClose={() => setPop(null)}
        />
      )}
    </div>
  );
}
