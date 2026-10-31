import fs from "node:fs/promises";
import path from "node:path";
import { constants as FS, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { PDFDocument } from "pdf-lib";
import { transaction, type DB } from "../db/index.js";
import { listDirectories } from "../db/directories.js";
import { getDocument, setAnnotationsDirty, setBookmarksDirty, updateDocumentFileState } from "../db/documents.js";
import { bookmarkTree, type BookmarkNode } from "../db/bookmarks.js";
import { listAnnotations } from "../db/annotations.js";
import { getProgress, saveProgress } from "../db/progress.js";
import { setResourcePages } from "../db/resources.js";
import { listNoteMarkersForDocument } from "../db/noteMarkers.js";
import { fingerprintFile } from "../library/fingerprint.js";
import { resolveInsideRoots } from "../library/pathGuard.js";
import { canEditFile, isPaged } from "../library/fileKinds.js";
import {
  deletePages,
  insertBlankPages,
  insertPagesFrom,
  loadPdf,
  reorderPages,
  replacePagesFrom,
  rotatePages,
  writeAnnotations,
  writeOutline,
  type OutlineItem,
} from "../pdf/operations.js";
import {
  DeletionMap,
  inverseOrder,
  mapPageAfterInsert,
  orderAfterMove,
  mapRangeAfterInsert,
  unmapPageAfterDelete,
  unmapPageAfterInsert,
} from "../pdf/pageMap.js";
import { writeFileAtomic } from "./fileWriter.js";
import { rotateNormPoint, rotateNormRect } from "../pdf/coords.js";
import { HttpError, type DocumentRecord } from "../types.js";
import { convertedPdfPath } from "./slides.js";

export interface EditorOptions {
  dataDir: string;
  /** Undoable file edits kept per document (each keeps a copy of the previous file version). */
  historyLimit: number;
}

/** What happens to notes/resources whose pages are all deleted. */
export type OrphanPolicy = "delete" | "document";

export type EditResult = DocumentRecord & { editId: string | null };

/** Resolves a document's file through the directory guard. Throws 404/403/410 as appropriate. */
export function resolveDocumentFile(db: DB, id: string): { doc: DocumentRecord; file: string } {
  const doc = getDocument(db, id);
  if (!doc) throw new HttpError(404, "Document not found");
  if (doc.missing) throw new HttpError(410, "This document is no longer present on disk");
  const roots = listDirectories(db)
    .filter((d) => d.enabled)
    .map((d) => d.path);
  const file = resolveInsideRoots(doc.path, roots);
  if (!file) throw new HttpError(403, "Document is outside the configured library directories");
  return { doc, file };
}

/**
 * The PDF to read a document's pages from: the file itself, or for slides the PDF they were turned
 * into when opened.
 */
export function resolveReadablePdf(db: DB, dataDir: string, id: string): { doc: DocumentRecord; file: string } {
  const { doc, file } = resolveDocumentFile(db, id);
  if (!isPaged(doc.kind)) throw new HttpError(400, notPagesMessage(doc));
  if (doc.kind === "pdf") return { doc, file };
  const pdf = convertedPdfPath(dataDir, doc);
  if (!existsSync(pdf)) throw new HttpError(409, `Open “${doc.title}” once first, so its slides are turned into pages.`);
  return { doc, file: pdf };
}

export const SLIDES_READ_ONLY = "Slides can't be changed here. To edit pages, make a PDF of them with PDF tools → Extract.";

/** For HTML and Markdown documents, which have no pages to take or change. */
export const notPagesMessage = (doc: Pick<DocumentRecord, "title" | "kind">) =>
  `“${doc.title}” is ${doc.kind === "html" ? "an HTML page" : "a Markdown file"}, not a PDF, so it has no pages to use here.`;

const locks = new Map<string, Promise<unknown>>();

/** Serialises edits per document so two quick operations never interleave their read/modify/write. */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  locks.set(key, next);
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

// ---- Snapshots (used by undo) -------------------------------------------------

type Row = Record<string, unknown>;

interface Snapshot {
  resources: Row[];
  resourcePages: Row[];
  annotations: Row[];
  /** Highlights inside notes; optional because snapshots taken before migration 3 lack them. */
  noteHighlights?: Row[];
  progress: Row | null;
  annotationsDirty: number;
  /** Optional because snapshots taken before migration 6 lack them. */
  bookmarks?: Row[];
  bookmarksDirty?: number;
  /** Optional because snapshots taken before migration 11 lack them. */
  noteMarkers?: Row[];
}

function takeSnapshot(db: DB, documentId: string): Snapshot {
  const all = (sql: string) => db.prepare(sql).all(documentId) as unknown as Row[];
  return {
    resources: all("SELECT * FROM resources WHERE document_id = ?"),
    resourcePages: all(
      "SELECT rp.* FROM resource_pages rp JOIN resources r ON r.id = rp.resource_id WHERE r.document_id = ?",
    ),
    annotations: all("SELECT * FROM annotations WHERE document_id = ?"),
    noteHighlights: all(
      "SELECT h.* FROM note_highlights h JOIN resources r ON r.id = h.resource_id WHERE r.document_id = ?",
    ),
    progress: (db.prepare("SELECT * FROM reading_progress WHERE document_id = ?").get(documentId) as Row | undefined) ?? null,
    annotationsDirty: (db.prepare("SELECT annotations_dirty AS d FROM documents WHERE id = ?").get(documentId) as { d: number }).d,
    bookmarks: all("SELECT * FROM bookmarks WHERE document_id = ?"),
    bookmarksDirty: (db.prepare("SELECT bookmarks_dirty AS d FROM documents WHERE id = ?").get(documentId) as { d: number }).d,
    noteMarkers: all("SELECT m.* FROM note_markers m JOIN resources r ON r.id = m.resource_id WHERE r.document_id = ?"),
  };
}

function insertRow(db: DB, table: string, row: Row): void {
  // Old snapshots may hold columns a later migration dropped (resources.marker_x/y, v10 → v11).
  const known = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
  const cols = Object.keys(row).filter((c) => known.has(c));
  db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(
    ...(cols.map((c) => row[c]) as (string | number | null)[]),
  );
}

// ---- History -------------------------------------------------------------------

interface HistoryRow {
  id: string;
  document_id: string;
  kind: "insert" | "delete" | "replace" | "ocr" | "save" | "rotate" | "move";
  label: string;
  params: string;
  snapshot: string;
  file_path: string;
  page_count_before: number;
  fingerprint_after: string;
  created_at: string;
}

export interface HistoryEntry {
  id: string;
  kind: HistoryRow["kind"];
  label: string;
  createdAt: string;
}

function historyDir(opts: EditorOptions, documentId: string) {
  return path.join(opts.dataDir, "history", documentId);
}

export function listHistory(db: DB, documentId: string): HistoryEntry[] {
  return (
    db
      .prepare("SELECT id, kind, label, created_at FROM document_history WHERE document_id = ? ORDER BY created_at DESC, rowid DESC")
      .all(documentId) as unknown as HistoryRow[]
  ).map((r) => ({ id: r.id, kind: r.kind, label: r.label, createdAt: r.created_at }));
}

async function pruneHistory(db: DB, opts: EditorOptions, documentId: string): Promise<void> {
  const rows = db
    .prepare("SELECT id, file_path FROM document_history WHERE document_id = ? ORDER BY created_at DESC, rowid DESC")
    .all(documentId) as unknown as { id: string; file_path: string }[];
  for (const r of rows.slice(opts.historyLimit)) {
    db.prepare("DELETE FROM document_history WHERE id = ?").run(r.id);
    await fs.rm(r.file_path, { force: true });
  }
}

// ---- Editing ---------------------------------------------------------------------

interface EditSpec {
  kind: HistoryRow["kind"];
  label: string;
  params: Record<string, unknown>;
  /** Changes the loaded PDF (saved with pdf-lib afterwards)... */
  mutate?: (pdf: PDFDocument) => Promise<void> | void;
  /** ...or produces the new file bytes directly (e.g. a PDF that OCRmyPDF wrote). */
  transformBytes?: (bytes: Buffer) => Promise<Uint8Array>;
  /** Remaps page-scoped data inside the same transaction as the file-state update. */
  afterWrite: (oldCount: number, newCount: number) => void;
}

/**
 * Read → modify → atomically write a library PDF, then update the database in one transaction.
 * The previous file version and the document's notes/annotations are stored as a history entry
 * so the edit can be undone. `expectedFingerprint` guards against overwriting a file that
 * changed on disk since the client loaded it.
 */
async function editFile(db: DB, opts: EditorOptions, id: string, expectedFingerprint: string | undefined, spec: EditSpec): Promise<EditResult> {
  return withLock(id, async () => {
    const { doc, file } = resolveDocumentFile(db, id);
    if (!canEditFile(doc.kind)) throw new HttpError(400, doc.kind === "slides" ? SLIDES_READ_ONLY : notPagesMessage(doc));
    try {
      await fs.access(file, FS.W_OK);
    } catch {
      throw new HttpError(403, "The PDF file is read-only; StudySpace cannot save changes to it.");
    }
    const currentFp = await fingerprintFile(file);
    if (expectedFingerprint && (expectedFingerprint !== doc.fingerprint || currentFp !== doc.fingerprint)) {
      throw new HttpError(409, "The PDF changed on disk since it was opened. Reload it and try again.");
    }
    const bytes = await fs.readFile(file);
    const pdf = await loadPdf(bytes);
    const oldCount = pdf.getPageCount();
    let out: Uint8Array;
    let newCount: number;
    if (spec.transformBytes) {
      out = await spec.transformBytes(bytes);
      newCount = (await loadPdf(out)).getPageCount();
    } else {
      await spec.mutate?.(pdf);
      out = await pdf.save();
      newCount = pdf.getPageCount();
    }

    // Keep the previous version for undo (and as a backup) before touching the original.
    let editId: string | null = null;
    let historyFile: string | null = null;
    if (opts.historyLimit > 0) {
      editId = randomUUID();
      await fs.mkdir(historyDir(opts, id), { recursive: true });
      historyFile = path.join(historyDir(opts, id), `${editId}.pdf`);
      await fs.writeFile(historyFile, bytes);
    }
    const snapshot = takeSnapshot(db, id);

    try {
      await writeFileAtomic(file, out);
    } catch (err) {
      if (historyFile) await fs.rm(historyFile, { force: true });
      throw err;
    }
    const st = await fs.stat(file);
    const fingerprint = await fingerprintFile(file);
    transaction(db, () => {
      updateDocumentFileState(db, id, { fingerprint, size: st.size, mtimeMs: Math.floor(st.mtimeMs), pageCount: newCount });
      spec.afterWrite(oldCount, newCount);
      if (editId && historyFile) {
        db.prepare(
          `INSERT INTO document_history (id, document_id, kind, label, params, snapshot, file_path, page_count_before, fingerprint_after)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(editId, id, spec.kind, spec.label, JSON.stringify(spec.params), JSON.stringify(snapshot), historyFile, oldCount, fingerprint);
      }
    });
    await pruneHistory(db, opts, id);
    return { ...getDocument(db, id)!, editId };
  });
}

interface PageRow {
  id: number;
  resource_id: string;
  page_start: number;
  page_end: number;
  scope: string;
}

function resourcePageRows(db: DB, documentId: string): PageRow[] {
  return db
    .prepare(
      `SELECT rp.id, rp.resource_id, rp.page_start, rp.page_end, r.scope
       FROM resource_pages rp JOIN resources r ON r.id = rp.resource_id WHERE r.document_id = ?`,
    )
    .all(documentId) as unknown as PageRow[];
}

function remapAfterInsert(db: DB, documentId: string, after: number, count: number): void {
  for (const row of resourcePageRows(db, documentId)) {
    const [s, e] = mapRangeAfterInsert(row.page_start, row.page_end, after, count);
    // A single-page resource stays on its page; only ranges can grow.
    const end = row.scope === "page" ? s : e;
    db.prepare("UPDATE resource_pages SET page_start = ?, page_end = ? WHERE id = ?").run(s, end, row.id);
  }
  for (const a of listAnnotations(db, documentId)) {
    const p = mapPageAfterInsert(a.page, after, count);
    if (p !== a.page) db.prepare("UPDATE annotations SET page = ? WHERE id = ?").run(p, a.id);
  }
  for (const m of listNoteMarkersForDocument(db, documentId)) {
    const p = mapPageAfterInsert(m.page, after, count);
    if (p !== m.page) db.prepare("UPDATE note_markers SET page = ? WHERE id = ?").run(p, m.id);
  }
  // Page objects keep their identity on insertion, so the file's own bookmarks stay correct.
  db.prepare("UPDATE bookmarks SET page = page + ? WHERE document_id = ? AND page > ?").run(count, documentId, after);
  const prog = getProgress(db, documentId);
  if (prog) saveProgress(db, documentId, mapPageAfterInsert(prog.page, after, count), prog.zoom);
}

/**
 * After deleting pages, every note/highlight keeps pointing at the same content: later pages shift
 * down, ranges shrink to their surviving pages. Items that lived only on deleted pages are never
 * moved onto a different page: they are deleted with the page (restorable via undo), or, with the
 * "document" policy, kept as whole-document resources.
 */
function remapAfterDelete(db: DB, documentId: string, map: DeletionMap, policy: OrphanPolicy): void {
  for (const row of resourcePageRows(db, documentId)) {
    const r = map.mapRange(row.page_start, row.page_end);
    if (r) {
      db.prepare("UPDATE resource_pages SET page_start = ?, page_end = ? WHERE id = ?").run(r[0], r[1], row.id);
    } else if (policy === "document") {
      setResourcePages(db, row.resource_id, null, null);
      db.prepare("UPDATE resources SET scope = 'document' WHERE id = ?").run(row.resource_id);
    } else {
      db.prepare("DELETE FROM resources WHERE id = ?").run(row.resource_id);
    }
  }
  for (const a of listAnnotations(db, documentId)) {
    const p = map.map(a.page);
    if (p === null) db.prepare("DELETE FROM annotations WHERE id = ?").run(a.id);
    else if (p !== a.page) db.prepare("UPDATE annotations SET page = ? WHERE id = ?").run(p, a.id);
  }
  // A marker goes with its page (undo brings it back); its note may live on.
  for (const m of listNoteMarkersForDocument(db, documentId)) {
    const p = map.map(m.page);
    if (p === null) db.prepare("DELETE FROM note_markers WHERE id = ?").run(m.id);
    else if (p !== m.page) db.prepare("UPDATE note_markers SET page = ? WHERE id = ?").run(p, m.id);
  }
  // A bookmark on a deleted page moves to the next surviving page. The file's copy of it now points at
  // a removed page, so the bookmarks need saving again.
  let brokenBookmarks = false;
  for (const b of db.prepare("SELECT id, page FROM bookmarks WHERE document_id = ?").all(documentId) as { id: string; page: number }[]) {
    const p = map.map(b.page);
    if (p === null) {
      brokenBookmarks = true;
      db.prepare("UPDATE bookmarks SET page = ?, top = NULL WHERE id = ?").run(map.nearest(b.page), b.id);
    } else if (p !== b.page) {
      db.prepare("UPDATE bookmarks SET page = ? WHERE id = ?").run(p, b.id);
    }
  }
  if (brokenBookmarks) setBookmarksDirty(db, documentId, true);
  const prog = getProgress(db, documentId);
  if (prog) saveProgress(db, documentId, map.nearest(prog.page), prog.zoom);
}

export function insertBlank(db: DB, opts: EditorOptions, id: string, after: number, count: number, fp?: string) {
  return editFile(db, opts, id, fp, {
    kind: "insert",
    label: count === 1 ? `Insert blank page after page ${after}` : `Insert ${count} blank pages after page ${after}`,
    params: { after, count },
    mutate: (pdf) => insertBlankPages(pdf, after, count),
    afterWrite: () => remapAfterInsert(db, id, after, count),
  });
}

export async function insertFromDocument(
  db: DB,
  opts: EditorOptions,
  id: string,
  input: { after: number; sourceDocumentId: string; fromPage: number; toPage: number },
  fp?: string,
) {
  const { doc: source, file: sourceFile } = resolveReadablePdf(db, opts.dataDir, input.sourceDocumentId);
  const sourcePdf = await loadPdf(await fs.readFile(sourceFile));
  const count = input.toPage - input.fromPage + 1;
  return editFile(db, opts, id, fp, {
    kind: "insert",
    label: `Insert ${count} page${count === 1 ? "" : "s"} from “${source.title}”`,
    params: { after: input.after, count },
    mutate: async (pdf) => {
      await insertPagesFrom(pdf, sourcePdf, input.after, input.fromPage, input.toPage);
    },
    afterWrite: () => remapAfterInsert(db, id, input.after, count),
  });
}

/**
 * Swaps pages for pages of another PDF, one for one. Page numbers don't change, so notes stay on
 * their pages. Highlights and drawings on the replaced pages were made on the old content; they are
 * removed (restorable via undo) unless `keepAnnotations` is set.
 */
export async function replaceFromDocument(
  db: DB,
  opts: EditorOptions,
  id: string,
  input: { page: number; sourceDocumentId: string; fromPage: number; toPage: number; keepAnnotations?: boolean },
  fp?: string,
) {
  const { doc: source, file: sourceFile } = resolveReadablePdf(db, opts.dataDir, input.sourceDocumentId);
  const sourcePdf = await loadPdf(await fs.readFile(sourceFile));
  const count = input.toPage - input.fromPage + 1;
  const last = input.page + count - 1;
  const what = count === 1 ? `page ${input.page}` : `pages ${input.page}–${last}`;
  const withWhat = count === 1 ? `page ${input.fromPage}` : `pages ${input.fromPage}–${input.toPage}`;
  return editFile(db, opts, id, fp, {
    kind: "replace",
    label: `Replace ${what} with ${withWhat} of “${source.title}”`,
    params: { page: input.page, count },
    mutate: async (pdf) => {
      await replacePagesFrom(pdf, sourcePdf, input.page, input.fromPage, input.toPage);
    },
    afterWrite: () => {
      // The file's bookmarks pointing at the old pages broke; StudySpace's still point at these page numbers.
      const marked = db.prepare("SELECT 1 FROM bookmarks WHERE document_id = ? AND page BETWEEN ? AND ?").get(id, input.page, last);
      if (marked) setBookmarksDirty(db, id, true);
      const onReplaced = listAnnotations(db, id).filter((a) => a.page >= input.page && a.page <= last);
      if (!onReplaced.length) return;
      if (input.keepAnnotations) {
        // Any copies already saved into the file went away with the old pages.
        setAnnotationsDirty(db, id, true);
      } else {
        for (const a of onReplaced) db.prepare("DELETE FROM annotations WHERE id = ?").run(a.id);
      }
    },
  });
}

/** "page 3" / "pages 3–5" / "pages 1–3, 7" */
function pagesLabel(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    runs.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  if (runs.length > 4) return `${sorted.length} pages`;
  return `${sorted.length === 1 ? "page" : "pages"} ${runs.join(", ")}`;
}

/**
 * "Add to PDF" for an OCR result: replaces the library file with the OCRed copy, which has an
 * invisible text layer on the OCRed pages and is otherwise the same document. Refused when the file
 * changed after the OCR ran (the copy would undo that change). Undoable like every file edit.
 */
export function applyOcrLayer(db: DB, opts: EditorOptions, id: string, ocrBytes: Uint8Array, sourceFingerprint: string, pages: number[]) {
  return editFile(db, opts, id, sourceFingerprint, {
    kind: "ocr",
    label: `Add OCR text layer (${pagesLabel(pages)})`,
    params: { pages },
    transformBytes: async (current) => {
      const before = (await loadPdf(current)).getPageCount();
      const after = (await loadPdf(ocrBytes)).getPageCount();
      if (before !== after) throw new HttpError(409, "The OCR result doesn't match this PDF any more. Run OCR again.");
      return ocrBytes;
    },
    afterWrite: () => undefined,
  });
}

export function removePages(db: DB, opts: EditorOptions, id: string, pages: number[], fp?: string, policy: OrphanPolicy = "delete") {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  return editFile(db, opts, id, fp, {
    kind: "delete",
    label: sorted.length === 1 ? `Delete page ${sorted[0]}` : `Delete ${sorted.length} pages`,
    params: { pages: sorted },
    mutate: (pdf) => deletePages(pdf, sorted),
    afterWrite: (oldCount) => remapAfterDelete(db, id, new DeletionMap(sorted, oldCount), policy),
  });
}

/** Turns StudySpace's highlights and drawings on `pages` with the page, so they stay on their content. */
function rotateAnnotations(db: DB, documentId: string, pages: Set<number>, angle: number, only?: (id: string) => boolean): void {
  for (const a of listAnnotations(db, documentId)) {
    if (!pages.has(a.page) || (only && !only(a.id))) continue;
    db.prepare("UPDATE annotations SET rects = ?, paths = ? WHERE id = ?").run(
      JSON.stringify(a.rects.map((r) => rotateNormRect(r, angle))),
      JSON.stringify(a.paths.map((path) => path.map((pt) => rotateNormPoint(pt, angle)))),
      a.id,
    );
  }
}

/** Turns note markers on turned pages, like the annotations. */
function rotateMarkers(db: DB, documentId: string, pages: Set<number>, angle: number, only?: (id: string) => boolean): void {
  for (const m of listNoteMarkersForDocument(db, documentId)) {
    if (!pages.has(m.page) || (only && !only(m.id))) continue;
    const [x, y] = rotateNormPoint([m.x, m.y], angle);
    db.prepare("UPDATE note_markers SET x = ?, y = ? WHERE id = ?").run(x, y, m.id);
  }
}

/** Turns pages clockwise by 90, 180 or 270 degrees. Page numbers don't change. */
export function rotateDocumentPages(db: DB, opts: EditorOptions, id: string, pages: number[], angle: number, fp?: string) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const how = angle === 180 ? "upside down" : angle === 90 ? "right" : "left";
  return editFile(db, opts, id, fp, {
    kind: "rotate",
    label: `Turn ${pagesLabel(sorted)} ${how}`,
    params: { pages: sorted, angle },
    mutate: (pdf) => rotatePages(pdf, sorted, angle),
    afterWrite: () => {
      const set = new Set(sorted);
      rotateAnnotations(db, id, set, angle);
      rotateMarkers(db, id, set, angle);
      // A bookmark's spot on a turned page: flipped upside down, or (turned sideways) the top of the page.
      for (const b of db.prepare("SELECT id, page, top FROM bookmarks WHERE document_id = ? AND top IS NOT NULL").all(id) as {
        id: string;
        page: number;
        top: number;
      }[]) {
        if (set.has(b.page)) db.prepare("UPDATE bookmarks SET top = ? WHERE id = ?").run(angle === 180 ? 1 - b.top : null, b.id);
      }
    },
  });
}

/**
 * Moves pages (in their current order) to just after page `after` (0 = to the start). Notes,
 * highlights and bookmarks move with their pages.
 */
export function moveDocumentPages(db: DB, opts: EditorOptions, id: string, pages: number[], after: number, fp?: string) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (!sorted.length) throw new HttpError(400, "No pages given.");
  if (sorted.includes(after)) throw new HttpError(400, "Pages can't be moved to after one of themselves.");
  let order: number[] = [];
  return editFile(db, opts, id, fp, {
    kind: "move",
    label: `Move ${pagesLabel(sorted)} ${after === 0 ? "to the start" : `after page ${after}`}`,
    get params() {
      return { order };
    },
    mutate: (pdf) => {
      const n = pdf.getPageCount();
      if (sorted.some((p) => p < 1 || p > n) || after < 0 || after > n) throw new HttpError(400, `Pages must be within 1-${n}.`);
      order = orderAfterMove(sorted, after, n);
      if (order.every((old, i) => old === i + 1)) throw new HttpError(400, "The pages are already there.");
      reorderPages(pdf, order);
    },
    afterWrite: () => {
      const to = inverseOrder(order);
      const map = (p: number) => to.get(p) ?? p;
      for (const row of resourcePageRows(db, id)) {
        const mapped: number[] = [];
        for (let p = row.page_start; p <= row.page_end; p++) mapped.push(map(p));
        db.prepare("UPDATE resource_pages SET page_start = ?, page_end = ? WHERE id = ?").run(Math.min(...mapped), Math.max(...mapped), row.id);
      }
      for (const a of listAnnotations(db, id)) {
        if (map(a.page) !== a.page) db.prepare("UPDATE annotations SET page = ? WHERE id = ?").run(map(a.page), a.id);
      }
      for (const m of listNoteMarkersForDocument(db, id)) {
        if (map(m.page) !== m.page) db.prepare("UPDATE note_markers SET page = ? WHERE id = ?").run(map(m.page), m.id);
      }
      // The file's own outline points at page objects, which moved with their pages, so it stays right.
      for (const b of db.prepare("SELECT id, page FROM bookmarks WHERE document_id = ?").all(id) as { id: string; page: number }[]) {
        if (map(b.page) !== b.page) db.prepare("UPDATE bookmarks SET page = ? WHERE id = ?").run(map(b.page), b.id);
      }
      const prog = getProgress(db, id);
      if (prog) saveProgress(db, id, map(prog.page), prog.zoom);
    },
  });
}

const toOutline = (nodes: BookmarkNode[]): OutlineItem[] =>
  nodes.map((n) => ({ title: n.title, page: n.page, top: n.top, children: toOutline(n.children) }));

/**
 * "Save to PDF": writes the document's StudySpace annotations into the file as standard
 * Highlight/Ink annotations, and its bookmarks as the PDF outline. The outline is only rewritten once
 * the PDF's own outline has been read into StudySpace, so existing bookmarks are never lost.
 */
export function saveAnnotationsToFile(db: DB, opts: EditorOptions, id: string, fp?: string) {
  const withOutline = !!getDocument(db, id)?.outlineImported;
  return editFile(db, opts, id, fp, {
    kind: "save",
    label: "Save highlights and bookmarks into the PDF",
    params: {},
    mutate: (pdf) => {
      writeAnnotations(pdf, listAnnotations(db, id));
      if (withOutline) writeOutline(pdf, toOutline(bookmarkTree(db, id)));
    },
    afterWrite: () => {
      setAnnotationsDirty(db, id, false);
      if (withOutline) setBookmarksDirty(db, id, false);
    },
  });
}

// ---- Undo ----------------------------------------------------------------------------

/**
 * Undoes the most recent file edit of a document: restores the previous PDF and puts every note,
 * resource and highlight that existed before the edit back on its original page. Items created after
 * the edit are mapped back through the inverse page mapping. Only the latest edit can be undone.
 */
export async function undoEdit(db: DB, opts: EditorOptions, id: string, editId: string): Promise<DocumentRecord> {
  return withLock(id, async () => {
    const latest = db
      .prepare("SELECT * FROM document_history WHERE document_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(id) as unknown as HistoryRow | undefined;
    if (!latest) throw new HttpError(404, "Nothing to undo for this document.");
    if (latest.id !== editId) throw new HttpError(409, "Only the most recent change to this file can be undone.");

    const { file } = resolveDocumentFile(db, id);
    const currentFp = await fingerprintFile(file);
    if (currentFp !== latest.fingerprint_after) {
      throw new HttpError(409, "The PDF was changed by another program after this edit, so it can't be undone safely.");
    }
    const previous = await fs.readFile(latest.file_path).catch(() => {
      throw new HttpError(410, "The saved previous version of this file is missing.");
    });
    await writeFileAtomic(file, previous);
    const st = await fs.stat(file);
    const fingerprint = await fingerprintFile(file);

    const params = JSON.parse(latest.params) as { after?: number; count?: number; pages?: number[]; order?: number[]; angle?: number };
    const snap = JSON.parse(latest.snapshot) as Snapshot;
    const unmap = (p: number): number | null => {
      if (latest.kind === "insert") return unmapPageAfterInsert(p, params.after!, params.count!);
      if (latest.kind === "delete") return unmapPageAfterDelete(p, params.pages!, latest.page_count_before);
      if (latest.kind === "move") return params.order![p - 1] ?? p;
      return p;
    };

    transaction(db, () => {
      updateDocumentFileState(db, id, { fingerprint, size: st.size, mtimeMs: Math.floor(st.mtimeMs), pageCount: latest.page_count_before });

      // Resources: anything that existed before the edit gets its original scope/pages back
      // (and is recreated if the edit removed it). Newer ones are mapped back page by page.
      const snapIds = new Set(snap.resources.map((r) => r.id as string));
      for (const row of resourcePageRows(db, id)) {
        if (snapIds.has(row.resource_id)) continue;
        const pages: number[] = [];
        for (let p = row.page_start; p <= row.page_end; p++) {
          const o = unmap(p);
          if (o !== null) pages.push(o);
        }
        if (pages.length) {
          db.prepare("UPDATE resource_pages SET page_start = ?, page_end = ? WHERE id = ?").run(Math.min(...pages), Math.max(...pages), row.id);
        } else {
          // Written on a page that the undo removes: keep it, as a whole-document note.
          setResourcePages(db, row.resource_id, null, null);
          db.prepare("UPDATE resources SET scope = 'document' WHERE id = ?").run(row.resource_id);
        }
      }
      for (const r of snap.resources) {
        const exists = db.prepare("SELECT 1 FROM resources WHERE id = ?").get(r.id as string);
        if (exists) db.prepare("UPDATE resources SET scope = ? WHERE id = ?").run(r.scope as string, r.id as string);
        else insertRow(db, "resources", r);
        db.prepare("DELETE FROM resource_pages WHERE resource_id = ?").run(r.id as string);
      }
      for (const rp of snap.resourcePages) insertRow(db, "resource_pages", rp);
      // Highlights inside notes that the edit removed (with their note) come back too.
      for (const h of snap.noteHighlights ?? []) {
        const gone = !db.prepare("SELECT 1 FROM note_highlights WHERE id = ?").get(h.id as string);
        if (gone) insertRow(db, "note_highlights", h);
      }

      // Annotations: restore the pre-edit ones exactly; map newer ones back, dropping those drawn on
      // pages that the undo removes.
      const snapAnn = new Set(snap.annotations.map((a) => a.id as string));
      for (const a of listAnnotations(db, id)) {
        if (snapAnn.has(a.id)) continue;
        const p = unmap(a.page);
        if (p === null) db.prepare("DELETE FROM annotations WHERE id = ?").run(a.id);
        else if (p !== a.page) db.prepare("UPDATE annotations SET page = ? WHERE id = ?").run(p, a.id);
      }
      for (const a of snap.annotations) insertRow(db, "annotations", a);
      // Drawn on a turned page after the turn: turn back with it.
      if (latest.kind === "rotate") rotateAnnotations(db, id, new Set(params.pages), 360 - params.angle!, (aid) => !snapAnn.has(aid));

      // Note markers: the same as annotations (after the notes, which they belong to, are back).
      if (snap.noteMarkers) {
        const snapMarkers = new Set(snap.noteMarkers.map((m) => m.id as string));
        for (const m of listNoteMarkersForDocument(db, id)) {
          if (snapMarkers.has(m.id)) continue;
          const p = unmap(m.page);
          if (p === null) db.prepare("DELETE FROM note_markers WHERE id = ?").run(m.id);
          else if (p !== m.page) db.prepare("UPDATE note_markers SET page = ? WHERE id = ?").run(p, m.id);
        }
        for (const m of snap.noteMarkers) insertRow(db, "note_markers", m);
        if (latest.kind === "rotate") rotateMarkers(db, id, new Set(params.pages), 360 - params.angle!, (mid) => !snapMarkers.has(mid));
      }

      // Bookmarks: back to how they were before the edit; newer ones are kept, mapped back. (Rows are
      // re-inserted parent-first; INSERT OR REPLACE on a parent would cascade-delete its children.)
      let newerBookmarks = 0;
      if (snap.bookmarks) {
        const snapIds = new Set(snap.bookmarks.map((b) => b.id as string));
        const newer = (db.prepare("SELECT * FROM bookmarks WHERE document_id = ?").all(id) as unknown as Row[])
          .filter((b) => !snapIds.has(b.id as string))
          .map((b): Row => ({ ...b, page: Math.min(unmap(b.page as number) ?? (b.page as number), latest.page_count_before) }));
        newerBookmarks = newer.length;
        db.prepare("DELETE FROM bookmarks WHERE document_id = ?").run(id);
        const rows = new Map<string, Row>([...snap.bookmarks, ...newer].map((b) => [b.id as string, { ...b }]));
        const inserted = new Set<string>();
        const put = (b: Row) => {
          if (inserted.has(b.id as string)) return;
          inserted.add(b.id as string);
          const parent = b.parent_id ? rows.get(b.parent_id as string) : undefined;
          if (parent) put(parent);
          else b.parent_id = null;
          insertRow(db, "bookmarks", b);
        };
        for (const b of rows.values()) put(b);
      }

      if (snap.progress) insertRow(db, "reading_progress", snap.progress);
      setAnnotationsDirty(db, id, latest.kind === "save" ? true : snap.annotationsDirty === 1);
      if (snap.bookmarks) setBookmarksDirty(db, id, latest.kind === "save" || snap.bookmarksDirty === 1 || newerBookmarks > 0);
      db.prepare("DELETE FROM document_history WHERE id = ?").run(latest.id);
    });
    await fs.rm(latest.file_path, { force: true });
    return getDocument(db, id)!;
  });
}
