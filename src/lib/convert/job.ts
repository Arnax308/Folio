/**
 * Making a reading edition of a PDF. Runs in the background for as long as Folio is open (and picks up
 * where it left off next time), one page at a time, saving every page as it goes.
 */
import { useSyncExternalStore } from 'react';
import { getConvertJob, getDoc, getPdfBlob, getPdfState, patchDoc, saveConvertJob, saveMarkdown, savePdfState } from '../db';
import { createMarkdown } from '../importer';
import { wordCount } from '../markdown';
import { loadPdf, type PDFDoc } from '../pdf';
import { analyzeNotes, printedPage, type NotesIndex } from '../references';
import { assemble, type AssembleStats, type PageKind, type PageOut } from './assemble';
import { getGroqConfig, GroqError, Pacer, RateLimited, transcribePage } from './groq';
import { localPageMarkdown, textOfPage } from './local';

export type ConvertMode = 'local' | 'groq';

export interface PlanPage {
  page: number;
  kind: PageKind;
  label: string | null;
  range: [number, number] | null;
  /** read from the PDF's own text even in Groq mode: back matter has no note markers to find */
  local?: boolean;
}

export interface ConvertJob {
  pdfId: string;
  name: string;
  mode: ConvertMode;
  model?: string;
  plan: PlanPage[] | null;
  pages: Record<number, PageOut>;
  status: 'preparing' | 'running' | 'waiting' | 'paused' | 'done' | 'error';
  message?: string;
  waitUntil?: number;
  editionId?: string;
  startedAt: number;
  finishedAt?: number;
  stats?: AssembleStats;
  /** pages that fell back to the PDF's own text after Groq failed on them */
  fallbacks?: number[];
}

/* ------------------------------ shared state ------------------------------ */
const jobs = new Map<string, ConvertJob>();
const running = new Map<string, AbortController>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function update(id: string, patch: Partial<ConvertJob>, persist = true) {
  const j = jobs.get(id);
  if (!j) return;
  const next = { ...j, ...patch };
  jobs.set(id, next);
  emit();
  if (persist) void saveConvertJob(id, next);
}

export function useConvertJob(pdfId: string | undefined): ConvertJob | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => (pdfId ? (jobs.get(pdfId) ?? null) : null),
  );
}

export async function loadConvertJob(pdfId: string) {
  if (!jobs.has(pdfId)) {
    const saved = await getConvertJob<ConvertJob>(pdfId);
    if (saved && !jobs.has(pdfId)) {
      jobs.set(pdfId, saved);
      emit();
    }
  }
  return jobs.get(pdfId) ?? null;
}

export const isActive = (j: ConvertJob | null) => !!j && (j.status === 'preparing' || j.status === 'running' || j.status === 'waiting');
export const pagesDone = (j: ConvertJob) => Object.keys(j.pages).length;
export const pagesToDo = (j: ConvertJob) => j.plan?.filter((p) => p.kind !== 'skip').length ?? 0;
/** pages still waiting for Groq (the slow part) */
export const groqPagesLeft = (j: ConvertJob) => (j.mode === 'groq' ? (j.plan?.filter((p) => p.kind !== 'skip' && !p.local && !j.pages[p.page]).length ?? 0) : 0);

/* --------------------------------- control -------------------------------- */
export async function startConversion(pdfId: string, mode: ConvertMode) {
  const meta = await getDoc(pdfId);
  if (!meta) return;
  const prev = await loadConvertJob(pdfId);
  running.get(pdfId)?.abort();
  const job: ConvertJob = {
    pdfId,
    name: meta.name,
    mode,
    model: mode === 'groq' ? getGroqConfig().model : undefined,
    plan: null, // worked out afresh: cheap, and picks up improvements to the layout rules
    pages: {},
    status: 'preparing',
    startedAt: Date.now(),
    editionId: prev?.editionId ?? meta.editionId,
  };
  jobs.set(pdfId, job);
  emit();
  await saveConvertJob(pdfId, job);
  void run(pdfId);
}

export function pauseConversion(pdfId: string) {
  running.get(pdfId)?.abort();
  running.delete(pdfId);
  update(pdfId, { status: 'paused', message: undefined, waitUntil: undefined });
}

export function resumeConversion(pdfId: string) {
  const j = jobs.get(pdfId);
  if (!j || running.has(pdfId)) return;
  update(pdfId, { status: 'running', message: undefined });
  void run(pdfId);
}

/** At start-up: carry on with conversions that were going when Folio was last closed. */
export async function resumeConversions(pdfIds: string[]) {
  for (const id of pdfIds) {
    const j = await loadConvertJob(id);
    if (j && isActive(j) && !running.has(id)) void run(id);
  }
}

/* ---------------------------------- work ---------------------------------- */
/*
 * Waiting happens on a tiny worker's clock: browsers slow down timers on hidden pages (a minimised
 * window, another tab), which would stretch every pause for Groq's limit to a minute or more.
 */
let timerWorker: Worker | null = null;
let timerSeq = 0;
const timerWaits = new Map<number, () => void>();
function workerTimer(ms: number, done: () => void): () => void {
  try {
    if (!timerWorker) {
      const src = 'onmessage = (e) => setTimeout(() => postMessage(e.data.id), e.data.ms)';
      timerWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      timerWorker.onmessage = (e) => {
        timerWaits.get(e.data)?.();
        timerWaits.delete(e.data);
      };
    }
    const id = ++timerSeq;
    timerWaits.set(id, done);
    timerWorker.postMessage({ id, ms });
    return () => timerWaits.delete(id);
  } catch {
    const t = setTimeout(done, ms);
    return () => clearTimeout(t);
  }
}
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    if (signal.aborted) return rej(new DOMException('aborted', 'AbortError'));
    const cancel = workerTimer(ms, res);
    signal.addEventListener('abort', () => (cancel(), rej(new DOMException('aborted', 'AbortError'))), { once: true });
  });

const BACK_MATTER = /^\W*(\d+\s+)?(references|bibliography|works cited|acknowledg|illustration credits|photo credits|permissions|about the author)/i;

async function makePlan(doc: PDFDoc, notes: NotesIndex | null): Promise<PlanPage[]> {
  const n = doc.numPages;
  const labels = await doc.getPageLabels().catch(() => null);
  const texts: string[] = [];
  for (let i = 1; i <= n; i++) {
    const p = await doc.getPage(i);
    texts.push((await textOfPage(p)).replace(/\s+/g, ' ').trim());
    p.cleanup();
  }
  const withText = texts.filter((t) => t.length > 20).length;
  const ranges = new Map((notes?.entries ?? []).map((e) => [e.page, [e.from, e.to] as [number, number]]));
  // The notes section: the pages with "Notes to pages …" heads, every page between them, and the
  // notes-like pages just before and after (e.g. the introduction's notes, numbered in roman pages).
  const isNotesPage = new Set<number>();
  if (ranges.size) {
    const first = Math.min(...ranges.keys());
    const last = Math.max(...ranges.keys());
    for (let p = first; p <= last; p++) isNotesPage.add(p);
    const notesLike = (p: number) => {
      const t = texts[p - 1] ?? '';
      if (/^\W*(\d+\s+)?(acknowledg|references|bibliography|index)/i.test(t.slice(0, 60))) return false;
      return /^\W*notes\b/i.test(t) || (t.match(/(?:^|\s)\d{1,3}\.(?=\s)/g)?.length ?? 0) >= 4;
    };
    for (let p = first - 1; p >= Math.max(1, first - 12) && notesLike(p); p--) isNotesPage.add(p);
    for (let p = last + 1; p <= Math.min(n, last + 12) && notesLike(p); p++) isNotesPage.add(p);
  }
  const lastNotes = isNotesPage.size ? Math.max(...isNotesPage) : 0;
  return texts.map((t, i) => {
    const page = i + 1;
    const label = labels?.[i] || (notes ? String(printedPage(notes, page) ?? '') || null : null);
    let kind: PageKind = isNotesPage.has(page) ? 'notes' : 'body';
    // blank pages (when the file does have a text layer elsewhere)
    if (withText > n / 2 && t.length < 3) kind = 'skip';
    // the index points at printed page numbers, which a reflowed book doesn't have
    // (an index page: its running head, or line after line of "name, 12, 140-42")
    if (page > Math.max(lastNotes, n * 0.75) && (/^\W*(\d+\s+)?index\b/i.test(t.slice(0, 40)) || (t.match(/,\s\d{1,3}(?:[-–]\d{1,3})?/g)?.length ?? 0) >= 60)) kind = 'skip';
    // development only: convert just some pages, to try things without waiting for a whole book
    const only = import.meta.env.DEV ? (window as unknown as { folioConvertOnly?: number[] }).folioConvertOnly : undefined;
    if (only && !only.includes(page)) kind = 'skip';
    // references, acknowledgments and the like: the text layer is good enough, save Groq's daily budget
    const local = kind === 'body' && page > n * 0.6 && BACK_MATTER.test(t.slice(0, 70));
    return { page, kind, label, range: ranges.get(page) ?? null, ...(local ? { local } : {}) };
  });
}

async function renderJpeg(doc: PDFDoc, num: number) {
  const page = await doc.getPage(num);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(1400 / base.width, 2400 / base.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // 'print' renders without requestAnimationFrame, which stops while Folio is minimised or hidden
  await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
  page.cleanup();
  const url = canvas.toDataURL('image/jpeg', 0.82);
  canvas.width = canvas.height = 0;
  return url;
}

async function run(pdfId: string) {
  const ctrl = new AbortController();
  running.set(pdfId, ctrl);
  const { signal } = ctrl;
  let doc: PDFDoc | null = null;
  try {
    const blob = await getPdfBlob(pdfId);
    if (!blob) throw new GroqError('The PDF is missing from the library.', true);
    doc = await loadPdf(new Uint8Array(await blob.arrayBuffer()));

    let job = jobs.get(pdfId)!;
    if (!job.plan) {
      update(pdfId, { status: 'preparing', message: 'Reading the page layout…' });
      const state = await getPdfState(pdfId);
      let notes = state.notesIndex;
      if (notes === undefined) {
        notes = await analyzeNotes(doc);
        await savePdfState(pdfId, { ...(await getPdfState(pdfId)), notesIndex: notes });
      }
      if (signal.aborted) return;
      update(pdfId, { plan: await makePlan(doc, notes ?? null) });
    }
    update(pdfId, { status: 'running', message: undefined });

    const pacer = new Pacer();
    job = jobs.get(pdfId)!;
    const cfg = job.mode === 'groq' ? getGroqConfig() : null;
    if (cfg && !cfg.key) throw new GroqError('Add your Groq API key to use Groq.', true);
    if (cfg && job.model) cfg.model = job.model;

    for (const p of job.plan!) {
      if (signal.aborted) return;
      if (p.kind === 'skip' || jobs.get(pdfId)!.pages[p.page]) continue;
      const kind = p.kind === 'notes' ? 'notes' : 'body';
      let md: string | null = null;
      if (cfg && !p.local) {
        const image = await renderJpeg(doc, p.page);
        for (let attempt = 0; md === null; attempt++) {
          if (signal.aborted) return;
          const wait = pacer.delay();
          if (wait > 1500) update(pdfId, { status: 'waiting', waitUntil: Date.now() + wait, message: undefined }, false);
          if (wait) await sleep(wait, signal);
          update(pdfId, { status: 'running', waitUntil: undefined, message: undefined }, false);
          try {
            const r = await transcribePage(cfg, image, kind, signal);
            pacer.note(r.tokens, r.input);
            md = r.md;
          } catch (e) {
            if (signal.aborted) return;
            if (e instanceof RateLimited) {
              pacer.learn(e.message);
              const until = Date.now() + e.waitMs;
              update(pdfId, {
                status: 'waiting',
                waitUntil: until,
                message: e.daily
                  ? `Groq’s free daily allowance is used up. It refills slowly, so Folio reads a page whenever there’s room (next at ${new Date(until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}).`
                  : undefined,
              });
              await sleep(e.waitMs + 500, signal);
              continue;
            }
            if (e instanceof GroqError && e.fatal) throw e;
            if (attempt >= 2) {
              // give up on this page with Groq; use the PDF's own text so the book stays complete
              md = await localPageMarkdown(await doc.getPage(p.page), kind);
              update(pdfId, { fallbacks: [...(jobs.get(pdfId)!.fallbacks ?? []), p.page] });
            } else await sleep(3000, signal);
          }
        }
      } else {
        md = await localPageMarkdown(await doc.getPage(p.page), kind);
        if (p.page % 8 === 0) await sleep(0, signal);
      }
      const out: PageOut = { page: p.page, label: p.label, kind: p.kind, md: md ?? '', range: p.range };
      const cur = jobs.get(pdfId)!;
      update(pdfId, { pages: { ...cur.pages, [p.page]: out } }, cfg !== null || p.page % 25 === 0);
    }

    await finish(pdfId);
  } catch (e) {
    if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
    console.warn(e);
    update(pdfId, { status: 'error', message: e instanceof Error ? e.message : String(e), waitUntil: undefined });
  } finally {
    if (running.get(pdfId) === ctrl) running.delete(pdfId);
    void doc?.destroy();
  }
}

async function finish(pdfId: string) {
  const job = jobs.get(pdfId)!;
  const { md, stats } = assemble(Object.values(job.pages));
  const title = `${job.name} — reading edition`;
  let editionId = job.editionId;
  const existing = editionId ? await getDoc(editionId) : undefined;
  if (existing) {
    await saveMarkdown(existing.id, md);
    await patchDoc(existing.id, { words: wordCount(md), size: md.length, updatedAt: Date.now(), sourcePdf: pdfId });
  } else {
    const meta = await createMarkdown(title, md);
    editionId = meta.id;
    await patchDoc(meta.id, { sourcePdf: pdfId });
  }
  await patchDoc(pdfId, { editionId });
  update(pdfId, { status: 'done', editionId, stats, finishedAt: Date.now(), message: undefined, waitUntil: undefined });
}
