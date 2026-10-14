import type { NoteHighlight } from "./types";

/**
 * Anchoring for highlights inside notes.
 *
 * A note's "text" is the concatenation of all rendered text nodes, skipping KaTeX output (formulas
 * can't be partially highlighted). The same definition is used on the browser DOM (to capture a
 * selection) and on the HTML tree before React renders it (to draw the <mark>s), so offsets agree.
 * Highlights are stored as quote + a little surrounding context and re-found on every render, which
 * keeps them attached to the right words even after the note is edited.
 */

export const CONTEXT_CHARS = 32;

/** Collapses whitespace runs to one space and remembers where each normalised char came from. */
function normalise(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let inSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!inSpace) {
        norm += " ";
        map.push(i);
      }
      inSpace = true;
    } else {
      norm += ch;
      map.push(i);
      inSpace = false;
    }
  }
  map.push(text.length);
  return { norm, map };
}

const squash = (s: string) => s.replace(/\s+/g, " ");

/**
 * Finds where a highlight's quote sits in `text`. When the quote occurs several times, the occurrence
 * whose surroundings best match the saved prefix/suffix wins. Returns [start, end) in `text`, or null.
 */
export function locateQuote(text: string, h: Pick<NoteHighlight, "quote" | "prefix" | "suffix">): [number, number] | null {
  const { norm, map } = normalise(text);
  const quote = squash(h.quote).trim();
  if (!quote) return null;
  const prefix = squash(h.prefix);
  const suffix = squash(h.suffix);
  let best = -1;
  let bestScore = -1;
  for (let at = norm.indexOf(quote); at !== -1; at = norm.indexOf(quote, at + 1)) {
    let score = 0;
    for (let k = 1; k <= prefix.length && at - k >= 0 && norm[at - k] === prefix[prefix.length - k]; k++) score++;
    const end = at + quote.length;
    for (let k = 0; k < suffix.length && end + k < norm.length && norm[end + k] === suffix[k]; k++) score++;
    if (score > bestScore) {
      best = at;
      bestScore = score;
    }
  }
  if (best === -1) return null;
  return [map[best], map[best + quote.length - 1] + 1];
}

/** True for elements whose text must be skipped (rendered formulas). */
export const isMathClass = (className: unknown): boolean => {
  const list = Array.isArray(className) ? className : typeof className === "string" ? className.split(/\s+/) : [];
  return list.includes("katex") || list.includes("katex-display");
};

// ---- DOM side: turning a selection into a highlight ------------------------------

/** Text nodes of a rendered note, in order, excluding formulas. */
export function domTextNodes(container: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(".katex, .katex-display") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** Character offset (in the note's text) of a DOM boundary point. */
function boundaryOffset(nodes: Text[], node: Node, offset: number): number {
  const point = document.createRange();
  point.setStart(node, offset);
  point.collapse(true);
  let acc = 0;
  for (const t of nodes) {
    if (t === node) return acc + offset;
    if (point.comparePoint(t, t.length) <= 0) acc += t.length; // whole node lies before the point
    else break;
  }
  return acc;
}

/** Converts the current selection inside `container` into a quote with context, or null if empty. */
export function selectionToAnchor(container: Element, range: Range): Pick<NoteHighlight, "quote" | "prefix" | "suffix"> | null {
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const nodes = domTextNodes(container);
  const text = nodes.map((n) => n.data).join("");
  let start = boundaryOffset(nodes, range.startContainer, range.startOffset);
  let end = boundaryOffset(nodes, range.endContainer, range.endOffset);
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end <= start) return null;
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(end, end + CONTEXT_CHARS),
  };
}
