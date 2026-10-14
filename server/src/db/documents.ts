import type { DB } from "./index.js";
import type { DocumentRecord } from "../types.js";

interface Row {
  id: string;
  directory_id: number | null;
  path: string;
  rel_path: string;
  title: string;
  fingerprint: string;
  size: number;
  mtime_ms: number;
  page_count: number | null;
  missing: number;
  annotations_dirty: number;
  bookmarks_dirty: number;
  outline_imported: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

function map(r: Row): DocumentRecord {
  return {
    id: r.id,
    directoryId: r.directory_id,
    path: r.path,
    relPath: r.rel_path,
    title: r.title,
    fingerprint: r.fingerprint,
    size: r.size,
    mtimeMs: r.mtime_ms,
    pageCount: r.page_count,
    missing: r.missing === 1,
    annotationsDirty: r.annotations_dirty === 1,
    bookmarksDirty: r.bookmarks_dirty === 1,
    outlineImported: r.outline_imported === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastSeenAt: r.last_seen_at,
  };
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

export function listDocuments(db: DB, opts: { includeMissing?: boolean } = {}): DocumentRecord[] {
  const where = opts.includeMissing ? "" : "WHERE missing = 0";
  return (db.prepare(`SELECT * FROM documents ${where} ORDER BY rel_path COLLATE NOCASE`).all() as unknown as Row[]).map(
    map,
  );
}

export function getDocument(db: DB, id: string): DocumentRecord | undefined {
  const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(id) as unknown as Row | undefined;
  return row && map(row);
}

export function getDocumentByPath(db: DB, p: string): DocumentRecord | undefined {
  const row = db.prepare("SELECT * FROM documents WHERE path = ?").get(p) as unknown as Row | undefined;
  return row && map(row);
}

export function findDocumentsByFingerprint(db: DB, fingerprint: string): DocumentRecord[] {
  return (db.prepare("SELECT * FROM documents WHERE fingerprint = ?").all(fingerprint) as unknown as Row[]).map(map);
}

export function insertDocument(
  db: DB,
  d: Pick<DocumentRecord, "id" | "directoryId" | "path" | "relPath" | "title" | "fingerprint" | "size" | "mtimeMs">,
): DocumentRecord {
  db.prepare(
    `INSERT INTO documents (id, directory_id, path, rel_path, title, fingerprint, size, mtime_ms, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${NOW})`,
  ).run(d.id, d.directoryId, d.path, d.relPath, d.title, d.fingerprint, d.size, d.mtimeMs);
  return getDocument(db, d.id)!;
}

/** Records that a document was (re)discovered at a location, possibly after a rename/move or content change. */
export function updateDocumentLocation(
  db: DB,
  id: string,
  d: Pick<DocumentRecord, "directoryId" | "path" | "relPath" | "title" | "fingerprint" | "size" | "mtimeMs">,
): void {
  db.prepare(
    `UPDATE documents SET directory_id = ?, path = ?, rel_path = ?, title = ?, fingerprint = ?, size = ?, mtime_ms = ?,
       missing = 0, last_seen_at = ${NOW}, updated_at = ${NOW}
     WHERE id = ?`,
  ).run(d.directoryId, d.path, d.relPath, d.title, d.fingerprint, d.size, d.mtimeMs, id);
}

export function touchDocument(db: DB, id: string, directoryId: number | null, relPath: string): void {
  db.prepare(`UPDATE documents SET missing = 0, directory_id = ?, rel_path = ?, last_seen_at = ${NOW} WHERE id = ?`).run(
    directoryId,
    relPath,
    id,
  );
}

export function markDocumentsMissing(db: DB, keepIds: Set<string>): number {
  const rows = db.prepare("SELECT id FROM documents WHERE missing = 0").all() as unknown as { id: string }[];
  const stmt = db.prepare(`UPDATE documents SET missing = 1, updated_at = ${NOW} WHERE id = ?`);
  let n = 0;
  for (const r of rows) {
    if (!keepIds.has(r.id)) {
      stmt.run(r.id);
      n++;
    }
  }
  return n;
}

export function setPageCount(db: DB, id: string, pageCount: number): void {
  db.prepare("UPDATE documents SET page_count = ? WHERE id = ?").run(pageCount, id);
}

export function setBookmarksDirty(db: DB, id: string, dirty: boolean): void {
  db.prepare("UPDATE documents SET bookmarks_dirty = ? WHERE id = ?").run(dirty ? 1 : 0, id);
}

export function setAnnotationsDirty(db: DB, id: string, dirty: boolean): void {
  db.prepare("UPDATE documents SET annotations_dirty = ? WHERE id = ?").run(dirty ? 1 : 0, id);
}

/** Called after StudySpace rewrites a file so the next scan recognises it as the same document. */
export function updateDocumentFileState(
  db: DB,
  id: string,
  s: { fingerprint: string; size: number; mtimeMs: number; pageCount: number },
): void {
  db.prepare(
    `UPDATE documents SET fingerprint = ?, size = ?, mtime_ms = ?, page_count = ?, updated_at = ${NOW} WHERE id = ?`,
  ).run(s.fingerprint, s.size, s.mtimeMs, s.pageCount, id);
}

export function deleteDocument(db: DB, id: string): boolean {
  return Number(db.prepare("DELETE FROM documents WHERE id = ?").run(id).changes) > 0;
}
