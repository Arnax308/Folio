import { useEffect, useRef, type RefObject } from 'react';
import { pointToNorm } from './pdf';
import type { InkStroke, InkTool } from './types';

/* ------------------------------- Tools -------------------------------- */
export type InkMode = InkTool | 'eraser';
export interface InkSettings {
  mode: InkMode;
  pen: { color: string; size: number };
  marker: { color: string; size: number };
}

export const PEN_COLORS = ['#1d1f24', '#2457c5', '#c8322f', '#1f7a4c'];
export const MARKER_COLORS = ['#ffd84a', '#86e3a8', '#ff9cc2', '#85c8ff'];
/** Stroke widths as a fraction of the page width: fine, medium, bold. */
export const SIZES: Record<InkTool, number[]> = {
  pen: [0.0014, 0.0024, 0.004],
  marker: [0.011, 0.017, 0.026],
};

const KEY = 'folio.ink';
export function loadInkSettings(): InkSettings {
  const d: InkSettings = { mode: 'pen', pen: { color: PEN_COLORS[0], size: 1 }, marker: { color: MARKER_COLORS[0], size: 1 } };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...d, ...v, pen: { ...d.pen, ...v.pen }, marker: { ...d.marker, ...v.marker } };
  } catch {
    return d;
  }
}
export function saveInkSettings(s: InkSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/* ------------------------------ Geometry ------------------------------ */
// Strokes are drawn in an SVG whose view box is 1000 wide and 1000 × (height / width) tall.
export const VB = 1000;

/** A smooth SVG path through the points (quadratic curves through the midpoints). */
export function strokePath(pts: number[], ar: number) {
  const n = pts.length / 2;
  if (!n) return '';
  const X = (i: number) => +(pts[i * 2] * VB).toFixed(1);
  const Y = (i: number) => +(pts[i * 2 + 1] * VB * ar).toFixed(1);
  if (n === 1) return `M${X(0)} ${Y(0)}l0.01 0`; // a dot
  if (n === 2) return `M${X(0)} ${Y(0)}L${X(1)} ${Y(1)}`;
  let d = `M${X(0)} ${Y(0)}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = +((X(i) + X(i + 1)) / 2).toFixed(1);
    const my = +((Y(i) + Y(i + 1)) / 2).toFixed(1);
    d += `Q${X(i)} ${Y(i)} ${mx} ${my}`;
  }
  return d + `L${X(n - 1)} ${Y(n - 1)}`;
}

/** Does the stroke pass within `r` (a fraction of page width) of the point? */
export function strokeHit(s: InkStroke, x: number, y: number, r: number, ar: number) {
  const reach = r + s.width / 2;
  const px = x;
  const py = y * ar;
  for (let i = 0; i < s.pts.length; i += 2) {
    const ax = s.pts[i];
    const ay = s.pts[i + 1] * ar;
    const bx = i + 2 < s.pts.length ? s.pts[i + 2] : ax;
    const by = i + 2 < s.pts.length ? s.pts[i + 3] * ar : ay;
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    if (Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= reach) return true;
  }
  return false;
}

/* ------------------------------ Drawing ------------------------------- */
interface InkHandlers {
  settings: () => InkSettings;
  /** Has a stylus been used? Then fingers move the page instead of drawing. */
  stylus: () => boolean;
  onStylus: () => void;
  strokesOn: (page: number) => InkStroke[];
  onStroke: (s: InkStroke) => void;
  onErase: (ids: string[]) => void;
}

const UI = 'button, input, textarea, select, a, .popover, .hl-popover, .sel-toolbar, .ref-card, .notes-peek, .side-panel, .ink-bar, .turn-edge, .spread-nav';
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
let nextId = 0;

/**
 * Pen mode: draw on pages with a mouse, stylus or finger. A stylus's eraser end (or its side button)
 * erases. Once a stylus has been used, a finger moves the page instead of drawing, and the palm is ignored.
 */
export function useInk(root: RefObject<HTMLElement | null>, enabled: boolean, handlers: InkHandlers) {
  const h = useRef(handlers);
  h.current = handlers;

  useEffect(() => {
    const el = root.current;
    if (!el || !enabled) return;
    type Cur = {
      pointer: number;
      page: number;
      box: DOMRect;
      rot: number;
      W: number;
      H: number;
      ar: number;
      pts: number[];
      erase: boolean;
      path: SVGPathElement | null;
      erased: Set<string>;
      mode: InkTool;
      color: string;
      width: number;
    };
    let cur: Cur | null = null;
    const touches = new Set<number>();

    const at = (c: Cur, e: PointerEvent): [number, number] => {
      const p = pointToNorm(e.clientX, e.clientY, c.box, c.rot, c.W, c.H);
      return [clamp01(p.x), clamp01(p.y)];
    };

    const eraseAt = (c: Cur, x: number, y: number) => {
      const hit = h.current
        .strokesOn(c.page)
        .filter((s) => !c.erased.has(s.id) && strokeHit(s, x, y, 0.012, c.ar))
        .map((s) => s.id);
      if (!hit.length) return;
      hit.forEach((id) => c.erased.add(id));
      h.current.onErase(hit);
    };

    const cancel = () => {
      cur?.path?.remove();
      cur = null;
      document.documentElement.classList.remove('inking-now');
    };

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.add(e.pointerId);
        // a second finger: it's a pinch, not a stroke
        if (touches.size > 1) return cancel();
        if (h.current.stylus()) return; // fingers move the page; the stylus draws
      }
      if (e.pointerType === 'pen') h.current.onStylus();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (cur) return;
      const t = e.target as Element;
      if (t.closest(UI)) return;
      const pageEl = t.closest<HTMLElement>('.page[data-page]');
      if (!pageEl) return;
      const role = pageEl.closest<HTMLElement>('[data-role]')?.dataset.role;
      if (role && role !== 'rest') return;
      const surface = pageEl.querySelector<HTMLElement>('.page-surface');
      if (!surface) return;
      e.preventDefault();
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();

      const s = h.current.settings();
      // the stylus's eraser end, or its barrel button held down
      const erase = s.mode === 'eraser' || (e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0 || (e.buttons & 2) !== 0));
      const mode: InkTool = s.mode === 'marker' ? 'marker' : 'pen';
      const W = surface.offsetWidth;
      const H = surface.offsetHeight;
      const c: Cur = {
        pointer: e.pointerId,
        page: Number(pageEl.dataset.page),
        box: (pageEl.querySelector<HTMLElement>('.page-crop') ?? pageEl).getBoundingClientRect(),
        rot: Number(pageEl.dataset.rot || 0),
        W,
        H,
        ar: H / W,
        pts: [],
        erase,
        path: null,
        erased: new Set(),
        mode,
        color: s[mode].color,
        width: SIZES[mode][s[mode].size] ?? SIZES[mode][1],
      };
      cur = c;
      const [x, y] = at(c, e);
      if (erase) {
        eraseAt(c, x, y);
      } else {
        c.pts.push(x, y);
        const svg = surface.querySelector<SVGSVGElement>(mode === 'marker' ? '.ink-markers' : '.ink-pens');
        if (svg) {
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          p.setAttribute('stroke', c.color);
          p.setAttribute('stroke-width', String(c.width * VB));
          p.setAttribute('d', strokePath(c.pts, c.ar));
          svg.append(p);
          c.path = p;
        }
      }
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      document.documentElement.classList.add('inking-now');
    };

    const move = (e: PointerEvent) => {
      const c = cur;
      if (!c || e.pointerId !== c.pointer) return;
      e.preventDefault();
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const [x, y] = at(c, ev);
        if (c.erase) {
          eraseAt(c, x, y);
          continue;
        }
        const n = c.pts.length;
        // skip points that barely moved: smaller files, smoother curves
        if (Math.hypot(x - c.pts[n - 2], (y - c.pts[n - 1]) * c.ar) < 0.0012) continue;
        c.pts.push(x, y);
      }
      if (c.path) c.path.setAttribute('d', strokePath(c.pts, c.ar));
    };

    const up = (e: PointerEvent) => {
      if (e.pointerType === 'touch') touches.delete(e.pointerId);
      const c = cur;
      if (!c || e.pointerId !== c.pointer) return;
      cur = null;
      document.documentElement.classList.remove('inking-now');
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      // the click that follows isn't a click on the page (no highlight popover, no hiding the toolbar)
      const swallow = (k: Event) => (k.stopPropagation(), k.preventDefault());
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      if (c.erase || e.type === 'pointercancel') {
        c.path?.remove();
        return;
      }
      const stroke: InkStroke = {
        id: Date.now().toString(36) + (nextId++).toString(36),
        page: c.page,
        tool: c.mode,
        color: c.color,
        width: c.width,
        pts: c.pts.map((v) => +v.toFixed(4)),
        createdAt: Date.now(),
      };
      h.current.onStroke(stroke);
      // React draws the saved stroke; drop the live one once it has
      const p = c.path;
      requestAnimationFrame(() => requestAnimationFrame(() => p?.remove()));
    };

    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      cancel();
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [root, enabled]);
}
