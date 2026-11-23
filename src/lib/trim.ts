import { getPage, type PDFDoc } from './pdf';
import type { NRect, TrimBoxes } from './types';

/**
 * Trimming white margins: find where the text sits on a sample of pages (separately for odd and
 * even pages, since books have a wider inner margin), and show only that part, a little padded.
 * Scans are noisy, so dark scanner edges and gutter shadows are ignored, and the box is generous:
 * it covers every sampled page except the odd one out (a cover, a full-page picture).
 */
const SAMPLE_W = 280;

function pct(sorted: number[], p: number) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
}

async function textBox(doc: PDFDoc, n: number): Promise<NRect | null> {
  const page = await getPage(doc, n);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: SAMPLE_W / vp1.width });
  const W = Math.round(vp.width);
  const H = Math.round(vp.height);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  // "print" keeps it off the screen's render path (and doesn't wait on animation frames)
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  const px = ctx.getImageData(0, 0, W, H).data;

  const lum = new Uint8Array(W * H);
  const hist = new Uint32Array(256);
  for (let i = 0; i < W * H; i++) {
    const v = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
    lum[i] = v;
    hist[lum[i]]++;
  }
  // the paper: the brightness most of the page has
  let acc = 0;
  let paper = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= W * H * 0.6) {
      paper = v;
      break;
    }
  }
  const thr = paper - Math.max(48, paper * 0.25);
  const cols = new Uint32Array(W);
  const rows = new Uint32Array(H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (lum[y * W + x] < thr) {
        cols[x]++;
        rows[y]++;
      }

  // a line of the page holds content if it has some ink, but isn't a solid scanner edge or shadow
  const span = (counts: Uint32Array, len: number, other: number) => {
    const ok = Array.from(counts, (c) => c >= Math.max(1, other * 0.004) && c <= other * 0.5);
    const win = Math.max(3, Math.round(len * 0.015));
    const dense = (i: number) => {
      let k = 0;
      for (let j = i; j < Math.min(len, i + win); j++) k += ok[j] ? 1 : 0;
      return k >= win * 0.5;
    };
    let a = 0;
    while (a < len && !(ok[a] && dense(a))) a++;
    let b = len - 1;
    while (b > a && !(ok[b] && dense(Math.max(0, b - win + 1)))) b--;
    return a < b ? [a, b + 1] : null;
  };
  const xs = span(cols, W, H);
  const ys = span(rows, H, W);
  if (!xs || !ys) return null;
  return { x: xs[0] / W, y: ys[0] / H, w: (xs[1] - xs[0]) / W, h: (ys[1] - ys[0]) / H };
}

function combine(boxes: NRect[]): NRect | null {
  if (boxes.length < 2) return boxes[0] ?? null;
  const edge = (vals: number[], lowSide: boolean) => {
    const s = [...vals].sort((a, b) => a - b);
    const med = pct(s, 0.5);
    // ignore a page whose edge is far from the rest (a cover, a full-bleed picture, a near-empty page)
    const kept = s.filter((v) => Math.abs(v - med) < 0.1);
    return lowSide ? kept[0] : kept[kept.length - 1];
  };
  const l = edge(boxes.map((b) => b.x), true);
  const t = edge(boxes.map((b) => b.y), true);
  const r = edge(boxes.map((b) => b.x + b.w), false);
  const b = edge(boxes.map((b) => b.y + b.h), false);
  const PAD_X = 0.025;
  const PAD_Y = 0.02;
  const x = Math.max(0, l - PAD_X);
  const y = Math.max(0, t - PAD_Y);
  const box = { x, y, w: Math.min(1, r + PAD_X) - x, h: Math.min(1, b + PAD_Y) - y };
  if (box.w < 0.35 || box.h < 0.35) return null; // something went wrong; don't hide half the page
  if (box.w * box.h > 0.9) return null; // the margins are already narrow
  return box;
}

export async function detectTrim(doc: PDFDoc, stale: () => boolean): Promise<TrimBoxes | null | undefined> {
  const n = doc.numPages;
  const lo = n > 8 ? Math.max(2, Math.round(n * 0.06)) : 1;
  const hi = n > 8 ? Math.min(n - 1, Math.round(n * 0.94)) : n;
  const want = Math.min(24, hi - lo + 1);
  const pages = [...new Set(Array.from({ length: want }, (_, i) => Math.round(lo + ((hi - lo) * i) / Math.max(1, want - 1))))];
  const odd: NRect[] = [];
  const even: NRect[] = [];
  for (const p of pages) {
    if (stale()) return undefined;
    try {
      const b = await textBox(doc, p);
      if (b) (p % 2 ? odd : even).push(b);
    } catch {
      /* skip the page */
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  if (!odd.length && !even.length) return null;
  // one-sided documents (or too few samples on one side): the same box for every page
  const all = combine([...odd, ...even]);
  const sides = odd.length >= 3 && even.length >= 3;
  const res = { odd: sides ? combine(odd) : all, even: sides ? combine(even) : all };
  return res.odd || res.even ? res : null;
}

export const cropFor = (t: TrimBoxes | null | undefined, page: number) => (t ? (page % 2 ? t.odd : t.even) : null);
