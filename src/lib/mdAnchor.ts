/**
 * Text-quote anchoring for highlights in rendered Markdown.
 * Positions are offsets into the concatenated text of the article (ignoring diagrams and UI chrome),
 * with prefix/suffix context so highlights survive re-renders and small edits.
 */
const SKIP = 'figure.mermaid-block, .code-copy, .code-lang, .katex';
export const CONTEXT = 32;

interface TextIndex {
  nodes: Text[];
  starts: number[];
  text: string;
}

export function indexText(root: HTMLElement): TextIndex {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    starts.push(text.length);
    text += (n as Text).data;
  }
  return { nodes, starts, text };
}

export function rangeToOffsets(root: HTMLElement, range: Range, idx = indexText(root)): { start: number; end: number } | null {
  let start = -1;
  let end = -1;
  idx.nodes.forEach((node, i) => {
    if (!range.intersectsNode(node)) return;
    const s = node === range.startContainer ? range.startOffset : 0;
    const e = node === range.endContainer ? range.endOffset : node.length;
    if (e <= s) return;
    if (start < 0) start = idx.starts[i] + s;
    end = idx.starts[i] + e;
  });
  if (start < 0 || end <= start) return null;
  // trim surrounding whitespace
  while (start < end && /\s/.test(idx.text[start])) start++;
  while (end > start && /\s/.test(idx.text[end - 1])) end--;
  return end > start ? { start, end } : null;
}

function commonSuffixLen(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefixLen(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Find the best current position for a stored quote. */
export function locate(text: string, quote: { text: string; prefix: string; suffix: string; start: number }) {
  if (!quote.text) return null;
  let best: { start: number; end: number } | null = null;
  let bestScore = -Infinity;
  for (let i = text.indexOf(quote.text); i >= 0; i = text.indexOf(quote.text, i + 1)) {
    const pre = text.slice(Math.max(0, i - CONTEXT), i);
    const suf = text.slice(i + quote.text.length, i + quote.text.length + CONTEXT);
    const score = commonSuffixLen(pre, quote.prefix) + commonPrefixLen(suf, quote.suffix) - Math.abs(i - quote.start) / 10000;
    if (score > bestScore) {
      bestScore = score;
      best = { start: i, end: i + quote.text.length };
    }
  }
  return best;
}

/** Wrap [start, end) in elements produced by `make`. Returns the created elements. */
export function wrapOffsets(idx: TextIndex, start: number, end: number, make: () => HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  idx.nodes.forEach((node, i) => {
    const base = idx.starts[i];
    const len = node.data.length;
    if (base + len <= start || base >= end) return;
    const s = Math.max(0, start - base);
    const e = Math.min(len, end - base);
    if (!node.data.slice(s, e).trim()) return;
    let target = node;
    if (s > 0) target = target.splitText(s);
    if (e - s < target.length) target.splitText(e - s);
    const el = make();
    target.parentNode!.insertBefore(el, target);
    el.appendChild(target);
    out.push(el);
  });
  return out;
}

export function unwrapAll(root: HTMLElement, selector: string) {
  const parents = new Set<Node>();
  root.querySelectorAll(selector).forEach((el) => {
    const p = el.parentNode!;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
    parents.add(p);
  });
  parents.forEach((p) => p.normalize());
}
