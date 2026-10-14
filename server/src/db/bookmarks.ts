import { randomUUID } from "node:crypto";
import { transaction, type DB } from "./index.js";
import { setBookmarksDirty } from "./documents.js";
import { HttpError, type Bookmark } from "../types.js";

interface Row {
  id: string;
  document_id: string;
  parent_id: string | null;
  position: number;
  title: string;
  page: number;
  top: number | null;
  created_at: string;
  updated_at: string;
}

const map = (r: Row): Bookmark => ({
  id: r.id,
  documentId: r.document_id,
  parentId: r.parent_id,
  position: r.position,
  title: r.title,
  page: r.page,
  top: r.top,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** All bookmarks of a document; siblings are ordered by `position`. */
export function listBookmarks(db: DB, documentId: string): Bookmark[] {
  return (
    db.prepare("SELECT * FROM bookmarks WHERE document_id = ? ORDER BY parent_id IS NOT NULL, parent_id, position, created_at").all(documentId) as unknown as Row[]
  ).map(map);
}

export function getBookmark(db: DB, id: string): Bookmark | undefined {
  const row = db.prepare("SELECT * FROM bookmarks WHERE id = ?").get(id) as unknown as Row | undefined;
  return row && map(row);
}

export interface BookmarkInput {
  id?: string;
  title: string;
  page: number;
  top?: number | null;
  parentId?: string | null;
  position?: number;
}

function checkParent(db: DB, documentId: string, parentId: string | null | undefined, self?: string): void {
  if (!parentId) return;
  const parent = getBookmark(db, parentId);
  if (!parent || parent.documentId !== documentId) throw new HttpError(400, "The parent bookmark doesn't exist in this PDF.");
  // A bookmark can't be moved inside itself or one of its own children.
  for (let p: Bookmark | undefined = parent; p; p = p.parentId ? getBookmark(db, p.parentId) : undefined) {
    if (p.id === self) throw new HttpError(400, "A bookmark can't be moved inside itself.");
  }
}

function nextPosition(db: DB, documentId: string, parentId: string | null): number {
  const r = db
    .prepare("SELECT MAX(position) AS m FROM bookmarks WHERE document_id = ? AND parent_id IS ?")
    .get(documentId, parentId) as { m: number | null };
  return (r.m ?? 0) + 1;
}

export function createBookmark(db: DB, documentId: string, input: BookmarkInput): Bookmark {
  const id = input.id ?? randomUUID();
  if (getBookmark(db, id)) throw new HttpError(409, "A bookmark with this id already exists.");
  return transaction(db, () => {
    checkParent(db, documentId, input.parentId);
    const parentId = input.parentId ?? null;
    db.prepare("INSERT INTO bookmarks (id, document_id, parent_id, position, title, page, top) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      id,
      documentId,
      parentId,
      input.position ?? nextPosition(db, documentId, parentId),
      input.title,
      input.page,
      input.top ?? null,
    );
    setBookmarksDirty(db, documentId, true);
    return getBookmark(db, id)!;
  });
}

export function updateBookmark(db: DB, id: string, patch: Partial<Omit<BookmarkInput, "id">>): Bookmark | undefined {
  const cur = getBookmark(db, id);
  if (!cur) return undefined;
  return transaction(db, () => {
    if (patch.parentId !== undefined) checkParent(db, cur.documentId, patch.parentId, id);
    const parentId = patch.parentId === undefined ? cur.parentId : patch.parentId;
    const next = {
      title: patch.title ?? cur.title,
      page: patch.page ?? cur.page,
      top: patch.top === undefined ? cur.top : patch.top,
      parentId,
      position: patch.position ?? (parentId !== cur.parentId ? nextPosition(db, cur.documentId, parentId) : cur.position),
    };
    db.prepare(`UPDATE bookmarks SET title = ?, page = ?, top = ?, parent_id = ?, position = ?, updated_at = ${NOW} WHERE id = ?`).run(
      next.title,
      next.page,
      next.top,
      next.parentId,
      next.position,
      id,
    );
    setBookmarksDirty(db, cur.documentId, true);
    return getBookmark(db, id)!;
  });
}

/** Deletes a bookmark and everything nested under it. */
export function deleteBookmark(db: DB, id: string): boolean {
  const cur = getBookmark(db, id);
  if (!cur) return false;
  transaction(db, () => {
    db.prepare("DELETE FROM bookmarks WHERE id = ?").run(id);
    setBookmarksDirty(db, cur.documentId, true);
  });
  return true;
}

export interface OutlineEntry {
  title: string;
  page: number;
  top?: number | null;
  children?: OutlineEntry[];
}

/**
 * Stores the PDF's own outline as bookmarks, once per document (later calls change nothing). The
 * bookmarks then match the file, so they are not marked unsaved.
 */
export function importOutline(db: DB, documentId: string, entries: OutlineEntry[]): boolean {
  return transaction(db, () => {
    const done = db.prepare("SELECT outline_imported AS i FROM documents WHERE id = ?").get(documentId) as { i: number } | undefined;
    if (!done || done.i === 1) return false;
    const insert = db.prepare("INSERT INTO bookmarks (id, document_id, parent_id, position, title, page, top) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const walk = (list: OutlineEntry[], parentId: string | null) => {
      list.forEach((e, i) => {
        const id = randomUUID();
        insert.run(id, documentId, parentId, i + 1, e.title, e.page, e.top ?? null);
        if (e.children?.length) walk(e.children, id);
      });
    };
    walk(entries, null);
    db.prepare("UPDATE documents SET outline_imported = 1 WHERE id = ?").run(documentId);
    return true;
  });
}

/** Bookmarks as a tree (children ordered by position), for writing the PDF outline. */
export interface BookmarkNode extends Bookmark {
  children: BookmarkNode[];
}

export function bookmarkTree(db: DB, documentId: string): BookmarkNode[] {
  const nodes = new Map(listBookmarks(db, documentId).map((b) => [b.id, { ...b, children: [] as BookmarkNode[] }]));
  const roots: BookmarkNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  const sort = (list: BookmarkNode[]) => {
    list.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
