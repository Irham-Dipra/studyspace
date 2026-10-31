import type { DocumentKind } from "./library/fileKinds.js";
export const RESOURCE_TYPES = ["note", "ai_explanation", "summary", "pyq", "link"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const RESOURCE_SCOPES = ["page", "range", "document"] as const;
export type ResourceScope = (typeof RESOURCE_SCOPES)[number];

/** "text": a text box typed on the page (rects[0] = its box, strokeWidth = font size as a share of the page width). */
export const ANNOTATION_KINDS = ["highlight", "area", "ink", "text"] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

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
  /** "slides" (PowerPoint) are shown through a converted PDF and can't be edited. */
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
  annotationsDirty: boolean;
  /** Bookmarks were changed in StudySpace and not yet written into the PDF. */
  bookmarksDirty: boolean;
  /** The PDF's own outline has been read into the bookmarks table (it is only rewritten after that). */
  outlineImported: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
}

export interface Resource {
  id: string;
  documentId: string;
  type: ResourceType;
  scope: ResourceScope;
  /** 1-based inclusive range; null for document-wide resources. */
  pageStart: number | null;
  pageEnd: number | null;
  title: string;
  content: string;
  url: string | null;
  /** Colours picked for single headings/labels/marks of the note: element key → "#rrggbb" or "none". */
  styles: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/**
 * A marker on a page that opens a note, at the passage `quote` (with `prefix` / `suffix` around it,
 * anchored like a note highlight), or the whole note when `quote` is empty. `x`, `y`: the spot it
 * marks, in normalised display coordinates.
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

/** All geometry is normalised to the displayed page: (0,0) top-left, (1,1) bottom-right. */
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
  /** Stroke width as a fraction of the displayed page width. */
  strokeWidth: number;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/** A highlight on the rendered text of a note/resource, anchored by its quote and surrounding text. */
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

/** A highlight on the text of an HTML or Markdown document, anchored like a note highlight. */
export interface DocumentHighlight {
  id: string;
  documentId: string;
  color: string;
  quote: string;
  prefix: string;
  suffix: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReadingProgress {
  documentId: string;
  page: number;
  zoom: number;
  /** Documents without pages (HTML, Markdown): how far down, 0 = top, 1 = bottom. */
  top: number | null;
  updatedAt: string;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Bookmark {
  id: string;
  documentId: string;
  parentId: string | null;
  position: number;
  title: string;
  page: number;
  /** 0 = top of the page (normalised display coordinates); null = start of the page. */
  top: number | null;
  createdAt: string;
  updatedAt: string;
}
