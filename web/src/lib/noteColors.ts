/**
 * The default highlighter colours in notes (card titles, headings, list labels, ==marks==), which
 * the user can change in Settings. Each is a CSS variable on <html>; index.css holds the defaults.
 * Kept in localStorage, so each browser (the phone too) has its own; other tabs follow via `storage`.
 */

export interface NoteColor {
  id: string;
  label: string;
  /** Text shown in the sample chip. */
  sample: string;
  default: string;
}

export const NOTE_COLORS: NoteColor[] = [
  { id: "title", label: "Note title", sample: "Card title", default: "#f9a8d4" },
  { id: "h1", label: "Heading, 1st level", sample: "Main heading", default: "#fdba74" },
  { id: "h2", label: "Heading, 2nd level", sample: "Sub-heading", default: "#67e8f9" },
  { id: "h3", label: "Heading, 3rd level", sample: "Small heading", default: "#86efac" },
  { id: "h4", label: "Heading, 4th level and below", sample: "Smallest heading", default: "#93c5fd" },
  { id: "group", label: "Bullet header", sample: "Deductive Learning:", default: "#fda4af" },
  { id: "lead", label: "Bullet label", sample: "Term:", default: "#c4b5fd" },
  { id: "mark", label: "Marked text (==text==)", sample: "highlighted in the PDF", default: "#ffd54f" },
];

/** The colours offered when recolouring one heading, label or mark in a note (keys 1–9). */
export const STYLE_COLORS = ["#fde047", "#fdba74", "#fda4af", "#f9a8d4", "#c4b5fd", "#93c5fd", "#67e8f9", "#86efac", "#d4d4d8"];

const KEY = "ss-note-colors";
export const cssVar = (id: string) => `--ss-note-${id}`;

export type NoteColorMap = Record<string, string>;

/** Only the colours the user changed. */
export function loadNoteColors(): NoteColorMap {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: NoteColorMap = {};
    for (const c of NOTE_COLORS) {
      const v = (raw as Record<string, unknown>)[c.id];
      if (typeof v === "string" && isHex(v)) out[c.id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveNoteColors(map: NoteColorMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // Private window: the colours still apply until the page reloads.
  }
  applyNoteColors(map);
}

export function applyNoteColors(map: NoteColorMap): void {
  const style = document.documentElement.style;
  for (const c of NOTE_COLORS) {
    if (map[c.id]) style.setProperty(cssVar(c.id), map[c.id]);
    else style.removeProperty(cssVar(c.id));
  }
}

export const isHex = (s: string) => /^#[0-9a-f]{6}$/i.test(s);

/** Apply the saved colours now, and again whenever another tab changes them. */
export function installNoteColors(): void {
  applyNoteColors(loadNoteColors());
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) applyNoteColors(loadNoteColors());
  });
}
