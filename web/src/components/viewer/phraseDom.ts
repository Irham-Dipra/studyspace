/**
 * The DOM side of phrase highlights (lib/phrase.ts has the rules): reads a page's pdf.js text layer
 * into pieces, finds the char under a click, and turns a phrase into one box per line. Clicks are
 * found by geometry, not by the browser's caret functions: the Area tool switches the text layer's
 * pointer events off, and Firefox and Chromium differ there.
 */
import { buildFlow, phrasePieces, phraseText, type Flow, type Phrase, type Piece } from "../../lib/phrase";
import type { NormRect } from "../../lib/types";
import { mergeLineRects } from "./geometry";

export interface PageText {
  flow: Flow;
  pieces: Piece[];
  /** The text node of each piece. */
  nodes: Text[];
  /** Where each piece's first char is in the flow's text. */
  pieceStart: Int32Array;
}

/** Reads a page's text layer: its spans in order, their boxes (px from the page's top-left), line breaks. */
export function readPageText(pageEl: HTMLElement): PageText | null {
  const layer = pageEl.querySelector(".textLayer");
  if (!layer) return null;
  const box = pageEl.getBoundingClientRect();
  const pieces: Piece[] = [];
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n instanceof Element) {
      if (n.tagName === "BR" && pieces.length) pieces[pieces.length - 1].eol = true;
      continue;
    }
    const t = n as Text;
    const span = t.parentElement;
    if (!t.data || !span) continue;
    const r = span.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    pieces.push({ text: t.data, x0: r.left - box.left, y0: r.top - box.top, x1: r.right - box.left, y1: r.bottom - box.top, eol: false });
    nodes.push(t);
  }
  if (!pieces.length) return null;
  const flow = buildFlow(pieces);
  const pieceStart = new Int32Array(pieces.length).fill(-1);
  for (let i = 0; i < flow.text.length; i++) if (flow.piece[i] >= 0 && pieceStart[flow.piece[i]] < 0) pieceStart[flow.piece[i]] = i - flow.offset[i];
  return { flow, pieces, nodes, pieceStart };
}

/** True while the text nodes read are still the page's (a zoom draws the text layer again). */
export const stillShown = (pt: PageText) => pt.nodes[0]?.isConnected === true;

/** The flow offset of the char under a point (client px), or the nearest one on that line; null off the text. */
export function charAtPoint(pt: PageText, pageEl: HTMLElement, clientX: number, clientY: number): number | null {
  const box = pageEl.getBoundingClientRect();
  const x = clientX - box.left;
  const y = clientY - box.top;
  let best = -1;
  let bestD = Infinity;
  pt.pieces.forEach((p, i) => {
    if (!p.text.trim()) return;
    const h = p.y1 - p.y0;
    const dy = y < p.y0 ? p.y0 - y : y > p.y1 ? y - p.y1 : 0;
    const dx = x < p.x0 ? p.x0 - x : x > p.x1 ? x - p.x1 : 0;
    if (dy > h * 0.2 || dx > h * 0.8) return;
    const d = dx + dy * 3;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best < 0 || pt.pieceStart[best] < 0) return null;
  // The char: the nearest by x among the piece's chars.
  const node = pt.nodes[best];
  const range = document.createRange();
  let char = 0;
  let charD = Infinity;
  for (let k = 0; k < node.data.length; k++) {
    range.setStart(node, k);
    range.setEnd(node, k + 1);
    const r = range.getBoundingClientRect();
    const d = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
    if (d < charD) {
      charD = d;
      char = k;
      if (d === 0) break;
    }
  }
  return pt.pieceStart[best] + char;
}

/** Client rects of flow text [a, b). */
function clientRects(pt: PageText, p: Phrase): DOMRect[] {
  const range = document.createRange();
  const out: DOMRect[] = [];
  for (const run of phrasePieces(pt.flow, p)) {
    const node = pt.nodes[run.piece];
    if (!node?.isConnected) continue;
    range.setStart(node, run.from);
    range.setEnd(node, Math.min(run.to, node.data.length));
    out.push(...Array.from(range.getClientRects()));
  }
  return out;
}

/** One box per line of a phrase, normalised to the page (as text highlights store them). */
export function phraseRects(pt: PageText, pageEl: HTMLElement, p: Phrase): NormRect[] {
  const box = pageEl.getBoundingClientRect();
  const inside = clientRects(pt, p).map((r) => ({ left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height }));
  return mergeLineRects(inside).map((l) => ({
    x: Math.max(0, l.x1 / box.width),
    y: Math.max(0, l.y1 / box.height),
    w: Math.min(1, (l.x2 - l.x1) / box.width),
    h: Math.min(1, (l.y2 - l.y1) / box.height),
  }));
}

/** True when a point (normalised to the page) is on one of the boxes. */
export function onRects(rects: NormRect[], x: number, y: number, pad = 0.002): boolean {
  return rects.some((r) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad);
}

/**
 * Tidies an area box drawn over text: the words it touches (35% of a word's width and 40% of its
 * height inside), at full line height. Null keeps the box as drawn: no text there, or the words
 * fill less than half of it (a picture with a few labels).
 */
export function snapToWords(pt: PageText, pageEl: HTMLElement, rect: NormRect): { rect: NormRect; text: string } | null {
  const box = pageEl.getBoundingClientRect();
  const d = { x0: rect.x * box.width, y0: rect.y * box.height, x1: (rect.x + rect.w) * box.width, y1: (rect.y + rect.h) * box.height };
  const near = (p: Piece) => p.x1 > d.x0 && p.x0 < d.x1 && p.y1 > d.y0 && p.y0 < d.y1;
  const pieces = new Set<number>();
  pt.pieces.forEach((p, i) => near(p) && pieces.add(i));
  if (!pieces.size) return null;
  const { flow } = pt;
  let u: { x0: number; y0: number; x1: number; y1: number } | null = null;
  const words: string[] = [];
  for (const [a, b] of flow.words) {
    if (!pieces.has(flow.piece[a]) && !pieces.has(flow.piece[b - 1])) continue;
    const rs = clientRects(pt, { a, b }).map((r) => ({ x0: r.left - box.left, y0: r.top - box.top, x1: r.right - box.left, y1: r.bottom - box.top }));
    if (!rs.length) continue;
    // A word split over two lines counts by its part on the line the box is on.
    for (const w of rs) {
      const ox = Math.min(w.x1, d.x1) - Math.max(w.x0, d.x0);
      const oy = Math.min(w.y1, d.y1) - Math.max(w.y0, d.y0);
      if (ox < 0.35 * (w.x1 - w.x0) || oy < 0.4 * (w.y1 - w.y0)) continue;
      u = u ? { x0: Math.min(u.x0, w.x0), y0: Math.min(u.y0, w.y0), x1: Math.max(u.x1, w.x1), y1: Math.max(u.y1, w.y1) } : { ...w };
      words.push(phraseText(flow, { a, b }));
      break;
    }
  }
  if (!u) return null;
  const inter = Math.max(0, Math.min(u.x1, d.x1) - Math.max(u.x0, d.x0)) * Math.max(0, Math.min(u.y1, d.y1) - Math.max(u.y0, d.y0));
  if (inter < 0.5 * (d.x1 - d.x0) * (d.y1 - d.y0)) return null;
  const pad = 1;
  return {
    rect: {
      x: Math.max(0, (u.x0 - pad) / box.width),
      y: Math.max(0, (u.y0 - pad) / box.height),
      w: Math.min(1, (u.x1 - u.x0 + 2 * pad) / box.width),
      h: Math.min(1, (u.y1 - u.y0 + 2 * pad) / box.height),
    },
    text: words.join(" "),
  };
}
