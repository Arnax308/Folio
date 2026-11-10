import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PDFDoc } from '../../lib/pdf';
import type { Highlight } from '../../lib/types';
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
  initialPage: number;
  onPage: (first: number, progress: number) => void;
}

type Spread = [number | null, number | null];
type Flip = { dir: 1 | -1; to: number };
type Role = 'L' | 'R' | 'hidden' | 'fwd-front' | 'fwd-back' | 'bwd-front' | 'bwd-back';

export const TURN_MS = 900;
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

  // Commit a flip once the animation has played.
  useEffect(() => {
    if (!flip) return;
    const t = setTimeout(() => {
      setIdx(flip.to);
      setFlip(null);
    }, TURN_MS);
    return () => clearTimeout(t);
  }, [flip]);

  // Chain a queued turn (pressing → twice quickly flips twice).
  useEffect(() => {
    if (flip || !pending.current) return;
    const dir = pending.current;
    pending.current = null;
    const to = idx + dir;
    if (to >= 0 && to < spreads.length) {
      if (animate) setFlip({ dir, to });
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
      if (animate) setFlip({ dir, to });
      else setIdx(to);
    },
    [flip, idx, spreads.length, animate],
  );

  const state = useRef({ idx, flip, turn, indexOf, animate });
  state.current = { idx, flip, turn, indexOf, animate };
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

  // Wheel turns pages (one turn per gesture).
  const wheel = useRef({ acc: 0, lock: 0 });
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    const w = wheel.current;
    const now = performance.now();
    if (now < w.lock) return;
    w.acc += e.deltaY + e.deltaX;
    if (Math.abs(w.acc) > 60) {
      turn(w.acc > 0 ? 1 : -1);
      w.acc = 0;
      w.lock = now + (animate ? 450 : 250);
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
  if (!flip) {
    set(cur[0], 'L');
    set(cur[1], 'R');
  } else if (flip.dir === 1) {
    const nxt = spreads[flip.to];
    set(cur[0], 'L');
    set(nxt[1], 'R');
    set(cur[1], 'fwd-front');
    set(nxt[0], 'fwd-back');
  } else {
    const prv = spreads[flip.to];
    set(prv[0], 'L');
    set(cur[1], 'R');
    set(cur[0], 'bwd-front');
    set(prv[1], 'bwd-back');
  }
  const sideOf = (r: Role) => (r === 'L' || r === 'fwd-back' || r === 'bwd-front' ? 'L' : 'R');

  // What the book looks like at rest after this turn — decides which half shows the spine/shadows.
  const restL = flip ? (flip.dir === 1 ? cur[0] : spreads[flip.to][0]) : cur[0];
  const restR = flip ? (flip.dir === 1 ? spreads[flip.to][1] : cur[1]) : cur[1];
  const both = flip ? true : !!(cur[0] && cur[1]);

  const pages = [...roles.entries()].sort((a, b) => a[0] - b[0]);
  const canPrev = idx > 0;
  const canNext = idx < spreads.length - 1;

  return (
    <div className="spread-stage" onWheel={onWheel}>
      <button className="spread-nav prev" aria-label="Previous pages" onClick={() => turn(-1)} disabled={!canPrev}>
        <ChevronLeft size={22} />
      </button>
      <div
        className={'book' + (flip ? ` turning dir-${flip.dir === 1 ? 'fwd' : 'bwd'}` : '')}
        style={{ width: slotW * 2, height: slotH, ['--turn-ms' as string]: TURN_MS + 'ms', ['--slot-w' as string]: slotW + 'px' }}
      >
        {pages.map(([pg, role]) => (
          <div
            key={pg}
            className={`book-page side-${sideOf(role)} role-${role}`}
            data-role={role === 'L' || role === 'R' ? 'rest' : role === 'hidden' ? 'hidden' : 'turning'}
            style={{ width: slotW, height: slotH, left: sideOf(role) === 'L' ? 0 : slotW }}
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
        ))}
        {both && restL && restR && <div className="book-spine" />}
        {flip && (
          <>
            <div className="turn-shadow lift" style={{ left: flip.dir === 1 ? slotW : 0 }} />
            <div className="turn-shadow land" style={{ left: flip.dir === 1 ? 0 : slotW }} />
          </>
        )}
      </div>
      <button className="spread-nav next" aria-label="Next pages" onClick={() => turn(1)} disabled={!canNext}>
        <ChevronRight size={22} />
      </button>
      <div className="spread-pos">
        {cur[0] && cur[1] ? `${cur[0]}–${cur[1]}` : (cur[0] ?? cur[1])} <span>of {sizes.length}</span>
      </div>
    </div>
  );
});
