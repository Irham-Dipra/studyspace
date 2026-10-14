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
  | "Tools"
  | "Selected text & highlights"
  | "Notes & bookmarks"
  | "Page tools"
  | "New PDFs"
  | "Images"
  | "Get text & OCR"
  | "In the Get text window"
  | "In the cut-in-half window"
  | "In the Save pictures window"
  | "In the bookmarks list"
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
  settings: s("General", "Settings (study folders)", ","),
  rescan: s("General", "Rescan the library folders", "Shift+L"),

  // Panels
  toggleLeft: s("Panels", "Show / hide the left panel (files, bookmarks)", "["),
  toggleRight: s("Panels", "Show / hide the notes panel", "]"),
  files: s("Panels", "Show the library files", "L"),
  bookmarks: s("Panels", "Show this PDF's bookmarks", "Shift+B"),
  filter: s("Panels", "Filter the files / bookmarks list", "/"),

  // Pages & zoom
  nextPage: s("Pages & zoom", "Next page", "ArrowRight"),
  prevPage: s("Pages & zoom", "Previous page", "ArrowLeft"),
  firstPage: s("Pages & zoom", "First page", "Home"),
  lastPage: s("Pages & zoom", "Last page", "End"),
  goToPage: s("Pages & zoom", "Go to page (type it, press Enter)", "G"),
  zoomIn: s("Pages & zoom", "Zoom in", "+", "=", "Ctrl+=", "Ctrl++"),
  zoomOut: s("Pages & zoom", "Zoom out", "-", "_", "Ctrl+-"),
  zoomReset: s("Pages & zoom", "Zoom 100%", "0", "Ctrl+0"),
  fitWidth: s("Pages & zoom", "Fit page width", "W"),
  fitPage: s("Pages & zoom", "Fit whole page", "F"),
  wheelZoom: s("Pages & zoom", "Smooth zoom", "Ctrl+Wheel"),

  // Tools
  select: s("Tools", "Select text", "V"),
  highlight: s("Tools", "Highlight text (just select it)", "H"),
  area: s("Tools", "Highlight an area: click two corners (or drag)", "A"),
  pen: s("Tools", "Pen (draw freehand)", "P"),
  eraser: s("Tools", "Eraser (click or drag over marks)", "E"),
  ocr: s("Tools", "Get text from a region: click two corners (or drag)", "O"),
  cancelCorner: s("Tools", "Cancel a box after its first corner", "Escape"),
  colour: s("Tools", "Pick colour 1–5 (highlight, area & pen tools)", "1–5"),
  penWidth: s("Tools", "Pen width: fine / medium / bold", "Shift+1–3"),
  back: s("Tools", "Back to Select; closes menus and bars", "Escape"),

  // Selected text & highlights (while the floating bar is open)
  selColour: s("Selected text & highlights", "Highlight the selection / recolour the highlight (colour 1–5)", "1–5"),
  selNote: s("Selected text & highlights", "Quote the selection / highlight into a new note", "N"),
  selCopy: s("Selected text & highlights", "Copy the selected text", "Ctrl+C"),
  selDelete: s("Selected text & highlights", "Delete the clicked highlight or drawing", "Delete"),

  // Notes & bookmarks
  newNote: s("Notes & bookmarks", "New note for this page", "N"),
  toggleNotes: s("Notes & bookmarks", "Close all / expand all notes", "C"),
  addBookmark: s("Notes & bookmarks", "Bookmark this spot (selected text becomes its title)", "B"),
  newTab: s("Notes & bookmarks", "Open a library PDF in a new browser tab", "Ctrl+Click"),

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
  "Tools",
  "Selected text & highlights",
  "Notes & bookmarks",
  "Page tools",
  "New PDFs",
  "Images",
  "Get text & OCR",
  "In the Get text window",
  "In the cut-in-half window",
  "In the Save pictures window",
  "In the bookmarks list",
  "In dialogs & editors",
];
