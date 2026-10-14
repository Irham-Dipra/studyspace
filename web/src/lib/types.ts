export type ResourceType = "note" | "ai_explanation" | "summary" | "pyq" | "link";
export type ResourceScope = "page" | "range" | "document";
export type AnnotationKind = "highlight" | "area" | "ink";

export interface Directory {
  id: number;
  path: string;
  label: string;
  excludes: string[];
  enabled: boolean;
  createdAt: string;
  lastScannedAt: string | null;
}

export interface DocumentRecord {
  id: string;
  directoryId: number | null;
  path: string;
  relPath: string;
  title: string;
  fingerprint: string;
  size: number;
  mtimeMs: number;
  pageCount: number | null;
  missing: boolean;
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
export const hasUnsavedChanges = (d: Pick<DocumentRecord, "annotationsDirty" | "bookmarksDirty">) => d.annotationsDirty || d.bookmarksDirty;

export interface ReadingProgress {
  documentId: string;
  page: number;
  zoom: number;
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
  createdAt: string;
  updatedAt: string;
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

export interface ScanResult {
  scanned: number;
  added: number;
  moved: number;
  changed: number;
  missing: number;
  errors: string[];
}

export interface AppConfigInfo {
  dataDir: string;
  databasePath: string;
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
