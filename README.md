# Folio

A calm reader for PDF and Markdown — with highlights, notes, Mermaid diagrams and a Markdown editor. Everything is stored locally (IndexedDB in the browser, the app's own storage on the desktop).

```bash
npm install
npm run dev             # web version at http://localhost:5199
npm run desktop         # desktop app (Tauri) with hot reload
npm run release         # bump the patch version everywhere, then build the installer
npm run release -- minor
```

The desktop build needs Rust (`rustup`, MSVC toolchain) and the Visual Studio C++ Build Tools. Outputs:

- `src-tauri/target/release/folio.exe` — the app itself (uses the WebView2 runtime built into Windows 10/11)
- `src-tauri/target/release/bundle/nsis/Folio_<version>_x64-setup.exe` — per-user installer with Start-menu entry and "Open with Folio" for `.pdf` / `.md`

Run the new installer over an older version to update; the library is kept. Never change the identifier `app.folio.reader` in `tauri.conf.json` — the library is stored under it.

## Features

**Everywhere** — `Ctrl K` (or `Ctrl P`) opens a command palette: jump to any document, page (`page 12`), bookmark or heading, switch themes and layouts, back up or restore.

**Library** — drag & drop PDFs / `.md` files anywhere, cover thumbnails, "continue reading", search (`/`), rename, remove. Paper / Sepia / Night themes. **Back up** saves every document with its highlights, notes, bookmarks and reading position into one `.zip`; **Restore** loads it back.

**PDF reader**
- Continuous scroll, lazy page rendering, crisp HiDPI canvases; large PDFs open immediately (page sizes are measured in the background)
- Zoom: fit width (`0`), fit page (`9`), `+` / `−`, `Ctrl`+scroll
- Rotate the whole document (`R` / `Shift R`) or single pages from their thumbnail
- Two-page book view (`D`) with a WebGL paper-curl page turn (the page bends around a moving cylinder, lit by its curvature, casting shadows on the pages beneath; falls back to a 3D flip without WebGL). Turn with `←` / `→`, Space, the scroll wheel, the side arrows, or **grab a page edge and drag** — let go past halfway to turn, earlier to let it fall back. Zoom and pan work here too. The animation and "cover on its own" can be switched off in the **Aa** menu
- Bookmarks (`B`): a ribbon on the page, a list in the sidebar and the palette
- Sidebar (`T`): thumbnails, outline, full-text search (`Ctrl F`) with in-page match highlighting, including matches that wrap onto the next line
- Highlights in 5 colours from a floating toolbar (`H` repeats the last colour); click a highlight to recolour, annotate or delete
- Notes panel (`N`): filter by colour / notes, jump to a highlight, export as `.md`, save into the library as a Markdown note, or **export the PDF with the highlights written in** (standard PDF annotations, notes as comments — they show up in Acrobat, Edge and Preview)
- Page filters: Original / Warm / Night (dimmed pages)
- Remembers page, zoom, rotation and bookmarks per document

**Markdown reader** — highlights and notes like the PDF reader (anchored to the text, grouped by section in the notes panel, flagged "Detached" if you later edit the passage away), serif or sans typography, adjustable size & measure, table of contents with scroll-spy, highlighted code with copy, tables, task lists, footnotes, `$math$` / `$$math$$` (KaTeX), Mermaid diagrams that follow the theme.

**Markdown editor** — CodeMirror with Write / Split / Preview (`Ctrl \`), formatting bar, `Ctrl B / I / K / E`, Mermaid / table / code snippets, autosave. Paste or drop pictures straight in: they're shrunk and stored inside the document (shown as a small chip in the editor), so the file stays self-contained.

**Desktop app** — Folio-styled title bar, one window (opening another file from Explorer brings it into the running app), Markdown opened from Explorer saves straight back to the original file, native Save dialogs, links open in your browser, and the window sizes itself to fit your screen.

## Structure

```
src/
  App.tsx                 hash routing, title bar, command palette
  components/Library.tsx  home screen
  components/pdf/         PdfReader, PageView, SpreadView (two-page + curl), Sidebar, Annotations
  components/md/          MdReader, MdEditor, MarkdownView
  components/ui/          shared UI, command palette, title bar
  lib/                    storage (db), backup, pdf helpers + export, page curl (WebGL),
                          markdown + mermaid + math, CodeMirror setup, desktop bridge, settings
  styles/                 design tokens + per-view CSS
src-tauri/                desktop shell (Rust): file opening, single instance, save dialogs
scripts/release.mjs       version bump + build
```
