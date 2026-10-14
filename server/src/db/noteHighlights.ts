import { randomUUID } from "node:crypto";
import type { DB } from "./index.js";
import type { NoteHighlight } from "../types.js";

interface Row {
  id: string;
  resource_id: string;
  color: string;
  quote: string;
  prefix: string;
  suffix: string;
  comment: string;
  created_at: string;
  updated_at: string;
}

const map = (r: Row): NoteHighlight => ({
  id: r.id,
  resourceId: r.resource_id,
  color: r.color,
  quote: r.quote,
  prefix: r.prefix,
  suffix: r.suffix,
  comment: r.comment,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface NoteHighlightInput {
  /** Optional client-chosen id so undo/redo can recreate a removed highlight with the same identity. */
  id?: string;
  color: string;
  quote: string;
  prefix?: string;
  suffix?: string;
  comment?: string;
}

/** All note highlights for every resource of a document. */
export function listNoteHighlightsForDocument(db: DB, documentId: string): NoteHighlight[] {
  return (
    db
      .prepare(
        `SELECT h.* FROM note_highlights h JOIN resources r ON r.id = h.resource_id
         WHERE r.document_id = ? ORDER BY h.created_at`,
      )
      .all(documentId) as unknown as Row[]
  ).map(map);
}

export function getNoteHighlight(db: DB, id: string): NoteHighlight | undefined {
  const row = db.prepare("SELECT * FROM note_highlights WHERE id = ?").get(id) as unknown as Row | undefined;
  return row && map(row);
}

export function createNoteHighlight(db: DB, resourceId: string, input: NoteHighlightInput): NoteHighlight {
  const id = input.id ?? randomUUID();
  if (input.id && getNoteHighlight(db, input.id)) throw new Error("A highlight with this id already exists");
  db.prepare(
    "INSERT INTO note_highlights (id, resource_id, color, quote, prefix, suffix, comment) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, resourceId, input.color, input.quote, input.prefix ?? "", input.suffix ?? "", input.comment ?? "");
  return getNoteHighlight(db, id)!;
}

export function updateNoteHighlight(
  db: DB,
  id: string,
  patch: Partial<Pick<NoteHighlightInput, "color" | "comment">>,
): NoteHighlight | undefined {
  const cur = getNoteHighlight(db, id);
  if (!cur) return undefined;
  db.prepare(
    `UPDATE note_highlights SET color = ?, comment = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  ).run(patch.color ?? cur.color, patch.comment ?? cur.comment, id);
  return getNoteHighlight(db, id);
}

export function deleteNoteHighlight(db: DB, id: string): boolean {
  return Number(db.prepare("DELETE FROM note_highlights WHERE id = ?").run(id).changes) > 0;
}
