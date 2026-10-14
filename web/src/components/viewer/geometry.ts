import type { Annotation, NormPoint, NormRect } from "../../lib/types";

export type Tool = "select" | "highlight" | "area" | "pen" | "eraser" | "ocr";

export const HIGHLIGHT_COLORS = ["#ffd54f", "#81c784", "#64b5f6", "#f48fb1", "#ff8a65"];
export const PEN_COLORS = ["#e53935", "#1e88e5", "#43a047", "#212121", "#8e24aa"];

/** Merges per-glyph-run client rects into one rect per text line. Inputs are in page pixels. */
export function mergeLineRects(rects: DOMRect[] | { left: number; top: number; width: number; height: number }[]) {
  const rs = rects
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) => ({ x1: r.left, y1: r.top, x2: r.left + r.width, y2: r.top + r.height }))
    .sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const r of rs) {
    const h = r.y2 - r.y1;
    const line = lines.find((l) => {
      const overlap = Math.min(l.y2, r.y2) - Math.max(l.y1, r.y1);
      return overlap > 0.5 * Math.min(h, l.y2 - l.y1) && r.x1 <= l.x2 + h * 1.5 && r.x2 >= l.x1 - h * 1.5;
    });
    if (line) {
      line.x1 = Math.min(line.x1, r.x1);
      line.x2 = Math.max(line.x2, r.x2);
      line.y1 = Math.min(line.y1, r.y1);
      line.y2 = Math.max(line.y2, r.y2);
    } else {
      lines.push({ ...r });
    }
  }
  return lines;
}

function distToSegment(p: NormPoint, a: NormPoint, b: NormPoint, aspect: number): number {
  // Measure in a space where x and y have equal physical length (y scaled by aspect = h/w).
  const px = p[0], py = p[1] * aspect;
  const ax = a[0], ay = a[1] * aspect;
  const bx = b[0], by = b[1] * aspect;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Finds the top-most annotation under a normalised point. `aspect` is page height / width. */
export function hitTest(annotations: Annotation[], p: NormPoint, aspect: number, tolerance = 0.008): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i];
    if (a.kind === "ink") {
      const tol = Math.max(tolerance, a.strokeWidth);
      for (const path of a.paths) {
        if (path.length === 1 && distToSegment(p, path[0], path[0], aspect) < tol) return a;
        for (let j = 1; j < path.length; j++) {
          if (distToSegment(p, path[j - 1], path[j], aspect) < tol) return a;
        }
      }
    } else if (a.rects.some((r: NormRect) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h)) {
      return a;
    }
  }
  return null;
}

/** Drops points closer than `minDist` to the previous kept point, to keep ink paths small. */
export function simplifyPath(points: NormPoint[], minDist = 0.0015): NormPoint[] {
  if (points.length < 3) return points;
  const out: NormPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i][0] - last[0], points[i][1] - last[1]) >= minDist) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
}
