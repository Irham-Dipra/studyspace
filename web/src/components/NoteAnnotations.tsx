import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Copy, Highlighter, MessageSquare, MessageSquarePlus, Trash2, X } from "lucide-react";
import { selectionToAnchor } from "../lib/noteAnchors";
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
  | { kind: "highlight"; x: number; y: number; highlightId: string; editComment?: boolean };

interface BodyProps {
  resourceId: string;
  content: string;
  highlights: NoteHighlight[];
  onPopover: (p: NotePopover | null) => void;
  onRemoveHighlights: (ids: string[]) => void;
}

/**
 * Rendered note content that can be annotated: select text to highlight/comment, click a highlight
 * to change it. Also lists the comments and reports highlights whose text was edited away.
 */
export function NoteBody({ resourceId, content, highlights, onPopover, onRemoveHighlights }: BodyProps) {
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
      if (mark?.dataset.hl) onPopover({ kind: "highlight", x: clientX, y: clientY, highlightId: mark.dataset.hl });
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
        <Markdown highlights={highlights}>{content}</Markdown>
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
}

/**
 * Floating bar for a text selection inside a note (or an HTML / Markdown document), or the menu of an
 * existing highlight there.
 */
export function NotePopovers({ popover, highlights, defaultColor, onClose, onSwitch, onCreate, onUpdate, onDelete, onQuote }: PopoverProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const highlight = popover.kind === "highlight" ? highlights.find((h) => h.id === popover.highlightId) : undefined;
  const [comment, setComment] = useState(highlight?.comment ?? "");
  const [editing, setEditing] = useState(popover.kind === "highlight" && !!popover.editComment);

  useEffect(() => {
    setComment(highlight?.comment ?? "");
    setEditing(popover.kind === "highlight" && !!popover.editComment);
  }, [popover, highlight?.comment]);

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
    const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
    const color = digit ? HIGHLIGHT_COLORS[Number(digit[1]) - 1] : undefined;
    if (popover.kind === "selection") {
      if (color) {
        void highlightWith(color);
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

  const style = { left: Math.max(8, Math.min(popover.x - 20, window.innerWidth - 300)), top: Math.min(popover.y + 14, window.innerHeight - (editing ? 200 : 60)) };
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
    <div ref={boxRef} className="fixed z-50 w-max max-w-[300px] rounded-lg border border-line bg-panel p-1 shadow-lg" style={style} onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <div className="flex flex-wrap items-center gap-1">
        {popover.kind === "selection" ? (
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
