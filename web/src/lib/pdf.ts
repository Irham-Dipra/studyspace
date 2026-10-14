import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type PDFDocumentProxy = pdfjs.PDFDocumentProxy;
export type PDFPageProxy = pdfjs.PDFPageProxy;

/** PDF points → CSS pixels at 100% zoom (matches the pdf.js viewer). */
export const CSS_UNITS = 96 / 72;

/** Author tag StudySpace writes on annotations it saves into PDFs (see server/src/pdf/operations.ts). */
export const STUDYSPACE_AUTHOR = "StudySpace";

export function openPdf(url: string) {
  return pdfjs.getDocument({
    url,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    // Fetch only what is needed via HTTP range requests, so large textbooks open quickly.
    disableAutoFetch: true,
    rangeChunkSize: 256 * 1024,
  });
}

/** Parses "3, 5-7, 10" into a sorted list of unique page numbers within 1..max. */
export function parsePageList(input: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of input.split(",")) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) {
      if (part.trim()) throw new Error(`Cannot understand "${part.trim()}"`);
      continue;
    }
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    for (let p = a; p <= b; p++) {
      if (p < 1 || p > max) throw new Error(`Page ${p} is out of range (1-${max})`);
      out.add(p);
    }
  }
  return [...out].sort((x, y) => x - y);
}
