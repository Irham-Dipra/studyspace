import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, runMigrations } from "../src/db/index.js";
import { migrations } from "../src/db/migrations.js";
import { cleanupTempDirs, tempDir } from "./helpers.js";

afterAll(cleanupTempDirs);

describe("migrations", () => {
  it("creates every entity table on a fresh database", () => {
    const db = openDatabase(":memory:");
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (t) => t.name,
    );
    for (const t of ["directories", "documents", "resources", "resource_pages", "reading_progress", "annotations"]) {
      expect(tables).toContain(t);
    }
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(
      migrations.at(-1)!.version,
    );
  });

  it("is idempotent across restarts", () => {
    const file = path.join(tempDir(), "db.sqlite");
    openDatabase(file).close();
    const db = openDatabase(file);
    expect(runMigrations(db)).toEqual([]);
    const rows = db.prepare("SELECT version FROM schema_migrations").all();
    expect(rows).toHaveLength(migrations.length);
  });

  it("applies only new migrations, in order", () => {
    const db = new DatabaseSync(":memory:");
    expect(runMigrations(db, migrations)).toEqual(migrations.map((m) => m.version));
    const next = [...migrations, { version: 99, name: "add_col", up: "ALTER TABLE documents ADD COLUMN extra TEXT;" }];
    expect(runMigrations(db, next)).toEqual([99]);
  });

  it("rolls back a failing migration completely", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db, migrations);
    const bad = [
      ...migrations,
      { version: 50, name: "broken", up: "CREATE TABLE half_done (id INTEGER); SELECT * FROM no_such_table;" },
    ];
    expect(() => runMigrations(db, bad)).toThrow(/Migration 50/);
    const t = db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get();
    expect(t).toBeUndefined();
    expect(db.prepare("SELECT MAX(version) v FROM schema_migrations").get()).toEqual({ v: migrations.at(-1)!.version });
  });

  it("keeps existing undo history when widening its edit kinds (v4)", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db, migrations.filter((m) => m.version <= 3));
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare(
      `INSERT INTO document_history (id, document_id, kind, label, snapshot, file_path, page_count_before, fingerprint_after)
       VALUES ('h1', 'd1', 'delete', 'Delete page 2', '{}', '/x.pdf', 5, 'v1:x')`,
    ).run();
    expect(runMigrations(db, migrations)).toContain(4);
    expect(db.prepare("SELECT id, kind, label FROM document_history").all()).toEqual([{ id: "h1", kind: "delete", label: "Delete page 2" }]);
    db.prepare(
      `INSERT INTO document_history (id, document_id, kind, label, snapshot, file_path, page_count_before, fingerprint_after)
       VALUES ('h2', 'd1', 'replace', 'Replace page 2', '{}', '/y.pdf', 5, 'v1:y')`,
    ).run();
    expect(() =>
      db.prepare(
        `INSERT INTO document_history (id, document_id, kind, label, snapshot, file_path, page_count_before, fingerprint_after)
         VALUES ('h3', 'd1', 'bogus', 'x', '{}', '/z.pdf', 5, 'v1:z')`,
      ).run(),
    ).toThrow(/CHECK/);
  });

  it("accepts OCR edits in the undo history (v5) and keeps older rows", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db, migrations.filter((m) => m.version <= 4));
    db.exec("PRAGMA foreign_keys = OFF");
    const insert = (id: string, kind: string) =>
      db.prepare(
        `INSERT INTO document_history (id, document_id, kind, label, snapshot, file_path, page_count_before, fingerprint_after)
         VALUES (?, 'd1', ?, 'x', '{}', '/x.pdf', 5, 'v1:x')`,
      ).run(id, kind);
    insert("h1", "replace");
    expect(() => insert("h0", "ocr")).toThrow(/CHECK/);
    expect(runMigrations(db, migrations)).toContain(5);
    insert("h2", "ocr");
    expect(db.prepare("SELECT id, kind FROM document_history ORDER BY id").all()).toEqual([
      { id: "h1", kind: "replace" },
      { id: "h2", kind: "ocr" },
    ]);
  });

  it("adds bookmarks (v6) without touching existing documents", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db, migrations.filter((m) => m.version <= 5));
    db.exec("PRAGMA foreign_keys = ON");
    db.prepare("INSERT INTO directories (id, path, label) VALUES (1, '/lib', 'lib')").run();
    db.prepare(
      `INSERT INTO documents (id, directory_id, path, rel_path, title, fingerprint, size, mtime_ms, annotations_dirty)
       VALUES ('d1', 1, '/lib/a.pdf', 'a.pdf', 'a', 'v1:x', 1, 1, 1)`,
    ).run();
    expect(runMigrations(db, migrations)).toContain(6);
    expect(db.prepare("SELECT annotations_dirty, bookmarks_dirty, outline_imported FROM documents").get()).toEqual({
      annotations_dirty: 1,
      bookmarks_dirty: 0,
      outline_imported: 0,
    });
    db.prepare("INSERT INTO bookmarks (id, document_id, title, page) VALUES ('b1', 'd1', 'Ch 1', 1)").run();
    db.prepare("INSERT INTO bookmarks (id, document_id, parent_id, title, page) VALUES ('b2', 'd1', 'b1', 'Ch 1.1', 2)").run();
    expect(() => db.prepare("INSERT INTO bookmarks (id, document_id, title, page) VALUES ('b3', 'd1', '', 1)").run()).toThrow(/CHECK/);
    // Deleting a parent removes its children.
    db.prepare("DELETE FROM bookmarks WHERE id = 'b1'").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM bookmarks").get()).toEqual({ n: 0 });
  });

  it("accepts rotate and move edits in the undo history (v7) and keeps older rows", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db, migrations.filter((m) => m.version <= 6));
    db.exec("PRAGMA foreign_keys = OFF");
    const insert = (id: string, kind: string) =>
      db.prepare(
        `INSERT INTO document_history (id, document_id, kind, label, snapshot, file_path, page_count_before, fingerprint_after)
         VALUES (?, 'd1', ?, 'x', '{}', '/x.pdf', 5, 'v1:x')`,
      ).run(id, kind);
    insert("h1", "ocr");
    expect(() => insert("h0", "rotate")).toThrow(/CHECK/);
    expect(runMigrations(db, migrations)).toContain(7);
    insert("h2", "rotate");
    insert("h3", "move");
    expect(() => insert("h4", "bogus")).toThrow(/CHECK/);
    expect(db.prepare("SELECT kind FROM document_history ORDER BY id").all()).toEqual([{ kind: "ocr" }, { kind: "rotate" }, { kind: "move" }]);
  });

  it("refuses to open a database from a newer version", () => {
    const db = new DatabaseSync(":memory:");
    runMigrations(db, migrations);
    db.prepare("INSERT INTO schema_migrations (version, name) VALUES (1000, 'future')").run();
    expect(() => runMigrations(db, migrations)).toThrow(/newer/);
  });
});
