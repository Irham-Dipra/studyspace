import type { PDFDocumentProxy } from "./pdf";
import type { OutlineEntry } from "./api";
import type { Bookmark } from "./types";

/** A place in the PDF: page number (1-based) and how far down the page (0 = top, 1 = bottom; null = top). */
export interface PdfPosition {
  page: number;
  top: number | null;
}

/**
 * Resolves a PDF destination (named or explicit, as pdf.js gives them for links and outline items)
 * to a page and a vertical position. Returns null for a broken destination.
 */
export async function resolveDest(pdf: PDFDocumentProxy, dest: unknown): Promise<PdfPosition | null> {
  try {
    const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : (dest as unknown[] | null);
    if (!Array.isArray(explicit) || !explicit.length) return null;
    const target = explicit[0];
    const index =
      typeof target === "number" ? target : await pdf.getPageIndex(target as Parameters<PDFDocumentProxy["getPageIndex"]>[0]);
    if (!Number.isInteger(index) || index < 0 || index >= pdf.numPages) return null;
    // The y coordinate (PDF space, from the bottom) that the destination puts at the top of the view.
    const kind = (explicit[1] as { name?: string } | undefined)?.name;
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const y = kind === "XYZ" ? n(explicit[3]) : kind === "FitH" || kind === "FitBH" ? n(explicit[2]) : kind === "FitR" ? n(explicit[5]) : null;
    if (y === null) return { page: index + 1, top: null };
    const page = await pdf.getPage(index + 1);
    const vp = page.getViewport({ scale: 1 });
    const x = n(explicit[2]) ?? page.view[0];
    const [, vy] = vp.convertToViewportPoint(kind === "XYZ" ? x : page.view[0], y);
    const top = vy / vp.height;
    // "Top of the page" (give or take a margin) is stored as null, which is also what we write back;
    // so is a position off the page, which some PDFs have.
    return { page: index + 1, top: top < 0.01 || top > 1 ? null : Math.round(top * 10000) / 10000 };
  } catch {
    return null;
  }
}

interface PdfjsOutlineItem {
  title: string;
  dest: unknown;
  items: PdfjsOutlineItem[];
}

/** Hard cap on imported entries; the largest real-world outlines are a few thousand. */
const MAX_ENTRIES = 15000;

/**
 * Reads the PDF's own outline. Entries whose target can't be resolved (web links, broken
 * destinations) take their first child's page, or are dropped when they have none.
 */
export async function readOutline(pdf: PDFDocumentProxy, signal?: AbortSignal): Promise<OutlineEntry[]> {
  const outline = (await pdf.getOutline()) as PdfjsOutlineItem[] | null;
  if (!outline?.length) return [];
  let count = 0;
  const walk = async (items: PdfjsOutlineItem[]): Promise<OutlineEntry[]> => {
    const out: OutlineEntry[] = [];
    for (const item of items) {
      if (signal?.aborted || count >= MAX_ENTRIES) break;
      count++;
      const pos = item.dest ? await resolveDest(pdf, item.dest) : null;
      const children = item.items?.length ? await walk(item.items) : [];
      const page = pos?.page ?? children[0]?.page;
      if (!page) continue;
      const title = (item.title ?? "").replace(/\s+/g, " ").trim().slice(0, 1000) || "Untitled";
      out.push({ title, page, top: pos ? pos.top : null, ...(children.length ? { children } : {}) });
    }
    return out;
  };
  return walk(outline);
}

export interface BookmarkTreeNode extends Bookmark {
  children: BookmarkTreeNode[];
  depth: number;
}

/** Builds the tree (siblings ordered by position) from the flat list the server returns. */
export function buildBookmarkTree(list: Bookmark[]): BookmarkTreeNode[] {
  const nodes = new Map(list.map((b) => [b.id, { ...b, children: [] as BookmarkTreeNode[], depth: 0 }]));
  const roots: BookmarkTreeNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  const sort = (xs: BookmarkTreeNode[], depth: number) => {
    xs.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
    for (const x of xs) {
      x.depth = depth;
      sort(x.children, depth + 1);
    }
  };
  sort(roots, 0);
  return roots;
}

/** The bookmark the reader is "in": the last one, in reading order, at or before `page`. */
export function currentBookmarkId(list: Bookmark[], page: number): string | null {
  let best: Bookmark | null = null;
  for (const b of list) {
    if (b.page > page) continue;
    if (!best || b.page > best.page || (b.page === best.page && (b.top ?? 0) >= (best.top ?? 0))) best = b;
  }
  return best?.id ?? null;
}

/** Every bookmark of the tree in reading order (tree order), with its depth. */
export function flattenBookmarkTree(tree: BookmarkTreeNode[]): BookmarkTreeNode[] {
  const out: BookmarkTreeNode[] = [];
  const walk = (xs: BookmarkTreeNode[]) => xs.forEach((x) => (out.push(x), walk(x.children)));
  walk(tree);
  return out;
}

/**
 * The pages a bookmark's section covers: from its page to where the next bookmark after it starts
 * (the page before, or that page too when the next one starts lower down on it). With `withInside`,
 * the bookmarks nested inside it don't end it, so a chapter runs on to the next chapter.
 * `ordered` is every bookmark in reading order (flattenBookmarkTree).
 */
export function bookmarkPages(ordered: BookmarkTreeNode[], id: string, pageCount: number, withInside = true): { start: number; end: number } | null {
  const i = ordered.findIndex((x) => x.id === id);
  if (i < 0) return null;
  const b = ordered[i];
  const start = Math.min(Math.max(1, b.page), pageCount);
  const inside = new Set<string>();
  if (withInside) {
    // The nested ones follow it in reading order, deeper than it.
    for (let j = i + 1; j < ordered.length && ordered[j].depth > b.depth; j++) inside.add(ordered[j].id);
  }
  const top = b.top ?? 0;
  let next: { page: number; top: number } | null = null;
  for (const [j, x] of ordered.entries()) {
    if (j === i || inside.has(x.id)) continue;
    const xTop = x.top ?? 0;
    // After this one: on a later page, lower on the same page, or at the same spot but later in the list.
    const after = x.page > b.page || (x.page === b.page && (xTop > top || (xTop === top && j > i)));
    if (!after) continue;
    if (!next || x.page < next.page || (x.page === next.page && xTop < next.top)) next = { page: x.page, top: xTop };
  }
  const end = next ? (next.top > 0.15 ? next.page : next.page - 1) : pageCount;
  return { start, end: Math.max(start, Math.min(pageCount, end)) };
}
