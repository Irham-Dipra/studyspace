/** Page geometry needed to map normalised display coordinates into PDF user space. */
export interface PageGeometry {
  /** Visible box (CropBox, falling back to MediaBox): [x0, y0, x1, y1] in PDF units. */
  box: [number, number, number, number];
  /** Page /Rotate value, normalised to 0, 90, 180 or 270. */
  rotation: number;
}

export function normaliseRotation(deg: number): number {
  return (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
}

/**
 * Converts a point given in normalised display space ((0,0) = top-left of the page as the user
 * sees it, (1,1) = bottom-right) into PDF user-space coordinates, honouring /Rotate and the CropBox.
 */
export function displayToPdf(u: number, v: number, g: PageGeometry): [number, number] {
  const [x0, y0, x1, y1] = g.box;
  const w = x1 - x0;
  const h = y1 - y0;
  switch (normaliseRotation(g.rotation)) {
    case 90:
      return [x0 + v * w, y0 + u * h];
    case 180:
      return [x1 - u * w, y0 + v * h];
    case 270:
      return [x1 - v * w, y1 - u * h];
    default:
      return [x0 + u * w, y1 - v * h];
  }
}

/** Width of the page as displayed (after rotation), in PDF units. */
export function displayWidth(g: PageGeometry): number {
  const [x0, y0, x1, y1] = g.box;
  return normaliseRotation(g.rotation) % 180 === 0 ? x1 - x0 : y1 - y0;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [1, 0.92, 0.23];
  const n = Number.parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Where a point in normalised display coordinates (0..1, origin top-left) ends up after the page is
 * turned clockwise by `angle` (a multiple of 90). Used to keep highlights on their content.
 */
export function rotateNormPoint([x, y]: [number, number], angle: number): [number, number] {
  switch (normaliseRotation(angle)) {
    case 90:
      return [1 - y, x];
    case 180:
      return [1 - x, 1 - y];
    case 270:
      return [y, 1 - x];
    default:
      return [x, y];
  }
}

export function rotateNormRect(r: { x: number; y: number; w: number; h: number }, angle: number): { x: number; y: number; w: number; h: number } {
  const [ax, ay] = rotateNormPoint([r.x, r.y], angle);
  const [bx, by] = rotateNormPoint([r.x + r.w, r.y + r.h], angle);
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}
