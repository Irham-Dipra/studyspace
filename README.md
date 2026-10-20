# StudySpace

A local-first PDF study workspace. StudySpace reads course PDFs straight from your folders and shows the notes, summaries, previous-year questions (PYQs), links and AI explanations that belong to the page you are reading.

- **Library (left):** finds PDFs in your configured folders, recursively, and groups them by folder.
- **Viewer (center):** PDF.js rendering with continuous scroll, exact current-page tracking, zoom (buttons, Ctrl+wheel, fit width/page), text selection, highlights, an area highlighter, a pen, an eraser and page editing.
- **Page resources (right):** shows only what is attached to the visible page, plus document-wide items. It updates as you scroll.

Everything runs on your machine. No account, no upload and no API key are needed.

📖 **Step-by-step instructions for every feature: [docs/USER_GUIDE.md](docs/USER_GUIDE.md)** (or press `?` in the app).

---

## Requirements

- Node.js **22.5+** (24 LTS recommended). StudySpace uses Node's built-in `node:sqlite`, so nothing has to be compiled.
- Linux, macOS or Windows (developed on Ubuntu).

If Node isn't installed:

```bash
wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install --lts
```

## Setup

```bash
npm install
cp .env.example .env      # then set STUDYSPACE_LIBRARY_DIRS to your PDF folder
```

You can also skip `.env` and add folders in the app under **Settings → Library folders** (it has a folder browser).

## Run

**Development** (API with auto-reload + Vite dev server with hot reload):

```bash
npm run dev
```

Open **http://127.0.0.1:5173**

**Production-style** (builds the UI, and one Node process serves both UI and API):

```bash
npm start
```

Open **http://127.0.0.1:4317**

**Tests:**

```bash
npm test           # backend: migrations, discovery, path guard, CRUD, page associations, PDF editing, AI hook
npm run typecheck  # server + web
```

## Where data lives

| What | Location |
| --- | --- |
| SQLite database | `~/.local/share/studyspace/studyspace.db` (or `$XDG_DATA_HOME/studyspace/`, or `STUDYSPACE_DATA_DIR`) |
| Previous versions of PDFs StudySpace edited (undo history, doubles as backup) | `~/.local/share/studyspace/history/<document-id>/` (last 10 per PDF) |
| Your PDFs | Stay where they are. They are never copied into the app. |
| Files deleted from the library | The desktop Trash, `~/.local/share/Trash/` (or `STUDYSPACE_TRASH_DIR`), so the file manager can restore them |
| Logins of other devices | The `sessions` table (only a hash of each cookie's token) |

The database is never placed inside the web root. The **Settings** dialog shows the exact path.

## Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUDYSPACE_LIBRARY_DIRS` | – | Folders added on first start (separate several with `:`). Later changes go through Settings. |
| `STUDYSPACE_EXCLUDES` | – | Comma-separated folder names or relative paths to skip, e.g. `Offllines` |
| `STUDYSPACE_DATA_DIR` | `~/.local/share/studyspace` | Database + backups |
| `STUDYSPACE_HOST` / `STUDYSPACE_PORT` | `127.0.0.1` / `4317` | Address. `127.0.0.1` = this computer only; `0.0.0.0` = also devices on the same Wi-Fi (they must log in). |
| `STUDYSPACE_PASSWORD` | – | Lets other devices (a phone over Wi-Fi or Tailscale) log in. Without it only this computer can use StudySpace. This computer never needs it. |
| `STUDYSPACE_ALLOWED_HOSTS` | – | Extra host names other devices may use, comma-separated. This computer's IP addresses and name, `localhost` and `*.ts.net` always work. |
| `STUDYSPACE_OCR_LANG` | `eng` | Tesseract language(s) for OCR, e.g. `eng+ben` (install `tesseract-ocr-ben`). |
| `STUDYSPACE_OCRMYPDF` / `STUDYSPACE_TESSERACT` | `ocrmypdf` / `tesseract` | OCR programs. Install with `sudo apt install ocrmypdf tesseract-ocr`. OCR only runs when you ask for it. |
| `STUDYSPACE_SOFFICE` | `soffice`, else `libreoffice` | LibreOffice, which turns slides (`.pptx`, `.ppt`) into a PDF when they are first opened. |
| `STUDYSPACE_TRASH_DIR` | `~/.local/share/Trash` (or `$XDG_DATA_HOME/Trash`) | Where files deleted in the library go (freedesktop.org Trash layout: `files/` and `info/`). |
| `STUDYSPACE_CONVERT_DIR` | snap: `~/snap/libreoffice/common/studyspace`; else `<dataDir>/convert-tmp` | Where LibreOffice works on a copy of the slides. A snap LibreOffice can't read `/tmp` or hidden folders. |
| `STUDYSPACE_HISTORY_LIMIT` | `10` | Undoable file edits kept per PDF (each keeps the previous file version). `0` disables undo for page edits / Save to PDF. |
| `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` | `none` | Optional AI integration (see below) |

Real environment variables override `.env`.

## Using it

- **On a phone:** set `STUDYSPACE_PASSWORD`, then either `STUDYSPACE_HOST=0.0.0.0` and `http://<this computer's IP>:4317` on the same Wi-Fi, or `tailscale serve --bg 4317` and the `https://….ts.net` address from anywhere. The phone uses the built app on 4317, so run `npm run build` after updates. Step by step: [docs/PHONE_SETUP.md](docs/PHONE_SETUP.md).
- **HTML pages and Markdown files:** `.html`/`.htm` (e.g. a Claude artifact saved from claude.ai) and `.md`/`.markdown` files are listed with the PDFs. They open as text that flows, with no pages; you can highlight their text and keep notes on them, and the file itself is never changed. An HTML page runs in a sandboxed frame (scripts allowed, no access to StudySpace or its storage).
- **Several PDFs at once:** Ctrl+click (or middle-click) a library entry to open it in a new browser tab. Tabs notify each other through `BroadcastChannel` and re-read whatever another tab changed. File edits reload the PDF, and edits are fingerprint-checked so a stale tab can never overwrite a newer file.
- **Unsaved work:** opening another PDF in the same tab asks first when highlights or bookmarks aren't saved into the file or a note is half written (Save to PDF and open / Open without saving / Stay here).
- **Notes & resources:** one combined list per page, grouped by type. Every card is open when a PDF is opened, with a **Close / Expand** button right after its title. Use **+ Add note or resource** in the right panel. Pick a type (Personal Note, Summary, PYQ, AI Explanation, External Link) and a scope:
  - *This page*
  - *Page range*
  - *Whole document*

  Content is Markdown with `$math$` support (KaTeX).
- **Annotate notes:** select text inside an expanded note or resource to highlight it or add a comment. Highlights are stored separately (`note_highlights` table) and anchored by quote and context, so the note's Markdown is never modified.
- **Select text** to get a small menu: highlight it in a colour, quote it into a new note, or copy it.
- **Tools** (toolbar or keys): `V` select · `H` highlight text · `A` highlight an area · `P` pen · `E` eraser · `Esc` back to select. Click an existing highlight to recolour it, delete it, or turn it into a note.
- **Slides:** `.pptx` and `.ppt` files show in the library (with a slides icon) next to PDFs. The first time one opens, LibreOffice turns a copy of it into a PDF (about 30–60 s), kept in `<dataDir>/converted/` and made again only when the slides change; after that it opens at once. Notes, highlights, drawings, bookmarks, Get text and pictures work as on a PDF. The slides file is never changed: page edits, Save to PDF and OCR are off, and *Extract pages* makes an editable PDF.
- **Save to PDF:** highlights and drawings are stored instantly in the database. **Save to PDF** writes them into the original file as standard PDF Highlight/Ink annotations, so Okular, Evince, Acrobat and browsers show them too. Saving again replaces StudySpace's earlier annotations instead of duplicating them, and annotations from other tools are left untouched.
- **Page tools:** the 🗑 button (or `Shift+Delete`) deletes the current page, and 🔧 offers *insert blank pages*, *insert pages from another PDF*, *replace this page* (with pages of any library PDF, one for one, so page numbers and notes stay put), *turn pages*, *move pages* and *delete several pages*. These rewrite the original file. Notes, ranges, highlights and your reading position stay with their content as page numbers shift. Notes that belonged only to a deleted page are **never moved onto another page**: they are removed with it (undo brings them back), or kept as whole-document notes if you choose that in the dialog.
- **New PDFs:** 🔧 → *Extract pages to a new PDF* (optionally removing them from the original), *Split this PDF* (every N pages, by page ranges, or by chapter bookmarks) and *Merge PDFs* (any library PDFs and page lists, in your order, with a bookmark per source). New files go into a library folder you pick, never overwrite existing files, show up in the library at once, and bring along the copied pages' notes, highlights and bookmarks. The source PDFs are only read.
- **Bookmarks:** the left column's *Bookmarks* tab shows the PDF's own outline (imported the first time it opens) and lets you add (`B`), rename, nest, reorder and delete bookmarks. They jump to the exact spot on the page and follow their pages through page edits. **Save to PDF** writes them into the file as a standard outline.
- **Undo / redo everything:** `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`), or the ↶ ↷ buttons. This covers notes, resources, highlights, drawings, bookmarks, page edits and Save to PDF. Undoing a page edit restores the previous file version exactly and puts every note back on its original page.
- **Shortcuts for everything:** every feature has a key, shown beside it (menu items, buttons, tooltips) and listed in the searchable `?` help. All keys live in one registry, `web/src/lib/shortcuts.ts`, which the handlers, tooltips and help screen all read. Examples: `T` page tools, `I`/`Shift+I` insert, `R` replace, `Shift+R` turn, `M` move, `X` extract, `S` split, `Shift+M` merge, `Shift+C` copy page as image, `Shift+H` cut page in half, `B` bookmark, `N` note, `L`/`Shift+B` files/bookmarks, `/` filter, `1`–`5` colours, `Ctrl+S` save, `Ctrl+K` search.
- **Screenshot to clipboard:** `Q` (or the crop button) dims the window; click two corners or drag, and that part of the window is copied as a PNG (`Enter` takes the whole window). The window is drawn in-page with `modern-screenshot`, so no screen-sharing prompt.
- **Save pages as pictures:** `Shift+S` saves this page, chosen pages or the whole PDF as PNG or JPEG at 100 to 300 dpi; several pages come as one `.zip` (a small store-only zip writer, `web/src/lib/zip.ts`).
- **Keyboard-first forms:** in any dialog or form, `↓` jumps to the next empty text box and `↑` to the previous one (`web/src/lib/fieldNav.ts`).
- **Get text / OCR in one key:** PDF text of this page / chosen pages / whole PDF with `Shift+T` / `Shift+G` / `Shift+A`; OCR with `Shift+O` / `Shift+P` / `Shift+W`. *Mark my highlights* (toggle with `H`) wraps text you highlighted (StudySpace highlights, and Highlight annotations saved in the PDF by any reader) as `==text==`, which notes render highlighted.
- **Get text of a bookmark's section, with your notes:** `Shift+E` (text) / `Shift+U` (OCR), `4` in the Get text window, or `T` / `O` on a bookmark. The text runs from the bookmark's heading to the next bookmark's heading, even mid-page (a chapter includes its sections). *Include my notes* (`I`) puts each note in as a quote after the last of its pages being read.
- **Area highlight by corners:** with the area (`A`) or region-OCR (`O`) tool, click the top-left then the bottom-right corner (or drag).
- **Copy pages as images:** `Shift+C` copies the current page to the clipboard as a PNG. `Shift+H` cuts it in half (top/bottom or left/right, adjustable) and lets you copy either half (`1`/`2`) or both (`B`; rich editors get two pictures), or save both as PNGs (`S`).
- Reading position and zoom are remembered per document. **Continue reading** in the library lists recent documents.
- **Resizable columns:** drag the dividers between the three columns (double-click resets; widths are remembered).
- The UI is responsive: below 1024 px the side panels become slide-over drawers. There is also a dark mode.

## How it works

```
studyspace/
├── server/                 Express + TypeScript API
│   ├── src/db/             node:sqlite, ordered transactional migrations, one store per entity
│   ├── src/library/        recursive scanner, content fingerprints, rename-aware sync, path guard
│   ├── src/pdf/            pdf-lib operations, display→PDF coordinate mapping, page remapping
│   ├── src/services/       document editor (atomic write + backup + DB remap in one transaction)
│   ├── src/ai/             provider interface + registry (disabled by default)
│   └── test/               Vitest + Supertest
└── web/                    React + Vite + Tailwind v4 + PDF.js + lucide-react
    └── src/components/viewer/   virtualised viewer, page renderer, annotation overlay
```

**Stable document IDs.** Each PDF gets a random UUID. Its *fingerprint* is a SHA-256 of its size plus its first and last 256 KiB, and it is used to recognise the file after a rename or move. On rescan:
- A known path keeps its ID.
- An unknown path whose fingerprint matches a document whose old path no longer exists is treated as a move: the same ID, so notes are kept.
- A file that disappears is marked *missing* rather than deleted, so its notes come back when it returns.

When StudySpace edits a file itself, it records the new fingerprint immediately.

**File access.** PDFs are streamed from disk with HTTP Range support (big textbooks open in about a second). Every read and write resolves the real path, following symlinks, and checks that it lies inside an enabled library folder. The scanner does not follow directory symlinks, and it skips file symlinks that point outside the folder. The server listens on `127.0.0.1` only.

**Edits are safe and undoable.**
1. Edits are serialised per document.
2. Before writing, the current file is stored in `history/`, together with a snapshot of the document's notes, page associations, highlights and reading position (`document_history` table).
3. The new version is written to a temp file in the same folder, `fsync`ed, then atomically renamed over the original.
4. If the client's fingerprint doesn't match the file on disk (it changed elsewhere), the edit is refused with 409.

Undo (`POST /documents/:id/history/:editId/undo`, latest edit only) restores the previous file and the snapshot. Items created after the edit are mapped back through the inverse page mapping. Undo is refused if another program changed the file since.

In the browser, a per-document undo stack also covers notes and annotations. Deleted items are recreated with their original IDs, so undo and redo can be replayed safely.

**Page-scoped resources.** `resources` holds the content. `resource_pages(resource_id, page_start, page_end)` holds the page association, and a document-wide resource has no row. The page query is `scope = 'document' OR page_start <= p <= page_end`. The UI loads the document's resources once and filters by page in memory, so the right panel updates without a network round trip.

**Annotation geometry** is stored normalised to the displayed page (0–1). It is mapped into PDF user space only when saving, which takes `/Rotate` and the CropBox into account. When viewing, annotations that StudySpace wrote into the file are hidden from the PDF.js canvas and drawn from the database instead, so they're never shown twice and stay editable.

### Database schema

`schema_migrations`, `directories`, `documents`, `resources` (with `styles`, colours picked for single headings or labels), `resource_pages`, `annotations`, `reading_progress` (with `top` for documents without pages), `document_history`, `note_highlights`, `bookmarks`, `document_highlights` (text highlights on HTML / Markdown), `sessions` (other devices' logins). Migrations live in `server/src/db/migrations.ts`:
- They are append-only and applied in order.
- Each runs in its own transaction and is rolled back completely on failure.
- The server refuses to open a database created by a newer version.

To change the schema, add a new migration with the next version number.

## Adding an AI provider

The app is fully functional without AI, and the AI buttons are currently hidden from the notes panel. The server API (`/api/ai/status`, `/api/ai/generate`) and the client helper `extractText()` in `web/src/lib/pdf.ts` are kept so the buttons can come back once a provider exists. To plug in a model:

1. Create `server/src/ai/providers/<name>.ts` implementing `AIProvider` from `server/src/ai/types.ts`. It needs one method, `generate({ task, documentTitle, pageStart, pageEnd, text }) → { title, content }`, and `buildPrompt()` in `ai/index.ts` gives you a ready prompt.
2. Register it in the `registry` in `server/src/ai/index.ts`.
3. Set `AI_PROVIDER=<name>` (plus `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL` as needed) in `.env`.

The browser extracts the page text with PDF.js, the server calls the provider, and the answer is saved as a page-scoped *AI Explanation* or *Summary* resource. A test in `server/test/ai.test.ts` shows a provider end to end.

## API overview

All endpoints live under `/api`.

**Access**
- Requests from this computer (sent from 127.0.0.1 to `localhost` / `127.0.0.1`) need no login. Anything else (Wi-Fi, `tailscale serve`) needs the `ss_session_<port>` cookie from logging in.
- Every write (any method but GET/HEAD/OPTIONS) must carry the header `X-StudySpace: 1`. Other websites can't send it, so they can't change anything here.
- The `Host` must be a name of this computer (stops DNS rebinding); see `STUDYSPACE_ALLOWED_HOSTS`.
- `GET /auth/status` → `{ local, loggedIn, passwordSet }`; `POST /auth/login` `{ password }` (5 wrong tries a minute per client, then 429); `POST /auth/logout`.
- Adding, changing or browsing folders (`/directories` writes, `/fs/browse`) works only on this computer.

**Library and folders**
- `GET /library`, `POST /library/scan`, `GET /search?q=`, `GET /recent`
- `GET|POST /directories`, `PATCH|DELETE /directories/:id`, `GET /fs/browse?path=`

**Documents**
- `GET /documents/:id`, `GET /documents/:id/file` (stream; slides are served as their converted PDF; HTML as `text/html` with `Content-Security-Policy: sandbox`, Markdown as `text/markdown`), `PATCH /documents/:id/meta`
- `GET /documents/:id/asset?path=img/x.png`: a picture next to a Markdown file (pictures only, in its folder or below; sent sandboxed)
- `POST /documents/:id/convert` (slides: turn them into a PDF if needed and wait; `{ ready: true }`)
- `POST /documents/:id/rename` `{ name }` (same folder, the extension is kept; refuses a name that's taken), `POST /documents/:id/trash` (to the desktop Trash, `{ trashName }`; the row is kept as missing, with its notes), `POST /documents/:id/restore` `{ trashName }` (puts it back if its place is free)
- `GET|PUT /documents/:id/progress` `{ page, zoom, top? }` (`top`: how far down an HTML / Markdown document, 0–1; left out, the stored one is kept)

**Resources**
- `GET /documents/:id/resources[?page=N]`, `POST /documents/:id/resources`
- `GET|PATCH|DELETE /resources/:id` (body may carry `styles`: `{ "<element key>": "#rrggbb" | "none" }`)

**Highlights inside notes**
- `GET /documents/:id/note-highlights`, `POST /resources/:id/highlights` `{ color, quote, prefix, suffix, comment }`
- `PATCH|DELETE /note-highlights/:id`

**Highlights on HTML / Markdown documents** (anchored the same way: quote + context)
- `GET|POST /documents/:id/text-highlights` `{ id?, color, quote, prefix, suffix, comment }`
- `PATCH|DELETE /text-highlights/:id`

**Annotations**
- `GET|POST /documents/:id/annotations`, `PATCH|DELETE /annotations/:id`
- `POST /documents/:id/annotations/save` (writes highlights, drawings and the bookmark outline into the PDF)

**Bookmarks (the PDF outline)**
- `GET /documents/:id/bookmarks` → `{ imported, bookmarks }`
- `POST /documents/:id/bookmarks/import` `{ entries: [{ title, page, top?, children? }] }`: stores the PDF's own outline (read by the browser with pdf.js). It runs once per PDF; later calls change nothing.
- `POST /documents/:id/bookmarks` `{ id?, title, page, top?, parentId?, position? }`, `PATCH|DELETE /bookmarks/:id` (deleting removes the nested bookmarks too)
- `top` is the spot on the page (0 = top, 1 = bottom; `null` = top of the page). Siblings are ordered by `position`.

**Page editing**
- `POST /documents/:id/pages/insert-blank` `{ after, count, fingerprint }`
- `POST /documents/:id/pages/insert-from` `{ after, sourceDocumentId, fromPage, toPage, fingerprint }`
- OCR runs on a temporary copy and never changes the library file until *apply*:
  - `GET /ocr/status`
  - `POST /documents/:id/ocr` `{ pages, fingerprint }` → job
  - `GET /ocr/jobs/:id` (state/progress)
  - `GET /ocr/jobs/:id/file` (the OCRed copy)
  - `POST /ocr/jobs/:id/apply` `{ fingerprint }`: adds the invisible text layer as an undoable edit (`kind: "ocr"`)
  - `DELETE /ocr/jobs/:id`
  - `POST /ocr/image` (PNG body → `{ text }`, region OCR with Tesseract)
- `POST /documents/:id/pages/replace` `{ page, sourceDocumentId, fromPage, toPage, keepAnnotations?, fingerprint }`: replaces pages `page…page+(toPage−fromPage)`. The page count is unchanged, and highlights on the replaced pages are removed unless `keepAnnotations` is set.
- `POST /documents/:id/pages/delete` `{ pages, fingerprint, orphans: "delete" | "document" }`
- `POST /documents/:id/pages/rotate` `{ pages, angle: 90 | 180 | 270, fingerprint }` (clockwise; highlights turn with their pages)
- `POST /documents/:id/pages/move` `{ pages, after, fingerprint }` (moves the pages, in order, to just after page `after`; `0` = to the start)

**New PDFs (extract, split, merge)**: these only read the source PDFs.
- `GET /library/folders`: the folders inside library folders where new PDFs can go
- `POST /pdf-tools/create` `{ folder, newFolder?, outputs: [{ name, segments: [{ documentId, pages?, title? }] }], copyNotes, copyHighlights, copyBookmarks, bookmarkPerSource }` → `{ folder, documents }`
  - Each output is one new file built from the segments in order. A segment without `pages` takes every page.
  - The folder must be inside an enabled library folder (and not excluded). Names are sanitised, and existing files are never overwritten (`name (2).pdf`).
  - The new files are added to the library with the copied pages' notes (with their note highlights), highlights and bookmarks.
- `GET /documents/:id/history`, `POST /documents/:id/history/:editId/undo`

File edits return the updated document plus an `editId` for undo.

**AI**
- `GET /ai/status`, `POST /ai/generate`

## Troubleshooting

- **"This PDF is encrypted"**: pdf-lib can't rewrite encrypted PDFs. You can still read them, add notes and highlight them (highlights stay in the database), but saving into the file and page edits aren't available.
- **"The PDF file is read-only"**: StudySpace needs write permission on a file to save annotations or edit pages.
- **"The PDF changed on disk since it was opened"**: another program modified it. Reopen the document and try again.
- **Restoring a previous version by hand**: copy a file from `~/.local/share/studyspace/history/<document-id>/` back over the original while the app is stopped, then rescan. Normally `Ctrl+Z` does this for you.
