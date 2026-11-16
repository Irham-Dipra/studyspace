# StudySpace

**A local-first study workspace for your course PDFs.** Your library on the left, the PDF in the middle, and the notes for the page you're reading on the right.

StudySpace reads your PDFs where they already are, keeps everything on your own computer and works fully offline: no account, no upload, no API key. It runs on **Windows, macOS and Linux**, and in any modern browser, including your phone's.

<!-- To add a screenshot: save it as docs/screenshot.png, then put this line here: ![StudySpace](docs/screenshot.png) -->

## Features

- **Library:** finds the PDFs, slides (`.pptx`, `.ppt`), HTML pages and Markdown files in your folders, groups them by folder, and remembers where you stopped reading. You can rename, delete and hide files, and filter and search everything (`Ctrl+K`).
- **Notes that follow the page:** each note belongs to a page, a page range or the whole file, and the notes panel always shows the ones for the page in view. Notes are Markdown with LaTeX math (KaTeX), tables and pictures, and you can highlight or comment inside them. Notes are kept in five kinds: personal notes, summaries, previous-year questions, AI explanations and links.
- **Mark up the PDF:** text and area highlights, a pen, an eraser, text boxes and note markers. *Save to PDF* writes them into the file as standard annotations, so other PDF readers show them too.
- **Page tools:** insert, delete, replace, rotate and move pages, or extract, split and merge into new PDFs. Your notes stay on the right pages through every edit.
- **Bookmarks:** the PDF's own outline is read in. You can edit it and save it back into the file.
- **Get text and OCR:** turn pages, a bookmark's section or a drawn region into Markdown or plain text, optionally with your highlights and notes included. Scanned pages can be OCRed and their text added to the PDF.
- **Reading tools:** two PDFs side by side, back and forward through jumps, pages saved as pictures, any part of the window copied to the clipboard as a screenshot.
- **Export:** a file's notes as Markdown files in a `.zip`, its pages as pictures or its text, also for several files at once.
- **Undo everything:** `Ctrl+Z` covers notes, highlights, bookmarks and even page edits. Edited PDFs keep their previous versions as a backup.
- **Keyboard first:** every feature has a key, shown beside it. Press `?` in the app for the full list.
- **On your phone:** open it over your Wi-Fi or Tailscale with a password, or install it as a full-screen app; the page gets the whole screen, with pinch zoom and a sideways mode for slides ([phone setup](docs/PHONE_SETUP.md)).

Every feature, step by step: **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)**.

## Quick start

You need **Node.js 24 or newer** and **Git**. [REQUIREMENTS.md](REQUIREMENTS.md) lists everything, with install commands for each system.

```bash
git clone https://github.com/YOUR-USERNAME/studyspace.git
cd studyspace
npm install
npm run check
npm run dev
```

`npm run check` reports anything this computer is missing. Once `npm run dev` is running, open **http://localhost:5173** and add the folder holding your PDFs under **⚙ Settings → Library folders**.

## Run it on another PC, step by step

### 1. Install Node.js and Git

| System | Commands |
| --- | --- |
| **Windows 10/11** (PowerShell) | `winget install -e --id OpenJS.NodeJS.LTS`<br>`winget install -e --id Git.Git`<br>Then **close and reopen** the terminal. |
| **macOS** | Install [Homebrew](https://brew.sh), then `brew install node git` |
| **Ubuntu / Debian** | `sudo apt install git curl`<br>`curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh \| bash`<br>Reopen the terminal, then `nvm install 24` |
| **Fedora / Arch** | `sudo dnf install git nodejs` or `sudo pacman -S git nodejs npm` (check that `node -v` says 24 or newer; if not, use nvm as on Ubuntu) |

You can also download Node.js from [nodejs.org](https://nodejs.org) and Git from [git-scm.com](https://git-scm.com). Check both with `node -v` (it should say v24 or newer) and `git --version`.

LibreOffice (for slides) and OCRmyPDF/Tesseract (for OCR) are optional. You can add them later: see [REQUIREMENTS.md](REQUIREMENTS.md).

### 2. Get the code

```bash
git clone https://github.com/YOUR-USERNAME/studyspace.git
cd studyspace
```

Without Git, use **Code → Download ZIP** on GitHub, unzip it, and open a terminal in that folder.

### 3. Install the npm packages

```bash
npm install
```

This downloads the packages listed in `package.json` (the exact versions are pinned in `package-lock.json`) into `node_modules/`. It takes a minute or two and needs no compiler: the few native parts come prebuilt for Windows, macOS and Linux.

### 4. Check the computer

```bash
npm run check
```

Each line is `[ok]`, `[--]` (optional and missing, which is fine) or `[!!]` (required and missing). Fix the `[!!]` lines and run it again.

### 5. Start it

```bash
npm run dev
```

Open **http://localhost:5173** and add your PDF folder under **⚙ Settings → Library folders**: browse to it, or type its path, such as `D:\Courses` or `/home/you/Courses`. Leave the terminal open while you study, and press `Ctrl+C` in it to stop.

Next time, you only need to open a terminal in the `studyspace` folder and run `npm run dev`.

### Optional: a settings file

Copy the example and edit it. It can set your PDF folder, the port, a phone password and the OCR language.

```bash
cp .env.example .env        # Windows: copy .env.example .env
```

### Updating

```bash
git pull
npm install
```

If you use `npm start` (below), it rebuilds the app on every start, so there's nothing else to do.

### Bringing your notes from the old PC

Your notes are not in the repository. They live in StudySpace's data folder (see [Where your data lives](#where-your-data-lives)). To move them:

1. Stop StudySpace on both computers.
2. Copy the old computer's whole data folder to the new computer's data folder. The place depends on the system (see the table), so a folder from Linux goes to `%LOCALAPPDATA%\StudySpace` on Windows. Create the folders if they don't exist yet.
3. Copy your PDFs to the new computer, start StudySpace and add their folder in Settings. The old computer's folder is still listed there, and you can remove it.

StudySpace recognises a file by its content, not its path, so notes, highlights and bookmarks find their PDFs again even in a different folder. Keep the PDFs unchanged on the way.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development: the server on port 4317 (restarts on code changes) and the web page on **http://localhost:5173** (hot reload). |
| `npm start` | Builds the web page, then serves everything from one process on **http://localhost:4317**. Use this for daily use or for a phone. |
| `npm run check` | Checks Node, the npm packages, the optional tools and the ports. |
| `npm test` | Server tests (Vitest). |
| `npm run typecheck` | TypeScript checks for the server and the web page. |
| `npm run build` | Builds `web/dist` and `server/dist` without starting anything. |

## Configuration

Everything is optional. Settings come from `.env` in the project folder (copy [.env.example](.env.example)), and real environment variables override it. Most things, such as your library folders and what to hide, are set in the app under **⚙ Settings** instead.

| Variable | Default | Purpose |
| --- | --- | --- |
| `STUDYSPACE_LIBRARY_DIRS` | – | Folders added on the very first start. Separate several with `:` (Linux/macOS) or `;` (Windows). |
| `STUDYSPACE_EXCLUDES` | – | Folders or files to hide, comma-separated, such as `Old, *.md` (the same rules as in Settings). |
| `STUDYSPACE_DATA_DIR` | see below | Where the database, pictures and backups live. |
| `STUDYSPACE_HOST` / `STUDYSPACE_PORT` | `127.0.0.1` / `4317` | `0.0.0.0` also lets devices on your Wi-Fi in (they must log in). |
| `STUDYSPACE_PASSWORD` | – | Lets a phone or other device log in. This computer never needs it. |
| `STUDYSPACE_ALLOWED_HOSTS` | – | Extra host names other devices may use. |
| `STUDYSPACE_HISTORY_LIMIT` | `10` | Undoable file edits kept per PDF. |
| `STUDYSPACE_OCR_LANG` | `eng` | Tesseract languages, such as `eng+ben`. |
| `STUDYSPACE_OCRMYPDF` / `STUDYSPACE_TESSERACT` / `STUDYSPACE_SOFFICE` | found on the PATH | Full paths to these programs, if they're installed somewhere else. |
| `STUDYSPACE_TRASH_DIR` | see below | Where files deleted in the library go. |

## Where your data lives

Your PDFs stay where they are. StudySpace never copies or uploads them, but in-app page edits and *Save to PDF* do change the original file, and the previous version is kept for undo.

| | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Data folder (database, note pictures, PDF versions for undo, converted slides) | `%LOCALAPPDATA%\StudySpace` | `~/Library/Application Support/StudySpace` | `~/.local/share/studyspace` |
| Files deleted in the library | `Trash` inside the data folder | `Trash` inside the data folder | The desktop Trash (`~/.local/share/Trash`) |

**⚙ Settings** shows the exact path. To back up your notes, copy the data folder while StudySpace is stopped.

## Using it on your phone

1. Set a password in `.env`: `STUDYSPACE_PASSWORD=…`.
2. On the same Wi-Fi, also set `STUDYSPACE_HOST=0.0.0.0`, run `npm start`, and open the address it prints, such as `http://192.168.0.10:4317`. From anywhere, use [Tailscale](https://tailscale.com) with `tailscale serve --bg 4317` instead.

On Windows, allow Node.js through the firewall when Windows asks. Full steps: [docs/PHONE_SETUP.md](docs/PHONE_SETUP.md).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `No such built-in module: node:sqlite`, or `EBADENGINE` while installing | Node is too old. Install Node 24 or newer, reopen the terminal, then `npm install` again. |
| Windows: `'npm' is not recognized` | Close and reopen the terminal after installing Node.js (or restart Windows). |
| Windows PowerShell: `npm.ps1 cannot be loaded because running scripts is disabled` | Run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use Command Prompt instead. |
| `EADDRINUSE: address already in use 127.0.0.1:4317` | StudySpace is already running in another terminal, or something else uses the port: set `STUDYSPACE_PORT=4318` in `.env`. |
| The page opens but shows no files | Add your folder under **⚙ Settings → Library folders**. Folder settings can only be changed on the computer itself, not on a phone. |
| Slides don't open | Install LibreOffice ([REQUIREMENTS.md](REQUIREMENTS.md)). The first opening of a deck takes 30–60 s. |
| "OCR isn't installed" | Install Tesseract and OCRmyPDF ([REQUIREMENTS.md](REQUIREMENTS.md)). No restart needed. |
| "This PDF is encrypted" | You can read, highlight and take notes, but saving into the file and page edits aren't possible. |
| "The PDF file is read-only" | StudySpace needs write permission on the file to save into it or edit pages. |
| "The PDF changed on disk since it was opened" | Another program changed it. Reopen it and try again. |
| Restore an older version of a PDF by hand | Stop StudySpace, copy a file from `<data folder>/history/<document-id>/` over the original, start it again and press ⟳ Rescan. Normally `Ctrl+Z` does this for you. |

## Project layout

```
studyspace/
├── server/            the API: Express 5 + TypeScript, Node's built-in SQLite, pdf-lib
│   ├── src/           routes, database and migrations, library scanner, PDF editing, OCR, slides
│   └── test/          Vitest + Supertest
├── web/               the page: React + Vite + Tailwind CSS + PDF.js
│   └── src/           app state, viewer, notes, dialogs, keyboard shortcuts
├── scripts/           check-requirements.mjs (npm run check), shortcut-tables.mts
└── docs/              user guide, phone setup, developer notes
```

## Documentation

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md): every feature, step by step.
- [REQUIREMENTS.md](REQUIREMENTS.md): what to install, per system.
- [docs/PHONE_SETUP.md](docs/PHONE_SETUP.md): using StudySpace on a phone.
- [docs/DEVELOPER.md](docs/DEVELOPER.md): how it works, the HTTP API and the database.
- [CLAUDE.md](CLAUDE.md) and [HANDOFF.md](HANDOFF.md): the full development notes and feature history.
