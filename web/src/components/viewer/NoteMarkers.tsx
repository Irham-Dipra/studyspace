import { useRef, useState } from "react";
import { StickyNote } from "lucide-react";
import type { NormPoint } from "../../lib/types";
import { matches } from "../../lib/shortcuts";
import type { Tool } from "./geometry";

/** A marker as the page shows it. */
export interface PageMarker {
  /** The marker's id (not its note's). */
  id: string;
  page: number;
  at: NormPoint;
  /** For the tooltip: the passage it opens at, and the note's title or first line. */
  label: string;
}

interface Props {
  page: number;
  width: number;
  height: number;
  markers: PageMarker[];
  tool: Tool;
  onOpen: (id: string) => void;
  onMove: (id: string, at: NormPoint) => void;
  onDelete: (id: string) => void;
  /** The marker tool: a spot was clicked for a new note. */
  onPlace: (page: number, at: NormPoint) => void;
}

const DRAG_PX = 4;

/**
 * Note markers on a page: click one to open its note, drag it to move it. A marker's square
 * bottom-left corner is the spot it marks.
 */
export function NoteMarkers({ page, width, height, markers, tool, onOpen, onMove, onDelete, onPlace }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; from: [number, number]; orig: NormPoint; at: NormPoint; moved: boolean } | null>(null);
  const placing = tool === "marker";

  const toNorm = (e: { clientX: number; clientY: number }): NormPoint => {
    const r = layerRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  // Keep a marker's clicks to itself: the viewer would otherwise treat them as clicks on the page.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      ref={layerRef}
      className="absolute inset-0"
      style={{ zIndex: 6, pointerEvents: placing ? "auto" : "none", cursor: placing ? "copy" : undefined }}
      onClick={(e) => {
        if (!placing || e.target !== e.currentTarget) return;
        onPlace(page, toNorm(e));
      }}
    >
      {markers.map((m) => {
        const at = drag?.id === m.id ? drag.at : m.at;
        return (
          <button
            key={m.id}
            data-note-marker={m.id}
            className="absolute grid size-6 -translate-y-full place-items-center rounded-full rounded-bl-none border border-amber-600/60 bg-amber-300 text-amber-900 shadow-md transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent"
            style={{ left: at[0] * width, top: at[1] * height, pointerEvents: "auto", touchAction: "none", cursor: drag?.moved ? "grabbing" : "pointer" }}
            title={`${m.label}\nClick to open the note · drag to move · right-click to remove`}
            aria-label={`Note: ${m.label}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              stop(e);
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({ id: m.id, from: [e.clientX, e.clientY], orig: m.at, at: m.at, moved: false });
            }}
            onPointerMove={(e) => {
              if (drag?.id !== m.id) return;
              const dx = e.clientX - drag.from[0];
              const dy = e.clientY - drag.from[1];
              const moved = drag.moved || Math.hypot(dx, dy) > DRAG_PX;
              const x = Math.min(1, Math.max(0, drag.orig[0] + dx / width));
              const y = Math.min(1, Math.max(0, drag.orig[1] + dy / height));
              setDrag({ ...drag, moved, at: [x, y] });
            }}
            onPointerUp={(e) => {
              stop(e);
              if (drag?.id !== m.id) return;
              setDrag(null);
              if (drag.moved) onMove(m.id, [Math.round(drag.at[0] * 10000) / 10000, Math.round(drag.at[1] * 10000) / 10000]);
              else onOpen(m.id);
            }}
            onPointerCancel={() => setDrag(null)}
            onMouseUp={stop}
            onMouseDown={stop}
            onClick={stop}
            onContextMenu={(e) => {
              e.preventDefault();
              stop(e);
              onDelete(m.id);
            }}
            onKeyDown={(e) => {
              if (matches(e.nativeEvent, "markerDelete")) {
                e.preventDefault();
                e.stopPropagation();
                return onDelete(m.id);
              }
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              onOpen(m.id);
            }}
          >
            <StickyNote className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}

