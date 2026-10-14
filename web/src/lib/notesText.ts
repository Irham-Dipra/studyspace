import { escapeMarkdown, type TextFormat } from "./pdfToMarkdown";
import { RESOURCE_TYPE_LABEL, scopeLabel, type Resource } from "./types";

/** Short names for the kinds of notes, as they're labelled in the extracted text. */
const KIND: Record<Resource["type"], string> = { ...RESOURCE_TYPE_LABEL, note: "My note" };

/** One note as a block of the extracted text: a quote in Markdown, a bracketed block in plain text. */
export function noteBlock(r: Resource, format: TextFormat): string {
  const head = `${KIND[r.type]}${r.title.trim() ? `: ${r.title.trim()}` : ""}`;
  const where = scopeLabel(r).toLowerCase();
  const body = [r.content.trim(), r.url ? r.url : ""].filter(Boolean).join("\n\n");
  if (format === "text") return `[${head} (${where})]\n${body}${body ? "\n" : ""}[end of note]`;
  const lines = [`**${escapeMarkdown(head, false)}** *(${where})*`, ...(body ? ["", ...body.split("\n")] : [])];
  return lines.map((l) => (l ? `> ${l}` : ">")).join("\n");
}

export interface NotesForText {
  /** Notes to put after each page's text. */
  afterPage: Map<number, string>;
  /** Notes about the whole PDF (only when the whole PDF is read), for the end. */
  whole: string;
  count: number;
}

/**
 * Places the PDF's notes in text read from `pages`: a note for some pages goes after the last of
 * those pages that is being read; notes for the whole PDF go at the end, when the whole PDF is read.
 */
export function notesForText(resources: Resource[], pages: number[], pageCount: number, format: TextFormat): NotesForText {
  const read = [...pages].sort((a, b) => a - b);
  const sorted = [...resources].sort((a, b) => (a.pageStart ?? 0) - (b.pageStart ?? 0) || a.createdAt.localeCompare(b.createdAt));
  const afterPage = new Map<number, string[]>();
  const whole: string[] = [];
  for (const r of sorted) {
    if (!r.content.trim() && !r.url && !r.title.trim()) continue;
    if (r.scope === "document") {
      if (read.length === pageCount) whole.push(noteBlock(r, format));
      continue;
    }
    if (r.pageStart === null || r.pageEnd === null) continue;
    const last = read.filter((p) => p >= r.pageStart! && p <= r.pageEnd!).at(-1);
    if (last === undefined) continue;
    afterPage.set(last, [...(afterPage.get(last) ?? []), noteBlock(r, format)]);
  }
  return {
    afterPage: new Map([...afterPage].map(([p, xs]) => [p, xs.join("\n\n")])),
    whole: whole.length ? `${format === "markdown" ? "---\n\n**Notes on the whole PDF**" : "--- Notes on the whole PDF ---"}\n\n${whole.join("\n\n")}` : "",
    count: [...afterPage.values()].reduce((n, xs) => n + xs.length, 0) + whole.length,
  };
}
