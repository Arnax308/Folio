# Folio

A calm reader for PDF and Markdown — with highlights, notes, Mermaid diagrams and a Markdown editor. Everything is stored locally (IndexedDB in the browser, the app's own storage on the desktop).

```bash
npm install
npm run dev             # web version at http://localhost:5199
npm run desktop         # desktop app (Tauri) with hot reload
npm run release         # bump the patch version everywhere, then build the installer
npm run release -- minor
```

For development, a Groq key can go in `.env.local` as `VITE_GROQ_KEY=…` (git-ignored, read only by the dev server, never bundled into a release).

The desktop build needs Rust (`rustup`, MSVC toolchain) and the Visual Studio C++ Build Tools. Outputs:

- `src-tauri/target/release/folio.exe` — the app itself (uses the WebView2 runtime built into Windows 10/11)
- `src-tauri/target/release/bundle/nsis/Folio_<version>_x64-setup.exe` — per-user installer with Start-menu entry and "Open with Folio" for `.pdf` / `.md`

Run the new installer over an older version to update; the library is kept. Never change the identifier `app.folio.reader` in `tauri.conf.json` — the library is stored under it.

### Android tablet

```bash
npm run android:build      # signed release APK → Folio-<version>-android.apk in the project folder
```

Needs JDK 17, the Android SDK + NDK 27 and Rust's Android targets (`scripts/android-env.sh` points at them). The script works around Tauri's symlink step, which Windows only allows in Developer Mode. Copy the APK to the tablet and open it (allow "install unknown apps" for your file manager once), or with USB debugging on: `adb install -r Folio-<version>-android.apk`.

The APK is signed with `src-tauri/gen/android/folio-release.jks` (password in `keystore.properties` next to it). Both are git-ignored — **back them up**: Android only installs an update over the existing app if it's signed with the same key; otherwise you'd have to uninstall, which deletes the library on the tablet.

## Touch interface

On the Android app (and touch-only devices) Folio switches to a touch-first layout; the desktop keeps the mouse layout. Override it under **Aa → Interface** (Auto / Touch / Mouse).

- 44 px+ controls, no hover-only buttons, a **Go to…** / search button for the command palette
- Tap the page to hide the toolbar for distraction-free reading (the page number floats at the bottom)
- Pinch to zoom; in two-page view, swipe across the book to turn pages (the curl follows your finger; flick to turn)
- Long-press to select text — the highlight colours appear under the selection, clear of Android's own menu
- Contents, thumbnails and notes slide in as drawers over the page; tapping outside closes them
- **Open with / Share:** choose Folio in Android's "Open with" or share sheet for a PDF or Markdown file and it lands in the library and opens (a copy: edits stay in Folio)
- Portrait: the library sidebar folds into a top bar with filters and a menu (theme, backup, restore)

## Features

**Everywhere** — `Ctrl K` (or `Ctrl P`) opens a command palette: jump to any document, page (`page 12`), bookmark or heading, switch themes and layouts, back up or restore.

**Library** — drag & drop PDFs / `.md` files anywhere, cover thumbnails, "continue reading", search (`/`), rename, remove. Paper / Sepia / Night themes. **Back up** saves every document with its highlights, notes, bookmarks and reading position into one `.zip`; **Restore** loads it back.

**PDF reader**
- Continuous scroll, lazy page rendering, crisp HiDPI canvases; large PDFs open immediately (page sizes are measured in the background)
- Zoom: fit width (`0`), fit page (`9`), `+` / `−`, `Ctrl`+scroll
- Hand tool (`G`, or the hand in the toolbar): drag the pages around with the mouse instead of scrolling, with a little momentum; dragging with the middle button always pans
- Rotate the whole document (`R` / `Shift R`) or single pages from their thumbnail
- Two-page book view (`D`) with a WebGL paper-curl page turn (the page bends around a moving cylinder, lit by its curvature, casting shadows on the pages beneath; falls back to a 3D flip without WebGL). Turn with `←` / `→`, Space, the scroll wheel, the side arrows, or **grab a page edge and drag** — let go past halfway to turn, earlier to let it fall back. Zoom and pan work here too. The animation and "cover on its own" can be switched off in the **Aa** menu
- Bookmarks (`B`): a ribbon on the page, a list in the sidebar and the palette
- **References.** In PDFs with links (most publisher ebooks, papers), hover or click a note marker / citation for a preview of what it points to, cropped to the spot, with **Go to**. In books whose notes sit at the back under "Notes to pages 13–29" running heads — scans included — Folio finds the notes section in the background and shows a **Notes** button (`F`) on every page that has notes: it opens the matching notes pages beside your page. Following either leaves a **Back to page N** chip (`Alt ←`)
- **Reading edition** (the book button in the toolbar): turns a PDF into clean, reflowable text that opens in the Markdown reader, with adjustable type, night mode and highlights. Note numbers become links: hover or tap one to read the note, follow it and come back. The printed page numbers stay in the margin, and a button opens the original PDF at the page you're reading. Two ways to make one:
  - **Precise (Groq, free):** an AI model on [Groq](https://console.groq.com/keys) reads each page image, so the tiny note numbers, italics and headings come out right. Needs a free Groq API key, kept on the device (never in backups); the page images are sent to Groq. On the free plan it reads about 3 pages a minute (a 500-page book takes about 2½ hours). Folio waits out the limits by itself, you can keep reading meanwhile, and if you close Folio it carries on next time. The index is skipped (it points at page numbers a reflowed book doesn't have)
  - **Quick (on this device):** rebuilds paragraphs from the text already inside the PDF. Takes seconds and works offline, but in scans the OCR usually misses the note numbers
- Big and scanned PDFs: pages render one at a time, the page you're reading first (then its neighbours, thumbnails last); the words appear before a slow scan finishes decoding; recently viewed pages are cached, so going back is instant
- Sidebar (`T`): thumbnails, outline, full-text search (`Ctrl F`) with in-page match highlighting, including matches that wrap onto the next line
- Highlights in 5 colours from a floating toolbar (`H` repeats the last colour); click a highlight to recolour, annotate or delete
- Notes panel (`N`): filter by colour / notes, jump to a highlight, export as `.md`, save into the library as a Markdown note, or **export the PDF with the highlights written in** (standard PDF annotations, notes as comments — they show up in Acrobat, Edge and Preview)
- Page filters: Original / Warm / Night (dimmed pages)
- Remembers page, zoom, rotation and bookmarks per document

**Markdown reader** — highlights and notes like the PDF reader (anchored to the text, grouped by section in the notes panel, flagged "Detached" if you later edit the passage away), serif or sans typography, adjustable size & measure, table of contents with scroll-spy, highlighted code with copy, tables, task lists you can tick (the `[x]` is saved into the text, and into the file on disk for linked files; a table cell holding just `[ ]` is a checkbox too, a Folio extension for checklists laid out as tables), footnotes (hover or tap for a preview), links to other documents in the library (`[next](chapter-2.md)`), `$math$` / `$$math$$` (KaTeX), Mermaid diagrams that follow the theme.

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
  lib/convert/            reading editions: Groq page reading, offline text rebuild, notes linking
  lib/                    storage (db), backup, pdf helpers + export, page curl (WebGL),
                          markdown + mermaid + math, CodeMirror setup, desktop bridge, settings
  styles/                 design tokens + per-view CSS
src-tauri/                desktop shell (Rust): file opening, single instance, save dialogs
scripts/release.mjs       version bump + build
```
