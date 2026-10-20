import { randomUUID } from "node:crypto";
import type { DB } from "./index.js";
import type { DocumentHighlight } from "../types.js";

interface Row {
  id: string;
  document_id: string;
  color: string;
  quote: string;
  prefix: string;
  suffix: string;
  comment: string;
  created_at: string;
  updated_at: string;
}

const map = (r: Row): DocumentHighlight => ({
  id: r.id,
  documentId: r.document_id,
  color: r.color,
  quote: r.quote,
  prefix: r.prefix,
  suffix: r.suffix,
  comment: r.comment,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface DocumentHighlightInput {
  /** Optional client-chosen id so undo/redo can recreate a removed highlight with the same identity. */
  id?: string;
  color: string;
  quote: string;
  prefix?: string;
  suffix?: string;
  comment?: string;
}

export function listDocumentHighlights(db: DB, documentId: string): DocumentHighlight[] {
  return (db.prepare("SELECT * FROM document_highlights WHERE document_id = ? ORDER BY created_at").all(documentId) as unknown as Row[]).map(map);
}

export function getDocumentHighlight(db: DB, id: string): DocumentHighlight | undefined {
  const row = db.prepare("SELECT * FROM document_highlights WHERE id = ?").get(id) as unknown as Row | undefined;
  return row && map(row);
}

export function createDocumentHighlight(db: DB, documentId: string, input: DocumentHighlightInput): DocumentHighlight {
  const id = input.id ?? randomUUID();
  if (input.id && getDocumentHighlight(db, input.id)) throw new Error("A highlight with this id already exists");
  db.prepare(
    "INSERT INTO document_highlights (id, document_id, color, quote, prefix, suffix, comment) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, documentId, input.color, input.quote, input.prefix ?? "", input.suffix ?? "", input.comment ?? "");
  return getDocumentHighlight(db, id)!;
}

export function updateDocumentHighlight(
  db: DB,
  id: string,
  patch: Partial<Pick<DocumentHighlightInput, "color" | "comment">>,
): DocumentHighlight | undefined {
  const cur = getDocumentHighlight(db, id);
  if (!cur) return undefined;
  db.prepare(
    `UPDATE document_highlights SET color = ?, comment = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  ).run(patch.color ?? cur.color, patch.comment ?? cur.comment, id);
  return getDocumentHighlight(db, id);
}

export function deleteDocumentHighlight(db: DB, id: string): boolean {
  return Number(db.prepare("DELETE FROM document_highlights WHERE id = ?").run(id).changes) > 0;
}
