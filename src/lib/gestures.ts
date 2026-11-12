import { useEffect, useRef, type RefObject } from 'react';

export interface Point {
  x: number;
  y: number;
}

export interface PinchHandlers {
  /** Two fingers went down. */
  onStart: (mid: Point) => void;
  /** `k` is the scale relative to the start; `mid` / `mid0` are the current and starting midpoints. */
  onMove: (k: number, mid: Point, mid0: Point) => void;
  onEnd: (k: number, mid: Point, mid0: Point) => void;
}

const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const midOf = (t: TouchList): Point => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

/**
 * Two-finger pinch on `ref`. Uses touch events (not pointer events) so the gesture stays ours
 * even if the first finger had already started a native scroll.
 */
export function usePinch(ref: RefObject<HTMLElement | null>, handlers: PinchHandlers, enabled: boolean) {
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let active = false;
    let d0 = 1;
    let k = 1;
    let mid0: Point = { x: 0, y: 0 };
    let mid: Point = mid0;

    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      active = true;
      d0 = Math.max(1, dist(e.touches));
      k = 1;
      mid0 = mid = midOf(e.touches);
      window.getSelection()?.removeAllRanges();
      h.current.onStart(mid0);
    };
    const move = (e: TouchEvent) => {
      if (!active || e.touches.length < 2) return;
      e.preventDefault();
      k = dist(e.touches) / d0;
      mid = midOf(e.touches);
      h.current.onMove(k, mid, mid0);
    };
    const end = (e: TouchEvent) => {
      if (!active || e.touches.length >= 2) return;
      active = false;
      h.current.onEnd(k, mid, mid0);
    };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, [ref, enabled]);
}

/** Is this click on something interactive (so it shouldn't toggle the reading chrome)? */
export const isInteractive = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.('button, a, input, textarea, .turn-edge, .hl-popover, .sel-toolbar, mark.md-hl, .popover');
