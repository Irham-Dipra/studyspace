# StudySpace — guide for Claude

StudySpace is a local-first PDF study app: library on the left, PDF viewer in the middle, notes on the right.
It reads the user's course PDFs in place from `/home/dipra/Buet/3-1` and works fully offline.

Status as of **2026-10-14**. Other docs:
- [HANDOFF.md](HANDOFF.md): the long version, with the detailed history of every feature and the problems already solved.
- [README.md](README.md): setup, configuration, the HTTP API and the schema.
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md): every feature, explained for the user.

## 📝 Keep this file up to date (required)

After **any** work in this project, before reporting back:

1. **Progress report:** add or update the feature's line in [Progress to date](#progress-to-date). Mark anything unfinished or untested as such.
2. **Code changes:** add a dated entry to the [Change log](#change-log): what changed and in which files, and how it was verified. Update [Codebase](#codebase) when files, modules, tables or conventions are added or change.
3. Also update `HANDOFF.md` (the detailed feature item), the user guide and the README when users would notice the change.
4. The project is a git repo (branch `main`). Commit only when the user asks.

## Run it

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"   # needed in every shell (Node 24 via nvm)
npm run dev          # server http://127.0.0.1:4317, UI http://localhost:5173 (server: tsx watch)
npm run typecheck    # server + web
npm test             # server tests (vitest): 74 passing
npm run build        # web/dist + server/dist; `npm start` serves the built app on 4317
```

Config lives in `.env`, the user's file, which is not committed. See `.env.example` for:
- the library folders and excludes, the data dir (default `~/.local/share/studyspace`) and the port;
- the history limit;
- the OCR programs and language;
- the AI provider (none for now).

## ⚠️ Safety rules (always)

The user's real PDFs are in `/home/dipra/Buet/3-1`. In-app edits overwrite the original PDF on purpose, so **testing must never touch them**.

- **Never test on the user's own instance** (ports 4317/5173, real DB in `~/.local/share/studyspace`). Its server runs `tsx watch`, so a new migration runs on the real DB as soon as the code is saved.
- **Test on ports 4399/5199**, with a scratch data dir and scratch *copies* of PDFs:
  - in `server/`: `STUDYSPACE_PORT=4399 STUDYSPACE_DATA_DIR=<scratch>/data STUDYSPACE_LIBRARY_DIRS=<scratch>/lib setsid npx tsx src/index.ts`
  - in `web/`: `STUDYSPACE_PORT=4399 setsid npx vite --port 5199 --strictPort`
  - A new data dir is only seeded from the env when it is empty, so use a fresh one.
- **Make test scripts check where they are:** they must abort if `/api/library` lists anything under `/home/dipra/Buet`.
- **Reading real PDFs is fine:** copying them, or read-only GETs to 4317.
- **Check real PDF mtimes after testing.** When one changed, check its `/api/documents/:id/history` on 4317 to confirm it was the user's own edit.
- **Kill only processes you started** (find the PID with `ss -ltnp`); never `pkill`.
- **Tools:**
  - curl isn't installed: use `node -e "fetch(…)"`.
  - Browser tests use Playwright, installed in the session scratchpad (`pw/`). The scratchpad can be wiped; reinstall with `npm i playwright` and `npx playwright install chromium`.
  - Write text containing backticks with quoted heredocs (`<<'EOF'`).

## Codebase

npm workspaces: `server/` (API) and `web/` (UI); `scripts/` holds dev helpers. In dev, Vite proxies `/api` to the server; in production the server also serves `web/dist`.

### Server: `server/src` (Node 24, Express 5, TypeScript)

- **Database: built-in `node:sqlite`.** There is no gcc, so no native modules. WAL and foreign keys are on.
- **PDF writing: pdf-lib.** **OCR: `ocrmypdf` and `tesseract`**, both installed.

| Path | What it does |
|---|---|
| `index.ts`, `config.ts` | Start-up and env config. The library folders are seeded from the env on the first run. |
| `app.ts` | Every `/api` route, in one Express app (see the README for the list). |
| `types.ts` | Shared server types. |
| `db/index.ts` | `openDatabase`, the `transaction` helper and `runMigrations`. Migrations are transactional and recorded; it refuses a DB that is newer than the code. |
| `db/migrations.ts` | Schema v1–v7 (see the table below). Add a new version for any schema change; never edit an old one. |
| `db/*.ts` | CRUD per table: `directories`, `documents`, `resources`, `annotations`, `progress`, `noteHighlights`, `bookmarks` (tree, cycle check, outline import). Create functions accept a client-supplied `id`, so undo/redo can re-create rows with the same id. |
| `library/fingerprint.ts` | Document identity: `v1:` + sha256(size + first and last 256 KiB). Moved or renamed files keep their data. |
| `library/scanner.ts`, `library/sync.ts` | Find PDFs (with excludes) and sync them into the DB. Handles moves by fingerprint, flags missing files, and resets bookmarks when another program changes a file. |
| `library/pathGuard.ts` | Every file access must resolve inside an enabled library folder. PDFs are streamed in place, with range requests. |
| `pdf/operations.ts` | pdf-lib edits: insert, copy, delete, replace, rotate and reorder pages; write/strip StudySpace annotations (`T="StudySpace"`); `writeOutline`; `composePdf`. |
| `pdf/coords.ts` | Normalized display coordinates (0..1 from the top-left) ⇄ PDF space, with `/Rotate` and CropBox; rotates rects and points. |
| `pdf/pageMap.ts` | Page renumbering after insert, delete or move, and its inverse. It keeps notes, highlights and bookmarks on the right page. |
| `services/fileWriter.ts` | Atomic writes: temp file, fsync, rename. |
| `services/documentEditor.ts` | `editFile`: every change to a PDF file. It saves the previous file to `<dataDir>/history/<docId>/`, snapshots notes, annotations and bookmarks, then remaps rows. Kinds: insert, delete, replace, ocr, save, rotate, move. `undoEdit` undoes them in reverse order. |
| `services/pdfTools.ts` | Extract, split and merge into new PDFs: written only inside library folders, never overwriting (`name (2).pdf`). Notes, highlights and bookmarks are copied along. |
| `services/ocr.ts` | OCR jobs on a temporary copy (`ocrmypdf --redo-ocr`) and region OCR (`tesseract`). The library file only changes when the user chooses *Add to PDF*. |
| `ai/` | AI provider registry; only `none` for now. |

**Tables:**
- `directories`, `documents`, `resources` (notes of 5 kinds, scoped to a page, a range or the document), `annotations` (highlight, area, ink), `reading_progress`.
- `document_history` (file-edit undo), `note_highlights`, `bookmarks` (tree via `parent_id`, `position` REAL, `top` on the page), `schema_migrations`.

**Tests:** `server/test/*.test.ts` (vitest), with temp dirs and generated PDFs from `helpers.ts`. OCR tests use stub binaries.

### Web: `web/src` (React, TypeScript, Vite, Tailwind v4, pdfjs-dist)

| Path | What it does |
|---|---|
| `main.tsx`, `App.tsx` | App state: open document, notes, annotations, bookmarks, dialogs. App also holds the global key handler, the undoable mutation handlers (`applyFileEdit` and others) and the layout (three resizable columns, mobile drawers). |
| `lib/api.ts` | Typed fetch client for every route. `setMutationListener` fires after writes, which drives tab sync. |
| `lib/types.ts` | Shared types and labels (`Resource`, `Annotation`, `Bookmark`, `RESOURCE_TYPE_LABEL`…). |
| `lib/undo.ts` | Undo/redo stack per document. Every change is undoable; file edits undo through the server history. |
| `lib/tabSync.ts` | BroadcastChannel sync between browser tabs. |
| `lib/shortcuts.ts` | **The one registry of keyboard shortcuts** (`SHORTCUTS`, `matches`, `keyOf`, `withKey`, `isTyping`, `GROUP_ORDER`). |
| `lib/fieldNav.ts` | ↓ / ↑ move between text boxes in dialogs. Opt out with `data-arrow-nav="off"`. |
| `lib/pdf.ts` | pdf.js setup, `openPdf`, `parsePageList`. |
| `lib/outline.ts` | Read the PDF outline; resolve destinations; build the bookmark tree; `currentBookmarkId`; `bookmarkPages` (a bookmark's section). |
| `lib/pdfToMarkdown.ts` | Page text → Markdown or plain text: headings by font size, lists, paragraphs, repeated headers/footers dropped. Also `==highlight==` marks, notes after pages (`afterPage`) and mid-page clips (`PageClip`). |
| `lib/notesText.ts` | The user's notes as blocks of extracted text. |
| `lib/pageImage.ts`, `lib/snip.ts`, `lib/zip.ts` | Render pages and regions to images, the clipboard, window screenshots (`modern-screenshot`), and a minimal ZIP writer. |
| `lib/math.ts`, `lib/noteAnchors.ts`, `lib/rehype*.ts` | Note rendering: LaTeX clean-up, highlights inside notes, heading colours, `==mark==` rendering. |
| `components/viewer/` | `PdfViewer` (virtualized pages, current page, selection bars), `PdfPage`, `AnnotationOverlay` (draw, highlight, two-click boxes), `ViewerToolbar` (tools, colours, Page tools menu), `geometry.ts`. |
| `components/ResourcePanel.tsx`, `ResourceEditor.tsx`, `NoteAnnotations.tsx`, `Markdown.tsx` | The notes column, the Markdown/KaTeX editor, and highlights or comments inside notes. |
| `components/BookmarksPanel.tsx`, `LibraryPanel.tsx`, `SearchBox.tsx`, `StatusBar.tsx` | The left column, search and the status bar. |
| `components/*Dialog.tsx` | `GetTextDialog` (get text / OCR / bookmark sections / notes), `PageOpsDialog` (page edits), `PdfToolsDialog` (extract/split/merge), `PageImagesDialog`, `PageHalvesDialog`, `HelpDialog` (generated from the shortcuts), `SettingsDialog`, `UnsavedDialog`. |
| `components/SnipOverlay.tsx`, `ui.tsx`, `index.css` | The window-screenshot overlay; shared UI (`Modal`, `Button`, `NumberInput`, `Kbd`, `KeyHint`, toasts); theme tokens and dark mode. |

### Conventions

- **Keyboard first.** The user wants almost everything doable from the keyboard, with the key shown beside every feature.
  - Add every new key to `lib/shortcuts.ts`.
  - Handlers use `matches(e, id)`, and the UI shows the key with `KeyHint` / `withKey`.
  - The global handler does nothing while typing, or while a dialog is open.
  - Regenerate the user guide's §12 tables with `npx tsx scripts/shortcut-tables.mts`.
- **Undo.** Every change must be undoable.
- **Coordinates.** Annotations and bookmark `top`s are normalized display coordinates: 0..1 from the top-left of the page as shown.
- **Style.** Comments are short and explain *why*. UI text is plain, short English.
- **Dependencies.** Pin exact versions. Keep `katex` at ~0.16.47 to match rehype-katex.
- **Avoid.** Components defined inside render functions. A controlled `<input type="number">`: use `NumberInput`. Dropdowns inside scrolling bars must use `position: fixed`.

## Progress to date

Everything below is done and verified in the browser on scratch copies.

1. Library, viewer, notes scoped to a page, a range or the whole PDF (5 kinds), reading progress, text and area highlights, Save to PDF, insert pages.
2. Delete pages (notes stay on the right page), file-edit undo, user guide.
3. LaTeX in notes: inline/display math, `\$`, `\boxed`.
4. Resizable columns; notes and resources merged into one list; cards open by default.
5. Highlights and comments inside notes; Esc closes floating bars.
6. Page-tools menu fix, clearable page-number fields (`NumberInput`), replace pages.
7. Several browser tabs kept in sync; prompt for unsaved work.
8. Easier-to-read notes: equation layout, heading and keyword colours.
9. Get text / OCR: pages or a drawn region, to Markdown or plain text, with an optional OCR text layer added to the PDF (undoable).
10. Bookmarks: read the PDF's outline, edit it, save it into the PDF.
11. PDF tools: extract, split, merge (new files), turn and move pages (undoable).
12. A keyboard shortcut for every feature, shown beside it and in the `?` help; copy a page as an image; cut a page in half.
13. Get-text keys; highlighted text marked as `==text==` in extracted text; boxes made with two clicks.
14. Save pages as pictures (PNG/JPEG, several in a .zip); ↑/↓ move between text boxes.
15. Screenshot any part of the window to the clipboard (`Q`).
16. Get text: **include my notes** (`I`), and **a bookmark's section**.
    - Keys: `Shift+E` for text, `Shift+U` for OCR, `4` in the window, `T`/`O` on a bookmark.
    - The section runs from the bookmark's heading to the next bookmark's heading, even mid-page.
17. Prices like `$100` in notes stay plain text instead of being paired into one formula. Checked with sample text and remark-math; not yet looked at in the browser.

## Change log

- **2026-10-14:** git repo created (`main`). This file was added, and HANDOFF was updated to item 24. Added `scripts/shortcut-tables.mts`, which generates the guide's shortcut tables.
- **2026-10-14: Get text, notes and bookmark sections (item 16).**
  - New: `web/src/lib/notesText.ts`.
  - Changed:
    - `lib/outline.ts`: `flattenBookmarkTree`, `bookmarkPages` and `BookmarkSection`.
    - `lib/pdfToMarkdown.ts`: the `afterPage` and `clip` options, `PageClip`, `findHeading`; pages clipped to nothing are left out.
    - `components/GetTextDialog.tsx`: the `bookmark` mode with `BookmarkPicker`, `Selection`, the `Build` options and the notes toggle.
    - `lib/shortcuts.ts`: `textSection`, `ocrSection`, `gtBookmark`, `gtNotes`, `bmText`, `bmOcr`.
    - `App.tsx`, `ViewerToolbar.tsx` and `BookmarksPanel.tsx` gained the menu items, keys and row actions.
    - The user guide (§4, §9, §12), the README and HANDOFF item 24.
  - Fixed while testing:
    - Enter in the bookmark finder no longer starts a bookmark the filter hides.
    - Headings are now found by their text first, because stored bookmark spots are often missing or wrong (Tanenbaum).
  - Verified:
    - Typecheck, 74 tests and the build pass.
    - Playwright on scratch copies of Tanenbaum:
      - 1.3 reads from its heading to just before 1.4 on p66;
      - the two notes land at the right pages;
      - PREFACE drops the empty p28;
      - the OCR of 1.2.1 starts at its heading;
      - the file is unchanged.
- **2026-10-18: prices in notes (item 17, HANDOFF 25).**
  - `web/src/lib/math.ts`: new `escapeCurrency`, run first in `normalizeMath`. A `$` before a digit is escaped unless it forms a tight `$…$` pair (Pandoc's rule).
  - User guide §5 and HANDOFF updated.
  - Verified: typecheck passes; sample cases (the user's bank-transfer note, `$5$`, `$x$`, `$$…$$`, `\(\$5\)`, tables) give the right output, and remark-math parses the fixed text as plain text.

## Open questions for the user

- Detect a PDF that was moved while open, and show a clearer error (offered on 2026-10-13, no answer yet).
