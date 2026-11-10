import MarkdownIt, { type MarkdownIt as MD } from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';

export interface TocItem { id: string; text: string; level: number }

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').slice(0, 80) || 'section';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function createMd() {
  const md: MD = new MarkdownIt({ html: true, linkify: true, typographer: true });
  md.use(taskLists, { enabled: false, label: true });

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
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
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

export function wordCount(src: string) {
  const text = src.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~\-[\]()!|]/g, ' ');
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
