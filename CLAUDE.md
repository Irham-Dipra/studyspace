# StudySpace — guide for Claude

StudySpace is a local-first PDF study app: library on the left, PDF viewer in the middle, notes on the right.
It reads the user's course PDFs in place from `/home/dipra/Buet/3-1` and works fully offline.

Status as of **2026-11-16**. Items up to 44 are committed (44: phone reading mode, installable app). The repo is meant for GitHub under the user's own name: commits carry no `Co-Authored-By: Claude` trailer (the user asked for that). Other docs:
- [HANDOFF.md](HANDOFF.md): the long version, with the detailed history of every feature and the problems already solved.
- [README.md](README.md): the GitHub landing page: features, setup on any PC, commands, configuration, data folders, troubleshooting.
- [REQUIREMENTS.md](REQUIREMENTS.md): what to install per system (winget, brew, apt, dnf, pacman) and the npm packages.
- [docs/DEVELOPER.md](docs/DEVELOPER.md): how it works, the HTTP API and the schema (moved out of the README).
- [docs/USER_GUIDE.md](docs/USER_GUIDE.md): every feature, explained for the user.
- [docs/PHONE_SETUP.md](docs/PHONE_SETUP.md): the user's step-by-step phone setup (Wi-Fi and Tailscale). Keep it in step with `auth.ts` and the guide's §15.

## 📝 Keep this file up to date (required)

After **any** work in this project, before reporting back:

1. **Progress report:** add or update the feature's line in [Progress to date](#progress-to-date). Mark anything unfinished or untested as such.
2. **Code changes:** add a dated entry to the [Change log](#change-log): what changed and in which files, and how it was verified. Update [Codebase](#codebase) when files, modules, tables or conventions are added or change.
3. Also update `HANDOFF.md` (the detailed feature item), the user guide and the README when users would notice the change; API and schema changes go in `docs/DEVELOPER.md`.
4. The project is a git repo (branch `main`). Commit only when the user asks, as the user, with no Claude co-author trailer.

## Run it

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"   # needed in every shell (Node 24 via nvm)
npm run dev          # server http://127.0.0.1:4317, UI http://localhost:5173 (server: tsx watch)
npm run typecheck    # server + web
npm test             # server tests (vitest): 115 passing
npm run build        # web/dist + server/dist; `npm start` serves the built app on 4317
                     # the dev server on 4317 also serves web/dist; the user works on 5173
npm run check        # setup checker (scripts/check-requirements.mjs): Node, packages, optional tools, ports
```

Config lives in `.env`, the user's file, which is not committed. See `.env.example` for:
- the library folders and excludes, the data dir (default `~/.local/share/studyspace`) and the port;
- the history limit;
- the OCR programs and language; LibreOffice and its work dir for slides;
- the AI provider (none for now);
- phone access: `STUDYSPACE_PASSWORD`, `STUDYSPACE_ALLOWED_HOSTS` (and `STUDYSPACE_HOST=0.0.0.0` for Wi-Fi).

## ⚠️ Safety rules (always)

The user's real PDFs are in `/home/dipra/Buet/3-1`. In-app edits overwrite the original PDF on purpose, so **testing must never touch them**.

- **Don't edit the main tree while the user reads on 5173.** Vite hot-reloads their tab on every save, and `tsx watch` restarts 4317 (running new migrations on the real DB). Work in a git worktree in the scratchpad (carry over uncommitted changes; symlink the root `node_modules` only, never `web/node_modules`, which holds Vite's cache), test from there on 4399/5199, and copy the changes back only when the user says so.
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

npm workspaces: `server/` (API) and `web/` (UI); `scripts/` holds dev helpers (`shortcut-tables.mts`; `check-requirements.mjs`, `npm run check`, plain JS with no dependencies so it runs before `npm install` and on an old Node). In dev, Vite proxies `/api` to the server; in production the server also serves `web/dist`.

### Server: `server/src` (Node 24, Express 5, TypeScript)

- **Database: built-in `node:sqlite`.** There is no gcc, so no native modules. WAL and foreign keys are on.
- **PDF writing: pdf-lib.** **OCR: `ocrmypdf` and `tesseract`**, both installed. **Slides: LibreOffice** (snap, `/snap/bin/libreoffice`).

| Path | What it does |
|---|---|
| `index.ts`, `config.ts` | Start-up and env config. The library folders are seeded from the env on the first run. Per-system defaults: data dir (Linux XDG, Windows `%LOCALAPPDATA%\StudySpace`, macOS `~/Library/Application Support/StudySpace`), Trash (Linux desktop Trash, else `<dataDir>/Trash`); `expandHome`. |
| `app.ts` | Every `/api` route, in one Express app (see the README for the list). |
| `auth.ts` | Who may use it: this computer always; other devices (phone over Wi-Fi or `tailscale serve`) log in with `STUDYSPACE_PASSWORD` (session cookie). Host allowlist, `X-StudySpace` header on writes, folder routes local-only. |
| `types.ts` | Shared server types. |
| `db/index.ts` | `openDatabase`, the `transaction` helper and `runMigrations`. Migrations are transactional and recorded; it refuses a DB that is newer than the code. |
| `db/migrations.ts` | Schema v1–v12 (v12: `documents.hidden`) (see the table below). Add a new version for any schema change; never edit an old one. |
| `db/*.ts` | CRUD per table: `directories`, `documents`, `resources`, `annotations`, `progress`, `noteHighlights`, `noteMarkers`, `documentHighlights`, `bookmarks` (tree, cycle check, outline import), `sessions`. Create functions accept a client-supplied `id`, so undo/redo can re-create rows with the same id. |
| `library/fingerprint.ts` | Document identity: `v1:` + sha256(size + first and last 256 KiB). Moved or renamed files keep their data. |
| `library/fileKinds.ts` | Which files the library shows: PDFs, slides (`.pptx`, `.ppt`), HTML (`.html`, `.htm`) and Markdown (`.md`); `DocumentRecord.kind` comes from the extension. `isPaged` (pdf, slides), `canEditFile` (pdf). |
| `library/scanner.ts`, `library/sync.ts` | Find PDFs and slides and sync them into the DB. Excludes (`isExcluded`, `parseExclude`) hide folders and files: names at any depth, paths with `/`, globs `*` `**` `?`, `re:` regexes; hidden files are marked missing, so notes stay. Handles moves by fingerprint, flags missing files, and resets bookmarks when another program changes a file. |
| `library/pathGuard.ts` | Every file access must resolve inside an enabled library folder. PDFs are streamed in place, with range requests. |
| `pdf/operations.ts` | pdf-lib edits: insert, copy, delete, replace, rotate and reorder pages; write/strip StudySpace annotations (`T="StudySpace"`; text boxes as FreeText in Helvetica, `buildTextBox`); `writeOutline`; `composePdf`. |
| `pdf/coords.ts` | Normalized display coordinates (0..1 from the top-left) ⇄ PDF space, with `/Rotate` and CropBox; rotates rects and points. |
| `pdf/pageMap.ts` | Page renumbering after insert, delete or move, and its inverse. It keeps notes, highlights and bookmarks on the right page. |
| `services/fileWriter.ts` | Atomic writes: temp file, fsync, rename. |
| `services/documentEditor.ts` | `editFile`: every change to a PDF file. It saves the previous file to `<dataDir>/history/<docId>/`, snapshots notes, annotations and bookmarks, then remaps rows. Kinds: insert, delete, replace, ocr, save, rotate, move. `undoEdit` undoes them in reverse order. |
| `services/pdfTools.ts` | Extract, split and merge into new PDFs: written only inside library folders, never overwriting (`name (2).pdf`). Notes, highlights and bookmarks are copied along. |
| `services/ocr.ts` | OCR jobs on a temporary copy (`ocrmypdf --redo-ocr`) and region OCR (`tesseract`). The library file only changes when the user chooses *Add to PDF*. |
| `services/fileOps.ts` | Rename a library file in place; delete = move to the desktop Trash (freedesktop.org layout, `config.trashDir`) and mark the row missing, so notes stay; restore it from there. |
| `services/noteImages.ts` | Pictures kept as notes: `saveNoteImage` (type from the first bytes, no SVG, ≤ 25 MB) writes `<dataDir>/images/<sha256>.<ext>`, never deleted; `noteImageFile` only accepts such names. Routes `POST /images`, `GET /images/:name`. |
| `services/slides.ts` | `SlideConverter`: slides → PDF with LibreOffice (once per version, in `<dataDir>/converted/`). A snap LibreOffice works in `~/snap/libreoffice/common/studyspace`. Slides are read-only: `editFile` refuses them, and `resolveReadablePdf` gives their PDF as a source. |
| `ai/` | AI provider registry; only `none` for now. |

**Tables:**
- `directories`, `documents`, `resources` (notes of 5 kinds, scoped to a page, a range or the document), `annotations` (highlight, area, ink, text box), `reading_progress`.
- `document_history` (file-edit undo), `note_highlights`, `bookmarks` (tree via `parent_id`, `position` REAL, `top` on the page), `schema_migrations`.
- v8: `document_highlights` (text highlights on HTML/Markdown, quote + context), `sessions` (other devices' logins, token hashes), `reading_progress.top` (how far down a document without pages).
- v9: `resources.styles` (JSON: colours picked for single headings, labels or marks of a note; key from `rehypeNoteStyles`).
- v10: `annotations.kind` also `'text'` (text boxes: `rects[0]` the box, `stroke_width` the font size as a share of the page width; table rebuilt); `resources.marker_x` / `marker_y` (a note's marker; replaced by v11).
- v11: `note_markers` (markers on pages that open a note at a passage: `page`, `x`, `y`, `quote` / `prefix` / `suffix`; several per note); v10's marker columns moved in and dropped.

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
| `lib/notesZip.ts` | A file's notes as one `.md` per note in a `.zip` (`notesZip`, `noteMarkdown`): `Shift+N`, the notes panel's ⬇, and *Notes* in the `Shift+F` window. |
| `lib/pageImage.ts`, `lib/snip.ts`, `lib/zip.ts` | Render pages and regions to images, the clipboard, window screenshots (`modern-screenshot`), and a minimal ZIP writer. |
| `lib/pictures.ts` | Pages as pictures (one image, or a .zip): `makePictures`, the remembered format and sharpness. Used by `PageImagesDialog` and `SelectedFilesDialog`. |
| `lib/tableRepair.ts` | Mends tables whose rows were broken over several lines (Gemini's copy), before rendering. |
| `lib/math.ts`, `lib/noteAnchors.ts`, `lib/rehype*.ts` | Note rendering: LaTeX clean-up, money `$` escaping, bare formulas wrapped in `$` (`wrapBareLatex`), highlights inside notes (a formula counts as `$tex$` in the anchor text; `anchorToRange` finds a passage again, for markers), heading colours, `==mark==` rendering. |
| `lib/notePictures.ts` | What counts as a picture: a note whose whole content is `![](/api/images/<hash>.<ext>)` (`pictureSrc`, `isPicture`, `picturesOnPage`, `sortPictures`). App keeps them out of the notes list. |
| `lib/pasteClean.ts` | Cleans an AI answer pasted into a note: cut before `@@START@@`, drop `[cite: n]`. |
| `lib/noteColors.ts` | The notes' default highlighter colours (title, headings, bullet labels, `==marks==`): `NOTE_COLORS`, saved per browser in `localStorage` and applied as `--ss-note-*` variables on `<html>`; edited in Settings. `STYLE_COLORS`: the recolour menu's swatches. |
| `lib/rehypeNoteStyles.ts` | Keys every default-coloured element of a note (`data-sk` = kind + text + `#n`) and applies the colour picked for it (`resources.styles`, `--hl`). Clicking one opens the `style` popover in `NoteAnnotations`. |
| `components/viewer/` | `PdfViewer` (virtualized pages, current page, selection bars), `PdfPage`, `AnnotationOverlay` (draw, highlight, two-click boxes), `TextBoxes` (text boxes: type, edit, move; HTML layer), `NoteMarkers` (note markers: open, drag, place), `ViewerToolbar` (tools, colours, Page tools menu; by `kind`), `TextDocViewer` (HTML in a sandboxed frame, Markdown rendered; text highlights), `geometry.ts`. |
| `components/ResourcePanel.tsx`, `ResourceEditor.tsx`, `NoteAnnotations.tsx`, `Markdown.tsx` | The notes column, the Markdown/KaTeX editor, and highlights or comments inside notes. |
| `components/BookmarksPanel.tsx`, `LibraryPanel.tsx`, `SearchBox.tsx`, `StatusBar.tsx` | The left column (the files list also selects files: box, Shift+click, Space; a library folder's own files sit under a closable *Files in …* row), search and the status bar. |
| `components/LoginScreen.tsx` | `AuthGate`: the password screen for other devices. |
| `components/*Dialog.tsx` | `GetTextDialog` (get text / OCR / bookmark sections / notes), `PageOpsDialog` (page edits), `PdfToolsDialog` (extract/split/merge), `PageImagesDialog`, `PageHalvesDialog`, `SelectedFilesDialog` (pictures / text / notes of each selected file, queued; `Shift+F`), `HelpDialog` (generated from the shortcuts), `SettingsDialog` (folders, note colours), `UnsavedDialog`. |
| `components/PicturePanel.tsx`, `PicturePagesDialog.tsx` | The Pictures section: slides over the whole notes column (`D`; the notes stay mounted underneath), and the *Pages of this picture* window (`J`). |
| `components/SidePane.tsx` | Side by side: `SidePane` (a read-only `PdfViewer` with its own page, zoom and bar), `OpenBesideDialog` (the picker), `loadSide` / `saveSide` (`localStorage` `ss-side`). App keeps the state (`side`, `swapSides`). |
| `components/PhoneMenu.tsx`, `lib/fullscreen.ts` | Phones (`PHONE` query in App): no bars; the ☰ button and its sheet, which holds the same `StatusBar` and `ViewerToolbar` elements (kept mounted while closed). `toggleLandscape`: full screen + orientation lock (`Shift+J`). |
| `components/SnipOverlay.tsx`, `ui.tsx`, `index.css` | The window-screenshot overlay; shared UI (`Modal`, `Button`, `NumberInput`, `Kbd`, `KeyHint`, toasts); theme tokens and dark mode. |

### Conventions

- **Keyboard first.** The user wants almost everything doable from the keyboard, with the key shown beside every feature.
  - Add every new key to `lib/shortcuts.ts`.
  - Handlers use `matches(e, id)`, and the UI shows the key with `KeyHint` / `withKey`.
  - The global handler does nothing while typing, or while a dialog is open.
  - Regenerate the user guide's §12 tables with `npx tsx scripts/shortcut-tables.mts`.
- **Undo.** Every change must be undoable.
- **Phones.** The app also runs on plain http (Wi-Fi): never call `crypto.randomUUID` (use `uuid()`), and say why copying fails (`copyText`). Anything that opens on mouseup also needs `useTouchSelection`, and hover-only buttons need `[@media(hover:none)]:flex`.
- **Phone layout.** `isPhone` (touch and narrow one way) is separate from `isDesktop` (≥ 1024px). On a phone the bars exist only inside `PhoneMenu`, so a new bar button is reachable there automatically, but anything put in the header must also be added to the menu. Nothing with `transform` or `backdrop-blur` around the toolbar (its menu is `position: fixed`).
- **Kinds.** Check `isPaged` / `canEditFile`, not `kind === "slides"`: HTML and Markdown have no pages.
- **Other systems.** It must also run on Windows and macOS. Use `os.homedir()` (Windows has no `HOME`) and `path.delimiter`; `relPath` always uses `/`, but absolute `doc.path` may use `\`. Programs are found as `name.exe` on Windows (`execFile` can't run `.cmd`). Tests with `#!` stub programs use `describe.skipIf(process.platform === "win32")`. Only Linux is tested here; a fresh clone on Node 24 and 26 is the check (see the 2026-11-08 change log).
- **Coordinates.** Annotations and bookmark `top`s are normalized display coordinates: 0..1 from the top-left of the page as shown.
- **Note colours.** The default note colours live in `index.css` as `--ss-note-*` on `:root`; a new kind needs a variable there and an entry in `NOTE_COLORS`.
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
27. Tables copied from Gemini (rows broken over several lines, `<br>` in cells, or each cell on its own line) render as tables in notes and Markdown files; note tables scroll sideways instead of breaking words. Checked with the user's pasted answers, in Chromium.
29. Click a heading, bullet label or `==mark==` in a note to recolour just that one (menu like the highlight bar, keys 1–9 / 0 / Del; right-click the note title). Saved with the note (v9 `resources.styles`), undoable. Tested in Chromium only.
30. Formulas pasted without `$` (a Gemini answer copied by selection: `n^{\text{th}}`, `X \sim \text{Bern}(p)`) render as math. Display equations are lost in such a copy and can't be recovered. Checked by rendering the user's text (no KaTeX errors); not yet looked at in the browser.
31. Select several files in the library (box, Shift+click, Space, Ctrl+A) and press `Shift+F`: one window lists them, each with *Pictures* (whole file, .zip), *Text* (.md / .txt) and *Notes* (item 32); clicks queue up and download one at a time. Pictures and text only for files with pages. Tested in Chromium only.
32. Download a file's notes as a .zip of Markdown files, one per note (`Shift+N`, or ⬇ in the notes panel); for several files, *Notes* (`N`) in the `Shift+F` window. Works for HTML and Markdown files too. Tested in Chromium only.
33. Two PDFs side by side: `\` (or the library row's two-columns button / `Shift+Enter`) shows a PDF beside the open one, with its own page (`Shift+←/→`) and zoom; read-only (saved highlights, copy text); `Shift+X` swaps the two; `|` closes; remembered after a reload; stacked on phones. Tested in Chromium only.
34. Text boxes typed on a page (`Y`: click or drag a width, type; edit, move, recolour, resize; saved into the PDF as FreeText in Helvetica, Latin letters only there) and note markers (`K`: click a spot, write the note; clicking the marker opens and outlines the note; drag to move). All undoable. Tested in Chromium only; phones not tested.
35. A marker can open a note at a passage: select text in a note → *Pin on page* (`K`) → click the page; clicking the marker scrolls the note to that passage and lights it up. Several markers per note; right-click removes one (undoable). Tested in Chromium only.
36. Pictures as notes: `U` (or *Picture* under the notes) picks files; `Ctrl+V` pastes a copied picture outside a text box; drop a picture on the notes panel; pasting into a note's text puts the picture at the cursor. A picture note is a normal note whose content is `![](/api/images/<hash>.<ext>)` (no schema change); click it to open full size; `Shift+N` zips the pictures too. Tested in Chromium only; phones and Firefox not tested. Get text's *include my notes* still writes the picture link as is.
39. Back / forward through jumps: `Alt+←` / `Backspace` goes back to the exact spot you jumped from (link, bookmark, note's page label, marker, typed page number, Home/End, search result), `Alt+→` / `Shift+Backspace` forward again; ↶ *p. N* / ↷ buttons in the status bar. Page turns aren't jumps; a quick scroll over 3+ pages is (2026-10-28). History lives in `PdfViewer` (50 places per open file). PDFs and slides only. Tested in Chromium only; Firefox (where `Alt+←` is also the browser's Back) and phones not tested. Copied into the main tree on 2026-10-28; the scroll rule copied on 2026-10-28 too.
38. A Pictures section of its own: `D` (or *Pictures* under the notes) swaps the notes column for slides, just the picture over the whole column (controls only on hover); `U` / `Ctrl+V` / drop add one for the page; `Ctrl+←/→` step; `J` sets its pages (one, a range, the whole PDF) or removes it; a reminder chip on the PDF when the page has a picture. No schema change: a picture is a note whose content is only the picture link, so old picture notes moved there by themselves. Made in a worktree; copied into the main tree on 2026-10-27. Tested in Chromium only (and its iPhone profile); Firefox and real phones not tested.
37. The notes panel has two tabs, *On this page* (page and range notes) and *Whole PDF*, each grouped by kind; *Open all* / *Close all* under the tabs (notes open by default) and an *Index* of numbered chips (2+ notes) that opens and scrolls to a note. Tested in Chromium only; phones and Firefox not tested.
40. Settings → *Hide folders and files* hides files too: names at any depth (`*.md`), paths from the library folder (`CSE 301/*.md`, `**`), only the top (`/*.html`), regexes (`re:…`); hidden files keep their notes. The files lying in a library folder itself sit under one closable row, *Files in <label>*. Made in a worktree; copied into the main tree on 2026-11-01. Tested in Chromium only.
41. Hide chosen files: `H` on a file, or select files and press *Hide*; the crossed-eye count at the top of the list (or `Shift+K`) opens the hidden files to unhide them. Migration v12 (`documents.hidden`). Made in the main tree (2026-11-01). Tested in Chromium only.
42. Hide folders from the sidebar: hover button or `H` on a folder; listed in *Hidden files and folders* (`Shift+K`) to unhide. A rule `/<path>` in the library folder's excludes; no schema change. Chromium only.
43. Runs on any PC, ready for GitHub: Windows and macOS fixes (data and Trash folders per system, home folder, LibreOffice found in its install folder, install hints per system, Windows-safe file names and writes), `npm run check` (setup checker), a new README (GitHub landing page, step-by-step setup on another PC, moving notes), `REQUIREMENTS.md` (install commands per system, the npm packages), `docs/DEVELOPER.md` (API and schema moved there), `.gitattributes`, `.nvmrc`. Tested on Linux only: fresh clone with `npm ci` on Node 24 and 26 (tests, build, dev and built servers, moving notes to a new folder). **Not tested on Windows or macOS.**
44. Phone reading mode: on a phone the title bar, tools bar and status bar are gone and a ☰ button in the corner opens everything; pages fit the screen width and refit when the phone is turned (a 16:9 page fills the sideways screen); pinch zoom, double tap to fit; ☰ → *Sideways* (`Shift+J`) goes full screen and locks landscape; the phone's zoom isn't saved over the computer's. Small see-through quick tool buttons stay on the page under ☰ (*Select* and *Area* at first; chosen at the bottom of the ☰ menu, `ss-phone-pins`). Installable as a full-screen app from Chrome (manifest). Tested in Chromium's phone profile only. **Not tested on the real phone** (install, orientation lock, pinch feel).
28. Change the notes' default highlighter colours (title, heading levels, bullet header and label, `==marks==`) in Settings → Note colours; per browser, reset per colour or all. Tested in Chromium only.

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
- **2026-10-21:** committed items 17–27 (`201f684`).
- **2026-10-21: note colours (item 28, HANDOFF 36).**
  - New: `web/src/lib/noteColors.ts`. Changed: `index.css` (`--ss-note-*` variables), `main.tsx` (`installNoteColors`), `components/SettingsDialog.tsx` (`NoteColorsSection`, `ColorRow`, `Sample`), `lib/shortcuts.ts` (`,` label).
  - Docs: user guide §3, §5, §12; HANDOFF 36.
  - Verified: typecheck; build (rebuilt `web/dist`); Chromium on scratch 4399/5199 with a seeded note: live recolour, kept after reload, *Reset all* followed by a second tab. Real PDFs untouched by testing (the CSE 313/317 changes at 00:47 and 02:32 are the user's own, in their history).
- **2026-10-21: recolour one element in a note (item 29, HANDOFF 37).** The user meant per-element colours, not (only) Settings.
  - New: `web/src/lib/rehypeNoteStyles.ts`. Server: migration v9, `types.ts`, `db/resources.ts`, `app.ts` (`styles`), `pdfTools.ts`, `test/resources.test.ts`. Web: `lib/types.ts`, `lib/api.ts`, `lib/noteColors.ts` (`STYLE_COLORS`), `lib/shortcuts.ts` (`styleColour`, `styleNone`, `styleDefault`), `Markdown.tsx` (`styles`), `NoteAnnotations.tsx` (`style` popover, `StyleMenu`, `CustomColor`), `ResourcePanel.tsx` (title right-click, `onSetNoteStyle`), `App.tsx` (`setNoteStyle`, `resourceFields`), `index.css` (`.ss-pdf-hl` own `--hl`).
  - Docs: user guide §5, §12; README (schema, API); HANDOFF 37.
  - Verified: typecheck; 102 tests; build; Chromium on scratch 4399/5199 (see HANDOFF 37). Migration v9 is additive; the user's server picked it up on save and still answers. Real PDFs: only the user's own Save to PDF (PAC - 2 - pdf.pdf, 02:56, in its history).
- **2026-10-22: formulas without `$` (item 30, HANDOFF 38).**
  - `web/src/lib/math.ts`: new `wrapBareLatex` (with `texTokens`, `texKind`, `trimFormula`), run in `convertText` after `escapeCurrency`.
  - Docs: user guide §5 (replaces "commands without delimiters are plain text"); HANDOFF 38.
  - Verified: typecheck; the user's pasted text through `wrapBareLatex` and `Markdown` (`renderToStaticMarkup`): 32 formulas, 0 KaTeX errors, prose and edge cases unchanged; build (rebuilt `web/dist`). No servers started; real PDFs not touched.
- **2026-10-23: Gemini tables with a cell per line (item 27, HANDOFF 35 follow-up).**
  - `web/src/lib/tableRepair.ts`: `closingLine` gets the column count (`columns`) and the row's pipes so far; a `|` line after a blank line continues the row while it fits the columns. `pipes` ignores pipes inside `$…$`.
  - Docs: user guide §5; HANDOFF 35.
  - Verified: typecheck; the user's note through `Markdown` (6 rows × 3 cells, no stray pipes); the older shape and well-formed tables unchanged; build (rebuilt `web/dist`); Chromium on scratch 4399. Real PDFs not touched by testing (the CSE 315 changes at 01:11–01:13 came before this session and have no StudySpace history).

- **2026-10-23: pictures and text of several files (item 31, HANDOFF 39).**
  - New: `web/src/lib/pictures.ts` (moved from `PageImagesDialog`), `web/src/components/SelectedFilesDialog.tsx`.
  - Changed: `components/LibraryPanel.tsx` (selection, checkbox, bottom bar, list keys), `components/PageImagesDialog.tsx` (uses `lib/pictures.ts`), `App.tsx` (`selectedFiles`, `selectedOpen`, `openSelected`, `Shift+F`), `lib/shortcuts.ts` (`selectedFiles`, `fileSelect`, `fileSelectMove`, `fileSelectRange`, `fileSelectAll`, `fileUnselect`, group "In the selected-files window", `" "` shown as Space).
  - Docs: user guide §3, §4, §12 (regenerated); HANDOFF 39.
  - Fixed while testing: the window now takes the focus, so ↓ / Esc / Del no longer reach the files list behind it.
  - Verified: typecheck, 102 tests, build (rebuilt `web/dist`); Chromium on scratch 4399/5199 (selection keys and clicks, 4 queued downloads checked on disk, cancel, phone layout, `Shift+S` unchanged). Real PDFs not touched by testing: `CSE 309 …/Compiler_CodeGen_RegAlloc_Opt_Revision_Notes.pdf` changed at 21:42, same size and time as the LaTeX `build/main.pdf` beside it, with no StudySpace history.
- **2026-10-23:** committed item 30, the table fix and item 31 (`0ef3e7d`).
- **2026-10-23: download notes as Markdown files (item 32, HANDOFF 40).**
  - New: `web/src/lib/notesZip.ts`.
  - Changed: `App.tsx` (`downloadNotes`, `Shift+N`, unpaged files kept in `selectedDocs`), `components/ResourcePanel.tsx` (⬇ in the header, `onDownloadNotes`), `components/SelectedFilesDialog.tsx` (*Notes* button and job, `WHATS`, pictures/text off for unpaged files, "1 page"), `components/LibraryPanel.tsx` (any file selectable, *Download…*), `lib/shortcuts.ts` (`downloadNotes`, `sfNoteFiles`).
  - Docs: user guide §3, §4, §5, §12 (regenerated); README; HANDOFF 40.
  - Verified: typecheck, 102 tests, build (rebuilt `web/dist`); Chromium on scratch 4399/5199 with seeded notes (zip contents and names checked on disk, Bengali title, toast without notes, Markdown row in the Shift+F window); the item 31 test still passes. Real PDFs unchanged during testing.
- **2026-10-23: two PDFs side by side (item 33, HANDOFF 41).**
  - New: `web/src/components/SidePane.tsx`.
  - Changed: `components/viewer/PdfViewer.tsx` (`readOnly`), `App.tsx` (`side`, `openBeside`, `swapSides`, keys, split layout with `ResizeHandle`), `components/LibraryPanel.tsx` (row button, `Shift+Enter`), `lib/shortcuts.ts` (group "Side by side": `sideOpen`, `sideClose`, `sideSwap`, `sideNext`, `sidePrev`; `fileBeside`), `scripts/shortcut-tables.mts` (escapes `|`).
  - Docs: user guide §3, §4 (*Two PDFs side by side*), §12 (regenerated); README; HANDOFF 41 (and a note in "Problems already solved").
  - Fixed while testing: a non-stable `onLoaded` reloaded the PDF beside on every page turn.
  - Verified: typecheck, 102 tests, build (rebuilt `web/dist`); Chromium on scratch 4399/5199 (open, keys, copy-only bar, swap incl. the unsaved prompt, reload, files-list key, close, phone layout). Real PDFs not touched by testing (`CSE 301 …/HT_Probability_Revision_Notes.pdf` changed at 22:47, same size and time as the LaTeX `build/main.pdf` beside it, not a StudySpace edit).
- **2026-10-24: text boxes and note markers (item 34, HANDOFF 42).**
  - New: `web/src/components/viewer/TextBoxes.tsx`, `web/src/components/viewer/NoteMarkers.tsx`.
  - Server: migration v10; `types.ts` (`"text"` kind, `Resource.marker`); `db/annotations.ts` (update `rects`, `strokeWidth`); `db/resources.ts` (`marker`); `app.ts` (schemas); `pdf/operations.ts` (`buildTextBox`, `wrapText`); `pdf/coords.ts` (`displayHeight`); `services/documentEditor.ts` (`rotateMarkers`, rotate-undo restores markers); `services/pdfTools.ts` (copies markers); tests in `migrations`, `resources`, `editing`, `pdftools`.
  - Web: `lib/types.ts`, `lib/api.ts` (`AnnotationPatch`, `marker`), `lib/shortcuts.ts` (`text`, `marker`, `selEditText`), `viewer/geometry.ts` (tools, `TEXT_*`), `PdfPage.tsx`, `PdfViewer.tsx` (text box menu, markers), `ViewerToolbar.tsx` (tools, sizes), `ResourceEditor.tsx` (marker), `ResourcePanel.tsx` (`focusRequest`, 📍), `App.tsx` (`textColor`, `textSize`, general `updateAnnotation`, markers, `setNoteMarker`), `GetTextDialog.tsx` / `SelectedFilesDialog.tsx` (highlight kinds only).
  - Docs: user guide §5 (*Note markers*), §6 (*Text boxes*), §7, §12 (regenerated); README; HANDOFF 42.
  - Verified: typecheck, 106 tests, build (rebuilt `web/dist`); Chromium on scratch 4399/5199 (see HANDOFF 42) and `pdftoppm` of the saved copy. Migration v10 ran on the user's real DB (their `tsx watch` server); checked read-only: v10, 482 annotations kept. Real PDFs not touched by testing (only the LaTeX-built `HT_Probability_Revision_Notes.pdf`, 23:49 on 10-23).
- **2026-10-24: markers at a passage of a note (item 35, HANDOFF 43).** Made in a worktree (the user reads on 5173).
  - Server: migration v11 (`note_markers`, v10 columns moved and dropped); new `db/noteMarkers.ts`; `types.ts` (`NoteMarker`, `Resource.marker` removed); `db/resources.ts` (marker code out); `app.ts` (marker routes); `services/documentEditor.ts` (markers remapped with pages, snapshot/undo, `insertRow` skips dropped columns); `services/pdfTools.ts`; tests in `migrations`, `resources`, `pdftools`.
  - Web: `lib/types.ts`, `lib/api.ts` (`NoteMarkerInput`, marker calls), `lib/noteAnchors.ts` (`anchorToRange`), `lib/shortcuts.ts` (`notePin`, `markerDelete`), `NoteAnnotations.tsx` (*Pin on page*), `ResourcePanel.tsx` (`reveal`, passage light-up, 📍 cycling), `ResourceEditor.tsx`, `viewer/NoteMarkers.tsx` (`PageMarker`, remove), `PdfPage.tsx`, `PdfViewer.tsx`, `App.tsx` (`noteMarkers`, pin flow), `index.css` (`.ss-passage`).
  - Docs: user guide §5 (*Note markers* rewritten), §12 (regenerated); README; HANDOFF 43; memory note on leaving 5173 alone.
  - Fixed while testing: the passage light-up sometimes ran before the reopened card had rendered its text; now a layout effect waits for it.
  - Verified: typecheck, 107 tests, build; Chromium on scratch 4399/5199 from the worktree (see HANDOFF 43). The user's tree and servers were not touched while working.
- **2026-10-25: area highlight corners by right-click (item 33 follow-up).** The user got stray boxes from single-click corners. Made in a worktree (the user reads on 5173).
  - `web/src/components/viewer/AnnotationOverlay.tsx` (`onContextMenu` sets both corners; a left click makes no box); labels in `lib/shortcuts.ts` (`area`, `ocr`) and `ViewerToolbar.tsx`. Same for the OCR-region tool.
  - Docs: user guide §4, §6, §12; README; HANDOFF.
  - Verified: typecheck; Chromium on scratch 4399/5199: left clicks make nothing, right+right makes a box, right then left or Esc cancels, drag still works, OCR region opens its window, no native menu. Real PDFs only copied, never written. Not tested on a real touchpad or Firefox.

- **2026-10-25: hide the title bar and tools bar.** `web/src/App.tsx` (`barsHidden`, persisted as `ss-bars-hidden`; the header and `ViewerToolbar` are not rendered; floating restore button in `main`; title-bar button), `lib/shortcuts.ts` (`hideBars`, `Shift+V`). Docs: user guide §2, §12; README. Verified: typecheck; Chromium on scratch 4399/5199 (key, both buttons, kept after reload, tool keys still work, screenshot). Not tested on a phone or in Firefox.
  - **Fix, same day:** tool keys, colours 1–9, `Esc` and `T` live in `ViewerToolbar`, so not rendering it killed them. It now stays mounted, collapsed to zero height (`hidden` prop); the `T` menu still opens. Verified in Chromium on scratch: `A`, `P`, `Esc`, `T`, `L` with the bars hidden.

- **2026-10-25: text box colour, size and width while typing.** `web/src/components/viewer/TextBoxes.tsx` (bar over the box being edited: colours, smaller/larger text by ~15% a step, right-edge width handle; `commit` saves only what changed), `lib/shortcuts.ts` (`textBigger` `Ctrl+]`, `textSmaller` `Ctrl+[`, `textColour` `Ctrl+Shift+1–5`; `Alt+digit` avoided: Firefox tab keys). Docs: user guide §6, §12. Verified: typecheck; Chromium on scratch 4399/5199 (create with colour/size/width, edit again by keys, saved values via the API, Ctrl+Z restores). The typeface is still Helvetica only (a font choice would need a schema change). Not tested in Firefox or on a phone.

- **2026-10-27: pictures as notes (item 36, HANDOFF 44).** Made in a worktree in the scratchpad (the user reads on 5173).
  - New: `server/src/services/noteImages.ts`, `server/test/noteimages.test.ts`.
  - Server: `app.ts` (`POST /images`, `GET /images/:name`). Web: `lib/api.ts` (`uploadImage`), `lib/shortcuts.ts` (`addPicture` `U`, `pastePicture` `Ctrl+V`), `App.tsx` (`addPicture`, file input, window paste), `ResourcePanel.tsx` (*Picture* button, drop, `firstLine`), `ResourceEditor.tsx` (paste a picture), `Markdown.tsx` (link to full size), `lib/notesZip.ts` (`fetchNoteImages`, `images/` folder), `SelectedFilesDialog.tsx`, `index.css`.
  - Docs: user guide §5 (*Pictures as notes*), §12 (regenerated), §13; README (API); HANDOFF 44.
  - Verified: typecheck, 111 tests; Chromium on scratch 4399/5199 (key, paste, drop, editor paste, undo/redo, reload, zip). Real PDFs only copied. Not tested in Firefox or on a phone. Copied into the main tree the same day.

- **2026-10-27: whole-PDF notes in their own tab; open/close all; index (item 37, HANDOFF 45).** Made in a worktree (the user reads on 5173).
  - `web/src/components/ResourcePanel.tsx`: tabs (`tab`, `activeTab`, `pageItems`, `wholeItems`), *Open all* / *Close all* (`setAllOpen`), the index (`ordered`, `jumpTo`, `noteName`), `seenIds`. Fixed: `scrollIntoView()` returns a promise in new Chromium and was returned from a layout effect ("destroy is not a function").
  - Docs: user guide §5; HANDOFF 45.
  - Verified: typecheck; Chromium on scratch 4399/5199 from the worktree (tabs, counts, open/close all, `C`, index jump, adding on the Whole PDF tab, page 2). Not tested in Firefox or on a phone.

- **2026-10-27: Pictures section (item 38, HANDOFF 46).** Made in a worktree in the scratchpad (the user reads on 5173); copied into the main tree the same day.
  - New: `web/src/lib/notePictures.ts`, `web/src/components/PicturePanel.tsx`, `web/src/components/PicturePagesDialog.tsx`.
  - Changed: `App.tsx` (`pictureList` / `noteList`, `slidesOpen`, `slideIndex`, `slideWhere`, `addPicture` with a client id, `createResource(input, { quiet })`, `rightContent`, reminder chip, keys), `components/ResourcePanel.tsx` (*Pictures* button with the count replaces *Picture*; `pictureCount`, `onOpenPictures`), `lib/shortcuts.ts` (groups "Pictures" and "In the picture pages window": `viewPictures` `D`, `pictureNext/Prev`, `pictureWhere` `J`, `pw*`; `addPicture` / `pastePicture` moved there).
  - Docs: user guide §2, §5 (*Pictures*, replaces *Pictures as notes*), §12 (regenerated); README (API); HANDOFF 46.
  - Verified: typecheck; Chromium on scratch 4399/5199 from the worktree (add by file, paste, drop, stepping, pages window, reminder, remove and undo, draft kept, iPhone profile). Real PDFs only copied.

- **2026-10-27: Back / forward through jumps (item 39, HANDOFF 47).** Made in a worktree (the user reads on 5173); copied into the main tree on 2026-10-28.
  - `web/src/components/viewer/PdfViewer.tsx` (`history`, `scrollToSpot`, `hereSpot`, `goBack`, `goForward`, `onHistoryChange`), `TextDocViewer.tsx` (no-ops), `components/StatusBar.tsx` (↶ / ↷), `App.tsx` (`navHistory`, keys, `PAGED_ONLY`), `lib/shortcuts.ts` (`historyBack`, `historyForward`).
  - Docs: user guide §4 (*Going back*), §12 (regenerated); HANDOFF 47.
  - Verified: typecheck; Chromium on scratch 4399/5199 (worktree): jumps recorded, page turns not, exact scroll restore, forward, Backspace, chain from Home/End.

- **2026-10-28: Back also for fast scrolling (item 39 follow-up).** The user said Back/Forward "don't work": they scroll by hand, which wasn't recorded. Made in a worktree (the user reads on 5173); copied into the main tree the same day.
  - `web/src/components/viewer/PdfViewer.tsx` (`remember`, `burst`, `jumpedAt`, a `scroll` listener). Docs: user guide §4, HANDOFF 47.
  - Verified: typecheck; Chromium on scratch 4399/5199 from the worktree: slow reading over 18 pages records nothing; a fast scroll shows ↶ *p. 23*, Backspace returns to page 23, Shift+Backspace forward; a typed jump is recorded once. Not tested in Firefox or on a phone.

- **2026-11-01: hide files; root files under one row (item 40, HANDOFF 48).** Made in a worktree in the scratchpad (the user reads on 5173); copied into the main tree the same day.
  - Server: `library/scanner.ts` (`parseExclude`, `excludeError`, `isExcluded` for files and globs/regexes, files checked in the scan), `app.ts` (`excludeList` validation), `services/fileOps.ts` (rename refuses a hidden name), `services/pdfTools.ts` (new PDFs too); `test/discovery.test.ts` (3 new).
  - Web: `components/SettingsDialog.tsx` (*Hide folders and files*, `HideHelp`, Enter saves, hidden count), `components/LibraryPanel.tsx` (`looseKey`, `folderRow`, `renderRoot`; `folderKeys` for root files).
  - Docs: user guide §3; README (`STUDYSPACE_EXCLUDES`); HANDOFF 48.
  - Verified: typecheck, 114 tests, build; Chromium on scratch 4399/5199 from the worktree. Real PDFs only copied (mtimes unchanged).

- **2026-11-01: hide chosen files (item 41, HANDOFF 49).** Worked directly in the main tree at the user's request.
  - Server: migration v12, `db/documents.ts` (`setDocumentsHidden`), `app.ts` (`POST /library/hidden`, search skips hidden), `types.ts`; `test/fileops.test.ts`.
  - Web: new `components/HiddenFilesDialog.tsx`; `App.tsx` (`setFilesHidden`, `shownDocuments`), `LibraryPanel.tsx`, `lib/api.ts`, `lib/tabSync.ts`, `lib/types.ts`, `lib/shortcuts.ts` (`hiddenFiles`, `fileHide`, `hf*`).
  - Docs: user guide §3, §12 (regenerated); HANDOFF 49.
  - Verified: typecheck, 115 tests; Chromium on scratch 4399/5199. Real PDFs untouched.

- **2026-11-01: hide folders (item 42, HANDOFF 50).** Main tree. `lib/types.ts` (`folderRule`, `hiddenFolderRules`), `App.tsx` (`setFolderHidden`, `hiddenFolders`), `LibraryPanel.tsx` (folder button, `H`, `onHideFolder`), `HiddenFilesDialog.tsx` (folders section). Docs: user guide §3, HANDOFF 50. Verified: typecheck; Chromium on scratch 4399/5199.

- **2026-11-08: any PC, GitHub-ready (item 43, HANDOFF 51).** Made in a worktree (branch `publish`) while the user read on 5173. Commit messages rewritten to drop the `Co-Authored-By: Claude` trailers, at the user's request ("the contributor should be me").
  - Server: `config.ts` (per-system `defaultDataDir`, `defaultTrashDir(dataDir)`, `expandHome` exported, `~\`), `app.ts` (`os.homedir()` instead of `$HOME` in `/directories` and `/fs/browse`), `services/slides.ts` (`installedSoffice`, `.exe` on the PATH, `LIBREOFFICE_HINT` per system), `services/ocr.ts` (`INSTALL_COMMAND`, `installCommand` in the status), `services/fileOps.ts` (Windows-invalid name characters), `services/fileWriter.ts` (`renameRetrying` on Windows); `test/ocr.test.ts`, `test/slides.test.ts` skipped on Windows.
  - Web: `GetTextDialog.tsx` (install note from the server's `installCommand` / `installHint`), `lib/api.ts`, `PdfToolsDialog.tsx` (`docDir` with `\`), `SettingsDialog.tsx` (placeholder).
  - New: `scripts/check-requirements.mjs` (`npm run check`), `REQUIREMENTS.md`, `docs/DEVELOPER.md`, `.gitattributes`, `.nvmrc`. Changed: `README.md` (rewritten), `.env.example`, `.gitignore`, `package.json` / `package-lock.json` (`check`, engines `>=24`), user guide §1, §3, §9, §13.
  - Verified: typecheck, 115 tests; fresh clone + `npm ci` on Node 26.13.0 (check, tests, typecheck, build); a smoke script on 4399 against the clone's built server on Node 24 and 26 (seeding, UI served, range requests, home folder, OCR status, PDFs moved to a new folder keep id and notes, old folder removed); `npm run dev -w server` + Vite on 4399/5199. `npm run check` also run without tools on the PATH and without `node_modules`. Not run on Windows or macOS.
  - Open: `npm audit` reports advisories in body-parser, qs, zod (fixable in range) and KaTeX (needs 0.19, kept at 0.16 on purpose).

- **2026-11-16: phone reading mode, installable app (item 44, HANDOFF 52).** Made in a worktree (the user reads on 5173); copied into the main tree and committed the same day.
  - New: `web/src/components/PhoneMenu.tsx`, `web/src/lib/fullscreen.ts`.
  - Changed: `App.tsx` (`PHONE`, `isPhone`, `phoneMenu`, `fitScreen`, `onFitNeeded`, `autoFitRef`, `storedZoomRef`, `toolbar` / `statusBar` / `searchBox` elements, `changeZoom` turns auto-fit off), `components/viewer/PdfViewer.tsx` (`compact`, `fitScreenZoom`, `onFitNeeded`, `onDoubleTap`, pinch, fit reads the element width), `ViewerToolbar.tsx` (`wrap`), `StatusBar.tsx` (Fit page hidden on phones), `TextDocViewer.tsx`, `lib/shortcuts.ts` (`landscape` `Shift+J`), `index.html` (`viewport-fit=cover`), `index.css` (safe-area padding), `public/manifest.webmanifest`.
  - Docs: `docs/PHONE_SETUP.md` (install as an app, the phone layout, developing from the phone), user guide §2, §12 (regenerated), §15; README; HANDOFF 52.
  - Verified: typecheck, tests, build; Chromium phone profile on scratch 4399/5199 (25 checks, see HANDOFF 52). Real PDFs only copied. Not tested on the real phone or in Firefox.

- **2026-11-16: quick tool buttons on the phone (item 44 follow-up).** Worktree, then merged. `components/PhoneMenu.tsx` (`QuickTool`, the buttons under ☰, the picker row), `App.tsx` (`phonePins`, `ss-phone-pins`), `ViewerToolbar.tsx` (`TOOLS`, `TEXT_TOOLS` exported). Docs: `docs/PHONE_SETUP.md`, user guide §15, HANDOFF 52. Verified: typecheck; Chromium phone profile on scratch 4399/5199 (9 checks). Not tested on the real phone.

## Open questions for the user

- Detect a PDF that was moved while open, and show a clearer error (offered on 2026-10-13, no answer yet).
