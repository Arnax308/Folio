import MarkdownIt, { type MarkdownIt as MD } from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import katex from 'katex';

export interface TocItem { id: string; text: string; level: number }

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').slice(0, 80) || 'section';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderMath(tex: string, display: boolean) {
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: 'html', strict: 'ignore' });
  } catch {
    return `<code class="math-error">${escapeHtml(tex)}</code>`;
  }
}

/** `$inline$` and `$$display$$` math, rendered with KaTeX. */
function mathPlugin(md: MD) {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const src = state.src;
    const start = state.pos;
    if (src[start] !== '$' || src[start + 1] === '$') return false;
    const first = src[start + 1];
    if (!first || /\s/.test(first)) return false; // "$5 and $10" is money, not math
    let end = start + 1;
    while ((end = src.indexOf('$', end)) !== -1 && src[end - 1] === '\\') end++;
    if (end === -1 || end >= state.posMax || end - start < 2) return false;
    if (/\s/.test(src[end - 1]) || /\d/.test(src[end + 1] ?? '')) return false;
    if (!silent) {
      const t = state.push('math_inline', 'math', 0);
      t.content = src.slice(start + 1, end);
      t.markup = '$';
    }
    state.pos = end + 1;
    return true;
  });

  md.block.ruler.after(
    'blockquote',
    'math_block',
    (state, startLine, endLine, silent) => {
      const lineText = (l: number) => state.src.slice(state.bMarks[l] + state.tShift[l], state.eMarks[l]);
      const head = lineText(startLine);
      if (!head.startsWith('$$')) return false;
      const body: string[] = [];
      let line = startLine;
      let rest = head.slice(2);
      let closed = false;
      if (rest.trim().endsWith('$$') && rest.trim().length >= 2) {
        rest = rest.trim().slice(0, -2);
        closed = true;
      }
      body.push(rest);
      while (!closed && ++line < endLine) {
        const text = lineText(line);
        if (text.trim().endsWith('$$')) {
          body.push(text.trim().slice(0, -2));
          closed = true;
        } else body.push(text);
      }
      if (!closed) return false;
      if (silent) return true;
      const t = state.push('math_block', 'math', 0);
      t.block = true;
      t.content = body.join('\n').trim();
      t.map = [startLine, line + 1];
      t.markup = '$$';
      state.line = line + 1;
      return true;
    },
    { alt: ['paragraph', 'reference', 'blockquote', 'list'] },
  );

  md.renderer.rules.math_inline = (tokens, i) => renderMath(tokens[i].content, false);
  md.renderer.rules.math_block = (tokens, i) => `<div class="math-block">${renderMath(tokens[i].content, true)}</div>\n`;
}

function createMd() {
  const md: MD = new MarkdownIt({ html: true, linkify: true, typographer: true });
  // Ticking a box writes [x] back into the text (toggleTaskAt). No <label> around the text:
  // selecting a task's words to highlight them mustn't tick it.
  md.use(taskLists, { enabled: true });
  md.use(footnote);
  md.use(mathPlugin);

  md.renderer.rules.fence = (tokens, idx) => {
    const t = tokens[idx];
    const lang = (t.info || '').trim().split(/\s+/)[0].toLowerCase();
    const src = t.content;
    if (lang === 'mermaid') {
      return `<figure class="mermaid-block" data-src="${escapeHtml(encodeURIComponent(src))}"><div class="mermaid-shimmer"></div></figure>`;
    }
    let body: string;
    try {
      body = lang && hljs.getLanguage(lang) ? hljs.highlight(src, { language: lang }).value : escapeHtml(src);
    } catch {
      body = escapeHtml(src);
    }
    const label = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
    return `<div class="code-block">${label}<button class="code-copy" type="button" aria-label="Copy code">Copy</button><pre><code class="hljs">${body}</code></pre></div>`;
  };

  md.renderer.rules.table_open = () => '<div class="table-wrap"><table>';
  md.renderer.rules.table_close = () => '</table></div>';

  const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = String(tokens[idx].attrGet('href') ?? '');
    if (/^https?:/i.test(href)) {
      tokens[idx].attrSet('target', '_blank');
      tokens[idx].attrSet('rel', 'noopener noreferrer');
    }
    return defaultLink(tokens, idx, options, env, self);
  };
  return md;
}

const md = createMd();

export function renderMarkdown(src: string): { html: string; toc: TocItem[] } {
  const env: Record<string, unknown> = {};
  const tokens = md.parse(src, env);
  const toc: TocItem[] = [];
  const used = new Map<string, number>();
  let row: number | null = null; // source line of the table row we're in
  let col = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // remember where each list item starts, so a ticked checkbox can find its line in the source
    if (t.type === 'list_item_open' && t.map) t.attrSet('data-line', String(t.map[0]));
    // A table cell holding only [ ] or [x] is a checkbox too (Folio's own extension: Markdown
    // only has them in lists). It knows its row's line and its column, to write the tick back.
    if (t.type === 'tr_open') {
      row = t.map ? t.map[0] : null;
      col = -1;
    }
    if (t.type === 'td_open' || t.type === 'th_open') col++;
    if (t.type === 'inline' && row !== null && (tokens[i - 1]?.type === 'td_open' || tokens[i - 1]?.type === 'th_open')) {
      const m = /^\[([ xX])\]$/.exec(t.content.trim());
      const first = t.children?.[0];
      if (m && first) {
        first.type = 'html_inline';
        first.content = `<input class="task-list-item-checkbox table-task" type="checkbox" data-line="${row}" data-col="${col}"${m[1] === ' ' ? '' : ' checked'}>`;
        t.children = [first];
      }
    }
    if (t.type === 'heading_open') {
      const inline = tokens[i + 1];
      const text = inline.children?.filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('') ?? inline.content;
      let id = slugify(text);
      const n = used.get(id) ?? 0;
      used.set(id, n + 1);
      if (n) id = `${id}-${n}`;
      t.attrSet('id', id);
      const level = Number(t.tag.slice(1));
      if (level <= 3) toc.push({ id, text, level });
    }
  }
  const raw = md.renderer.render(tokens, md.options, env);
  const html = DOMPurify.sanitize(raw, { ADD_ATTR: ['target'], FORBID_TAGS: ['style'] });
  return { html, toc };
}

/**
 * Ticks or unticks the task whose list item starts on `line` (0-based): `- [ ] …`. With `col`, the
 * checkbox is the `col`-th cell of a table row on that line instead. Null if there's no box there.
 */
export function toggleTaskAt(src: string, line: number, checked: boolean, col?: number): string | null {
  const lines = src.split('\n');
  const l = lines[line];
  if (l === undefined) return null;
  const mark = checked ? '[x]' : '[ ]';
  if (col !== undefined) {
    // split the row at its unescaped pipes (outside `code`), keeping the separators' positions
    const cuts: number[] = [];
    let code = false;
    for (let k = 0; k < l.length; k++) {
      if (l[k] === '\\') k++;
      else if (l[k] === '`') code = !code;
      else if (l[k] === '|' && !code) cuts.push(k);
    }
    const lead = /^\s*\|/.test(l) ? 1 : 0; // a leading pipe opens the first cell
    const starts = [lead ? cuts[0] + 1 : 0, ...cuts.slice(lead).map((c) => c + 1)];
    const start = starts[col];
    if (start === undefined) return null;
    const end = cuts.find((c) => c >= start) ?? l.length;
    const cell = l.slice(start, end);
    const m = /^(\s*)\[[ xX]\](\s*)$/.exec(cell);
    if (!m) return null;
    lines[line] = l.slice(0, start) + m[1] + mark + m[2] + l.slice(end);
    return lines.join('\n');
  }
  const m = /^(\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\]/.exec(l);
  if (!m) return null;
  lines[line] = m[1] + mark + l.slice(m[0].length);
  return lines.join('\n');
}

export function wordCount(src: string) {
  const text = src
    .replace(/^\[(?!\^)[^\]\n]+\]:\s.*$/gm, ' ') // link / picture definitions (footnotes are real text)
    .replace(/!\[[^\]\n]*\](\[[^\]\n]*\]|\([^)\n]*\))/g, ' ') // pictures aren't words
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-[\]()!|]/g, ' ');
  const m = text.match(/[\p{L}\p{N}']+/gu);
  return m ? m.length : 0;
}

export function titleFromMarkdown(src: string, fallback: string) {
  const m = src.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : fallback;
}

/* ---------------------------- Mermaid ---------------------------- */

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
let mermaidTheme = '';
let seq = 0;

function themeVars() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  const dark = document.documentElement.dataset.theme === 'dark';
  return {
    darkMode: dark,
    background: 'transparent',
    fontFamily: 'Inter Variable, Inter, system-ui, sans-serif',
    fontSize: '14px',
    primaryColor: v('--mm-node'),
    primaryBorderColor: v('--mm-border'),
    primaryTextColor: v('--ink'),
    secondaryColor: v('--mm-node-2'),
    tertiaryColor: v('--surface-2'),
    lineColor: v('--ink-3'),
    textColor: v('--ink-2'),
    mainBkg: v('--mm-node'),
    nodeBorder: v('--mm-border'),
    clusterBkg: v('--surface-2'),
    clusterBorder: v('--line-strong'),
    edgeLabelBackground: v('--surface'),
    noteBkgColor: v('--mm-note'),
    noteBorderColor: v('--mm-border'),
    actorBkg: v('--mm-node'),
    actorBorder: v('--mm-border'),
    signalColor: v('--ink-2'),
    labelBoxBkgColor: v('--mm-node'),
  };
}

async function getMermaid() {
  if (!mermaidPromise) mermaidPromise = import('mermaid').then((m) => m.default);
  const mermaid = await mermaidPromise;
  const theme = document.documentElement.dataset.theme || 'light';
  if (theme !== mermaidTheme) {
    mermaidTheme = theme;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: themeVars(),
      flowchart: { curve: 'basis', padding: 16, htmlLabels: true },
      sequence: { mirrorActors: false },
    });
  }
  return mermaid;
}

const svgCache = new Map<string, string>();

/** Synchronously drop in any diagrams we've already rendered (avoids flicker while typing). */
export function fillCachedMermaid(root: HTMLElement) {
  const theme = document.documentElement.dataset.theme || 'light';
  if (theme !== mermaidTheme) return;
  root.querySelectorAll<HTMLElement>('figure.mermaid-block').forEach((el) => {
    const svg = svgCache.get(theme + '\u0000' + decodeURIComponent(el.dataset.src || ''));
    if (svg) {
      el.innerHTML = svg;
      el.classList.add('ready');
    }
  });
}

export async function renderMermaidIn(root: HTMLElement, isStale: () => boolean = () => false) {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('figure.mermaid-block'));
  if (!blocks.length) return;
  const mermaid = await getMermaid();
  for (const el of blocks) {
    if (isStale()) return;
    if (el.classList.contains('ready')) continue;
    const src = decodeURIComponent(el.dataset.src || '');
    const key = mermaidTheme + '\u0000' + src;
    let svg = svgCache.get(key);
    if (!svg) {
      try {
        const res = await mermaid.render('mmd-' + ++seq, src);
        svg = res.svg;
        svgCache.set(key, svg);
        if (svgCache.size > 200) svgCache.delete(svgCache.keys().next().value!);
      } catch (e) {
        document.getElementById('dmmd-' + seq)?.remove();
        const msg = e instanceof Error ? e.message : String(e);
        el.innerHTML = `<div class="mermaid-error"><strong>Diagram error</strong><pre>${escapeHtml(msg.split('\n').slice(0, 4).join('\n'))}</pre></div>`;
        continue;
      }
    }
    if (isStale()) return;
    el.innerHTML = svg;
    el.classList.add('ready');
  }
}
