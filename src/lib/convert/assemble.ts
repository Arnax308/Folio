/**
 * Turns per-page Markdown (from Groq or from the PDF's own text layer) into one reflowable book:
 * paragraphs rejoined across page breaks, original page numbers kept as quiet margin marks, and
 * every note marker linked to its note in the notes section.
 *
 * No imports on purpose: this file is pure and runs under plain Node for testing.
 */

export type PageKind = 'body' | 'notes' | 'skip';

export interface PageOut {
  /** PDF page number, 1-based. */
  page: number;
  /** The printed page number, when known ("17", "xii"). */
  label: string | null;
  kind: PageKind;
  md: string;
  /** For notes pages: the body pages (printed numbers) whose notes are on this page. */
  range?: [number, number] | null;
}

interface Note {
  key: string;
  num: number;
  paras: string[];
  range: [number, number] | null;
  group: number;
}
type NotesItem = { type: 'heading'; text: string } | { type: 'note'; note: Note };

export interface AssembleStats {
  markers: number;
  linked: number;
  notes: number;
}

const BLOCK_PREFIX = /^(#{1,6}\s+|>\s*|[-*+]\s+|\d{1,3}[.)]\s+)/;
const ENDS_SENTENCE = /[.!?:;”"’)\]*_]\s*$/;
const MARKER = /\[\^(\d{1,3})\]/g;

/** Strips what models sometimes wrap around the answer, and stray running heads / page numbers. */
export function cleanPage(md: string, label: string | null): string {
  let s = md.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/\r/g, '').trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i.exec(s);
  if (fence) s = fence[1].trim();
  const lines = s.split('\n');
  const isFolio = (l: string) => {
    const t = l.trim().replace(/[*_#]/g, '').trim();
    return /^[\dxivlc]{1,6}$/i.test(t) && (label === null || t.toLowerCase() === label.toLowerCase() || /^\d+$/.test(t));
  };
  while (lines.length && (lines[0].trim() === '' || isFolio(lines[0]))) lines.shift();
  while (lines.length && (lines[lines.length - 1].trim() === '' || isFolio(lines[lines.length - 1]))) lines.pop();
  return lines.join('\n').trim();
}

const blocksOf = (md: string) =>
  md
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

const isPlainParagraph = (b: string) => !/^(#{1,6}\s|>|[-*+]\s|\||```|<)/.test(b) && !/^\d{1,3}[.)]\s/.test(b);

/** Joins the end of one page to the start of the next. */
function joinText(a: string, b: string, mark = '') {
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + mark + b;
  return a + ' ' + mark + b;
}

function pageMark(p: PageOut) {
  return `<span class="pg" data-page="${p.page}" data-label="${(p.label ?? '').replace(/[^\w.-]/g, '')}"></span>`;
}

function withMark(block: string, mark: string) {
  const m = BLOCK_PREFIX.exec(block);
  return m ? m[0] + mark + block.slice(m[0].length) : mark + block;
}

const num = (label: string | null) => (label && /^\d+$/.test(label) ? Number(label) : null);

/** Note numbering restarts in each chapter. A small step back is more likely a misread number. */
const restarts = (n: number, prev: number) => n < prev && (n <= 3 || prev - n >= 5);

/* ------------------------------- Notes pages ------------------------------- */
function parseNotes(pages: PageOut[]): NotesItem[] {
  const items: NotesItem[] = [];
  let last: Note | null = null;
  let group = 0;
  let prevNum = 0;
  let k = 0;
  for (const p of pages) {
    blocksOf(p.md).forEach((b) => {
      if (/^#{1,6}\s+\S/.test(b)) {
        items.push({ type: 'heading', text: b.split('\n')[0] });
        return;
      }
      const m = /^(\d{1,3})[.)]\s+([\s\S]*)$/.exec(b);
      if (m) {
        const n = Number(m[1]);
        if (restarts(n, prevNum)) group++;
        prevNum = n;
        last = { key: 'n' + ++k, num: n, paras: [m[2].trim()], range: p.range ?? null, group };
        items.push({ type: 'note', note: last });
        return;
      }
      // text that carries on a note from the previous page (or a second paragraph of a note)
      const prev = last as Note | null;
      if (prev) {
        const tail = prev.paras[prev.paras.length - 1];
        if (!ENDS_SENTENCE.test(tail) || /^[a-z]/.test(b)) prev.paras[prev.paras.length - 1] = joinText(tail, b);
        else prev.paras.push(b);
      } // stray text before the first note (e.g. a section intro) is dropped
    });
  }
  return items;
}

interface Group {
  nums: Set<number>;
  lo: number | null; // printed pages covered
  hi: number | null;
}
const widen = (g: Group, a: number | null, b: number | null) => {
  if (a !== null) g.lo = g.lo === null ? a : Math.min(g.lo, a);
  if (b !== null) g.hi = g.hi === null ? b : Math.max(g.hi, b);
};

/**
 * Pairs each chapter's run of note markers with its block of notes. Both are found by the numbering
 * starting over; a notes block must contain most of the run's numbers, and when the notes pages say
 * which pages they cover ("Notes to pages 13–29"), the pages must agree too.
 */
function alignGroups(body: Group[], notes: Group[]): (number | null)[] {
  const out: (number | null)[] = [];
  let ptr = 0;
  for (const b of body) {
    let found: number | null = null;
    for (let g = ptr; g < notes.length; g++) {
      const n = notes[g];
      const cover = [...b.nums].filter((x) => n.nums.has(x)).length / Math.max(1, b.nums.size);
      const pagesKnown = n.lo !== null && b.lo !== null && b.hi !== null && n.hi !== null;
      const pagesOk = !pagesKnown || (b.hi! >= n.lo! - 2 && b.lo! <= n.hi! + 2);
      if (cover >= 0.6 && pagesOk) {
        found = g;
        break;
      }
      if (pagesKnown && n.lo! > b.hi! + 2) break; // the notes are already past this chapter: it has none we can match
    }
    out.push(found);
    if (found !== null) ptr = found + 1;
  }
  return out;
}

/* --------------------------------- Assemble -------------------------------- */
export function assemble(input: PageOut[]): { md: string; stats: AssembleStats } {
  const pages = input
    .filter((p) => p.kind !== 'skip')
    .sort((a, b) => a.page - b.page)
    .map((p) => ({ ...p, md: cleanPage(p.md, p.label) }));

  const items = parseNotes(pages.filter((p) => p.kind === 'notes'));
  const notes = items.flatMap((i) => (i.type === 'note' ? [i.note] : []));

  // ---- find the chapters' runs of markers, then pair them with the blocks of notes ----
  const bodyGroups: Group[] = [];
  const markerGroup: number[] = [];
  let prev = 0;
  for (const p of pages) {
    if (p.kind !== 'body') continue;
    const printed = num(p.label);
    for (const m of p.md.matchAll(MARKER)) {
      const n = Number(m[1]);
      if (!bodyGroups.length || restarts(n, prev)) bodyGroups.push({ nums: new Set(), lo: null, hi: null });
      prev = n;
      const g = bodyGroups[bodyGroups.length - 1];
      g.nums.add(n);
      widen(g, printed, printed);
      markerGroup.push(bodyGroups.length - 1);
    }
  }
  const notesGroups: Group[] = [];
  notes.forEach((n) => {
    const g = (notesGroups[n.group] ??= { nums: new Set(), lo: null, hi: null });
    g.nums.add(n.num);
    if (n.range) widen(g, n.range[0], n.range[1]);
  });
  const pairs = alignGroups(bodyGroups, notesGroups.map((g) => g ?? { nums: new Set(), lo: null, hi: null }));

  const used = new Set<string>();
  let mi = 0;
  let linked = 0;
  const linkMarker = (n: number) => {
    const g = pairs[markerGroup[mi++]];
    const cands = g === null || g === undefined ? [] : notes.filter((x) => x.group === g && x.num === n);
    const pick = cands.find((c) => !used.has(c.key)) ?? cands[0];
    if (!pick) return `<sup class="nref">${n}</sup>`;
    linked++;
    const first = !used.has(pick.key);
    used.add(pick.key);
    return `<sup class="nref"${first ? ` id="ref-${pick.key}"` : ''}><a href="#note-${pick.key}">${n}</a></sup>`;
  };

  // ---- walk the pages in order ----
  const out: string[] = [];
  let notesWritten = false;
  const bodyBlocks = new Map<number, string[]>();
  for (const p of pages) if (p.kind === 'body') bodyBlocks.set(p.page, blocksOf(p.md).map((b) => b.replace(MARKER, (_, d) => linkMarker(Number(d)))));
  for (const p of pages) {
    if (p.kind === 'notes') {
      if (notesWritten) continue;
      notesWritten = true;
      items.forEach((it) => {
        if (it.type === 'heading') out.push(it.text);
        else {
          const n = it.note;
          const back = used.has(n.key) ? ` href="#ref-${n.key}"` : '';
          out.push(`<a class="note-num" id="note-${n.key}"${back}>${n.num}.</a> ${n.paras[0]}`, ...n.paras.slice(1));
        }
      });
      continue;
    }
    const blocks = bodyBlocks.get(p.page) ?? [];
    if (!blocks.length) continue;
    const mark = pageMark(p);
    const last = out[out.length - 1];
    if (last !== undefined && isPlainParagraph(last) && isPlainParagraph(blocks[0]) && (!ENDS_SENTENCE.test(last) || /^[a-z]/.test(blocks[0]))) {
      // the paragraph carries on from the previous page
      out[out.length - 1] = joinText(last, blocks[0], mark);
      out.push(...blocks.slice(1));
    } else {
      out.push(withMark(blocks[0], mark), ...blocks.slice(1));
    }
  }

  return { md: out.join('\n\n') + '\n', stats: { markers: mi, linked, notes: notes.length } };
}
