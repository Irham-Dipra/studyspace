import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Ban, Copy, Highlighter, MapPin, MessageSquare, MessageSquarePlus, Palette, RotateCcw, Trash2, X } from "lucide-react";
import { selectionToAnchor } from "../lib/noteAnchors";
import { STYLE_COLORS } from "../lib/noteColors";
import { copyText } from "../lib/pageImage";
import { belowSelection, useTouchSelection } from "../lib/touchSelection";
import { isTyping, matches } from "../lib/shortcuts";
import type { NoteHighlight, TextAnchoredHighlight } from "../lib/types";
import { HIGHLIGHT_COLORS } from "./viewer/geometry";
import { Markdown } from "./Markdown";
import { Button, cx } from "./ui";

export type Anchor = Pick<NoteHighlight, "quote" | "prefix" | "suffix">;

/** What the floating UI is showing: a bar for a fresh selection, or the menu of an existing highlight. */
export type NotePopover =
  | { kind: "selection"; x: number; y: number; resourceId: string; anchor: Anchor }
  | { kind: "highlight"; x: number; y: number; highlightId: string; editComment?: boolean }
  /** A heading, label or mark with a default colour (key from rehypeNoteStyles, or "title"). */
  | { kind: "style"; x: number; y: number; resourceId: string; key: string };

interface BodyProps {
  resourceId: string;
  content: string;
  highlights: NoteHighlight[];
  styles?: Record<string, string>;
  onPopover: (p: NotePopover | null) => void;
  onRemoveHighlights: (ids: string[]) => void;
}

/**
 * Rendered note content that can be annotated: select text to highlight/comment, click a highlight
 * to change it. Also lists the comments and reports highlights whose text was edited away.
 */
export function NoteBody({ resourceId, content, highlights, styles, onPopover, onRemoveHighlights }: BodyProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [missing, setMissing] = useState<string[]>([]);

  // After rendering, find highlights that couldn't be placed (their text no longer exists).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const shown = new Set([...el.querySelectorAll<HTMLElement>("[data-hl]")].map((m) => m.dataset.hl));
    const gone = highlights.filter((h) => !shown.has(h.id)).map((h) => h.id);
    setMissing((prev) => (prev.length === gone.length && prev.every((id, i) => id === gone[i]) ? prev : gone));
  }, [content, highlights]);

  const onMouseUp = (e: React.MouseEvent) => {
    const { clientX, clientY } = e;
    const target = e.target as HTMLElement;
    // Let the browser finish updating the selection first.
    setTimeout(() => {
      const el = ref.current;
      const sel = window.getSelection();
      if (el && sel && !sel.isCollapsed && sel.rangeCount) {
        const anchor = selectionToAnchor(el, sel.getRangeAt(0));
        if (anchor) return onPopover({ kind: "selection", x: clientX, y: clientY, resourceId, anchor });
      }
      const mark = target.closest<HTMLElement>("[data-hl]");
      if (mark?.dataset.hl) return onPopover({ kind: "highlight", x: clientX, y: clientY, highlightId: mark.dataset.hl });
      // A click on a heading or label with a default colour offers to recolour it (not on its links).
      const styled = target.closest<HTMLElement>("[data-sk]");
      if (styled?.dataset.sk && !target.closest("a") && el?.contains(styled)) {
        onPopover({ kind: "style", x: clientX, y: clientY, resourceId, key: styled.dataset.sk });
      }
    }, 0);
  };

  useTouchSelection(ref, (range) => {
    const anchor = ref.current && selectionToAnchor(ref.current, range);
    if (anchor) onPopover({ kind: "selection", ...belowSelection(range), resourceId, anchor });
  });

  const commented = highlights.filter((h) => h.comment.trim() && !missing.includes(h.id));

  return (
    <div className="mt-2">
      <div ref={ref} onMouseUp={onMouseUp} data-note={resourceId}>
        <Markdown highlights={highlights} styles={styles}>{content}</Markdown>
      </div>

      {commented.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-line pt-2">
          {commented.map((h) => (
            <li key={h.id}>
              <button
                className="flex w-full gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-hover"
                onClick={(e) => onPopover({ kind: "highlight", x: e.clientX, y: e.clientY, highlightId: h.id, editComment: true })}
                title="Edit comment"
              >
                <span className="mt-0.5 w-1 shrink-0 self-stretch rounded" style={{ background: h.color }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate italic text-ink-3">“{h.quote}”</span>
                  <span className="block whitespace-pre-wrap text-ink-2">{h.comment}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {missing.length > 0 && (
        <p className="mt-2 flex items-center gap-2 rounded-md bg-warn/10 px-2 py-1 text-[11px] text-warn">
          <span className="flex-1">
            {missing.length} highlight{missing.length === 1 ? "" : "s"} no longer match{missing.length === 1 ? "es" : ""} the edited text.
          </span>
          <button className="font-medium underline" onClick={() => onRemoveHighlights(missing)}>
            Remove
          </button>
        </p>
      )}
    </div>
  );
}

interface PopoverProps {
  popover: NotePopover;
  highlights: TextAnchoredHighlight[];
  defaultColor: string;
  onClose: () => void;
  /** Replace the current popover (e.g. open the comment box of a highlight just created). */
  onSwitch: (p: NotePopover) => void;
  onCreate: (resourceId: string, anchor: Anchor, color: string) => Promise<TextAnchoredHighlight | undefined>;
  onUpdate: (id: string, patch: { color?: string; comment?: string }) => void;
  onDelete: (id: string) => void;
  /** Offers "Note": the selected text into a new note (documents; inside a note it isn't offered). */
  onQuote?: (text: string) => void;
  /** Offers "Pin on page" (notes): a marker on the page, placed next, that opens the note at this text. */
  onPin?: (resourceId: string, anchor: Anchor) => void;
  /** The colour picked for a note's heading/label/mark, and changing it (null = back to the default). */
  styleOf?: (resourceId: string, key: string) => string | undefined;
  onStyle?: (resourceId: string, key: string, color: string | null) => void;
}

/**
 * Floating bar for a text selection inside a note (or an HTML / Markdown document), or the menu of an
 * existing highlight there.
 */
export function NotePopovers({ popover, highlights, defaultColor, onClose, onSwitch, onCreate, onUpdate, onDelete, onQuote, onPin, styleOf, onStyle }: PopoverProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const highlight = popover.kind === "highlight" ? highlights.find((h) => h.id === popover.highlightId) : undefined;
  const [comment, setComment] = useState(highlight?.comment ?? "");
  const [editing, setEditing] = useState(popover.kind === "highlight" && !!popover.editComment);

  useEffect(() => {
    setComment(highlight?.comment ?? "");
    setEditing(popover.kind === "highlight" && !!popover.editComment);
  }, [popover, highlight?.comment]);

  const restyle = (color: string | null) => {
    if (popover.kind !== "style") return;
    onStyle?.(popover.resourceId, popover.key, color);
    onClose();
  };

  const highlightWith = async (color: string) => {
    if (popover.kind !== "selection") return;
    await onCreate(popover.resourceId, popover.anchor, color);
    window.getSelection()?.removeAllRanges();
    onClose();
  };

  // The bar's keys, as on a PDF (lib/shortcuts.ts): 1–5 colour, N note, Delete removes.
  const keysRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  keysRef.current = (e: KeyboardEvent) => {
    if (editing || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (popover.kind === "style") {
      const n = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1];
      const pick = n === "0" ? "none" : n ? STYLE_COLORS[Number(n) - 1] : matches(e, "styleDefault") ? null : undefined;
      if (pick === undefined) return false;
      restyle(pick);
      return true;
    }
    const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
    const color = digit ? HIGHLIGHT_COLORS[Number(digit[1]) - 1] : undefined;
    if (popover.kind === "selection") {
      if (color) {
        void highlightWith(color);
        return true;
      }
      if (onPin && matches(e, "notePin")) {
        onPin(popover.resourceId, popover.anchor);
        window.getSelection()?.removeAllRanges();
        onClose();
        return true;
      }
      if (onQuote && matches(e, "selNote")) {
        onQuote(popover.anchor.quote);
        window.getSelection()?.removeAllRanges();
        onClose();
        return true;
      }
    } else if (highlight) {
      if (color) {
        onUpdate(highlight.id, { color });
        onClose();
        return true;
      }
      if (matches(e, "selDelete")) {
        onDelete(highlight.id);
        onClose();
        return true;
      }
    }
    return false;
  };

  // Esc or a click elsewhere closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        if (keysRef.current(e)) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();
      onClose();
    };
    const onDown = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && onClose();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  if (popover.kind === "highlight" && !highlight) return null;
  if (popover.kind === "style" && !onStyle) return null;

  const style = { left: Math.max(8, Math.min(popover.x - 20, window.innerWidth - (popover.kind === "style" ? 348 : 300))), top: Math.min(popover.y + 14, window.innerHeight - (editing ? 200 : 60)) };
  const swatches = (active: string | null, pick: (c: string) => void) =>
    HIGHLIGHT_COLORS.map((c) => (
      <button
        key={c}
        title="Highlight colour"
        className={cx("size-6 shrink-0 rounded-full border transition hover:scale-110", active === c ? "border-ink ring-2 ring-accent/40" : "border-black/10")}
        style={{ background: c }}
        onClick={() => pick(c)}
      />
    ));
  const saveComment = () => {
    if (highlight && comment !== highlight.comment) onUpdate(highlight.id, { comment });
    onClose();
  };

  return (
    <div ref={boxRef} className={cx("fixed z-50 w-max rounded-lg", popover.kind === "style" ? "max-w-[340px]" : "max-w-[300px]", "border border-line bg-panel p-1 shadow-lg")} style={style} onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <div className="flex flex-wrap items-center gap-1">
        {popover.kind === "style" ? (
          <StyleMenu current={styleOf?.(popover.resourceId, popover.key)} onPick={restyle} />
        ) : popover.kind === "selection" ? (
          <>
            <Highlighter className="mx-1 size-4 shrink-0 text-ink-3" />
            {swatches(null, (c) => void highlightWith(c))}
            <div className="mx-1 h-5 w-px shrink-0 bg-line" />
            <PopButton
              icon={<MessageSquare className="size-4" />}
              label="Comment"
              onClick={async () => {
                const h = await onCreate(popover.resourceId, popover.anchor, defaultColor);
                window.getSelection()?.removeAllRanges();
                if (h) onSwitch({ kind: "highlight", x: popover.x, y: popover.y, highlightId: h.id, editComment: true });
                else onClose();
              }}
            />
            {onPin && (
              <PopButton
                icon={<MapPin className="size-4" />}
                label="Pin on page"
                onClick={() => {
                  onPin(popover.resourceId, popover.anchor);
                  window.getSelection()?.removeAllRanges();
                  onClose();
                }}
              />
            )}
            {onQuote && (
              <PopButton
                icon={<MessageSquarePlus className="size-4" />}
                label="Note"
                onClick={() => {
                  onQuote(popover.anchor.quote);
                  window.getSelection()?.removeAllRanges();
                  onClose();
                }}
              />
            )}
            <PopButton
              icon={<Copy className="size-4" />}
              label="Copy"
              onClick={() => {
                void copyText(popover.anchor.quote);
                onClose();
              }}
            />
          </>
        ) : (
          <>
            {swatches(highlight!.color, (c) => {
              onUpdate(highlight!.id, { color: c });
              onClose();
            })}
            <div className="mx-1 h-5 w-px shrink-0 bg-line" />
            {!editing && (
              <PopButton icon={<MessageSquare className="size-4" />} label={highlight!.comment ? "Edit" : "Comment"} onClick={() => setEditing(true)} />
            )}
            <PopButton
              icon={<Trash2 className="size-4" />}
              label="Remove"
              danger
              onClick={() => {
                onDelete(highlight!.id);
                onClose();
              }}
            />
          </>
        )}
      </div>

      {popover.kind === "highlight" && editing && (
        <div className="p-1 pt-1.5">
          <textarea
            autoFocus
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveComment();
              }
            }}
            placeholder="Write a comment… (Ctrl+Enter to save)"
            className="block w-64 resize-y rounded-md border border-line bg-panel px-2 py-1.5 text-xs outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="size-3.5" /> Cancel
            </Button>
            <Button size="sm" variant="primary" onClick={saveComment}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StyleMenu({ current, onPick }: { current?: string; onPick: (color: string | null) => void }) {
  return (
    <>
      <Palette className="mx-1 size-4 shrink-0 text-ink-3" />
      {STYLE_COLORS.map((c, i) => (
        <button
          key={c}
          title={`Colour ${i + 1}`}
          className={cx("size-6 shrink-0 rounded-full border transition hover:scale-110", current === c ? "border-ink ring-2 ring-accent/40" : "border-black/10")}
          style={{ background: c }}
          onClick={() => onPick(c)}
        />
      ))}
      <CustomColor value={current && current !== "none" ? current : "#fde047"} onPick={onPick} />
      <div className="mx-1 h-5 w-px shrink-0 bg-line" />
      <PopButton icon={<Ban className="size-4" />} label="No colour" onClick={() => onPick("none")} />
      {current && <PopButton icon={<RotateCcw className="size-4" />} label="Default" onClick={() => onPick(null)} />}
    </>
  );
}

/** Any colour. It applies on the picker's `change` (when it closes), not on every step of a drag. */
function CustomColor({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => pickRef.current(el.value);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);
  return (
    <label title="Any colour" className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded-full border border-black/10 bg-[conic-gradient(#f87171,#fde047,#86efac,#67e8f9,#93c5fd,#c4b5fd,#f9a8d4,#f87171)] transition hover:scale-110">
      <input ref={ref} type="color" defaultValue={value} className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label="Any colour" />
    </label>
  );
}

function PopButton({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      className={cx("flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium hover:bg-hover", danger ? "text-danger" : "text-ink-2")}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
