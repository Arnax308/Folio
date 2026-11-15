/**
 * References: links inside a PDF, and the "notes for this page" lookup for books whose notes
 * live at the back.
 *
 * 1. Links — publisher ebooks and papers usually make each note marker / citation a link to the note.
 *    We read those link annotations and resolve where they point.
 * 2. Notes peek — many books (and every scan) have no links, but their notes section has running
 *    heads like "NOTES TO PAGES 13–29". Combined with the printed page numbers, that tells us which
 *    notes pages belong to the page being read.
 */
import { getPage, type PDFDoc } from './pdf';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { PRIORITY, toolsFor } from './renderQueue';
import type { NRect } from './types';

/* ---------------------------------- Links ---------------------------------- */

export interface PdfLink {
  rect: NRect; // normalised, unrotated page space
  dest?: unknown; // internal destination (name or explicit array)
  url?: string; // external link
}

export interface DestTarget {
  page: number; // 1-based
  /** Fraction of the page height from the top where the target starts (null: top of the page). */
  y: number | null;
}

const linkCache = new WeakMap<PDFDoc, Map<number, Promise<PdfLink[]>>>();

export function getLinks(doc: PDFDoc, num: number): Promise<PdfLink[]> {
  let m = linkCache.get(doc);
  if (!m) linkCache.set(doc, (m = new Map()));
  let p = m.get(num);
  if (!p) {
    p = (async () => {
      const page = await getPage(doc, num);
      const vp = page.getViewport({ scale: 1 });
      const annots = await page.getAnnotations({ intent: 'display' });
      const out: PdfLink[] = [];
      for (const a of annots) {
        if (a.subtype !== 'Link' || !a.rect) continue;
        const url: string | undefined = a.url || a.unsafeUrl;
        if (!a.dest && !url) continue;
        const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
        out.push({
          rect: {
            x: Math.min(x1, x2) / vp.width,
            y: Math.min(y1, y2) / vp.height,
            w: Math.abs(x2 - x1) / vp.width,
            h: Math.abs(y2 - y1) / vp.height,
          },
          dest: a.dest ?? undefined,
          url: a.dest ? undefined : url,
        });
      }
      return out;
    })().catch(() => []);
    m.set(num, p);
  }
  return p;
}

/** Where an internal link points: page number and how far down it. */
export async function resolveDest(doc: PDFDoc, dest: unknown): Promise<DestTarget | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : (dest as unknown[] | null);
    if (!Array.isArray(explicit) || !explicit.length) return null;
    const ref = explicit[0];
    const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref as Parameters<PDFDoc['getPageIndex']>[0]);
    const pageNum = index + 1;
    const kind = (explicit[1] as { name?: string } | undefined)?.name;
    // the y coordinate (PDF space, from the bottom) for the destination kinds that carry one
    const top =
      kind === 'XYZ' ? explicit[3] : kind === 'FitH' || kind === 'FitBH' ? explicit[2] : kind === 'FitR' ? explicit[5] : null;
    if (typeof top !== 'number') return { page: pageNum, y: null };
    const page = await getPage(doc, pageNum);
    const vp = page.getViewport({ scale: 1 });
    const [, vy] = vp.convertToViewportPoint(0, top);
    return { page: pageNum, y: Math.max(0, Math.min(1, vy / vp.height)) };
  } catch {
    return null;
  }
}

/* -------------------------------- Notes peek -------------------------------- */

export interface NotesIndex {
  version: 1;
  /** PDF page = printed page + offset (null when unknown). */
  offset: number | null;
  /** Page labels from the PDF itself, when it has them (printed page number per PDF page). */
  labels: string[] | null;
  /** Notes pages and the printed page range each one covers. */
  entries: { page: number; from: number; to: number }[];
}

const HEAD = /notes?\s+to\s+pages?\s+(\d{1,4})\s*\D{1,3}?\s*(\d{1,4})/i;

/** Text from a band of the page (top / bottom margin), read through the render queue's background band. */
async function marginText(doc: PDFDoc, num: number, band: 'top' | 'bottom', frac: number) {
  const page = await getPage(doc, num);
  const [, , , h] = page.view;
  const tc = await page.getTextContent();
  const items = tc.items
    .filter((i): i is TextItem => 'str' in i && !!i.str.trim())
    .filter((i) => (band === 'top' ? i.transform[5] > h * (1 - frac) : i.transform[5] < h * frac));
  // left to right, so a head split into several pieces reads in order
  items.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  return items.map((i) => i.str).join(' ').replace(/\s+/g, ' ');
}

/** One background job per page, behind everything being read. */
function background<T>(doc: PDFDoc, order: number, fn: () => Promise<T>): Promise<T> {
  const { queue } = toolsFor(doc);
  return new Promise<T>((resolve, reject) => {
    queue.add(() => PRIORITY.background(order), () => fn().then(resolve, reject));
  });
}

/**
 * Looks for a notes section with "Notes to pages A–B" running heads. Runs once per document in the
 * background (the result is saved with the document). Returns null when the book doesn't have one.
 */
export async function analyzeNotes(doc: PDFDoc, isStale: () => boolean = () => false): Promise<NotesIndex | null> {
  const n = doc.numPages;
  if (n < 20) return null;

  // 1) running heads in the back 45% of the book
  const entries: NotesIndex['entries'] = [];
  const start = Math.floor(n * 0.55);
  await Promise.all(
    Array.from({ length: n - start }, (_, k) => start + k + 1).map((page, k) =>
      background(doc, k, async () => {
        if (isStale()) return;
        const m = HEAD.exec(await marginText(doc, page, 'top', 0.13));
        if (!m) return;
        const from = Number(m[1]);
        const to = Number(m[2]);
        if (to >= from && to - from < 120) entries.push({ page, from, to });
      }),
    ),
  );
  if (isStale() || entries.length < 2) return null;
  entries.sort((a, b) => a.page - b.page);
  // A few heads are always unreadable (scans especially). A notes page between "…to 29" and
  // "37 to…" covers 29–37, so fill short gaps from the neighbours.
  const known = [...entries];
  for (let i = 0; i < known.length - 1; i++) {
    const a = known[i];
    const b = known[i + 1];
    const missing = b.page - a.page - 1;
    if (missing < 1 || missing > 3 || b.from < a.to) continue;
    for (let p = a.page + 1; p < b.page; p++) entries.push({ page: p, from: a.to, to: b.from });
  }
  entries.sort((a, b) => a.page - b.page);

  // 2) printed page numbers: the PDF's own labels if it has them, otherwise read them off the pages
  let labels: string[] | null = null;
  try {
    const l = await doc.getPageLabels();
    if (l && l.some((x) => /^\d+$/.test(x))) labels = l;
  } catch {
    /* none */
  }
  let offset: number | null = null;
  if (!labels) {
    const counts = new Map<number, number>();
    const samples = Array.from({ length: 60 }, (_, k) => Math.round(n * 0.1 + (k * n * 0.45) / 60) + 1).filter((p) => p <= n);
    await Promise.all(
      samples.map((page, k) =>
        background(doc, 10000 + k, async () => {
          if (isStale()) return;
          for (const band of ['top', 'bottom'] as const) {
            for (const t of (await marginText(doc, page, band, 0.08)).split(' ')) {
              if (/^\d{1,4}$/.test(t)) {
                const d = page - Number(t);
                counts.set(d, (counts.get(d) ?? 0) + 1);
              }
            }
          }
        }),
      ),
    );
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 8) offset = best[0];
  }
  if (isStale() || (!labels && offset === null)) return null;
  return { version: 1, offset, labels, entries };
}

/** The printed page number of a PDF page, if known. */
export function printedPage(index: NotesIndex, pdfPage: number): number | null {
  if (index.labels) {
    const l = index.labels[pdfPage - 1];
    return l && /^\d+$/.test(l) ? Number(l) : null;
  }
  return index.offset === null ? null : pdfPage - index.offset;
}

/** Notes pages covering the given PDF page (empty inside the notes section itself). */
export function notesFor(index: NotesIndex, pdfPage: number) {
  const first = index.entries[0]?.page ?? Infinity;
  if (pdfPage >= first - 1) return [];
  const printed = printedPage(index, pdfPage);
  if (printed === null) return [];
  return index.entries.filter((e) => printed >= e.from && printed <= e.to);
}
