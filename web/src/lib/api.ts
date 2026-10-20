import type {
  Annotation,
  AnnotationKind,
  AppConfigInfo,
  Bookmark,
  Directory,
  DocumentRecord,
  NormPoint,
  NormRect,
  NoteHighlight,
  ReadingProgress,
  Resource,
  ResourceScope,
  ResourceType,
  ScanResult,
  TextHighlight,
} from "./types";

export interface OcrStatus {
  available: boolean;
  ocrmypdf: { available: boolean; version?: string };
  tesseract: { available: boolean; version?: string; languages: string[] };
  language: string;
  installHint: string;
}

export interface OcrJob {
  id: string;
  documentId: string;
  pages: number[];
  state: "running" | "done" | "failed";
  progress: number;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type MutationListener = (method: string, url: string) => void;
let mutationListener: MutationListener | null = null;

/** Called after every successful write request (used to tell other open tabs what changed). */
export function setMutationListener(fn: MutationListener | null): void {
  mutationListener = fn;
}

let authListener: (() => void) | null = null;

/** Called when the server asks for the password (a phone whose login ran out, or was logged out). */
export function setAuthListener(fn: (() => void) | null): void {
  authListener = fn;
}

/**
 * Sent with every request. The server refuses writes without it: a custom header can't be sent by
 * another website's form or plain fetch, so those can't change anything here.
 */
const CSRF_HEADER = { "X-StudySpace": "1" };

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { ...CSRF_HEADER, "Content-Type": "application/json" } : CSRF_HEADER,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !url.startsWith("/auth/")) authListener?.();
  if (res.ok && method !== "GET") mutationListener?.(method, url);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const msg = data?.issues?.length ? `${data.error}: ${data.issues.join("; ")}` : (data?.error ?? res.statusText);
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export interface ResourceInput {
  id?: string;
  type: ResourceType;
  scope: ResourceScope;
  pageStart?: number | null;
  pageEnd?: number | null;
  title?: string;
  content?: string;
  url?: string | null;
  styles?: Record<string, string>;
}

/** A folder inside the library where new PDFs can be saved. */
export interface LibraryFolder {
  path: string;
  /** "Library label/sub/folder" */
  label: string;
  depth: number;
}

/** New PDFs from pages of library PDFs (extract, split, merge). */
export interface CreatePdfsRequest {
  folder: string;
  newFolder?: string;
  /** A segment without `pages` takes every page. */
  outputs: { name: string; segments: { documentId: string; pages?: number[]; title?: string }[] }[];
  copyNotes: boolean;
  copyHighlights: boolean;
  copyBookmarks: boolean;
  bookmarkPerSource: boolean;
}

export interface BookmarkInput {
  id?: string;
  title: string;
  page: number;
  top?: number | null;
  parentId?: string | null;
  position?: number;
}

/** One entry of a PDF's own outline, as read by pdf.js. */
export interface OutlineEntry {
  title: string;
  page: number;
  top?: number | null;
  children?: OutlineEntry[];
}

export interface AnnotationInput {
  id?: string;
  page: number;
  kind: AnnotationKind;
  color: string;
  opacity?: number;
  rects?: NormRect[];
  paths?: NormPoint[][];
  strokeWidth?: number;
  text?: string;
}

/** A file edit's result: the updated document plus the id needed to undo it (null when history is disabled). */
export type EditResult = DocumentRecord & { editId: string | null };

/** What happens to notes whose pages are all deleted: removed with the page, or kept as whole-document notes. */
export type OrphanPolicy = "delete" | "document";

export interface AuthStatus {
  /** Opened on this computer (127.0.0.1 / localhost): no password needed. */
  local: boolean;
  loggedIn: boolean;
  /** A password is set in .env, so other devices can log in. */
  passwordSet: boolean;
}

export const api = {
  authStatus: () => req<AuthStatus>("GET", "/auth/status"),
  login: (password: string) => req<AuthStatus>("POST", "/auth/login", { password }),
  logout: () => req<void>("POST", "/auth/logout"),

  config: () => req<AppConfigInfo>("GET", "/config"),

  library: () => req<{ directories: Directory[]; documents: DocumentRecord[] }>("GET", "/library"),
  scan: () => req<ScanResult>("POST", "/library/scan"),
  recent: () => req<(ReadingProgress & { title: string })[]>("GET", "/recent"),
  /** Renames the file in its folder; the extension is kept. */
  renameFile: (id: string, name: string) => req<DocumentRecord>("POST", `/documents/${id}/rename`, { name }),
  /** Moves the file to the desktop Trash. Notes etc. are kept, so `restoreFile` brings it all back. */
  trashFile: (id: string) => req<{ trashName: string }>("POST", `/documents/${id}/trash`),
  restoreFile: (id: string, trashName: string) => req<DocumentRecord>("POST", `/documents/${id}/restore`, { trashName }),
  search: (q: string) =>
    req<{ documents: DocumentRecord[]; resources: (Resource & { documentTitle: string })[] }>(
      "GET",
      `/search?q=${encodeURIComponent(q)}`,
    ),

  addDirectory: (body: { path: string; label?: string; excludes?: string[] }) =>
    req<{ directory: Directory; scan: ScanResult }>("POST", "/directories", body),
  updateDirectory: (id: number, body: Partial<{ label: string; excludes: string[]; enabled: boolean }>) =>
    req<{ directory: Directory; scan: ScanResult }>("PATCH", `/directories/${id}`, body),
  deleteDirectory: (id: number) => req<void>("DELETE", `/directories/${id}`),
  browse: (path?: string) =>
    req<{ path: string; parent: string | null; dirs: { name: string; path: string }[]; pdfCount: number }>(
      "GET",
      `/fs/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`,
    ),

  document: (id: string) => req<DocumentRecord & { progress: ReadingProgress | null }>("GET", `/documents/${id}`),
  /** Slides: waits until LibreOffice has turned them into a PDF (the first time takes up to a minute). */
  convert: (id: string) => req<{ ready: true }>("POST", `/documents/${id}/convert`),
  fileUrl: (d: Pick<DocumentRecord, "id" | "fingerprint">) =>
    `/api/documents/${d.id}/file?v=${encodeURIComponent(d.fingerprint)}`,
  setPageCount: (id: string, pageCount: number) => req<DocumentRecord>("PATCH", `/documents/${id}/meta`, { pageCount }),
  /** `top` (0..1, how far down) is for documents without pages; PDFs leave it out. */
  saveProgress: (id: string, page: number, zoom: number, top?: number) =>
    req<ReadingProgress>("PUT", `/documents/${id}/progress`, { page, zoom, ...(top !== undefined && { top }) }),
  /** The text of an HTML or Markdown document. */
  fileText: async (d: Pick<DocumentRecord, "id" | "fingerprint">): Promise<string> => {
    const res = await fetch(api.fileUrl(d), { headers: CSRF_HEADER });
    if (res.status === 401) authListener?.();
    if (!res.ok) throw new ApiError(res.status, ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? res.statusText);
    return res.text();
  },
  /** A picture next to a Markdown file, by its path relative to the file. */
  assetUrl: (docId: string, rel: string) => `/api/documents/${docId}/asset?path=${encodeURIComponent(rel)}`,

  resources: (docId: string) => req<Resource[]>("GET", `/documents/${docId}/resources`),
  createResource: (docId: string, body: ResourceInput) => req<Resource>("POST", `/documents/${docId}/resources`, body),
  updateResource: (id: string, body: Partial<ResourceInput>) => req<Resource>("PATCH", `/resources/${id}`, body),
  deleteResource: (id: string) => req<void>("DELETE", `/resources/${id}`),

  noteHighlights: (docId: string) => req<NoteHighlight[]>("GET", `/documents/${docId}/note-highlights`),
  createNoteHighlight: (
    resourceId: string,
    body: { id?: string; color: string; quote: string; prefix?: string; suffix?: string; comment?: string },
  ) => req<NoteHighlight>("POST", `/resources/${resourceId}/highlights`, body),
  updateNoteHighlight: (id: string, body: { color?: string; comment?: string }) =>
    req<NoteHighlight>("PATCH", `/note-highlights/${id}`, body),
  deleteNoteHighlight: (id: string) => req<void>("DELETE", `/note-highlights/${id}`),

  textHighlights: (docId: string) => req<TextHighlight[]>("GET", `/documents/${docId}/text-highlights`),
  createTextHighlight: (
    docId: string,
    body: { id?: string; color: string; quote: string; prefix?: string; suffix?: string; comment?: string },
  ) => req<TextHighlight>("POST", `/documents/${docId}/text-highlights`, body),
  updateTextHighlight: (id: string, body: { color?: string; comment?: string }) =>
    req<TextHighlight>("PATCH", `/text-highlights/${id}`, body),
  deleteTextHighlight: (id: string) => req<void>("DELETE", `/text-highlights/${id}`),

  annotations: (docId: string) => req<Annotation[]>("GET", `/documents/${docId}/annotations`),
  createAnnotation: (docId: string, body: AnnotationInput) =>
    req<Annotation>("POST", `/documents/${docId}/annotations`, body),
  updateAnnotation: (id: string, body: Partial<Pick<AnnotationInput, "color" | "opacity" | "text">>) =>
    req<Annotation>("PATCH", `/annotations/${id}`, body),
  deleteAnnotation: (id: string) => req<void>("DELETE", `/annotations/${id}`),
  rotatePages: (docId: string, pages: number[], angle: 90 | 180 | 270, fingerprint: string) =>
    req<EditResult>("POST", `/documents/${docId}/pages/rotate`, { pages, angle, fingerprint }),
  movePages: (docId: string, pages: number[], after: number, fingerprint: string) =>
    req<EditResult>("POST", `/documents/${docId}/pages/move`, { pages, after, fingerprint }),
  libraryFolders: () => req<LibraryFolder[]>("GET", "/library/folders"),
  createPdfs: (body: CreatePdfsRequest) => req<{ folder: string; documents: DocumentRecord[] }>("POST", "/pdf-tools/create", body),
  bookmarks: (docId: string) => req<{ imported: boolean; bookmarks: Bookmark[] }>("GET", `/documents/${docId}/bookmarks`),
  importOutline: (docId: string, entries: OutlineEntry[]) =>
    req<{ imported: boolean; bookmarks: Bookmark[] }>("POST", `/documents/${docId}/bookmarks/import`, { entries }),
  createBookmark: (docId: string, body: BookmarkInput) => req<Bookmark>("POST", `/documents/${docId}/bookmarks`, body),
  updateBookmark: (id: string, body: Partial<Omit<BookmarkInput, "id">>) => req<Bookmark>("PATCH", `/bookmarks/${id}`, body),
  deleteBookmark: (id: string) => req<void>("DELETE", `/bookmarks/${id}`),
  saveAnnotationsToFile: (docId: string, fingerprint: string) =>
    req<EditResult>("POST", `/documents/${docId}/annotations/save`, { fingerprint }),

  insertBlankPage: (docId: string, after: number, fingerprint: string, count = 1) =>
    req<EditResult>("POST", `/documents/${docId}/pages/insert-blank`, { after, count, fingerprint }),
  insertPagesFrom: (
    docId: string,
    body: { after: number; sourceDocumentId: string; fromPage: number; toPage: number; fingerprint: string },
  ) => req<EditResult>("POST", `/documents/${docId}/pages/insert-from`, body),
  replacePages: (
    docId: string,
    body: { page: number; sourceDocumentId: string; fromPage: number; toPage: number; keepAnnotations: boolean; fingerprint: string },
  ) => req<EditResult>("POST", `/documents/${docId}/pages/replace`, body),
  deletePages: (docId: string, pages: number[], fingerprint: string, orphans: OrphanPolicy) =>
    req<EditResult>("POST", `/documents/${docId}/pages/delete`, { pages, fingerprint, orphans }),
  ocrStatus: () => req<OcrStatus>("GET", "/ocr/status"),
  startOcr: (docId: string, pages: number[], fingerprint: string) => req<OcrJob>("POST", `/documents/${docId}/ocr`, { pages, fingerprint }),
  ocrJob: (jobId: string) => req<OcrJob>("GET", `/ocr/jobs/${jobId}`),
  ocrJobFileUrl: (jobId: string) => `/api/ocr/jobs/${jobId}/file`,
  applyOcr: (jobId: string, fingerprint: string) => req<EditResult>("POST", `/ocr/jobs/${jobId}/apply`, { fingerprint }),
  discardOcr: (jobId: string) => req<void>("DELETE", `/ocr/jobs/${jobId}`),
  ocrImage: async (png: Blob): Promise<string> => {
    const res = await fetch("/api/ocr/image", { method: "POST", headers: { ...CSRF_HEADER, "Content-Type": "image/png" }, body: png });
    if (res.status === 401) authListener?.();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
    return (data as { text: string }).text;
  },
  undoFileEdit: (docId: string, editId: string) => req<DocumentRecord>("POST", `/documents/${docId}/history/${editId}/undo`),

  aiGenerate: (body: { documentId: string; task: "explain" | "summarize"; pageStart: number; pageEnd: number; text: string }) =>
    req<Resource>("POST", "/ai/generate", body),
};
