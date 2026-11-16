# StudySpace for developers

How StudySpace works inside, its HTTP API and its database. To install and run it, see the [README](../README.md); for using it, the [user guide](USER_GUIDE.md). [CLAUDE.md](../CLAUDE.md) and [HANDOFF.md](../HANDOFF.md) hold the full development notes: the codebase map, conventions, test-safety rules and the history of every feature.

## Working on it

```bash
npm install
npm run dev        # API on 4317 with auto-reload (tsx watch) + Vite with hot reload (port 5173, or STUDYSPACE_WEB_PORT)
npm run typecheck  # server + web
npm test           # server tests (Vitest + Supertest), with temp folders and generated PDFs
npm run build      # web/dist + server/dist; npm start then serves both on 4317
npm run check      # what this computer has and lacks (scripts/check-requirements.mjs)
```

- npm workspaces: `server/` (Express 5, TypeScript, Node's built-in `node:sqlite`, pdf-lib) and `web/` (React, Vite, Tailwind v4, pdfjs-dist). In dev, Vite proxies `/api` to the server; in production the server also serves `web/dist`.
- Keyboard shortcuts live in one registry, `web/src/lib/shortcuts.ts`. After changing one, regenerate the user guide's §12 tables with `npx tsx scripts/shortcut-tables.mts`.
- The OCR and slides tests use stub programs written as `#!` scripts, so they are skipped on Windows.
- Your real PDFs are rewritten by in-app edits. Test with copies, a separate data folder and another port: `STUDYSPACE_PORT=4399 STUDYSPACE_DATA_DIR=<scratch>/data STUDYSPACE_LIBRARY_DIRS=<scratch>/lib`.

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

**File access.** PDFs are streamed from disk with HTTP Range support (big textbooks open in about a second). Every read and write resolves the real path, following symlinks, and checks that it lies inside an enabled library folder. The scanner does not follow directory symlinks, and it skips file symlinks that point outside the folder. By default the server listens on `127.0.0.1` only (see `STUDYSPACE_HOST` for phones).

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

`schema_migrations`, `directories`, `documents`, `resources` (with `styles`, colours picked for single headings or labels), `note_markers` (markers on pages that open a note at a passage: page, spot, quote + context), `resource_pages`, `annotations` (kinds `highlight`, `area`, `ink`, `text`), `reading_progress` (with `top` for documents without pages), `document_history`, `note_highlights`, `bookmarks`, `document_highlights` (text highlights on HTML / Markdown), `sessions` (other devices' logins). Migrations live in `server/src/db/migrations.ts`:
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
- `POST /images` (the picture as the raw body, `image/png|jpeg|gif|webp`; checked by its first bytes, no SVG) → `{ name, src }`; `GET /images/:name`. A picture is a note whose whole content is `![](/api/images/<sha256>.<ext>)`; the app shows those in the Pictures section (slides over the notes column), not in the notes list. Files live in `<dataDir>/images/`, named by content hash, never deleted.
- `GET /documents/:id/note-markers`, `POST /resources/:id/markers` `{ page, x, y, quote?, prefix?, suffix? }`, `PATCH|DELETE /note-markers/:id`

**Highlights inside notes**
- `GET /documents/:id/note-highlights`, `POST /resources/:id/highlights` `{ color, quote, prefix, suffix, comment }`
- `PATCH|DELETE /note-highlights/:id`

**Highlights on HTML / Markdown documents** (anchored the same way: quote + context)
- `GET|POST /documents/:id/text-highlights` `{ id?, color, quote, prefix, suffix, comment }`
- `PATCH|DELETE /text-highlights/:id`

**Annotations**
- `GET|POST /documents/:id/annotations`, `PATCH|DELETE /annotations/:id` (PATCH: `color`, `opacity`, `text`, `rects`, `strokeWidth`; a text box's `strokeWidth` is its font size as a share of the page width)
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
