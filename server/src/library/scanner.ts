import fs from "node:fs/promises";
import path from "node:path";
import { isWithin } from "./pathGuard.js";
import { LIBRARY_EXTENSION, isLibraryFile } from "./fileKinds.js";

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
 * One "hide" rule from a library folder's settings, matched against root-relative paths
 * (forward slashes), case-insensitively:
 * - `re:<regex>`: a regular expression tested against the whole relative path;
 * - with a "/" (or starting with one): a path from the library folder, e.g. `Old/Drafts`, `CSE 301/*.md`;
 * - otherwise a folder or file name at any depth, e.g. `Offllines`, `*.md`.
 * `*` is any run of characters except "/", `**` crosses folders, `?` is one character.
 * A rule that matches a folder hides everything inside it.
 */
interface Rule {
  /** "name": tested against each folder or file name; otherwise against the path and each folder above it. */
  kind: "regex" | "path" | "name";
  re: RegExp;
}

const ruleCache = new Map<string, Rule | null>();

function globSource(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // "**/" also matches no folder at all.
        if (glob[i + 2] === "/") (out += "(?:.*/)?"), (i += 2);
        else (out += ".*"), i++;
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "/") out += "\\s*/"; // a folder name may end in a space
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

/** The rule for one exclude, or null when it is empty or a broken regex. */
export function parseExclude(raw: string): Rule | null {
  if (ruleCache.has(raw)) return ruleCache.get(raw)!;
  let rule: Rule | null = null;
  const text = raw.trim();
  if (/^re:/i.test(text)) {
    try {
      const src = text.slice(3).trim();
      if (src) rule = { kind: "regex", re: new RegExp(src, "i") };
    } catch {
      rule = null;
    }
  } else {
    const anchored = text.startsWith("/");
    const glob = text.replace(/^\/+|\/+$/g, "");
    if (glob) {
      const kind = anchored || glob.includes("/") ? "path" : "name";
      // Settings trims a rule, but a folder's name may end in a space ("RRR ma_am "): allow it.
      const src = globSource(glob);
      rule = { kind, re: new RegExp(`^${src}\\s*$`, "i") };
    }
  }
  ruleCache.set(raw, rule);
  return rule;
}

/** Why an exclude can't be used, or null when it is fine (only regexes can be broken). */
export function excludeError(raw: string): string | null {
  const text = raw.trim();
  if (!/^re:/i.test(text)) return null;
  try {
    new RegExp(text.slice(3).trim(), "i");
    return null;
  } catch (e) {
    return `Not a valid regular expression: ${text} (${(e as Error).message})`;
  }
}

/**
 * Decides whether a folder or file (given as a root-relative path) is hidden by the excludes:
 * it, or a folder above it, matches one of them. See `parseExclude` for the rules.
 */
export function isExcluded(relPath: string, excludes: string[]): boolean {
  const segments = relPath.split("/").filter(Boolean);
  if (!segments.length) return false;
  const prefixes = segments.map((_, i) => segments.slice(0, i + 1).join("/"));
  for (const raw of excludes) {
    const rule = parseExclude(raw);
    if (!rule) continue;
    if (rule.kind === "name" ? segments.some((s) => rule.re.test(s)) : prefixes.some((p) => rule.re.test(p))) return true;
  }
  return false;
}

/** Recursively finds PDF and slide files under `root`. Does not follow directory symlinks (avoids loops/escapes). */
export async function scanForDocuments(root: string, excludes: string[] = []): Promise<ScannedFile[]> {
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
      } else if ((entry.isFile() || entry.isSymbolicLink()) && isLibraryFile(entry.name)) {
        if (isExcluded(rel, excludes)) continue;
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
  return path.basename(p).replace(LIBRARY_EXTENSION, "");
}
