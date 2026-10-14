import type { PDFDocumentProxy } from "./pdf";
import type { NormRect } from "./types";

/**
 * Turns a PDF's text layer into Markdown (or tidy plain text), offline, with pdf.js.
 *
 * pdf.js gives positioned text runs; this rebuilds lines, then paragraphs, headings (by font size
 * relative to the body text) and bullet lists (by bullet glyphs and indentation), and drops page
 * headers/footers that repeat on most pages. Formulas come out as plain characters (PDFs don't keep
 * their LaTeX). Pages without any text (scans) are reported so they can be OCRed.
 */

export type TextFormat = "markdown" | "text";

export interface ExtractOptions {
  format: TextFormat;
  /** Separate pages with a "Page N" marker. */
  pageMarkers: boolean;
  /** Drop running headers/footers and page numbers that repeat across pages. */
  dropRepeated: boolean;
  /**
   * Pages whose text comes from OCR. OCR text lines are sized to fit the scan, so font size says
   * nothing about headings there: those pages become paragraphs and lists only, joined loosely.
   */
  ocrPages?: number[];
  /**
   * Mark highlighted text as ==text==: StudySpace's highlights per page (normalised rects, as stored)
   * plus Highlight annotations saved in the PDF itself. Leave out for no marks.
   */
  highlights?: Map<number, NormRect[]> | null;
  /** Text to add after a page's own text (already in the output format), e.g. the notes for that page. */
  afterPage?: Map<number, string>;
}

/** Private-use characters bracketing highlighted text while lines and blocks are built. */
const MARK_START = "\uE000";
const MARK_END = "\uE001";
const unmarked = (s: string) => s.replace(/[\uE000\uE001]/g, "");

/** Turns the private marks into ==text==, joining neighbouring marked runs and keeping spaces outside. */
function finishMarks(s: string): string {
  return s
    .replace(/\uE001(\s*)\uE000/g, "$1")
    .replace(/\uE000(\s+)/g, "$1\uE000")
    .replace(/(\s+)\uE001/g, "\uE001$1")
    .replace(/\uE000\uE001/g, "")
    .replace(/[\uE000\uE001]/g, "==");
}

/** Highlight annotations stored in the PDF file (from any program), as normalised rects. */
async function fileHighlights(page: Awaited<ReturnType<PDFDocumentProxy["getPage"]>>): Promise<NormRect[]> {
  const vp = page.getViewport({ scale: 1 });
  const out: NormRect[] = [];
  const box = (pts: number[]) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const [x, y] = vp.convertToViewportPoint(pts[i], pts[i + 1]) as [number, number];
      xs.push(x / vp.width);
      ys.push(y / vp.height);
    }
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    out.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
  };
  try {
    for (const a of (await page.getAnnotations()) as { subtype?: string; quadPoints?: ArrayLike<number> | null; rect?: number[] }[]) {
      if (a.subtype !== "Highlight") continue;
      const q = a.quadPoints ? Array.from(a.quadPoints) : [];
      if (q.length >= 8) for (let i = 0; i + 8 <= q.length; i += 8) box(q.slice(i, i + 8));
      else if (a.rect) box([a.rect[0], a.rect[1], a.rect[2], a.rect[3]]);
    }
  } catch {
    /* annotations unreadable: StudySpace's own highlights still count */
  }
  return out;
}

export interface ExtractResult {
  text: string;
  pages: number[];
  /** Pages that have no text layer at all (scanned images). */
  emptyPages: number[];
}

interface Line {
  text: string;
  x: number;
  /** Baseline, from the top of the page. */
  y: number;
  size: number;
}

interface PageLines {
  page: number;
  width: number;
  height: number;
  lines: Line[];
}

interface RawItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

async function readPage(pdf: PDFDocumentProxy, n: number, highlights?: NormRect[] | null): Promise<PageLines> {
  const page = await pdf.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const marks = highlights ? [...highlights, ...(await fileHighlights(page))] : [];
  /** The run with its highlighted characters bracketed (each character's position estimated along the run). */
  const markRun = (str: string, x: number, y: number, width: number, size: number): string => {
    if (!marks.length || !str) return str;
    const midY = (y - size * 0.3) / vp.height;
    const row = marks.filter((r) => midY >= r.y && midY <= r.y + r.h);
    if (!row.length) return str;
    const hits: boolean[] = [];
    for (let i = 0; i < str.length; i++) {
      const cx = (x + ((i + 0.5) / str.length) * width) / vp.width;
      hits.push(row.some((r) => cx >= r.x && cx <= r.x + r.w));
    }
    // Character positions are estimates, so a highlight's edge can clip a letter: a word counts as
    // highlighted when at least half of it is.
    for (let i = 0; i < str.length; ) {
      if (/\s/.test(str[i])) {
        hits[i++] = false;
        continue;
      }
      let j = i;
      while (j < str.length && !/\s/.test(str[j])) j++;
      const n = hits.slice(i, j).filter(Boolean).length;
      hits.fill(n > 0 && n * 2 >= j - i, i, j);
      i = j;
    }
    let out = "";
    let on = false;
    for (let i = 0; i < str.length; i++) {
      const hit = hits[i];
      if (hit !== on) {
        out += hit ? MARK_START : MARK_END;
        on = hit;
      }
      out += str[i];
    }
    return on ? out + MARK_END : out;
  };
  const lines: Line[] = [];
  /** `end`: right edge so far; `ly`: baseline of the latest run (scans are often slightly tilted). */
  let cur: (Line & { end: number; ly: number }) | null = null;
  const flush = () => {
    if (cur && cur.text.trim()) lines.push({ text: cur.text.replace(/\s+/g, " ").trim(), x: cur.x, y: cur.y, size: cur.size });
    cur = null;
  };
  for (const raw of content.items) {
    if (!("str" in raw)) continue;
    const it = raw as RawItem;
    const [, , c, d, e, f] = it.transform;
    const [x, y] = vp.convertToViewportPoint(e, f) as [number, number];
    const size = Math.hypot(c, d) || it.height || 10;
    if (it.str.trim()) {
      const str = markRun(it.str, x, y, it.width, size);
      const sameLine = cur && Math.abs(y - cur.ly) <= Math.max(cur.size, size) * 0.5 && x >= cur.end - size * 1.5;
      if (!sameLine) {
        flush();
        cur = { text: str, x, y, size, end: x + it.width, ly: y };
      } else if (cur) {
        cur.ly = y;
        const gap = x - cur.end;
        const needsSpace = gap > size * 0.15 && !cur.text.endsWith(" ") && !it.str.startsWith(" ");
        cur.text += (needsSpace ? " " : "") + str;
        cur.end = Math.max(cur.end, x + it.width);
        // The line's size is that of its dominant (longest) run.
        if (it.str.length > 3 && size > cur.size) cur.size = size;
      }
    }
    // hasEOL is ignored on purpose: OCR text layers flag every word as a line end. Lines are built
    // from positions instead (a new line starts when the baseline moves).
  }
  flush();
  // Scans often carry a tiny text stamp ("45.jpg", "Scanned with CamScanner"). It isn't content, and a
  // page with nothing else is a scanned image.
  const kept = lines.filter((l) => !SCAN_STAMP.test(unmarked(l.text)));
  const hasContent = kept.some((l) => !PAGE_NUMBER.test(unmarked(l.text)));
  return { page: n, width: vp.width, height: vp.height, lines: hasContent ? kept : [] };
}

const BULLET = /^([•●▪■◦‣∙·○◆◇►▸▹➢➤➔→✓✔❖\u2022\u2043\u25AA\u25CF\u25E6\u2023\uF06C\uF06E\uF075\uF076\uF0A7\uF0B7\uF0D8\uF0E0\uF0FC\uF0A8]|[-–—*](?=\s))\s*/;
const NUMBERED = /^(\d{1,3})[.)]\s+/;
const LETTERED = /^([a-zA-Z]|[ivx]{1,4})[.)]\s+/;
const PAGE_NUMBER = /^(page\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;
const SCAN_STAMP = /^(\S+\.(jpe?g|png|tiff?|bmp|gif|jp2|webp)|(scanned (with|by) )?camscanner)$/i;

/** Character-weighted most common font size: the body text. */
function bodySize(pages: PageLines[]): number {
  const weight = new Map<number, number>();
  for (const p of pages) for (const l of p.lines) {
    const k = Math.round(l.size * 2) / 2;
    weight.set(k, (weight.get(k) ?? 0) + l.text.length);
  }
  let best = 10;
  let bestW = -1;
  for (const [k, w] of weight) if (w > bestW) [best, bestW] = [k, w];
  return best;
}

/**
 * Removes running headers/footers (text repeated near the top/bottom of most pages) and page numbers
 * from `pages`; `stats` (the pages plus a sample of others) decides what counts as repeated.
 */
function dropRepeated(pages: PageLines[], stats: PageLines[]): void {
  const withText = stats.filter((p) => p.lines.length);
  const inMargin = (p: PageLines, l: Line) => l.y < p.height * 0.09 || l.y > p.height * 0.91;
  const key = (l: Line) => unmarked(l.text).toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const seen = new Map<string, number>();
  for (const p of withText) {
    for (const k of new Set(p.lines.filter((l) => inMargin(p, l)).map(key))) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const threshold = Math.max(3, withText.length * 0.5);
  for (const p of pages) {
    p.lines = p.lines.filter((l) => !(inMargin(p, l) && ((seen.get(key(l)) ?? 0) >= threshold || PAGE_NUMBER.test(unmarked(l.text)))));
  }
}

type Block =
  | { kind: "heading"; level: number; text: string; size: number }
  | { kind: "para"; text: string; size: number; x: number; lastY: number; lines: number }
  | { kind: "item"; marker: "bullet" | number; depth: number; text: string; size: number; x: number; lastY: number; lines: number };

/** Appends a wrapped line, re-joining words split with a hyphen at the line end. */
const joinLine = (a: string, b: string) => (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b) ? a.slice(0, -1) + b : `${a} ${b}`);

function toBlocks(p: PageLines, headingLevel: (size: number) => number, ocr: boolean): Block[] {
  const blocks: Block[] = [];
  // Indentation levels of list items on this page.
  const itemXs: number[] = [];
  const depthOf = (x: number, size: number) => {
    let i = itemXs.findIndex((v) => Math.abs(v - x) < size * 0.8);
    if (i === -1) {
      itemXs.push(x);
      itemXs.sort((a, b) => a - b);
      i = itemXs.indexOf(x);
    }
    return Math.min(i, 3);
  };
  let prevY = -Infinity;
  for (const l of p.lines) {
    const gap = l.y - prevY - l.size;
    prevY = l.y;
    const last = blocks[blocks.length - 1];
    const level = ocr ? 0 : headingLevel(l.size);
    // A highlight starting at the line's first character mustn't hide its bullet or number.
    const lead = l.text.startsWith(MARK_START) ? MARK_START : "";
    const t = lead ? l.text.slice(1) : l.text;
    if (level && unmarked(l.text).length <= 120 && !BULLET.test(t)) {
      // A title wrapped over two lines stays one heading.
      if (last?.kind === "heading" && last.level === level && gap < l.size) last.text = joinLine(last.text, l.text);
      else blocks.push({ kind: "heading", level, text: l.text, size: l.size });
      continue;
    }
    const bullet = BULLET.exec(t);
    const numbered = !bullet && NUMBERED.exec(t);
    const lettered = !bullet && !numbered && LETTERED.exec(t);
    if (bullet || numbered || lettered) {
      const text = bullet ? t.slice(bullet[0].length) : t;
      blocks.push({
        kind: "item",
        marker: numbered ? Number(numbered[1]) : "bullet",
        depth: depthOf(l.x, l.size),
        text: lead + (numbered ? text.slice(numbered[0].length) : text),
        size: l.size,
        x: l.x,
        lastY: l.y,
        lines: 1,
      });
      continue;
    }
    // Continuation of the previous paragraph / list item: similar size, close below, not outdented.
    if (
      last &&
      last.kind !== "heading" &&
      Math.abs(last.size - l.size) <= Math.max(0.6, l.size * (ocr ? 0.5 : 0.12)) &&
      l.y - last.lastY <= l.size * (ocr ? 2.2 : 1.75) &&
      // A paragraph's first line may be indented, so its second line can start further left.
      l.x >= last.x - l.size * (last.kind === "para" && last.lines === 1 ? 4 : 0.6)
    ) {
      last.text = joinLine(last.text, l.text);
      last.lastY = l.y;
      if (last.kind === "para" && last.lines === 1) last.x = Math.min(last.x, l.x);
      last.lines++;
      continue;
    }
    blocks.push({ kind: "para", text: l.text, size: l.size, x: l.x, lastY: l.y, lines: 1 });
  }
  return blocks;
}

/** Escapes text so Markdown (and the notes' math rendering) shows it literally. */
export function escapeMarkdown(s: string, atLineStart = true): string {
  let out = s.replace(/\\/g, "\\\\").replace(/([`*_$<>[\]|~])/g, "\\$1");
  if (atLineStart) out = out.replace(/^(#{1,6}\s)/, "\\$1").replace(/^([-+]\s)/, "\\$1").replace(/^(\d+)([.)]\s)/, "$1\\$2");
  return out;
}

function render(blocks: Block[], format: TextFormat): string {
  const out: string[] = [];
  let prev: Block | undefined;
  for (const b of blocks) {
    const tight = prev?.kind === "item" && b.kind === "item";
    if (out.length && !tight) out.push("");
    if (b.kind === "heading") {
      out.push(format === "markdown" ? `${"#".repeat(b.level)} ${escapeMarkdown(b.text, false)}` : b.text);
    } else if (b.kind === "item") {
      const indent = (format === "markdown" ? "   " : "  ").repeat(b.depth);
      const marker = b.marker === "bullet" ? (format === "markdown" ? "-" : "•") : `${b.marker}.`;
      out.push(`${indent}${marker} ${format === "markdown" ? escapeMarkdown(b.text, false) : b.text}`);
    } else {
      out.push(format === "markdown" ? escapeMarkdown(b.text) : b.text);
    }
    prev = b;
  }
  return out.join("\n");
}

const STATS_PAGES = 12;

/** Up to `count` page numbers spread evenly over the document, excluding `taken`. */
function samplePages(total: number, taken: number[], count: number): number[] {
  const skip = new Set(taken);
  const out: number[] = [];
  const step = Math.max(1, total / (count + 1));
  for (let x = step / 2 + 1; x <= total && out.length < count; x += step) {
    const n = Math.min(total, Math.round(x));
    if (!skip.has(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Extracts `pages` (1-based) of `pdf` as Markdown or plain text. */
export async function extractPages(
  pdf: PDFDocumentProxy,
  pages: number[],
  opts: ExtractOptions,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ExtractResult> {
  const read: PageLines[] = [];
  for (const n of pages) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    read.push(await readPage(pdf, n, opts.highlights ? (opts.highlights.get(n) ?? []) : null));
    onProgress?.(read.length, pages.length);
  }
  const emptyPages = read.filter((p) => !p.lines.length).map((p) => p.page);

  // Font sizes and running headers are judged on more than a handful of pages: one title slide on
  // its own has no "body text" to compare with. So add a spread of other pages for statistics.
  const stats = [...read];
  if (pages.length < STATS_PAGES) {
    for (const n of samplePages(pdf.numPages, pages, STATS_PAGES - pages.length)) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      stats.push(await readPage(pdf, n));
    }
  }
  if (opts.dropRepeated && stats.length >= 3) dropRepeated(read, stats);

  const body = bodySize(stats);
  // Heading sizes, largest first, grouped to the nearest point: up to three heading levels.
  const headingSizes = [...new Set(stats.flatMap((p) => p.lines.filter((l) => l.size >= body * 1.2).map((l) => Math.round(l.size))))].sort(
    (a, b) => b - a,
  );
  const headingLevel = (size: number) => {
    if (size < body * 1.2) return 0;
    return Math.min(3, headingSizes.indexOf(Math.round(size)) + 1) || 3;
  };

  const parts: string[] = [];
  for (const p of read) {
    const marker = opts.format === "markdown" ? `*Page ${p.page}*` : `--- Page ${p.page} ---`;
    let content = p.lines.length
      ? render(toBlocks(p, headingLevel, !!opts.ocrPages?.includes(p.page)), opts.format)
      : opts.format === "markdown"
        ? `*[Page ${p.page} has no text layer: it is a scanned image. Use OCR to read it.]*`
        : `[Page ${p.page} has no text layer: it is a scanned image. Use OCR to read it.]`;
    const extra = opts.afterPage?.get(p.page);
    if (extra) content = `${content}\n\n${extra}`;
    if (opts.pageMarkers) parts.push(opts.format === "markdown" ? `${parts.length ? "---\n\n" : ""}${marker}\n\n${content}` : `${marker}\n\n${content}`);
    else parts.push(content);
  }
  return { text: finishMarks(parts.filter((s) => s.trim()).join("\n\n")) + "\n", pages, emptyPages };
}

/** Which of `pages` have no text of their own (scanned images). Fast: reads the text layer only. */
export async function textlessPages(pdf: PDFDocumentProxy, pages: number[], signal?: AbortSignal): Promise<number[]> {
  const out: number[] = [];
  for (const n of pages) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (!(await readPage(pdf, n)).lines.length) out.push(n);
  }
  return out;
}

/** Tidies OCR output of a region (plain lines from Tesseract) into Markdown or plain text. */
export function ocrTextToFormat(plain: string, format: TextFormat): string {
  const paragraphs = plain
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((p) => p.length);
  const out: string[] = [];
  for (const lines of paragraphs) {
    const block: string[] = [];
    let para = "";
    const flushPara = () => {
      if (para) block.push(format === "markdown" ? escapeMarkdown(para) : para);
      para = "";
    };
    for (const line of lines) {
      const bullet = BULLET.exec(line);
      if (bullet) {
        flushPara();
        const text = line.slice(bullet[0].length);
        block.push(format === "markdown" ? `- ${escapeMarkdown(text, false)}` : `• ${text}`);
      } else if (block.length && /^(- |• )/.test(block[block.length - 1]) && !para) {
        // Wrapped bullet text.
        block[block.length - 1] = joinLine(block[block.length - 1], format === "markdown" ? escapeMarkdown(line, false) : line);
      } else {
        para = para ? joinLine(para, line) : line;
      }
    }
    flushPara();
    out.push(block.join("\n"));
  }
  return out.join("\n\n");
}
