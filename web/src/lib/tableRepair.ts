/**
 * Mends Markdown tables whose rows were broken over several lines, as answers copied from Gemini are:
 *
 *   | **D** (Direction) | 1 bit | Specifies which operand…:
 *
 *   <br>
 *
 *   <br>• `D = 1`: Transfer TO the register…
 *
 *    |
 *
 * A table row must be one line and a blank line ends the table, so such a table fell apart into loose
 * text. A row that is short of its closing `|` is joined with the lines after it, up to the line that
 * closes it. The answer's own `<br>`s are its line breaks inside the cell (runs of them become one);
 * rehypeBreaks shows them. Tables that are already well formed are left exactly as they are.
 */

const ROW = /^\s*\|/;
// Cells of dashes with optional colons; a pipe is required, so a plain "---" line (a rule) isn't one.
const DELIMITER = /^(?=[^|]*\|)\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const RULE = /^([-*_])(\s*\1){2,}$/;
const FENCE = /^\s*(```|~~~)/;
/** How far a broken row may run on before it is taken for a row that just has no closing `|`. */
const MAX_CONTINUATION = 40;

/** Unescaped pipes, which is what GFM splits cells on (inside code spans too). */
const pipes = (line: string) => (line.match(/(?<!\\)\|/g) ?? []).length;

/**
 * Where a row broken after `start` ends: the index of the line that closes it, or -1 when the row
 * isn't broken (it's complete, or a valid row without a trailing `|`).
 */
function closingLine(lines: string[], start: number): number {
  for (let j = start; j < lines.length && j < start + MAX_CONTINUATION; j++) {
    const t = lines[j].trim();
    if (!t) continue;
    // A new row, a heading, a code fence or a rule: the row before was complete after all.
    if ((t.startsWith("|") && t !== "|") || t.startsWith("#") || FENCE.test(t) || DELIMITER.test(t) || RULE.test(t)) return -1;
    if (t.endsWith("|")) return j;
  }
  return -1;
}

/** Joins a broken row's lines into one, with one `<br>` wherever the answer broke the line. */
function joinRow(parts: string[]): string {
  const indent = /^\s*/.exec(parts[0])![0];
  return (
    indent +
    parts
      .map((p) => p.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s*(?:<br\s*\/?>\s*)+/gi, "<br>")
      .replace(/\|\s*<br>/g, "| ") // a cell that starts with a break
      .replace(/<br>\s*\|/g, " |") // or ends with one
  );
}

export function repairTables(md: string): string {
  if (!md.includes("|")) return md;
  const lines = md.split("\n");
  const out: string[] = [];
  let inFence = false;
  let inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence) {
      out.push(line);
      continue;
    }
    if (!inTable) {
      // A table starts with a header row followed by its delimiter row (| --- | --- |).
      inTable = ROW.test(line) && DELIMITER.test(lines[i + 1] ?? "");
      out.push(line);
      if (inTable) out.push(lines[++i]);
      continue;
    }
    if (!ROW.test(line)) {
      inTable = false; // a blank line or text ends the table, as in GFM
      out.push(line);
      continue;
    }
    const trimmed = line.trim();
    // A lone "|" closes a row; it never starts one.
    const end = trimmed === "|" || (trimmed.endsWith("|") && pipes(trimmed) > 1) ? -1 : closingLine(lines, i + 1);
    if (end === -1) {
      out.push(line);
      continue;
    }
    out.push(joinRow(lines.slice(i, end + 1)));
    i = end;
  }
  return out.join("\n");
}
