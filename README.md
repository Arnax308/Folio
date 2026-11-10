# Folio

A calm reader for PDF and Markdown — with highlights, notes, Mermaid diagrams and a Markdown editor. Everything is stored locally in the browser (IndexedDB).

```bash
npm install
npm run dev             # web version at http://localhost:5199
npm run desktop         # desktop app (Tauri) with hot reload
npm run desktop:build   # release build: Folio.exe + installer
```

The desktop build needs Rust (`rustup`, MSVC toolchain) and the Visual Studio C++ Build Tools. Outputs:

- `src-tauri/target/release/folio.exe` — the app itself (uses the WebView2 runtime built into Windows 10/11)
- `src-tauri/target/release/bundle/nsis/Folio_0.1.0_x64-setup.exe` — per-user installer with Start-menu entry and "Open with Folio" for `.pdf` / `.md`

In the desktop app, files you open from Explorer are added to the library (re-opening the same file reuses its entry and highlights), and links in Markdown open in your default browser.

## Features

**Library** — drag & drop PDFs / `.md` files anywhere, cover thumbnails, "continue reading", search (`/`), rename, remove. Paper / Sepia / Night themes.

**PDF reader**
- Continuous scroll, lazy page rendering, crisp HiDPI canvases
- Zoom: fit width (`0`), fit page (`9`), `+` / `−`, `Ctrl`+scroll
- Rotate the whole document (`R` / `Shift R`) or single pages from their thumbnail
- Two-page book view (`D`) with a WebGL paper-curl page turn (the page bends around a moving cylinder, lit by its curvature, casting shadows on the pages beneath; falls back to a 3D flip without WebGL). Turn with `←` / `→`, Space, the scroll wheel or the side arrows; zoom with `+` / `−` / `Ctrl`+scroll and pan when zoomed in (`0` fits the spread again). The animation and "cover on its own" can be switched off in the **Aa** menu
- Sidebar (`T`): thumbnails, outline, full-text search (`Ctrl F`) with in-page match highlighting
- Highlights in 5 colours from a floating toolbar (`H` repeats the last colour); click a highlight to recolour, annotate or delete
- Notes panel (`N`): filter by colour / notes, jump to a highlight, export as `.md` or save into the library as a Markdown note
- Page filters: Original / Warm / Night (dimmed pages)
- Remembers page, zoom and rotation per document

**Markdown reader** — highlights and notes like the PDF reader (anchored to the text, grouped by section in the notes panel, flagged "Detached" if you later edit the passage away), serif or sans typography, adjustable size & measure, table of contents with scroll-spy, highlighted code with copy, tables, task lists, Mermaid diagrams that follow the theme.

**Markdown editor** — CodeMirror with Write / Split / Preview (`Ctrl \`), formatting bar, `Ctrl B / I / K / E`, Mermaid / table / code snippets, autosave, `Ctrl S` saves to disk (File System Access API, falls back to download).

## Structure

```
src/
  App.tsx                 hash routing between views
  components/Library.tsx  home screen
  components/pdf/         PdfReader, PageView, Sidebar, Annotations
  components/md/          MdReader, MdEditor, MarkdownView
  lib/                    storage (db), pdf helpers, markdown + mermaid, CodeMirror setup, settings
  styles/                 design tokens + per-view CSS
```
