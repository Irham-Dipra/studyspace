/**
 * Phrase highlights. A click on a word proposes a highlight from it to the next "stop" (a punctuation
 * mark, or the end of a paragraph or a table cell), following the text over line breaks; keys then
 * move either end by a stop or by a word. This module works on a page's text as pdf.js's text layer
 * holds it (its spans, in their order) and knows nothing of the DOM; see viewer/phraseDom.ts.
 */
import { splitsWord } from "./pdfToMarkdown";

/** One text item of a page (a text-layer span), in the layer's order. x and y in the same unit. */
export interface Piece {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** A line break follows it (pdf.js put a <br> after it). */
  eol: boolean;
}

export interface Flow {
  /** The page's text: the pieces in order, " " where a visible gap needs one, "\n" between lines. */
  text: string;
  /** Per char of `text`: the piece it comes from (-1: an added space or line break)... */
  piece: Int32Array;
  /** ...and its index in that piece's text. */
  offset: Int32Array;
  /** Words as [start, end) in `text`. A word split by a hyphen at a line end is one word. */
  words: [number, number][];
  /** Where a phrase may end (just after a word): punctuation and block ends, in order. */
  stops: number[];
  /** The block ends among them (a paragraph's, a table cell's, the page's), in order. */
  blockEnds: number[];
  /** Softer places to end, for stepping: before "and", "which", "(" and the like, in order. */
  breaks: number[];
  /** Chars that join a hyphen-split word over a line break (the "-", the "\n" and spaces between). */
  glue: Uint8Array;
}

/** A phrase: [a, b) in the flow's text, from the start of a word to the end of one. */
export interface Phrase {
  a: number;
  b: number;
}

/** Two pieces on a line get a space between them when the gap is wider than this (× text height). */
const SPACE_GAP = 0.15;
/** A wider gap than this on a line separates table columns; the text before it ends a block. */
const COLUMN_GAP = 1.5;
/** A line carries on the one above when it starts at most this far (× text height) left of the block. */
const INDENT_SLACK = 2;
/** ...and when its top is no further below the line above than this (× text height). */
const LINE_GAP = 0.9;
const CLOSERS = /[)\]}”’"']/;
const STOP_MARKS = /[,;:.!?]/;
/** Words that start a new part of a sentence: a phrase may also end just before them. */
const BREAK_WORDS = /^(and|while|which|that|but|so|because|whereas|where|when|then|with|without|since|unless|until|whether)$/i;
const ABBREVIATION = /^(e\.g|i\.e|etc|fig|figs|eq|eqs|p|pp|vs|cf|no|ch|sec|resp|approx|al|ex)$/i;
/** A word that only marks a list item: a bullet, a dash, "1.", "2)", "(a)", "iii.". */
const LIST_MARKER = /^([•◦▪‣∙·–—*-]|\d{1,2}[.)]|\(?[a-z]\)|[a-z]\.|\(?[ivx]{1,4}[.)])$/;

const isSpace = (c: string | undefined) => c === " " || c === "\n" || c === "\t" || c === "\u00a0";
const height = (p: Piece) => p.y1 - p.y0;

function sameLine(a: Piece, b: Piece): boolean {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return overlap >= 0.3 * Math.min(height(a), height(b));
}

interface Segment {
  /** Indexes into `pieces` of its first and last pieces that show something. */
  first: number;
  last: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Builds a page's text, words and stops from its text-layer pieces. */
export function buildFlow(pieces: Piece[]): Flow {
  // Lines: a line ends at a piece followed by a line break, or where the next piece isn't beside it.
  const lines: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (p.text) {
      const prev = cur.length ? pieces[cur[cur.length - 1]] : null;
      if (prev && !sameLine(prev, p)) {
        lines.push(cur);
        cur = [];
      }
      cur.push(i);
    }
    if (p.eol && cur.length) {
      lines.push(cur);
      cur = [];
    }
  }
  if (cur.length) lines.push(cur);

  // Segments: the runs of a line between table-column gaps (measured between pieces that show text).
  const segments = lines.map((line) => {
    const segs: Segment[] = [];
    let prev: Piece | null = null;
    for (const i of line) {
      const p = pieces[i];
      if (!p.text.trim()) continue;
      const s = segs[segs.length - 1];
      const h = Math.max(height(p), prev ? height(prev) : 0);
      if (s && prev && p.x0 - prev.x1 <= COLUMN_GAP * h) {
        s.last = i;
        s.x0 = Math.min(s.x0, p.x0);
        s.x1 = Math.max(s.x1, p.x1);
        s.y0 = Math.min(s.y0, p.y0);
        s.y1 = Math.max(s.y1, p.y1);
      } else segs.push({ first: i, last: i, x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 });
      prev = p;
    }
    return segs;
  });

  // The text, with a map back to the pieces.
  const chars: string[] = [];
  const pieceOf: number[] = [];
  const offsetOf: number[] = [];
  const add = (c: string, piece: number, offset: number) => {
    chars.push(c);
    pieceOf.push(piece);
    offsetOf.push(offset);
  };
  const lineStart: number[] = [];
  const lineEnd: number[] = [];
  /** Where each segment's text ends in `chars` (after its last visible char), per line. */
  const segEnds: number[][] = [];
  lines.forEach((line, li) => {
    if (li) add("\n", -1, 0);
    lineStart.push(chars.length);
    const ends: number[] = [];
    let prev: Piece | null = null;
    let seg = 0;
    for (const i of line) {
      const p = pieces[i];
      if (prev && !isSpace(chars[chars.length - 1]) && !isSpace(p.text[0])) {
        const h = Math.max(height(p), height(prev));
        if (p.x0 - prev.x1 > SPACE_GAP * h) add(" ", -1, 0);
      }
      const segs = segments[li];
      if (segs[seg + 1] && i === segs[seg + 1].first) {
        ends.push(trimmedEnd(chars, lineStart[li]));
        seg++;
      }
      for (let k = 0; k < p.text.length; k++) add(p.text[k], i, k);
      prev = p;
    }
    ends.push(trimmedEnd(chars, lineStart[li]));
    segEnds.push(ends);
    lineEnd.push(chars.length);
  });
  const text = chars.join("");

  const stops = new Set<number>();
  const glue = new Uint8Array(text.length);

  // Line breaks: either the text runs on (a wrapped line), or a block ends there.
  let leftRef = segments[0]?.length ? segments[0][segments[0].length - 1].x0 : 0;
  for (let li = 0; li + 1 < lines.length; li++) {
    const here = segments[li];
    const next = segments[li + 1];
    const a = here[here.length - 1];
    const b = next[0];
    if (!a || !b) {
      if (a) stops.add(segEnds[li][segEnds[li].length - 1]);
      leftRef = next[next.length - 1]?.x0 ?? 0;
      continue;
    }
    const h = a.y1 - a.y0;
    const below = b.y0 > a.y0 + 0.3 * h && b.y0 < a.y1 + LINE_GAP * h;
    const leftOk = b.x0 >= Math.min(leftRef, a.x0) - INDENT_SLACK * h;
    const nextText = text.slice(lineStart[li + 1], lineEnd[li + 1]).trimStart();
    const marker = LIST_MARKER.test(nextText.split(/\s/)[0] ?? "");
    const runsOn = below && leftOk && !marker;
    if (runsOn) {
      const before = text.slice(lineStart[li], lineEnd[li]).trimEnd();
      if (splitsWord(before, nextText)) {
        const dash = lineStart[li] + before.length - 1;
        for (let k = dash; k < lineStart[li + 1]; k++) glue[k] = 1;
      }
      leftRef = next.length === 1 ? Math.min(leftRef, a.x0, b.x0) : next[next.length - 1].x0;
    } else {
      stops.add(segEnds[li][segEnds[li].length - 1]);
      leftRef = next[next.length - 1].x0;
    }
  }
  // A table column's gap ends a block; so does the page's end.
  for (const ends of segEnds) for (let k = 0; k + 1 < ends.length; k++) stops.add(ends[k]);
  if (text.trim()) stops.add(trimmedEnd(chars, 0));
  const blockEnds = [...stops].sort((x, y) => x - y);

  // Punctuation followed by a space, a line break or the end (closing brackets and quotes taken in).
  let clauseStart = 0;
  let nextBlock = 0;
  for (let i = 0; i < text.length; i++) {
    while (nextBlock < blockEnds.length && blockEnds[nextBlock] <= i) clauseStart = Math.max(clauseStart, blockEnds[nextBlock++]);
    if (!STOP_MARKS.test(text[i]) || glue[i]) continue;
    let j = i + 1;
    while (j < text.length && CLOSERS.test(text[j])) j++;
    if (j < text.length && !isSpace(text[j])) continue;
    if (text[i] === ".") {
      let w = i;
      while (w > 0 && !isSpace(text[w - 1])) w--;
      if (ABBREVIATION.test(text.slice(w, i))) continue;
    }
    // A list of short settings, "CS = FFFFH, IP = 0000H", reads as one: no stop at its commas.
    if (text[i] === "," && listOfSettings(text.slice(clauseStart, i), text.slice(j))) continue;
    stops.add(j);
    clauseStart = j;
    i = j - 1;
  }

  // Words: runs of chars that aren't spaces, held together over a hyphen at a line end.
  const words: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= text.length; i++) {
    const inWord = i < text.length && (glue[i] === 1 || !isSpace(text[i]));
    if (inWord && start < 0) start = i;
    else if (!inWord && start >= 0) {
      words.push([start, i]);
      start = -1;
    }
  }

  // Breaks: just before a word that starts a new part of the sentence, or before a "(".
  const sorted = [...stops].sort((x, y) => x - y);
  const isStop = new Set(sorted);
  const breaks: number[] = [];
  for (let k = 1; k < words.length; k++) {
    const w = text.slice(words[k][0], words[k][1]);
    const end = words[k - 1][1];
    if (!isStop.has(end) && (w.startsWith("(") || BREAK_WORDS.test(w.replace(/[^A-Za-z]+$/, "")))) breaks.push(end);
  }

  // Every stop sits at a word's end; drop any that don't (e.g. a page of nothing but spaces).
  const ends = new Set(words.map((w) => w[1]));
  return {
    text,
    piece: Int32Array.from(pieceOf),
    offset: Int32Array.from(offsetOf),
    words,
    stops: sorted.filter((s) => ends.has(s)),
    blockEnds: blockEnds.filter((s) => ends.has(s)),
    breaks,
    glue,
  };
}

/** True for a comma between short settings: "SF = 1, OF = 1", "1 = minimum mode, 0 = maximum mode". */
function listOfSettings(before: string, after: string): boolean {
  if (!before.includes("=")) return false;
  const words = before.split(/\s+/).filter((t) => t && t !== "=");
  return words.length <= 4 && /^\s*\S+\s*=\s/.test(after);
}

/**
 * Where a phrase that starts at `a` may end, in order. A comma inside brackets the phrase opened is
 * not one ("(IP, SP, BX)") when the brackets close in the same block. With `withBreaks` (stepping
 * with the arrow keys) the softer breaks count too, and so does the end of brackets the phrase opened.
 */
export function endStops(flow: Flow, a: number, withBreaks = true): number[] {
  const { text } = flow;
  const blockEnd = new Set(flow.blockEnds);
  const candidates = new Set(flow.stops);
  if (withBreaks) {
    for (const b of flow.breaks) candidates.add(b);
    // Closing brackets: those the phrase opened ("ALE (address latch enable, pin 25)"), and the one
    // around a phrase that starts inside brackets.
    let depth = 0;
    for (let i = a; i < text.length; i++) {
      if (blockEnd.has(i)) depth = 0;
      const next = bracketDepth(depth, text[i]);
      if (next < depth || (depth === 0 && (text[i] === ")" || text[i] === "]"))) {
        let j = i + 1;
        while (j < text.length && CLOSERS.test(text[j])) j++;
        if (j >= text.length || isSpace(text[j])) candidates.add(j);
      }
      depth = next;
    }
  }
  const all = [...candidates].filter((s) => s > a).sort((x, y) => x - y);
  const ends = new Set(flow.words.map((w) => w[1]));
  const out: number[] = [];
  let depth = 0;
  let at = a;
  for (const s of all) {
    if (!ends.has(s)) continue;
    for (; at < s; at++) {
      if (blockEnd.has(at)) depth = 0;
      depth = bracketDepth(depth, text[at]);
    }
    if (depth > 0 && !blockEnd.has(s) && closesInBlock(flow, s, depth, blockEnd)) continue;
    out.push(s);
  }
  return out;
}

function bracketDepth(depth: number, c: string): number {
  if (c === "(" || c === "[") return depth + 1;
  if (c === ")" || c === "]") return Math.max(0, depth - 1);
  return depth;
}

function closesInBlock(flow: Flow, from: number, depth: number, blockEnd: Set<number>): boolean {
  for (let i = from; i < flow.text.length; i++) {
    if (blockEnd.has(i)) return false;
    depth = bracketDepth(depth, flow.text[i]);
    if (depth === 0) return true;
  }
  return false;
}

/** The end of the last char before `chars.length` that isn't a space (not before `from`). */
function trimmedEnd(chars: string[], from: number): number {
  let e = chars.length;
  while (e > from && isSpace(chars[e - 1])) e--;
  return e;
}

/** The index of the word holding `pos`, else of the next word after it; -1 past the last word. */
export function wordIndexAt(flow: Flow, pos: number): number {
  const w = flow.words;
  let lo = 0,
    hi = w.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (w[mid][1] <= pos) lo = mid + 1;
    else hi = mid;
  }
  return lo < w.length ? lo : -1;
}

/** The first stop at or after `pos` for a phrase starting at `a` (the text's end when there is none). */
function stopFrom(flow: Flow, a: number, pos: number): number {
  return endStops(flow, a, false).find((s) => s >= pos) ?? flow.words[flow.words.length - 1][1];
}

/** The phrase that starts at the word at `pos`: up to the next stop. A list marker is skipped. */
export function startPhrase(flow: Flow, pos: number): Phrase | null {
  let w = wordIndexAt(flow, pos);
  if (w < 0) return null;
  if (startsItem(flow, w) && flow.words[w + 1]) w++;
  const [a, end] = flow.words[w];
  return { a, b: stopFrom(flow, a, end) };
}

/** True when word `w` is a list marker ("•", "1.", "(a)") at the start of its line. */
function startsItem(flow: Flow, w: number): boolean {
  const [a, b] = flow.words[w];
  if (!LIST_MARKER.test(flow.text.slice(a, b))) return false;
  let i = a;
  while (i > 0 && flow.text[i - 1] === " ") i--;
  return i === 0 || flow.text[i - 1] === "\n";
}

/** The phrase after this one (Tab): from the next word to the stop after it. */
export function nextPhrase(flow: Flow, p: Phrase): Phrase | null {
  return wordIndexAt(flow, p.b) < 0 ? null : startPhrase(flow, p.b);
}

export type PhraseMove =
  | "endNextStop"
  | "endPrevStop"
  | "endNextWord"
  | "endPrevWord"
  | "startPrevStop"
  | "startNextStop"
  | "startPrevWord"
  | "startNextWord";

/** Moves one end of a phrase by a stop or a word. A phrase always keeps at least its first word. */
export function movePhrase(flow: Flow, p: Phrase, move: PhraseMove): Phrase {
  const { words, stops } = flow;
  const first = wordIndexAt(flow, p.a);
  const last = wordIndexAt(flow, p.b - 1);
  if (first < 0 || last < 0) return p;
  const minB = words[first][1];
  const startAfter = (s: number) => {
    const w = wordIndexAt(flow, s);
    return w < 0 ? null : words[w][0];
  };
  switch (move) {
    case "endNextStop": {
      const s = endStops(flow, p.a).find((x) => x > p.b);
      return s === undefined ? { ...p, b: words[words.length - 1][1] } : { ...p, b: s };
    }
    case "endPrevStop": {
      const s = endStops(flow, p.a).reverse().find((x) => x < p.b && x >= minB);
      return { ...p, b: s ?? minB };
    }
    case "endNextWord":
      return words[last + 1] ? { ...p, b: words[last + 1][1] } : p;
    case "endPrevWord":
      return last > first ? { ...p, b: words[last - 1][1] } : p;
    case "startPrevStop": {
      // Back to just after the stop before the phrase; when it already starts there, the one before.
      const before = [...stops].reverse().filter((x) => x < p.a);
      let a = before.length ? startAfter(before[0]) : words[0][0];
      if (a !== null && a >= p.a) a = before.length > 1 ? startAfter(before[1]) : before.length ? words[0][0] : p.a;
      return a === null ? p : { ...p, a };
    }
    case "startNextStop": {
      const s = stops.find((x) => x >= minB && x < p.b);
      const a = s === undefined ? null : startAfter(s);
      return a === null || a >= p.b ? p : { ...p, a };
    }
    case "startPrevWord":
      return first > 0 ? { ...p, a: words[first - 1][0] } : p;
    case "startNextWord":
      return first < last ? { ...p, a: words[first + 1][0] } : p;
  }
}

/** The phrase's text as it reads: lines joined with spaces, hyphen-split words joined again. */
export function phraseText(flow: Flow, p: Phrase): string {
  let out = "";
  for (let i = p.a; i < p.b; i++) {
    if (flow.glue[i]) continue;
    out += flow.text[i] === "\n" ? " " : flow.text[i];
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * The pieces of text [a, b) covers, as (piece, from, to) runs, for building a DOM range or boxes.
 * Added spaces and line breaks are left out.
 */
export function phrasePieces(flow: Flow, p: Phrase): { piece: number; from: number; to: number }[] {
  const out: { piece: number; from: number; to: number }[] = [];
  for (let i = p.a; i < p.b; i++) {
    const piece = flow.piece[i];
    if (piece < 0) continue;
    const last = out[out.length - 1];
    if (last && last.piece === piece && last.to === flow.offset[i]) last.to++;
    else out.push({ piece, from: flow.offset[i], to: flow.offset[i] + 1 });
  }
  return out;
}
