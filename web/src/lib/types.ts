export type ResourceType = "note" | "ai_explanation" | "summary" | "pyq" | "link";
export type ResourceScope = "page" | "range" | "document";
/** "text": a text box typed on the page (rects[0] = its box, strokeWidth = font size as a share of the page width). */
export type AnnotationKind = "highlight" | "area" | "ink" | "text";

export interface Directory {
  id: number;
  path: string;
  label: string;
  excludes: string[];
  enabled: boolean;
  createdAt: string;
  lastScannedAt: string | null;
}

/**
 * "slides" (PowerPoint) are shown through a PDF LibreOffice makes of them. "html" (e.g. a Claude
 * artifact) and "markdown" are shown as flowing text with no pages. Only PDFs can be edited.
 */
export type DocumentKind = "pdf" | "slides" | "html" | "markdown";

/** Shown as pages by pdf.js. */
export const isPaged = (kind: DocumentKind) => kind === "pdf" || kind === "slides";

/** StudySpace may rewrite the file: page edits, Save to PDF, an OCR text layer. */
export const canEditFile = (kind: DocumentKind) => kind === "pdf";

export interface DocumentRecord {
  id: string;
  kind: DocumentKind;
  directoryId: number | null;
  path: string;
  relPath: string;
  title: string;
  fingerprint: string;
  size: number;
  mtimeMs: number;
  pageCount: number | null;
  missing: boolean;
  /** Hidden from the library list by the user (still opens; listed under Hidden files). */
  hidden: boolean;
  /** Its place in the Favourites list (smaller first); null when it isn't a favourite. */
  favorite: number | null;
  annotationsDirty: boolean;
  /** Bookmarks were changed in StudySpace but not yet written into the PDF's outline. */
  bookmarksDirty: boolean;
  /** The PDF's own outline has been read into StudySpace's bookmarks. */
  outlineImported: boolean;
}

/** An entry of the PDF's outline ("bookmarks" in most PDF readers). */
export interface Bookmark {
  id: string;
  documentId: string;
  parentId: string | null;
  position: number;
  title: string;
  page: number;
  /** Vertical position on the page (0 = top, 1 = bottom), or null for the top of the page. */
  top: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Highlights or bookmarks that are not yet written into the PDF file. */
// Only PDFs take highlights into the file, so for other kinds there is never anything to save there.
export const hasUnsavedChanges = (d: Pick<DocumentRecord, "kind" | "annotationsDirty" | "bookmarksDirty">) =>
  canEditFile(d.kind) && (d.annotationsDirty || d.bookmarksDirty);

export const SLIDES_READ_ONLY = "Slides can't be changed here. To edit pages, make a PDF of them with Page tools → Extract pages.";

export interface ReadingProgress {
  documentId: string;
  page: number;
  zoom: number;
  /** Documents without pages (HTML, Markdown): how far down, 0 = top, 1 = bottom. */
  top?: number | null;
  updatedAt: string | null;
}

export interface Resource {
  id: string;
  documentId: string;
  type: ResourceType;
  scope: ResourceScope;
  pageStart: number | null;
  pageEnd: number | null;
  title: string;
  content: string;
  url: string | null;
  /** Colours picked for single headings, labels or marks (lib/rehypeNoteStyles): key → "#rrggbb" | "none". */
  styles: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/**
 * A marker on a page that opens a note at the passage `quote` (with `prefix` / `suffix` around it,
 * anchored like a note highlight), or the whole note when `quote` is empty. `x`, `y`: the spot it
 * marks, normalised to the page as shown.
 */
export interface NoteMarker {
  id: string;
  resourceId: string;
  page: number;
  x: number;
  y: number;
  quote: string;
  prefix: string;
  suffix: string;
  createdAt: string;
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type NormPoint = [number, number];

export interface Annotation {
  id: string;
  documentId: string;
  page: number;
  kind: AnnotationKind;
  color: string;
  opacity: number;
  rects: NormRect[];
  paths: NormPoint[][];
  strokeWidth: number;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/** A highlight (optionally with a comment) on the rendered text of a note/resource. */
export interface NoteHighlight {
  id: string;
  resourceId: string;
  color: string;
  quote: string;
  prefix: string;
  suffix: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

/** The fields that place a highlight in text that flows (a note, or an HTML / Markdown document). */
export type TextAnchoredHighlight = Pick<NoteHighlight, "id" | "color" | "quote" | "prefix" | "suffix" | "comment">;

/** A highlight on the text of an HTML or Markdown document. */
export interface TextHighlight extends TextAnchoredHighlight {
  documentId: string;
  createdAt: string;
  updatedAt: string;
}

/** The exclude entry that hides one folder (made by the Hide button; "/" = from the library folder). */
export const folderRule = (rel: string) => `/${rel}`;
/** The folders hidden by the Hide button: their rules start with "/" and have no wildcards or regex. */
export const hiddenFolderRules = (d: Directory) => d.excludes.filter((x) => x.startsWith("/") && !/[*?]/.test(x));

export interface ScanResult {
  scanned: number;
  added: number;
  moved: number;
  changed: number;
  missing: number;
  errors: string[];
}

export interface AppConfigInfo {
  /** False on another device (a phone): study folders can then only be changed on the computer. */
  local: boolean;
  /** Only sent to this computer itself. */
  dataDir?: string;
  databasePath?: string;
  historyLimit: number;
  ai: { provider: string; enabled: boolean; message: string };
}

export const RESOURCE_TYPE_LABEL: Record<ResourceType, string> = {
  note: "Personal Note",
  ai_explanation: "AI Explanation",
  summary: "Summary",
  pyq: "Previous Year Question",
  link: "External Link",
};

/** True when a resource should be shown for `page`. */
export function resourceCoversPage(r: Resource, page: number): boolean {
  if (r.scope === "document") return true;
  return r.pageStart !== null && r.pageEnd !== null && r.pageStart <= page && page <= r.pageEnd;
}

export function scopeLabel(r: Pick<Resource, "scope" | "pageStart" | "pageEnd">): string {
  if (r.scope === "document") return "Whole document";
  if (r.pageStart === r.pageEnd) return `Page ${r.pageStart}`;
  return `Pages ${r.pageStart}–${r.pageEnd}`;
}
