import { Decoration, EditorView, keymap, WidgetType, type DecorationSet } from '@codemirror/view';
import { EditorSelection, Prec, RangeSetBuilder, StateField, type EditorState } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/* ------------------------------- Theme ------------------------------- */
export const folioTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '15px',
    backgroundColor: 'transparent',
    color: 'var(--ink)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.75',
    padding: '0',
  },
  '.cm-content': {
    maxWidth: '76ch',
    margin: '0 auto',
    padding: '84px 40px 40vh',
    caretColor: 'var(--accent)',
  },
  '.cm-line': { padding: '0 2px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--accent-soft) !important',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },
  '.cm-placeholder': { color: 'var(--ink-4)', fontStyle: 'italic' },
  '.cm-searchMatch': { backgroundColor: 'rgba(255, 190, 0, 0.3)', borderRadius: '2px' },
  '.cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: 'none' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--line)' },
  '.cm-tooltip': { backgroundColor: 'var(--surface)', border: 'none', borderRadius: '10px', boxShadow: 'var(--shadow-lg)' },
});

const hl = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '700', fontSize: '1.45em', color: 'var(--ink)', letterSpacing: '-0.01em' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.25em', color: 'var(--ink)' },
  { tag: t.heading3, fontWeight: '700', fontSize: '1.1em', color: 'var(--ink)' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700', color: 'var(--ink)' },
  { tag: t.strong, fontWeight: '700', color: 'var(--ink)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--ink-3)' },
  { tag: [t.link, t.url], color: 'var(--accent)', textDecoration: 'none' },
  { tag: t.monospace, color: 'var(--accent-ink)', backgroundColor: 'var(--accent-softer)', borderRadius: '4px' },
  { tag: t.quote, color: 'var(--ink-2)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: 'var(--ink-4)' },
  { tag: t.list, color: 'var(--ink-2)' },
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--ink-3)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-fn)' },
  { tag: [t.typeName, t.className, t.tagName], color: 'var(--syn-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--syn-prop)' },
]);
export const folioHighlight = syntaxHighlighting(hl);

/* ----------------------------- Commands ------------------------------ */
export function wrap(view: EditorView, before: string, after = before, placeholder = 'text') {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const pre = state.sliceDoc(range.from - before.length, range.from);
    const post = state.sliceDoc(range.to, range.to + after.length);
    if (pre === before && post === after) {
      return {
        changes: [
          { from: range.from - before.length, to: range.from, insert: '' },
          { from: range.to, to: range.to + after.length, insert: '' },
        ],
        range: EditorSelection.range(range.from - before.length, range.to - before.length),
      };
    }
    const inner = text || placeholder;
    return {
      changes: { from: range.from, to: range.to, insert: before + inner + after },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + inner.length),
    };
  });
  view.dispatch(tr, { scrollIntoView: true, userEvent: 'input' });
  view.focus();
  return true;
}

export function linePrefix(view: EditorView, prefix: string | ((i: number) => string), heading = false) {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];
  const seen = new Set<number>();
  let i = 0;
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const p = typeof prefix === 'string' ? prefix : prefix(i++);
        if (heading) {
          const m = line.text.match(/^#{1,6}\s+/);
          const existing = m ? m[0] : '';
          changes.push({ from: line.from, to: line.from + existing.length, insert: existing === p ? '' : p });
        } else {
          const re = /^(\s*)(- \[[ x]\] |[-*+] |\d+\. |> )/;
          const m = line.text.match(re);
          if (m && m[2] === p) changes.push({ from: line.from + m[1].length, to: line.from + m[0].length, insert: '' });
          else if (m) changes.push({ from: line.from + m[1].length, to: line.from + m[0].length, insert: p });
          else changes.push({ from: line.from, to: line.from, insert: p });
        }
      }
      pos = line.to + 1;
    }
  }
  view.dispatch({ changes, userEvent: 'input' });
  view.focus();
  return true;
}

export function insertBlock(view: EditorView, block: string, cursorOffset?: number) {
  const { state } = view;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const atEmpty = line.text.trim() === '';
  const from = atEmpty ? line.from : line.to;
  const prefix = atEmpty ? (line.number > 1 && state.doc.line(line.number - 1).text.trim() ? '\n' : '') : '\n\n';
  const insert = prefix + block + '\n';
  view.dispatch({
    changes: { from, to: atEmpty ? line.to : from, insert },
    selection: { anchor: from + prefix.length + (cursorOffset ?? block.length) },
    scrollIntoView: true,
    userEvent: 'input',
  });
  view.focus();
  return true;
}

export const insertLink = (view: EditorView) => {
  const { state } = view;
  const r = state.selection.main;
  const text = state.sliceDoc(r.from, r.to) || 'link text';
  const insert = `[${text}](https://)`;
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    selection: { anchor: r.from + text.length + 3, head: r.from + insert.length - 1 },
    userEvent: 'input',
  });
  view.focus();
  return true;
};

export const SNIPPETS = {
  table: '| Column | Column |\n| --- | --- |\n| Cell | Cell |',
  mermaid: '```mermaid\nflowchart LR\n  A[Start] --> B{Decide}\n  B -->|Yes| C[Do it]\n  B -->|No| D[Skip]\n```',
  code: '```ts\n\n```',
  hr: '---',
};

export function markdownKeymap(onSave: () => void) {
  return Prec.high(
    keymap.of([
      { key: 'Mod-b', run: (v) => wrap(v, '**') },
      { key: 'Mod-i', run: (v) => wrap(v, '*') },
      { key: 'Mod-Shift-x', run: (v) => wrap(v, '~~') },
      { key: 'Mod-e', run: (v) => wrap(v, '`', '`', 'code') },
      { key: 'Mod-k', run: insertLink },
      { key: 'Mod-s', run: () => (onSave(), true), preventDefault: true },
    ]),
  );
}

/* ------------------------------ Images ------------------------------- */
// Pasted pictures are stored in the document itself as a reference definition at the very end:
//   ![image][img-ab12cd]   …   [img-ab12cd]: data:image/webp;base64,…
// The body stays readable and the file stays self-contained. In the editor the long data is
// collapsed into a small chip.

class ImageChip extends WidgetType {
  constructor(readonly kb: number) {
    super();
  }
  eq(other: ImageChip) {
    return other.kb === this.kb;
  }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-img-chip';
    el.textContent = `image data · ${this.kb < 1024 ? this.kb + ' KB' : (this.kb / 1024).toFixed(1) + ' MB'}`;
    return el;
  }
}

const DATA_URL = /data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g;

function buildChips(state: EditorState): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const text = state.doc.toString();
  if (text.includes('data:image/')) {
    for (const m of text.matchAll(DATA_URL)) {
      const kb = Math.max(1, Math.round((m[0].length * 0.75) / 1024));
      b.add(m.index, m.index + m[0].length, Decoration.replace({ widget: new ImageChip(kb) }));
    }
  }
  return b.finish();
}

export const imageChips = StateField.define<DecorationSet>({
  create: buildChips,
  update: (value, tr) => (tr.docChanged ? buildChips(tr.state) : value),
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

/** Shrinks large pictures so a pasted screenshot doesn't bloat the document. */
async function imageToDataUrl(file: File): Promise<string> {
  const read = () =>
    new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(file);
    });
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return read();
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  if (s === 1 && file.size < 350_000 && /image\/(png|jpeg|webp)/.test(file.type)) return read();
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/webp', 0.88);
}

export async function insertImageFile(view: EditorView, file: File) {
  const url = await imageToDataUrl(file);
  const id = 'img-' + Math.random().toString(36).slice(2, 8);
  const { state } = view;
  const sel = state.selection.main;
  const end = state.doc.length;
  const ref = `![${file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[[\]]/g, '') || 'image'}][${id}]`;
  const tail = `${state.doc.sliceString(Math.max(0, end - 1)) === '\n' ? '' : '\n'}\n[${id}]: ${url}\n`;
  view.dispatch({
    changes: [
      { from: sel.from, to: sel.to, insert: ref },
      { from: end, insert: tail },
    ],
    selection: { anchor: sel.from + ref.length },
    scrollIntoView: true,
    userEvent: 'input.paste',
  });
  view.focus();
}

const imageIn = (list?: FileList | null) => Array.from(list ?? []).find((f) => f.type.startsWith('image/'));

/** Paste or drop a picture into the editor. */
export const imagePaste = EditorView.domEventHandlers({
  paste(e, view) {
    const f = imageIn(e.clipboardData?.files);
    if (!f) return false;
    e.preventDefault();
    insertImageFile(view, f);
    return true;
  },
  drop(e, view) {
    const f = imageIn(e.dataTransfer?.files);
    if (!f) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos !== null) view.dispatch({ selection: { anchor: pos } });
    insertImageFile(view, f);
    return true;
  },
});
