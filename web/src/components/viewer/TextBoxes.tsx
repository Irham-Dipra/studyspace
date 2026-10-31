import { AArrowDown, AArrowUp } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Annotation, NormPoint, NormRect } from "../../lib/types";
import type { AnnotationInput, AnnotationPatch } from "../../lib/api";
import { matches, withKey } from "../../lib/shortcuts";
import { PEN_COLORS, TEXT_FONT, TEXT_LINE, TEXT_PAD, type Tool } from "./geometry";

interface Props {
  page: number;
  /** The page's size on screen, in CSS pixels. */
  width: number;
  height: number;
  /** This page's text boxes. */
  boxes: Annotation[];
  tool: Tool;
  /** Colour and size for a new box. */
  color: string;
  size: number;
  /** A box to start editing (from the annotation menu's Edit). */
  editId: string | null;
  onEditDone: () => void;
  onCreate: (a: AnnotationInput) => void;
  onUpdate: (id: string, patch: AnnotationPatch) => void;
  onDelete: (id: string) => void;
}

interface Edit {
  id: string | null;
  rect: NormRect;
  text: string;
  color: string;
  size: number;
}

const DRAG_PX = 3;
const MIN_SIZE = 0.008;
const MAX_SIZE = 0.08;
const STEP = 1.15;

/** How a box's text looks: the same layout the server draws into the PDF. */
const textStyle = (color: string, fontPx: number): React.CSSProperties => ({
  color,
  fontSize: fontPx,
  lineHeight: TEXT_LINE,
  padding: `${TEXT_PAD}em`,
  fontFamily: TEXT_FONT,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});

/**
 * Text boxes typed on a page. With the text tool: click (or drag a width) to start one, click a box
 * to edit it, drag a box to move it. Otherwise they're only shown (the viewer's menu edits them).
 */
export function TextBoxes({ page, width, height, boxes, tool, color, size, editId, onEditDone, onCreate, onUpdate, onDelete }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const editRef = useRef(edit);
  editRef.current = edit;
  /** A new box's width being dragged out. */
  const [draft, setDraft] = useState<{ start: NormPoint; end: NormPoint } | null>(null);
  /** A box being moved: where the pointer started and where the box is now. */
  const [drag, setDrag] = useState<{ id: string; from: [number, number]; orig: NormRect; rect: NormRect; moved: boolean } | null>(null);
  const active = tool === "text";

  const toNorm = (e: { clientX: number; clientY: number }): NormPoint => {
    const r = layerRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const open = (a: Annotation) => setEdit({ id: a.id, rect: a.rects[0], text: a.text, color: a.color, size: a.strokeWidth });

  // Edit asked for from the viewer's menu.
  useEffect(() => {
    const a = editId ? boxes.find((b) => b.id === editId) : undefined;
    if (a) open(a);
  }, [editId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The text box grows with its text; the caret goes to the end.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [edit?.text, edit?.id, edit?.size, edit?.rect.w, width]);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [edit?.id, edit?.rect.x, edit?.rect.y]);

  /** Saves what was typed: a new box, a changed one, or (emptied) removes it. */
  const commit = () => {
    const e = editRef.current;
    if (!e) return;
    editRef.current = null;
    setEdit(null);
    onEditDone();
    const h = Math.min(1, (areaRef.current?.scrollHeight ?? 0) / height) || e.rect.h;
    const rect = { ...e.rect, h };
    const text = e.text.replace(/\s+$/, "");
    if (e.id === null) {
      if (text.trim()) onCreate({ page, kind: "text", color: e.color, opacity: 1, rects: [rect], strokeWidth: e.size, text });
      return;
    }
    const before = boxes.find((b) => b.id === e.id);
    if (!before) return;
    if (!text.trim()) onDelete(e.id);
    else {
      const patch: AnnotationPatch = {};
      if (text !== before.text) patch.text = text;
      if (e.color !== before.color) patch.color = e.color;
      if (Math.abs(e.size - before.strokeWidth) > 1e-5) patch.strokeWidth = e.size;
      if (Math.abs(before.rects[0].h - h) > 0.002 || Math.abs(before.rects[0].w - rect.w) > 0.002) patch.rects = [rect];
      if (Object.keys(patch).length) onUpdate(e.id, patch);
    }
  };
  const cancel = () => {
    editRef.current = null;
    setEdit(null);
    onEditDone();
  };

  // Another tool: finish what's being typed.
  useEffect(() => {
    if (!active && editRef.current?.id === null) commit();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const onLayerDown = (e: React.PointerEvent) => {
    if (!active || e.button !== 0) return;
    e.preventDefault();
    // A click outside the box being typed finishes it (instead of starting another).
    if (editRef.current) return commit();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toNorm(e);
    setDraft({ start: p, end: p });
  };
  const onLayerMove = (e: React.PointerEvent) => draft && setDraft({ ...draft, end: toNorm(e) });
  const onLayerUp = () => {
    if (!draft) return;
    setDraft(null);
    const { start, end } = draft;
    const fontPx = size * width;
    // A drag sets the width; a click gives a box to the right of the spot (inside the page).
    const dragged = Math.abs(end[0] - start[0]) * width > 12;
    const x = dragged ? Math.min(start[0], end[0]) : start[0];
    const w = dragged ? Math.abs(end[0] - start[0]) : Math.max(0.08, Math.min(0.4, 0.99 - x));
    const lineH = (fontPx * (TEXT_LINE + 2 * TEXT_PAD)) / height;
    const y = Math.max(0, Math.min(1 - lineH, start[1] - lineH / 2));
    setEdit({ id: null, rect: { x, y, w, h: lineH }, text: "", color, size });
  };

  const onBoxDown = (e: React.PointerEvent, a: Annotation) => {
    if (!active || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (editRef.current) commit();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: a.id, from: [e.clientX, e.clientY], orig: a.rects[0], rect: a.rects[0], moved: false });
  };
  const onBoxMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.from[0];
    const dy = e.clientY - drag.from[1];
    const moved = drag.moved || Math.hypot(dx, dy) > DRAG_PX;
    const o = drag.orig;
    const x = Math.min(1 - o.w, Math.max(0, o.x + dx / width));
    const y = Math.min(1 - o.h, Math.max(0, o.y + dy / height));
    setDrag({ ...drag, moved, rect: { ...o, x, y } });
  };
  const onBoxUp = (a: Annotation) => {
    if (!drag) return;
    setDrag(null);
    if (drag.moved) onUpdate(a.id, { rects: [drag.rect] });
    else open(a);
  };

  const fontOf = (s: number) => Math.max(4, s * width);

  /** Text size one step up or down (about 15%), within what the server accepts. */
  const stepSize = (dir: 1 | -1) =>
    setEdit((e) => (e ? { ...e, size: Math.min(MAX_SIZE, Math.max(MIN_SIZE, e.size * (dir > 0 ? STEP : 1 / STEP))) } : e));

  /** Drag the right edge of the box being typed to change its width. */
  const startResize = (ev: React.PointerEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const target = ev.currentTarget as Element;
    target.setPointerCapture?.(ev.pointerId);
    const move = (m: PointerEvent) =>
      setEdit((e) => {
        if (!e) return e;
        const r = layerRef.current!.getBoundingClientRect();
        const w = Math.min(1 - e.rect.x, Math.max(0.04, (m.clientX - r.left) / r.width - e.rect.x));
        return { ...e, rect: { ...e.rect, w } };
      });
    const up = () => {
      target.removeEventListener("pointermove", move as EventListener);
      target.removeEventListener("pointerup", up);
      areaRef.current?.focus();
    };
    target.addEventListener("pointermove", move as EventListener);
    target.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={layerRef}
      className="absolute inset-0"
      style={{ zIndex: active ? 5 : 2, pointerEvents: active ? "auto" : "none", cursor: active ? "text" : undefined, touchAction: active ? "none" : undefined }}
      onPointerDown={onLayerDown}
      onPointerMove={onLayerMove}
      onPointerUp={onLayerUp}
    >
      {boxes.map((a) => {
        if (edit?.id === a.id || !a.rects[0]) return null;
        const r = drag?.id === a.id ? drag.rect : a.rects[0];
        return (
          <div
            key={a.id}
            data-text-box={a.id}
            className={active ? "absolute rounded-sm outline-1 outline-dashed outline-transparent hover:outline-[var(--ss-accent)]" : "absolute"}
            style={{
              left: r.x * width,
              top: r.y * height,
              width: r.w * width,
              minHeight: r.h * height,
              ...textStyle(a.color, fontOf(a.strokeWidth)),
              pointerEvents: active ? "auto" : "none",
              cursor: active ? "move" : undefined,
            }}
            title={active ? "Click to edit · drag to move" : undefined}
            onPointerDown={(e) => onBoxDown(e, a)}
            onPointerMove={onBoxMove}
            onPointerUp={() => onBoxUp(a)}
          >
            {a.text}
          </div>
        );
      })}
      {draft && Math.abs(draft.end[0] - draft.start[0]) * width > 12 && (
        <div
          className="pointer-events-none absolute border border-dashed"
          style={{
            left: Math.min(draft.start[0], draft.end[0]) * width,
            top: draft.start[1] * height - (size * width * TEXT_LINE) / 2,
            width: Math.abs(draft.end[0] - draft.start[0]) * width,
            height: size * width * (TEXT_LINE + 2 * TEXT_PAD),
            borderColor: color,
          }}
        />
      )}
      {edit && (
        <div className="absolute" style={{ left: edit.rect.x * width, top: edit.rect.y * height, width: edit.rect.w * width }}>
          {/* The bar's buttons keep the focus in the text (onMouseDown), so a click on them doesn't finish the box. */}
          <div
            className={`absolute left-0 z-10 flex items-center gap-1 rounded-lg border border-line bg-panel p-1 shadow-lg ${edit.rect.y * height < 44 ? "top-full mt-1" : "bottom-full mb-1"}`}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.preventDefault()}
          >
            {PEN_COLORS.map((c, i) => (
              <button
                key={c}
                type="button"
                title={withKey(`Colour ${i + 1}`, "textColour")}
                aria-label={`Colour ${i + 1}`}
                className={`size-5 rounded-full border transition hover:scale-110 ${edit.color === c ? "border-ink ring-2 ring-accent/40" : "border-black/10"}`}
                style={{ background: c }}
                onClick={() => setEdit({ ...edit, color: c })}
              />
            ))}
            <div className="mx-0.5 h-4 w-px bg-line" />
            <button type="button" title={withKey("Smaller text", "textSmaller")} aria-label="Smaller text" className="rounded-md p-1 text-ink-2 hover:bg-hover" onClick={() => stepSize(-1)}>
              <AArrowDown className="size-4" />
            </button>
            <button type="button" title={withKey("Larger text", "textBigger")} aria-label="Larger text" className="rounded-md p-1 text-ink-2 hover:bg-hover" onClick={() => stepSize(1)}>
              <AArrowUp className="size-4" />
            </button>
          </div>
          <textarea
            ref={areaRef}
            aria-label="Text box"
            data-arrow-nav="off"
            spellCheck
            value={edit.text}
            placeholder="Type here…"
            className="block w-full resize-none overflow-hidden rounded-sm border border-dashed border-[var(--ss-accent)] bg-white/70 outline-none placeholder:text-neutral-400"
            style={textStyle(edit.color, fontOf(edit.size))}
            onChange={(e) => setEdit({ ...edit, text: e.target.value })}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancel();
              } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                commit();
              } else if (matches(e.nativeEvent, "textBigger") || matches(e.nativeEvent, "textSmaller")) {
                e.preventDefault();
                stepSize(matches(e.nativeEvent, "textBigger") ? 1 : -1);
              } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && /^Digit[1-5]$/.test(e.code)) {
                e.preventDefault();
                setEdit({ ...edit, color: PEN_COLORS[Number(e.code.slice(5)) - 1] });
              }
            }}
          />
          <div
            role="separator"
            aria-label="Drag to change the width"
            title="Drag to change the width"
            className="absolute -right-1 top-0 h-full w-2 cursor-ew-resize rounded bg-[var(--ss-accent)] opacity-40 hover:opacity-100"
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={startResize}
          />
        </div>
      )}
    </div>
  );
}
