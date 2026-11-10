import { getFlag, patchDoc, saveMarkdown, savePdfBlob, setFlag, uid, upsertDoc, listDocs } from './db';
import { renderCover } from './pdf';
import { wordCount } from './markdown';
import type { DocMeta } from './types';

const isMd = (f: File) => /\.(md|markdown|mdown|mkd|txt)$/i.test(f.name) || f.type === 'text/markdown';
const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';

/** `paths[i]` is the file's location on disk when it was opened from Explorer (desktop only). */
export async function importFiles(files: File[], paths?: (string | undefined)[]): Promise<DocMeta[]> {
  const out: DocMeta[] = [];
  const existing = await listDocs();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const path = paths?.[i];
    const now = Date.now();
    // Re-opening the same file (e.g. double-click in Explorer) reuses the library entry, keeping highlights.
    const kind = isPdf(f) ? 'pdf' : 'md';
    const name = kind === 'pdf' ? f.name.replace(/\.pdf$/i, '') : f.name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '');
    const byPath = path ? existing.find((d) => d.sourcePath === path && d.kind === kind) : undefined;
    if (byPath && kind === 'md') {
      // The file on disk is the source of truth for a linked Markdown document.
      const text = await f.text();
      await saveMarkdown(byPath.id, text);
      out.push((await patchDoc(byPath.id, { words: wordCount(text), size: text.length, openedAt: now })) ?? byPath);
      continue;
    }
    const dup = byPath ?? existing.find((d) => d.kind === kind && d.name === name && d.size === f.size && !(path && d.sourcePath));
    if (dup) {
      out.push(path && !dup.sourcePath ? ((await patchDoc(dup.id, { sourcePath: path })) ?? dup) : dup);
      continue;
    }
    const base = { id: uid(), size: f.size, addedAt: now, openedAt: now, updatedAt: now, progress: 0, ...(path ? { sourcePath: path } : {}) };
    if (isPdf(f)) {
      const buf = await f.arrayBuffer();
      let cover: string | undefined;
      let pageCount: number | undefined;
      try {
        const r = await renderCover(buf);
        cover = r.cover;
        pageCount = r.pages;
      } catch (e) {
        console.warn('Could not render cover', e);
      }
      const meta: DocMeta = { ...base, name: f.name.replace(/\.pdf$/i, ''), kind: 'pdf', cover, pageCount };
      await savePdfBlob(meta.id, new Blob([buf], { type: 'application/pdf' }));
      await upsertDoc(meta);
      out.push(meta);
    } else if (isMd(f)) {
      const text = await f.text();
      const meta: DocMeta = { ...base, name: f.name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, ''), kind: 'md', words: wordCount(text) };
      await saveMarkdown(meta.id, text);
      await upsertDoc(meta);
      out.push(meta);
    }
  }
  return out;
}

export async function createMarkdown(name: string, text: string): Promise<DocMeta> {
  const now = Date.now();
  const meta: DocMeta = { id: uid(), name, kind: 'md', size: text.length, addedAt: now, openedAt: now, updatedAt: now, progress: 0, words: wordCount(text) };
  await saveMarkdown(meta.id, text);
  await upsertDoc(meta);
  return meta;
}

export async function seedIfFirstRun() {
  if (await getFlag('seeded')) return;
  await setFlag('seeded');
  if ((await listDocs()).length) return;
  await createMarkdown('Welcome to Folio', WELCOME);
}

const WELCOME = `# Welcome to Folio

*A quiet place to read, mark up and write.*

Folio opens **PDFs** and **Markdown**, keeps everything on this device, and tries very hard to stay out of your way.

## Reading PDFs

- **Highlight** — select any text and pick a colour from the floating bar.
- **Notes** — attach a note to a highlight, then find all of them in the notes panel (\`N\`).
- **Rotate** — rotate the whole document (\`R\`), or a single page from its thumbnail.
- **Zoom** — \`Ctrl\` + scroll, \`+\` / \`−\`, or fit to width with \`0\`.
- **Search** — \`Ctrl F\` searches the full text.

> Tip: switch between *Paper*, *Sepia* and *Night* themes from the **Aa** menu. Night mode can also dim PDF pages.

## Diagrams, natively

Mermaid blocks render inline and follow your theme.

\`\`\`mermaid
flowchart LR
  A[Open a file] --> B{PDF or Markdown?}
  B -- PDF --> C[Read & highlight]
  B -- Markdown --> D[Read or edit]
  C --> E[(Notes)]
  D --> E
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant You
  participant Folio
  You->>Folio: Select a passage
  Folio-->>You: Colour palette
  You->>Folio: Add a note
  Folio-->>You: Saved, instantly
\`\`\`

## Writing

Press **Edit** in the top bar to open the editor: a calm split view with live preview, formatting shortcuts and autosave.

| Shortcut | Action |
| --- | --- |
| \`Ctrl B\` | Bold |
| \`Ctrl I\` | Italic |
| \`Ctrl K\` | Link |
| \`Ctrl S\` | Save to disk |

\`\`\`ts
// Code blocks are highlighted too
function greet(reader: string) {
  return \`Happy reading, \${reader}.\`;
}
\`\`\`

## Math, footnotes and pictures

Inline math like $e^{i\\pi} + 1 = 0$ and display math both work:

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

Footnotes[^1] collect at the bottom, and you can paste or drop images straight into the editor.

[^1]: Like this one.

## Getting around

Press \`Ctrl K\` anywhere for the command palette: jump to any document, heading, page or bookmark.

- [x] Open Folio
- [ ] Drop in a PDF
- [ ] Write something
`;
