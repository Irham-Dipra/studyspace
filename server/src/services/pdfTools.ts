import fs from "node:fs/promises";
import { constants as FS } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PDFDocument } from "pdf-lib";
import { transaction, type DB } from "../db/index.js";
import { listDirectories } from "../db/directories.js";
import { getDocument, getDocumentByPath, insertDocument, setAnnotationsDirty, setPageCount, updateDocumentLocation } from "../db/documents.js";
import { bookmarkTree, type BookmarkNode } from "../db/bookmarks.js";
import { createAnnotation, listAnnotations } from "../db/annotations.js";
import { createResource, listResources } from "../db/resources.js";
import { createNoteMarker, listNoteMarkersForDocument } from "../db/noteMarkers.js";
import { createNoteHighlight, listNoteHighlightsForDocument } from "../db/noteHighlights.js";
import { fingerprintFile } from "../library/fingerprint.js";
import { isWithin, resolveInsideRoots } from "../library/pathGuard.js";
import { ALWAYS_SKIP, isExcluded } from "../library/scanner.js";
import { composePdf, loadPdf, writeOutline, type OutlineItem } from "../pdf/operations.js";
import { resolveReadablePdf } from "./documentEditor.js";
import { writeFileAtomic } from "./fileWriter.js";
import { HttpError, type Directory, type DocumentRecord } from "../types.js";

/** Pages of one library PDF, in the order they go into the new file. */
export interface SegmentSpec {
  documentId: string;
  /** Leave out (or empty) for every page. */
  pages?: number[];
  /** Title of this part's bookmark when `bookmarkPerSource` is on (defaults to the source's title). */
  title?: string;
}

export interface OutputSpec {
  /** File name; ".pdf" is added, and " (2)", " (3)"… when a file with that name already exists. */
  name: string;
  segments: SegmentSpec[];
}

export interface CreateRequest {
  /** Existing folder inside a library folder. */
  folder: string;
  /** Optional new sub-folder of `folder` to create and save into. */
  newFolder?: string;
  outputs: OutputSpec[];
  /** Copy notes and resources on the copied pages (with their highlights) to the new PDFs. */
  copyNotes: boolean;
  /** Copy StudySpace highlights and drawings on the copied pages. */
  copyHighlights: boolean;
  /** Carry the bookmarks of the copied pages into the new PDF's outline. */
  copyBookmarks: boolean;
  /** Start each source's pages with a bookmark named after it (useful when merging). */
  bookmarkPerSource: boolean;
}

export interface CreateResult {
  folder: string;
  documents: DocumentRecord[];
}

const MAX_OUTPUTS = 500;
const MAX_PAGES = 20000;

/** A safe single path segment: no separators, no control characters, not "." / "..", not hidden. */
export function safeFileName(name: string, what = "file name"): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 180)
    .trim();
  if (!clean || clean === "." || clean === "..") throw new HttpError(400, `Please give a ${what}.`);
  return clean;
}

/** The enabled library folder a real path lies in (the first one, like the library scan) and the folder relative to it. */
function libraryFolderFor(db: DB, realDir: string): { dir: Directory; relDir: string } {
  for (const dir of listDirectories(db).filter((d) => d.enabled)) {
    const root = resolveInsideRoots(dir.path, [dir.path]);
    if (!root || !isWithin(root, realDir)) continue;
    const relDir = path.relative(root, realDir).split(path.sep).filter(Boolean).join("/");
    if (relDir && isExcluded(relDir, dir.excludes)) {
      throw new HttpError(400, "That folder is excluded from your library, so new PDFs there wouldn't show up. Pick another folder.");
    }
    return { dir, relDir };
  }
  throw new HttpError(403, "New PDFs can only be saved inside one of your library folders.");
}

/** Resolves (and optionally creates) the destination folder, which must be inside a library folder. */
async function resolveFolder(db: DB, folder: string, newFolder?: string): Promise<{ dir: Directory; relDir: string }> {
  const roots = listDirectories(db)
    .filter((d) => d.enabled)
    .map((d) => d.path);
  let real = resolveInsideRoots(folder, roots);
  if (!real) throw new HttpError(403, "New PDFs can only be saved inside one of your library folders.");
  if (!(await fs.stat(real)).isDirectory()) throw new HttpError(400, "That is not a folder.");
  if (newFolder?.trim()) {
    const target = path.join(real, safeFileName(newFolder, "folder name"));
    await fs.mkdir(target, { recursive: true });
    real = resolveInsideRoots(target, roots);
    if (!real) throw new HttpError(403, "New PDFs can only be saved inside one of your library folders.");
  }
  try {
    await fs.access(real, FS.W_OK);
  } catch {
    throw new HttpError(403, "StudySpace can't write to that folder.");
  }
  return libraryFolderFor(db, real);
}

/** Reserves `<name>.pdf` in `dir`, or `<name> (2).pdf`… if taken. Never overwrites an existing file. */
async function reserveFile(dir: string, name: string, taken: Set<string>): Promise<string> {
  const base = safeFileName(name.replace(/\.pdf$/i, ""));
  for (let i = 1; i < 1000; i++) {
    const file = path.join(dir, `${base}${i === 1 ? "" : ` (${i})`}.pdf`);
    if (taken.has(file.toLowerCase())) continue;
    try {
      await (await fs.open(file, "wx")).close();
      taken.add(file.toLowerCase());
      return file;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new HttpError(409, `Too many files named “${base}” already.`);
}

/** Bookmarks of the copied pages, re-pointed at their new page numbers. Bookmarks on pages left out are dropped (their children kept). */
function carryBookmarks(nodes: BookmarkNode[], pageMap: Map<number, number>): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const n of nodes) {
    const children = carryBookmarks(n.children, pageMap);
    const page = pageMap.get(n.page);
    if (page) out.push({ title: n.title, page, top: n.top, children });
    else out.push(...children);
  }
  return out;
}

/**
 * Creates new PDFs from pages of library PDFs (extract, split, merge) in a library folder and adds
 * them to the library. The source files are only read. The new files get the copied pages' notes,
 * highlights and bookmarks as asked.
 */
export async function createPdfs(db: DB, req: CreateRequest, dataDir: string): Promise<CreateResult> {
  if (!req.outputs.length) throw new HttpError(400, "Nothing to create.");
  if (req.outputs.length > MAX_OUTPUTS) throw new HttpError(400, `At most ${MAX_OUTPUTS} files at once.`);
  const { dir, relDir } = await resolveFolder(db, req.folder, req.newFolder);
  // Store paths under the library folder as configured (like the library scan does), not the resolved real path.
  const folderPath = path.join(dir.path, ...relDir.split("/").filter(Boolean));

  // Each source PDF is read once.
  const sources = new Map<string, { doc: DocumentRecord; pdf: PDFDocument }>();
  for (const o of req.outputs) {
    for (const s of o.segments) {
      if (sources.has(s.documentId)) continue;
      const { doc, file } = resolveReadablePdf(db, dataDir, s.documentId);
      sources.set(s.documentId, { doc, pdf: await loadPdf(await fs.readFile(file)) });
    }
  }
  const allPages = (id: string) => Array.from({ length: sources.get(id)!.pdf.getPageCount() }, (_, i) => i + 1);
  const outputs = req.outputs.map((o) => ({
    name: o.name,
    segments: o.segments.map((s) => ({ ...s, pages: s.pages?.length ? s.pages : allPages(s.documentId) })),
  }));
  const totalPages = outputs.reduce((n, o) => n + o.segments.reduce((m, s) => m + s.pages.length, 0), 0);
  if (totalPages > MAX_PAGES) throw new HttpError(400, `At most ${MAX_PAGES} pages at once.`);

  // Checked before anything is written: a hidden file would vanish from the library on the next scan.
  for (const o of outputs) {
    const name = safeFileName(o.name.replace(/\.pdf$/i, ""));
    if (isExcluded([relDir, `${name}.pdf`].filter(Boolean).join("/"), dir.excludes)) {
      throw new HttpError(400, `“${name}.pdf” would be hidden by this library folder's settings. Pick another name or folder.`);
    }
  }

  const taken = new Set<string>();
  const written: string[] = [];
  const created: DocumentRecord[] = [];
  try {
    for (const o of outputs) {
      const segments = o.segments;
      const name = safeFileName(o.name.replace(/\.pdf$/i, ""));
      const pdf = await composePdf(
        segments.map((s) => ({ source: sources.get(s.documentId)!.pdf, pages: s.pages })),
        { title: name, keepStudySpaceAnnotations: req.copyHighlights },
      );

      // Where every copied page ends up: one map per segment (the same source may appear twice).
      let next = 1;
      const maps = segments.map((s) => {
        const m = new Map<number, number>();
        for (const p of s.pages) {
          if (!m.has(p)) m.set(p, next);
          next++;
        }
        return m;
      });

      const outline: OutlineItem[] = [];
      segments.forEach((s, i) => {
        const src = sources.get(s.documentId)!.doc;
        const carried = req.copyBookmarks ? carryBookmarks(bookmarkTree(db, s.documentId), maps[i]) : [];
        if (req.bookmarkPerSource) {
          outline.push({ title: (s.title?.trim() || src.title).slice(0, 1000), page: maps[i].get(s.pages[0])!, top: null, children: carried });
        } else {
          outline.push(...carried);
        }
      });
      if (outline.length) writeOutline(pdf, outline);

      const file = await reserveFile(folderPath, name, taken);
      written.push(file);
      await writeFileAtomic(file, await pdf.save());
      const st = await fs.stat(file);
      const fingerprint = await fingerprintFile(file);

      const loc = {
        directoryId: dir.id,
        path: file,
        relPath: [relDir, path.basename(file)].filter(Boolean).join("/"),
        title: path.basename(file, ".pdf"),
        fingerprint,
        size: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
      };
      // A library scan that ran while the file was being written may have added it already.
      const id = getDocumentByPath(db, file)?.id ?? randomUUID();
      transaction(db, () => {
        if (getDocument(db, id)) updateDocumentLocation(db, id, loc);
        else insertDocument(db, { id, ...loc });
        setPageCount(db, id, pdf.getPageCount());
        let highlightsUnsaved = false;
        segments.forEach((s, i) => {
          const map = maps[i];
          if (req.copyNotes) copyNotes(db, s.documentId, id, map);
          if (req.copyHighlights) {
            for (const a of listAnnotations(db, s.documentId)) {
              const page = map.get(a.page);
              if (!page) continue;
              createAnnotation(db, id, { page, kind: a.kind, color: a.color, opacity: a.opacity, rects: a.rects, paths: a.paths, strokeWidth: a.strokeWidth, text: a.text });
              // Saved highlights came along inside the copied pages; unsaved ones still need saving.
              if (sources.get(s.documentId)!.doc.annotationsDirty) highlightsUnsaved = true;
            }
          }
        });
        setAnnotationsDirty(db, id, highlightsUnsaved);
      });
      created.push(getDocument(db, id)!);
    }
  } catch (err) {
    // Leave nothing half-made: remove this request's files and library entries.
    for (const d of created) db.prepare("DELETE FROM documents WHERE id = ?").run(d.id);
    for (const f of written) await fs.rm(f, { force: true });
    throw err;
  }
  return { folder: folderPath, documents: created };
}

/** Copies a source's page and range notes that touch the copied pages, scoped to their new pages. */
function copyNotes(db: DB, fromDoc: string, toDoc: string, map: Map<number, number>): void {
  const highlights = listNoteHighlightsForDocument(db, fromDoc);
  const markers = listNoteMarkersForDocument(db, fromDoc);
  for (const r of listResources(db, fromDoc)) {
    if (r.scope === "document" || r.pageStart === null || r.pageEnd === null) continue;
    const pages: number[] = [];
    for (let p = r.pageStart; p <= r.pageEnd; p++) {
      const n = map.get(p);
      if (n) pages.push(n);
    }
    if (!pages.length) continue;
    const start = Math.min(...pages);
    const end = Math.max(...pages);
    const copy = createResource(db, toDoc, {
      type: r.type,
      scope: start === end ? "page" : "range",
      pageStart: start,
      pageEnd: end,
      title: r.title,
      content: r.content,
      url: r.url,
      styles: r.styles,
    });
    // Markers on copied pages come along, on their new page numbers.
    for (const m of markers.filter((x) => x.resourceId === r.id)) {
      const p = map.get(m.page);
      if (p) createNoteMarker(db, copy.id, { page: p, x: m.x, y: m.y, quote: m.quote, prefix: m.prefix, suffix: m.suffix });
    }
    for (const h of highlights.filter((x) => x.resourceId === r.id)) {
      createNoteHighlight(db, copy.id, { color: h.color, quote: h.quote, prefix: h.prefix, suffix: h.suffix, comment: h.comment });
    }
  }
}

/** Sub-folders of the library folders (for choosing where new PDFs go). */
export async function listLibraryFolders(db: DB): Promise<{ path: string; label: string; depth: number }[]> {
  const out: { path: string; label: string; depth: number }[] = [];
  const LIMIT = 5000;
  for (const dir of listDirectories(db).filter((d) => d.enabled)) {
    const walk = async (abs: string, rel: string, depth: number): Promise<void> => {
      if (out.length >= LIMIT) return;
      out.push({ path: abs, label: rel ? `${dir.label}/${rel}` : dir.label, depth });
      let entries;
      try {
        entries = await fs.readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith(".") || ALWAYS_SKIP.has(e.name)) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (isExcluded(r, dir.excludes)) continue;
        await walk(path.join(abs, e.name), r, depth + 1);
      }
    };
    await walk(dir.path, "", 0);
  }
  return out;
}
