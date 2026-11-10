import { getFlag, saveMarkdown, savePdfBlob, setFlag, uid, upsertDoc, listDocs } from './db';
import { renderCover } from './pdf';
import { wordCount } from './markdown';
import type { DocMeta } from './types';

const isMd = (f: File) => /\.(md|markdown|mdown|mkd|txt)$/i.test(f.name) || f.type === 'text/markdown';
const isPdf = (f: File) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';

export async function importFiles(files: File[]): Promise<DocMeta[]> {
  const out: DocMeta[] = [];
  const existing = await listDocs();
  for (const f of files) {
    const now = Date.now();
    // Re-opening the same file (e.g. double-click in Explorer) reuses the library entry, keeping highlights.
    const kind = isPdf(f) ? 'pdf' : 'md';
    const name = kind === 'pdf' ? f.name.replace(/\.pdf$/i, '') : f.name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '');
    const dup = existing.find((d) => d.kind === kind && d.name === name && d.size === f.size);
    if (dup) {
      out.push(dup);
      continue;
    }
    const base = { id: uid(), size: f.size, addedAt: now, openedAt: now, updatedAt: now, progress: 0 };
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

- [x] Open Folio
- [ ] Drop in a PDF
- [ ] Write something
`;
