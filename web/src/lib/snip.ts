import { domToCanvas } from "modern-screenshot";
import { canvasToPng } from "./pageImage";

export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const frames = (n: number) => new Promise<void>((resolve) => {
  const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
  step(n);
});

/**
 * A picture of part of the app window (CSS pixels, from the top-left of the window), as a PNG.
 * The page is drawn by the browser into an image (no screen-sharing permission needed), at the
 * screen's pixel density. Elements marked `data-snap-ignore` (toasts, the selection overlay) are left out.
 */
export async function captureWindowRegion(rect: ScreenRect): Promise<Blob> {
  await frames(2); // let the selection overlay disappear first
  const scale = window.devicePixelRatio || 1;
  // The app's root element fills the window; drawing <body> itself would add the browser's default page margin.
  const root = document.getElementById("root") ?? document.body;
  const canvas = await domToCanvas(root, {
    scale,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
    filter: (node) => !(node instanceof Element && node.hasAttribute("data-snap-ignore")),
    features: { restoreScrollPosition: true },
  });
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(rect.w * scale));
  out.height = Math.max(1, Math.round(rect.h * scale));
  out.getContext("2d")!.drawImage(canvas, Math.round(rect.x * scale), Math.round(rect.y * scale), out.width, out.height, 0, 0, out.width, out.height);
  return canvasToPng(out);
}
