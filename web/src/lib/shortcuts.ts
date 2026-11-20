/**
 * Every keyboard shortcut in StudySpace, in one place. The key handlers match against these, and the
 * help screen, tooltips and menus show them, so what is shown is always what works.
 *
 * Key syntax: modifiers ("Ctrl", "Shift", "Alt") joined with "+" to a key: a letter, a digit, a
 * symbol, or a KeyboardEvent.key name ("ArrowRight", "Delete", "Home"…). "Ctrl" also matches ⌘ on a
 * Mac. Entries whose key isn't a single combination (e.g. "1–5") are shown but handled by hand.
 */

export type ShortcutGroup =
  | "General"
  | "Panels"
  | "Pages & zoom"
  | "Side by side"
  | "Tools"
  | "Selected text & highlights"
  | "While a phrase is shown"
  | "Notes & bookmarks"
  | "Pictures"
  | "Page tools"
  | "New PDFs"
  | "Images"
  | "Get text & OCR"
  | "In the Get text window"
  | "In the cut-in-half window"
  | "In the Save pictures window"
  | "In the picture pages window"
  | "In the bookmarks list"
  | "In the files list"
  | "In the favourites list"
  | "In the selected-files window"
  | "In the hidden-files window"
  | "In dialogs & editors";

export interface Shortcut {
  keys: string[];
  label: string;
  group: ShortcutGroup;
}

const s = (group: ShortcutGroup, label: string, ...keys: string[]): Shortcut => ({ group, label, keys });

export const SHORTCUTS = {
  // General
  help: s("General", "Show this help", "?"),
  search: s("General", "Search files and notes", "Ctrl+K"),
  undo: s("General", "Undo (notes, highlights, bookmarks, page edits, Save to PDF)", "Ctrl+Z"),
  redo: s("General", "Redo", "Ctrl+Shift+Z", "Ctrl+Y"),
  save: s("General", "Save highlights, drawings & bookmarks into the PDF", "Ctrl+S"),
  theme: s("General", "Dark / light mode", "Shift+D"),
  hideBars: s("General", "Hide / show the title bar and the tools bar (more room to read)", "Shift+V"),
  landscape: s("General", "Full screen; on a phone also turned sideways, for wide pages (again: back)", "Shift+J"),
  settings: s("General", "Settings (study folders, note colours)", ","),
  rescan: s("General", "Rescan the library folders", "Shift+L"),
  selectedFiles: s("General", "Pictures, text & notes of the files selected in the files list…", "Shift+F"),
  hiddenFiles: s("General", "Hidden files: the list, to unhide them", "Shift+K"),

  // Panels
  toggleLeft: s("Panels", "Show / hide the left panel (files, favourites, bookmarks)", "["),
  toggleRight: s("Panels", "Show / hide the notes panel", "]"),
  files: s("Panels", "Show the library files", "L"),
  favorites: s("Panels", "Show your favourite files", "*"),
  favorite: s("Panels", "Add the open file to your favourites / take it out", "Ctrl+D"),
  bookmarks: s("Panels", "Show this PDF's bookmarks", "Shift+B"),
  filter: s("Panels", "Filter the files / favourites / bookmarks list", "/"),
  renameFile: s("Panels", "Rename this PDF's file", "F2"),

  // Pages & zoom
  nextPage: s("Pages & zoom", "Next page", "ArrowRight"),
  prevPage: s("Pages & zoom", "Previous page", "ArrowLeft"),
  firstPage: s("Pages & zoom", "First page", "Home"),
  lastPage: s("Pages & zoom", "Last page", "End"),
  goToPage: s("Pages & zoom", "Go to page (type it, press Enter)", "G"),
  historyBack: s("Pages & zoom", "Back to where you jumped from (a link, bookmark, note or page number)", "Alt+ArrowLeft", "Backspace"),
  historyForward: s("Pages & zoom", "Forward again, after going back", "Alt+ArrowRight", "Shift+Backspace"),
  zoomIn: s("Pages & zoom", "Zoom in", "+", "=", "Ctrl+=", "Ctrl++"),
  zoomOut: s("Pages & zoom", "Zoom out", "-", "_", "Ctrl+-"),
  zoomReset: s("Pages & zoom", "Zoom 100%", "0", "Ctrl+0"),
  fitWidth: s("Pages & zoom", "Fit page width", "W"),
  fitPage: s("Pages & zoom", "Fit whole page", "F"),
  wheelZoom: s("Pages & zoom", "Smooth zoom", "Ctrl+Wheel"),

  // Side by side (a second PDF to read beside the open one)
  sideOpen: s("Side by side", "Open a PDF beside this one, or change it…", "\\"),
  sideClose: s("Side by side", "Close the PDF beside", "|"),
  sideSwap: s("Side by side", "Swap the two (the open one has the tools and notes)", "Shift+X"),
  sideNext: s("Side by side", "Next page of the PDF beside", "Shift+ArrowRight"),
  sidePrev: s("Side by side", "Previous page of the PDF beside", "Shift+ArrowLeft"),

  // Tools
  select: s("Tools", "Select text", "V"),
  highlight: s("Tools", "Highlight text: click a word (the highlight runs to the next punctuation), or select the text", "H"),
  area: s("Tools", "Highlight an area: right-click two corners, or drag (over text the box tidies to whole words); a click on a word highlights its phrase", "A"),
  areaExact: s("Tools", "Area tool: hold while finishing a box to keep it exactly as drawn", "Alt"),
  pen: s("Tools", "Pen (draw freehand)", "P"),
  eraser: s("Tools", "Eraser (click or drag over marks)", "E"),
  ocr: s("Tools", "Get text from a region: right-click two corners, or drag", "O"),
  text: s("Tools", "Text box: click (or drag its width) and type; Ctrl+Enter or a click outside finishes, Esc cancels", "Y"),
  marker: s("Tools", "Note marker: click a spot on the page, then write its note (clicking the marker opens it)", "K"),
  cancelCorner: s("Tools", "Cancel a box after its first corner", "Escape"),
  colour: s("Tools", "Pick colour 1–5 (highlight, area, pen & text box tools)", "1–5"),
  penWidth: s("Tools", "Pen width: fine / medium / bold (text box tool: text size)", "Shift+1–3"),
  back: s("Tools", "Back to Select; closes menus and bars", "Escape"),

  // Selected text & highlights (while the floating bar is open)
  selColour: s("Selected text & highlights", "Highlight the selection / recolour the highlight (colour 1–5)", "1–5"),
  selNote: s("Selected text & highlights", "Quote the selection / highlight into a new note", "N"),
  selCopy: s("Selected text & highlights", "Copy the selected text", "Ctrl+C"),
  selDelete: s("Selected text & highlights", "Delete the clicked highlight, drawing or text box", "Delete"),
  textBigger: s("Tools", "While typing a text box: larger text", "Ctrl+]"),
  textSmaller: s("Tools", "While typing a text box: smaller text", "Ctrl+["),
  textColour: s("Tools", "While typing a text box: change its colour (colour 1–5)", "Ctrl+Shift+1–5"),
  selEditText: s("Selected text & highlights", "Edit the clicked text box", "Enter"),
  notePin: s("Selected text & highlights", "In a note: pin the selected text to a spot on the page (then click the spot)", "K"),
  markerDelete: s("Selected text & highlights", "Remove a focused note marker (or right-click the marker)", "Delete"),
  styleColour: s("Selected text & highlights", "Recolour a clicked heading, label or ==mark== in a note (colour 1–9)", "1–9"),
  styleNone: s("Selected text & highlights", "…give it no colour", "0"),
  styleDefault: s("Selected text & highlights", "…give it back its default colour", "Delete"),

  // While a phrase is shown (Highlight or Area tool: a click on a word shows it, up to the next stop)
  phraseClick: s("While a phrase is shown", "Show the phrase from the clicked word to the next stop (a punctuation mark, or a cell's or paragraph's end)", "Click"),
  phraseClickSave: s("While a phrase is shown", "Save it: click it again (so a double-click on a word saves it at once)", "Double-click"),
  phraseClickEnd: s("While a phrase is shown", "End it at a word and save: right-click (two-finger tap) or Shift+click that word", "Right-click", "Shift+Click"),
  phraseEnd: s("While a phrase is shown", "End at the next / previous stop (also before “and”, “which”, “(”)", "ArrowRight", "ArrowLeft"),
  phraseEndWord: s("While a phrase is shown", "End one word further / back", "Shift+ArrowRight", "Shift+ArrowLeft"),
  phraseStart: s("While a phrase is shown", "Start back at the stop before (the whole clause) / after the next stop (drops a label)", "ArrowUp", "ArrowDown"),
  phraseStartWord: s("While a phrase is shown", "Start one word earlier / later", "Shift+ArrowUp", "Shift+ArrowDown"),
  phraseSave: s("While a phrase is shown", "Save the highlight (colour 1–5: in that colour)", "Enter", " "),
  phraseNext: s("While a phrase is shown", "Save it and show the next phrase", "Tab"),
  phraseNote: s("While a phrase is shown", "Quote it into a new note", "N"),
  phraseCopy: s("While a phrase is shown", "Copy its text", "Ctrl+C"),
  phraseCancel: s("While a phrase is shown", "Cancel", "Escape"),

  // Notes & bookmarks
  newNote: s("Notes & bookmarks", "New note for this page", "N"),
  toggleNotes: s("Notes & bookmarks", "Close all / expand all notes", "C"),
  addBookmark: s("Notes & bookmarks", "Bookmark this spot (selected text becomes its title)", "B"),
  downloadNotes: s("Notes & bookmarks", "Download this file's notes (one .md file per note, in a .zip)", "Shift+N"),
  newTab: s("Notes & bookmarks", "Open a library PDF in a new browser tab", "Ctrl+Click"),

  // Pictures: their own section in the notes column, shown as slides
  viewPictures: s("Pictures", "Show / hide the pictures saved for this page (they fill the notes column)", "D"),
  addPicture: s("Pictures", "Add a picture for this page (choose a file)", "U"),
  pastePicture: s("Pictures", "Paste a copied picture for this page (dropping a picture on the notes or slides works too)", "Ctrl+V"),
  pictureNext: s("Pictures", "Next picture", "Ctrl+ArrowRight"),
  picturePrev: s("Pictures", "Previous picture", "Ctrl+ArrowLeft"),
  pictureWhere: s("Pictures", "Pages of the shown picture, or remove it…", "J"),

  // Page tools (they change the PDF; all undoable)
  pageTools: s("Page tools", "Open the Page tools menu", "T"),
  insertBlank: s("Page tools", "Insert a blank page after this one…", "I"),
  insertFrom: s("Page tools", "Insert pages from another PDF…", "Shift+I"),
  replace: s("Page tools", "Replace this page…", "R"),
  turn: s("Page tools", "Turn (rotate) pages…", "Shift+R"),
  move: s("Page tools", "Move pages…", "M"),
  deletePage: s("Page tools", "Delete this page…", "Shift+Delete"),
  deletePages: s("Page tools", "Delete several pages…", "Ctrl+Delete"),

  // New PDFs (the source PDFs are not changed)
  extract: s("New PDFs", "Extract pages to a new PDF…", "X"),
  split: s("New PDFs", "Split this PDF…", "S"),
  merge: s("New PDFs", "Merge PDFs…", "Shift+M"),

  // Copy as image
  snip: s("Images", "Screenshot any part of the window → clipboard: click two corners or drag (Enter: whole window, Esc: cancel)", "Q"),
  copyPage: s("Images", "Copy this page as an image (paste it anywhere)", "Shift+C"),
  halves: s("Images", "Cut this page in half: copy the two halves…", "Shift+H"),
  savePictures: s("Images", "Save pages as pictures (PNG / JPEG; several pages in one .zip)…", "Shift+S"),

  // Get text & OCR (nothing in the PDF changes unless you add an OCR text layer afterwards)
  textPage: s("Get text & OCR", "Text of this page", "Shift+T"),
  textPages: s("Get text & OCR", "Text of chosen pages… (or OCR them: press O in the window)", "Shift+G"),
  textAll: s("Get text & OCR", "Text of the whole PDF", "Shift+A"),
  ocrPage: s("Get text & OCR", "OCR this page", "Shift+O"),
  ocrPages: s("Get text & OCR", "OCR chosen pages…", "Shift+P"),
  ocrAll: s("Get text & OCR", "OCR the whole PDF… (Enter starts it)", "Shift+W"),
  textSection: s("Get text & OCR", "Text of a bookmark's section, up to the next bookmark… (Enter: the one you're in)", "Shift+E"),
  ocrSection: s("Get text & OCR", "OCR a bookmark's section… (Enter: the one you're in)", "Shift+U"),

  // The Get text window
  gtThis: s("In the Get text window", "Pages: this page", "1"),
  gtRange: s("In the Get text window", "Pages: choose a range", "2"),
  gtAll: s("In the Get text window", "Pages: whole PDF", "3"),
  gtBookmark: s("In the Get text window", "Pages: a bookmark's section (type to find it, ↑ / ↓ to pick)", "4"),
  gtText: s("In the Get text window", "Use the PDF's text", "T"),
  gtOcr: s("In the Get text window", "Use OCR", "O"),
  gtMarks: s("In the Get text window", "Mark my highlights as ==text== on / off", "H"),
  gtNotes: s("In the Get text window", "Include my notes on / off (after the pages they're for)", "I"),
  gtFormat: s("In the Get text window", "Markdown ⇄ plain text", "M"),
  gtStart: s("In the Get text window", "Start", "Enter"),
  gtCopy: s("In the Get text window", "Copy the text", "C"),
  gtNote: s("In the Get text window", "Save as a note", "N"),
  gtDownload: s("In the Get text window", "Download .md / .txt", "D"),
  gtView: s("In the Get text window", "Preview ⇄ raw / edit", "V"),
  gtApply: s("In the Get text window", "Add the OCR text layer to the PDF (asks first; Enter confirms)", "A"),
  gtBack: s("In the Get text window", "Back to the options", "B"),

  // The cut-in-half window
  halfFirst: s("In the cut-in-half window", "Copy the top / left half", "1"),
  halfSecond: s("In the cut-in-half window", "Copy the bottom / right half", "2"),
  halfBoth: s("In the cut-in-half window", "Copy both halves", "B"),
  halfSave: s("In the cut-in-half window", "Save both as PNG files", "S"),
  halfDirection: s("In the cut-in-half window", "Cut across ⇄ down the middle", "D"),
  halfMove: s("In the cut-in-half window", "Move the cut line (Shift: in bigger steps)", "ArrowLeft", "ArrowRight"),
  halfCentre: s("In the cut-in-half window", "Put the cut line back in the middle", "0"),
  halfPage: s("In the cut-in-half window", "Previous / next page", "PageUp", "PageDown"),

  // The Save pictures window
  picThis: s("In the Save pictures window", "This page", "1"),
  picRange: s("In the Save pictures window", "Choose pages (type e.g. 3, 5-9)", "2"),
  picAll: s("In the Save pictures window", "Whole PDF", "3"),
  picFormat: s("In the Save pictures window", "PNG ⇄ JPEG", "F"),
  picQuality: s("In the Save pictures window", "Sharpness: 100 → 150 → 200 → 300 dpi", "R"),
  picCopy: s("In the Save pictures window", "Copy the picture (one page only)", "C"),
  picSave: s("In the Save pictures window", "Save", "Enter"),

  // The picture pages window
  pwThis: s("In the picture pages window", "This page", "1"),
  pwRange: s("In the picture pages window", "Choose pages", "2"),
  pwAll: s("In the picture pages window", "Whole PDF", "3"),
  pwSave: s("In the picture pages window", "Save", "Enter"),
  pwRemove: s("In the picture pages window", "Remove the picture", "Delete"),

  // Bookmarks list (with a bookmark focused)
  bmMoveFocus: s("In the bookmarks list", "Previous / next bookmark", "ArrowUp", "ArrowDown"),
  bmOpenClose: s("In the bookmarks list", "Open / close a chapter", "ArrowRight", "ArrowLeft"),
  bmJump: s("In the bookmarks list", "Jump to it", "Enter"),
  bmText: s("In the bookmarks list", "Get the text of its section (up to the next bookmark)", "T"),
  bmOcr: s("In the bookmarks list", "OCR its section", "O"),
  bmRename: s("In the bookmarks list", "Rename", "F2"),
  bmDelete: s("In the bookmarks list", "Delete (with the bookmarks inside)", "Delete"),
  bmReorder: s("In the bookmarks list", "Move up / down", "Alt+ArrowUp", "Alt+ArrowDown"),
  bmNest: s("In the bookmarks list", "Nest under the one above / un-nest", "Alt+ArrowRight", "Alt+ArrowLeft"),

  // Files list (with a file focused)
  fileMoveFocus: s("In the files list", "Previous / next file or folder (↓ from the filter box goes in)", "ArrowUp", "ArrowDown"),
  fileOpenClose: s("In the files list", "Open / close a folder", "ArrowRight", "ArrowLeft"),
  fileOpen: s("In the files list", "Open the file / folder", "Enter"),
  fileRename: s("In the files list", "Rename the file", "F2"),
  fileBeside: s("In the files list", "Open the PDF beside the open one", "Shift+Enter"),
  fileDelete: s("In the files list", "Delete the file (to the Trash; asks first)", "Delete"),
  fileHide: s("In the files list", "Hide the file from the list (with files selected: all of them)", "H"),
  fileFavorite: s("In the files list", "Add the file to your favourites / take it out (with files selected: all of them)", "F"),
  fileSelect: s("In the files list", "Select / unselect the file (on a folder: all its files)", " "),
  fileSelectMove: s("In the files list", "Select while moving up / down", "Shift+ArrowUp", "Shift+ArrowDown"),
  fileSelectRange: s("In the files list", "Select every file from the last one picked to this one", "Shift+Click"),
  fileSelectAll: s("In the files list", "Select all the files showing (the filter's matches)", "Ctrl+A"),
  fileUnselect: s("In the files list", "Unselect all", "Escape"),

  // Favourites list (with a favourite focused)
  favMoveFocus: s("In the favourites list", "Previous / next favourite (↓ from the filter box goes in)", "ArrowUp", "ArrowDown"),
  favOpen: s("In the favourites list", "Open the file", "Enter"),
  favBeside: s("In the favourites list", "Open the PDF beside the open one", "Shift+Enter"),
  favRemove: s("In the favourites list", "Take it out of the favourites (Ctrl+Z puts it back)", "Delete", "F"),
  favReorder: s("In the favourites list", "Move up / down (or drag it)", "Alt+ArrowUp", "Alt+ArrowDown"),

  // The selected-files window
  sfMove: s("In the selected-files window", "Previous / next file", "ArrowUp", "ArrowDown"),
  sfPictures: s("In the selected-files window", "Save the file's pages as pictures (.zip)", "P"),
  sfText: s("In the selected-files window", "Download the file's text (.md / .txt)", "T"),
  sfNoteFiles: s("In the selected-files window", "Download the file's notes (one .md per note, in a .zip)", "N"),
  sfCancel: s("In the selected-files window", "Cancel the file's waiting or running downloads", "Delete"),
  sfPicFormat: s("In the selected-files window", "Pictures: PNG ⇄ JPEG", "F"),
  sfPicQuality: s("In the selected-files window", "Pictures: sharpness 100 → 150 → 200 → 300 dpi", "R"),
  sfTextFormat: s("In the selected-files window", "Text: Markdown ⇄ plain text", "M"),
  sfMarks: s("In the selected-files window", "Text: mark my highlights as ==text== on / off", "H"),
  sfNotes: s("In the selected-files window", "Text: include my notes on / off", "I"),

  // The hidden-files window
  hfMove: s("In the hidden-files window", "Previous / next file", "ArrowUp", "ArrowDown"),
  hfUnhide: s("In the hidden-files window", "Unhide the file", "U", "Enter"),
  hfOpen: s("In the hidden-files window", "Open the file (it stays hidden)", "O"),
  hfUnhideAll: s("In the hidden-files window", "Unhide all", "Shift+U"),

  // Dialogs & editors
  confirm: s("In dialogs & editors", "Confirm a page dialog (in its first field)", "Enter"),
  saveNote: s("In dialogs & editors", "Save the note or comment you're writing", "Ctrl+Enter"),
  close: s("In dialogs & editors", "Close the dialog / cancel editing", "Escape"),
  nextField: s("In dialogs & editors", "Next empty text box / previous text box", "ArrowDown", "ArrowUp"),
} satisfies Record<string, Shortcut>;

export type ShortcutId = keyof typeof SHORTCUTS;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const KEY_NAMES: Record<string, string> = {
  ArrowRight: "→",
  ArrowLeft: "←",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  Delete: "Del",
  " ": "Space",
};

/** How a combination is written on screen, e.g. "Shift+R", "Ctrl+Del", "→". */
export function formatCombo(combo: string): string {
  return combo
    .split(/\+(?!$)/)
    .map((part) => (part === "Ctrl" && isMac ? "⌘" : (KEY_NAMES[part] ?? part)))
    .join(isMac ? "" : "+");
}

/** The first combination of a shortcut, for tooltips and menus. */
export function keyOf(id: ShortcutId): string {
  return formatCombo(SHORTCUTS[id].keys[0]);
}

/** "Label (Key)", for tooltips. */
export function withKey(label: string, id: ShortcutId): string {
  return `${label} (${keyOf(id)})`;
}

function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split(/\+(?!$)/);
  const key = parts.pop()!;
  const ctrl = parts.includes("Ctrl");
  const shift = parts.includes("Shift");
  const alt = parts.includes("Alt");
  if ((e.ctrlKey || e.metaKey) !== ctrl || e.altKey !== alt) return false;
  if (/^[A-Za-z]$/.test(key)) return e.shiftKey === shift && e.key.toLowerCase() === key.toLowerCase();
  if (/^\d$/.test(key)) return e.shiftKey === shift && (e.code === `Digit${key}` || e.code === `Numpad${key}`);
  if (key.length === 1) {
    // Symbols: Shift is part of typing them on most layouts ("?", "+"), so it isn't checked unless asked.
    return e.key === key && (!shift || e.shiftKey);
  }
  return e.key === key && e.shiftKey === shift;
}

/** True when the key event is one of the shortcut's combinations. */
export function matches(e: KeyboardEvent, id: ShortcutId): boolean {
  return SHORTCUTS[id].keys.some((k) => matchesCombo(e, k));
}

/** True when keys typed into a text field shouldn't trigger shortcuts. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  // A focused checkbox or radio button takes no typing, so shortcuts still work there.
  if (t instanceof HTMLInputElement && (t.type === "checkbox" || t.type === "radio")) return false;
  // Page-number boxes (data-shortcut-letters) only take digits, "-" and ",": letters stay shortcuts.
  if (t?.hasAttribute?.("data-shortcut-letters") && /^[a-z]$/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) return false;
  return !!t?.closest?.("input, textarea, select, [contenteditable]");
}

export const GROUP_ORDER: ShortcutGroup[] = [
  "General",
  "Panels",
  "Pages & zoom",
  "Side by side",
  "Tools",
  "Selected text & highlights",
  "While a phrase is shown",
  "Notes & bookmarks",
  "Pictures",
  "Page tools",
  "New PDFs",
  "Images",
  "Get text & OCR",
  "In the Get text window",
  "In the cut-in-half window",
  "In the Save pictures window",
  "In the picture pages window",
  "In the bookmarks list",
  "In the files list",
  "In the favourites list",
  "In the selected-files window",
  "In the hidden-files window",
  "In dialogs & editors",
];
