import path from "node:path";

/**
 * Files the library shows. Slides (PowerPoint) can't be shown by pdf.js, so they are turned into a
 * PDF by LibreOffice when first opened (services/slides.ts) and are read-only. HTML pages (e.g. Claude
 * artifacts) and Markdown files are shown as text that flows, with no pages, and are read-only too.
 */
export type DocumentKind = "pdf" | "slides" | "html" | "markdown";

const KINDS: Record<string, DocumentKind> = {
  ".pdf": "pdf",
  ".pptx": "slides",
  ".ppt": "slides",
  ".html": "html",
  ".htm": "html",
  ".md": "markdown",
  ".markdown": "markdown",
};

export const kindOf = (file: string): DocumentKind => KINDS[path.extname(file).toLowerCase()] ?? "pdf";

export const isLibraryFile = (name: string): boolean => path.extname(name).toLowerCase() in KINDS;

/** Shown as pages by pdf.js (slides through the PDF they were turned into). */
export const isPaged = (kind: DocumentKind): boolean => kind === "pdf" || kind === "slides";

/** StudySpace may rewrite the file itself: page edits, Save to PDF, an OCR text layer. */
export const canEditFile = (kind: DocumentKind): boolean => kind === "pdf";

/** The extensions the title leaves out ("Notes.md" → "Notes"). */
export const LIBRARY_EXTENSION = /\.(pdf|pptx?|html?|md|markdown)$/i;
