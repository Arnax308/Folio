import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PDFDoc } from '../../lib/pdf';
import type { Highlight } from '../../lib/types';
import { snapshotPage, startCurl } from '../../lib/pageCurl';
import { PageView, type PageSize } from './PageView';

export interface SpreadHandle {
  goTo: (page: number) => void;
  next: () => void;
  prev: () => void;
}

interface Props {
  doc: PDFDoc;
  sizes: PageSize[];
  scale: number;
  rotOf: (n: number) => number;
  highlightsByPage: Record<number, Highlight[]>;
  activeId: string | null;
  flashId: string | null;
  search: string;
  cover: boolean;
  animate: boolean;
  pageFilter: string;
  initialPage: number;
  onPage: (first: number, progress: number) => void;
}

type Spread = [number | null, number | null];
type Flip = { dir: 1 | -1; to: number; mode: 'curl' | 'rigid' };
type Role = 'L' | 'R' | 'hidden' | 'fwd-front' | 'fwd-back' | 'bwd-front' | 'bwd-back' | 'curl';

export const TURN_MS = 900; // rigid fallback
export const CURL_MS = 1050;
const EMPTY: Highlight[] = [];

function buildSpreads(n: number, cover: boolean): Spread[] {
  const out: Spread[] = [];
  let p = 1;
  if (cover && n > 0) {
    out.push([null, 1]);
    p = 2;
  }
  for (; p <= n; p += 2) out.push([p, p + 1 <= n ? p + 1 : null]);
  return out;
}

export const SpreadView = forwardRef<SpreadHandle, Props>(function SpreadView(p, ref) {
  const { sizes, scale, rotOf, cover, animate, onPage } = p;
  const spreads = useMemo(() => buildSpreads(sizes.length, cover), [sizes.length, cover]);
  const indexOf = useCallback((page: number) => Math.max(0, spreads.findIndex((s) => s.includes(page))), [spreads]);

  const [idx, setIdx] = useState(() => indexOf(p.initialPage));
  const [flip, setFlip] = useState<Flip | null>(null);
  const firstPage = useRef(p.initialPage);
  const pending = useRef<1 | -1 | null>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const curlCanvas = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Keep the same page in view when the spread layout changes (e.g. cover toggled).
  const lastSpreads = useRef(spreads);
  useEffect(() => {
    if (lastSpreads.current === spreads) return;
    lastSpreads.current = spreads;
    setFlip(null);
    setIdx(indexOf(firstPage.current));
  }, [spreads, indexOf]);

  useEffect(() => {
    const s = spreads[idx];
    if (!s) return;
    const first = (s[0] ?? s[1])!;
    firstPage.current = first;
    onPage(first, spreads.length > 1 ? idx / (spreads.length - 1) : 1);
  }, [idx, spreads, onPage]);

  const commit = useCallback((to: number) => {
    setIdx(to);
    setFlip(null);
  }, []);

  // Rigid fallback: commit after the CSS animation has played.
  useEffect(() => {
    if (!flip || flip.mode !== 'rigid') return;
    const t = setTimeout(() => commit(flip.to), TURN_MS);
    return () => clearTimeout(t);
  }, [flip, commit]);

  // Paper curl: snapshot the two faces of the turning leaf and hand them to WebGL.
  const latest = useRef(p);
  latest.current = p;
  useLayoutEffect(() => {
    if (!flip || flip.mode !== 'curl') return;
    const book = bookRef.current;
    const canvas = curlCanvas.current;
    const cur = spreads[idx];
    const nxt = spreads[flip.to];
    const frontNum = flip.dir === 1 ? cur[1] : cur[0];
    const backNum = flip.dir === 1 ? nxt[0] : nxt[1];
    const pageEl = (n: number | null) => (n ? book?.querySelector<HTMLElement>(`.book-page[data-pg="${n}"] .page`) : null);
    const frontEl = pageEl(frontNum);
    // No WebGL, or the page hasn't rendered yet: fall back to the rigid 3D flip.
    const fail = (_why: string) => setFlip({ ...flip, mode: 'rigid' });
    if (!book || !canvas || !frontEl || !frontNum) return fail('dom');

    const { highlightsByPage, rotOf, pageFilter } = latest.current;
    const css = getComputedStyle(document.documentElement);
    const rectsOf = (n: number) =>
      (highlightsByPage[n] ?? []).flatMap((h) => h.rects.map((r) => ({ ...r, color: css.getPropertyValue('--hl-' + h.color).trim() || '#ffd84a' })));
    const front = snapshotPage(frontEl, rotOf(frontNum), rectsOf(frontNum), pageFilter);
    const backEl = pageEl(backNum);
    const back = backEl && backNum ? snapshotPage(backEl, rotOf(backNum), rectsOf(backNum), pageFilter) : null;
    if (!front) return fail('snapshot'); // a missing back face just shows blank paper

    const bookRect = book.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const fr = frontEl.getBoundingClientRect();
    const spineX = bookRect.left + bookRect.width / 2 - canvasRect.left;
    const job = startCurl({
      canvas,
      front,
      back,
      pageW: frontEl.offsetWidth,
      pageH: frontEl.offsetHeight,
      originX: spineX,
      originY: fr.top - canvasRect.top,
      side: flip.dir,
      duration: CURL_MS,
      paper: pageFilter === 'night' ? [0.11, 0.11, 0.11] : [0.985, 0.98, 0.965],
      onDone: () => commit(flip.to),
    });
    if (!job) return fail('webgl');
    return () => job.cancel();
  }, [flip, idx, spreads, commit]);

  // Chain a queued turn (pressing → twice quickly turns twice).
  useEffect(() => {
    if (flip || !pending.current) return;
    const dir = pending.current;
    pending.current = null;
    const to = idx + dir;
    if (to >= 0 && to < spreads.length) {
      if (animate) setFlip({ dir, to, mode: 'curl' });
      else setIdx(to);
    }
  }, [flip, idx, spreads.length, animate]);

  const turn = useCallback(
    (dir: 1 | -1) => {
      if (flip) {
        pending.current = dir;
        return;
      }
      const to = idx + dir;
      if (to < 0 || to >= spreads.length) return;
      if (animate) setFlip({ dir, to, mode: 'curl' });
      else setIdx(to);
    },
    [flip, idx, spreads.length, animate],
  );

  const state = useRef({ idx, flip, turn, indexOf });
  state.current = { idx, flip, turn, indexOf };
  useImperativeHandle(
    ref,
    () => ({
      next: () => state.current.turn(1),
      prev: () => state.current.turn(-1),
      goTo: (page: number) => {
        const { idx, flip, indexOf, turn } = state.current;
        if (flip) return;
        const target = indexOf(page);
        if (target === idx) return;
        if (Math.abs(target - idx) === 1) turn(target > idx ? 1 : -1);
        else setIdx(target);
      },
    }),
    [],
  );

  /* ------------------------------ Zoom & pan ------------------------------ */
  // Keep the same spot centred when the zoom changes.
  const centre = useRef({ fx: 0.5, fy: 0.5 });
  const onStageScroll = () => {
    const s = stageRef.current;
    if (!s) return;
    centre.current = {
      fx: s.scrollWidth > s.clientWidth ? (s.scrollLeft + s.clientWidth / 2) / s.scrollWidth : 0.5,
      fy: s.scrollHeight > s.clientHeight ? (s.scrollTop + s.clientHeight / 2) / s.scrollHeight : 0.5,
    };
  };
  useLayoutEffect(() => {
    const s = stageRef.current;
    if (!s) return;
    const { fx, fy } = centre.current;
    s.scrollLeft = fx * s.scrollWidth - s.clientWidth / 2;
    s.scrollTop = fy * s.scrollHeight - s.clientHeight / 2;
  }, [scale]);

  // Wheel turns pages at fit size; once zoomed in it pans instead.
  const wheel = useRef({ acc: 0, lock: 0 });
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    const s = stageRef.current;
    if (s && (s.scrollHeight > s.clientHeight + 8 || s.scrollWidth > s.clientWidth + 8)) return;
    const w = wheel.current;
    const now = performance.now();
    if (now < w.lock) return;
    w.acc += e.deltaY + e.deltaX;
    if (Math.abs(w.acc) > 60) {
      turn(w.acc > 0 ? 1 : -1);
      w.acc = 0;
      w.lock = now + (animate ? 500 : 250);
    }
  };

  /* --------------------------- Geometry & roles --------------------------- */
  const { slotW, slotH } = useMemo(() => {
    let w = 0;
    let h = 0;
    sizes.forEach((s, i) => {
      const r = rotOf(i + 1) % 180 !== 0;
      w = Math.max(w, (r ? s.h : s.w) * scale);
      h = Math.max(h, (r ? s.w : s.h) * scale);
    });
    return { slotW: Math.round(w), slotH: Math.round(h) };
  }, [sizes, scale, rotOf]);

  const cur = spreads[idx] ?? [null, null];
  const roles = new Map<number, Role>();
  const set = (page: number | null, role: Role) => page && roles.set(page, role);
  // preload neighbours so a turn never waits on rendering
  for (let i = idx - 1; i <= idx + 1; i++) spreads[i]?.forEach((pg) => set(pg, 'hidden'));
  if (flip) spreads[flip.to]?.forEach((pg) => set(pg, 'hidden'));
  const curl = flip?.mode === 'curl';
  if (!flip) {
    set(cur[0], 'L');
    set(cur[1], 'R');
  } else if (flip.dir === 1) {
    const nxt = spreads[flip.to];
    set(cur[0], 'L');
    set(nxt[1], 'R');
    set(cur[1], curl ? 'curl' : 'fwd-front');
    set(nxt[0], curl ? 'curl' : 'fwd-back');
  } else {
    const prv = spreads[flip.to];
    set(prv[0], 'L');
    set(cur[1], 'R');
    set(cur[0], curl ? 'curl' : 'bwd-front');
    set(prv[1], curl ? 'curl' : 'bwd-back');
  }
  const sideOf = (r: Role, pg: number) => {
    if (r === 'curl') return flip && (flip.dir === 1 ? pg === cur[1] : pg !== cur[0]) ? 'R' : 'L';
    return r === 'L' || r === 'fwd-back' || r === 'bwd-front' ? 'L' : 'R';
  };
  const dataRole = (r: Role) => (r === 'L' || r === 'R' ? 'rest' : r === 'hidden' || r === 'curl' ? 'hidden' : 'turning');

  const restL = flip ? (flip.dir === 1 ? cur[0] : spreads[flip.to][0]) : cur[0];
  const restR = flip ? (flip.dir === 1 ? spreads[flip.to][1] : cur[1]) : cur[1];
  const pages = [...roles.entries()].sort((a, b) => a[0] - b[0]);
  const canPrev = idx > 0;
  const canNext = idx < spreads.length - 1;
  const mx = Math.round(slotW * 0.14);
  const my = Math.round(slotH * 0.1);

  return (
    <div className="spread-root">
      <div className="spread-stage" ref={stageRef} onWheel={onWheel} onScroll={onStageScroll}>
        <div className="book-wrap">
          <div
            ref={bookRef}
            className={'book' + (flip ? ` turning dir-${flip.dir === 1 ? 'fwd' : 'bwd'} mode-${flip.mode}` : '')}
            style={{ width: slotW * 2, height: slotH, ['--turn-ms' as string]: TURN_MS + 'ms', ['--slot-w' as string]: slotW + 'px' }}
          >
            {pages.map(([pg, role]) => {
              const side = sideOf(role, pg);
              return (
                <div
                  key={pg}
                  data-pg={pg}
                  className={`book-page side-${side} role-${role}`}
                  data-role={dataRole(role)}
                  style={{ width: slotW, height: slotH, left: side === 'L' ? 0 : slotW }}
                >
                  <PageView
                    doc={p.doc}
                    num={pg}
                    size={sizes[pg - 1]}
                    scale={scale}
                    rotation={rotOf(pg)}
                    visible
                    highlights={p.highlightsByPage[pg] ?? EMPTY}
                    activeId={p.activeId}
                    flashId={p.flashId}
                    search={p.search}
                  />
                </div>
              );
            })}
            {restL && restR && <div className="book-spine" />}
            {flip?.mode === 'rigid' && (
              <>
                <div className="turn-shadow lift" style={{ left: flip.dir === 1 ? slotW : 0 }} />
                <div className="turn-shadow land" style={{ left: flip.dir === 1 ? 0 : slotW }} />
              </>
            )}
            {curl && (
              <canvas
                ref={curlCanvas}
                className="curl-canvas"
                style={{ left: -mx, top: -my, width: slotW * 2 + mx * 2, height: slotH + my * 2 }}
              />
            )}
          </div>
        </div>
      </div>
      <button className="spread-nav prev" aria-label="Previous pages" onClick={() => turn(-1)} disabled={!canPrev}>
        <ChevronLeft size={22} />
      </button>
      <button className="spread-nav next" aria-label="Next pages" onClick={() => turn(1)} disabled={!canNext}>
        <ChevronRight size={22} />
      </button>
      <div className="spread-pos">
        {cur[0] && cur[1] ? `${cur[0]}–${cur[1]}` : (cur[0] ?? cur[1])} <span>of {sizes.length}</span>
      </div>
    </div>
  );
});
