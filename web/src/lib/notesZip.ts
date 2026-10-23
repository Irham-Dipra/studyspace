import { safeName } from "./pictures";
import { RESOURCE_TYPE_LABEL, scopeLabel, type Resource } from "./types";
import { ZipWriter } from "./zip";

/** A file's notes as Markdown files, one per note, in one .zip. */

const hasText = (r: Resource) => !!(r.content.trim() || r.url || r.title.trim());

/** Whole-document notes first, then by page, then oldest first: the order they're read in. */
const byPlace = (a: Resource, b: Resource) =>
  (a.scope === "document" ? 0 : (a.pageStart ?? 0)) - (b.scope === "document" ? 0 : (b.pageStart ?? 0)) ||
  (a.pageEnd ?? 0) - (b.pageEnd ?? 0) ||
  a.createdAt.localeCompare(b.createdAt);

/** A name for a note without a title: its first line of text, without Markdown marks. */
function firstLine(r: Resource): string {
  const line = r.content.split("\n").find((l) => l.trim()) ?? "";
  const plain = line
    .replace(/^\s*(#+|>|[-*+]|\d+[.)])\s+/, "")
    .replace(/[*_`~=$\\[\]]/g, "")
    .trim();
  return plain.length > 60 ? `${plain.slice(0, 60).trimEnd()}…` : plain || RESOURCE_TYPE_LABEL[r.type];
}

/** "p4", "p20-30" or "whole", for file names (sorts with the page). */
function where(r: Resource): string {
  if (r.scope === "document" || r.pageStart === null) return "whole";
  return r.pageStart === r.pageEnd ? `p${r.pageStart}` : `p${r.pageStart}-${r.pageEnd}`;
}

/** One note as a Markdown file: its title, what it's for, its link, then its text as written. */
export function noteMarkdown(r: Resource, docTitle: string): string {
  const head = [
    ...(r.title.trim() ? [`# ${r.title.trim()}`, ""] : []),
    `*${RESOURCE_TYPE_LABEL[r.type]} · ${scopeLabel(r)} of “${docTitle}”*`,
    ...(r.url ? ["", `<${r.url}>`] : []),
  ];
  return `${[...head, "", r.content.trim()].join("\n").trimEnd()}\n`;
}

/** The notes of one file, ready to download; null when it has none. */
export function notesZip(docTitle: string, resources: Resource[]): { blob: Blob; name: string; count: number } | null {
  const notes = resources.filter(hasText).sort(byPlace);
  if (!notes.length) return null;
  const folder = `${safeName(docTitle)} - notes`;
  const width = Math.max(2, String(notes.length).length);
  const zip = new ZipWriter();
  const enc = new TextEncoder();
  for (const [i, r] of notes.entries()) {
    const name = safeName(`${String(i + 1).padStart(width, "0")} - ${where(r)} - ${r.title.trim() || firstLine(r)}`)
      .slice(0, 150)
      .replace(/[.\s]+$/, ""); // "…end." would give "end..md"
    zip.add(`${folder}/${name}.md`, enc.encode(noteMarkdown(r, docTitle)));
  }
  return { blob: zip.finish(), name: `${folder}.zip`, count: notes.length };
}
