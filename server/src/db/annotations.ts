import { randomUUID } from "node:crypto";
import type { DB } from "./index.js";
import { setAnnotationsDirty } from "./documents.js";
import type { Annotation, AnnotationKind, NormPoint, NormRect } from "../types.js";

interface Row {
  id: string;
  document_id: string;
  page: number;
  kind: AnnotationKind;
  color: string;
  opacity: number;
  rects: string;
  paths: string;
  stroke_width: number;
  text: string;
  created_at: string;
  updated_at: string;
}

function map(r: Row): Annotation {
  return {
    id: r.id,
    documentId: r.document_id,
    page: r.page,
    kind: r.kind,
    color: r.color,
    opacity: r.opacity,
    rects: JSON.parse(r.rects) as NormRect[],
    paths: JSON.parse(r.paths) as NormPoint[][],
    strokeWidth: r.stroke_width,
    text: r.text,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface AnnotationInput {
  /** Optional client-chosen id (lets undo/redo recreate an erased annotation with the same identity). */
  id?: string;
  page: number;
  kind: AnnotationKind;
  color: string;
  opacity?: number;
  rects?: NormRect[];
  paths?: NormPoint[][];
  strokeWidth?: number;
  text?: string;
}

export function listAnnotations(db: DB, documentId: string): Annotation[] {
  return (
    db.prepare("SELECT * FROM annotations WHERE document_id = ? ORDER BY page, created_at").all(documentId) as unknown as Row[]
  ).map(map);
}

export function getAnnotation(db: DB, id: string): Annotation | undefined {
  const row = db.prepare("SELECT * FROM annotations WHERE id = ?").get(id) as unknown as Row | undefined;
  return row && map(row);
}

export function createAnnotation(db: DB, documentId: string, a: AnnotationInput): Annotation {
  const id = a.id ?? randomUUID();
  if (a.id && getAnnotation(db, a.id)) throw new Error("An annotation with this id already exists");
  db.prepare(
    `INSERT INTO annotations (id, document_id, page, kind, color, opacity, rects, paths, stroke_width, text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    documentId,
    a.page,
    a.kind,
    a.color,
    a.opacity ?? (a.kind === "ink" || a.kind === "text" ? 1 : 0.4),
    JSON.stringify(a.rects ?? []),
    JSON.stringify(a.paths ?? []),
    a.strokeWidth ?? 0.003,
    a.text ?? "",
  );
  setAnnotationsDirty(db, documentId, true);
  return getAnnotation(db, id)!;
}

export function updateAnnotation(
  db: DB,
  id: string,
  patch: Partial<Pick<AnnotationInput, "color" | "opacity" | "text" | "rects" | "strokeWidth">>,
): Annotation | undefined {
  const cur = getAnnotation(db, id);
  if (!cur) return undefined;
  db.prepare(
    `UPDATE annotations SET color = ?, opacity = ?, text = ?, rects = ?, stroke_width = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  ).run(
    patch.color ?? cur.color,
    patch.opacity ?? cur.opacity,
    patch.text ?? cur.text,
    JSON.stringify(patch.rects ?? cur.rects),
    patch.strokeWidth ?? cur.strokeWidth,
    id,
  );
  setAnnotationsDirty(db, cur.documentId, true);
  return getAnnotation(db, id);
}

export function deleteAnnotation(db: DB, id: string): boolean {
  const cur = getAnnotation(db, id);
  if (!cur) return false;
  db.prepare("DELETE FROM annotations WHERE id = ?").run(id);
  setAnnotationsDirty(db, cur.documentId, true);
  return true;
}
