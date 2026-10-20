import { randomUUID } from "node:crypto";
import { transaction, type DB } from "./index.js";
import type { Resource, ResourceScope, ResourceType } from "../types.js";

interface Row {
  id: string;
  document_id: string;
  type: ResourceType;
  scope: ResourceScope;
  title: string;
  content: string;
  url: string | null;
  styles: string;
  created_at: string;
  updated_at: string;
  page_start: number | null;
  page_end: number | null;
}

function map(r: Row): Resource {
  return {
    id: r.id,
    documentId: r.document_id,
    type: r.type,
    scope: r.scope,
    pageStart: r.scope === "document" ? null : r.page_start,
    pageEnd: r.scope === "document" ? null : r.page_end,
    title: r.title,
    content: r.content,
    url: r.url,
    styles: parseStyles(r.styles),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function parseStyles(raw: string): Record<string, string> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const SELECT = `
  SELECT r.*, rp.page_start, rp.page_end
  FROM resources r
  LEFT JOIN resource_pages rp ON rp.resource_id = r.id`;

const ORDER = "ORDER BY CASE r.scope WHEN 'page' THEN 0 WHEN 'range' THEN 1 ELSE 2 END, r.created_at";

export interface ResourceInput {
  /** Optional client-chosen id (lets undo/redo recreate a deleted resource with the same identity). */
  id?: string;
  type: ResourceType;
  scope: ResourceScope;
  pageStart?: number | null;
  pageEnd?: number | null;
  title?: string;
  content?: string;
  url?: string | null;
  styles?: Record<string, string>;
}

/** Normalises scope/page fields: a page scope has start == end, a range has start <= end, document has none. */
export function normaliseScope(input: {
  scope: ResourceScope;
  pageStart?: number | null;
  pageEnd?: number | null;
}): { scope: ResourceScope; pageStart: number | null; pageEnd: number | null } {
  if (input.scope === "document") return { scope: "document", pageStart: null, pageEnd: null };
  const start = input.pageStart;
  if (start == null || !Number.isInteger(start) || start < 1) throw new Error("pageStart must be a positive integer");
  if (input.scope === "page") return { scope: "page", pageStart: start, pageEnd: start };
  const end = input.pageEnd ?? start;
  if (!Number.isInteger(end) || end < 1) throw new Error("pageEnd must be a positive integer");
  const [a, b] = start <= end ? [start, end] : [end, start];
  return { scope: "range", pageStart: a, pageEnd: b };
}

export function getResource(db: DB, id: string): Resource | undefined {
  const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as unknown as Row | undefined;
  return row && map(row);
}

export function listResources(db: DB, documentId: string): Resource[] {
  return (db.prepare(`${SELECT} WHERE r.document_id = ? ${ORDER}`).all(documentId) as unknown as Row[]).map(map);
}

/** Resources relevant to a page: those whose page range covers it, plus document-wide ones. */
export function listResourcesForPage(db: DB, documentId: string, page: number): Resource[] {
  return (
    db
      .prepare(
        `${SELECT}
         WHERE r.document_id = ?
           AND (r.scope = 'document' OR (rp.page_start <= ? AND rp.page_end >= ?))
         ${ORDER}`,
      )
      .all(documentId, page, page) as unknown as Row[]
  ).map(map);
}

export function createResource(db: DB, documentId: string, input: ResourceInput): Resource {
  const scope = normaliseScope(input);
  const id = input.id ?? randomUUID();
  if (input.id && getResource(db, input.id)) throw new Error("A resource with this id already exists");
  transaction(db, () => {
    db.prepare("INSERT INTO resources (id, document_id, type, scope, title, content, url, styles) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      id,
      documentId,
      input.type,
      scope.scope,
      input.title ?? "",
      input.content ?? "",
      input.url ?? null,
      JSON.stringify(input.styles ?? {}),
    );
    if (scope.scope !== "document") {
      db.prepare("INSERT INTO resource_pages (resource_id, page_start, page_end) VALUES (?, ?, ?)").run(
        id,
        scope.pageStart,
        scope.pageEnd,
      );
    }
  });
  return getResource(db, id)!;
}

export function updateResource(db: DB, id: string, patch: Partial<ResourceInput>): Resource | undefined {
  const cur = getResource(db, id);
  if (!cur) return undefined;
  const scopeChanged = patch.scope !== undefined || patch.pageStart !== undefined || patch.pageEnd !== undefined;
  const scope = normaliseScope({
    scope: patch.scope ?? cur.scope,
    pageStart: patch.pageStart !== undefined ? patch.pageStart : cur.pageStart,
    pageEnd: patch.pageEnd !== undefined ? patch.pageEnd : cur.pageEnd,
  });
  transaction(db, () => {
    db.prepare(
      `UPDATE resources SET type = ?, scope = ?, title = ?, content = ?, url = ?, styles = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
    ).run(
      patch.type ?? cur.type,
      scope.scope,
      patch.title ?? cur.title,
      patch.content ?? cur.content,
      patch.url !== undefined ? patch.url : cur.url,
      JSON.stringify(patch.styles ?? cur.styles),
      id,
    );
    if (scopeChanged) setResourcePages(db, id, scope.pageStart, scope.pageEnd);
  });
  return getResource(db, id);
}

/** Replaces a resource's page association (null start = document-wide). Does not touch `scope`. */
export function setResourcePages(db: DB, id: string, start: number | null, end: number | null): void {
  db.prepare("DELETE FROM resource_pages WHERE resource_id = ?").run(id);
  if (start != null && end != null) {
    db.prepare("INSERT INTO resource_pages (resource_id, page_start, page_end) VALUES (?, ?, ?)").run(id, start, end);
  }
}

export function deleteResource(db: DB, id: string): boolean {
  return Number(db.prepare("DELETE FROM resources WHERE id = ?").run(id).changes) > 0;
}

export function searchResources(db: DB, q: string, limit = 30): (Resource & { documentTitle: string })[] {
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db
    .prepare(
      `SELECT r.*, rp.page_start, rp.page_end, d.title AS document_title
       FROM resources r
       JOIN documents d ON d.id = r.document_id
       LEFT JOIN resource_pages rp ON rp.resource_id = r.id
       WHERE r.title LIKE ? ESCAPE '\\' OR r.content LIKE ? ESCAPE '\\' OR r.url LIKE ? ESCAPE '\\'
       ORDER BY r.updated_at DESC
       LIMIT ?`,
    )
    .all(like, like, like, limit) as unknown as (Row & { document_title: string })[];
  return rows.map((r) => ({ ...map(r), documentTitle: r.document_title }));
}
