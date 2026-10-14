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
    - Highlighter colours: the card title has `.ss-title-hl` (pink). `rehypeNoteStructure` (formerly rehypeHeadingLevels) sets a relative `data-level` on headings: 1 orange, 2 yellow, 3 green, 4+ blue. It also sets `data-lead` (1 top-level, 2 nested) on a list item's leading `<strong>`, or on a leading `<em>` that ends in ":", which renders violet. Dark mode uses a 32%/20% mix.
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
      - The user guide §12 tables were generated from it with a small tsx script; regenerate them if keys change.
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

24. **Notes and bookmark sections in Get text** (in progress, 2026-10-14; user: "add options to include the notes saved by me for the pages too. also add feature to get text/run ocr from a bookmark to the end of that bookmark").
    - **Include my notes** (`I` in the window; localStorage `ss-text-notes`, off by default):
      - `lib/notesText.ts` `notesForText` puts each page or range note (any kind) after the last page being read that it covers. Whole-PDF notes go at the end, only when the whole PDF is read.
      - In Markdown a note is a blockquote, `> **My note: title** *(page 3)*`; in plain text it is `[My note: title (page 3)] … [end of note]`.
      - `extractPages` takes an `afterPage` map. The dialog's `regenerate` now takes a `Build` object `{format, marks, notes}`.
    - **A bookmark's section:**
      - `TextPreset.mode` gains `"bookmark"`, plus an optional `bookmarkId` (the default is `currentBookmarkId`).
      - `lib/outline.ts` `bookmarkPages(ordered, id, pageCount, withInside)` runs from the bookmark's page to the start of the earliest later bookmark. That bookmark's page is included when its `top` > 0.15. With `withInside` (the default), nested bookmarks are skipped, so a chapter runs to the next chapter.
      - `BookmarkPicker` in `GetTextDialog.tsx`: a find box (`data-arrow-nav="off"`) where ↑/↓/PgUp/PgDn pick, Enter or a double-click starts, and a checkbox includes the nested bookmarks.
      - Keys: `4` in the window; `Shift+E` / `Shift+U` globally; `T` / `O` on a bookmarks-list row; also in the row's ⋯ menu and in the Page tools menu.
    - **Status:**
      - Typecheck, tests and build pass. The section and note-placement logic was checked with a tsx script.
      - **The browser test hasn't run to the end yet** (`pw/sect1.mjs` in the scratchpad was cut off).
      - The user guide and README are not updated yet.

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

**Browser testing**

- With Playwright, use mouse coordinates for zero-width resize handles, and don't click inside a handle's hit area.

**Toolbar menus**

- The viewer toolbar uses `overflow-x-auto`, which also clips anything that sticks out vertically. The Page tools dropdown therefore uses `position: fixed`, placed from the button's position on screen. Any new dropdown in a scrolling bar must do the same.
- Use `NumberInput`, never a controlled `<input type="number">` that converts each keystroke with `Number(v) || 1`. That pattern makes the field impossible to clear.

**Real library**

- Today `CSE 315 - microcontrollers/MHE sir/Intro.pdf` was modified at 13:33 by the **user's own** "Save highlights into the PDF". This is legitimate, and it can be undone through its history entry. All other original PDFs are unchanged by testing.

---

## 6. Next steps

Open: finish item 24 (browser test, docs). The user hasn't yet answered the offer to detect a PDF moved while open and show a clearer error.

Ideas the user hasn't asked for yet:

- Re-enable the AI assistant with a real provider (`server/src/ai/providers/`).
- Export notes.
- Full-text search inside PDFs.
