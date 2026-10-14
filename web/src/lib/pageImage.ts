import type { PDFDocumentProxy } from "./pdf";
import type { NormRect } from "./types";

/**
 * Renders part of a page (normalised rect, 0..1 from the top-left as displayed) onto a white canvas,
 * at `dpi` but at most `maxSide` pixels on the longer side.
 */
export async function renderRegion(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  rect: NormRect = { x: 0, y: 0, w: 1, h: 1 },
  { dpi = 300, maxSide = 3500 }: { dpi?: number; maxSide?: number } = {},
): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const regionW = rect.w * base.width;
  const regionH = rect.h * base.height;
  const scale = Math.max(1, Math.min(dpi / 72, maxSide / Math.max(regionW, regionH)));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.w * vp.width));
  canvas.height = Math.max(1, Math.round(rect.h * vp.height));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -rect.x * vp.width, -rect.y * vp.height] }).promise;
  return canvas;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not make the image."))), "image/png"));
}

export async function renderRegionPng(pdf: PDFDocumentProxy, pageNumber: number, rect: NormRect): Promise<Blob> {
  return canvasToPng(await renderRegion(pdf, pageNumber, rect));
}

/** Pages copied to the clipboard: sharp enough to read when pasted, small enough to paste quickly. */
export const COPY_QUALITY = { dpi: 200, maxSide: 3000 };

/**
 * Puts an image (and optionally HTML) on the clipboard. Pass promises for work still in progress: the
 * browser then still counts the key press or click that asked for the copy.
 */
export async function copyToClipboard(png: Promise<Blob> | Blob, html?: Promise<Blob> | Blob): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("This browser can't copy images to the clipboard. Use Save as PNG instead.");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png, ...(html ? { "text/html": html } : {}) })]);
}

export type CutDirection = "across" | "down";

/** The two parts of a canvas cut at `at` (0..1): across = top / bottom, down = left / right. */
export function cutCanvas(src: HTMLCanvasElement, direction: CutDirection, at: number): [HTMLCanvasElement, HTMLCanvasElement] {
  const part = (sx: number, sy: number, w: number, h: number) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    c.getContext("2d")!.drawImage(src, sx, sy, w, h, 0, 0, c.width, c.height);
    return c;
  };
  if (direction === "across") {
    const y = Math.round(src.height * at);
    return [part(0, 0, src.width, y), part(0, y, src.width, src.height - y)];
  }
  const x = Math.round(src.width * at);
  return [part(0, 0, x, src.height), part(x, 0, src.width - x, src.height)];
}

/** Images one under the other with a white gap (the plain-image version of "copy both"). */
export function stackCanvases(parts: HTMLCanvasElement[], gap = 24): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(...parts.map((p) => p.width));
  c.height = parts.reduce((h, p) => h + p.height, 0) + gap * (parts.length - 1);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  let y = 0;
  for (const p of parts) {
    ctx.drawImage(p, 0, y);
    y += p.height + gap;
  }
  return c;
}

/** HTML holding the images as separate pictures, so rich editors (Docs, Word, Notion…) paste two images. */
export function imagesHtml(parts: HTMLCanvasElement[]): Blob {
  const imgs = parts.map((p) => `<p><img src="${p.toDataURL("image/png")}" width="${p.width}" height="${p.height}"></p>`).join("");
  return new Blob([`<meta charset="utf-8">${imgs}`], { type: "text/html" });
}

/** Saves a PNG through the browser's download. */
export function downloadPng(blob: Blob, name: string): void {
  downloadBlob(blob, name.endsWith(".png") ? name : `${name}.png`);
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg", quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not make the image."))), type, quality));
}

/** Saves any file through the browser's download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
