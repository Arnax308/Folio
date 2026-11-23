import { useEffect, useRef, type RefObject } from 'react';

/**
 * Drag the page around with the mouse instead of scrolling: with the hand tool on (left button), or
 * any time with the middle button. Works on whatever scrolls under the pointer: the page column, or
 * the zoomed-in two-page view. Lets go with a little momentum, like a touchscreen.
 */
export function useHandPan(root: RefObject<HTMLElement | null>, hand: boolean, touchPan?: () => boolean) {
  // pen mode with a stylus: one finger moves the page (the page itself doesn't scroll natively then)
  const fingers = useRef(touchPan);
  fingers.current = touchPan;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    type Drag = { s: HTMLElement; id: number; x: number; y: number; left: number; top: number; moved: boolean; trail: { t: number; x: number; y: number }[] };
    let drag: Drag | null = null;
    let fling = 0;

    const scrollerFor = (t: Element) => t.closest<HTMLElement>('.spread-stage') ?? t.closest<HTMLElement>('.scroller');
    const canScroll = (s: HTMLElement) => s.scrollHeight > s.clientHeight + 1 || s.scrollWidth > s.clientWidth + 1;

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        // a second finger means a pinch: let go
        if (drag) {
          if (drag.id !== e.pointerId) drag = null;
          document.documentElement.classList.remove('hand-dragging');
          return;
        }
        if (!e.isPrimary || !fingers.current?.()) return;
      } else if (e.pointerType !== 'mouse') return;
      const middle = e.button === 1;
      if (e.pointerType === 'mouse' && !middle && !(hand && e.button === 0)) return;
      const t = e.target as Element;
      // the toolbar, menus and popovers keep working normally
      if (!middle && t.closest('button, input, textarea, select, .popover, .hl-popover, .sel-toolbar, .ref-card, .notes-peek, .side-panel')) return;
      const s = scrollerFor(t);
      if (!s || !canScroll(s)) return;
      e.preventDefault(); // no text selection, no browser autoscroll on the middle button
      e.stopPropagation(); // and no page-turn drag in the two-page view
      cancelAnimationFrame(fling);
      drag = { s, id: e.pointerId, x: e.clientX, y: e.clientY, left: s.scrollLeft, top: s.scrollTop, moved: false, trail: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }] };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      document.documentElement.classList.add('hand-dragging');
    };

    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true;
      drag.s.scrollLeft = drag.left - dx;
      drag.s.scrollTop = drag.top - dy;
      drag.trail.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
      if (drag.trail.length > 6) drag.trail.shift();
    };

    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { s, moved, trail } = drag;
      drag = null;
      document.documentElement.classList.remove('hand-dragging');
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      if (moved) {
        // a drag isn't a click: don't follow a link or open a highlight where it ended
        const swallow = (c: Event) => (c.stopPropagation(), c.preventDefault());
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      }
      // momentum, from the last ~80 ms of movement
      const last = trail[trail.length - 1];
      const first = trail.find((p) => last.t - p.t < 80) ?? last;
      const dt = last.t - first.t;
      if (!moved || dt <= 0 || e.timeStamp - last.t > 60) return;
      let vx = (last.x - first.x) / dt;
      let vy = (last.y - first.y) / dt;
      let prev = performance.now();
      const step = (now: number) => {
        const ms = Math.min(32, now - prev);
        prev = now;
        s.scrollLeft -= vx * ms;
        s.scrollTop -= vy * ms;
        const k = Math.pow(0.94, ms / 16);
        vx *= k;
        vy *= k;
        if (Math.hypot(vx, vy) > 0.02) fling = requestAnimationFrame(step);
      };
      fling = requestAnimationFrame(step);
    };

    const stopFling = () => cancelAnimationFrame(fling);
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', stopFling, { passive: true });
    // Windows starts its own autoscroll on a middle click; keep it out of the way
    const noAuto = (e: MouseEvent) => e.button === 1 && e.preventDefault();
    el.addEventListener('mousedown', noAuto, true);
    return () => {
      cancelAnimationFrame(fling);
      document.documentElement.classList.remove('hand-dragging');
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', stopFling);
      el.removeEventListener('mousedown', noAuto, true);
    };
  }, [root, hand]);
}
