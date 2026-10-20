# StudySpace — Project Handoff

Read this file first when resuming work. It gives the state of the project as of **2026-10-14**. [CLAUDE.md](CLAUDE.md) is the short version, with the progress list: what was built, how it is organised, the rules for testing, and the problems already solved.

The user-facing docs are separate: [README.md](README.md) covers setup, the API and the schema, and [docs/USER_GUIDE.md](docs/USER_GUIDE.md) explains every feature.

---

## 1. What the app is

StudySpace is a **local-first PDF study workspace**. It reads the user's course PDFs from `/home/dipra/Buet/3-1`, excluding the folder `Offllines`. The screen has three resizable columns:

- **Left:** the library, with PDFs grouped by folder, plus recent files and search.
- **Center:** a PDF.js viewer with exact current-page tracking, zoom and page navigation. You can highlight text or areas and draw on the page.
- **Right:** one merged list of notes and resources for the visible page, plus document-wide ones. It updates as you scroll.

### Start the app

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"   # Node 24 comes from nvm (needed in every shell)
cd "/home/dipra/Study Helper"
npm run dev        # server http://127.0.0.1:4317 , UI http://localhost:5173
```

Other commands:

| Command | What it does |
|---|---|
| `npm run build && npm start` | Production build, served on 4317 |
| `npm test` | Server tests (vitest), currently **74 passing** |
| `npm run typecheck` | Typechecks server and web |

Configuration lives in `.env`, which is the user's own file (see `.env.example` for all variables):

```
STUDYSPACE_LIBRARY_DIRS=/home/dipra/Buet/3-1
STUDYSPACE_EXCLUDES=Offllines
AI_PROVIDER=none
```

Other variables:

- `STUDYSPACE_DATA_DIR`: default `~/.local/share/studyspace`.
- `STUDYSPACE_PORT`: default 4317.
- `STUDYSPACE_HOST`: default 127.0.0.1.
- `STUDYSPACE_HISTORY_LIMIT`: default 10.
- `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`.

---

## 2. ⚠️ Safety rules for testing (must follow)

The user said: *"while testing, you should not change any files. But when the app is built, the changed file after editing will replace the original file."*

**In-app edits overwrite the original PDF on purpose.** This applies to Save to PDF, insert pages and delete pages. A copy of the previous version is kept in `~/.local/share/studyspace/history/<docId>/`. Tests must never touch the real library. Follow these rules:

1. **Don't use the user's instance.** The user runs their own instance on ports **4317/5173** against the real library and the real DB.
2. **Run tests on other ports with scratch data.**
   - Start the server with `STUDYSPACE_PORT=4399`, `STUDYSPACE_DATA_DIR=<scratchpad>/data` and `STUDYSPACE_LIBRARY_DIRS=<scratchpad copy of a few PDFs>`.
   - Run vite with `--port 5199 --strictPort`. The vite proxy target must point at 4399.
   - Always use a **brand-new, empty** data dir. The library is only seeded from the env on a fresh DB, and an old scratch DB once still had `/home/dipra/Buet/3-1` configured. The guard in rule 3 caught it.
3. **Make test scripts check where they are.** They must abort if `/api/library` lists anything under `/home/dipra/Buet`.
4. **Check the real PDFs before and after.** Snapshot size and mtime of every real PDF before browser testing, and diff afterwards.
5. **Never kill processes you didn't start.** Kill by specific PID; `pkill` once killed my own shell.
6. **Use the right tools.** curl is not installed, so use `node -e "fetch(...)"`. Playwright is used for browser tests, with scripts kept in the scratchpad.

---

## 3. Architecture

```
package.json          npm workspaces: server, web (concurrently for dev)
server/  Node + Express 5 + TypeScript, SQLite via built-in node:sqlite (no native deps — gcc isn't available)
web/     React + TS + Vite + Tailwind v4 + lucide-react + pdfjs-dist + react-markdown/remark-math/rehype-katex
docs/USER_GUIDE.md    detailed end-user instructions (sections 1–14)
```

### Server (`server/src`)

**Startup and config**

- `config.ts`: reads the environment variables (ports, data dir, seed dirs and excludes, history limit, AI settings).
- `index.ts`: seeds library directories from the environment on first run, then starts the server. It loads `--env-file-if-exists=../.env`.

**Database layer (`db/`)**

- `db/index.ts`:
  - `openDatabase` turns on WAL and foreign keys.
  - Provides the `transaction` helper.
  - `runMigrations` applies migrations transactionally, recording them in `schema_migrations` and `user_version`, and refuses a DB that is newer than the code.
- `db/migrations.ts` defines the schema versions:

  | Version | What it adds |
  |---|---|
  | v1 | Directories, documents, resources, resource-page associations, annotations, reading progress |
  | v2 | `document_history`: file-edit undo, holding a previous-file copy and a JSON snapshot of notes and annotations |
  | v3 | `note_highlights`: highlights and comments inside notes, deleted along with their resource |
  | v4 | Rebuilds `document_history` so its kind CHECK allows `'replace'` |
  | v5 | Same again, for `'ocr'` |
  | v6 | `bookmarks` (tree via `parent_id`, ON DELETE CASCADE; `position` REAL orders siblings; `top` is the normalized spot on the page), plus `documents.bookmarks_dirty` and `documents.outline_imported` |
  | v7 | Rebuilds `document_history` again so its kind CHECK allows `'rotate'` and `'move'` |

- CRUD modules: `directories.ts`, `documents.ts`, `resources.ts`, `annotations.ts`, `progress.ts`, `noteHighlights.ts`, `bookmarks.ts`. Create functions accept an optional client-supplied `id`, which keeps undo/redo idempotent.

**Library (`library/`)**

- `fingerprint.ts`: stable document ID. It is `v1:` + sha256 of the file size + the first and last 256 KiB.
- `scanner.ts`: recursive PDF discovery with excludes.
- `sync.ts`:
  - Detects renames and moves through the fingerprint.
  - Flags missing files instead of deleting them.
  - Uses a per-db lock.
- `pathGuard.ts`: the realpath must be inside an enabled root. PDFs are **streamed in place** (with range requests) and never copied.

**PDF editing (`pdf/`)**, using pdf-lib

- `operations.ts`: insert blank pages, copy pages from another PDF, delete pages, and write or strip StudySpace annotations.
  - Annotations are tagged `T="StudySpace"` and `NM="studyspace-<id>"` and get appearance streams.
- `coords.ts`: maps normalized display coordinates to PDF space, handling `/Rotate` and the CropBox.
- `pageMap.ts`: renumbering after insert/delete and its inverse. This is what keeps notes on the right page after pages shift.

**Services (`services/`)**

- `fileWriter.ts`: atomic writes (temp file + fsync + rename).
- `documentEditor.ts`:
  - `editFile` saves the previous file into `history/` and takes a DB snapshot.
  - Edits: insertBlank, insertFromDocument, `removePages` (orphan policy `delete` | `document`), saveAnnotationsToFile.
  - `undoEdit` works LIFO. It verifies the fingerprint, restores the file and snapshot (including note highlights), and inverse-maps newer rows.

**AI (`ai/`)**

- A provider registry that currently has only `none`. The app works 100% offline, and it is AI-ready through environment variables.

**Routes (`app.ts`)**, all under `/api`

- Library: health, config, directories CRUD, fs/browse, library, library/scan, recent, search.
- Documents: documents/:id, file, meta, progress.
- Notes and resources: resources CRUD, note-highlights CRUD.
- Annotations: annotations CRUD and `annotations/save` (which also writes the bookmark outline).
- Bookmarks: `documents/:id/bookmarks` (+ `/import`) and `bookmarks/:id`.
- Page edits: `pages/insert-blank`, `insert-from`, `replace`, `delete`, `rotate` and `move`, plus history and undo.
- New PDFs: `library/folders`, `pdf-tools/create`.
- AI: ai/status and ai/generate.

**Tests (`server/test`)**

- `helpers.ts`: temporary directories and a generated test PDF.
- Test files: migrations, discovery, resources (including note highlights), editing (orphan policy, undo, note highlights restored by undo), ai.

### Web (`web/src`)

**`App.tsx`**

- Holds the app state and opens documents.
- Wraps every mutation in undoable handlers through `lib/undo.ts`, which keeps a per-document undo/redo stack.
- Handles global keyboard shortcuts:

  | Shortcut | Action |
  |---|---|
  | Ctrl+Z | Undo |
  | Ctrl+Shift+Z / Ctrl+Y | Redo |
  | Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset |
  | `?` | Help screen |

- Panel widths: left 288 (200–560), right 380 (280–760), center at least 360. They are saved in localStorage.

**Viewer (`components/viewer/`)**

- `PdfViewer.tsx`:
  - Virtualized pages that keep the reading position steady when zoom changes.
  - The current page is the one with the largest visible area.
  - Text-selection highlight bar and annotation menu. Esc or an outside click closes them and clears the selection.
- `PdfPage.tsx`: renders one page.
- `AnnotationOverlay.tsx`: draws highlights and drawings on the page.
- `geometry.ts`: shape maths and `HIGHLIGHT_COLORS`.
- `ViewerToolbar.tsx`: undo/redo, delete page and the page-tools menu.

**Notes and resources panel**

- `ResourcePanel.tsx`:
  - One merged list grouped by type: note, summary, ai_explanation, pyq, link.
  - Cards **start open** whenever a PDF is opened (the panel is keyed by document id, and state holds the ids the user closed). An inline Close/Expand pill sits right after the title, plus Close all / Expand all.
  - The AI assistant block was removed at the user's request.
- `ResourceEditor.tsx`: the Markdown editor for notes.
- `NoteAnnotations.tsx`:
  - `NoteBody`: select text in a note to highlight or comment on it. Comments are listed under the note, with a warning for highlights whose text was edited away.
  - `NotePopovers`: the floating bar and the highlight menu (Esc or an outside click closes them).

**Markdown and math**

- `Markdown.tsx`: react-markdown + GFM + math + KaTeX + the note-highlight plugin.
- `lib/math.ts` (`normalizeMath`):
  - Converts `\(…\)` and `\[…\]` to `$`-style math.
  - Escapes pipes inside tables.
  - Turns `\$` into `\char36` so a dollar sign inside math doesn't close the formula.
- `lib/noteAnchors.ts` and `lib/rehypeNoteHighlights.ts`: note highlights are stored as quote + prefix/suffix context and re-found on each render, using whitespace-normalized matching and skipping KaTeX output.

**Dialogs and other pieces**

- `PageOpsDialog.tsx`: the delete dialog shows which notes are affected and asks whether to delete them or move them to the whole document.
- `HelpDialog.tsx`, `SettingsDialog.tsx`, `LibraryPanel.tsx`, `SearchBox.tsx`, `StatusBar.tsx`, `ResizeHandle.tsx`, `ui.tsx`.
- `index.css`: theme tokens (CSS variables, dark mode), KaTeX tweaks, and the `.ss-note-hl` styles.

---

## 4. Feature history (all done and verified)

1. **Initial build.** Library discovery, viewer, scoped resources (page/range/document) with 5 types, reading progress, text and area highlights, save to PDF, insert a blank page or pages from another PDF, README and tests.
2. **Delete pages** without notes moving to the wrong page (page remapping + orphan policy). Added an undo button, file-edit undo backed by history, keyboard shortcuts for undo and zoom, and the detailed USER_GUIDE.
3. **LaTeX** inside sentences and tables (`\( \)`, `\[ \]`).
4. **Dollar signs** inside math (`\$`).
5. **`\boxed`**. Fixed by pinning **katex to ~0.16.47** to match rehype-katex; a CSS/renderer version mismatch broke it. Don't upgrade katex on its own.
6. **Resizable columns** (drag handles; double-click resets).
7. **Expand/Close beside the title.** Cards first started collapsed; later (item 14) the user asked for them to start open.
8. **Merged My Notes and Resources** into one section.
9. **AI assistant block removed** for now.
10. **Annotating notes:** highlights and comments inside notes. **Esc now closes the floating bars** in both the PDF and notes.

11. **Page tools menu fix:** the dropdown was being clipped by the toolbar and was invisible. It is now fixed-positioned and wider, and Esc closes it.

12. **Page-number fields can be cleared:** every page box now uses `NumberInput` in `components/ui.tsx`. It allows an empty value while typing, selects everything when clicked, and clamps on blur. The status-bar page box and the "Pages to delete" field also select everything on focus.

13. **Replace pages:** Page tools → *Replace this page…* swaps pages one for one with pages of any library PDF, including the open one.
    - Page count, notes and ranges are unchanged.
    - Annotations on the replaced pages are deleted unless "keep" is ticked.
    - Undo works, because the inverse page mapping is the identity.
    - Code: `replacePagesFrom` (pdf/operations.ts), `replaceFromDocument` (documentEditor.ts) and the `replace` branch of PageOpsDialog.
    - The dialogs also read a source PDF's page count with pdf.js when the library doesn't know it yet (`useSourcePageCount`).

14. **Cards open by default** each time a PDF is opened. Closing persists while paging within that PDF.

15. **Several tabs and the unsaved-work prompt.**
    - Library entries are `<a href="#/doc/id">`, so Ctrl/middle-click opens a new tab, and App listens to `hashchange`.
    - Cross-tab sync: `lib/tabSync.ts` uses a BroadcastChannel `studyspace`. `api.ts`'s `setMutationListener` fires after every successful write. App classifies the write, announces `{docId, file}`, and on receipt runs `reloadDocData`, or `refreshAfterFileChange` with a toast (batched over 250 ms). Changes to other documents only refresh the library.
    - `requestOpen()` guards every document switch. If `doc.annotationsDirty` or a note draft is open, it shows `UnsavedDialog` (Save to PDF and open / Open without saving or Discard note / Stay here).
    - `ResourceEditor` reports drafts through `onDirtyChange`, which ResourcePanel passes on as `onDraftChange`. A draft also triggers `beforeunload`.
    - `applyFileEdit` now returns a boolean (success).

16. **Notes readability.**
    - `normalizeMath` turns every `$$…$$` and `\[…\]` into a fenced display block (`displayBlocks`), keeping list and blockquote indentation. remark-math renders single-line `$$x$$` as *inline* math, which gave tiny, cramped fractions.
    - `splitChain` lays out chains with two or more top-level `=`/`\approx`/`\equiv`/`\Rightarrow` as `aligned` with `\\[0.45em]` row gaps. A left side longer than 12 visible characters gets its own line, and steps are indented with `\quad`. It skips formulas with `\\`, `&`, environments, `\quad`, `;`, or `\text{and…}`.
    - `Markdown.tsx` `fitEquations` scales overflowing display equations via `--ss-fit` (down to 0.6, then scroll) and re-runs on resize.
    - Spacing: line-height 1.7, block gap 0.75em, list items 0.45em.
    - Highlighter colours: the card title has `.ss-title-hl` (pink). `rehypeNoteStructure` (formerly rehypeHeadingLevels) sets a relative `data-level` on headings: 1 orange, 2 cyan (was yellow until 2026-10-18; it looked like the user's yellow highlights), 3 green, 4+ blue. It also sets `data-lead` (1 top-level, 2 nested) on a list item's leading `<strong>`, or on a leading `<em>` that ends in ":", which renders violet. A plain label at the start of the item's text (`PLAIN_LABEL`: ≤ 8 words and 60 characters, no `.!?;` before the colon, text after it, not a URL or a task box) is wrapped in a `<span data-lead>`, shown bold (2026-10-18, HANDOFF 27). Dark mode uses a 32%/20% mix.
    - `fitEquations` also re-runs when fonts finish loading (`document.fonts`), because KaTeX fonts change widths on first load.

17. **Get text / OCR** (user-approved plan: OCR only on demand, pages or a region, result prompt).
    - **Server:**
      - `services/ocr.ts` holds `ocrStatus`, `ocrPdfPages` and `ocrImage`, plus `OcrJobs` with temp files in `dataDir/tmp/ocr/<job>`.
      - `ocrPdfPages` runs `ocrmypdf --pages … --redo-ocr --output-type pdf --optimize 0`: no rotate/deskew/PDF-A, so geometry is unchanged.
        - `--redo-ocr`, not `--skip-text`: the user's scans carry a visible "45.jpg" text stamp per page, which made `--skip-text` skip every page.
        - `--redo-ocr` OCRs image content and keeps visible text, so slides aren't duplicated. Verified with real ocrmypdf 16.13 / tesseract 5.5.
      - `ocrImage` runs `tesseract stdin stdout`.
      - Routes `/ocr/status`, `POST /documents/:id/ocr`, `/ocr/jobs/:id{,/file,/apply}`, `DELETE`, and `/ocr/image` (raw PNG).
        - `/file` needs `sendFile(..., { dotfiles: "allow" })`, because the data dir is under `~/.local`. Without it, it returns 404; the OCR tests now use a `.local` data dir.
      - `applyOcrLayer` in documentEditor uses the new `EditSpec.transformBytes` with history kind `ocr`.
      - Migration v5 widens the history kind CHECK.
      - Jobs are kept 30 min after finishing, so redo after undo can re-apply; `apply` is refused unless the file still has the job's source fingerprint.
      - Config: `STUDYSPACE_OCRMYPDF`, `STUDYSPACE_TESSERACT`, `STUDYSPACE_OCR_LANG`. Not installed on this machine; the user must `sudo apt install ocrmypdf tesseract-ocr`.
    - **Client:**
      - `lib/pdfToMarkdown.ts` (`extractPages`, `ocrTextToFormat`, `escapeMarkdown`, `textlessPages`) builds headings by relative font size and lists by bullet glyph and indent, and drops repeated headers/footers. Font stats come from up to 12 sampled pages when few are selected.
        - Lines are built from positions, comparing each run with the previous run's baseline (tilted scans). `hasEOL` is ignored, because OCR layers mark every word as EOL.
        - A paragraph's first line may be indented by up to 4 em.
        - Scan stamps (`*.jpg`, CamScanner) and bare page numbers don't count as text.
        - `ocrPages` (pages that were textless before OCR) get no size-based headings and looser joining.
        - Node tests of the 160 MB textbook can OOM (about 2 GB free); cut excerpts with `pdfseparate` + `pdfunite`.
      - `components/GetTextDialog.tsx` is the setup, progress and result dialog: Copy / Download / Save as note / Add to PDF.
      - Toolbar tool `ocr` (key `O`) draws a box (via `AnnotationOverlay.onRegion`), rendered at about 300 dpi into a PNG.
    - **Tests:** `server/test/ocr.test.ts` uses stub binaries. For browser testing, the stub ocrmypdf writes a real invisible text layer with pdf-lib.
    - **Fixed along the way:** `Modal` now subscribes its Esc listener once. A re-render mid-keypress, such as the toolbar's Esc switching tools, used to drop the first Esc.

18. **Bookmarks (PDF outline)** (user's choices: *Save into the PDF*; *show the PDF's existing outline and let me edit it*).
    - **Server:**
      - `db/bookmarks.ts`: CRUD with cycle check, `importOutline` (only when `outline_imported = 0`; doesn't mark dirty) and `bookmarkTree`. Every change sets `bookmarks_dirty`.
      - Routes `GET /documents/:id/bookmarks` → `{imported, bookmarks}`, `POST …/bookmarks/import`, `POST …/bookmarks`, `PATCH|DELETE /bookmarks/:id`.
      - `pdf/operations.ts` `writeOutline` replaces `/Outlines`. It deletes the old item objects (cycle-safe) and writes `Dest [page /XYZ null y null]`, or `/Fit` on rotated pages. Nested items are collapsed (negative Count). With no items, it leaves no `/Outlines`.
      - `saveAnnotationsToFile` also writes the outline, **but only if `outline_imported`**, so a PDF whose outline was never read is never stripped. It clears both dirty flags.
      - `documentEditor`:
        - Snapshots include bookmarks.
        - Insert/delete/replace remap bookmark pages; a bookmark on a deleted page goes to the next kept page with `top` null.
        - Undo restores bookmarks and keeps ones created after the edit (inverse-mapped).
      - `library/sync.ts`: when another program changes a file's content and there are no unsaved bookmark changes, it drops the bookmarks and resets `outline_imported`, so the new outline is re-read.
      - Tests: `server/test/bookmarks.test.ts` (outline read back with pdf-lib) and a v6 migration test. 65 tests pass.
    - **Client:**
      - `lib/outline.ts`: `readOutline` (pdf.js `getOutline`), `resolveDest` (XYZ/FitH/FitBH/FitR → `{page, top}`, off-page → null; also used for in-PDF links now), `buildBookmarkTree` and `currentBookmarkId`.
      - App imports the outline in `onLoaded` (the viewer now passes the pdf) when `!doc.outlineImported`. If that fails, the panel shows an error with *Try again* and editing waits, so a save can't overwrite the unread outline.
      - `components/BookmarksPanel.tsx`, shown in the left column's **Files | Bookmarks** tabs (`ss-left-tab`):
        - The tree auto-opens the ancestors of the current bookmark and highlights the current one.
        - It has a filter (more than 12 bookmarks), inline rename, and a fixed-position ⋯/right-click menu.
        - Keyboard: ↑↓←→, Enter, F2, Delete, Alt+arrows to move/indent.
      - **B** bookmarks the spot at the top of the view (`PdfViewer.getPosition()`). Selected text becomes the title; otherwise the inline rename opens.
        - The new bookmark goes after the one being read, at the same level (fractional `position`).
        - `goToPage(page, top)` scrolls to the spot.
      - All bookmark ops are undoable. Delete re-creates the subtree, parents first.
      - "Unsaved" means `hasUnsavedChanges(doc)` = `annotationsDirty || bookmarksDirty`. It drives the toolbar Save button, the library dot, Ctrl+S and UnsavedDialog.
    - **Verified:** on scratch copies of Tanenbaum (523 entries, broken tree, off-page XYZ tops) and OSTEP (414).
      - Import takes about 80 ms.
      - Save round-trips all 523 entries plus a new one; mutool shows identical titles, nesting and pages, and a clean tree.
      - Also verified: two-tab sync, the unsaved prompt and the mobile drawer.

19. **PDF tools: extract, split, merge, turn, move** (user: "extract pages from a pdf file and save into a directory… split, merging etc.").
    - **Design choice:** new files may only be written **inside enabled library folders** (the original spec restricts file access to them). Optionally a new sub-folder can be created. Existing files are never overwritten: `fs.open(…, "wx")` reserves `name.pdf`, then `name (2).pdf`…
    - **Server:**
      - `services/pdfTools.ts`:
        - `createPdfs` builds each output from segments `{documentId, pages?}`; pages left out means all of them. It uses `composePdf` in `pdf/operations.ts` (pdf-lib `copyPages`; StudySpace annotations are stripped unless highlights are copied).
        - It writes the outline from the sources' bookmarks (`carryBookmarks`, plus an optional bookmark per source) and inserts the documents directly (path under the configured `dir.path`, like the scan does).
        - It copies page/range notes, note highlights and annotations remapped to the new pages. The new doc's `annotations_dirty` is set only if a copied source's was.
        - On failure, it removes this request's files and rows.
      - `listLibraryFolders` serves `GET /library/folders`; route `POST /pdf-tools/create`.
      - `rotateDocumentPages` (kind `rotate`) turns DB annotations with `rotateNormRect`/`rotateNormPoint` (`pdf/coords.ts`) and fixes bookmark tops. Undo turns back annotations created after the turn.
      - `moveDocumentPages` (kind `move`) uses `orderAfterMove`/`inverseOrder` (`pdf/pageMap.ts`) and pdf-lib remove + re-insert of the same page objects, so the file's outline stays valid. Undo unmaps with `params.order`.
      - Migration v7.
      - Tests: `server/test/pdftools.test.ts` and a v7 migration test. 74 tests pass.
    - **Client:**
      - `components/PdfToolsDialog.tsx` handles extract (with an optional "remove from this PDF", which runs the normal undoable delete), split (every N / ranges / by bookmarks at level 1–3, with editable names and a default sub-folder "<title> - split") and merge (ordered list, per-PDF pages, library search).
      - It has a folder `<select>` and the bring-along options. Before merging, it reads the outlines of PDFs never opened (pdf.js `readOutline` → `importOutline`), so their bookmarks come along.
      - `PageOpsDialog` has new `rotate` and `move` kinds.
      - The Page tools menu has a *New PDFs* section.
      - `tabSync` treats `/pdf-tools/` as a library change.
    - **Verified (scratch copies):**
      - Extract 4–6 with remove + undo.
      - Turn + move in the history.
      - Tanenbaum split by chapters: 20 files in 1.3 s; the chapter 1 file has 84 pages and 57 nested bookmarks.
      - Merge with an unopened OSTEP: its 414 bookmarks are nested under it.

20. **Shortcuts for every feature, copy page as image, cut page in half** (user request).
    - **`web/src/lib/shortcuts.ts` is the single registry** (`SHORTCUTS` id → keys/label/group; `matches(e, id)`, `keyOf`, `withKey`, `formatCombo`, `isTyping`). Add new keys there.
      - The App's global handler, the toolbar (tools, `1`–`5` colours, `Shift+1`–`3` pen widths, `T` menu), the floating bars in PdfViewer (`1`–`5`, `N`, `Delete`), PageHalvesDialog and HelpDialog (generated, searchable) all use it.
      - The user guide §12 tables are generated from it by `scripts/shortcut-tables.mts`; regenerate them if keys change.
      - `KeyHint`/`Kbd` in `ui.tsx` show keys beside features.
    - **Global handler rules:** nothing fires while typing or while any `[role=dialog]` is open; some keys (`,`, `Shift+D`, `Shift+L`, `[`, `]`, `L`, `/`) work without a PDF open.
    - **Page tools menu:** a two-column grouped menu with keys on the right. `T` opens it with the first item focused; ↑/↓/Home/End move; any other key closes it and runs its shortcut.
    - **`lib/pageImage.ts`:** `renderRegion` moved here from GetTextDialog. `copyToClipboard` passes promises to `ClipboardItem`, so the key press still counts as the user gesture. Also `cutCanvas`, `stackCanvases`, `imagesHtml` ("copy both" writes `text/html` with two `<img>` plus a stacked PNG) and `downloadPng`.
    - **`components/PageHalvesDialog.tsx`:** keys `1`/`2`/`B`/`S`/`D`/`←→`/`0`/`PgUp`/`PgDn`. Previews are cropped with CSS from one small preview; the copies use the full 200-dpi canvas.
    - **Verified in Chromium:** every dialog key; `T` menu navigation; `Shift+C` puts a 1200×1800 PNG on the clipboard; halves give 1200×900 (top/bottom) or 600×1800 (left/right); `B` writes html + png; `S` downloads; panel/theme/pen-width keys work; help search works.

21. **Get-text keys, highlight marks, two-click boxes** (user request).
    - **Keys:**
      - Global keys go through `TextPreset` `{mode, method, auto}` on `TextRequest` (`GetTextDialog.tsx`): `Shift+T`/`G`/`A` (text: this page / pages / all), `Shift+O`/`P`/`W` (OCR).
      - `auto` presets start on a `setTimeout(0)` that the effect cleanup cancels; React StrictMode would otherwise start, then orphan, a second OCR job. `runOcr` also discards a job whose start returned after an abort.
      - The window has its own keys (`gt*` in `lib/shortcuts.ts`).
      - `isTyping` ignores focused checkboxes/radios.
    - **Highlight marks:**
      - `extractPages(..., { highlights: Map<page, NormRect[]> })` brackets highlighted characters with U+E000/U+E001 while lines/blocks are built. Each character's x is estimated along its run; a word counts when ≥ half of it is covered. `finishMarks` turns the brackets into `==…==`, joining neighbouring runs.
      - Sources: the doc's DB highlights and area highlights, plus file `Highlight` annotations (pdf.js `getAnnotations` quadPoints).
      - `lib/rehypePdfMarks.ts` renders `==text==` as `<mark class="ss-pdf-hl">` (it skips code and math).
      - The option is remembered in localStorage `ss-text-marks`.
    - **`AnnotationOverlay`:** a click without dragging arms the box (first corner) and the next click finishes it. Esc, a tool change, or a click on another page cancels it. Dragging still works.
    - **Verified:**
      - Two clicks made `area {x:.1,y:.45,w:.4,h:.07}`; Esc cancels without changing the tool.
      - `Shift+T` gives `==middle of page 1==`, and `H`/`M`/`C`/`V`/`N`/`B` work.
      - `Shift+G` focuses From, then Tab/Enter.
      - `Shift+O` ran real OCR in 2.3 s.
      - Tanenbaum p.33 file highlights were marked.

22. **Save pages as pictures, arrow keys between text boxes** (user: "I want to use the keyboard in most cases").
    - **Save pictures (`components/PageImagesDialog.tsx`, `Shift+S`):**
      - Keys: `1`/`2`/`3` pages, `F` PNG⇄JPEG, `R` dpi cycle, `C` copy, `Enter` save.
      - Renders with `renderRegion` and `canvasToBlob`. One page downloads one picture; several go into `ZipWriter` (`lib/zip.ts`: stored entries, CRC32, UTF-8 names), checked with `unzip -t`.
      - Prefs are kept in localStorage `ss-picture-prefs`.
    - **`data-shortcut-letters`** on page-number boxes: `isTyping` lets letter keys through there, so `F`/`R`/`T`/`O`… work while typing pages.
    - **`lib/fieldNav.ts`:** installed once in `main.tsx`, on capture-phase keydown.
      - From a one-line text field inside the nearest `[role=dialog]`, `form` or `[data-field-group]`: `↓` goes to the next empty text field (else the next one), `↑` to the previous one.
      - Opt out with `data-arrow-nav="off"` (the search box has it).
    - **Verified:** single PNG at 150 dpi = 900×1350 for OSTEP p1; `2` + "1-3, 7" + `f` + `r` + Enter gives a valid zip of 4 JPEGs; arrows work in Extract and Get text.

23. **Screenshot any part of the window to the clipboard** (`Q`, the crop button in the top bar, Page tools → Images).
    - **`components/SnipOverlay.tsx`:** a full-window overlay with two-click corners or a drag. `Enter` takes the whole window or finishes at the pointer; `Esc` steps back. It calls `onPick` inside the gesture, so `copyToClipboard(promise)` is allowed.
    - **`lib/snip.ts` `captureWindowRegion`:**
      - Waits 2 frames for the overlay to go, then `domToCanvas(#root, { scale: devicePixelRatio, features: { restoreScrollPosition: true }, filter: no [data-snap-ignore] })` and crops.
      - It renders `#root`, not `<body>`, which would add an 8 px default margin.
      - Dependency: `modern-screenshot` 4.7.0 (exact, no runtime deps).
    - Toasts carry `data-snap-ignore`.
    - **Verified in Chromium:** a 600×320 snip of the scrolled PDF equals Playwright's own screenshot of the same region (mean difference 0.08/255); drag and Enter (1440×900) work; Esc cancels; takes about 2 s.

24. **Notes and bookmark sections in Get text** (2026-10-14; user: "add options to include the notes saved by me for the pages too. also add feature to get text/run ocr from a bookmark to the end of that bookmark").
    - **Include my notes** (`I` in the window; localStorage `ss-text-notes`, off by default):
      - `lib/notesText.ts` `notesForText` puts each page or range note (any kind) after the last page being read that it covers. Whole-PDF notes go at the end, only when the whole PDF is read.
      - In Markdown a note is a blockquote, `> **My note: title** *(page 3)*`; in plain text it is `[My note: title (page 3)] … [end of note]`.
      - `extractPages` takes an `afterPage` map. The dialog's `regenerate` takes a `Build` object `{format, marks, notes}`.
    - **A bookmark's section:**
      - `TextPreset.mode` gains `"bookmark"`, plus an optional `bookmarkId` (the default is `currentBookmarkId`). Selections are `{pages, label, clip}` (`Selection` in `GetTextDialog.tsx`).
      - `lib/outline.ts` `bookmarkPages(ordered, id, pageCount, withInside)` → `BookmarkSection`. It runs from the bookmark's page to the page of the earliest later bookmark that is not nested inside it (with `withInside`, the default), and carries both titles and `top`s.
      - **Trimming mid-page**, in `extractPages` `clip: Map<page, PageClip>` (`pdfToMarkdown.ts`):
        - The heading is looked for by title first (`findHeading`: letters and digits only; a wrapped title or a number on its own line also match), and the stored `top` is the fallback.
        - Bookmark tops are often wrong. Tanenbaum gives most entries 0.042 or 0.2962, and many are null.
        - If the next heading isn't found on the last page and its `top` is null or ≤ 0.15, that page is dropped (`dropIfNoTo`).
        - Pages clipped to nothing are left out of the text and of `ExtractResult.pages`, and the dialog shows those pages.
      - `BookmarkPicker` in `GetTextDialog.tsx`: a find box (`data-arrow-nav="off"`) where ↑/↓/PgUp/PgDn pick and Enter or a double-click starts. Enter does nothing when the filter hides the chosen one. A checkbox includes the nested bookmarks.
      - Keys: `4` in the window; `Shift+E` / `Shift+U` globally; `T` / `O` on a bookmarks-list row; also in the row's ⋯ menu and in the Page tools menu.
    - **Verified in Chromium on scratch copies (Tanenbaum, 523 bookmarks):**
      - `Shift+E` focuses the find box with the current section chosen.
      - "computer hardware" + Enter gives pages 51–66: it starts at the "1.3 COMPUTER HARDWARE REVIEW" heading and ends with "…starts up a login program or GUI." on p66, just before 1.4.
      - `I` adds two notes at the right pages.
      - The saved note is titled after the bookmark, with scope range 51–66.
      - PREFACE from the list with `T` gives pages 24–27; the empty p28 is dropped.
      - `Shift+U` OCR of 1.2.1 starts at its heading even though its stored top is wrong.
      - The PDF file is unchanged, with no page errors.
25. **Prices no longer turn into math** (2026-10-18; user: "the account a to b part is merged. fix it").
    - Bug: "transferring $100 from A … deducting $100" paired the two `$` into one formula, so the words between ran together in italics.
    - `lib/math.ts` `escapeCurrency` (first step of `normalizeMath`): a `$` followed by a digit becomes `\$` unless its closing `$` touches the formula (no space before it) and isn't followed by a digit (Pandoc's rule). `$5$`, `$2x + 3 = 5$`, `$ x $`, `$$…$$`, `\(…\)` and `\$` are unchanged.
    - Verified: sample cases through `normalizeMath`, and remark-math parses the result as plain text plus `$x^2$` as math; typecheck passes.
26. **Clean AI answers on paste** (2026-10-18; user: "is there a way where I can simply paste the gemini response, but this unnecessary conversation will be cut off… also… [cite:13]. I want to remove those too").
    - `lib/pasteClean.ts` `cleanPasted`: drops everything before the first `@@START@@` (`START_MARK`) and the mark's line when only markup (`**`, `` ` ``, `#`…) is left on it; text after the mark on the same line is kept. Later marks are just removed. Removes `[cite…]` tags (`[cite: n, m]`, `[cite_start]`, `[cite_end]`) with the spaces before them.
    - `ResourceEditor.tsx` `onPaste` on the content box: when the text changes, it sets the clean text through React state and puts the caret after it. A grey line under the box says what was cleaned. Native undo can't see a React-set value, so `onContentKey` handles one Ctrl+Z right after the paste (back to the text before it); any other key ends that.
    - **Don't use `execCommand("insertText")` for this.** The first version pasted the raw text with it and then swapped in the clean text; it worked in Chromium, but in the user's Firefox (snap) the raw text stayed. Playwright has no Firefox build for Ubuntu 26.04, so Firefox can't be tested here.
    - Verified in Chromium on a scratch copy (4399/5199): paste after existing text gave the clean text, the note line showed, Ctrl+Z → text before the paste, paste + typing lands after the paste, saved note is clean. Real PDFs unchanged.
    - First "it is not working": I guessed they used **4317**, which serves the built `web/dist` (still from 2026-10-14), not the Vite dev UI. Fixed by `npm run build`. `submit` also runs `cleanPasted` now, so text that arrives without a paste event, or an old note opened and saved, is cleaned too. Verified on the built app on 4399: typed raw text was saved clean. They were in fact on 5173 in Firefox; the real cause was the `execCommand` above.
27. **Plain bullet labels coloured** (2026-10-18; user: "bullet points are supposed to get highlighted… it is not working for… `* Superblock: Checks…`").
    - Gemini's pasted answer had lost its bold, so `- Superblock: …` had no `<strong>` to colour.
    - `lib/rehypeNoteStructure.ts` `plainLabel` splits the item's first text node into `<span data-lead>Label:</span>` + the rest. `index.css`: `span[data-lead]` is bold.
    - Not labels: sentences ("This is a sentence. It has: …"), URLs, `10:30`, labels over 8 words, an item that is only "Label:" with nothing after, and items that start with math.
    - Verified: sample lists through the plugin; Chromium on scratch 4399/5199 shows Superblock/Free blocks/Duplicate blocks/Result violet and the plain sentence untouched. Rebuilt `web/dist`.
28. **Slides (.pptx/.ppt) in the library; folders can be closed** (2026-10-18; user: "I want the website to be able to open pptx files too and show those files in the files section. also currently the dropdown of the current directory can't be closed").
    - **Kind:** `server/src/library/fileKinds.ts` (`kindOf`, `isLibraryFile`). `DocumentRecord.kind` ("pdf" | "slides") comes from the file extension in `db/documents.ts` `map`, so there is no migration. The scanner is now `scanForDocuments`; `titleFromPath` strips `.pptx`/`.ppt` too.
    - **Conversion:** `services/slides.ts` `SlideConverter`. The file is copied into a work dir and converted with `soffice -env:UserInstallation=<workDir>/profile --headless --convert-to pdf`, one at a time, deduped per version. The result goes to `<dataDir>/converted/<docId>-<fp16>.pdf`, and older versions are deleted.
      - **Snap LibreOffice** (the user's, `/snap/bin/libreoffice`) can't read `/tmp` or hidden folders (`~/.local`), so the work dir defaults to `~/snap/libreoffice/common/studyspace`. Override with `STUDYSPACE_CONVERT_DIR`; the program with `STUDYSPACE_SOFFICE`. The own profile also lets it run while the user has LibreOffice open.
      - A 70-slide deck took ~33–40 s (mostly snap start-up); reopening takes ~1.3 s.
    - **Routes:** `POST /documents/:id/convert` waits for the PDF. `GET /documents/:id/file` serves the converted PDF for slides (converting if needed). OCR is refused (400).
    - **Read-only:** `editFile` refuses slides (`SLIDES_READ_ONLY`), which covers page edits, Save to PDF and OCR apply. Slides can still be a *source*: `resolveReadablePdf` (documentEditor) gives the converted PDF, or 409 "Open … once first", for insert-from, replace and PDF tools (`createPdfs` now takes `dataDir`).
    - **Web:**
      - `PdfViewer` calls `api.convert` first for slides and shows "Turning the slides of … into pages…". The load effect depends on `doc.id`/`fingerprint`/`kind` only.
      - `ViewerToolbar` `readOnly` hides 🗑, the *Edit this PDF* items (a short note instead), OCR and "Saved in PDF".
      - `App`: `applyFileEdit` refuses slides with a toast, and an effect drops any `pageOp` for slides (keys like `Shift+Delete`), with the same toast.
      - `hasUnsavedChanges` is false for slides, so there is no orange dot or unsaved prompt.
      - `LibraryPanel` shows a `Presentation` icon.
    - **Folder dropdown bug:** `isOpen` used to OR in `activeAncestors`, so folders holding the open file could never close. Now an effect adds those folders to the open set once when the open file changes (keyed on directory + relPath strings, so a refreshed list doesn't reopen them).
    - **Tests:** `server/test/slides.test.ts` (7, with a stub `soffice`): listing, one conversion then cache, reconvert after change, refused edits/save/OCR, source for new PDFs, failure and missing-LibreOffice messages. 81 tests pass.
    - **Verified in Chromium on scratch 4399/5199** with a copy of "9. Chapter 8 (Code Generation).pptx": the converting message, 70 pages after 40 s, reopen 1.2 s, area highlight + Ctrl+Z, `Shift+Delete` → toast and no dialog, Page tools shows the slides note with no edit/OCR items, and "Course" / "Week 1" close and reopen while Deck is open.
29. **Bullet headers and their points** (2026-10-18; user: "the * **Deductive Learning:** should get a different colour, because they are headers for the bullet points and there should be some indentation").
    - Gemini pastes `* **Inductive Learning:**` and its `* **Concept:** …` points at one level.
    - `rehypeNoteStructure.ts`: `isGroupHeader` means the item's own content is only a label ending in ":" (≤ 80 characters, ≤ 10 words, formulas count as one word, so "Only Data Block ($D_b$) is written:" counts). `nestUnderHeaders` (on every `ul`, not `ol`, so numbering isn't changed) moves the items after a header, up to the next header, into a new `ul` inside it. `markGroupHeader` sets `data-group` on the label (or wraps a plain one in a span), and only for items with a list under them; a header with nothing after it keeps the normal lead-in colour.
    - `index.css`: `[data-group]` is rose (#fda4af), bold. The moved points are nested, so their labels get the lighter `data-lead="2"`.
    - Verified: sample lists through the plugin (the user's text, the OS note's math header, an already nested list, a trailing header, plain labels); Chromium screenshot on scratch 4399/5199. Rebuilt `web/dist`.
30. **Highlights readable** (2026-10-19; user: "decrease the opacity of highlight colour on the pdf. the texts cannot be read after highlighting").
    - Cause: `AnnotationOverlay` set `mix-blend-mode: multiply` on each highlight's `<g>`. The SVG has a z-index, so it is its own stacking context and the `<g>` only blended with the SVG's transparent backdrop. The colour then simply covered the text, at opacity + 0.1 (0.5).
    - Fix: `mixBlendMode: "multiply"` on the `<svg>` itself (it now blends with the page canvas; ink multiplies too, which looks the same on white paper); rects drawn at `a.opacity`, without the +0.1; new text and area highlights use `HIGHLIGHT_OPACITY` = 0.3 (`geometry.ts`; was 0.4 / 0.35). Existing highlights keep their stored 0.4, which now blends.
    - Verified in Chromium on scratch 4399/5199: computed `mix-blend-mode: multiply` on the overlay; zoomed screenshot of 0.4 and 0.3 yellow and 0.3 pink over text, which stays black and sharp. Rebuilt `web/dist`.
31. **Formulas in note highlights** (2026-10-19; user: "I can't highlight the mathematical equations in the notes section… many sentences which contain mathematical equation in between the words which are left unhighlighted").
    - Cause: the note text model skipped KaTeX output, so a formula alone gave an empty selection, and a sentence's highlight never covered its formulas.
    - `lib/noteAnchors.ts`: each formula now counts as `mathToken(tex)` = `$tex$` (TeX from KaTeX's `annotation[encoding="application/x-tex"]`). `domUnits` lists text nodes and whole formulas. In `boundaryOffset`, a point inside a formula moves to its start (selection start) or end (selection end), so selections take whole formulas.
    - `lib/rehypeNoteHighlights.ts`: formulas are atoms in the text. A covered one gets `ss-note-hl` + `data-hl`/style on the `.katex`/`.katex-display` element itself, because a `<mark>` can't hold a display formula. **Old highlights** (quotes without formulas) are found in a `legacy` text without formulas and mapped back (`legacyAt`), so a formula between highlighted words is coloured now.
    - Whitespace-only pieces with a line break (between blocks) are no longer marked; they showed as coloured slivers.
    - `NoteAnnotations.tsx`: the selectors are `[data-hl]`, not `mark[data-hl]` (clicking a formula opens its menu; the "no longer matches" check).
    - Verified in Chromium on scratch 4399/5199: an old-style quote across `$E=mc^2$` and `$m$` colours both; selecting inside `$a+b$` saves `$a+b$`; selecting "Then…" across a display integral saves it with the TeX; all placed again after reload; clicking a highlighted formula opens its menu. Rebuilt `web/dist`.
32. **Rename and delete files in the library** (2026-10-20; user: "in the files section, can you make a feature so that I delete/rename any files").
    - New `server/src/services/fileOps.ts`: `renameDocument` (same folder; the extension is kept; refuses empty, hidden, `/`, a taken name, or the path of a missing row, since `documents.path` is UNIQUE), `trashDocument` (freedesktop.org Trash: claims `info/<name>.trashinfo` with `wx`, then moves the file to `files/<name>`, `name.2.pdf` on a clash; copy + delete on EXDEV with the mtime kept; marks the row missing, so notes stay), `restoreDocument` (checks the `.trashinfo` `Path=` is this document's path and the place is free, moves it back, `missing = 0`). All run under `withLock(docId)` (now exported from `documentEditor.ts`).
    - Restoring from the file manager also works: the file comes back at the same path with the same mtime, so a rescan matches its missing row by path.
    - Config `trashDir` (`STUDYSPACE_TRASH_DIR`, default `$XDG_DATA_HOME/Trash` or `~/.local/share/Trash`). The test helper points it into the temp data dir.
    - Routes `POST /documents/:id/rename|trash|restore`; `tabSync` treats them as library changes, and another tab with the file open follows the rename or closes.
    - Web: `LibraryPanel` rows have ✏ and 🗑 on hover/focus, an inline name box (`FileNameInput`, the stem selected), a `DeleteDialog` (Enter = Move to Trash), and ↑/↓/→/←/F2/Del keys (`[data-lib-row]`; ↓ from the filter goes in). `App`: `renameFile`, `deleteFile` (undoable), `closeDocument`, global `F2` (`renameFile` shortcut). The undo stack with no PDF open is `LIBRARY_UNDO`, and Ctrl+Z/Ctrl+Y now work with no PDF open, so deleting the open file can be undone.
    - Not done: renaming or deleting folders.
    - Verified: typecheck; 86 tests (5 new in `fileops.test.ts`); Chromium on scratch 4399/5199 with a scratch Trash: rename by button and F2, undo/redo, ↓ from the filter, Del → dialog → Enter, the open file closes, undo/redo/undo of the delete, the clash message. Real PDFs unchanged; nothing went to the real Trash. Rebuilt `web/dist`.
33. **StudySpace on the phone: password, Wi-Fi and Tailscale** (2026-10-20; user: "how can I make it accessible on my phone so that I can read and edit files on my phone too"; chose "both" Wi-Fi and Tailscale, with a password).
    - Before: the server had no auth, no CSRF and no Host check, so anything that reached the port could read, rename, trash or rewrite PDFs, and six POST routes needed no body (a plain form post from any website could fire them). On plain http the app was a blank page: `crypto.randomUUID` (not there outside a secure context) ran when `tabSync.ts` loaded.
    - New `server/src/auth.ts` (`createAuth`), wired in `app.ts`:
      - `checkHost` (every request): the `Host` must be loopback, one of this computer's addresses or name (`os.networkInterfaces()`, re-read every 30 s), `*.ts.net`, or in `STUDYSPACE_ALLOWED_HOSTS`. Stops DNS rebinding.
      - `checkCsrf` (`/api` writes): needs `X-StudySpace: 1`. Config `requireCsrfHeader` (true; the test helper sets false for the old tests).
      - `requireLogin` (`/api` except `/health` and `/auth/*`): *local* = socket from loopback **and** Host a loopback name **and** no `X-Forwarded-For`. The Vite proxy sends `Host: 127.0.0.1:4317` (changeOrigin) and no XFF, so 5173 stays local. `tailscale serve` arrives from loopback with a `*.ts.net` Host, so it's remote. Remote needs `STUDYSPACE_PASSWORD` (else 403) and a session.
      - `/auth/login` (scrypt + `timingSafeEqual`, 5 wrong tries a minute per client → 429; the client is the first `X-Forwarded-For` entry when proxied), `/auth/status`, `/auth/logout`. Cookie `ss_session_<port>` (port in the name so a test server doesn't clobber the real login), HttpOnly, SameSite=Lax, 90 days, `Secure` behind https (`X-Forwarded-Proto` or a `*.ts.net` Host).
      - `localOnly`: `/fs/browse` and `/directories` writes. `/config` leaves out the paths for other devices and says `local`.
    - `db/sessions.ts` + migration **v8** (`sessions`, only the sha256 of each token; also `document_highlights` and `reading_progress.top` for item 34). `index.ts` prints the Wi-Fi address(es) when the host isn't loopback, or why phones can't log in.
    - Web: `lib/uuid.ts` replaces every `crypto.randomUUID`. `lib/api.ts` sends the header (also the raw `ocrImage` fetch) and calls `setAuthListener` on a 401. `components/LoginScreen.tsx` (`AuthGate` around `App` in `main.tsx`). Settings on a phone: folders read-only, *Log out of this device*. `lib/notify.ts` lets `copyText` (`lib/pageImage.ts`) say why copying fails on http instead of failing silently.
    - Touch: `lib/touchSelection.ts` (`useTouchSelection`: after a touch, a debounced `selectionchange` opens the bar, since a long-press selection sends no mouseup; `belowSelection` places it below the handles) in `PdfViewer` and `NoteAnnotations`. Row buttons show on `(hover: none)` screens. The PDF selection bar wraps and starts at the left edge below 640 px. Search is a button on phones; its box stays in the DOM (invisible) so the tap can focus it: iOS only opens the keyboard for a focus made in the tap itself. Page tools menu closes only on width changes (the phone keyboard changes the height). `#root` is `100dvh`. Manifest, 192/512 PNG icons and `apple-touch-icon` (rendered from the favicon with Playwright; there are no image tools), `theme-color`.
    - Tailscale itself isn't installed here and couldn't be tested; the user guide §15 has the steps.
    - Verified: typecheck; tests (9 new in `auth.test.ts`); build. Playwright with the iPhone 13 profile at `http://192.168.0.114:4399` (not a secure context; scratch server with `STUDYSPACE_HOST=0.0.0.0`, a password and scratch data): login (wrong password refused), library, row buttons without hover, a PDF, touch selection → bar → highlight saved, copy → the http message, a note, search, settings, log out. Desktop: a POST without the header → 403; a LAN GET without login → 401.
34. **HTML pages (Claude artifacts) and Markdown files in the library** (2026-10-20; user: "make a feature where I can edit claude artifacts like the way I'm reading and editing pdfs and pptx"; chose read + notes + highlights on saved `.html`, and `.md` too; no source editing, no sync to claude.ai).
    - `fileKinds.ts`: kinds `html` (`.html`, `.htm`) and `markdown` (`.md`, `.markdown`); `isPaged` (pdf, slides), `canEditFile` (pdf), `LIBRARY_EXTENSION` (titles). `resolveReadablePdf`, `editFile` and `/ocr` refuse the new kinds with `notPagesMessage` ("…is a Markdown file, not a PDF…"). `/file` sends `text/html` / `text/markdown` (+ `Content-Security-Policy: sandbox` for both). `GET /documents/:id/asset?path=` serves pictures next to a Markdown file (images only, inside its folder, sandboxed: an SVG could otherwise run scripts as StudySpace).
    - `db/documentHighlights.ts` + routes `/documents/:id/text-highlights`, `/text-highlights/:id`; `saveProgress(…, top?)` (left out = keep).
    - Web: `components/viewer/TextDocViewer.tsx`, mounted instead of `PdfViewer` when `!isPaged`, with the same handle (`goToPage(1, top)` scrolls to a fraction; `getPdf()` = null).
      - Markdown: `Markdown` with `structure={false}` (no notes restyling) and `assetUrl` (relative pictures); `.ss-doc` CSS (text size follows the zoom). Highlights reuse `rehypeNoteHighlights` + `selectionToAnchor`. `noteAnchors.normalise` keeps the last result, because every highlight is looked up in the same (possibly 500 KB) text.
      - HTML: `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads" srcdoc>` (no `allow-same-origin`: the page can't call the API, read the parent or use storage). `lib/artifactFrame.js` (plain JS, loaded `?raw`, inserted after `<head>`/`<html>`/doctype) talks by `postMessage` (`ss: "frame" | "parent"`; the parent checks `event.source`). It anchors selections like `noteAnchors` (its `locateQuote` is a copy) and paints with the **CSS Custom Highlight API**, so the page's DOM is never changed (React artifacts would break if their text nodes were wrapped); it repaints on DOM changes (`MutationObserver`). It forwards plain keys (no Ctrl/Alt/⌘, not typed into fields, not handled by the page), reports scrolling, and clicks on highlights via `caretPositionFromPoint`/`caretRangeFromPoint`.
      - `NotePopovers` is shared (types `TextAnchoredHighlight`), gained *Note* (`onQuote`) and the bar keys 1–5 / N / Delete (also in notes now).
      - App: `textHighlights` with undoable create/update/delete; `PAGED_ONLY` keys do nothing on these files (arrows then scroll); `ViewerToolbar` takes `kind` (only Select/Highlight); Bookmarks tab, page tools and page navigation hidden; notes are whole-document (`ResourcePanel`/`ResourceEditor` `paged`); page-tool pickers list only paged files; scroll position saved 700 ms after scrolling stops.
    - Limits: an artifact that saves in `localStorage` can't save here (the user's `Study_Planner.html` runs, but its "changes are saved on this device" doesn't persist inside StudySpace); CDN fonts/scripts need internet; React artifacts download as `.jsx` and aren't listed.
    - Verified: typecheck; 101 tests (6 new in `textdocs.test.ts`); build. Playwright on scratch 4399 (built app) and 5199 (Vite dev) with copies of the user's `Study_Planner.html`, `Compiler Revision Notes.md` and the 520 KB book `.md` (renders in about 1.5 s), plus test files: Markdown heading/formula/picture, select → bar → key 2, undo/redo, a highlight across a formula, Comment/Remove menu, N → whole-document note, scroll position kept over a reload; HTML: frame can't fetch the API (CORS), read the parent or use storage; highlight by bar and by key; a highlight on script-built text comes back after a reload; clicking a highlight in the frame opens its menu; `]` typed in the frame toggles the notes panel; T / Shift+T do nothing; the planner runs; PDFs unchanged. iPhone profile: touch selection in Markdown and inside the frame. Real PDFs: only the user's own Save to PDF (8086-Memory_Organization.pdf, 04:03, in its history).
35. **Tables copied from Gemini render in notes** (2026-10-20; user: "the note section can't render tables when written in the following format. look at the table at the end").
    - Gemini's copy breaks each table row over several lines (cell text, blank lines, `<br>` lines, then a line with just ` |`). A GFM row must be one line and a blank line ends the table, so only the header and the first half-row were a table. `<br>` showed as text: react-markdown turns raw HTML into text.
    - New `web/src/lib/tableRepair.ts` (`repairTables`, run before `normalizeMath` in `Markdown.tsx`): inside a table (header + delimiter row; fences skipped), a row without its closing `|` is joined with the following lines up to the line that closes it (`closingLine`: a line ending in `|` that doesn't start a new row; it gives up at a new row, heading, fence, delimiter or `---` rule, or after 40 lines, so a valid row without a trailing pipe is left alone). Runs of `<br>` become one. Rendering-time only: saved notes aren't changed, and old ones render too.
    - New `lib/rehypeBreaks.ts`: a raw `<br>` / `<br/>` becomes a `br` element; all other HTML still shows as text.
    - `index.css`: `.ss-md table` scrolls sideways (`display: block; overflow-x: auto`) and cells use `overflow-wrap: break-word`, because `.ss-md`'s `overflow-wrap: anywhere` let the narrow panel squeeze columns to a letter or two ("OPCO DE").
    - Verified: typecheck; the user's pasted answer through react-markdown + remark-gfm (`renderToStaticMarkup`): 2 table rows before, 7 after, 6 `<br>`s, no `&lt;br`, the heading after the table intact; well-formed tables, rows without trailing pipes, fenced code, `---` rules and a heading after a short row unchanged; a one-dash delimiter row repaired. Chromium on scratch 4399: the note's table (screenshot), words whole. Rebuilt `web/dist`.
36. **Note colours can be changed** (2026-10-21; user: "there are some default highlighting. make a feature so that I can change the colours of the default highlighting too").
    - `index.css`: the default colours are CSS variables on `:root` (`--ss-note-title`, `-h1`…`-h4`, `-group`, `-lead`, `-mark`); `.ss-title-hl`, `[data-level]`, `[data-lead]`, `[data-group]` and `.ss-pdf-hl` read them. Dark mode keeps its lower mix, so a chosen colour stays readable there too.
    - New `web/src/lib/noteColors.ts`: `NOTE_COLORS` (id, label, sample, default), `loadNoteColors`/`saveNoteColors` (only changed colours, `localStorage` key `ss-note-colors`, hex checked), `applyNoteColors` (inline variables on `<html>`), `installNoteColors` (called in `main.tsx`; follows other tabs through the `storage` event).
    - `SettingsDialog.tsx`: `NoteColorsSection` (also on a phone's Settings) with a `ColorRow` per colour: a sample drawn with the real note styles, `<input type="color">`, a hex box (applies once it is a valid `#rrggbb`, with or without `#`), ↺ to the default, *Reset all*. The `,` shortcut label now says "note colours".
    - Per browser, not on the server: no migration, and a phone can have its own. Not on the undo stack (a setting, not document data); ↺ and *Reset all* take it back.
    - Verified: typecheck; build; Chromium on scratch 4399/5199 with a seeded note: headings, labels and marks recolour live, the colour stays after a reload, a second tab follows *Reset all*. Real PDFs untouched by testing.
37. **Recolour one heading, label or mark in a note** (2026-10-21; user: "when I click on a text which is by default coloured, a popup menu will be shown to change the colours, similar to the popup menu shown for manual highlighting"). Item 36 (Settings) changes a kind everywhere; this changes one element.
    - Migration v9: `resources.styles` TEXT JSON `{ key: "#rrggbb" | "none" }`, default `'{}'`. `db/resources.ts` reads/writes it (PATCH without `styles` keeps them, so saving the note's text doesn't drop them); `app.ts` validates (`color` or `"none"`, ≤ 1000 keys); `pdfTools` copies them with the note. Edit snapshots copy whole rows, so page edits keep them. Test in `resources.test.ts`.
    - New `web/src/lib/rehypeNoteStyles.ts` (after `rehypeNoteStructure`, notes only): every `[data-level]`, `[data-group]`, `[data-lead]` and `.ss-pdf-hl` gets `data-sk` = kind (`h`, `group`, `lead`, `mark`) + `:` + its text (120 chars) + `#n` for repeats, and `style="--hl: …"` when picked. Overriding `--hl` keeps the dark-mode mix; `.ss-pdf-hl` now sets its own `--hl`, so a mark inside a recoloured heading keeps its colour.
    - `NoteAnnotations.tsx`: popover kind `style`; a click (no selection, not on a highlight or link) on `[data-sk]` opens `StyleMenu`: 9 swatches (`STYLE_COLORS` in `noteColors.ts`), any colour (`CustomColor`, applied on the native `change` so a drag isn't 50 undo steps), *No colour*, *Default*. Keys 1–9 / 0 / Delete (`styleColour`, `styleNone`, `styleDefault`). The title (`ResourcePanel`) opens it on right-click, because a click toggles the card. App `setNoteStyle` is undoable ("Change colour in note").
    - Verified: typecheck; 102 tests; build. Chromium on scratch 4399/5199: click heading → key 3, label → No colour, mark → swatch, title right-click → swatch; kept after reload; Default then Ctrl+Z; double-click in a heading still gives the selection bar. Rebuilt `web/dist`.

Last verification (2026-10-13): 74 server tests pass, typecheck and build pass, and Playwright browser tests of the Page tools menu, page-number fields, replace + undo, open-by-default cards, the unsaved-work prompt, two-tab sync, display-math layout, heading colours get-text/OCR (with stub OCR binaries), bookmarks, and extract/split/merge/turn/move passed on scratch copies.

---

## 5. Problems already solved (don't repeat them)

**Environment**

- `better-sqlite3` needs gcc, which isn't available, so the server uses `node:sqlite`.
- npm install scripts are blocked; `allowScripts` in the root package.json approves esbuild.
- nvm must be sourced in each Bash command, because shell state doesn't persist.

**PDF.js and React**

- pdf.js 6 has no `convertToViewportRectangle`; use `convertToViewportPoint` twice.
- Don't define components inside render functions; they remount every render.
- Highlighted text from pdf.js spans needs a space when the spans are joined.

**KaTeX**

- KaTeX CSS and the renderer must be the same version.
- `.katex-display` needs padding, or `\boxed` gets clipped.
- Money like `$100 … $100` is escaped by `escapeCurrency` in `lib/math.ts`, or remark-math pairs the dollars.

**Browser testing**

- With Playwright, use mouse coordinates for zero-width resize handles, and don't click inside a handle's hit area.
- Phone tests: Playwright's `devices["iPhone 13"]` without `defaultBrowserType`, in Chromium, at the LAN address (`http://192.168.0.114:4399`, which is not a secure context) with the scratch server on `STUDYSPACE_HOST=0.0.0.0`. Simulate a long-press selection by dispatching a `pointerdown` with `pointerType: "touch"`, then setting the selection.
- Sandboxed artifact frames: `page.frames()` reaches them, so `frame.evaluate` works.
- Playwright refuses to install Chromium on Ubuntu 26.04. Use `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium`, and a recent Playwright (1.64): the Chromium of 1.56 lacks `getOrInsertComputed`, which pdf.js needs, so PDFs don't open.

**Toolbar menus**

- The viewer toolbar uses `overflow-x-auto`, which also clips anything that sticks out vertically. The Page tools dropdown therefore uses `position: fixed`, placed from the button's position on screen. Any new dropdown in a scrolling bar must do the same.
- Use `NumberInput`, never a controlled `<input type="number">` that converts each keystroke with `Number(v) || 1`. That pattern makes the field impossible to clear.

**Seeing a web change**

- The server on 4317 also serves `web/dist`, which is only updated by `npm run build`. The user works on the Vite UI on 5173, which updates by itself.

**Real library**

- Today `CSE 315 - microcontrollers/MHE sir/Intro.pdf` was modified at 13:33 by the **user's own** "Save highlights into the PDF". This is legitimate, and it can be undone through its history entry. All other original PDFs are unchanged by testing.

---

## 6. Next steps

Nothing open. The user hasn't yet answered the offer to detect a PDF moved while open and show a clearer error.

Not done, mentioned to the user: renaming/deleting folders; pinch-to-zoom in the viewer on phones; a heading outline for Markdown/HTML; tabs on different devices don't update each other (BroadcastChannel is per browser).

Ideas the user hasn't asked for yet:

- Re-enable the AI assistant with a real provider (`server/src/ai/providers/`).
- Export notes.
- Full-text search inside PDFs.
