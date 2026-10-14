import type { DB } from "./index.js";
import type { Directory } from "../types.js";

interface Row {
  id: number;
  path: string;
  label: string;
  excludes: string;
  enabled: number;
  created_at: string;
  last_scanned_at: string | null;
}

function map(r: Row): Directory {
  return {
    id: r.id,
    path: r.path,
    label: r.label,
    excludes: JSON.parse(r.excludes) as string[],
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    lastScannedAt: r.last_scanned_at,
  };
}

export function listDirectories(db: DB): Directory[] {
  return (db.prepare("SELECT * FROM directories ORDER BY label COLLATE NOCASE").all() as unknown as Row[]).map(map);
}

export function getDirectory(db: DB, id: number): Directory | undefined {
  const row = db.prepare("SELECT * FROM directories WHERE id = ?").get(id) as unknown as Row | undefined;
  return row && map(row);
}

export function insertDirectory(db: DB, input: { path: string; label: string; excludes: string[] }): Directory {
  const info = db
    .prepare("INSERT INTO directories (path, label, excludes) VALUES (?, ?, ?)")
    .run(input.path, input.label, JSON.stringify(input.excludes));
  return getDirectory(db, Number(info.lastInsertRowid))!;
}

export function updateDirectory(
  db: DB,
  id: number,
  patch: Partial<{ label: string; excludes: string[]; enabled: boolean }>,
): Directory | undefined {
  const cur = getDirectory(db, id);
  if (!cur) return undefined;
  db.prepare("UPDATE directories SET label = ?, excludes = ?, enabled = ? WHERE id = ?").run(
    patch.label ?? cur.label,
    JSON.stringify(patch.excludes ?? cur.excludes),
    (patch.enabled ?? cur.enabled) ? 1 : 0,
    id,
  );
  return getDirectory(db, id);
}

export function deleteDirectory(db: DB, id: number): boolean {
  return Number(db.prepare("DELETE FROM directories WHERE id = ?").run(id).changes) > 0;
}

export function markDirectoryScanned(db: DB, id: number): void {
  db.prepare("UPDATE directories SET last_scanned_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(id);
}
