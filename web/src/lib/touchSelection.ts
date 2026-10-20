import { useEffect, useRef, type RefObject } from "react";

/** How long the selection must stay still before its bar opens: dragging the handles keeps changing it. */
const SETTLE_MS = 400;

let lastPointer = "mouse";
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", (e) => (lastPointer = e.pointerType), true);
}

/**
 * Phones select text by long-press, then by dragging the handles, and send no mouseup, so the bars
 * that open on mouseup never would. This calls `onSettled` with the selection once it stops changing
 * inside `rootRef`, but only after a touch: mouse selections keep their mouseup handling.
 */
export function useTouchSelection(rootRef: RefObject<HTMLElement | null>, onSettled: (range: Range) => void, enabled = true): void {
  const cb = useRef(onSettled);
  cb.current = onSettled;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      if (lastPointer !== "touch") return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const sel = window.getSelection();
        const root = rootRef.current;
        if (!sel || sel.isCollapsed || !sel.rangeCount || !root) return;
        const range = sel.getRangeAt(0);
        if (root.contains(range.commonAncestorContainer)) cb.current(range);
      }, SETTLE_MS);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [enabled, rootRef]);
}

/** Where to put a bar for a selection on a phone: below it, clear of the handles and the phone's own Copy bubble above. */
export function belowSelection(range: Range): { x: number; y: number } {
  const r = range.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 16 };
}
