import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Bookmark, BookOpen, Check, ChevronLeft, ChevronRight, PanelLeft, RotateCcw, RotateCw, StickyNote, ZoomIn, ZoomOut, Maximize2, ScanLine,
} from 'lucide-react';
import type { Route } from '../../App';
import { getDoc, getPdfBlob, getPdfState, patchDoc, savePdfState, uid } from '../../lib/db';
import { clientRectToNorm, loadPdf, mergeRects, pointToNorm, type PDFDoc } from '../../lib/pdf';
import { updateSettings, useSettings } from '../../lib/settings';
import { useDocTitle, usePaletteProvider, type PaletteItem } from '../../lib/appState';
import { SpreadView, type SpreadHandle } from './SpreadView';
import type { DocMeta, Highlight, HighlightColor, NRect, PdfState } from '../../lib/types';
import { createMarkdown } from '../../lib/importer';
import { DisplayMenu } from '../ui/DisplayMenu';
import { download, PopoverButton, toast } from '../ui/ui';
import { PageView, type PageSize } from './PageView';
import { Sidebar, type SideTab } from './Sidebar';
import { HighlightPopover, highlightsToMarkdown, NotesPanel, SelectionToolbar } from './Annotations';

type Zoom = number | 'fit-width' | 'fit-page';
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const PAD_TOP = 72;
const GAP = 20;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const norm360 = (r: number) => ((r % 360) + 360) % 360;

export default function PdfReader({ id, go }: { id: string; go: (r: Route) => void }) {
  const settings = useSettings();
  const [meta, setMeta] = useState<DocMeta | null>(null);
  const [doc, setDoc] = useState<PDFDoc | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [state, setState] = useState<PdfState | null>(null);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState<Zoom>('fit-width');
  const [spreadZoom, setSpreadZoom] = useState(1); // multiplier on "fit spread"; 1 = whole spread visible
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [visible, setVisible] = useState<Set<number>>(() => new Set([1, 2]));
  const [current, setCurrent] = useState(1);
  const [progress, setProgress] = useState(0);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 1180);
  const [rightOpen, setRightOpen] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>('pages');
  const [query, setQuery] = useState('');
  const [searchFocus, setSearchFocus] = useState(0);
  const [sel, setSel] = useState<DOMRect | null>(null);
  const [pop, setPop] = useState<{ id: string; x: number; y: number; focus: boolean } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [lastColor, setLastColor] = useState<HighlightColor>('yellow');

  const scroller = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ page: number; fy: number; fx: number } | null>(null);
  const restored = useRef(false);

  /* ------------------------------ Loading ------------------------------ */
  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDoc | null = null;
    (async () => {
      try {
        const m = await getDoc(id);
        if (!m) throw new Error('This document is no longer in your library.');
        const blob = await getPdfBlob(id);
        if (!blob) throw new Error('The file data is missing.');
        const pdf = await loadPdf(new Uint8Array(await blob.arrayBuffer()));
        loaded = pdf;
        if (cancelled) return pdf.destroy();
        const st = await getPdfState(id);
        // Show the document straight away: assume every page is the size of the first one,
        // then measure the rest in the background and correct any that differ.
        const vp1 = (await pdf.getPage(1)).getViewport({ scale: 1 });
        if (cancelled) return;
        let sz: PageSize[] = Array.from({ length: pdf.numPages }, () => ({ w: vp1.width, h: vp1.height }));
        setMeta(m);
        setState(st);
        if (st.zoom) setZoom(st.zoom);
        setSizes(sz);
        setDoc(pdf);
        patchDoc(id, { openedAt: Date.now(), pageCount: pdf.numPages });

        const BATCH = 24;
        for (let i = 2; i <= pdf.numPages; i += BATCH) {
          const batch = await Promise.all(
            Array.from({ length: Math.min(BATCH, pdf.numPages - i + 1) }, (_, k) => pdf.getPage(i + k)),
          );
          if (cancelled) return;
          let changed = false;
          batch.forEach((pg, k) => {
            const vp = pg.getViewport({ scale: 1 });
            const cur = sz[i + k - 1];
            if (Math.abs(vp.width - cur.w) > 0.5 || Math.abs(vp.height - cur.h) > 0.5) {
              if (!changed) sz = sz.slice();
              changed = true;
              sz[i + k - 1] = { w: vp.width, h: vp.height };
            }
          });
          if (changed) {
            captureAnchor();
            setSizes(sz);
          }
          await new Promise((r) => setTimeout(r, 0));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      loaded?.destroy();
    };
  }, [id]);

  /* --------------------------- Persist state --------------------------- */
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => savePdfState(id, { ...state, zoom }), 300);
    return () => clearTimeout(t);
  }, [state, zoom, id]);

  useEffect(() => {
    if (!doc || !restored.current) return;
    const t = setTimeout(() => patchDoc(id, { progress, lastPage: current }), 600);
    return () => clearTimeout(t);
  }, [progress, current, id, doc]);

  /* ------------------------------ Geometry ----------------------------- */
  const rotOf = useCallback(
    (n: number) => (state ? norm360(state.rotation + (state.pageRotations[n] || 0)) : 0),
    [state],
  );

  const layout = settings.pdfLayout;
  const spread = layout === 'spread';
  const spreadRef = useRef<SpreadHandle>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const scale = useMemo(() => {
    if (!sizes.length || !box.w) return 1;
    let maxW = 0;
    let maxH = 0;
    sizes.forEach((s, i) => {
      const r = rotOf(i + 1) % 180 !== 0;
      maxW = Math.max(maxW, r ? s.h : s.w);
      maxH = Math.max(maxH, r ? s.w : s.h);
    });
    // Two-page view always fits the whole spread on screen (side padding + arrows ≈ 164px).
    // Two-page view: fit the whole spread on screen (side padding + arrows ≈ 164px), then apply its own zoom.
    if (spread) return clamp(Math.min((box.w - 164) / (2 * maxW), (box.h - 52 - 70) / maxH) * spreadZoom, 0.15, 6);
    if (typeof zoom === 'number') return zoom;
    const fitW = Math.min(box.w - 64, 940) / maxW;
    if (zoom === 'fit-width') return clamp(fitW, 0.25, 5);
    return clamp(Math.min(fitW, (box.h - PAD_TOP - GAP) / maxH), 0.25, 5);
  }, [zoom, sizes, box, rotOf, spread, spreadZoom]);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const captureAnchor = useCallback(() => {
    const sc = scroller.current;
    const pages = pagesRef.current;
    if (!sc || !pages) return;
    const cy = sc.scrollTop + sc.clientHeight / 2;
    const els = pages.children as HTMLCollectionOf<HTMLElement>;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const top = el.offsetTop + pages.offsetTop;
      if (top + el.offsetHeight + GAP >= cy) {
        anchor.current = {
          page: i,
          fy: (cy - top) / el.offsetHeight,
          fx: sc.scrollWidth > sc.clientWidth ? (sc.scrollLeft + sc.clientWidth / 2) / sc.scrollWidth : 0.5,
        };
        return;
      }
    }
  }, []);

  // Track scroller size
  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        captureAnchor();
        setBox({ w: sc.clientWidth, h: sc.clientHeight });
      }, box.w ? 120 : 0);
    });
    ro.observe(sc);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [doc, captureAnchor, box.w]);

  // Restore anchor after scale / rotation changes
  useLayoutEffect(() => {
    const sc = scroller.current;
    const pages = pagesRef.current;
    const a = anchor.current;
    if (!sc || !pages || !a) return;
    anchor.current = null;
    const el = pages.children[a.page] as HTMLElement | undefined;
    if (!el) return;
    const top = el.offsetTop + pages.offsetTop;
    sc.scrollTop = top + a.fy * el.offsetHeight - sc.clientHeight / 2;
    if (sc.scrollWidth > sc.clientWidth) sc.scrollLeft = a.fx * sc.scrollWidth - sc.clientWidth / 2;
  }, [scale, sizes, state?.rotation, state?.pageRotations]);

  // Initial restore of reading position
  useLayoutEffect(() => {
    if (restored.current || !doc || !meta || !box.w) return;
    restored.current = true;
    const n = meta.lastPage ?? 1;
    if (layoutRef.current === 'spread') return; // SpreadView opens at initialPage itself
    const el = pagesRef.current?.children[n - 1] as HTMLElement | undefined;
    if (el && scroller.current && n > 1) scroller.current.scrollTop = el.offsetTop + pagesRef.current!.offsetTop - PAD_TOP + 8;
  }, [doc, meta, box.w, scale]);

  /* ---------------------------- Visibility ----------------------------- */
  useEffect(() => {
    const sc = scroller.current;
    const pages = pagesRef.current;
    if (!sc || !pages || !doc) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        });
      },
      { root: sc, rootMargin: '120% 0px' },
    );
    Array.from(pages.children).forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [doc, sizes, layout]);

  // Coming back from two-page view: land on the page you were reading.
  const prevLayout = useRef(layout);
  useLayoutEffect(() => {
    if (prevLayout.current === layout) return;
    prevLayout.current = layout;
    if (layout !== 'scroll') return;
    const el = pagesRef.current?.children[current - 1] as HTMLElement | undefined;
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop + pagesRef.current!.offsetTop - PAD_TOP + 4;
  }, [layout, current]);

  const onSpreadPage = useCallback((first: number, p: number) => {
    setCurrent(first);
    setProgress(p);
  }, []);

  const onScroll = useCallback(() => {
    const sc = scroller.current;
    const pages = pagesRef.current;
    if (!sc || !pages) return;
    const line = sc.scrollTop + sc.clientHeight * 0.4 - pages.offsetTop;
    const els = pages.children as HTMLCollectionOf<HTMLElement>;
    let lo = 0;
    let hi = els.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (els[mid].offsetTop <= line) lo = mid;
      else hi = mid - 1;
    }
    setCurrent(lo + 1);
    const max = sc.scrollHeight - sc.clientHeight;
    setProgress(max > 0 ? sc.scrollTop / max : 1);
    if (selRange.current) setSel(selRange.current.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (doc) onScroll();
  }, [doc, scale, onScroll]);

  const goTo = useCallback((n: number, yFrac?: number) => {
    if (layoutRef.current === 'spread') return spreadRef.current?.goTo(n);
    const sc = scroller.current;
    const pages = pagesRef.current;
    const el = pages?.children[n - 1] as HTMLElement | undefined;
    if (!sc || !pages || !el) return;
    let top = el.offsetTop + pages.offsetTop - PAD_TOP + 4;
    if (yFrac !== undefined && yFrac > 0.15) top += yFrac * el.offsetHeight - sc.clientHeight * 0.3;
    sc.scrollTo({ top, behavior: Math.abs(sc.scrollTop - top) < sc.clientHeight * 3 ? 'smooth' : 'auto' });
  }, []);

  /* ------------------------------- Zoom -------------------------------- */
  const applyZoom = useCallback(
    (z: Zoom) => {
      if (layoutRef.current === 'spread') {
        // fit modes reset the spread; absolute zooms are converted to a multiplier of the fit size
        const fit = scaleRef.current / spreadZoomRef.current;
        setSpreadZoom(typeof z === 'number' ? clamp(z / fit, 0.5, 5) : 1);
        return;
      }
      captureAnchor();
      setZoom(z);
    },
    [captureAnchor],
  );
  const zoomIn = useCallback(() => applyZoom(STEPS.find((s) => s > scaleRef.current + 0.01) ?? 5), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom([...STEPS].reverse().find((s) => s < scaleRef.current - 0.01) ?? 0.25), [applyZoom]);
  const spreadZoomRef = useRef(spreadZoom);
  spreadZoomRef.current = spreadZoom;

  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    let acc = 0;
    let raf = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (layoutRef.current === 'spread') {
        const f = Math.exp(-e.deltaY * 0.0022);
        setSpreadZoom((z) => clamp(Math.round(z * f * 100) / 100, 0.5, 5));
        return;
      }
      acc += e.deltaY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = clamp(scaleRef.current * Math.exp(-acc * 0.0022), 0.25, 5);
        acc = 0;
        captureAnchor();
        setZoom(Math.round(next * 100) / 100);
      });
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => sc.removeEventListener('wheel', onWheel);
  }, [doc, captureAnchor]);

  /* ----------------------------- Bookmarks ----------------------------- */
  useDocTitle(meta?.name);
  const bookmarks = state?.bookmarks ?? NO_PAGES;
  const toggleBookmark = useCallback((n: number) => {
    setState((s) => {
      if (!s) return s;
      const cur = s.bookmarks ?? [];
      return { ...s, bookmarks: cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n] };
    });
  }, []);

  /* ----------------------------- Rotation ------------------------------ */
  const rotateAll = useCallback(
    (d: number) => {
      captureAnchor();
      setState((s) => (s ? { ...s, rotation: norm360(s.rotation + d) } : s));
    },
    [captureAnchor],
  );
  const rotatePage = useCallback(
    (n: number, d: number) => {
      captureAnchor();
      setState((s) => (s ? { ...s, pageRotations: { ...s.pageRotations, [n]: norm360((s.pageRotations[n] || 0) + d) } } : s));
    },
    [captureAnchor],
  );

  /* ---------------------------- Highlights ----------------------------- */
  const selRange = useRef<Range | null>(null);

  const checkSelection = useCallback(() => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) {
      selRange.current = null;
      setSel(null);
      return;
    }
    const r = s.getRangeAt(0);
    const inPage = (r.commonAncestorContainer instanceof Element ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest('.pages, .book');
    if (!inPage || !scroller.current?.contains(inPage) || !s.toString().trim()) {
      selRange.current = null;
      setSel(null);
      return;
    }
    selRange.current = r;
    setSel(r.getBoundingClientRect());
  }, []);

  useEffect(() => {
    const onChange = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) {
        selRange.current = null;
        setSel(null);
      }
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);

  const highlightsByPage = useMemo(() => {
    const m: Record<number, Highlight[]> = {};
    state?.highlights.forEach((h) => (m[h.page] ||= []).push(h));
    return m;
  }, [state?.highlights]);
  const hlCount = useMemo(() => Object.fromEntries(Object.entries(highlightsByPage).map(([k, v]) => [k, v.length])), [highlightsByPage]);

  const createHighlight = useCallback(
    (color: HighlightColor, withNote = false) => {
      const s = window.getSelection();
      const range = selRange.current;
      const root = scroller.current;
      if (!s || !range || !root) return;
      const text = s.toString().replace(/\s+/g, ' ').trim();
      // Only pages actually on screen: skip pre-rendered/turning pages in the two-page view.
      const pageEls = Array.from(root.querySelectorAll<HTMLElement>('.page[data-page]')).filter((el) => {
        const role = el.closest<HTMLElement>('[data-role]')?.dataset.role;
        if (role && role !== 'rest') return false;
        return layoutRef.current === 'spread' || visible.has(Number(el.dataset.page));
      });
      const pageRects = pageEls.map((el) => ({ n: Number(el.dataset.page), r: el.getBoundingClientRect() }));
      const byPage = new Map<number, NRect[]>();
      for (const cr of Array.from(range.getClientRects())) {
        if (cr.width < 1 || cr.height < 1) continue;
        const cx = cr.left + cr.width / 2;
        const cy = cr.top + cr.height / 2;
        const pg = pageRects.find(({ r }) => cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom);
        if (!pg) continue;
        const sz = sizes[pg.n - 1];
        const list = byPage.get(pg.n) ?? [];
        list.push(clientRectToNorm(cr, pg.r, rotOf(pg.n), sz.w * scale, sz.h * scale));
        byPage.set(pg.n, list);
      }
      const created: Highlight[] = [];
      for (const [page, rects] of byPage) {
        const merged = mergeRects(rects);
        if (merged.length) created.push({ id: uid(), page, rects: merged, color, text, note: '', createdAt: Date.now() });
      }
      if (!created.length) return;
      const bounds = range.getBoundingClientRect();
      setState((st) => (st ? { ...st, highlights: [...st.highlights, ...created] } : st));
      setLastColor(color);
      s.removeAllRanges();
      selRange.current = null;
      setSel(null);
      if (withNote) setPop({ id: created[0].id, x: bounds.left + bounds.width / 2, y: bounds.bottom, focus: true });
    },
    [visible, sizes, rotOf, scale],
  );

  const updateHl = useCallback((hid: string, patch: Partial<Highlight>) => {
    setState((st) => (st ? { ...st, highlights: st.highlights.map((h) => (h.id === hid ? { ...h, ...patch } : h)) } : st));
  }, []);
  const deleteHl = useCallback((hid: string) => {
    setState((st) => (st ? { ...st, highlights: st.highlights.filter((h) => h.id !== hid) } : st));
    setPop((p) => (p?.id === hid ? null : p));
  }, []);

  const onPageClick = useCallback(
    (e: React.MouseEvent) => {
      const s = window.getSelection();
      if (s && !s.isCollapsed) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>('.page');
      if (!el) return;
      const n = Number(el.dataset.page);
      const list = highlightsByPage[n];
      if (!list?.length) return;
      const sz = sizes[n - 1];
      const p = pointToNorm(e.clientX, e.clientY, el.getBoundingClientRect(), rotOf(n), sz.w * scale, sz.h * scale);
      const pad = 0.004;
      const hit = [...list].reverse().find((h) => h.rects.some((r) => p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad));
      if (hit) setPop({ id: hit.id, x: e.clientX, y: e.clientY, focus: false });
    },
    [highlightsByPage, sizes, rotOf, scale],
  );

  const jumpTo = useCallback(
    (h: Highlight) => {
      goTo(h.page, rotOf(h.page) === 0 ? h.rects[0]?.y : undefined);
      setFlash(h.id);
      setTimeout(() => setFlash((f) => (f === h.id ? null : f)), 1800);
    },
    [goTo, rotOf],
  );

  /* ----------------------------- Keyboard ------------------------------ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setLeftOpen(true);
        setSideTab('search');
        setSearchFocus((n) => n + 1);
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) return e.preventDefault(), zoomIn();
      if (mod && e.key === '-') return e.preventDefault(), zoomOut();
      if (mod && e.key === '0') return e.preventDefault(), applyZoom('fit-width');
      if (typing || mod || e.altKey) return;
      if (layoutRef.current === 'spread') {
        const nextKeys = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'j'];
        const prevKeys = ['ArrowLeft', 'ArrowUp', 'PageUp', 'k'];
        if (nextKeys.includes(e.key)) return e.preventDefault(), spreadRef.current?.next();
        if (prevKeys.includes(e.key)) return e.preventDefault(), spreadRef.current?.prev();
      }
      switch (e.key) {
        case 'd':
          updateSettings({ pdfLayout: layoutRef.current === 'spread' ? 'scroll' : 'spread' });
          break;
        case '+':
        case '=':
          zoomIn();
          break;
        case '-':
          zoomOut();
          break;
        case '0':
          applyZoom('fit-width');
          break;
        case '9':
          applyZoom('fit-page');
          break;
        case 'r':
          rotateAll(90);
          break;
        case 'R':
          rotateAll(-90);
          break;
        case 't':
          setLeftOpen((o) => !o);
          break;
        case 'b':
          toggleBookmark(current);
          break;
        case 'n':
          setRightOpen((o) => !o);
          break;
        case 'h':
          if (selRange.current) createHighlight(lastColor);
          break;
        case 'j':
          goTo(Math.min(current + 1, sizes.length));
          break;
        case 'k':
          goTo(Math.max(current - 1, 1));
          break;
        case 'Escape':
          if (!pop && !sel) go({ view: 'library' });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomIn, zoomOut, applyZoom, rotateAll, createHighlight, lastColor, goTo, current, sizes.length, pop, sel, go, toggleBookmark]);

  /* ------------------------------ Export ------------------------------- */
  const exportNotes = () => {
    if (!meta || !state) return;
    download(`${meta.name} — notes.md`, highlightsToMarkdown(meta.name, state.highlights, pdfSort, pdfLabel));
  };
  const exportAsNote = async () => {
    if (!meta || !state) return;
    await createMarkdown(`Notes — ${meta.name}`, highlightsToMarkdown(meta.name, state.highlights, pdfSort, pdfLabel));
    toast('Saved to your library as Markdown');
  };

  const exportPdf = useCallback(async () => {
    if (!meta || !state || !doc) return;
    if (!state.highlights.length) return toast('No highlights to export yet');
    try {
      const blob = await getPdfBlob(id);
      if (!blob) throw new Error('The file data is missing.');
      const { exportAnnotatedPdf } = await import('../../lib/pdfExport');
      const out = await exportAnnotatedPdf(await blob.arrayBuffer(), doc, state.highlights);
      download(`${meta.name} (highlighted).pdf`, new Blob([out as BlobPart], { type: 'application/pdf' }), 'application/pdf');
    } catch (e) {
      console.warn(e);
      toast('Couldn’t write highlights into this PDF');
    }
  }, [meta, state, doc, id]);

  /* -------------------------- Command palette -------------------------- */
  const pageTotal = sizes.length;
  const paletteProvider = useCallback(
    (q: string): PaletteItem[] => {
      const group = 'This PDF';
      const items: PaletteItem[] = [];
      const n = Number(q.trim().replace(/^(page|pg|p)\.?\s*/i, ''));
      if (q.trim() && Number.isInteger(n) && n >= 1 && n <= pageTotal) {
        items.push({ id: 'pdf-goto', title: `Go to page ${n}`, group, pinned: true, run: () => goTo(n) });
      }
      [...bookmarks].sort((a, b) => a - b).forEach((b) => items.push({ id: 'pdf-bm-' + b, title: `Bookmark: page ${b}`, group, keywords: 'bookmarks', run: () => goTo(b) }));
      items.push(
        { id: 'pdf-bm-toggle', title: bookmarks.includes(current) ? 'Remove bookmark from this page' : 'Bookmark this page', hint: 'B', group, run: () => toggleBookmark(current) },
        { id: 'pdf-search', title: 'Search in this PDF', hint: 'Ctrl F', group, keywords: 'find', run: () => (setLeftOpen(true), setSideTab('search'), setSearchFocus((x) => x + 1)) },
        { id: 'pdf-notes', title: 'Show or hide notes', hint: 'N', group, keywords: 'highlights panel', run: () => setRightOpen((o) => !o) },
        { id: 'pdf-export', title: 'Export PDF with highlights', group, keywords: 'save annotations download', run: exportPdf },
        { id: 'pdf-rotate', title: 'Rotate pages clockwise', hint: 'R', group, run: () => rotateAll(90) },
      );
      return items;
    },
    [pageTotal, bookmarks, current, goTo, toggleBookmark, exportPdf, rotateAll],
  );
  usePaletteProvider('pdf', paletteProvider);

  /* ------------------------------- Render ------------------------------ */
  const popHl = pop && state?.highlights.find((h) => h.id === pop.id);
  const zoomLabel = Math.round(scale * 100) + '%';
  const numPages = sizes.length;

  return (
    <div className={`reader pdf-reader filter-${settings.pageFilter}`}>
      <header className="reader-bar">
        <div className="bar-left">
          <button className="icon-btn" data-tip="Library" aria-label="Back to library" onClick={() => go({ view: 'library' })}>
            <ArrowLeft size={18} />
          </button>
          <button className={'icon-btn' + (leftOpen ? ' active' : '')} data-tip="Sidebar  T" aria-label="Toggle sidebar" onClick={() => setLeftOpen((o) => !o)}>
            <PanelLeft size={17} />
          </button>
          <div className="doc-title" title={meta?.name}>{meta?.name ?? ''}</div>
        </div>

        <div className="bar-center">
          {numPages > 0 && <PagePill current={current} total={numPages} goTo={goTo} />}
        </div>

        <div className="bar-right">
          <button
            className={'icon-btn' + (spread ? ' active' : '')}
            data-tip={spread ? 'Scroll view  D' : 'Two-page view  D'}
            aria-label="Toggle two-page view"
            aria-pressed={spread}
            onClick={() => updateSettings({ pdfLayout: spread ? 'scroll' : 'spread' })}
          >
            <BookOpen size={17} />
          </button>
          <span className="divider-v" />
          <div className="zoom-group">
            <button className="icon-btn" data-tip="Zoom out  −" aria-label="Zoom out" onClick={zoomOut}>
              <ZoomOut size={17} />
            </button>
            <PopoverButton icon={<span className="zoom-label">{zoomLabel}</span>} className="zoom-btn" align="center" width={190}>
              {(close) => (
                <>
                  <button className="menu-item" onClick={() => (applyZoom('fit-width'), close())}>
                    <ScanLine size={15} /> Fit width <span className="menu-right">{!spread && zoom === 'fit-width' ? <Check size={14} /> : <span className="kbd">0</span>}</span>
                  </button>
                  <button className="menu-item" onClick={() => (applyZoom('fit-page'), close())}>
                    <Maximize2 size={15} /> Fit page <span className="menu-right">{(spread ? spreadZoom === 1 : zoom === 'fit-page') ? <Check size={14} /> : <span className="kbd">9</span>}</span>
                  </button>
                  <div className="menu-sep" />
                  {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => (
                    <button key={z} className="menu-item" onClick={() => (applyZoom(z), close())}>
                      <span style={{ width: 15 }} />
                      {z * 100}%
                      {!spread && zoom === z && <span className="menu-right"><Check size={14} /></span>}
                    </button>
                  ))}
                </>
              )}
            </PopoverButton>
            <button className="icon-btn" data-tip="Zoom in  +" aria-label="Zoom in" onClick={zoomIn}>
              <ZoomIn size={17} />
            </button>
          </div>
          <span className="divider-v" />
          <button className="icon-btn" data-tip="Rotate left  ⇧R" aria-label="Rotate left" onClick={() => rotateAll(-90)}>
            <RotateCcw size={17} />
          </button>
          <button className="icon-btn" data-tip="Rotate right  R" aria-label="Rotate right" onClick={() => rotateAll(90)}>
            <RotateCw size={17} />
          </button>
          <span className="divider-v" />
          <button
            className={'icon-btn' + (bookmarks.includes(current) ? ' active' : '')}
            data-tip={bookmarks.includes(current) ? 'Remove bookmark  B' : 'Bookmark page  B'}
            aria-label="Toggle bookmark"
            aria-pressed={bookmarks.includes(current)}
            onClick={() => toggleBookmark(current)}
          >
            <Bookmark size={17} fill={bookmarks.includes(current) ? 'currentColor' : 'none'} />
          </button>
          <DisplayMenu mode="pdf" />
          <button className={'icon-btn' + (rightOpen ? ' active' : '')} data-tip="Notes  N" aria-label="Toggle notes" onClick={() => setRightOpen((o) => !o)}>
            <StickyNote size={17} />
            {!!state?.highlights.length && <span className="btn-badge">{state.highlights.length}</span>}
          </button>
        </div>
        <div className="progress-line">
          <div style={{ transform: `scaleX(${progress})` }} />
        </div>
      </header>

      <div className="reader-body">
        {leftOpen && doc && (
          <Sidebar
            doc={doc}
            sizes={sizes}
            tab={sideTab}
            setTab={setSideTab}
            current={current}
            rotationOf={rotOf}
            rotatePage={rotatePage}
            hlCount={hlCount}
            bookmarks={bookmarks}
            toggleBookmark={toggleBookmark}
            goTo={goTo}
            query={query}
            setQuery={setQuery}
            searchFocus={searchFocus}
          />
        )}

        <div
          className={'scroller' + (spread ? ' spread-mode' : '')}
          ref={scroller}
          onScroll={onScroll}
          onPointerDown={(e) => (e.target as HTMLElement).closest('.textLayer')?.classList.add('selecting')}
          onPointerUp={() => {
            pagesRef.current?.querySelectorAll('.textLayer.selecting').forEach((el) => el.classList.remove('selecting'));
            setTimeout(checkSelection, 0);
          }}
          onKeyUp={(e) => e.shiftKey && checkSelection()}
          onClick={onPageClick}
        >
          {error ? (
            <div className="reader-error">
              <div className="empty-title">Couldn’t open this PDF</div>
              <p>{error}</p>
              <button className="btn btn-ghost" onClick={() => go({ view: 'library' })}>Back to library</button>
            </div>
          ) : !doc ? (
            <div className="reader-loading">
              <div className="loading-page shimmer" />
            </div>
          ) : spread ? (
            <SpreadView
              ref={spreadRef}
              doc={doc}
              sizes={sizes}
              scale={scale}
              rotOf={rotOf}
              highlightsByPage={highlightsByPage}
              activeId={pop?.id ?? null}
              flashId={flash}
              search={sideTab === 'search' && leftOpen ? query : ''}
              cover={settings.spreadCover}
              animate={settings.pageTurn}
              pageFilter={settings.pageFilter}
              bookmarks={bookmarks}
              initialPage={restored.current ? current : (meta?.lastPage ?? 1)}
              onPage={onSpreadPage}
            />
          ) : (
            <div className="pages" ref={pagesRef}>
              {sizes.map((s, i) => (
                <PageView
                  key={i}
                  doc={doc}
                  num={i + 1}
                  size={s}
                  scale={scale}
                  rotation={rotOf(i + 1)}
                  visible={visible.has(i + 1)}
                  highlights={highlightsByPage[i + 1] ?? EMPTY}
                  activeId={pop?.id ?? null}
                  flashId={flash}
                  search={sideTab === 'search' && leftOpen ? query : ''}
                  bookmarked={bookmarks.includes(i + 1)}
                />
              ))}
            </div>
          )}
        </div>

        {rightOpen && state && (
          <NotesPanel
            highlights={state.highlights}
            sortKey={pdfSort}
            label={pdfLabel}
            activeId={pop?.id ?? flash}
            onJump={jumpTo}
            onChange={updateHl}
            onDelete={deleteHl}
            onExport={exportNotes}
            onExportNote={exportAsNote}
            onExportPdf={exportPdf}
          />
        )}
      </div>

      {sel && <SelectionToolbar rect={sel} lastColor={lastColor} onColor={(c) => createHighlight(c)} onNote={() => createHighlight(lastColor, true)} onCopy={() => {
        navigator.clipboard.writeText(window.getSelection()?.toString() ?? '');
        toast('Copied');
      }} />}

      {pop && popHl && (
        <HighlightPopover
          key={pop.id}
          hl={popHl}
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

const EMPTY: Highlight[] = [];
const NO_PAGES: number[] = [];
const pdfSort = (h: Highlight) => h.page * 10 + (h.rects[0]?.y ?? 0);
const pdfLabel = (h: Highlight) => `Page ${h.page}`;

function PagePill({ current, total, goTo }: { current: number; total: number; goTo: (n: number) => void }) {
  const [val, setVal] = useState(String(current));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setVal(String(current));
  }, [current, focused]);
  return (
    <div className="page-pill">
      <button className="icon-btn sm" aria-label="Previous page" onClick={() => goTo(Math.max(1, current - 1))} disabled={current <= 1}>
        <ChevronLeft size={15} />
      </button>
      <input
        aria-label="Page number"
        value={val}
        style={{ width: Math.max(2, String(total).length) + 1 + 'ch' }}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => setVal(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = clamp(Number(val) || 1, 1, total);
            goTo(n);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className="page-total">of {total}</span>
      <button className="icon-btn sm" aria-label="Next page" onClick={() => goTo(Math.min(total, current + 1))} disabled={current >= total}>
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
