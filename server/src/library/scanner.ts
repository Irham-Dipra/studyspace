import fs from "node:fs/promises";
import path from "node:path";
import { isWithin } from "./pathGuard.js";

export interface ScannedFile {
  absPath: string;
  /** Path relative to the scanned root, always with forward slashes. */
  relPath: string;
  size: number;
  mtimeMs: number;
}

/** Directory names that never contain study material and can be huge. */
export const ALWAYS_SKIP = new Set(["node_modules", "__pycache__", "venv", ".venv", "dist", "build", "target"]);

/**
 * Decides whether a directory (given as a root-relative path) is excluded.
 * An exclude containing "/" matches that relative path (and everything below it);
 * a bare name matches any directory with that name at any depth. Case-insensitive.
 */
export function isExcluded(relDir: string, excludes: string[]): boolean {
  const rel = relDir.toLowerCase();
  const segments = rel.split("/");
  for (const raw of excludes) {
    const ex = raw.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
    if (!ex) continue;
    if (ex.includes("/")) {
      if (rel === ex || rel.startsWith(`${ex}/`)) return true;
    } else if (segments.includes(ex)) {
      return true;
    }
  }
  return false;
}

/** Recursively finds PDF files under `root`. Does not follow directory symlinks (avoids loops/escapes). */
export async function scanForPdfs(root: string, excludes: string[] = []): Promise<ScannedFile[]> {
  const realRoot = await fs.realpath(root);
  const out: ScannedFile[] = [];

  async function walk(dir: string, relDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory: skip silently
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP.has(entry.name) || isExcluded(rel, excludes)) continue;
        await walk(abs, rel);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.toLowerCase().endsWith(".pdf")) {
        try {
          const real = entry.isSymbolicLink() ? await fs.realpath(abs) : abs;
          if (entry.isSymbolicLink() && !isWithin(realRoot, real)) continue; // symlink escaping the root
          const st = await fs.stat(real);
          if (!st.isFile()) continue;
          out.push({ absPath: abs, relPath: rel, size: st.size, mtimeMs: Math.floor(st.mtimeMs) });
        } catch {
          // broken symlink or file vanished mid-scan
        }
      }
    }
  }

  await walk(root, "");
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

export function titleFromPath(p: string): string {
  return path.basename(p).replace(/\.pdf$/i, "");
}
