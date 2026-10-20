import type { DB } from "./index.js";
import type { ReadingProgress } from "../types.js";

interface Row {
  document_id: string;
  page: number;
  zoom: number;
  top: number | null;
  updated_at: string;
}

const map = (r: Row): ReadingProgress => ({
  documentId: r.document_id,
  page: r.page,
  zoom: r.zoom,
  top: r.top,
  updatedAt: r.updated_at,
});

export function getProgress(db: DB, documentId: string): ReadingProgress | undefined {
  const row = db.prepare("SELECT * FROM reading_progress WHERE document_id = ?").get(documentId) as unknown as
    | Row
    | undefined;
  return row && map(row);
}

/** `top` left out keeps the stored one (page edits only move the page). */
export function saveProgress(db: DB, documentId: string, page: number, zoom: number, top?: number | null): ReadingProgress {
  db.prepare(
    `INSERT INTO reading_progress (document_id, page, zoom, top) VALUES (?, ?, ?, ?)
     ON CONFLICT(document_id) DO UPDATE SET page = excluded.page, zoom = excluded.zoom,
       top = ${top === undefined ? "reading_progress.top" : "excluded.top"},
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).run(documentId, page, zoom, top ?? null);
  return getProgress(db, documentId)!;
}

export function recentDocuments(db: DB, limit = 8): (ReadingProgress & { title: string })[] {
  const rows = db
    .prepare(
      `SELECT p.*, d.title FROM reading_progress p JOIN documents d ON d.id = p.document_id
       WHERE d.missing = 0 ORDER BY p.updated_at DESC LIMIT ?`,
    )
    .all(limit) as unknown as (Row & { title: string })[];
  return rows.map((r) => ({ ...map(r), title: r.title }));
}
