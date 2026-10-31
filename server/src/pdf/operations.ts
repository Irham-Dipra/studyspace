import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFPage,
  PDFRef,
  PDFString,
  EncryptedPDFError,
  StandardFonts,
  degrees,
  type PDFFont,
} from "pdf-lib";
import type { Annotation } from "../types.js";
import { HttpError } from "../types.js";
import { displayHeight, displayToPdf, displayWidth, hexToRgb, normaliseRotation, type PageGeometry } from "./coords.js";

/** Annotations written by StudySpace carry this author and an NM prefix so they can be replaced idempotently. */
export const ANNOT_AUTHOR = "StudySpace";
export const ANNOT_NM_PREFIX = "studyspace-";

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (err instanceof EncryptedPDFError) {
      throw new HttpError(422, "This PDF is encrypted, so StudySpace cannot edit it.");
    }
    throw new HttpError(422, `Could not parse PDF for editing: ${(err as Error).message}`);
  }
}

export function pageGeometry(page: PDFPage): PageGeometry {
  const b = page.getCropBox();
  return { box: [b.x, b.y, b.x + b.width, b.y + b.height], rotation: normaliseRotation(page.getRotation().angle) };
}

function assertPage(pdf: PDFDocument, page: number, allowZero = false): void {
  const n = pdf.getPageCount();
  if (!Number.isInteger(page) || page < (allowZero ? 0 : 1) || page > n) {
    throw new HttpError(400, `Page ${page} is out of range (document has ${n} pages).`);
  }
}

/** Inserts `count` blank pages after page `after` (0 = before the first page), sized like the neighbouring page. */
export function insertBlankPages(pdf: PDFDocument, after: number, count = 1): void {
  assertPage(pdf, after, true);
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new HttpError(400, "count must be 1-50");
  const ref = pdf.getPage(Math.max(0, after - 1));
  const g = pageGeometry(ref);
  const w = g.box[2] - g.box[0];
  const h = g.box[3] - g.box[1];
  const size: [number, number] = g.rotation % 180 === 0 ? [w, h] : [h, w];
  for (let i = 0; i < count; i++) pdf.insertPage(after + i, size);
}

/** Copies pages `from..to` (1-based, inclusive) of `source` and inserts them after page `after`. */
export async function insertPagesFrom(
  pdf: PDFDocument,
  source: PDFDocument,
  after: number,
  from: number,
  to: number,
): Promise<number> {
  assertPage(pdf, after, true);
  const n = source.getPageCount();
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > n || from > to) {
    throw new HttpError(400, `Source page range ${from}-${to} is invalid (source has ${n} pages).`);
  }
  if (to - from + 1 > 500) throw new HttpError(400, "Cannot insert more than 500 pages at once.");
  const indices = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  const copied = await pdf.copyPages(source, indices);
  copied.forEach((p, i) => {
    stripStudySpaceAnnotations(pdf, p);
    pdf.insertPage(after + i, p);
  });
  return copied.length;
}

/**
 * Replaces pages `at..at+(to-from)` with copies of pages `from..to` of `source`, one for one,
 * so the page count and every other page's number stay the same.
 */
export async function replacePagesFrom(
  pdf: PDFDocument,
  source: PDFDocument,
  at: number,
  from: number,
  to: number,
): Promise<number> {
  const n = source.getPageCount();
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > n || from > to) {
    throw new HttpError(400, `Source page range ${from}-${to} is invalid (source has ${n} pages).`);
  }
  const count = to - from + 1;
  assertPage(pdf, at);
  if (at + count - 1 > pdf.getPageCount()) {
    throw new HttpError(400, `Replacing ${count} pages from page ${at} goes past the end (document has ${pdf.getPageCount()} pages).`);
  }
  const copied = await pdf.copyPages(source, Array.from({ length: count }, (_, i) => from - 1 + i));
  copied.forEach((p, i) => {
    stripStudySpaceAnnotations(pdf, p);
    pdf.removePage(at - 1 + i);
    pdf.insertPage(at - 1 + i, p);
  });
  return count;
}

export function deletePages(pdf: PDFDocument, pages: number[]): void {
  const unique = [...new Set(pages)];
  if (unique.length === 0) throw new HttpError(400, "No pages given.");
  for (const p of unique) assertPage(pdf, p);
  if (unique.length >= pdf.getPageCount()) throw new HttpError(400, "Cannot delete every page of a document.");
  for (const p of unique.sort((a, b) => b - a)) pdf.removePage(p - 1);
}

/** Turns `pages` clockwise by `angle` (90, 180 or 270) on top of their current rotation. */
export function rotatePages(pdf: PDFDocument, pages: number[], angle: number): void {
  const unique = [...new Set(pages)];
  if (unique.length === 0) throw new HttpError(400, "No pages given.");
  if (![90, 180, 270].includes(angle)) throw new HttpError(400, "angle must be 90, 180 or 270");
  for (const p of unique) assertPage(pdf, p);
  for (const p of unique) {
    const page = pdf.getPage(p - 1);
    page.setRotation(degrees(normaliseRotation(page.getRotation().angle + angle)));
  }
}

/** Puts the pages in a new order; `order[i]` is the old number of the page that goes to position i + 1. */
export function reorderPages(pdf: PDFDocument, order: number[]): void {
  const n = pdf.getPageCount();
  if (order.length !== n || new Set(order).size !== n || order.some((p) => !Number.isInteger(p) || p < 1 || p > n)) {
    throw new HttpError(400, "The new page order must list every page exactly once.");
  }
  const pages = pdf.getPages();
  for (let i = n - 1; i >= 0; i--) pdf.removePage(i);
  order.forEach((old, i) => pdf.insertPage(i, pages[old - 1]));
}

/** Pages of a source PDF, in the order they go into a new PDF. */
export interface PageSegment {
  source: PDFDocument;
  pages: number[];
}

/**
 * Builds a new PDF from pages of other PDFs (extract, split and merge all use this). The source files
 * are not changed. StudySpace's own saved highlights are dropped from the copies unless `keepStudySpaceAnnotations`.
 */
export async function composePdf(segments: PageSegment[], opts: { title: string; keepStudySpaceAnnotations: boolean }): Promise<PDFDocument> {
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const seg of segments) {
    const n = seg.source.getPageCount();
    for (const p of seg.pages) {
      if (!Number.isInteger(p) || p < 1 || p > n) throw new HttpError(400, `Page ${p} is out of range (document has ${n} pages).`);
    }
    const copied = await out.copyPages(seg.source, seg.pages.map((p) => p - 1));
    for (const page of copied) {
      if (!opts.keepStudySpaceAnnotations) stripStudySpaceAnnotations(out, page);
      out.addPage(page);
    }
  }
  if (out.getPageCount() === 0) throw new HttpError(400, "The new PDF would have no pages.");
  out.setTitle(opts.title);
  out.setProducer("StudySpace (pdf-lib)");
  return out;
}

function textOf(obj: unknown): string | undefined {
  if (obj instanceof PDFString || obj instanceof PDFHexString) return obj.decodeText();
  return undefined;
}

function isStudySpaceAnnot(dict: PDFDict): boolean {
  const nm = textOf(dict.get(PDFName.of("NM")));
  if (nm?.startsWith(ANNOT_NM_PREFIX)) return true;
  return textOf(dict.get(PDFName.of("T"))) === ANNOT_AUTHOR && nm === undefined;
}

/** Removes annotations previously written by StudySpace from a page. Returns how many were removed. */
export function stripStudySpaceAnnotations(pdf: PDFDocument, page: PDFPage): number {
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) return 0;
  const keep: (PDFRef | PDFDict)[] = [];
  let removed = 0;
  for (let i = 0; i < annots.size(); i++) {
    const raw = annots.get(i);
    const dict = raw instanceof PDFRef ? pdf.context.lookupMaybe(raw, PDFDict) : raw instanceof PDFDict ? raw : undefined;
    if (dict && isStudySpaceAnnot(dict)) {
      removed++;
      const ap = dict.lookupMaybe(PDFName.of("AP"), PDFDict);
      const n = ap?.get(PDFName.of("N"));
      if (n instanceof PDFRef) pdf.context.delete(n);
      if (raw instanceof PDFRef) pdf.context.delete(raw);
    } else if (raw instanceof PDFRef || raw instanceof PDFDict) {
      keep.push(raw);
    }
  }
  if (removed > 0) {
    if (keep.length) page.node.set(PDFName.of("Annots"), pdf.context.obj(keep));
    else page.node.delete(PDFName.of("Annots"));
  }
  return removed;
}

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

function bbox(points: [number, number][], pad = 0): [number, number, number, number] {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

/** Text-box layout, shared with the web overlay (TextBoxes.tsx): padding and line height per font size. */
const TEXT_PAD = 0.2;
const TEXT_LINE = 1.2;
/** First baseline below the top of a line, per font size (matches the browser's Arial / Liberation Sans). */
const TEXT_BASELINE = 0.95;

/** Lines of `text` that fit `width` at `size`, broken at spaces (or inside a word too long for a line). */
function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      if (fits(line + word)) {
        line += word;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = word.trimStart();
      // A word wider than the box: split it.
      while (line && !fits(line)) {
        let n = line.length - 1;
        while (n > 1 && !fits(line.slice(0, n))) n--;
        out.push(line.slice(0, n));
        line = line.slice(n);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * A text box as a FreeText annotation drawn in Helvetica. Helvetica only has Latin characters
 * (WinAnsi): others are drawn as "?", while /Contents keeps the text as typed.
 */
function buildTextBox(pdf: PDFDocument, page: PDFPage, a: Annotation, font: PDFFont, common: Record<string, unknown>): PDFRef | null {
  const rc = a.rects[0];
  if (!rc || !a.text.trim()) return null;
  const ctx = pdf.context;
  const g = pageGeometry(page);
  const dw = displayWidth(g);
  const dh = displayHeight(g);
  const [r, gr, b] = hexToRgb(a.color);
  const size = Math.max(4, a.strokeWidth * dw);
  const pad = TEXT_PAD * size;
  const boxW = Math.max(rc.w * dw, size * 2);
  const known = new Set(font.getCharacterSet());
  const drawable = [...a.text.replace(/\r\n?/g, "\n")].map((c) => (c === "\n" || known.has(c.codePointAt(0)!) ? c : "?")).join("");
  const lines = wrapText(drawable, font, size, boxW - 2 * pad);
  const boxH = Math.max(rc.h * dh, 2 * pad + lines.length * TEXT_LINE * size);

  // Drawn upright as the page is shown: the form is turned with the page's /Rotate.
  const rot = (normaliseRotation(g.rotation) * Math.PI) / 180;
  const cos = Math.round(Math.cos(rot));
  const sin = Math.round(Math.sin(rot));
  const corners = [
    displayToPdf(rc.x, rc.y, g),
    displayToPdf(rc.x + boxW / dw, rc.y, g),
    displayToPdf(rc.x, rc.y + boxH / dh, g),
    displayToPdf(rc.x + boxW / dw, rc.y + boxH / dh, g),
  ];
  const rect = bbox(corners);
  let ops = `BT /F1 ${f(size)} Tf ${f(r)} ${f(gr)} ${f(b)} rg\n`;
  lines.forEach((line, i) => {
    const y = boxH - pad - TEXT_BASELINE * size - i * TEXT_LINE * size;
    if (line) ops += `1 0 0 1 ${f(pad)} ${f(y)} Tm ${font.encodeText(line).toString()} Tj\n`;
  });
  ops += "ET";
  const ap = ctx.register(
    ctx.stream(ops, {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, boxW, boxH],
      Matrix: [cos, sin, -sin, cos, 0, 0],
      Resources: { Font: { F1: font.ref } },
    }),
  );
  const { C: _border, ...rest } = common;
  return ctx.register(
    ctx.obj({
      ...rest,
      Subtype: "FreeText",
      Rect: rect,
      DA: PDFString.of(`/Helv ${f(size)} Tf ${f(r)} ${f(gr)} ${f(b)} rg`),
      Q: 0,
      BS: { W: 0 },
      AP: { N: ap },
    }),
  );
}

function buildAnnotation(pdf: PDFDocument, page: PDFPage, a: Annotation, font: () => PDFFont): PDFRef | null {
  const ctx = pdf.context;
  const g = pageGeometry(page);
  const [r, gr, b] = hexToRgb(a.color);
  const opacity = Math.min(1, Math.max(0.05, a.opacity));
  const common = {
    Type: "Annot",
    F: 4, // Print
    C: [r, gr, b],
    CA: opacity,
    T: PDFString.of(ANNOT_AUTHOR),
    NM: PDFString.of(`${ANNOT_NM_PREFIX}${a.id}`),
    M: PDFString.fromDate(new Date(a.updatedAt.endsWith("Z") ? a.updatedAt : `${a.updatedAt}Z`)),
    Contents: PDFHexString.fromText(a.text ?? ""),
    P: page.ref,
  };

  if (a.kind === "text") return buildTextBox(pdf, page, a, font(), common);
  if (a.kind === "highlight" || a.kind === "area") {
    if (!a.rects.length) return null;
    const quads: number[] = [];
    const pts: [number, number][] = [];
    let path = "";
    for (const rc of a.rects) {
      const tl = displayToPdf(rc.x, rc.y, g);
      const tr = displayToPdf(rc.x + rc.w, rc.y, g);
      const bl = displayToPdf(rc.x, rc.y + rc.h, g);
      const br = displayToPdf(rc.x + rc.w, rc.y + rc.h, g);
      quads.push(...tl, ...tr, ...bl, ...br);
      pts.push(tl, tr, bl, br);
      path += `${f(tl[0])} ${f(tl[1])} m ${f(tr[0])} ${f(tr[1])} l ${f(br[0])} ${f(br[1])} l ${f(bl[0])} ${f(bl[1])} l h f\n`;
    }
    const rect = bbox(pts);
    const ap = ctx.register(
      ctx.stream(`/GS0 gs ${f(r)} ${f(gr)} ${f(b)} rg\n${path}`, {
        Type: "XObject",
        Subtype: "Form",
        BBox: rect,
        Resources: { ExtGState: { GS0: { Type: "ExtGState", BM: "Multiply", CA: opacity, ca: opacity } } },
      }),
    );
    return ctx.register(
      ctx.obj({ ...common, Subtype: "Highlight", Rect: rect, QuadPoints: quads, AP: { N: ap } }),
    );
  }

  // ink
  const strokes = a.paths.filter((p) => p.length > 0).map((p) => p.map(([u, v]) => displayToPdf(u, v, g)));
  if (!strokes.length) return null;
  const width = Math.max(0.25, a.strokeWidth * displayWidth(g));
  const rect = bbox(strokes.flat(), width);
  let path = "";
  for (const s of strokes) {
    const pts = s.length === 1 ? [s[0], [s[0][0] + 0.01, s[0][1]] as [number, number]] : s;
    path += `${f(pts[0][0])} ${f(pts[0][1])} m ` + pts.slice(1).map((p) => `${f(p[0])} ${f(p[1])} l`).join(" ") + " S\n";
  }
  const ap = ctx.register(
    ctx.stream(`/GS0 gs ${f(r)} ${f(gr)} ${f(b)} RG ${f(width)} w 1 J 1 j\n${path}`, {
      Type: "XObject",
      Subtype: "Form",
      BBox: rect,
      Resources: { ExtGState: { GS0: { Type: "ExtGState", CA: opacity, ca: opacity } } },
    }),
  );
  return ctx.register(
    ctx.obj({
      ...common,
      Subtype: "Ink",
      Rect: rect,
      InkList: strokes.map((s) => s.flat()),
      BS: { W: width, S: "S" },
      AP: { N: ap },
    }),
  );
}

/**
 * Replaces all StudySpace-authored annotations in the PDF with `annotations`.
 * Annotations from other tools are left untouched. Idempotent.
 */
export function writeAnnotations(pdf: PDFDocument, annotations: Annotation[]): { written: number; removed: number } {
  const pages = pdf.getPages();
  let removed = 0;
  for (const p of pages) removed += stripStudySpaceAnnotations(pdf, p);
  let written = 0;
  // Embedded only when there is a text box.
  let helvetica: PDFFont | undefined;
  const font = () => (helvetica ??= pdf.embedStandardFont(StandardFonts.Helvetica));
  for (const a of annotations) {
    const page = pages[a.page - 1];
    if (!page) continue;
    const ref = buildAnnotation(pdf, page, a, font);
    if (ref) {
      page.node.addAnnot(ref);
      written++;
    }
  }
  return { written, removed };
}

export function countStudySpaceAnnotations(pdf: PDFDocument): number {
  let n = 0;
  for (const page of pdf.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const d = annots.lookupMaybe(i, PDFDict);
      if (d && isStudySpaceAnnot(d)) n++;
    }
  }
  return n;
}

// ---- Outline (bookmarks) ---------------------------------------------------------------

export interface OutlineItem {
  title: string;
  /** 1-based page number. */
  page: number;
  /** Position on the page, 0 = top (normalised display coordinates); null = start of the page. */
  top: number | null;
  children: OutlineItem[];
}

/** Deletes the outline item objects reachable from an outline root (old outlines don't pile up in the file). */
function deleteOutlineTree(pdf: PDFDocument, rootRef: PDFRef): void {
  const ctx = pdf.context;
  const seen = new Set<string>();
  const visit = (ref: unknown) => {
    for (let cur = ref; cur instanceof PDFRef && !seen.has(cur.toString()); ) {
      seen.add(cur.toString());
      const dict = ctx.lookupMaybe(cur, PDFDict);
      if (!dict) break;
      visit(dict.get(PDFName.of("First")));
      const next = dict.get(PDFName.of("Next"));
      ctx.delete(cur);
      cur = next;
    }
  };
  const root = ctx.lookupMaybe(rootRef, PDFDict);
  if (root) visit(root.get(PDFName.of("First")));
  ctx.delete(rootRef);
}

/**
 * Replaces the PDF's outline (the bookmarks other readers show) with `items`, or removes it when
 * `items` is empty. Nested items start collapsed, as in most books.
 */
export function writeOutline(pdf: PDFDocument, items: OutlineItem[]): void {
  const ctx = pdf.context;
  const catalog = pdf.catalog;
  const old = catalog.get(PDFName.of("Outlines"));
  if (old instanceof PDFRef) deleteOutlineTree(pdf, old);
  catalog.delete(PDFName.of("Outlines"));
  if (!items.length) return;

  const pages = pdf.getPages();
  const dest = (it: OutlineItem) => {
    const page = pages[Math.min(pages.length, Math.max(1, it.page)) - 1];
    const g = pageGeometry(page);
    // XYZ keeps the reader's zoom and scrolls to `top`; on rotated pages "top" isn't a y value, so fit the page.
    if (g.rotation !== 0) return ctx.obj([page.ref, "Fit"]);
    const y = it.top == null ? g.box[3] : displayToPdf(0, Math.min(1, Math.max(0, it.top)), g)[1];
    return ctx.obj([page.ref, "XYZ", null, Math.round(y * 100) / 100, null]);
  };

  const build = (list: OutlineItem[], parent: PDFRef) => {
    const refs = list.map(() => ctx.nextRef());
    list.forEach((it, i) => {
      const dict = ctx.obj({ Title: PDFHexString.fromText(it.title), Parent: parent, Dest: dest(it) }) as PDFDict;
      if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]);
      if (i < refs.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]);
      if (it.children.length) {
        const sub = build(it.children, refs[i]);
        dict.set(PDFName.of("First"), sub.first);
        dict.set(PDFName.of("Last"), sub.last);
        dict.set(PDFName.of("Count"), ctx.obj(-it.children.length)); // negative = collapsed
      }
      ctx.assign(refs[i], dict);
    });
    return { first: refs[0], last: refs[refs.length - 1] };
  };

  const rootRef = ctx.nextRef();
  const top = build(items, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: "Outlines", First: top.first, Last: top.last, Count: items.length }));
  catalog.set(PDFName.of("Outlines"), rootRef);
}
