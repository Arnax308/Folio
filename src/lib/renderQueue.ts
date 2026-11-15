/**
 * Page rendering, one job at a time, nearest-to-the-reader first.
 *
 * pdf.js decodes in a single worker. If several pages start rendering together they interleave and
 * *all* of them finish late — on a scanned book (≈1 s per page) the page you jumped to would arrive
 * after 3–5 s. Running jobs one at a time, ordered by distance from the page being read, gets that
 * page on screen first. Thumbnails and other background work queue behind every visible page.
 */
import type { PDFDoc } from './pdf';

interface Job {
  priority: () => number;
  run: () => Promise<unknown>;
  abort: () => void;
  started: boolean;
  done: boolean;
}

export class RenderQueue {
  /** The page the reader is looking at; jobs closer to it run first. */
  focus = 1;
  private jobs = new Set<Job>();
  private running = 0;
  constructor(private readonly concurrency = 1) {}

  /** Queue a job. Returns a cancel function: unstarted jobs are dropped, running ones aborted. */
  add(priority: () => number, run: () => Promise<unknown>, abort: () => void = () => {}): () => void {
    const job: Job = { priority, run, abort, started: false, done: false };
    this.jobs.add(job);
    queueMicrotask(() => this.pump());
    return () => {
      if (job.done) return;
      if (job.started) job.abort();
      else this.jobs.delete(job);
    };
  }

  setFocus(page: number) {
    this.focus = page;
  }

  private pump() {
    while (this.running < this.concurrency) {
      let next: Job | undefined;
      let best = Infinity;
      for (const j of this.jobs) {
        if (j.started) continue;
        const p = j.priority();
        if (p < best) {
          best = p;
          next = j;
        }
      }
      if (!next) return;
      const job = next;
      job.started = true;
      this.running++;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        this.jobs.delete(job);
        this.running--;
        this.pump();
      };
      // Safety valve: a job that hangs (e.g. a render waiting on a minimised window) mustn't
      // hold up everything behind it forever. It keeps running; the queue just stops waiting.
      const valve = setTimeout(release, 15000);
      job
        .run()
        .catch(() => {})
        .finally(() => {
          job.done = true;
          clearTimeout(valve);
          release();
        });
    }
  }
}

/* ------------------------- Rendered-page cache (LRU) ------------------------- */
/** Finished page canvases, so revisiting a page (or coming back from a jump) is instant. */
export class PageCache {
  private items = new Map<string, HTMLCanvasElement>();
  private bytes = 0;
  constructor(private readonly budget = 220 * 1024 * 1024) {}

  private static key(page: number, scale: number) {
    return `${page}@${Math.round(scale * 1000)}`;
  }
  private static size(c: HTMLCanvasElement) {
    return c.width * c.height * 4;
  }

  put(page: number, scale: number, canvas: HTMLCanvasElement) {
    const k = PageCache.key(page, scale);
    const old = this.items.get(k);
    if (old) {
      this.bytes -= PageCache.size(old);
      this.items.delete(k);
    }
    this.items.set(k, canvas);
    this.bytes += PageCache.size(canvas);
    for (const [key, c] of this.items) {
      if (this.bytes <= this.budget) break;
      this.items.delete(key);
      this.bytes -= PageCache.size(c);
    }
  }

  /** Takes the canvas out of the cache (a canvas can only be in one place in the DOM). */
  take(page: number, scale: number) {
    const k = PageCache.key(page, scale);
    const c = this.items.get(k);
    if (!c) return null;
    this.items.delete(k);
    this.bytes -= PageCache.size(c);
    return c;
  }
}

/* --------------------------------- Thumbnails -------------------------------- */
/** Small page images made from full renders, so thumbnails don't decode a page a second time. */
export class ThumbStore {
  private urls = new Map<number, string>();
  private listeners = new Map<number, Set<(url: string) => void>>();

  get(page: number) {
    return this.urls.get(page);
  }
  set(page: number, url: string) {
    this.urls.set(page, url);
    this.listeners.get(page)?.forEach((l) => l(url));
  }
  /** Draws a thumbnail from a freshly rendered page canvas (unrotated). */
  fromCanvas(page: number, canvas: HTMLCanvasElement, width = 264) {
    if (this.urls.has(page)) return;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = Math.round((canvas.height / canvas.width) * width);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    this.set(page, c.toDataURL('image/jpeg', 0.8));
  }
  subscribe(page: number, cb: (url: string) => void) {
    let s = this.listeners.get(page);
    if (!s) this.listeners.set(page, (s = new Set()));
    s.add(cb);
    return () => void s!.delete(cb);
  }
}

interface DocTools {
  queue: RenderQueue;
  cache: PageCache;
  thumbs: ThumbStore;
}
const tools = new WeakMap<PDFDoc, DocTools>();

export function toolsFor(doc: PDFDoc): DocTools {
  let t = tools.get(doc);
  if (!t) tools.set(doc, (t = { queue: new RenderQueue(1), cache: new PageCache(), thumbs: new ThumbStore() }));
  return t;
}

/** Priority bands: pages being read always beat background work. */
export const PRIORITY = {
  /** A preview the reader just asked for (a link / notes peek) jumps the queue. */
  urgent: () => -1,
  page: (num: number, focus: number) => Math.abs(num - focus),
  /** One-off document analysis (finding the notes section), in order. */
  background: (order: number) => 50000 + order,
  thumb: (num: number, focus: number) => 100000 + Math.abs(num - focus),
};
