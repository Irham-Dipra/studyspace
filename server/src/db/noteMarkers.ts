import { randomUUID } from "node:crypto";
import type { DB } from "./index.js";
import type { NoteMarker } from "../types.js";

interface Row {
  id: string;
  resource_id: string;
  page: number;
  x: number;
  y: number;
  quote: string;
  prefix: string;
  suffix: string;
  created_at: string;
}

const map = (r: Row): NoteMarker => ({
  id: r.id,
  resourceId: r.resource_id,
  page: r.page,
  x: r.x,
  y: r.y,
  quote: r.quote,
  prefix: r.prefix,
  suffix: r.suffix,
  createdAt: r.created_at,
});

export interface NoteMarkerInput {
  /** Optional client-chosen id so undo/redo can recreate a removed marker with the same identity. */
  id?: string;
  page: number;
  x: number;
  y: number;
  quote?: string;
  prefix?: string;
  suffix?: string;
}

/** All markers of every note of a document. */
export function listNoteMarkersForDocument(db: DB, documentId: string): NoteMarker[] {
  return (
    db
      .prepare(
        `SELECT m.* FROM note_markers m JOIN resources r ON r.id = m.resource_id
         WHERE r.document_id = ? ORDER BY m.page, m.created_at`,
      )
      .all(documentId) as unknown as Row[]
  ).map(map);
}

export function getNoteMarker(db: DB, id: string): NoteMarker | undefined {
  const row = db.prepare("SELECT * FROM note_markers WHERE id = ?").get(id) as unknown as Row | undefined;
  return row && map(row);
}

export function createNoteMarker(db: DB, resourceId: string, input: NoteMarkerInput): NoteMarker {
  const id = input.id ?? randomUUID();
  if (input.id && getNoteMarker(db, input.id)) throw new Error("A marker with this id already exists");
  db.prepare("INSERT INTO note_markers (id, resource_id, page, x, y, quote, prefix, suffix) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    id,
    resourceId,
    input.page,
    input.x,
    input.y,
    input.quote ?? "",
    input.prefix ?? "",
    input.suffix ?? "",
  );
  return getNoteMarker(db, id)!;
}

/** Moves a marker (page, spot) or points it at another passage. */
export function updateNoteMarker(db: DB, id: string, patch: Partial<Omit<NoteMarkerInput, "id">>): NoteMarker | undefined {
  const cur = getNoteMarker(db, id);
  if (!cur) return undefined;
  db.prepare("UPDATE note_markers SET page = ?, x = ?, y = ?, quote = ?, prefix = ?, suffix = ? WHERE id = ?").run(
    patch.page ?? cur.page,
    patch.x ?? cur.x,
    patch.y ?? cur.y,
    patch.quote ?? cur.quote,
    patch.prefix ?? cur.prefix,
    patch.suffix ?? cur.suffix,
    id,
  );
  return getNoteMarker(db, id);
}

export function deleteNoteMarker(db: DB, id: string): boolean {
  return Number(db.prepare("DELETE FROM note_markers WHERE id = ?").run(id).changes) > 0;
}
