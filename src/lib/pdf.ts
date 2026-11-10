import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { NRect } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };
export type PDFDoc = pdfjs.PDFDocumentProxy;

export async function loadPdf(data: ArrayBuffer | Uint8Array) {
  return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
}

/** Render the first page to a data URL (used for library covers). */
export async function renderCover(data: ArrayBuffer, width = 360): Promise<{ cover: string; pages: number }> {
  const doc = await loadPdf(new Uint8Array(data.slice(0)));
  const page = await doc.getPage(1);
  const vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / vp0.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const cover = canvas.toDataURL('image/jpeg', 0.82);
  const pages = doc.numPages;
  doc.destroy();
  return { cover, pages };
}

/** Map a point in the rotated (outer) box back to unrotated page space. W,H = unrotated size. */
function unrotate(x: number, y: number, rot: number, W: number, H: number): [number, number] {
  switch (rot) {
    case 90: return [y, H - x];
    case 180: return [W - x, H - y];
    case 270: return [W - y, x];
    default: return [x, y];
  }
}

export function clientRectToNorm(r: DOMRect, outer: DOMRect, rot: number, W: number, H: number): NRect {
  const [x1, y1] = unrotate(r.left - outer.left, r.top - outer.top, rot, W, H);
  const [x2, y2] = unrotate(r.right - outer.left, r.bottom - outer.top, rot, W, H);
  return {
    x: Math.min(x1, x2) / W,
    y: Math.min(y1, y2) / H,
    w: Math.abs(x2 - x1) / W,
    h: Math.abs(y2 - y1) / H,
  };
}

export function pointToNorm(cx: number, cy: number, outer: DOMRect, rot: number, W: number, H: number) {
  const [x, y] = unrotate(cx - outer.left, cy - outer.top, rot, W, H);
  return { x: x / W, y: y / H };
}

/** Merge rects that sit on the same line and touch / overlap. */
export function mergeRects(rects: NRect[]): NRect[] {
  const rs = rects
    .filter((r) => r.w > 0.001 && r.h > 0.001 && r.h < 0.2 && r.w < 0.98)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const out: NRect[] = [];
  for (const r of rs) {
    const last = out[out.length - 1];
    if (last) {
      const overlapY = Math.min(last.y + last.h, r.y + r.h) - Math.max(last.y, r.y);
      const sameLine = overlapY > Math.min(last.h, r.h) * 0.5;
      const gap = r.x - (last.x + last.w);
      if (sameLine && gap < 0.015 && r.x + r.w > last.x - 0.005) {
        const x = Math.min(last.x, r.x);
        const y = Math.min(last.y, r.y);
        last.w = Math.max(last.x + last.w, r.x + r.w) - x;
        last.h = Math.max(last.y + last.h, r.y + r.h) - y;
        last.x = x;
        last.y = y;
        continue;
      }
    }
    out.push({ ...r });
  }
  return out;
}

/** CSS transform for the inner (unrotated) page surface inside its rotated box. */
export function rotationTransform(rot: number, w: number, h: number) {
  switch (rot) {
    case 90: return `rotate(90deg) translate(0, ${-h}px)`;
    case 180: return `rotate(180deg) translate(${-w}px, ${-h}px)`;
    case 270: return `rotate(270deg) translate(${-w}px, 0)`;
    default: return 'none';
  }
}
