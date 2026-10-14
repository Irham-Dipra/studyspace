# StudySpace — guide for Claude

StudySpace is a local-first PDF study app: library on the left, PDF viewer in the middle, notes on the right.
This file is the short version. **[HANDOFF.md](HANDOFF.md)** has the full architecture and the detailed history of every feature;
[README.md](README.md) covers setup, the API and the schema; [docs/USER_GUIDE.md](docs/USER_GUIDE.md) explains every feature to the user.

Status as of **2026-10-14**.

## Run it

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"   # needed in every shell (Node 24 via nvm)
npm run dev          # server http://127.0.0.1:4317, UI http://localhost:5173
npm run typecheck    # server + web
npm test             # server tests (vitest): 74 passing
npm run build
```

Stack: npm workspaces. `server/` is Express 5 + TypeScript + `node:sqlite` (no gcc, so no native modules) + pdf-lib.
`web/` is React + TypeScript + Vite + Tailwind v4 + pdfjs-dist + react-markdown/KaTeX. Config lives in `.env` (the user's file, not committed; see `.env.example`).

## ⚠️ Safety rules (always)

The user's real PDFs are in `/home/dipra/Buet/3-1`. In-app edits overwrite the original PDF on purpose, so **testing must never touch them**.

- Never test on the user's own instance (ports 4317/5173, real DB in `~/.local/share/studyspace`). Its server runs `tsx watch`, so a new migration runs on the real DB as soon as the code is saved.
- Test on ports **4399/5199**, with a brand-new scratch data dir and scratch *copies* of PDFs:
  `STUDYSPACE_PORT=4399 STUDYSPACE_DATA_DIR=<scratch>/data STUDYSPACE_LIBRARY_DIRS=<scratch>/lib npx tsx src/index.ts` (in `server/`) and
  `STUDYSPACE_PORT=4399 npx vite --port 5199 --strictPort` (in `web/`).
- Test scripts must abort if `/api/library` lists anything under `/home/dipra/Buet`.
- Reading real PDFs is fine (copying them, read-only GETs to 4317). Check real PDF mtimes after testing; when one changed, check its `/api/documents/:id/history` on 4317 to confirm it was the user's own edit.
- Kill only processes you started (find the PID with `ss -ltnp`); never `pkill`.
- curl isn't installed: use `node -e "fetch(…)"`. Browser tests use Playwright from the scratchpad.
- Write text containing backticks with quoted heredocs (`<<'EOF'`).

## Conventions

- **Every keyboard shortcut lives in `web/src/lib/shortcuts.ts`.** Handlers use `matches(e, id)`; the UI shows keys with `KeyHint` / `withKey`. The help screen is generated from it. The user guide §12 tables are generated with a small tsx script, so regenerate them when keys change. The user wants to do almost everything from the keyboard, and wants the key shown beside every feature.
- Every change is undoable (`lib/undo.ts`; file edits keep the previous file in the data dir's `history/`).
- New PDFs are only written inside enabled library folders, never overwriting (`name (2).pdf`).
- Write user-facing text in plain, short English.
- Git repo since 2026-10-14, branch `main`. `.env`, `node_modules` and `dist` are ignored.
- After a feature: update the user guide, README, HANDOFF.md, and the "Progress" list below.

## Progress to date

All done and verified in the browser on scratch copies, unless marked otherwise.

1. Library, viewer, notes scoped to a page, a range or the whole PDF (5 kinds), reading progress, text and area highlights, Save to PDF, insert pages.
2. Delete pages (notes stay on the right page), file-edit undo, user guide.
3. LaTeX in notes: inline/display math, `\$`, `\boxed` (keep katex pinned to ~0.16.47).
4. Resizable columns; notes and resources merged into one list; cards open by default.
5. Highlights and comments inside notes; Esc closes floating bars.
6. Page-tools menu fix, clearable page-number fields (`NumberInput`), replace pages.
7. Several browser tabs kept in sync; prompt for unsaved work.
8. Easier-to-read notes: equation layout, heading and keyword colours.
9. Get text / OCR: pages or a drawn region, to Markdown or plain text; optional OCR text layer added to the PDF (undoable). Needs `ocrmypdf` + `tesseract` (installed).
10. Bookmarks: read the PDF's outline, edit it, save it into the PDF.
11. PDF tools: extract, split, merge (new files), turn and move pages (undoable).
12. A keyboard shortcut for every feature, shown beside it and in the `?` help; copy a page as an image; cut a page in half.
13. Get-text keys; highlighted text marked as `==text==` in extracted text; boxes made with two clicks.
14. Save pages as pictures (PNG/JPEG, several in a .zip); ↑/↓ move between text boxes.
15. Screenshot any part of the window to the clipboard (`Q`).
16. **In progress: notes and bookmark sections in Get text** (started 2026-10-14).
    - *Include my notes* (`I`): your notes go into the extracted text as quotes, after the last page each note is for. Notes for the whole PDF go at the end, but only when the whole PDF is read. Remembered between uses.
    - *A bookmark's section* (`4` in the window; `Shift+E` text, `Shift+U` OCR; `T`/`O` on a row of the bookmarks list or its ⋯ menu; Page tools menu). A section runs from the bookmark's page to where the next bookmark starts. By default it includes the bookmarks nested inside it, so a chapter runs to the next chapter. The window has a find box: ↑/↓ pick, Enter starts.
    - Code: `lib/notesText.ts`, `bookmarkPages`/`flattenBookmarkTree` in `lib/outline.ts`, `afterPage` option in `lib/pdfToMarkdown.ts`, `BookmarkPicker` in `GetTextDialog.tsx`.
    - Done: typecheck, tests and build pass, and the section and note-placement logic was checked with a script.
    - **Still to do:** the browser test, which was cut off before it reported, then the docs (user guide §9 and §12, README, HANDOFF item 24).

## Open questions for the user

- Detect a PDF that was moved while open, and show a clearer error (offered on 2026-10-13, no answer yet).
