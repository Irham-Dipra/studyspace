import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrations as defaultMigrations, type Migration } from "./migrations.js";

export type DB = DatabaseSync;

export function openDatabase(file: string, migrations: Migration[] = defaultMigrations): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  runMigrations(db, migrations);
  return db;
}

/** Runs `fn` inside a transaction; rolls back on any thrown error. Nested calls join the outer transaction. */
export function transaction<T>(db: DB, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Applies pending migrations in order, each in its own transaction, and records them in
 * `schema_migrations`. Refuses to open a database created by a newer StudySpace version.
 */
export function runMigrations(db: DB, migrations: Migration[] = defaultMigrations): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].version === sorted[i - 1].version) {
      throw new Error(`Duplicate migration version ${sorted[i].version}`);
    }
  }
  const row = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number | null };
  const current = row.v ?? 0;
  const latest = sorted.at(-1)?.version ?? 0;
  if (current > latest) {
    throw new Error(
      `Database schema version ${current} is newer than this build supports (${latest}). Update StudySpace.`,
    );
  }

  const applied: number[] = [];
  for (const m of sorted) {
    if (m.version <= current) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(m.up);
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(m.version, m.name);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
      applied.push(m.version);
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${(err as Error).message}`);
    }
  }
  return applied;
}
