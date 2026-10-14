import { useEffect, useRef, useState } from "react";
import type { Annotation, NormPoint, NormRect } from "../../lib/types";
import type { AnnotationInput } from "../../lib/api";
import { hitTest, simplifyPath, type Tool } from "./geometry";

interface Props {
  page: number;
  width: number;
  height: number;
  annotations: Annotation[];
  tool: Tool;
  color: string;
  penWidth: number;
  selectedId: string | null;
  onCreate: (a: AnnotationInput) => void;
  onErase: (id: string) => void;
  /** The "OCR a region" tool: a box was drawn on this page (normalised coordinates). */
  onRegion?: (page: number, rect: NormRect) => void;
}

/**
 * SVG layer drawing a page's annotations and capturing pen / area / eraser input.
 * Coordinates are stored normalised to the page (0..1) so they survive zoom changes.
 */
export function AnnotationOverlay({ page, width, height, annotations, tool, color, penWidth, selectedId, onCreate, onErase, onRegion }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  /**
   * A box (area highlight or OCR region) is made by dragging, or by clicking its two corners: after a
   * click without dragging the box is `armed`, follows the pointer, and the next click finishes it.
   */
  const [draft, setDraft] = useState<{ kind: "ink"; points: NormPoint[] } | { kind: "area"; start: NormPoint; end: NormPoint; armed?: boolean } | null>(null);
  const armed = draft?.kind === "area" && !!draft.armed;

  // Esc, another tool, or a click outside this page drops a box waiting for its second corner.
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setDraft(null);
    };
    const onDown = (e: PointerEvent) => !svgRef.current?.contains(e.target as Node) && setDraft(null);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [armed]);
  useEffect(() => setDraft(null), [tool]);
  const erased = useRef(new Set<string>());
  const interactive = tool === "pen" || tool === "area" || tool === "eraser" || tool === "ocr";

  const toNorm = (e: React.PointerEvent): NormPoint => {
    const r = svgRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const eraseAt = (p: NormPoint) => {
    const hit = hitTest(annotations, p, height / width, 0.012);
    if (hit && !erased.current.has(hit.id)) {
      erased.current.add(hit.id);
      onErase(hit.id);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || e.button !== 0) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toNorm(e);
    if (draft?.kind === "area" && draft.armed) return finishBox(draft.start, p); // the second corner
    if (tool === "pen") setDraft({ kind: "ink", points: [p] });
    else if (tool === "area" || tool === "ocr") setDraft({ kind: "area", start: p, end: p });
    else if (tool === "eraser") {
      erased.current = new Set();
      eraseAt(p);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive) return;
    if (tool === "eraser" && e.buttons === 1) return eraseAt(toNorm(e));
    if (!draft) return;
    const p = toNorm(e);
    if (draft.kind === "ink") setDraft({ kind: "ink", points: [...draft.points, p] });
    else setDraft({ ...draft, end: p });
  };

  const bigEnough = (a: NormPoint, b: NormPoint) => Math.abs(b[0] - a[0]) > 0.005 && Math.abs(b[1] - a[1]) > 0.003;

  const finishBox = (a: NormPoint, b: NormPoint) => {
    setDraft(null);
    if (!bigEnough(a, b)) return;
    const rect = { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
    if (tool === "ocr") onRegion?.(page, rect);
    else onCreate({ page, kind: "area", color, opacity: 0.35, rects: [rect] });
  };

  const onPointerUp = () => {
    if (!draft) return;
    if (draft.kind === "ink") {
      onCreate({ page, kind: "ink", color, opacity: 1, paths: [simplifyPath(draft.points)], strokeWidth: penWidth });
      setDraft(null);
    } else if (!draft.armed) {
      // A drag makes the box now; a plain click is its first corner, waiting for the second.
      if (bigEnough(draft.start, draft.end)) finishBox(draft.start, draft.end);
      else setDraft({ ...draft, armed: true });
    }
  };

  const pathD = (pts: NormPoint[]) =>
    pts.length === 1
      ? `M${pts[0][0] * width},${pts[0][1] * height}l0.01,0`
      : pts.map((p, i) => `${i ? "L" : "M"}${p[0] * width},${p[1] * height}`).join("");

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0"
      width={width}
      height={height}
      style={{
        zIndex: interactive ? 4 : 1,
        pointerEvents: interactive ? "auto" : "none",
        cursor: tool === "pen" || tool === "ocr" ? "crosshair" : tool === "area" ? "cell" : tool === "eraser" ? "pointer" : undefined,
        touchAction: interactive ? "none" : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => !armed && setDraft(null)}
    >
      {annotations.map((a) =>
        a.kind === "ink" ? (
          <g key={a.id}>
            {a.paths.map((p, i) => (
              <path
                key={i}
                d={pathD(p)}
                fill="none"
                stroke={a.color}
                strokeOpacity={a.opacity}
                strokeWidth={Math.max(1, a.strokeWidth * width)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {selectedId === a.id &&
              a.paths.map((p, i) => (
                <path key={`s${i}`} d={pathD(p)} fill="none" stroke="var(--ss-accent)" strokeOpacity={0.35} strokeWidth={Math.max(6, a.strokeWidth * width + 6)} strokeLinecap="round" />
              ))}
          </g>
        ) : (
          <g key={a.id} style={{ mixBlendMode: "multiply" }}>
            {a.rects.map((r, i) => (
              <rect key={i} x={r.x * width} y={r.y * height} width={r.w * width} height={r.h * height} fill={a.color} fillOpacity={Math.min(0.85, a.opacity + 0.1)} rx={2} />
            ))}
            {selectedId === a.id &&
              a.rects.map((r, i) => (
                <rect key={`s${i}`} x={r.x * width - 2} y={r.y * height - 2} width={r.w * width + 4} height={r.h * height + 4} fill="none" stroke="var(--ss-accent)" strokeWidth={1.5} rx={3} />
              ))}
          </g>
        ),
      )}
      {draft?.kind === "ink" && (
        <path d={pathD(draft.points)} fill="none" stroke={color} strokeWidth={Math.max(1, penWidth * width)} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {draft?.kind === "area" && draft.armed && (
        <g pointerEvents="none">
          <circle cx={draft.start[0] * width} cy={draft.start[1] * height} r={4} fill={tool === "ocr" ? "var(--ss-accent)" : color} stroke="white" strokeWidth={1.5} />
          {!bigEnough(draft.start, draft.end) && (
            <text x={draft.start[0] * width + 8} y={draft.start[1] * height - 8} fontSize={11} fill="var(--ss-accent)" style={{ paintOrder: "stroke", stroke: "white", strokeWidth: 3 }}>
              Click the opposite corner · Esc cancels
            </text>
          )}
        </g>
      )}
      {draft?.kind === "area" && (
        <rect
          pointerEvents="none"
          x={Math.min(draft.start[0], draft.end[0]) * width}
          y={Math.min(draft.start[1], draft.end[1]) * height}
          width={Math.abs(draft.end[0] - draft.start[0]) * width}
          height={Math.abs(draft.end[1] - draft.start[1]) * height}
          fill={tool === "ocr" ? "var(--ss-accent)" : color}
          fillOpacity={tool === "ocr" ? 0.08 : 0.35}
          stroke={tool === "ocr" ? "var(--ss-accent)" : color}
          strokeWidth={tool === "ocr" ? 1.5 : 1}
          strokeDasharray="4 3"
        />
      )}
    </svg>
  );
}
