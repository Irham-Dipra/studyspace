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

export interface SlidesConfig {
  /** LibreOffice executable; empty means look for `soffice`, then `libreoffice`, on the PATH. */
  soffice: string;
  /**
   * Where LibreOffice reads and writes while converting; empty means pick one. A snap LibreOffice
   * can't see /tmp or hidden folders like ~/.local, so it then gets ~/snap/libreoffice/common.
   */
  workDir: string;
}

export interface AppConfig {
  /** 127.0.0.1 = this computer only; 0.0.0.0 = also other devices on the Wi-Fi (they need the password). */
  host: string;
  port: number;
  /**
   * Lets other devices (a phone over Wi-Fi or Tailscale) log in. Empty = only this computer can use
   * StudySpace. Requests from this computer itself never need it.
   */
  password: string;
  /** Extra host names other devices may use (the LAN IPs, this computer's name and *.ts.net always work). */
  allowedHosts: string[];
  /** Writes must carry the X-StudySpace header (stops other websites). Only tests turn it off. */
  requireCsrfHeader: boolean;
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
  /** The desktop Trash that deleted library files go to (freedesktop.org layout). */
  trashDir: string;
  /** Optional path to the built frontend, served statically in production mode. */
  webDistDir?: string;
  ai: AIConfig;
  ocr: OcrConfig;
  slides: SlidesConfig;
}

/** Each system's usual place for app data (Linux: XDG). */
function defaultDataDir(): string {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "StudySpace");
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "StudySpace");
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".local", "share");
  return path.join(base, "studyspace");
}

/**
 * Linux: the desktop Trash (freedesktop.org), so the file manager can restore files. Windows and
 * macOS bins can't be written from Node without a native module, so StudySpace keeps its own.
 */
function defaultTrashDir(dataDir: string): string {
  if (process.platform === "win32" || process.platform === "darwin") return path.join(dataDir, "Trash");
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".local", "share");
  return path.join(base, "Trash");
}

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
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
  const dataDir = path.resolve(expandHome(env.STUDYSPACE_DATA_DIR ?? defaultDataDir()));
  return {
    host: env.STUDYSPACE_HOST ?? "127.0.0.1",
    port: Number.parseInt(env.STUDYSPACE_PORT ?? env.PORT ?? "4317", 10),
    password: env.STUDYSPACE_PASSWORD ?? "",
    allowedHosts: list(env.STUDYSPACE_ALLOWED_HOSTS, ",").map((h) => h.toLowerCase()),
    requireCsrfHeader: true,
    dataDir,
    seedLibraryDirs: list(env.STUDYSPACE_LIBRARY_DIRS, path.delimiter).map((d) => path.resolve(expandHome(d))),
    seedExcludes: list(env.STUDYSPACE_EXCLUDES, ","),
    historyLimit: Number.isFinite(historyLimit) && historyLimit >= 0 ? historyLimit : 10,
    trashDir: env.STUDYSPACE_TRASH_DIR ? path.resolve(expandHome(env.STUDYSPACE_TRASH_DIR)) : defaultTrashDir(dataDir),
    webDistDir: env.STUDYSPACE_WEB_DIST,
    ocr: {
      ocrmypdf: env.STUDYSPACE_OCRMYPDF || "ocrmypdf",
      tesseract: env.STUDYSPACE_TESSERACT || "tesseract",
      language: env.STUDYSPACE_OCR_LANG || "eng",
    },
    slides: {
      soffice: env.STUDYSPACE_SOFFICE || "",
      workDir: env.STUDYSPACE_CONVERT_DIR ? path.resolve(expandHome(env.STUDYSPACE_CONVERT_DIR)) : "",
    },
    ai: {
      provider: (env.AI_PROVIDER ?? "none").toLowerCase(),
      apiKey: env.AI_API_KEY,
      model: env.AI_MODEL,
      baseUrl: env.AI_BASE_URL,
    },
  };
}
