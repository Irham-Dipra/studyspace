import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { transaction, type DB } from "../db/index.js";
import { listDirectories, markDirectoryScanned } from "../db/directories.js";
import {
  findDocumentsByFingerprint,
  getDocumentByPath,
  insertDocument,
  markDocumentsMissing,
  touchDocument,
  updateDocumentLocation,
} from "../db/documents.js";
import { fingerprintFile } from "./fingerprint.js";
import { scanForPdfs, titleFromPath, type ScannedFile } from "./scanner.js";

export interface SyncResult {
  scanned: number;
  added: number;
  moved: number;
  changed: number;
  missing: number;
  errors: string[];
}

interface Found extends ScannedFile {
  directoryId: number;
}

const running = new WeakMap<DB, Promise<SyncResult>>();

/** Rescans all enabled directories. Concurrent calls share the same in-flight scan. */
export function syncLibrary(db: DB): Promise<SyncResult> {
  let p = running.get(db);
  if (!p) {
    p = doSync(db).finally(() => running.delete(db));
    running.set(db, p);
  }
  return p;
}

async function doSync(db: DB): Promise<SyncResult> {
  const result: SyncResult = { scanned: 0, added: 0, moved: 0, changed: 0, missing: 0, errors: [] };
  const dirs = listDirectories(db).filter((d) => d.enabled);

  const found: Found[] = [];
  const seenPaths = new Set<string>();
  for (const dir of dirs) {
    try {
      for (const f of await scanForPdfs(dir.path, dir.excludes)) {
        // Nested roots: the first root to claim a file wins.
        if (seenPaths.has(f.absPath)) continue;
        seenPaths.add(f.absPath);
        found.push({ ...f, directoryId: dir.id });
      }
    } catch (err) {
      result.errors.push(`${dir.path}: ${(err as Error).message}`);
    }
  }
  result.scanned = found.length;

  // Fingerprinting is async I/O, so compute everything we need before the write transaction.
  const keep = new Set<string>();
  const unknown: (Found & { fingerprint: string })[] = [];
  const changed: { id: string; f: Found; fingerprint: string; contentChanged: boolean }[] = [];
  for (const f of found) {
    const existing = getDocumentByPath(db, f.absPath);
    try {
      if (existing && existing.size === f.size && existing.mtimeMs === f.mtimeMs) {
        keep.add(existing.id);
        touchDocument(db, existing.id, f.directoryId, f.relPath);
      } else if (existing) {
        keep.add(existing.id);
        const fingerprint = await fingerprintFile(f.absPath);
        changed.push({ id: existing.id, f, fingerprint, contentChanged: fingerprint !== existing.fingerprint });
      } else {
        unknown.push({ ...f, fingerprint: await fingerprintFile(f.absPath) });
      }
    } catch (err) {
      result.errors.push(`${f.absPath}: ${(err as Error).message}`);
    }
  }

  transaction(db, () => {
    for (const c of changed) {
      updateDocumentLocation(db, c.id, {
        directoryId: c.f.directoryId,
        path: c.f.absPath,
        relPath: c.f.relPath,
        title: titleFromPath(c.f.absPath),
        fingerprint: c.fingerprint,
        size: c.f.size,
        mtimeMs: c.f.mtimeMs,
      });
      // Edited by another program: if the bookmarks hold nothing unsaved, re-read them from the
      // file's (possibly new) outline next time it's opened.
      if (c.contentChanged) {
        db.prepare("DELETE FROM bookmarks WHERE document_id = ? AND EXISTS (SELECT 1 FROM documents WHERE id = ? AND bookmarks_dirty = 0)").run(c.id, c.id);
        db.prepare("UPDATE documents SET outline_imported = 0 WHERE id = ? AND bookmarks_dirty = 0").run(c.id);
      }
      result.changed++;
    }
    for (const f of unknown) {
      const loc = {
        directoryId: f.directoryId,
        path: f.absPath,
        relPath: f.relPath,
        title: titleFromPath(f.absPath),
        fingerprint: f.fingerprint,
        size: f.size,
        mtimeMs: f.mtimeMs,
      };
      // A renamed/moved file: same content as a known document whose old path is gone.
      const moved = findDocumentsByFingerprint(db, f.fingerprint).find(
        (d) => !keep.has(d.id) && !fs.existsSync(d.path),
      );
      if (moved) {
        updateDocumentLocation(db, moved.id, loc);
        keep.add(moved.id);
        result.moved++;
      } else {
        const doc = insertDocument(db, { id: randomUUID(), ...loc });
        keep.add(doc.id);
        result.added++;
      }
    }
    result.missing = markDocumentsMissing(db, keep);
    for (const d of dirs) markDirectoryScanned(db, d.id);
  });

  return result;
}
