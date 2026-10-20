# StudySpace — guide for Claude

StudySpace is a local-first PDF study app: library on the left, PDF viewer in the middle, notes on the right.
It reads the user's course PDFs in place from `/home/dipra/Buet/3-1` and works fully offline.

Status as of **2026-10-20**. Work since the last commit (items 17–26) is not committed yet. Other docs:
- [HANDOFF.md](HANDOFF.md): the long version, with the detailed history of every feature and the problems already solved.
- [README.md](README.md): setup, configuration, the HTTP API and the schema.
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md): every feature, explained for the user.
- [docs/PHONE_SETUP.md](docs/PHONE_SETUP.md): the user's step-by-step phone setup (Wi-Fi and Tailscale). Keep it in step with `auth.ts` and the guide's §15.

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
npm test             # server tests (vitest): 101 passing
npm run build        # web/dist + server/dist; `npm start` serves the built app on 4317
                     # the dev server on 4317 also serves web/dist; the user works on 5173
```

Config lives in `.env`, the user's file, which is not committed. See `.env.example` for:
- the library folders and excludes, the data dir (default `~/.local/share/studyspace`) and the port;
- the history limit;
- the OCR programs and language; LibreOffice and its work dir for slides;
- the AI provider (none for now);
- phone access: `STUDYSPACE_PASSWORD`, `STUDYSPACE_ALLOWED_HOSTS` (and `STUDYSPACE_HOST=0.0.0.0` for Wi-Fi).

## ⚠️ Safety rules (always)

The user's real PDFs are in `/home/dipra/Buet/3-1`. In-app edits overwrite the original PDF on purpose, so **testing must never touch them**.

- **Never test on the user's own instance** (ports 4317/5173, real DB in `~/.local/share/studyspace`). Its server runs `tsx watch`, so a new migration runs on the real DB as soon as the code is saved.
- **Test on ports 4399/5199**, with a scratch data dir and scratch *copies* of PDFs:
  - in `server/`: `STUDYSPACE_PORT=4399 STUDYSPACE_DATA_DIR=<scratch>/data STUDYSPACE_LIBRARY_DIRS=<scratch>/lib setsid npx tsx src/index.ts`
  - in `web/`: `STUDYSPACE_PORT=4399 setsid npx vite --port 5199 --strictPort`
  - A new data dir is only seeded from the env when it is empty, so use a fresh one.
- **Make test scripts check where they are:** they must abort if `/api/library` lists anything under `/home/dipra/Buet`.
- **Phone tests** need `STUDYSPACE_HOST=0.0.0.0` on the scratch server, so give it a password and scratch data; the login cookie has the port in its name, so it never clobbers the real one.
- **Reading real PDFs is fine:** copying them, or read-only GETs to 4317.
- **Check real PDF mtimes after testing.** When one changed, check its `/api/documents/:id/history` on 4317 to confirm it was the user's own edit.
- **Kill only processes you started** (find the PID with `ss -ltnp`); never `pkill`.
- **Tools:**
  - curl isn't installed: use `node -e "fetch(…)"`. Writes need the header `X-StudySpace: 1`.
  - Browser tests use Playwright, installed in the session scratchpad (`pw/`). The user browses in **Firefox**, which Playwright can't run on this Ubuntu (26.04), so avoid browser-specific tricks like `execCommand`. The scratchpad can be wiped; reinstall with `npm i playwright@1.64.1` and `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium` (older Chromium can't run pdf.js).
  - Deleting a file sends it to the Trash: on the test server set `STUDYSPACE_TRASH_DIR=<scratch>/trash`.
  - Write text containing backticks with quoted heredocs (`<<'EOF'`).

## Codebase

npm workspaces: `server/` (API) and `web/` (UI); `scripts/` holds dev helpers. In dev, Vite proxies `/api` to the server; in production the server also serves `web/dist`.

### Server: `server/src` (Node 24, Express 5, TypeScript)

- **Database: built-in `node:sqlite`.** There is no gcc, so no native modules. WAL and foreign keys are on.
- **PDF writing: pdf-lib.** **OCR: `ocrmypdf` and `tesseract`**, both installed. **Slides: LibreOffice** (snap, `/snap/bin/libreoffice`).

| Path | What it does |
|---|---|
| `index.ts`, `config.ts` | Start-up and env config. The library folders are seeded from the env on the first run. |
| `app.ts` | Every `/api` route, in one Express app (see the README for the list). |
| `auth.ts` | Who may use it: this computer always; other devices (phone over Wi-Fi or `tailscale serve`) log in with `STUDYSPACE_PASSWORD` (session cookie). Host allowlist, `X-StudySpace` header on writes, folder routes local-only. |
| `types.ts` | Shared server types. |
| `db/index.ts` | `openDatabase`, the `transaction` helper and `runMigrations`. Migrations are transactional and recorded; it refuses a DB that is newer than the code. |
| `db/migrations.ts` | Schema v1–v8 (see the table below). Add a new version for any schema change; never edit an old one. |
| `db/*.ts` | CRUD per table: `directories`, `documents`, `resources`, `annotations`, `progress`, `noteHighlights`, `documentHighlights`, `bookmarks` (tree, cycle check, outline import), `sessions`. Create functions accept a client-supplied `id`, so undo/redo can re-create rows with the same id. |
| `library/fingerprint.ts` | Document identity: `v1:` + sha256(size + first and last 256 KiB). Moved or renamed files keep their data. |
| `library/fileKinds.ts` | Which files the library shows: PDFs, slides (`.pptx`, `.ppt`), HTML (`.html`, `.htm`) and Markdown (`.md`); `DocumentRecord.kind` comes from the extension. `isPaged` (pdf, slides), `canEditFile` (pdf). |
| `library/scanner.ts`, `library/sync.ts` | Find PDFs and slides (with excludes) and sync them into the DB. Handles moves by fingerprint, flags missing files, and resets bookmarks when another program changes a file. |
| `library/pathGuard.ts` | Every file access must resolve inside an enabled library folder. PDFs are streamed in place, with range requests. |
| `pdf/operations.ts` | pdf-lib edits: insert, copy, delete, replace, rotate and reorder pages; write/strip StudySpace annotations (`T="StudySpace"`); `writeOutline`; `composePdf`. |
| `pdf/coords.ts` | Normalized display coordinates (0..1 from the top-left) ⇄ PDF space, with `/Rotate` and CropBox; rotates rects and points. |
| `pdf/pageMap.ts` | Page renumbering after insert, delete or move, and its inverse. It keeps notes, highlights and bookmarks on the right page. |
| `services/fileWriter.ts` | Atomic writes: temp file, fsync, rename. |
| `services/documentEditor.ts` | `editFile`: every change to a PDF file. It saves the previous file to `<dataDir>/history/<docId>/`, snapshots notes, annotations and bookmarks, then remaps rows. Kinds: insert, delete, replace, ocr, save, rotate, move. `undoEdit` undoes them in reverse order. |
| `services/pdfTools.ts` | Extract, split and merge into new PDFs: written only inside library folders, never overwriting (`name (2).pdf`). Notes, highlights and bookmarks are copied along. |
| `services/ocr.ts` | OCR jobs on a temporary copy (`ocrmypdf --redo-ocr`) and region OCR (`tesseract`). The library file only changes when the user chooses *Add to PDF*. |
| `services/fileOps.ts` | Rename a library file in place; delete = move to the desktop Trash (freedesktop.org layout, `config.trashDir`) and mark the row missing, so notes stay; restore it from there. |
| `services/slides.ts` | `SlideConverter`: slides → PDF with LibreOffice (once per version, in `<dataDir>/converted/`). A snap LibreOffice works in `~/snap/libreoffice/common/studyspace`. Slides are read-only: `editFile` refuses them, and `resolveReadablePdf` gives their PDF as a source. |
| `ai/` | AI provider registry; only `none` for now. |

**Tables:**
- `directories`, `documents`, `resources` (notes of 5 kinds, scoped to a page, a range or the document), `annotations` (highlight, area, ink), `reading_progress`.
- `document_history` (file-edit undo), `note_highlights`, `bookmarks` (tree via `parent_id`, `position` REAL, `top` on the page), `schema_migrations`.
- v8: `document_highlights` (text highlights on HTML/Markdown, quote + context), `sessions` (other devices' logins, token hashes), `reading_progress.top` (how far down a document without pages).

**Tests:** `server/test/*.test.ts` (vitest), with temp dirs and generated PDFs from `helpers.ts`. OCR and slides tests use stub binaries (`ocrmypdf`/`tesseract`, `soffice`).

### Web: `web/src` (React, TypeScript, Vite, Tailwind v4, pdfjs-dist)

| Path | What it does |
|---|---|
| `main.tsx`, `App.tsx` | App state: open document, notes, annotations, bookmarks, dialogs. App also holds the global key handler, the undoable mutation handlers (`applyFileEdit` and others) and the layout (three resizable columns, mobile drawers). `main.tsx` wraps App in `AuthGate`. |
| `lib/api.ts` | Typed fetch client for every route; sends `X-StudySpace` on every request. `setMutationListener` fires after writes, which drives tab sync; `setAuthListener` on a 401 (login screen). |
| `lib/uuid.ts`, `lib/notify.ts`, `lib/touchSelection.ts` | `uuid()` (works on plain http, unlike `crypto.randomUUID`); toasts from outside App; `useTouchSelection` (phones: the selection bar opens without a mouseup). |
| `lib/types.ts` | Shared types and labels (`Resource`, `Annotation`, `Bookmark`, `RESOURCE_TYPE_LABEL`…). |
| `lib/undo.ts` | Undo/redo stack per document. Every change is undoable; file edits undo through the server history. |
| `lib/tabSync.ts` | BroadcastChannel sync between browser tabs. |
| `lib/shortcuts.ts` | **The one registry of keyboard shortcuts** (`SHORTCUTS`, `matches`, `keyOf`, `withKey`, `isTyping`, `GROUP_ORDER`). |
| `lib/fieldNav.ts` | ↓ / ↑ move between text boxes in dialogs. Opt out with `data-arrow-nav="off"`. |
| `lib/pdf.ts` | pdf.js setup, `openPdf`, `parsePageList`. |
| `lib/outline.ts` | Read the PDF outline; resolve destinations; build the bookmark tree; `currentBookmarkId`; `bookmarkPages` (a bookmark's section). |
| `lib/artifactFrame.js` | Plain JS put into an HTML document's sandboxed frame (`?raw`): selections → anchors, highlights painted with the CSS Custom Highlight API, keys and scroll sent out by `postMessage`. |
| `lib/pdfToMarkdown.ts` | Page text → Markdown or plain text: headings by font size, lists, paragraphs, repeated headers/footers dropped. Also `==highlight==` marks, notes after pages (`afterPage`) and mid-page clips (`PageClip`). |
| `lib/notesText.ts` | The user's notes as blocks of extracted text. |
| `lib/pageImage.ts`, `lib/snip.ts`, `lib/zip.ts` | Render pages and regions to images, the clipboard, window screenshots (`modern-screenshot`), and a minimal ZIP writer. |
| `lib/tableRepair.ts` | Mends tables whose rows were broken over several lines (Gemini's copy), before rendering. |
| `lib/math.ts`, `lib/noteAnchors.ts`, `lib/rehype*.ts` | Note rendering: LaTeX clean-up, money `$` escaping, highlights inside notes (a formula counts as `$tex$` in the anchor text), heading colours, `==mark==` rendering. |
| `lib/pasteClean.ts` | Cleans an AI answer pasted into a note: cut before `@@START@@`, drop `[cite: n]`. |
| `components/viewer/` | `PdfViewer` (virtualized pages, current page, selection bars), `PdfPage`, `AnnotationOverlay` (draw, highlight, two-click boxes), `ViewerToolbar` (tools, colours, Page tools menu; by `kind`), `TextDocViewer` (HTML in a sandboxed frame, Markdown rendered; text highlights), `geometry.ts`. |
| `components/ResourcePanel.tsx`, `ResourceEditor.tsx`, `NoteAnnotations.tsx`, `Markdown.tsx` | The notes column, the Markdown/KaTeX editor, and highlights or comments inside notes. |
| `components/BookmarksPanel.tsx`, `LibraryPanel.tsx`, `SearchBox.tsx`, `StatusBar.tsx` | The left column, search and the status bar. |
| `components/LoginScreen.tsx` | `AuthGate`: the password screen for other devices. |
| `components/*Dialog.tsx` | `GetTextDialog` (get text / OCR / bookmark sections / notes), `PageOpsDialog` (page edits), `PdfToolsDialog` (extract/split/merge), `PageImagesDialog`, `PageHalvesDialog`, `HelpDialog` (generated from the shortcuts), `SettingsDialog`, `UnsavedDialog`. |
| `components/SnipOverlay.tsx`, `ui.tsx`, `index.css` | The window-screenshot overlay; shared UI (`Modal`, `Button`, `NumberInput`, `Kbd`, `KeyHint`, toasts); theme tokens and dark mode. |

### Conventions

- **Keyboard first.** The user wants almost everything doable from the keyboard, with the key shown beside every feature.
  - Add every new key to `lib/shortcuts.ts`.
  - Handlers use `matches(e, id)`, and the UI shows the key with `KeyHint` / `withKey`.
  - The global handler does nothing while typing, or while a dialog is open.
  - Regenerate the user guide's §12 tables with `npx tsx scripts/shortcut-tables.mts`.
- **Undo.** Every change must be undoable.
- **Phones.** The app also runs on plain http (Wi-Fi): never call `crypto.randomUUID` (use `uuid()`), and say why copying fails (`copyText`). Anything that opens on mouseup also needs `useTouchSelection`, and hover-only buttons need `[@media(hover:none)]:flex`.
- **Kinds.** Check `isPaged` / `canEditFile`, not `kind === "slides"`: HTML and Markdown have no pages.
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
18. Pasting an AI answer into a note cuts the chat before `@@START@@` and removes `[cite: n]` tags; Ctrl+Z takes the paste back. Saving a note cleans it too. Tested in Chromium only (the user uses Firefox; Playwright has no Firefox here).
19. Bullet labels without bold (`- Superblock: …`) get the violet lead-in colour too.
20. Slides (`.pptx`, `.ppt`) show in the library and open as pages (LibreOffice converts them once; read-only). Folders holding the open file can be closed now.
21. A bullet that is only a label (`- **Deductive Learning:**`) is a rose header, and the bullets after it are indented under it.
22. PDF highlights are lighter (30%) and blend with the page, so the text under them stays readable.
23. Formulas in notes can be highlighted (whole), and old highlights now colour the formulas inside them.
24. Rename and delete files in the library (✏ / 🗑 on a row, `F2`, `Del`; delete goes to the desktop Trash; both undoable). Folders can't be renamed or deleted yet. Tested in Chromium only.
25. Use it from a phone: password login for other devices, Wi-Fi (`STUDYSPACE_HOST=0.0.0.0`) or Tailscale (`tailscale serve`), works on plain http, touch selection, phone layout fixes, home-screen icon. Tested with Chromium's iPhone profile over the LAN address; Tailscale itself not tested (not installed here). No pinch-zoom yet.
26. HTML pages (Claude artifacts) and Markdown files in the library: read, highlight, comment, quote into notes (undoable); HTML runs in a sandboxed frame. Read-only. An artifact can't use browser storage inside StudySpace. Tested in Chromium only.
27. Tables copied from Gemini (rows broken over several lines, `<br>` in cells) render as tables in notes and Markdown files; note tables scroll sideways instead of breaking words. Checked with the user's pasted answer, in Chromium.

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
- **2026-10-18: clean AI answers on paste (item 18, HANDOFF 26).**
  - New: `web/src/lib/pasteClean.ts`. Changed: `components/ResourceEditor.tsx` (`onPaste`, the "Pasted: …" line).
  - User guide §5 and HANDOFF updated.
  - Verified: typecheck passes; sample answers through `cleanPasted`; Playwright on a scratch copy (paste, the note line, undo to raw, undo, redo, saved note). Real PDFs unchanged.
  - Follow-up: the user saw no change, because 4317 serves the old `web/dist`. Rebuilt. Saving a note now cleans it as well (checked on the built app, scratch 4399).
  - Second follow-up: still broken in the user's Firefox on 5173. The paste used `execCommand("insertText")`; it now sets React state and handles Ctrl+Z itself (`onContentKey`). Verified in Chromium on scratch 4399/5199; rebuilt `web/dist`.
- **2026-10-18: plain bullet labels coloured (item 19, HANDOFF 27).**
  - `web/src/lib/rehypeNoteStructure.ts` (`PLAIN_LABEL`, `plainLabel`) and `index.css` (`span[data-lead]` bold). User guide §5 and HANDOFF updated.
  - Verified: typecheck; sample lists through the plugin; Chromium screenshot on scratch 4399/5199. Rebuilt `web/dist`.
- **2026-10-18: slides in the library, closable folders (item 20, HANDOFF 28).**
  - New: `server/src/library/fileKinds.ts`, `server/src/services/slides.ts`, `server/test/slides.test.ts`.
  - Changed: scanner (`scanForDocuments`), sync, `db/documents.ts` (`kind`), `types.ts`, `config.ts` (`slides`), `app.ts` (`/convert`, `/file`, OCR guard, browse count), `documentEditor.ts` (`resolveReadablePdf`, `SLIDES_READ_ONLY`), `pdfTools.ts` (`createPdfs(db, req, dataDir)`); web `lib/types.ts`, `lib/api.ts`, `PdfViewer.tsx`, `ViewerToolbar.tsx`, `App.tsx`, `LibraryPanel.tsx` (icon, folder fix), `SettingsDialog.tsx`.
  - Docs: README, `.env.example`, user guide §3, HANDOFF 28.
  - Verified: typecheck, 81 tests, build; Chromium on scratch 4399/5199 with a copied 70-slide deck. Real files: unchanged by testing. "Learning Theory (ERM)-1.pdf" changed at 21:39 with no StudySpace history, so it was another program, not the tests.
- **2026-10-18: bullet headers (item 21, HANDOFF 29).**
  - `web/src/lib/rehypeNoteStructure.ts` (`isGroupHeader`, `nestUnderHeaders`, `markGroupHeader`) and `index.css` (`[data-group]`). User guide §5 and HANDOFF updated.
  - Verified: typecheck; sample lists through the plugin; Chromium screenshot on scratch. Rebuilt `web/dist`.
- **2026-10-18: second heading level cyan, not yellow.** `web/src/index.css` `[data-level="2"]` is now #67e8f9, because the yellow (#fde047) looked like the user's yellow highlights in notes. User guide §5 and HANDOFF updated; rebuilt `web/dist`. Not checked in the browser (CSS colour only).
- **2026-10-19: readable highlights (item 22, HANDOFF 30).**
  - `components/viewer/AnnotationOverlay.tsx`: the multiply blend moved from each `<g>` to the `<svg>`; highlights drawn at their stored opacity. `geometry.ts` `HIGHLIGHT_OPACITY` = 0.3, used by `PdfViewer.tsx` and the area tool.
  - User guide §6 and HANDOFF updated.
  - Verified: typecheck; Chromium screenshot on scratch; rebuilt `web/dist`. "Learning Theory (ERM)-1.pdf" changed at 00:06; its history shows the user's own Save to PDF.
- **2026-10-19: formulas in note highlights (item 23, HANDOFF 31).**
  - `web/src/lib/noteAnchors.ts` (`mathToken`, `domUnits`, whole-formula boundaries), `lib/rehypeNoteHighlights.ts` (formula atoms, legacy lookup, no marks on line breaks), `components/NoteAnnotations.tsx` (`[data-hl]`), `index.css`.
  - User guide §5 and HANDOFF updated.
  - Verified: typecheck; Chromium on scratch (old and new highlights, display math, reload, click). Rebuilt `web/dist`. Real PDFs: only the user's own edits (the CSE 317 file's history: save 00:06, deletes 02:08 and 02:15).
- **2026-10-20: rename and delete files (item 24, HANDOFF 32).**
  - New: `server/src/services/fileOps.ts`, `server/test/fileops.test.ts`.
  - Changed: `config.ts` (`trashDir`), `db/documents.ts` (`renameDocumentRow`, `setDocumentMissing`, `markDocumentPresent`), `documentEditor.ts` (`withLock` exported), `app.ts` (3 routes), `test/helpers.ts`; web `lib/api.ts`, `lib/tabSync.ts`, `lib/shortcuts.ts` (`renameFile`, the "In the files list" group), `LibraryPanel.tsx`, `App.tsx` (`LIBRARY_UNDO`, `closeDocument`, undo without a PDF open).
  - Docs: user guide §3, §10, §12; README; `.env.example`; HANDOFF 32.
  - Verified: typecheck, 86 tests, build; Chromium on scratch 4399/5199 with a scratch Trash. Real PDFs unchanged.
- **2026-10-20: phone access (item 25, HANDOFF 33).**
  - New: `server/src/auth.ts`, `server/src/db/sessions.ts`, `server/test/auth.test.ts`; web `lib/uuid.ts`, `lib/notify.ts`, `lib/touchSelection.ts`, `components/LoginScreen.tsx`, `public/manifest.webmanifest`, icons.
  - Changed: `config.ts` (`password`, `allowedHosts`, `requireCsrfHeader`), `app.ts` (gate, `/config`), `index.ts` (phone address in the log), migration v8, `test/helpers.ts`; web `lib/api.ts`, `lib/tabSync.ts`, `lib/pageImage.ts` (`copyText`), `main.tsx`, `App.tsx`, `PdfViewer.tsx`, `NoteAnnotations.tsx`, `LibraryPanel.tsx`, `BookmarksPanel.tsx`, `SearchBox.tsx`, `StatusBar.tsx`, `ViewerToolbar.tsx`, `SettingsDialog.tsx`, `PdfToolsDialog.tsx`, `index.css`, `index.html`.
  - Docs: user guide §14, §15; README; `.env.example`; HANDOFF 33.
  - Verified: typecheck, tests, build; Chromium iPhone profile over `http://192.168.0.114:4399` (scratch). Real PDFs unchanged by testing.
- **2026-10-20: HTML and Markdown in the library (item 26, HANDOFF 34).**
  - New: `server/src/db/documentHighlights.ts`, `server/test/textdocs.test.ts`; web `components/viewer/TextDocViewer.tsx`, `lib/artifactFrame.js`.
  - Changed: `fileKinds.ts`, `scanner.ts`, `documentEditor.ts` (`notPagesMessage`), `app.ts` (`/file` types, `/asset`, text-highlights, progress `top`), `db/progress.ts`, `types.ts`; web `lib/types.ts` (`isPaged`, `canEditFile`, `TextHighlight`), `lib/api.ts`, `lib/noteAnchors.ts` (cached `normalise`), `lib/rehypeNoteHighlights.ts`, `Markdown.tsx` (`structure`, `assetUrl`), `NoteAnnotations.tsx` (shared popovers, keys, *Note*), `ViewerToolbar.tsx` (`kind`), `ResourcePanel.tsx`, `ResourceEditor.tsx`, `StatusBar.tsx`, `LibraryPanel.tsx`, `App.tsx`, `index.css` (`.ss-doc`).
  - Docs: user guide §3, §10, §13; README; HANDOFF 34.
  - Verified: typecheck, 101 tests, build; Chromium on scratch 4399 and 5199 with copies of the user's planner artifact and Markdown notes; iPhone profile touch selection. Real files: only the user's own Save to PDF (8086-Memory_Organization.pdf, 04:03).
- **2026-10-20: `docs/PHONE_SETUP.md`**, the phone setup steps on their own (asked for by the user), linked from the guide's §15, the README and this file. Docs only.
- **2026-10-20: Gemini tables in notes (item 27, HANDOFF 35).**
  - New: `web/src/lib/tableRepair.ts`, `web/src/lib/rehypeBreaks.ts`. Changed: `components/Markdown.tsx` (runs both), `index.css` (`.ss-md table`, cells).
  - Docs: user guide §5; HANDOFF 35. Also `docs/PHONE_SETUP.md`: a row for "Tailscale works but Wi-Fi doesn't".
  - Verified: typecheck; the user's answer rendered with react-markdown (7 rows, 6 breaks) plus cases that must not change; Chromium screenshot on scratch 4399. Rebuilt `web/dist`.

## Open questions for the user

- Detect a PDF that was moved while open, and show a clearer error (offered on 2026-10-13, no answer yet).
