import { useCallback, useRef, useState } from "react";

export interface UndoEntry {
  /** Shown in the Undo/Redo tooltips and toasts, e.g. "Delete page 4". */
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface Stacks {
  undo: UndoEntry[];
  redo: UndoEntry[];
}

const LIMIT = 100;

/**
 * Per-document undo/redo history. Each document keeps its own stacks for as long as the app is open,
 * so switching PDFs and coming back still lets you undo there. Undo/redo calls run one at a time.
 */
export function useUndoHistory(documentId: string | null, onError: (e: unknown) => void, onDone: (msg: string) => void) {
  const stacks = useRef(new Map<string, Stacks>());
  const [, setVersion] = useState(0);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const get = useCallback((id: string) => {
    let s = stacks.current.get(id);
    if (!s) {
      s = { undo: [], redo: [] };
      stacks.current.set(id, s);
    }
    return s;
  }, []);

  const push = useCallback(
    (id: string, entry: UndoEntry) => {
      const s = get(id);
      s.undo.push(entry);
      if (s.undo.length > LIMIT) s.undo.shift();
      s.redo = [];
      setVersion((v) => v + 1);
    },
    [get],
  );

  const step = useCallback(
    async (direction: "undo" | "redo") => {
      if (!documentId || runningRef.current) return;
      const s = get(documentId);
      const from = direction === "undo" ? s.undo : s.redo;
      const to = direction === "undo" ? s.redo : s.undo;
      const entry = from.pop();
      if (!entry) return;
      runningRef.current = true;
      setRunning(true);
      setVersion((v) => v + 1);
      try {
        await entry[direction]();
        to.push(entry);
        onDone(`${direction === "undo" ? "Undid" : "Redid"}: ${entry.label}`);
      } catch (e) {
        // A failed step can't be retried safely; drop it so the stacks stay consistent.
        onError(e);
      } finally {
        runningRef.current = false;
        setRunning(false);
        setVersion((v) => v + 1);
      }
    },
    [documentId, get, onDone, onError],
  );

  const s = documentId ? get(documentId) : null;
  return {
    push,
    undo: useCallback(() => step("undo"), [step]),
    redo: useCallback(() => step("redo"), [step]),
    running,
    undoLabel: s?.undo.at(-1)?.label ?? null,
    redoLabel: s?.redo.at(-1)?.label ?? null,
    /** Forget every entry for a document (used when its file changed outside our control). */
    clear: useCallback(
      (id: string) => {
        stacks.current.delete(id);
        setVersion((v) => v + 1);
      },
      [],
    ),
  };
}
