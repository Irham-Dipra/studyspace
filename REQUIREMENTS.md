# Requirements

What a computer needs before `npm install` and `npm run dev`. To see what yours has and lacks at any time, run:

```bash
npm run check
```

## What to install

| Software | Needed? | Version | What it's for |
| --- | --- | --- | --- |
| **Node.js** (comes with **npm**) | **Required** | **24 or newer** (tested on 24 and 26) | Runs StudySpace. Its built-in SQLite (`node:sqlite`) holds your notes, so no database server is needed. |
| **Git** | Recommended | any | Getting the code and updates. Without it, download the ZIP from GitHub. |
| **A web browser** | **Required** | a recent Firefox, Chrome, Edge or Safari | The app opens in your browser. |
| LibreOffice | Optional | any recent | Opening slides (`.pptx`, `.ppt`); they are turned into a PDF the first time. |
| Tesseract OCR | Optional | 4 or 5 | Reading the text of a drawn region of a scanned page. |
| OCRmyPDF, with Ghostscript | Optional | any recent | Reading whole scanned pages, and adding their text to the PDF. |

Nothing has to be compiled: there is no C compiler, Python or database server to install for StudySpace itself. Only the optional OCRmyPDF is a Python program. About 300 MB of npm packages go into `node_modules/`.

## The npm packages

You don't install these one by one: `npm install` reads them from `package.json`, `server/package.json` and `web/package.json`, and takes the exact versions from `package-lock.json`. For a Node project, those files do the job of Python's `requirements.txt`.

```bash
npm install     # or, for exactly the locked versions: npm ci
```

| Package | Version | Used for |
| --- | --- | --- |
| **Server** (`server/`) | | |
| express | 5.3.0 | The HTTP API |
| pdf-lib | 1.17.1 | Writing PDFs: page edits, annotations, bookmarks |
| zod | 4.6.5 | Checking API requests |
| tsx, typescript | 4.23.15, 7.0.2 | Running and checking the TypeScript code (dev) |
| vitest, supertest | 5.0.3, 7.3.1 | Tests (dev) |
| **Web page** (`web/`) | | |
| react, react-dom | 19.3.0 | The interface |
| pdfjs-dist | 6.4.299 | Showing PDFs |
| react-markdown, remark-gfm, remark-math, rehype-katex, katex | 10.1.0, 4.0.1, 6.0.0, 7.0.1, 0.16.47 | Notes in Markdown with math |
| lucide-react | 1.55.0 | Icons |
| modern-screenshot | 4.7.0 | Screenshots of the window |
| vite, @vitejs/plugin-react | 8.3.4, 6.1.2 | Dev server and build (dev) |
| tailwindcss, @tailwindcss/vite | 4.3.3 | Styles (dev) |
| **Both** | | |
| concurrently | 10.0.6 | Runs the server and the web page together in `npm run dev` (dev) |

## Install commands

Pick your system. The first block is required; the rest are optional and can wait until you want slides or OCR.

### Windows 10 / 11

In **PowerShell** (`winget` comes with Windows):

```powershell
# Required
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Git.Git

# Optional: slides
winget install -e --id TheDocumentFoundation.LibreOffice

# Optional: OCR of a region
winget install -e --id UB-Mannheim.TesseractOCR
```

**Close and reopen the terminal** afterwards, so it finds the new programs.

The Tesseract installer doesn't put itself on the PATH. Add it once, then reopen the terminal:

```powershell
[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";C:\Program Files\Tesseract-OCR", "User")
```

OCR of whole pages also needs OCRmyPDF, which is a Python program, and Ghostscript:

1. Install Python from [python.org](https://www.python.org/downloads/). On the installer's first screen, tick **Add python.exe to PATH**.
2. Install Ghostscript and OCRmyPDF:

   ```powershell
   winget install -e --id ArtifexSoftware.GhostScript
   pip install ocrmypdf
   ```

For other OCR languages, choose them in the Tesseract installer under *Additional language data*.

If PowerShell says *running scripts is disabled* when you run `npm`, run this once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

### macOS

With [Homebrew](https://brew.sh):

```bash
# Required
brew install node git

# Optional: slides
brew install --cask libreoffice

# Optional: OCR (also installs Tesseract and Ghostscript)
brew install ocrmypdf
brew install tesseract-lang    # more OCR languages
```

### Ubuntu / Debian

Node.js from `apt` is often too old, so install it with [nvm](https://github.com/nvm-sh/nvm):

```bash
# Required
sudo apt install git curl
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# close and reopen the terminal, then:
nvm install 24

# Optional: slides
sudo apt install libreoffice-impress

# Optional: OCR (also installs Ghostscript)
sudo apt install ocrmypdf tesseract-ocr
sudo apt install tesseract-ocr-ben    # more languages: tesseract-ocr-<code>
```

### Fedora

```bash
sudo dnf install git nodejs                          # required; check that node -v is 24+, else use nvm as above
sudo dnf install libreoffice-impress                 # optional: slides
sudo dnf install ocrmypdf tesseract                  # optional: OCR
```

### Arch Linux

```bash
sudo pacman -S git nodejs npm                                  # required
sudo pacman -S libreoffice-fresh                               # optional: slides
sudo pacman -S ocrmypdf tesseract tesseract-data-eng           # optional: OCR
```

## Check it

```bash
node -v          # v24 or newer
npm -v
git --version
npm run check    # in the StudySpace folder: checks all of the above, the packages and the ports
```

If a program is installed somewhere StudySpace doesn't look, give its full path in `.env`: `STUDYSPACE_SOFFICE`, `STUDYSPACE_TESSERACT` or `STUDYSPACE_OCRMYPDF` (see [.env.example](.env.example)). OCR languages are set with `STUDYSPACE_OCR_LANG`, such as `eng+ben`.

Then go back to the [README](README.md#5-start-it) and start StudySpace.
