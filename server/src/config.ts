import os from "node:os";
import path from "node:path";

export interface AIConfig {
  provider: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface OcrConfig {
  /** OCRmyPDF executable (OCR of whole pages; can add a searchable text layer to the PDF). */
  ocrmypdf: string;
  /** Tesseract executable (OCR of a region cut out of a page). Installed together with OCRmyPDF. */
  tesseract: string;
  /** Tesseract language(s), e.g. "eng" or "eng+ben". */
  language: string;
}

export interface AppConfig {
  host: string;
  port: number;
  /** Directory holding the SQLite database and edit backups. Never inside the web root. */
  dataDir: string;
  /** Directories added to the library on first start (only when no directory is configured yet). */
  seedLibraryDirs: string[];
  /** Folder names / relative paths excluded when seeding. */
  seedExcludes: string[];
  /**
   * How many file edits per PDF can be undone. Each step keeps the previous version of the file
   * under <dataDir>/history, which doubles as a backup. 0 disables undo for file edits.
   */
  historyLimit: number;
  /** Optional path to the built frontend, served statically in production mode. */
  webDistDir?: string;
  ai: AIConfig;
  ocr: OcrConfig;
}

function defaultDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".local", "share");
  return path.join(base, "studyspace");
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function list(value: string | undefined, sep: string): string[] {
  return (value ?? "")
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const historyLimit = Number.parseInt(env.STUDYSPACE_HISTORY_LIMIT ?? env.STUDYSPACE_BACKUP_COUNT ?? "10", 10);
  return {
    host: env.STUDYSPACE_HOST ?? "127.0.0.1",
    port: Number.parseInt(env.STUDYSPACE_PORT ?? env.PORT ?? "4317", 10),
    dataDir: path.resolve(expandHome(env.STUDYSPACE_DATA_DIR ?? defaultDataDir())),
    seedLibraryDirs: list(env.STUDYSPACE_LIBRARY_DIRS, path.delimiter).map((d) => path.resolve(expandHome(d))),
    seedExcludes: list(env.STUDYSPACE_EXCLUDES, ","),
    historyLimit: Number.isFinite(historyLimit) && historyLimit >= 0 ? historyLimit : 10,
    webDistDir: env.STUDYSPACE_WEB_DIST,
    ocr: {
      ocrmypdf: env.STUDYSPACE_OCRMYPDF || "ocrmypdf",
      tesseract: env.STUDYSPACE_TESSERACT || "tesseract",
      language: env.STUDYSPACE_OCR_LANG || "eng",
    },
    ai: {
      provider: (env.AI_PROVIDER ?? "none").toLowerCase(),
      apiKey: env.AI_API_KEY,
      model: env.AI_MODEL,
      baseUrl: env.AI_BASE_URL,
    },
  };
}
