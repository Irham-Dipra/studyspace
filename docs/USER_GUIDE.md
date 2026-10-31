# StudySpace — User Guide

This guide walks through every feature of StudySpace, step by step. Press **`?`** inside the app at any time for the keyboard-shortcut cheat sheet.

---

## 1. Starting the app

1. Open a terminal and run:
   ```bash
   cd "/home/dipra/Study Helper"
   npm run dev
   ```
2. Open **http://127.0.0.1:5173** in your browser.
3. Leave the terminal open while you study. Press `Ctrl+C` in it to stop the app.

> Prefer a single server without hot-reload? Run `npm start` and open **http://127.0.0.1:4317** instead.

The first time you start, StudySpace adds the folder from your `.env` file (`/home/dipra/Buet/3-1`, skipping `Offllines`) and scans it. Your PDFs are read where they are. Nothing is copied or uploaded.

---

## 2. The screen at a glance

```
┌ Top bar: ☰ library · course › file · Search · 🌙 · ? · ⚙ · ☰ resources ─────────┐
│ LIBRARY (left)  │  TOOLBAR: ↶ ↷ | tools | colours ... Save to PDF ⧉ 🗑 🔧 Page tools │ PAGE RESOURCES │
│                 │                                                               │   (right)      │
│                 │                    PDF VIEWER (center)                        │                │
├─────────────────┴───────────────────────────────────────────────────────────────┴────────────────┤
│ Page [24] / 156          ◀ Previous Page   Next Page ▶          − [100%] +   ↔  ⛶                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

| Area | What it does |
| --- | --- |
| **Library** (left) | All PDFs in your study folders, grouped by course folder. With a PDF open, the **Bookmarks** tab shows that PDF's bookmarks (§4). |
| **Viewer** (center) | The open PDF, scrolled continuously page after page. |
| **Page Resources** (right) | Notes and resources for the page you are looking at, plus whole-document items. **`D`** swaps it for the page's pictures (§5). |
| **Status bar** (bottom) | Current page, previous/next buttons, zoom controls. |

The two `☰` buttons in the top bar (or the **`[`** and **`]`** keys) hide and show the side panels. On a narrow window or phone the side panels slide in over the PDF instead.

### Hiding the title bar and the tools bar

Press **`Shift+V`** (or the double-arrow button in the title bar) to hide **both** the title bar and the tools bar, so the page gets the full height. Press it again, or click the small round button at the top right of the page, to bring them back. It is remembered in this browser. The keys for tools (`A`, `Y`, `K`…) and everything else still work while the bars are hidden.

### Resizing the three columns

- **Drag the divider line** between the library and the PDF, or between the PDF and the notes panel. The line turns blue and shows a small grip while you hover or drag. The PDF viewer takes whatever space is left.
- **Double-click a divider** to reset that panel to its default width.
- **Keyboard:** click a divider (or Tab to it), then use **← / →** to resize in small steps, or **Shift+← / →** for bigger steps.
- Your widths are remembered the next time you open StudySpace.
- A side panel can't be dragged so wide that the PDF gets narrower than about 360 px. To get the most reading space, hide a panel completely with `☰` or `[` / `]`.
- After making the PDF column narrower or wider, press **`W`** to fit the page to the new width.

---

## 3. Library: finding and opening PDFs

- **Open a PDF:** click a course folder to expand it, then click a file. The file you have open is highlighted. Click a folder again to close it, even the one holding the open file.
- **Hide files you don't want to see:** hover a file and click the crossed-eye button, or press **`H`** on it. With files selected (box, Space, Shift+click), **Hide** in the bar below the list (or **`H`**) hides all of them. Hidden files leave the list, the search and "Continue reading", but stay on disk with their notes, highlights and bookmarks. A small crossed-eye with a number appears at the top of the list: click it (or press **`Shift+K`**) to see the hidden files and **Unhide** them (**`U`**; **`Shift+U`** unhides all; **`O`** opens one without unhiding). **Ctrl+Z** undoes hiding. (To hide by pattern, e.g. all `*.md`, use Settings → *Hide folders and files*.)
- **Files lying in the library folder itself** (not in a course folder) are grouped under one row at the bottom, *Files in 3-1*. It opens and closes like a folder (click, or **→ / ←**), starts closed, and opens by itself when the file you open is in it.
- **Slides (PowerPoint):** `.pptx` and `.ppt` files are listed too, with an orange slides icon.
  - The first time you open one, StudySpace turns its slides into pages. That takes about half a minute to a minute; the viewer says so while it works. After that it opens at once, until the file changes.
  - Notes, highlights, drawings, bookmarks, *Get text*, copying a page and saving pictures work as on a PDF.
  - The slides file itself is never changed, so page edits, *Save to PDF* and OCR are not offered. To edit the pages, use 🔧 → *Extract pages* to make a PDF of them.
  - This needs LibreOffice, which is installed.
- **HTML pages and Markdown files:** `.html` files (for example a Claude artifact you downloaded) and `.md` files are listed too, with a blue `</>` or a green icon. See *HTML pages and Markdown files* below.
- **Filter:** type in *Filter files…* at the top of the library to narrow the tree instantly.
- **Continue reading:** your recently opened PDFs are listed at the top with the page you were on. Click one to jump back in.
- **Search everything:** press **`Ctrl+K`** (or click the search box), type part of a file name or of a note, use **↑/↓** to choose, and press **Enter**. Choosing a note opens its PDF on the note's page.
- **Rename a file:** hover over it and click ✏ (or select it and press **`F2`**; **`F2`** anywhere renames the open PDF). Type the new name and press **Enter** (**Esc** cancels). Only the part before `.pdf` is selected, and the extension is always kept. The file is renamed on disk in the same folder, and keeps its notes, highlights and bookmarks. **Ctrl+Z** renames it back.
- **Delete a file:** hover over it and click 🗑 (or select it and press **`Del`**), then confirm with **Enter**. The file goes to the **desktop Trash**, not away for good. Its notes, highlights and bookmarks stay in StudySpace.
  - **Ctrl+Z** right away puts it back where it was, with everything. (If the deleted file was open, it closes; press Ctrl+Z before opening another PDF, since each PDF has its own undo.)
  - Later, restore it from the Trash in your file manager, then click **⟳ Rescan**: its notes come back too.
- **Keyboard in the file list:** press **`/`**, then **↓** to step into the list. **↑/↓** move between files and folders, **→/←** open and close folders, **Enter** opens.
- **Side by side:** point at a file and click the two-columns button (or press **`Shift+Enter`** on it) to show it beside the open PDF. See *Two PDFs side by side* (§4).
- **Several files at once:** select files (the box beside a file, Shift+click, or **`Space`**), then **`Shift+F`** gets each one's pictures, text or notes from one window. See *Pictures, text and notes of several files at once* (§4).
- **Rescan (⟳):** click after you add, rename or move PDFs on disk. Renamed or moved files keep all their notes. StudySpace recognises them by content, not by name.
- An orange dot next to a file means it has highlights that are not yet saved into the PDF file (see §7).
- **Unsaved work when switching PDFs:** if the PDF you're leaving has unsaved work, StudySpace asks before opening another one in the same tab. That covers highlights not yet saved into the file and a note you're still writing. The choices are:
  - **Save to PDF and open:** writes the highlights into the file, then opens the other PDF.
  - **Open without saving:** the highlights stay in StudySpace (you can save them later), but **a half-written note is discarded**. In that case the button reads *Discard note and open*.
  - **Stay here:** go back to what you were doing.

  Closing or reloading the tab while a note is half written also makes the browser ask first.

### HTML pages (Claude artifacts) and Markdown files

- **Getting them in:** on claude.ai, open the artifact and download it. An HTML artifact downloads as a `.html` file and a Markdown one as `.md`. Save it into a study folder, then click **⟳ Rescan**. (A React artifact downloads as `.jsx` code, which isn't a page, so it isn't shown.)
- **Reading:** they open as one long page with no page numbers. The zoom (**+** / **−**, or the % box) makes the text bigger or smaller. StudySpace remembers how far down you were.
- **Highlighting:** select some text and a bar appears:
  - a colour (keys **1–5**) highlights it;
  - *Comment* highlights it and opens a comment box;
  - *Note* (**N**) puts the text into a new note;
  - *Copy* copies it.

  With the highlighter tool (**H**), selecting highlights at once. Click a highlight to recolour it, comment on it or remove it (**Del**). **Ctrl+Z** undoes all of these. On a phone, long-press the text and drag the handles: the bar appears below the text.
- **Notes** on these files are for the whole file.
- **The file is never changed.** Highlights and notes stay in StudySpace. Page tools, bookmarks, *Get text*, OCR and *Save to PDF* are for PDFs, so they aren't offered here.
- **HTML pages run sealed off.** A page's own scripts work (buttons, tabs, charts), but it can't reach StudySpace or your files. Because of that:
  - a page that saves things in the browser (like *"Changes are saved on this device"* in a planner) can't save them inside StudySpace. Open the file directly in Firefox when you want to use that;
  - a page that loads fonts or scripts from the internet needs internet to look right;
  - if the page's text changes (a checklist, a new card), a highlight whose text is gone is listed under *"no longer match"*, with **Remove**.
- **Keys inside an HTML page:** after clicking into the page, one-key shortcuts (`[`, `]`, `N`, `?`, Esc…) still work. Keys with Ctrl are left to the page.
- **Markdown:** formulas (`$…$`), tables and pictures stored next to the file (`![](img/x.png)`) are shown.

### Several PDFs at once (browser tabs)

Open as many StudySpace tabs as you like, each with its own PDF.
- **Ctrl+click** (or middle-click) a file in the library to open it in a new tab. Right-click → *Open link in new tab* works too, and so does copying the address of a tab.
- **Tabs keep each other up to date.** If you add or edit a note or highlight in one tab, every other tab showing that PDF updates within a moment. If a tab changes the file itself (page edits, Save to PDF, or undoing them), the other tabs reload it and show *"… was changed in another tab"*.
- **The same PDF in two tabs is safe.** A tab never overwrites changes made in another tab: it reloads first.
- **Undo (Ctrl+Z) only covers changes made in that tab.** For page edits and Save to PDF, only the most recent change to a file can be undone. If another tab changed the file since, StudySpace says so instead of undoing.

### Managing study folders (⚙ Settings)

1. Click **⚙** in the top bar.
2. Under **Add folder**, type a path or click **Browse**. Click into folders, then **Use this folder**.
3. Optionally fill in **Hide folders and files**, a comma-separated list of what to leave out (e.g. `Offllines, Old/Drafts, *.md`).
4. Click **Add & scan**.

For each existing folder you can rename its label, edit what it hides (then click **Save** or press **Enter**), untick **Enabled** to hide it temporarily, or remove it. Removing a folder never deletes files, and its notes come back if you add it again.

**What you can write in *Hide folders and files*** (capital letters don't matter):

| You write | It hides |
| --- | --- |
| `Offllines` | every folder or file with that name, at any depth |
| `*.md` (or `*md`) | every Markdown file, in this folder and all its subfolders |
| `CSE 301/*.md` | the Markdown files directly in `CSE 301` (not in its subfolders) |
| `CSE 301/**/*.md` | the Markdown files in `CSE 301` and all its subfolders |
| `/*.html` | the HTML files lying in the library folder itself only |
| `Old/Drafts` | that one folder (and everything in it) |
| `re:\(old\)\.pdf$` | anything whose path matches the regular expression after `re:`, e.g. `Lecture 3 (old).pdf` |

`*` is any run of letters within one folder, `**` crosses folders, `?` is one letter. A pattern with a `/` is a path from the library folder; one without is a name at any depth. A broken regular expression is refused with the reason. After **Save**, a message says how many files were hidden. Hidden files keep their notes, highlights and bookmarks: take the rule out and they come back with everything. StudySpace also won't rename a file, or save a new PDF (extract, split, merge), under a name that a rule would hide.

Settings also has **Note colours** (see §5, *Changing these colours*) and shows where the database lives and whether AI is configured.

---

## 4. Reading and navigating

| Action | How |
| --- | --- |
| Next / previous page | Scroll, **→ / ←**, or *Next Page / Previous Page* in the status bar |
| Jump to a page | Press **`G`** (or click the page box), type the number, press **Enter** |
| First / last page | **Home / End** |
| Zoom in / out | **`+` / `-`**, **`Ctrl +` / `Ctrl -`**, **Ctrl + mouse wheel**, or the − / + buttons |
| Reset zoom to 100% | **`0`** (or `Ctrl 0`) |
| Fit page width / whole page | **`W` / `F`**, or the ↔ / ⛶ buttons |
| Pick an exact zoom | The zoom drop-down in the status bar |
| Go back to where you were | **`Alt+←`** (or **`Backspace`**), or the ↶ button in the status bar. **`Alt+→`** (or `Shift+Backspace`) goes forward again. See *Going back* below. |
| Follow a link in the PDF | Click it. Table-of-contents links jump inside the PDF; web links open a new tab. |
| Dark mode | 🌙 in the top bar |

StudySpace always knows the **exact page you are looking at**: the page taking up most of the screen. The page box in the status bar and the **Page N** heading in the right panel update as you scroll.

When you reopen a PDF, it returns to the page and zoom where you left off. The first time you open a PDF it is fitted to the window width.

### Going back

After you jump somewhere, you can come back, like a browser's Back button. A **jump** is anything that takes you away from where you were reading: a link or table-of-contents entry in the PDF, a bookmark, a note's page label, a note marker, a page number typed in the page box, **Home** / **End**, or a search result in the same PDF.

- **`Alt+←`** or **`Backspace`** (or the **↶ p. N** button in the status bar, which shows the page it returns to) goes back to the exact spot you left, not just the page. Press it again to go back through earlier jumps.
- **`Alt+→`** or **`Shift+Backspace`** (or the **↷** button that appears) goes forward again after you went back.
- **Scrolling fast** over several pages (3 or more, in one go: wheel, scrollbar, trackpad) is a jump too: stop, and **↶** appears with the page you came from. Reading on a little at a time, with pauses, is not.
- Turning pages one at a time (**→ / ←**, the status bar buttons) is not a jump, so Back never just undoes a page turn.
- A new jump after going back clears what was ahead, as in a browser. Each PDF keeps up to 50 places; they are forgotten when you close or switch the PDF.
- Not for HTML and Markdown files.

### Two PDFs side by side

Read a second PDF (or slides) beside the open one, for example the slides next to the textbook, or the question paper next to your notes.

- **Open one beside:** press **`\`**, type part of its name, then **↑ / ↓** and **Enter** (files you read recently come first). Or in the library, point at a file and click the two-columns button, or select it with the keyboard and press **`Shift+Enter`**. The same PDF can go beside itself, to keep two places of it in view.
- **The pane beside** has its own page and zoom: **`Shift+→` / `Shift+←`** turn its pages (the plain arrows still turn the open PDF's), and its bar has ‹ ›, zoom −/+, fit width, ⇄ and ✕. It opens fitted to the pane, at the page you last read it at, and the open PDF is fitted to its new half. Drag the line between the two to resize them (double-click: back to halves).
- **The open PDF (left) keeps the tools.** Highlighting, drawing, notes, bookmarks, page tools and Get text work on it, and the notes panel shows its notes. The PDF beside shows its saved highlights; selecting its text offers *Copy* only.
- **Swap them:** **`Shift+X`** (or ⇄) makes the PDF beside the open one, with its tools and notes, and puts the other beside. If the open PDF has unsaved highlights, StudySpace asks first, as when opening any other file. HTML and Markdown files can't go beside.
- **Change or close:** **`\`** again (or click its name) shows a different PDF beside; **`|`** (Shift and `\`) or ✕ closes the pane.
- StudySpace remembers the PDF beside and its page, also after a reload. On a phone the two are stacked, one above the other.

### Bookmarks

Bookmarks are the PDF's own table of contents (the "outline" or "bookmarks" pane of other PDF readers). With a PDF open, click the **Bookmarks** tab at the top of the left column.

- **Bookmarks the PDF already has** (most textbooks do) are shown there the first time you open it, nested by chapter and section, and you can edit them like your own.
- **Jump:** click a bookmark. It takes you to the exact spot on the page, not just the page. The bookmark you are reading in is highlighted, and its chapter is opened automatically as you scroll.
- **Add:** press **`B`** (or the bookmark-plus button) to bookmark the spot at the top of the view. Type a title and press **Enter**. If you select text in the PDF first, that text becomes the title. A new bookmark goes right after the one you are reading in, at the same level.
- **Rename:** double-click it, press **`F2`**, or use the ✎ button.
- **More** (the ⋯ button, or right-click): *Point to where I'm reading* (move it to the current spot), *Add a bookmark inside*, move up/down, indent/outdent, delete. Deleting a bookmark also deletes the ones inside it.
- **Keyboard,** with a bookmark focused: **↑ / ↓** move between bookmarks, **→ / ←** open/close a chapter, **Enter** jumps, **`Alt+↑` / `Alt+↓`** move it, **`Alt+→`** nests it under the one above, **`Alt+←`** un-nests it, **Delete** deletes it.
- **Get the text of a section:** press **`T`** on a focused bookmark (or **`O`** to OCR it), or use the ⋯ menu. You get the text from that bookmark up to where the next one starts (§9).
- **Filter:** long lists get a *Filter bookmarks…* box.
- **Undo:** every bookmark change can be undone with **`Ctrl+Z`**.

Bookmarks follow their pages when you insert, delete, replace or move pages (§8). A bookmark on a deleted page moves to the next page that is kept.

**Saving into the file:** StudySpace keeps your bookmarks straight away. To write them into the **PDF file itself**, so other readers show them, press **Save to PDF** (§7). Until then the toolbar shows the orange *Save to PDF* button and the file has an orange dot in the library. Saving replaces the PDF's outline with your bookmark list; **`Ctrl+Z`** right after restores the file exactly. If another program changes the PDF and you have no unsaved bookmark changes, StudySpace reads its bookmarks again.

---

### Copy a page as an image, or cut it in half

- **`Shift+C`** (or the ⧉ button in the toolbar, or 🔧 → *Copy page as image*) copies the page you're reading to the clipboard as a picture. Paste it with **Ctrl+V** into a chat, a document, slides or an image editor. Highlights already saved into the PDF are included.
- **`Shift+H`** (🔧 → *Cut page in half…*) opens a window showing the page cut into two pictures. That's handy for slides printed two per page, or a scanned two-page spread.
  - **Top / bottom** or **Left / right** (`D` switches). It starts with whichever suits the page's shape.
  - **Move the cut:** **← / →** (with **Shift** for bigger steps), drag the *Cut at* slider, or click on the page. **`0`** puts it back in the middle.
  - **`1`** copies the first half (top or left), **`2`** the second half.
  - **`B`** copies **both**. Editors like Google Docs, Word or Notion then paste two separate pictures; other apps paste one picture with both halves one under the other.
  - **`S`** saves both halves as PNG files (through the browser's download).
  - **PgUp / PgDn** go to the previous / next page without closing the window.

### Screenshot any part of the window

Press **`Q`**, or click the ✂ crop button at the top right (also in 🔧 → *Screenshot part of window*). The window dims.

1. **Click the top-left corner** of what you want, then **the bottom-right corner**. You can also drag a box. The box shows its size as you go.
2. The screenshot is **copied to the clipboard** at once. Paste it anywhere with **Ctrl+V**: a chat, a document, a note in another app.

- **`Enter`** before clicking takes the **whole window**. After the first corner, it finishes the box where the pointer is.
- **`Esc`** drops a started box; a second `Esc` (or a right-click) cancels.
- It works on everything you see: the PDF (scrolled as it is), notes with their math, menus, panels. Messages like this toast are left out.
- No screen-sharing permission is asked: StudySpace draws its own window into the picture. Pictures from other programs or browser tabs are not possible.

### Save pages as pictures

**`Shift+S`** (or 🔧 → *Save pages as pictures…*) saves pages as image files through the browser's download.

- **Pages:** **`1`** this page, **`2`** choose pages (type e.g. `3, 5-9`, then `Enter`), **`3`** the whole PDF.
- **Format:** **`F`** switches PNG ⇄ JPEG. PNG is sharpest; JPEG is much smaller.
- **Sharpness:** **`R`** cycles 100 / 150 / 200 / 300 dpi. 150 suits screens, 300 printing.
- **`Enter`** saves. One page gives one picture; several pages give one `.zip` with a picture per page (`Title - p003.png`…). The window shows the rough size first.
- **`C`** copies the picture instead (one page only).

While you type the pages, the letter keys (`F`, `R`, `C`) still work, since page lists only use digits, `-` and `,`. Format and sharpness are remembered.

### Pictures, text and notes of several files at once

Pick several files in the library, then get each one's pictures, text or notes from one window, instead of opening each file and pressing `Shift+S`, `Shift+A` or `Shift+N`.

1. **Select the files** in the library (left panel):
   - click the small box to the left of a file (it shows when you point at the file, and on every file once one is selected);
   - **Shift+click** a file selects every file from the last one you picked down to it;
   - with the keyboard: **`Space`** selects or unselects the file you're on; on a folder, it selects all its files. **`Shift+↑` / `Shift+↓`** select while moving. **`Ctrl+A`** selects all the files showing (with a filter typed, just its matches). **`Esc`** unselects all.

   The bottom of the library shows *"3 selected"*, with **Download…** and ✕ (unselect all).
2. **Press `Shift+F`** (anywhere, even with no PDF open), or click **Download…**. The *Selected files* window lists the files.
3. **For each file, click Pictures, Text or Notes** (or move with **↑ / ↓** and press **`P`**, **`T`** or **`N`**). Each is the whole file:
   - **Pictures:** every page as a picture, in one `.zip` (a one-page file gives one picture), like `Shift+S` → *Whole PDF*.
   - **Text:** the file's text as a `.md` (Markdown) or `.txt` file, like `Shift+A`, then *Download*.
   - **Notes:** all the file's notes, one `.md` file per note, in one `.zip`, like `Shift+N` (§5).

   HTML pages and Markdown files have no pages, so only *Notes* works for them.

   You don't have to wait: click the next one straight away. Downloads are done one at a time, in the order you asked for them, and each row shows *waiting…*, the pages done, then ✓. ✕ (or **`Del`**) cancels a file's waiting or running downloads.

**Choices at the top** (they apply to what you ask for next): picture format PNG / JPEG (**`F`**) and sharpness (**`R`**), as in *Save pages as pictures*; text as Markdown or plain text (**`M`**), your highlights marked as `==text==` (**`H`**) and your notes included (**`I`**), as in the *Get text* window. These are remembered, and shared with those windows.

**Good to know:**
- The text comes from the PDF's own text. Scanned pages have none: the row says how many there are. OCR them from the file itself (`Shift+W`).
- Nothing in your files changes.
- Closing the window (**Esc**) cancels the downloads that haven't finished. The selection stays, so `Shift+F` brings the window back.

## 5. Notes and resources (right panel)

The right panel shows **only what belongs to the current page**, plus anything attached to the whole document. It updates as you scroll.

The panel has **two tabs**: **On this page** (notes for this page, or for a range of pages that includes it) and **Whole PDF** (notes made for the whole file). Each tab shows how many notes it holds. Click a tab to switch; the one you choose stays while you turn pages. If this page has no notes but the whole PDF has some, a link under the empty message takes you to them. **+ Add note** starts a note for whatever tab you are on, and a note you save (or a picture you add) shows its own tab. HTML and Markdown files have no pages, so all their notes are for the whole file and there are no tabs.

Right under the tabs:
- **Open all** and **Close all** open or fold every note of the tab. Notes are all open by default. **`C`** does the same in one key: it closes all, or opens all if they are all closed.
- **Index**: when the tab has two or more notes, a row of numbered chips, one per note, in the order they are listed. It stays in view while you scroll, so you can always see how many notes there are, even those below. Click a chip to open that note and scroll to it.

Inside each part, notes are grouped by type in this order:
1. **My Notes**
2. **Summaries**
3. **AI Explanations**
4. **Previous Year Questions** (PYQs)
5. **External Links**
6. **Highlights on this page**

Empty groups are hidden. *Highlights on this page* come last, in the *On this page* tab. The number next to *Page resources* is how many items apply to the current page.

**Every card is open when you open a PDF**, so you can read all your notes straight away. Each card shows its title and scope (e.g. *Page 4*, *Pages 20–30*, *Whole document*); a note without a title shows its first line instead.
- Click **⌃ Close** right after the title, or click the title itself, to fold a card down to just its title.
- Click **⌄ Expand** in the same place to open it again.
- Closed cards stay closed while you move between pages. Opening another PDF starts with everything open again.
- **Open all / Close all** under the tabs opens or closes every card of the tab at once.

### Adding a note or resource

1. Scroll to the page the note is about.
2. Click **+ Add note or resource** at the bottom of the panel, or press **`N`**.
3. Choose the **type**:
   - *Personal Note*
   - *Summary*
   - *Previous Year Question*
   - *AI Explanation*
   - *External Link*
4. Add a title (optional) and the content. For an *External Link*, also paste the URL.
5. Choose the **scope**:
   - **This page**: shown only on that page.
   - **Page range**: shown on every page from *From* to *To* (e.g. a PYQ covering pages 20–30).
   - **Whole document**: shown on every page of the PDF (e.g. a course website link).
6. Click **Add**, or press **Ctrl+Enter**. **Esc** cancels.

**Pasting an AI answer (Gemini, ChatGPT).** Pasting into the content box cleans the answer for you:
- **The chat before the explanation is cut.** Ask the AI to start its explanation with a line holding just `@@START@@`, for example: *"Put the line @@START@@ just before your explanation."* Everything above that line ("Here is a detailed explanation of slides 5 through 11…") is dropped, and the mark too. With no mark, nothing is cut.
- **Citation tags are removed:** `[cite: 13]`, `[cite: 4, 7]`, `[cite_start]`.
- A line under the box says what was cleaned. **Ctrl+Z** right after takes the paste back.
- Saving a note cleans it the same way. To clean an older note, open it with ✏ and press **Ctrl+Enter**.

**Formatting.** Content is written in Markdown:
- `**bold**`, `*italic*`, `# Heading`, `- bullet`, `1. numbered`
- `> quote`, `` `code` ``, tables
- **Tables copied from Gemini** often have each row broken over several lines (sometimes every cell on a line of its own), with `<br>` for the line breaks inside a cell. They are shown as proper tables, with those line breaks. A wide table scrolls sideways in the notes panel.

**Math (LaTeX).** A formula has to be wrapped in math delimiters. Both styles work, so you can paste from ChatGPT or a LaTeX document as-is:

| Where | Dollar style | LaTeX style |
| --- | --- | --- |
| Inside a sentence | `$3 \times 2 = 6$` | `\(3 \times 2 = 6\)` |
| On its own line (centred) | `$$ \frac{a}{b} $$` | `\[ \frac{a}{b} \]` |

- **`$$ … $$` and `\[ … \]` always give an equation on its own line**, at full size, even when written on a single line or in the middle of a sentence. Inside a list item, the equation stays in that item.
- **Chains with several `=` signs** (like `a = b = c`) are shown one step per line, lined up on the `=`. If the left side is long, it gets its own line and the steps are indented under it.
- **Equations wider than the notes panel are shrunk to fit.** Very long ones that would get too small scroll sideways instead. Making the right panel wider shows them larger.
- Math works inside table cells too, including absolute values like `$|x|$`.
- **Formulas without `$` are found too.** Text copied from a Gemini answer (select and copy) has its formulas but no `$` around them, like `the n^{\text{th}} moment` or `X \sim \text{Bern}(p)`. Anything that can only be LaTeX (a command like `\frac`, a power like `x^2`, a subscript like `M_X`) is shown as math, together with the symbols and one-letter names next to it. Ordinary words end the formula, so `random variable X` stays text.
- Equations that stood on their own line in Gemini are **not** in a selected copy at all (you see an empty line). Use Gemini's copy button instead: it keeps every formula, with `$`.
- Prices like `$100` show as plain text, even with two of them in one sentence. If one is still read as math, type `\$5`.

Use **Preview** to check how it looks.

**Colour coding.** Every note gets highlighter colours automatically, so its structure stands out:
- the **title** of the card is **pink**;
- the top level of headings inside the note is **orange**, the next level **cyan**, then **green**, then **blue**;
- the bold label at the start of a bullet or numbered point (`- **Term:** explanation`) is **violet**, lighter in nested lists. An italic label ending in a colon (`- *Example:* …`) counts too. So does a short plain label (`- Superblock: checks…`, up to 8 words before the colon), which AI answers often paste without the bold; it is shown bold.
- a bullet that is only a label, like `- **Deductive Learning:**`, heads the points under it and is **rose**. When the points were pasted at the same level as the header (AI answers often lose the indentation), the bullets after it, up to the next such header, are shown indented under it.

The levels are relative to the note. If a note only uses `###` and `####`, those are orange and cyan. Your own highlights inside notes are drawn on top of these colours.

**Recolouring one heading or label.** Click any heading, bullet label, bullet header or `==marked==` text in a note. A colour menu opens, like the one for your own highlights:
- click a colour (or press **1–9**), or the rainbow circle for any colour;
- **No colour** (**0**) takes its highlighter colour away;
- **Default** (**Del**) gives back the usual colour.

For the **note title**, right-click it (a plain click opens or closes the card). The colour is saved with the note, so the phone sees it too, and it stays when you edit the note's text. If you change the heading's own words, it goes back to the default colour. **Ctrl+Z** undoes a recolour. Selecting text in a heading still gives the highlight bar.

**Changing these colours everywhere.** Open **⚙ Settings** (`,`) and scroll to **Note colours**. Each kind (note title, the four heading levels, bullet header, bullet label, and `==marked==` text) has a sample, a colour picker and a box for a hex code like `#ff8800`. Notes change as you pick. The ↺ button beside a colour puts its default back; **Reset all** resets every one. The colours are kept in this browser, so the phone keeps its own; other open tabs follow at once.

### Editing, deleting, jumping

- **Edit:** hover over a card and click ✏. You can change everything, including type and scope.
- **Delete:** click 🗑 and confirm. **`Ctrl+Z`** brings it back.
- A note from a range that started on another page shows its scope (e.g. *Pages 20–30*). Click that label to jump to the first page.

### Pictures (their own section)

A picture you want beside a page (a diagram, a screenshot of a solved problem) goes in the **Pictures** section, not in the notes. It opens as a slide that covers the whole notes column: just the picture, no title and no note buttons.

- **See them:** press **`D`**, or click **Pictures** under the notes (it shows how many are for this page). Press **`D`** or **`Esc`** again, or the ✕ over the picture, to go back to the notes. Your notes stay as they were, even an unfinished draft.
- **Reminder:** when the page you are reading has a picture saved for it (for that page, or for a range of pages that includes it), a small note at the bottom left of the PDF says so. Click it, or press **`D`**, to see the picture. The small ✕ hides it for that page. Pictures for the whole PDF don't show this reminder, because it would be on every page; they still show in the slides.
- **Add one:**
  - **`U`** (or the add-picture button over the slide): choose one or more pictures (PNG, JPEG, GIF or WebP, up to 25 MB each). On a phone this opens the gallery or the camera.
  - **`Ctrl+V`**: paste a copied picture (from a browser, a screenshot tool, or StudySpace's own *Copy a page as an image* and screenshot keys) anywhere that isn't a text box.
  - **Drop** a picture file on the slides or on the notes panel.
  - A new picture is saved for the page you are reading. A message tells you, and says **`D`** shows it.
- **Slides:** with more than one picture for the page, the arrows over the picture (they show when you point at it), or **`Ctrl+→`** / **`Ctrl+←`**, move between them. Over the picture you also see which one it is (e.g. *2 / 3 · Page 5*). Click the picture to fill the width (scroll to see the rest of a tall one); click again to fit it all.
- **Which pages:** like notes, a picture can be for one page, a range of pages, or the whole PDF. Press **`J`** (or the pages button over the picture) for the picture on show: choose *One page*, *Pages from … to …* or *Whole PDF* (**`1`** / **`2`** / **`3`**), then **`Enter`**. For a PDF, you can add several pictures to the same page, and one picture can serve many pages.
- **Remove:** the bin over the picture, or **`J`** then **`Del`**. **`Ctrl+Z`** brings it back, and also undoes a change of pages.
- For HTML and Markdown files (no pages) pictures belong to the whole file.
- *Download notes* (`Shift+N`) still puts the pictures in an `images` folder with the notes.
- A note that is *only* a picture (what older versions called a picture note) now counts as a picture and shows here. A picture pasted into the middle of a written note stays in that note.
- The picture files are kept in `~/.local/share/studyspace/images/`. They stay there even after the picture is removed, so back that folder up with the rest.

### Note markers

Pin a note, or one passage of it, to the exact spot on the page it's about, and open it from there. A note can have several markers, each pointing at a different part of it.

- **A marker for a passage of a note:** in the notes panel, select the words the marker should open at (a heading, a line, a formula). In the bar that appears, click **📍 Pin on page** (or press **`K`**). Then click the spot on the PDF page. The marker can go on any page of the PDF, and the same note can be pinned at several passages.
- **A marker for a new note:** press **`K`** (or the 📍 button in the toolbar), then click the spot. The notes panel opens a new note for that page, with *"Marker on page N"* under its scope. Write it and save (**`Ctrl+Enter`**). Cancelling leaves no marker. This marker opens the whole note.
- Either way, the tool goes back to Select afterwards; **`Esc`** before you click cancels.
- **Open it:** click the yellow marker on the page (its square bottom-left corner is the spot). The notes panel opens that note (expanded if you had closed it) and outlines it. A marker for a passage scrolls the panel to that passage and lights it up for a moment. Point at a marker to see which passage and note it opens.
- If the passage has since been edited out of the note, the marker opens the note at the top.
- **Move it:** drag the marker. **`Ctrl+Z`** puts it back.
- **Remove it:** right-click the marker (or tab to it and press **`Del`**). **`Ctrl+Z`** brings it back. Deleting the note removes its markers too (and undo brings them back with it).
- **Find them from the note:** a note with markers has a 📍 button on its card. It scrolls the PDF to its first marker, then the next one on each click.
- Markers stay with their page when pages are inserted, deleted, moved or turned; a marker on a deleted page goes with it (undo brings it back). *Extract* and *Split* copy them along with their notes.

### Downloading your notes

**`Shift+N`** (or the ⬇ button at the top of the notes panel) downloads every note of the open file in one `.zip`, with **one Markdown file per note**. This works for PDFs, slides, HTML pages and Markdown files.

- Inside the zip is a folder *"Title - notes"*. The files are numbered in reading order: notes on the whole file first, then by page. Each is named after its place and its title, e.g. `03 - p12 - Superblock.md` or `01 - whole - Summary of chapter 2.md`. A note without a title is named after its first line.
- Each file starts with the note's title as a heading, then a line saying what it is and where (*Summary · Pages 20–30 of "OS Lecture 4"*), then the link if it has one, then your text exactly as you wrote it (Markdown and `$…$` formulas included).
- A file with no notes says so instead.
- For several files at once, select them in the library and press `Shift+F`: each file has a **Notes** button there (see *Pictures, text and notes of several files at once*, §4).

### Highlighting and commenting inside your notes

You can annotate the text of any opened note or resource, the same way you annotate the PDF:

1. **Expand** the card so its content is visible.
2. **Select some text** in it with the mouse. A small bar appears:
   - click a **colour** to highlight the selection;
   - click **Comment** to highlight it and type a comment straight away (**Ctrl+Enter** or **Save**);
   - click **Copy** to copy the text.
3. **Click an existing highlight** to recolour it, add or edit its comment, or **Remove** it.

Highlights with a comment are underlined with a dotted line and marked 💬. Hover over one to read its comment. All comments are also listed under the note: click one to edit it.

- Your note's text is **never changed** by highlighting: highlights are stored separately and attached to the words you selected. If you later edit the note, they stay on those words. If the words were edited away, the card says *"1 highlight no longer matches the edited text"*, with a **Remove** button.
- **Formulas** are highlighted whole: select a formula (or part of it) to highlight all of it, or select a sentence and the formulas in it are highlighted along with the words. Highlights made before 19 Oct 2026 now colour their formulas too.
- Highlights in notes are undone and redone with **Ctrl+Z / Ctrl+Shift+Z**, like everything else, and they are kept when you undo a page deletion that had removed their note.
- **Esc** closes the bar without highlighting anything.

---

## 6. Highlighting, drawing and erasing

The tools are at the top-left of the viewer. Each one also has a key.

| Tool | Key | How to use |
| --- | --- | --- |
| **Select** | `V` | Select text with the mouse. A small menu appears: click a **colour** to highlight it, **Note** to start a note quoting it, or **Copy**. |
| **Highlight text** | `H` | Every text selection is highlighted immediately in the chosen colour. |
| **Highlight area** | `A` | **Drag** a box, or **right-click** (two-finger tap on a touchpad) the **top-left corner**, then right-click the **bottom-right corner**: the whole box is highlighted. After the first right-click the box follows the mouse; `Esc` or a left click cancels it. A plain left click makes nothing, so a stray click can't leave a box. Use it on anything: a figure, an equation, a scanned page. |
| **Pen** | `P` | Draw freehand. Choose a colour and thickness (fine / medium / bold) in the toolbar. |
| **Eraser** | `E` | Click on a highlight, drawing or text box to delete it, or hold the mouse button and drag across several. |
| **Text box** | `Y` | Click where the text should go and type (drag first to choose its width). See *Text boxes* below. |
| **Note marker** | `K` | Click a spot on the page, then write the note for it. See *Note markers* in §5. |
| Back to Select | `Esc` | Also closes the floating highlight bar and clears the selection. |

- **Reading through a highlight:** highlights are light and blend with the page like a real highlighter pen, so the text under them stays black and sharp.
- **Dismiss the bar:** press **Esc** or click anywhere else; nothing is highlighted.
- **Change or delete one highlight:** with the Select tool, click it. A small menu offers colours, **Note** (turn the highlighted text into a note) and **Delete**.
- **Highlights on this page:** the bottom of the notes panel lists the text you highlighted on the current page. Click **Note** beside one to quote it into a new note.
- Highlights and drawings are saved **immediately** in StudySpace's database. Every action can be undone with **`Ctrl+Z`**.

### Text boxes

Type your own text onto a page: an answer beside a question, a label on a figure, a correction.

- **Write one:** press **`Y`** (or the **T** button), then click where the text should start and type. A click makes a box from that spot towards the right edge; to choose its width, drag across first. **Enter** starts a new line, and the text wraps inside the box, which grows downwards as you type.
- **Finish:** **`Ctrl+Enter`**, or click anywhere outside the box. **`Esc`** throws away what you typed (for a box you were changing: your changes).
- **Colour and size:** with the text box tool on, the toolbar shows the pen colours (**1–5**) and three sizes (**`Shift+1`–`3`**: small, medium, large). They're used for the next box.
- **While you type (a new box or one you are changing):** a small bar above the box has the **colours** (**`Ctrl+Shift+1`–`5`**) and **smaller / larger text** (**`Ctrl+[`** / **`Ctrl+]`**, about 15% a step). Drag the **bar on the box's right edge** to change its **width**. They are saved with the text when you finish, and **`Ctrl+Z`** takes them back. (The typeface is always Helvetica.)
- **Change one:**
  - with the text box tool, click a box to edit its text, or drag it to move it (the box shows a dashed outline when you point at it);
  - with the Select tool, click it for a menu: colours (**1–4**), **Edit** (**Enter**), smaller / larger text, **Note** (its text into a new note) and **Delete** (**Del**).
  - Emptying a box and finishing deletes it. The eraser removes boxes too.
- Every change can be undone with **`Ctrl+Z`**.
- **In the PDF file:** *Save to PDF* (§7) writes text boxes as standard PDF text-box annotations, so other readers show them, with the same wrapping. The file uses the PDF's built-in Helvetica, which has only Latin letters: a character it lacks (Bengali, Greek, many maths symbols) shows as **?** in other readers, though the full text is kept in the annotation. In StudySpace your text always shows as typed.

---

## 7. Saving highlights and bookmarks into the PDF file

StudySpace's own view always shows your highlights and bookmarks. To make them part of the **PDF file itself**, so they appear in other PDF readers (Okular, Evince, Acrobat, browsers):

1. When you have unsaved highlights or bookmark changes, the toolbar shows an orange **Save to PDF** button, and the file has an orange dot in the library.
2. Click **Save to PDF**, or press **`Ctrl+S`**.
3. The original file is updated with standard PDF highlight, ink and text-box annotations and its outline (bookmarks). The toolbar then shows *Saved in PDF*. (Note markers stay in StudySpace: they open notes, which other readers don't have.)

You can keep editing afterwards: saving again replaces StudySpace's earlier marks instead of duplicating them. Marks made by other programs are never touched. **`Ctrl+Z`** right after saving restores the file exactly as it was before.

---

## 8. Page editing, and making new PDFs (extract, split, merge)

Everything here is in the **🔧 Page tools** menu on the right of the toolbar (or press **`T`**). It has two columns:
- **Edit this PDF:** insert, replace, turn, move, delete.
- **Copy & text** and **New PDFs:** copy as image, cut in half, get text; extract, split, merge.

Each item shows its key on the right. You can run it from the keyboard without opening the menu, or use **↑ / ↓** and **Enter** inside the open menu.

Insert, delete, replace, turn and move change the **original PDF file**. Every one of them can be undone (§10). Extract, split and merge instead make **new PDF files** and leave the originals alone (see *Making new PDFs* at the end of this section).

### Delete pages

**Delete the page you are on:**
1. Click the **🗑 page** button in the toolbar (next to 🔧), or press **`Shift+Delete`**.
2. The dialog is filled in with the current page. Check what it says (see below), then click **Delete 1 page**.

**Delete several pages:**
1. Open **🔧 Page tools → Delete several pages…** (`Ctrl+Del`).
2. Type the pages, e.g. `5`, `3, 8`, or `10-14, 20`.
3. Click **Delete N pages**. You can't delete every page of a document.

**What happens to your notes when page numbers shift.** Notes always stay with the *content* they were written for:
- **Notes on later pages move up with their pages.** If you delete page 4, the note that was on page 7 is now on page 6, the same slide or paragraph, only renumbered.
- **Page ranges shrink** to the pages that remain. A range 3–6 becomes 3–5 when page 4 is deleted.
- **Highlights and drawings** on later pages move with their pages. Those on a deleted page are removed with it.
- **Notes that belonged only to the deleted page(s) are never moved onto a different page.** The dialog lists them and asks:
  - **Delete them together with the page** (default). Undo brings the page and the notes back.
  - **Keep them as whole-document notes.** They stay and appear on every page of that PDF. You can later edit one and give it a new page.

### Insert a blank page

1. Open **🔧 Page tools → Insert blank page** (`I`). It goes after the page you're on.
2. Adjust **Insert after page** (`0` puts it before the first page) and **How many**, then click **Insert**.

The new page has the same size as its neighbour, so you can write on it with the pen or attach notes to it. Notes on later pages move down with their pages. A page-range note grows if you insert inside its range.

### Insert pages from another PDF

1. Open **🔧 Page tools → Insert pages from a PDF…** (`Shift+I`).
2. Search for and click the **source PDF** in your library (for example a PYQ paper).
3. Enter **From page / To page** of the source and **Insert after page** for this document.
4. Click **Insert N pages**. The source PDF is not changed.

### Replace a page with a page from another PDF

Use this to swap a page for a better version, such as a clearer scan, a corrected slide, or the matching page from another section's notes.

1. Go to the page you want to replace and open **🔧 Page tools → Replace this page…** (`R`).
2. Check **Replace page** (it starts at the page you're on).
3. Search for and click the **source PDF**. You can also pick the PDF you have open, marked *this PDF*, to copy one of its own pages over another.
4. Enter the source page in **With page**.
   - To replace several pages in a row, also fill in **To page**. For example, *Replace page 5* with pages *2 to 4* replaces pages 5, 6 and 7.
5. Read **What happens**, then click **Replace page**. The source PDF is not changed.

What happens to your notes and highlights:
- **Page numbers don't change**, so notes and page ranges stay exactly where they were. A note on page 5 is still on page 5, now next to the new content.
- **Highlights and drawings on the replaced page are removed.** They were made on the old page, so they wouldn't line up with the new one. To keep them anyway, tick **Keep my highlights/drawings** in the dialog.
- **Ctrl+Z** brings back the old page and any removed highlights.

### Turn pages (rotate)

For sideways or upside-down scans and slides.

1. Open **🔧 Page tools → Turn pages…** (`Shift+R`).
2. Type the pages (it starts at the page you're on; *All pages* fills in the whole PDF).
3. Pick **Right**, **Left** or **Upside down**, then click **Turn**.

Highlights and drawings turn with their pages. **Ctrl+Z** turns them back.

### Move pages (reorder)

1. Open **🔧 Page tools → Move pages…** (`M`).
2. Type the **Pages to move**, e.g. `11-12` or `3, 7`. They keep their order.
3. Set **Put them after page**. `0`, or *To the start*, puts them first; *To the end* puts them last. The dialog shows the pages' new numbers.
4. Click **Move**.

Notes, highlights and bookmarks move with their pages. A page-range note whose pages are split apart is widened to cover them all. **Ctrl+Z** puts the pages back.

### Making new PDFs: extract, split, merge

These are under **🔧 Page tools → New PDFs**. They **never change the PDFs you take pages from** (unless you tick *Remove these pages* when extracting). The new files are saved inside one of your **library folders** and show up in the library straight away.

- **Extract pages…** (`X`) copies chosen pages, e.g. `4-6` or `3, 8, 10-12`, into one new file. Its name is filled in for you, and you can change it.
  - Tick **Remove these pages from this PDF afterwards** to *move* the pages out instead of copying them. That part is a normal page deletion of the original, so **Ctrl+Z** undoes it.
- **Split this PDF…** (`S`) makes several files, and lists them before saving. Click a name to change it.
  - **Every N pages:** equal parts; `1` makes one file per page.
  - **Page ranges:** one file per range you type, e.g. `1-12, 13-30, 31-58`.
  - **By chapters:** one file per bookmark (§4). You can also choose second-level bookmarks (sections), and put the pages before the first chapter in their own file. Each chapter's file gets that chapter's bookmarks.
  - A split saves into a new sub-folder (*"<title> - split"*) unless you clear that box.
- **Merge PDFs…** (`Shift+M`) joins several PDFs, in the order you set, into one.
  - Start with the open PDF, and add others by searching your library.
  - For each one you can give pages (empty means all of them), and reorder or remove it.
  - The merged PDF gets a bookmark for each original, with that PDF's own bookmarks inside it.

**Where they are saved:** pick a folder from **Save in folder** (it starts at the open PDF's folder). Optionally type a **new sub-folder** name to create one inside it. Only folders inside your library folders are offered. An existing file is **never overwritten**: a second *"Notes.pdf"* becomes *"Notes (2).pdf"*.

**What comes along**, for the pages that are copied (each can be switched off):
- **Notes and resources** on those pages, with the highlights and comments inside them. Page ranges are cut down to the copied pages. Whole-document notes stay only with the original.
- **Highlights and drawings.** If the original's highlights weren't saved into its file yet, the new PDF shows *Save to PDF* too.
- **Bookmarks**, written into the new PDF's outline.

To get rid of a new PDF you don't want, delete the file in your file manager and press ↻ *Rescan* in the library.

---

## 9. Getting text from a PDF (Markdown or plain text), and OCR

You can pull the text out of a page, a range of pages, the whole PDF, or just a box you draw on a page. The text then opens in a window where you can **copy** it, **save it as a note**, or **download** it as a `.md` / `.txt` file.

### Two ways to read a PDF

- **The PDF's own text:** instant and exact. Use it for PDFs made on a computer (slides, books, typed notes); most of your library is like this.
- **OCR (optical character recognition):** reads the page as a picture. It's needed for **scanned** pages and photos of handwritten notes, which contain no text at all.

**OCR never runs on its own, and your PDF isn't changed by it.** It works on a temporary copy. You decide afterwards whether to add the recognised text to the PDF.

### Installing OCR (once)

OCR uses the free programs OCRmyPDF and Tesseract. In a terminal:

```
sudo apt install ocrmypdf tesseract-ocr
```

There's no need to restart StudySpace. For other languages, also install the language pack and list the languages in `.env`. For Bangla + English, for example:

```
sudo apt install tesseract-ocr-ben
STUDYSPACE_OCR_LANG=eng+ben     # in .env, then restart StudySpace
```

### Keys: text or OCR in one press

| | This page | Choose pages… | Whole PDF | A bookmark's section… |
| --- | --- | --- | --- | --- |
| **The PDF's own text** (instant) | `Shift+T` | `Shift+G` | `Shift+A` | `Shift+E` |
| **OCR** (for scans) | `Shift+O` | `Shift+P` | `Shift+W` | `Shift+U` |

- *This page* and the PDF's text for *Whole PDF* start straight away.
- *Choose pages…* opens the window with the **From** box ready. Type the first page, `Tab`, the last page, then `Enter`.
- *A bookmark's section…* opens the window with the bookmark you're reading in already chosen: press `Enter`, or type to find another one first (see below).
- *OCR the whole PDF* waits for `Enter`, since a big book takes a while.

The same items are in **🔧 Page tools**, under *Get text* and *OCR*, with their keys shown.

### Marking your highlights in the text

With **Mark my highlights** on (the default), text you highlighted in the PDF comes out wrapped as `==highlighted text==`. That covers text and area highlights made in StudySpace, plus highlights saved into the PDF by any other reader. In a note, StudySpace shows it **highlighted in yellow**; Obsidian and Typora show `==…==` as a highlight too.

- Turn it off for clean text: untick it, or press **`H`** in the window. It works on the result too, and rebuilds the text with or without marks.
- The result line says how many highlighted passages were marked.
- A highlight that covers most of a word marks the whole word.
- Region OCR (a box) has no marks; page text and page OCR do.

### Including your notes

Tick **Include my notes** (or press **`I`**, in the options or on the result) to put your notes into the text. Every kind counts: notes, summaries, AI explanations, previous-year questions and links.

- A note for one page, or for a range of pages, goes right **after the last of its pages** that you're reading. For example, a note for pages 3–6 comes after page 5's text when you read pages 1–5.
- Notes for the **whole PDF** go at the end, but only when you read the whole PDF.
- In Markdown each note is a quote headed **My note: ‹title›** *(page 3)*, so it stands out from the book's text. In plain text it sits between `[My note: … (page 3)]` and `[end of note]`.
- The result line says how many notes were included. The choice is remembered. It is off at first.

### Text of a bookmark's section

Read one chapter or section, from its bookmark up to where the next bookmark starts:

1. Press **`Shift+E`** for the text (**`Shift+U`** for OCR). Or press **`4`** in the Get text window, or use **🔧 Page tools → A bookmark's section…**.
2. The bookmark you're reading in is already chosen. To pick another, type part of its title in the find box; **↑ / ↓** move through the list and each one shows its pages.
3. Press **`Enter`**, or double-click it.

From the bookmarks list it is one key: focus a bookmark and press **`T`** (text) or **`O`** (OCR).

- **A chapter includes its sections.** It runs to the next chapter. To read only up to its first section, untick *Include the bookmarks inside it*.
- **It starts and ends mid-page.** The text starts at the bookmark's own heading and stops just before the next one's heading, even when these are halfway down a page. If a heading can't be found (some PDFs, or scans), the spot the bookmark points to is used instead.
- *Save as note* titles the note after the bookmark, for example *"Tanenbaum — 1.3 COMPUTER HARDWARE REVIEW (pages 51–66)"*.

### Text of pages

1. Open **🔧 Page tools → Get text → Choose pages…** (`Shift+G`), or use a key from the table above.
2. Choose the pages: **This page**, **Pages** *from–to*, **Whole PDF**, or **A bookmark's section** (see above).
3. Choose **How**: *Use the PDF's text*, or *Run OCR*.
4. Choose **Markdown** or **Plain text**. Optionally turn on **Page markers** and **Skip repeated headers/footers** (on by default; it drops running headers and page numbers). Then choose whether to **Mark my highlights** and **Include my notes**.
5. Click **Get text** (or **Run OCR**), or press **`Enter`**. A progress bar shows how far it is, and **Cancel** stops it.

Every option has a key, shown beside it: **`1` / `2` / `3` / `4`** this page / pages / whole PDF / a bookmark's section, **`T` / `O`** PDF text / OCR, **`M`** Markdown ⇄ plain, **`H`** mark highlights, **`I`** include notes, **`Enter`** start.

If some of the pages turn out to be scanned images, the result says so, with a **Run OCR on these** button that reads just those pages.

In Markdown, slide titles and big headings become `#` headings, bullet points become lists, and lines are joined back into paragraphs. Saved as a note, it gets your usual note colours.

### Text of a region (part of a page)

1. Pick the **OCR region tool** in the toolbar (the scan icon), or press **`O`**.
2. Drag a box over the part you want, or right-click (two-finger tap) its top-left and then its bottom-right corner: a diagram, a screenshot inside a slide, one paragraph of a scan.
3. The text opens right away. If that part of the page also has real text, a link lets you switch between *OCR* and *the PDF's text*.

Press **`V`** (or `Esc`) to go back to normal selection.

### The result window

Keys: **`C`** copy · **`N`** save as note · **`D`** download · **`M`** Markdown ⇄ plain · **`H`** highlight marks on/off · **`I`** notes in/out · **`V`** preview ⇄ raw · **`A`** add the OCR text layer (then `Enter` to confirm) · **`B`** back to the options · **`Esc`** close.

- **Preview / Raw / edit:** see it rendered, or fix the text by hand before saving.
- **Markdown / Plain text:** switch the format. This rebuilds the text, so do it before editing.
- **Copy:** copies the text to the clipboard.
- **Download .md / .txt:** saves a file, handy for whole textbooks.
- **Save as note:** a note titled *"‹PDF› — page 4"* (or *pages 3–9*, *whole PDF*, or the bookmark's title), attached to those pages. Ctrl+Z removes it again.
  - Very long texts make slow notes. Above about 150,000 characters you get a warning, and above 1,000,000 a smaller page range is needed.
- **Add this text to the PDF** (after page OCR only): writes the recognised text into the PDF as an invisible layer.
  - The pages look exactly the same.
  - Afterwards their text can be selected, highlighted, searched and copied, here and in any PDF reader.
  - It asks you to confirm first, and **Ctrl+Z** removes the layer again.
  - Text that was already in the PDF is kept as it is. OCR only reads what's inside the page images, so slides with pictures don't get their text twice.

If you close the window without adding the text, the PDF stays exactly as it was.

### Limits

- **Handwriting:** OCR handles printed text well, but handwriting poorly. Expect gaps and mistakes on handwritten notes.
- **Formulas:** formulas never come back as LaTeX. They come out as plain characters, and matrices and fractions get flattened.
- **Layout:** pages with several columns or complex layouts may come out in an odd order. The region tool helps there. Scans with two book pages per sheet come out one book page after the other.
- **Speed:** about 3–6 seconds per scanned page. A whole 150-page scanned book takes several minutes; the progress bar shows how far it is, and you can keep reading meanwhile.
- **Scan stamps:** some scans carry a tiny stamp such as `45.jpg` or *Scanned with CamScanner* as their only text. StudySpace treats those pages as scans and leaves the stamp out of the text.

---

## 10. Undo and redo

| Action | How |
| --- | --- |
| Undo | **`Ctrl+Z`**, or the **↶** button at the top-left of the toolbar |
| Redo | **`Ctrl+Shift+Z`** or **`Ctrl+Y`**, or the **↷** button |

Hover over ↶ / ↷ to see exactly what will be undone or redone, e.g. *"Undo: Delete page 4"*. After each step a short message confirms it.

**What can be undone:**
- adding, editing or deleting a note or resource
- adding, recolouring or erasing highlights and drawings (also highlights on HTML and Markdown files)
- adding, renaming, moving or deleting bookmarks
- renaming or deleting a file in the library (§3)
- adding an OCR text layer to pages
- deleting, inserting (blank or from another PDF), replacing, turning and moving pages: the previous version of the file is restored exactly, and every note, range and highlight returns to its original page
- **Save to PDF**

**Good to know:**
- Each PDF has its own undo history, so switching files and coming back still lets you undo there. The history lasts until you close or reload the browser tab.
- Undo works one step at a time, newest first.
- Page edits keep the last **10** previous versions of each PDF (configurable with `STUDYSPACE_HISTORY_LIMIT` in `.env`). They are stored in `~/.local/share/studyspace/history/`.
- If another program modifies the PDF after a StudySpace edit, that edit can no longer be undone. StudySpace says so instead of overwriting the other program's changes.
- While you are typing in a text box, `Ctrl+Z` undoes your typing there, as usual.

---

## 11. AI explanations (optional)

There are no AI buttons in the app for now; StudySpace works fully offline. You can still store explanations yourself: click **+ Add note or resource** and choose the *AI Explanation* or *Summary* type, for example to paste an answer from ChatGPT. Math pasted with `\( … \)` renders correctly (§5).

The server keeps a ready-made hook for connecting an AI model later (see the README's *Adding an AI provider*).

---

## 12. All keyboard shortcuts

**Moving between text boxes:** in any dialog or form, **`↓`** jumps to the next *empty* text box (or the next one, when all are filled), and **`↑`** goes back to the previous one. Inside a multi-line box, `↑`/`↓` move between lines as usual.

Every feature has a key. You see it **beside the feature**: on the right of each item in the 🔧 **Page tools** menu, on buttons (for example *Add note or resource* `N`, the *Files* `L` and *Bookmarks* `Shift+B` tabs) and in every button's tooltip. Press **`?`** in the app for this list, with a search box (type e.g. "split" or "Shift+R").

Shortcuts don't fire while you are typing in a text box. While a dialog is open, only that dialog's keys work. One-letter keys are case-insensitive; `Shift+…` keys need Shift.

**General**

| Keys | Action |
| --- | --- |
| `?` | Show this help |
| `Ctrl+K` | Search files and notes |
| `Ctrl+Z` | Undo (notes, highlights, bookmarks, page edits, Save to PDF) |
| `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Ctrl+S` | Save highlights, drawings & bookmarks into the PDF |
| `Shift+D` | Dark / light mode |
| `Shift+V` | Hide / show the title bar and the tools bar (more room to read) |
| `,` | Settings (study folders, note colours) |
| `Shift+L` | Rescan the library folders |
| `Shift+F` | Pictures, text & notes of the files selected in the files list… |

**Panels**

| Keys | Action |
| --- | --- |
| `[` | Show / hide the left panel (files, bookmarks) |
| `]` | Show / hide the notes panel |
| `L` | Show the library files |
| `Shift+B` | Show this PDF's bookmarks |
| `/` | Filter the files / bookmarks list |
| `F2` | Rename this PDF's file |

**Pages & zoom**

| Keys | Action |
| --- | --- |
| `→` | Next page |
| `←` | Previous page |
| `Home` | First page |
| `End` | Last page |
| `G` | Go to page (type it, press Enter) |
| `Alt+←` / `Backspace` | Back to where you jumped from (a link, bookmark, note or page number) |
| `Alt+→` / `Shift+Backspace` | Forward again, after going back |
| `+` / `=` / `Ctrl+=` / `Ctrl++` | Zoom in |
| `-` / `_` / `Ctrl+-` | Zoom out |
| `0` / `Ctrl+0` | Zoom 100% |
| `W` | Fit page width |
| `F` | Fit whole page |
| `Ctrl+Wheel` | Smooth zoom |

**Side by side**

| Keys | Action |
| --- | --- |
| `\` | Open a PDF beside this one, or change it… |
| `\|` | Close the PDF beside |
| `Shift+X` | Swap the two (the open one has the tools and notes) |
| `Shift+→` | Next page of the PDF beside |
| `Shift+←` | Previous page of the PDF beside |

**Tools**

| Keys | Action |
| --- | --- |
| `V` | Select text |
| `H` | Highlight text (just select it) |
| `A` | Highlight an area: right-click two corners, or drag |
| `P` | Pen (draw freehand) |
| `E` | Eraser (click or drag over marks) |
| `O` | Get text from a region: right-click two corners, or drag |
| `Y` | Text box: click (or drag its width) and type; Ctrl+Enter or a click outside finishes, Esc cancels |
| `K` | Note marker: click a spot on the page, then write its note (clicking the marker opens it) |
| `Esc` | Cancel a box after its first corner |
| `1–5` | Pick colour 1–5 (highlight, area, pen & text box tools) |
| `Shift+1–3` | Pen width: fine / medium / bold (text box tool: text size) |
| `Esc` | Back to Select; closes menus and bars |
| `Ctrl+]` | While typing a text box: larger text |
| `Ctrl+[` | While typing a text box: smaller text |
| `Ctrl+Shift+1–5` | While typing a text box: change its colour (colour 1–5) |

**Selected text & highlights**

| Keys | Action |
| --- | --- |
| `1–5` | Highlight the selection / recolour the highlight (colour 1–5) |
| `N` | Quote the selection / highlight into a new note |
| `Ctrl+C` | Copy the selected text |
| `Del` | Delete the clicked highlight, drawing or text box |
| `Enter` | Edit the clicked text box |
| `K` | In a note: pin the selected text to a spot on the page (then click the spot) |
| `Del` | Remove a focused note marker (or right-click the marker) |
| `1–9` | Recolour a clicked heading, label or ==mark== in a note (colour 1–9) |
| `0` | …give it no colour |
| `Del` | …give it back its default colour |

**Notes & bookmarks**

| Keys | Action |
| --- | --- |
| `N` | New note for this page |
| `C` | Close all / expand all notes |
| `B` | Bookmark this spot (selected text becomes its title) |
| `Shift+N` | Download this file's notes (one .md file per note, in a .zip) |
| `Ctrl+Click` | Open a library PDF in a new browser tab |

**Pictures**

| Keys | Action |
| --- | --- |
| `D` | Show / hide the pictures saved for this page (they fill the notes column) |
| `U` | Add a picture for this page (choose a file) |
| `Ctrl+V` | Paste a copied picture for this page (dropping a picture on the notes or slides works too) |
| `Ctrl+→` | Next picture |
| `Ctrl+←` | Previous picture |
| `J` | Pages of the shown picture, or remove it… |

**Page tools**

| Keys | Action |
| --- | --- |
| `T` | Open the Page tools menu |
| `I` | Insert a blank page after this one… |
| `Shift+I` | Insert pages from another PDF… |
| `R` | Replace this page… |
| `Shift+R` | Turn (rotate) pages… |
| `M` | Move pages… |
| `Shift+Del` | Delete this page… |
| `Ctrl+Del` | Delete several pages… |

**New PDFs**

| Keys | Action |
| --- | --- |
| `X` | Extract pages to a new PDF… |
| `S` | Split this PDF… |
| `Shift+M` | Merge PDFs… |

**Images**

| Keys | Action |
| --- | --- |
| `Q` | Screenshot any part of the window → clipboard: click two corners or drag (Enter: whole window, Esc: cancel) |
| `Shift+C` | Copy this page as an image (paste it anywhere) |
| `Shift+H` | Cut this page in half: copy the two halves… |
| `Shift+S` | Save pages as pictures (PNG / JPEG; several pages in one .zip)… |

**Get text & OCR**

| Keys | Action |
| --- | --- |
| `Shift+T` | Text of this page |
| `Shift+G` | Text of chosen pages… (or OCR them: press O in the window) |
| `Shift+A` | Text of the whole PDF |
| `Shift+O` | OCR this page |
| `Shift+P` | OCR chosen pages… |
| `Shift+W` | OCR the whole PDF… (Enter starts it) |
| `Shift+E` | Text of a bookmark's section, up to the next bookmark… (Enter: the one you're in) |
| `Shift+U` | OCR a bookmark's section… (Enter: the one you're in) |

**In the Get text window**

| Keys | Action |
| --- | --- |
| `1` | Pages: this page |
| `2` | Pages: choose a range |
| `3` | Pages: whole PDF |
| `4` | Pages: a bookmark's section (type to find it, ↑ / ↓ to pick) |
| `T` | Use the PDF's text |
| `O` | Use OCR |
| `H` | Mark my highlights as ==text== on / off |
| `I` | Include my notes on / off (after the pages they're for) |
| `M` | Markdown ⇄ plain text |
| `Enter` | Start |
| `C` | Copy the text |
| `N` | Save as a note |
| `D` | Download .md / .txt |
| `V` | Preview ⇄ raw / edit |
| `A` | Add the OCR text layer to the PDF (asks first; Enter confirms) |
| `B` | Back to the options |

**In the cut-in-half window**

| Keys | Action |
| --- | --- |
| `1` | Copy the top / left half |
| `2` | Copy the bottom / right half |
| `B` | Copy both halves |
| `S` | Save both as PNG files |
| `D` | Cut across ⇄ down the middle |
| `←` / `→` | Move the cut line (Shift: in bigger steps) |
| `0` | Put the cut line back in the middle |
| `PageUp` / `PageDown` | Previous / next page |

**In the Save pictures window**

| Keys | Action |
| --- | --- |
| `1` | This page |
| `2` | Choose pages (type e.g. 3, 5-9) |
| `3` | Whole PDF |
| `F` | PNG ⇄ JPEG |
| `R` | Sharpness: 100 → 150 → 200 → 300 dpi |
| `C` | Copy the picture (one page only) |
| `Enter` | Save |

**In the picture pages window**

| Keys | Action |
| --- | --- |
| `1` | This page |
| `2` | Choose pages |
| `3` | Whole PDF |
| `Enter` | Save |
| `Del` | Remove the picture |

**In the bookmarks list**

| Keys | Action |
| --- | --- |
| `↑` / `↓` | Previous / next bookmark |
| `→` / `←` | Open / close a chapter |
| `Enter` | Jump to it |
| `T` | Get the text of its section (up to the next bookmark) |
| `O` | OCR its section |
| `F2` | Rename |
| `Del` | Delete (with the bookmarks inside) |
| `Alt+↑` / `Alt+↓` | Move up / down |
| `Alt+→` / `Alt+←` | Nest under the one above / un-nest |

**In the files list**

| Keys | Action |
| --- | --- |
| `↑` / `↓` | Previous / next file or folder (↓ from the filter box goes in) |
| `→` / `←` | Open / close a folder |
| `Enter` | Open the file / folder |
| `F2` | Rename the file |
| `Shift+Enter` | Open the PDF beside the open one |
| `Del` | Delete the file (to the Trash; asks first) |
| `Space` | Select / unselect the file (on a folder: all its files) |
| `Shift+↑` / `Shift+↓` | Select while moving up / down |
| `Shift+Click` | Select every file from the last one picked to this one |
| `Ctrl+A` | Select all the files showing (the filter's matches) |
| `Esc` | Unselect all |

**In the selected-files window**

| Keys | Action |
| --- | --- |
| `↑` / `↓` | Previous / next file |
| `P` | Save the file's pages as pictures (.zip) |
| `T` | Download the file's text (.md / .txt) |
| `N` | Download the file's notes (one .md per note, in a .zip) |
| `Del` | Cancel the file's waiting or running downloads |
| `F` | Pictures: PNG ⇄ JPEG |
| `R` | Pictures: sharpness 100 → 150 → 200 → 300 dpi |
| `M` | Text: Markdown ⇄ plain text |
| `H` | Text: mark my highlights as ==text== on / off |
| `I` | Text: include my notes on / off |

**In dialogs & editors**

| Keys | Action |
| --- | --- |
| `Enter` | Confirm a page dialog (in its first field) |
| `Ctrl+Enter` | Save the note or comment you're writing |
| `Esc` | Close the dialog / cancel editing |
| `↓` / `↑` | Next empty text box / previous text box |

---

## 13. Where your data is, and how to recover

| What | Where |
| --- | --- |
| Notes, resources, highlights, reading positions | `~/.local/share/studyspace/studyspace.db` |
| Pictures in notes | `~/.local/share/studyspace/images/` (named by their content, never deleted) |
| Previous versions of PDFs you edited (for undo) | `~/.local/share/studyspace/history/<document-id>/` |
| Your PDFs | Exactly where they were, e.g. `/home/dipra/Buet/3-1/…` |
| Files you deleted in the library | The desktop Trash (`~/.local/share/Trash/`); restore them from your file manager, then click **⟳ Rescan** |
| Logins of your phone (or other devices) | In the same database; *Log out of this device* in ⚙ Settings on the phone ends one |

- **Back up your notes:** copy `~/.local/share/studyspace/` somewhere safe while the app is stopped.
- **Recover an older version of a PDF by hand:** the newest files in `history/<document-id>/` are the versions before your most recent edits. Copy one back over the original while the app is stopped, then click **Rescan**.

## 14. Troubleshooting

| Message / problem | What to do |
| --- | --- |
| *"This PDF is encrypted"* | You can read, take notes and highlight (kept in StudySpace), but you can't save into the file or add/delete pages. |
| *"The PDF file is read-only"* | Give yourself write permission on the file (`chmod u+w file.pdf`) to save into it or edit pages. |
| *"The PDF changed on disk since it was opened"* | Another program changed the file. Click the file in the library again to reload it, then retry. |
| A new or renamed file doesn't appear | Click **⟳ Rescan** in the library. |
| A file shows no notes after moving it | Click **⟳ Rescan**. Moved files are matched by content and keep their notes. |
| The page looks blurry while zooming | It re-renders sharply a moment after you stop zooming. |
| The phone says *"Can't reach StudySpace"* | Is the computer on and awake, with StudySpace running? On Wi-Fi: same network, and `STUDYSPACE_HOST=0.0.0.0` in `.env`? Away: is Tailscale switched on in the phone? |
| The phone says StudySpace *"has no password yet"* | Add `STUDYSPACE_PASSWORD=…` to `.env` on the computer and restart StudySpace (§15). |
| *"Unknown address …"* | StudySpace only answers to this computer's own names and addresses. Add the one you used to `STUDYSPACE_ALLOWED_HOSTS` in `.env`. |
| *Copy* does nothing on the phone | Browsers block copying on plain `http://` addresses. Use the Tailscale `https://` address, or the phone's own Copy. |
| A change on the computer doesn't show on the phone (or the other way round) | Tabs on the same device update each other, but devices don't. Reload the page on the other device. |

---

## 15. Using StudySpace on your phone

> The same steps as a checklist, with troubleshooting: [PHONE_SETUP.md](PHONE_SETUP.md).

Your files stay on the computer. The phone opens StudySpace in its browser, like a website the computer serves, and what you change there changes the files on the computer. So the computer must be **on, awake and running StudySpace** (`npm run dev`).

**First, on the computer, once:**
1. Add a password to the `.env` file in the StudySpace folder: `STUDYSPACE_PASSWORD=pick-a-password`. Without it, StudySpace refuses every other device.
2. The phone uses the built app on port 4317, so after an update run `npm run build`.

**At home (same Wi-Fi as the computer):**
1. Also add `STUDYSPACE_HOST=0.0.0.0` to `.env` (it lets devices on your Wi-Fi in), then restart StudySpace (`Ctrl+C`, then `npm run dev`). It prints the address to open, e.g. `http://192.168.0.114:4317`.
2. If `sudo ufw status` says *active*, allow the port once: `sudo ufw allow from 192.168.0.0/24 to any port 4317`.
3. On the phone, open that address and log in. The phone stays logged in for 90 days.
4. Limits: only on that Wi-Fi; the address can change after the router restarts (`hostname -I` shows the new one); copying doesn't work; the connection isn't encrypted, so don't use this on hall or public Wi-Fi.

**Anywhere (mobile data, any Wi-Fi), with Tailscale:** Tailscale is a free app that links your own devices privately and encrypted. You don't need the `STUDYSPACE_HOST` line for this.
1. On the computer:
   ```bash
   sudo apt install curl
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```
   The last command shows a link: open it and log in.
2. On the phone, install the **Tailscale** app, log in with the same account and switch it on.
3. On the computer, run `sudo tailscale serve --bg 4317`. The first time, it gives a link to turn on HTTPS: open it and enable it. It then shows your address, like `https://your-pc.tail1234.ts.net`. This stays set after a restart.
4. On the phone, open that address and log in. Copying works here.

**Tip:** in the phone's browser menu, choose *Add to Home screen* for a StudySpace icon.

**On the phone you can** open files, read, write notes, highlight (long-press the text, drag the handles, then pick a colour in the bar below it), rename or delete files, and undo. Search is the 🔍 button. ⚙ Settings has *Log out of this device*.

**Only on the computer:** adding or changing study folders (for safety). Zoom with the **+** / **−** buttons; pinching the page doesn't zoom the PDF.

