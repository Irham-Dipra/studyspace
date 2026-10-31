import type { NoteHighlight } from "./types";

/**
 * Anchoring for highlights inside notes.
 *
 * A note's "text" is the concatenation of all rendered text nodes, with each formula counted as its
 * TeX between dollars (`$x^2$`, see `mathToken`): a formula is highlighted whole or not at all. The
 * same definition is used on the browser DOM (to capture a selection) and on the HTML tree before
 * React renders it (to draw the highlights), so offsets agree.
 * Highlights saved before 2026-10-19 left formulas out of their quote; `legacyText` finds those.
 * Highlights are stored as quote + a little surrounding context and re-found on every render, which
 * keeps them attached to the right words even after the note is edited.
 */

export const CONTEXT_CHARS = 32;

let lastText: string | null = null;
let lastNormal: { norm: string; map: number[] } = { norm: "", map: [] };

/**
 * Collapses whitespace runs to one space and remembers where each normalised char came from. Every
 * highlight is looked up in the same text, so the last result is kept (a long document has many).
 */
function normalise(text: string): { norm: string; map: number[] } {
  if (text === lastText) return lastNormal;
  lastNormal = normaliseText(text);
  lastText = text;
  return lastNormal;
}

function normaliseText(text: string): { norm: string; map: number[] } {
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

/** What a formula counts as in a note's text. */
export const mathToken = (tex: string) => `$${tex.trim()}$`;

/** True for rendered formulas (KaTeX output), which count as one `mathToken`. */
export const isMathClass = (className: unknown): boolean => {
  const list = Array.isArray(className) ? className : typeof className === "string" ? className.split(/\s+/) : [];
  return list.includes("katex") || list.includes("katex-display");
};

// ---- DOM side: turning a selection into a highlight ------------------------------

/** A piece of a rendered note's text: a text node, or a whole formula. */
type Unit = { node: Text; text: string } | { math: Element; text: string };

const texOf = (math: Element) => math.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? math.textContent ?? "";

/** The outermost formula element containing `node`, if any. */
const mathAround = (node: Node): Element | null => {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest(".katex-display") ?? el?.closest(".katex") ?? null;
};

/** The pieces of a rendered note's text, in order. */
export function domUnits(container: Element): Unit[] {
  const out: Unit[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      if (n.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = n as Element;
      // A formula is one piece; its insides are skipped.
      if (el.classList.contains("katex-display") || el.classList.contains("katex")) {
        out.push({ math: el, text: mathToken(texOf(el)) });
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push({ node: n as Text, text: (n as Text).data });
  return out;
}

/**
 * Character offset (in the note's text) of a DOM boundary point. A point inside a formula moves to
 * the formula's start (`side` "start") or end, so a selection always takes whole formulas.
 */
function boundaryOffset(units: Unit[], node: Node, offset: number, side: "start" | "end"): number {
  const math = mathAround(node);
  let acc = 0;
  if (math) {
    for (const u of units) {
      if ("math" in u && u.math === math) return side === "start" ? acc : acc + u.text.length;
      acc += u.text.length;
    }
    acc = 0;
  }
  const point = document.createRange();
  point.setStart(node, offset);
  point.collapse(true);
  for (const u of units) {
    if ("node" in u && u.node === node) return acc + offset;
    // Whole piece lies before the point.
    const before = "node" in u ? point.comparePoint(u.node, u.node.length) <= 0 : point.comparePoint(u.math, u.math.childNodes.length) <= 0;
    if (before) acc += u.text.length;
    else break;
  }
  return acc;
}

/** Converts the current selection inside `container` into a quote with context, or null if empty. */
export function selectionToAnchor(container: Element, range: Range): Pick<NoteHighlight, "quote" | "prefix" | "suffix"> | null {
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null;
  const units = domUnits(container);
  const text = units.map((u) => u.text).join("");
  let start = boundaryOffset(units, range.startContainer, range.startOffset, "start");
  let end = boundaryOffset(units, range.endContainer, range.endOffset, "end");
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end <= start) return null;
  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(end, end + CONTEXT_CHARS),
  };
}

/**
 * The DOM range of a saved quote inside a rendered note (null when its text is gone). Formulas are
 * taken whole, as in `selectionToAnchor`.
 */
export function anchorToRange(container: Element, a: Pick<NoteHighlight, "quote" | "prefix" | "suffix">): Range | null {
  const units = domUnits(container);
  const at = locateQuote(units.map((u) => u.text).join(""), a);
  if (!at) return null;
  const range = document.createRange();
  let acc = 0;
  let started = false;
  for (const u of units) {
    const len = u.text.length;
    if (!started && at[0] < acc + len) {
      if ("node" in u) range.setStart(u.node, at[0] - acc);
      else range.setStartBefore(u.math);
      started = true;
    }
    if (started && at[1] <= acc + len) {
      if ("node" in u) range.setEnd(u.node, at[1] - acc);
      else range.setEndAfter(u.math);
      return range;
    }
    acc += len;
  }
  return started ? range : null;
}
