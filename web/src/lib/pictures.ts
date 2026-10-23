import type { PDFDocumentProxy } from "./pdf";
import { canvasToBlob, renderRegion } from "./pageImage";
import { ZipWriter } from "./zip";

/** Pages as pictures: shared by the Save pictures window and the selected-files window. */

export type PictureFormat = "png" | "jpeg";
export const PICTURE_DPIS = [100, 150, 200, 300];

/** Remembered choices (format and sharpness). */
const PREFS_KEY = "ss-picture-prefs";
export const loadPicturePrefs = (): { format: PictureFormat; dpi: number } => {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { format?: PictureFormat; dpi?: number };
    return { format: p.format === "jpeg" ? "jpeg" : "png", dpi: PICTURE_DPIS.includes(p.dpi ?? 0) ? p.dpi! : 150 };
  } catch {
    return { format: "png", dpi: 150 };
  }
};
export const savePicturePrefs = (prefs: { format: PictureFormat; dpi: number }) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
};

export const safeName = (s: string) => s.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "page";

/** "3", "3-5", "3, 5-7" for file names. */
export function pagesText(pages: number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    runs.push(i === j ? `${pages[i]}` : `${pages[i]}-${pages[j]}`);
    i = j;
  }
  return runs.length > 3 ? `${runs.slice(0, 3).join(", ")}…` : runs.join(", ");
}

/** Rough size per page: a 200 dpi PNG of a text page is about 0.5 MB, a JPEG about a third of that. */
export const mbPerPage = (format: PictureFormat, dpi: number) => (format === "png" ? 0.5 : 0.18) * (dpi / 200) ** 2;

export interface PictureOptions {
  format: PictureFormat;
  dpi: number;
  /** The start of each file name (the PDF's title). */
  base: string;
}

/** One page as a picture, or several as one .zip (each page its own picture), ready to download. */
export async function makePictures(
  pdf: PDFDocumentProxy,
  pages: number[],
  { format, dpi, base }: PictureOptions,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; name: string }> {
  const render = async (n: number) => {
    const canvas = await renderRegion(pdf, n, undefined, { dpi, maxSide: Math.round((dpi / 72) * 1400) });
    const blob = await canvasToBlob(canvas, format === "png" ? "image/png" : "image/jpeg", 0.9);
    canvas.width = canvas.height = 0; // free the pixels now
    return blob;
  };
  const ext = format === "png" ? "png" : "jpg";
  const name = safeName(base);
  if (pages.length === 1) return { blob: await render(pages[0]), name: `${name} - p${pages[0]}.${ext}` };
  const zip = new ZipWriter();
  const width = String(Math.max(...pages)).length;
  for (const [i, n] of pages.entries()) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    zip.add(`${name} - p${String(n).padStart(width, "0")}.${ext}`, new Uint8Array(await (await render(n)).arrayBuffer()));
    onProgress?.(i + 1, pages.length);
  }
  return { blob: zip.finish(), name: `${name} - pages ${pagesText(pages)} (${ext}).zip` };
}
