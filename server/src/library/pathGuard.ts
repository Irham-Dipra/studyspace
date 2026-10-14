import fs from "node:fs";
import path from "node:path";

/** True when `child` is `parent` itself or lies underneath it (both must be absolute & normalised). */
export function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Resolves `target` (following symlinks) and verifies it lies inside one of `roots`.
 * Returns the resolved real path, or null if it escapes every root or does not exist.
 * This is the single gate every file read/write in StudySpace passes through.
 */
export function resolveInsideRoots(target: string, roots: string[]): string | null {
  if (!path.isAbsolute(target)) return null;
  const real = realpathOrNull(path.normalize(target));
  if (!real) return null;
  for (const root of roots) {
    const realRoot = realpathOrNull(root);
    if (realRoot && isWithin(realRoot, real)) return real;
  }
  return null;
}
