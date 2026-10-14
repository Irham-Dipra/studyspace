import { useRef, useState } from "react";
import { cx } from "./ui";

interface Props {
  /** Current width of the panel this handle resizes, in px. */
  value: number;
  min: number;
  max: number;
  /** Width restored on double-click. */
  defaultValue: number;
  /** "left": the panel is on the left of the handle (drag right = wider). "right": the opposite. */
  panel: "left" | "right";
  label: string;
  onChange: (width: number) => void;
}

const clamp = (v: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, v)));

/**
 * A vertical drag bar between two columns. Drag to resize, double-click to reset,
 * or focus it and use ←/→ (Shift for bigger steps).
 */
export function ResizeHandle({ value, min, max, defaultValue, panel, label, onChange }: Props) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dir = panel === "left" ? 1 : -1;

  const end = () => {
    start.current = null;
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} — drag to resize, double-click to reset`}
      className="group relative z-20 w-0 shrink-0 cursor-col-resize outline-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width: value };
        setDragging(true);
        // Keep the resize cursor and avoid selecting PDF text while dragging.
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onChange(clamp(start.current.width + dir * (e.clientX - start.current.x), min, max));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onChange(clamp(defaultValue, min, max))}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (["ArrowLeft", "ArrowRight"].includes(e.key)) e.stopPropagation(); // don't also turn the page
        if (e.key === "ArrowLeft") (e.preventDefault(), onChange(clamp(value - dir * step, min, max)));
        else if (e.key === "ArrowRight") (e.preventDefault(), onChange(clamp(value + dir * step, min, max)));
        else if (e.key === "Home" || e.key === "End") e.stopPropagation();
      }}
    >
      {/* Wide invisible hit area centred on the 1px divider line. */}
      <div className="absolute inset-y-0 -left-[5px] w-[11px]" />
      <div
        className={cx(
          "pointer-events-none absolute inset-y-0 -left-px w-px transition-colors",
          dragging ? "bg-accent" : "bg-line group-hover:bg-accent/60 group-focus-visible:bg-accent",
        )}
      />
      <div
        className={cx(
          "pointer-events-none absolute left-1/2 top-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-opacity",
          dragging ? "bg-accent opacity-100" : "bg-ink-3 opacity-0 group-hover:opacity-60 group-focus-visible:opacity-100",
        )}
      />
    </div>
  );
}
