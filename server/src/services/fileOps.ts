import fs from "node:fs/promises";
import path from "node:path";
import type { DB } from "../db/index.js";
import { getDocument, getDocumentByPath, markDocumentPresent, renameDocumentRow, setDocumentMissing } from "../db/documents.js";
import { listDirectories } from "../db/directories.js";
import { resolveInsideRoots } from "../library/pathGuard.js";
import { titleFromPath } from "../library/scanner.js";
import { resolveDocumentFile, withLock } from "./documentEditor.js";
import { HttpError, type DocumentRecord } from "../types.js";

/**
 * Renaming and deleting library files. A deleted file goes to the desktop Trash (the freedesktop.org
 * layout: files/ and info/*.trashinfo), so it can be put back from here (undo) or from the file
 * manager. Its notes, highlights and bookmarks stay in the database, so either way they come back.
 */

const exists = (p: string) => fs.lstat(p).then(() => true, () => false);

/** rename(2), or copy + delete when the two places are on different disks. */
async function moveFile(from: string, to: string): Promise<void> {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    const st = await fs.stat(from);
    await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    await fs.utimes(to, st.atime, st.mtime); // keeps the mtime, so a rescan still knows the file
    await fs.unlink(from);
  }
}

function checkName(raw: string, current: string): string {
  let name = raw.trim();
  if (!name) throw new HttpError(400, "The name can't be empty.");
  if (/[/\0]/.test(name)) throw new HttpError(400, "A name can't contain “/”.");
  if (name.startsWith(".")) throw new HttpError(400, "A name can't start with “.” (the file would be hidden).");
  // The extension decides how the file is opened, so it is kept.
  const ext = path.extname(current);
  if (path.extname(name).toLowerCase() !== ext.toLowerCase()) name += ext;
  if (Buffer.byteLength(name) > 255) throw new HttpError(400, "That name is too long.");
  return name;
}

export function renameDocument(db: DB, id: string, newName: string): Promise<DocumentRecord> {
  return withLock(id, async () => {
    const { doc } = resolveDocumentFile(db, id);
    const name = checkName(newName, doc.path);
    if (name === path.basename(doc.path)) return doc;
    const target = path.join(path.dirname(doc.path), name);
    if (await exists(target)) {
      // A case-only rename on a case-insensitive disk finds the file itself.
      const [a, b] = await Promise.all([fs.stat(doc.path), fs.stat(target)]);
      if (a.ino !== b.ino || a.dev !== b.dev) throw new HttpError(409, `“${name}” already exists in this folder.`);
    }
    // Paths are unique, and a missing (e.g. deleted) file keeps its row so its notes can come back.
    if (getDocumentByPath(db, target)) {
      throw new HttpError(409, `“${name}” is the name of a deleted file whose notes StudySpace still keeps. Pick another name.`);
    }
    await fs.rename(doc.path, target);
    const relPath = [...doc.relPath.split("/").slice(0, -1), name].join("/");
    renameDocumentRow(db, id, { path: target, relPath, title: titleFromPath(target) });
    return getDocument(db, id)!;
  });
}

const pad = (n: number) => String(n).padStart(2, "0");
const localStamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Moves the file to the Trash and hides it from the library. Returns its name in the Trash. */
export function trashDocument(db: DB, trashDir: string, id: string): Promise<{ trashName: string }> {
  return withLock(id, async () => {
    const { doc } = resolveDocumentFile(db, id);
    const files = path.join(trashDir, "files");
    const info = path.join(trashDir, "info");
    await fs.mkdir(files, { recursive: true, mode: 0o700 });
    await fs.mkdir(info, { recursive: true, mode: 0o700 });

    // The .trashinfo file is created first (exclusively) to claim the name, as the spec asks.
    const base = path.basename(doc.path);
    const ext = path.extname(base);
    const stem = base.slice(0, base.length - ext.length);
    const body = `[Trash Info]\nPath=${encodePath(doc.path)}\nDeletionDate=${localStamp(new Date())}\n`;
    let trashName = "";
    for (let n = 1; !trashName; n++) {
      if (n > 1000) throw new HttpError(500, "Couldn't find a free name in the Trash.");
      const candidate = n === 1 ? base : `${stem}.${n}${ext}`;
      try {
        await fs.writeFile(path.join(info, `${candidate}.trashinfo`), body, { flag: "wx", mode: 0o600 });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw err;
      }
      if (await exists(path.join(files, candidate))) {
        await fs.rm(path.join(info, `${candidate}.trashinfo`), { force: true });
        continue;
      }
      trashName = candidate;
    }

    try {
      await moveFile(doc.path, path.join(files, trashName));
    } catch (err) {
      await fs.rm(path.join(info, `${trashName}.trashinfo`), { force: true });
      throw err;
    }
    setDocumentMissing(db, id, true);
    return { trashName };
  });
}

/** Puts a file deleted by `trashDocument` back where it was. */
export function restoreDocument(db: DB, trashDir: string, id: string, trashName: string): Promise<DocumentRecord> {
  return withLock(id, async () => {
    const doc = getDocument(db, id);
    if (!doc) throw new HttpError(404, "Document not found");
    if (!doc.missing) throw new HttpError(409, `“${path.basename(doc.path)}” is already in the library.`);
    if (!trashName || path.basename(trashName) !== trashName || trashName === "..") throw new HttpError(400, "Bad Trash name");
    const file = path.join(trashDir, "files", trashName);
    const infoFile = path.join(trashDir, "info", `${trashName}.trashinfo`);
    if (!(await exists(file))) throw new HttpError(404, `“${trashName}” is no longer in the Trash.`);
    // Only put back the file that came from this document's place.
    const info = await fs.readFile(infoFile, "utf8").catch(() => "");
    const from = /^Path=(.*)$/m.exec(info)?.[1];
    if (from === undefined || decodeURIComponent(from) !== doc.path) {
      throw new HttpError(409, `“${trashName}” in the Trash isn't this file any more.`);
    }
    const roots = listDirectories(db).filter((d) => d.enabled).map((d) => d.path);
    if (!resolveInsideRoots(path.dirname(doc.path), roots)) {
      throw new HttpError(409, "Its folder is gone or no longer in the library.");
    }
    if (await exists(doc.path)) throw new HttpError(409, `Another “${path.basename(doc.path)}” is already there.`);
    await moveFile(file, doc.path);
    await fs.rm(infoFile, { force: true });
    const st = await fs.stat(doc.path);
    markDocumentPresent(db, id, { size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
    return getDocument(db, id)!;
  });
}
