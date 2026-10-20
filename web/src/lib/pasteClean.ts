/**
 * Cleans an AI answer (Gemini, ChatGPT…) pasted into a note:
 * - Everything before the start mark is dropped: the "Here is a detailed explanation of…" chat.
 *   Ask the AI to put the mark on its own line just before the explanation.
 * - Citation tags that point at uploaded files are removed: `[cite: 13]`, `[cite: 4, 7]`, `[cite_start]`.
 */
export const START_MARK = "@@START@@";

export interface CleanResult {
  text: string;
  /** Characters of chat dropped before the start mark (0 when there was no mark). */
  cutChars: number;
  citations: number;
}

// Markup the AI may wrap the mark in (`**@@START@@**`, `` `@@START@@` ``, `## @@START@@`).
const MARKUP = /^[\s*_`#>~-]*$/;
const CITE = /[ \t]*\[cite(?:_start|_end)?(?::[^\]\n]*)?\]/gi;

export function cleanPasted(src: string): CleanResult {
  let text = src;
  let cutChars = 0;
  const at = text.indexOf(START_MARK);
  if (at !== -1) {
    let lineEnd = text.indexOf("\n", at);
    if (lineEnd === -1) lineEnd = text.length;
    const rest = text.slice(at + START_MARK.length, lineEnd);
    cutChars = text.slice(0, at).replace(/[\s*_`#>~-]+$/, "").trim().length;
    // Keep text written after the mark on the same line; drop the line if only markup is left.
    text = MARKUP.test(rest) ? text.slice(lineEnd).replace(/^(?:[ \t]*\n)+/, "") : rest.trimStart() + text.slice(lineEnd);
  }
  // Any further marks (a second answer pasted below) are just removed.
  text = text.split(START_MARK).join("");
  let citations = 0;
  text = text.replace(CITE, () => {
    citations++;
    return "";
  });
  return { text, cutChars, citations };
}
