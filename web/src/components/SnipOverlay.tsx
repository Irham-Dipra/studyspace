import { useEffect, useRef, useState } from "react";
import type { ScreenRect } from "../lib/snip";
import { Kbd } from "./ui";

interface Props {
  /** The chosen part of the window, or null for the whole window. Called inside the click or key press, so the clipboard accepts it. */
  onPick: (rect: ScreenRect | null) => void;
  onCancel: () => void;
}

type Pt = { x: number; y: number };

const rectOf = (a: Pt, b: Pt): ScreenRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

/**
 * Covers the window to choose a part of it for a screenshot: click the top-left corner, then the
 * bottom-right one (or drag). Enter takes the whole window (or finishes at the pointer); Esc cancels.
 */
export function SnipOverlay({ onPick, onCancel }: Props) {
  const [start, setStart] = useState<Pt | null>(null);
  const [cur, setCur] = useState<Pt | null>(null);
  const dragging = useRef(false);

  const finish = (a: Pt, b: Pt) => {
    const r = rectOf(a, b);
    if (r.w < 4 || r.h < 4) return;
    onPick(r);
  };

  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keysRef.current = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      // First Esc drops a started box, the second one leaves.
      if (start) {
        setStart(null);
        dragging.current = false;
      } else onCancel();
    } else if (e.key === "Enter") {
      if (start && cur) finish(start, cur);
      else if (!start) onPick(null);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, []);

  const pt = (e: React.PointerEvent): Pt => ({ x: Math.min(window.innerWidth, Math.max(0, e.clientX)), y: Math.min(window.innerHeight, Math.max(0, e.clientY)) });

  const r = start && cur ? rectOf(start, cur) : null;
  return (
    <div
      data-snap-ignore
      className="fixed inset-0 z-[400] cursor-crosshair select-none"
      style={{ background: r ? undefined : "rgba(0,0,0,0.18)", touchAction: "none" }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const p = pt(e);
        if (start) return finish(start, p); // the second corner
        setStart(p);
        setCur(p);
        dragging.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => start && setCur(pt(e))}
      onPointerUp={(e) => {
        if (!dragging.current || !start) return;
        dragging.current = false;
        const p = pt(e);
        // A drag makes the box now; a plain click is the first corner.
        if (Math.abs(p.x - start.x) >= 4 && Math.abs(p.y - start.y) >= 4) finish(start, p);
      }}
      onContextMenu={(e) => (e.preventDefault(), onCancel())}
    >
      {r && (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-white"
          style={{ left: r.x, top: r.y, width: r.w, height: r.h, boxShadow: "0 0 0 100vmax rgba(0,0,0,0.35)", outline: "1px solid rgba(0,0,0,0.5)" }}
        >
          <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
            {Math.round(r.w)} × {Math.round(r.h)}
          </span>
        </div>
      )}
      <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-lg bg-black/80 px-3 py-1.5 text-xs text-white shadow-lg">
        {start ? "Click the bottom-right corner" : "Screenshot: click the top-left corner (or drag)"} ·{" "}
        <Kbd className="border-white/30 bg-white/10 text-white/90">Enter</Kbd> {start ? "finish here" : "whole window"} ·{" "}
        <Kbd className="border-white/30 bg-white/10 text-white/90">Esc</Kbd> {start ? "start over" : "cancel"}
      </div>
    </div>
  );
}
