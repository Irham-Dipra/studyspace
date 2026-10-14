import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark as BookmarkIcon,
  BookmarkPlus,
  ChevronRight,
  ChevronsDownUp,
  Crosshair,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Save,
  ScanText,
  Trash2,
} from "lucide-react";
import type { Bookmark } from "../lib/types";
import type { BookmarkInput } from "../lib/api";
import { buildBookmarkTree, currentBookmarkId, type BookmarkTreeNode } from "../lib/outline";
import { IconButton, cx } from "./ui";
import { keyOf, matches, withKey } from "../lib/shortcuts";

export type BookmarkPatch = Partial<Omit<BookmarkInput, "id">>;

interface Props {
  bookmarks: Bookmark[];
  /** False while the PDF's own outline is still being read. */
  ready: boolean;
  /** Reading the PDF's own outline failed (editing waits, so saving can't overwrite it). */
  error: string | null;
  onRetry: () => void;
  page: number;
  dirty: boolean;
  saving: boolean;
  /** Set by the parent to start renaming a bookmark it just added. */
  renameRequest: { id: string; nonce: number } | null;
  onJump: (b: Bookmark) => void;
  /** Adds a bookmark at the current reading position (under `parentId` when given). */
  onAdd: (parentId?: string | null) => void;
  onUpdate: (id: string, patch: BookmarkPatch, label: string) => void;
  onDelete: (id: string) => void;
  /** Points the bookmark at the current reading position. */
  onRetarget: (id: string) => void;
  /** Gets the text of (or OCRs) the bookmark's section, up to the next bookmark. */
  onGetText: (id: string, method: "text" | "ocr") => void;
  onSave: () => void;
}

type Move = "up" | "down" | "indent" | "outdent";

interface Menu {
  id: string;
  x: number;
  y: number;
}

/** The bookmarks (outline) of the open PDF: a tree you can jump through and edit. */
export function BookmarksPanel(p: Props) {
  const tree = useMemo(() => buildBookmarkTree(p.bookmarks), [p.bookmarks]);
  const byId = useMemo(() => {
    const m = new Map<string, BookmarkTreeNode>();
    const walk = (xs: BookmarkTreeNode[]) => xs.forEach((x) => (m.set(x.id, x), walk(x.children)));
    walk(tree);
    return m;
  }, [tree]);
  /** Every bookmark in reading order (tree order). */
  const ordered = useMemo(() => {
    const out: BookmarkTreeNode[] = [];
    const walk = (xs: BookmarkTreeNode[]) => xs.forEach((x) => (out.push(x), walk(x.children)));
    walk(tree);
    return out;
  }, [tree]);

  const current = useMemo(() => currentBookmarkId(ordered, p.page), [ordered, p.page]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // The bookmark you're reading is always visible: its parents are opened.
  const currentAncestors = useMemo(() => {
    const s = new Set<string>();
    for (let b = current ? byId.get(current) : undefined; b?.parentId; b = byId.get(b.parentId)) s.add(b.parentId);
    return s;
  }, [current, byId]);
  const isOpen = (id: string) => expanded.has(id) || currentAncestors.has(id);

  const toggle = (id: string, open = !isOpen(id)) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (open) n.add(id);
      else n.delete(id);
      return n;
    });

  useEffect(() => {
    if (!p.renameRequest) return;
    const b = byId.get(p.renameRequest.id);
    if (!b) return;
    if (b.parentId) toggle(b.parentId, true);
    setEditing(b.id);
    setFocused(b.id);
  }, [p.renameRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the current bookmark in view as you read.
  useEffect(() => {
    if (!current || editing || filter) return;
    listRef.current?.querySelector(`[data-bookmark="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = filter.trim().toLowerCase();
  /** Rows shown: the expanded tree, or a flat list of matches while filtering. */
  const rows = useMemo(() => {
    if (q) return ordered.filter((b) => b.title.toLowerCase().includes(q));
    const out: BookmarkTreeNode[] = [];
    const walk = (xs: BookmarkTreeNode[]) => {
      for (const x of xs) {
        out.push(x);
        if (x.children.length && (expanded.has(x.id) || currentAncestors.has(x.id))) walk(x.children);
      }
    };
    walk(tree);
    return out;
  }, [q, ordered, tree, expanded, currentAncestors]);

  const siblingsOf = (b: BookmarkTreeNode) => (b.parentId ? (byId.get(b.parentId)?.children ?? []) : tree);

  /** The patch for moving a bookmark one step, or null when it can't move that way. */
  const movePatch = (b: BookmarkTreeNode, move: Move): BookmarkPatch | null => {
    const sibs = siblingsOf(b);
    const i = sibs.findIndex((x) => x.id === b.id);
    if (move === "up") {
      if (i <= 0) return null;
      const before = sibs[i - 2];
      return { position: before ? (before.position + sibs[i - 1].position) / 2 : sibs[i - 1].position - 1 };
    }
    if (move === "down") {
      if (i < 0 || i >= sibs.length - 1) return null;
      const after = sibs[i + 2];
      return { position: after ? (sibs[i + 1].position + after.position) / 2 : sibs[i + 1].position + 1 };
    }
    if (move === "indent") {
      const prev = sibs[i - 1];
      if (!prev) return null;
      return { parentId: prev.id, position: (prev.children.at(-1)?.position ?? 0) + 1 };
    }
    const parent = b.parentId ? byId.get(b.parentId) : undefined;
    if (!parent) return null;
    const outer = siblingsOf(parent);
    const next = outer[outer.findIndex((x) => x.id === parent.id) + 1];
    return { parentId: parent.parentId, position: next ? (parent.position + next.position) / 2 : parent.position + 1 };
  };

  const MOVE_LABEL: Record<Move, string> = { up: "Move bookmark up", down: "Move bookmark down", indent: "Indent bookmark", outdent: "Outdent bookmark" };
  const move = (b: BookmarkTreeNode, m: Move) => {
    const patch = movePatch(b, m);
    if (!patch) return;
    if (m === "indent") toggle(patch.parentId as string, true);
    p.onUpdate(b.id, patch, MOVE_LABEL[m]);
  };

  const rename = (b: BookmarkTreeNode, title: string) => {
    setEditing(null);
    const t = title.replace(/\s+/g, " ").trim();
    if (t && t !== b.title) p.onUpdate(b.id, { title: t }, "Rename bookmark");
    focusRow(b.id);
  };

  const focusRow = (id: string) => {
    setFocused(id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-bookmark="${id}"]`)?.focus());
  };

  const remove = (b: BookmarkTreeNode) => {
    const i = rows.findIndex((x) => x.id === b.id);
    const next = rows.slice(i + 1).find((x) => !isInside(x, b)) ?? rows[i - 1];
    p.onDelete(b.id);
    if (next) focusRow(next.id);
  };
  const isInside = (x: BookmarkTreeNode, ancestor: BookmarkTreeNode) => {
    for (let y: BookmarkTreeNode | undefined = x; y; y = y.parentId ? byId.get(y.parentId) : undefined) if (y.id === ancestor.id) return true;
    return false;
  };

  const onRowKey = (e: ReactKeyboardEvent, b: BookmarkTreeNode) => {
    if (editing) return;
    const i = rows.findIndex((x) => x.id === b.id);
    const k = e.key;
    let handled = true;
    if (e.altKey && k === "ArrowUp") move(b, "up");
    else if (e.altKey && k === "ArrowDown") move(b, "down");
    else if (e.altKey && k === "ArrowRight") move(b, "indent");
    else if (e.altKey && k === "ArrowLeft") move(b, "outdent");
    else if (k === "ArrowDown" && rows[i + 1]) focusRow(rows[i + 1].id);
    else if (k === "ArrowUp" && rows[i - 1]) focusRow(rows[i - 1].id);
    else if (k === "ArrowRight" && b.children.length && !q) {
      if (!isOpen(b.id)) toggle(b.id, true);
      else focusRow(b.children[0].id);
    } else if (k === "ArrowLeft" && !q) {
      if (b.children.length && isOpen(b.id) && !currentAncestors.has(b.id)) toggle(b.id, false);
      else if (b.parentId) focusRow(b.parentId);
    } else if (k === "Enter") p.onJump(b);
    else if (matches(e.nativeEvent, "bmText")) p.onGetText(b.id, "text");
    else if (matches(e.nativeEvent, "bmOcr")) p.onGetText(b.id, "ocr");
    else if (k === "F2") setEditing(b.id);
    else if (k === "Delete" || k === "Backspace") remove(b);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const openMenu = (b: BookmarkTreeNode, x: number, y: number) => {
    setFocused(b.id);
    setMenu({ id: b.id, x, y });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-3 pb-2 pt-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Bookmarks</h2>
        {p.bookmarks.length > 0 && <span className="text-[11px] text-ink-3">{p.bookmarks.length}</span>}
        <div className="ml-auto flex">
          {tree.some((b) => b.children.length) && (
            <IconButton label="Collapse all chapters" onClick={() => setExpanded(new Set())}>
              <ChevronsDownUp className="size-4" />
            </IconButton>
          )}
          <IconButton label={withKey("Bookmark this spot", "addBookmark")} onClick={() => p.onAdd()} disabled={!p.ready}>
            <BookmarkPlus className="size-4" />
          </IconButton>
        </div>
      </div>
      {p.bookmarks.length > 12 && (
        <div className="px-3 pb-2">
          <input
            className="h-8 w-full rounded-md border border-line bg-subtle px-2.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-accent"
            placeholder={`Filter bookmarks… (${keyOf("filter")})`}
            data-panel-filter
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFilter("")}
          />
        </div>
      )}

      <div ref={listRef} className="ss-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4" role="tree" aria-label="Bookmarks">
        {p.error ? (
          <div className="mx-1 mt-3 rounded-lg border border-danger/40 p-3 text-xs text-ink-2">
            <p className="font-medium text-danger">Couldn't read this PDF's bookmarks.</p>
            <p className="mt-1 break-words">{p.error}</p>
            <button className="mt-2 font-medium text-accent hover:underline" onClick={p.onRetry}>
              Try again
            </button>
          </div>
        ) : !p.ready ? (
          <p className="flex items-center gap-2 px-2 py-3 text-xs text-ink-3">
            <Loader2 className="size-3.5 animate-spin" /> Reading this PDF's bookmarks…
          </p>
        ) : p.bookmarks.length === 0 ? (
          <div className="mx-1 mt-4 rounded-lg border border-dashed border-line p-4 text-center text-[13px] text-ink-3">
            <BookmarkIcon className="mx-auto mb-2 size-6" />
            <p>No bookmarks in this PDF yet.</p>
            <p className="mt-1 text-xs">
              Press <kbd className="rounded border border-line px-1">B</kbd> to bookmark the spot you're reading. <em>Save to PDF</em> writes
              them into the file, so other PDF readers show them too.
            </p>
            <button className="mt-3 inline-flex items-center gap-1 font-medium text-accent hover:underline" onClick={() => p.onAdd()}>
              <BookmarkPlus className="size-4" /> Add a bookmark here
            </button>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-2 py-2 text-xs text-ink-3">No matches</p>
        ) : (
          <ul>
            {rows.map((b) => {
              const open = isOpen(b.id);
              const depth = q ? 0 : b.depth;
              const isCurrent = b.id === current;
              return (
                <li key={b.id} role="none">
                  <div
                    data-bookmark={b.id}
                    role="treeitem"
                    aria-level={b.depth + 1}
                    aria-expanded={b.children.length && !q ? open : undefined}
                    aria-current={isCurrent ? "location" : undefined}
                    tabIndex={focused === b.id || (!focused && b === rows[0]) ? 0 : -1}
                    className={cx(
                      "group flex w-full cursor-pointer items-center gap-1 rounded-md py-1 pr-1 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                      isCurrent ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-hover hover:text-ink",
                      depth === 0 && !q && "font-medium",
                    )}
                    style={{ paddingLeft: 2 + depth * 14 }}
                    onClick={() => {
                      setFocused(b.id);
                      if (editing !== b.id) p.onJump(b);
                    }}
                    onDoubleClick={() => setEditing(b.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openMenu(b, e.clientX, e.clientY);
                    }}
                    onKeyDown={(e) => onRowKey(e, b)}
                    onFocus={() => setFocused(b.id)}
                  >
                    {b.children.length && !q ? (
                      <button
                        tabIndex={-1}
                        aria-label={open ? "Collapse" : "Expand"}
                        className="grid size-4 shrink-0 place-items-center rounded text-ink-3 hover:text-ink"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(b.id);
                        }}
                      >
                        <ChevronRight className={cx("size-3.5 transition-transform", open && "rotate-90")} />
                      </button>
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    {editing === b.id ? (
                      <RenameInput initial={b.title} onDone={(t) => rename(b, t)} onCancel={() => (setEditing(null), focusRow(b.id))} />
                    ) : (
                      <span className="min-w-0 flex-1 truncate" title={b.title}>
                        {b.title}
                      </span>
                    )}
                    {editing !== b.id && (
                      <>
                        <span className="ml-1 shrink-0 text-[11px] tabular-nums text-ink-3 group-hover:hidden group-focus-visible:hidden">{b.page}</span>
                        <span className="hidden shrink-0 items-center group-hover:flex group-focus-visible:flex">
                          <button
                            tabIndex={-1}
                            className="grid size-6 place-items-center rounded text-ink-3 hover:bg-panel hover:text-ink"
                            title="Rename (F2)"
                            aria-label="Rename bookmark"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditing(b.id);
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            tabIndex={-1}
                            className="grid size-6 place-items-center rounded text-ink-3 hover:bg-panel hover:text-ink"
                            title="More"
                            aria-label="More bookmark actions"
                            onClick={(e) => {
                              e.stopPropagation();
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              openMenu(b, r.left, r.bottom + 4);
                            }}
                          >
                            <MoreHorizontal className="size-3.5" />
                          </button>
                        </span>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(p.dirty || p.saving) && (
        <div className="border-t border-line px-3 py-2 text-xs text-ink-2">
          <p>Changes are kept in StudySpace. Save to write them into the PDF file.</p>
          <button
            className="mt-1.5 inline-flex h-7 items-center gap-1.5 rounded-md bg-warn/15 px-2.5 font-medium text-warn hover:bg-warn/25 disabled:opacity-60"
            onClick={p.onSave}
            disabled={p.saving}
            title="Write bookmarks, highlights and drawings into the PDF (Ctrl+S)"
          >
            {p.saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save to PDF
          </button>
        </div>
      )}

      {menu && byId.get(menu.id) && (
        <BookmarkMenu
          menu={menu}
          can={(m) => !!movePatch(byId.get(menu.id)!, m)}
          onClose={() => setMenu(null)}
          onRename={() => setEditing(menu.id)}
          onRetarget={() => p.onRetarget(menu.id)}
          onGetText={(method) => p.onGetText(menu.id, method)}
          onAddChild={() => p.onAdd(menu.id)}
          onMove={(m) => move(byId.get(menu.id)!, m)}
          onDelete={() => remove(byId.get(menu.id)!)}
          hasChildren={byId.get(menu.id)!.children.length > 0}
        />
      )}
    </div>
  );
}

function RenameInput({ initial, onDone, onCancel }: { initial: string; onDone: (title: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (cancel: boolean) => {
    if (done.current) return;
    done.current = true;
    if (cancel) onCancel();
    else onDone(ref.current?.value ?? initial);
  };
  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="Bookmark title"
      maxLength={1000}
      className="h-6 min-w-0 flex-1 rounded border border-accent bg-panel px-1.5 text-[13px] text-ink outline-none"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(false);
        else if (e.key === "Escape") finish(true);
      }}
      onBlur={() => finish(false)}
    />
  );
}

function BookmarkMenu({
  menu,
  can,
  hasChildren,
  onClose,
  onRename,
  onRetarget,
  onGetText,
  onAddChild,
  onMove,
  onDelete,
}: {
  menu: Menu;
  can: (m: Move) => boolean;
  hasChildren: boolean;
  onClose: () => void;
  onRename: () => void;
  onRetarget: () => void;
  onGetText: (method: "text" | "ocr") => void;
  onAddChild: () => void;
  onMove: (m: Move) => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  // Fixed position (the panel scrolls and clips), nudged to stay on screen.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8)),
      top: menu.y + r.height > window.innerHeight - 8 ? Math.max(8, menu.y - r.height - 8) : menu.y,
    });
    ref.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [menu]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const item = (label: string, icon: React.ReactNode, run: () => void, opts: { disabled?: boolean; hint?: string; danger?: boolean } = {}) => (
    <button
      role="menuitem"
      disabled={opts.disabled}
      className={cx(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] outline-none hover:bg-hover focus:bg-hover disabled:opacity-40 disabled:hover:bg-transparent",
        opts.danger ? "text-danger" : "text-ink",
      )}
      onClick={() => {
        onClose();
        run();
      }}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {opts.hint && <span className="text-[11px] text-ink-3">{opts.hint}</span>}
    </button>
  );
  const ic = "size-3.5 text-ink-3";
  return (
    <div
      ref={ref}
      role="menu"
      data-floating-menu
      className="fixed z-[90] w-60 rounded-lg border border-line bg-panel p-1 shadow-xl"
      style={pos}
      onKeyDown={(e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLElement);
        items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
      }}
    >
      {item("Rename", <Pencil className={ic} />, onRename, { hint: "F2" })}
      {item("Point to where I'm reading", <Crosshair className={ic} />, onRetarget)}
      {item("Add a bookmark inside", <BookmarkPlus className={ic} />, onAddChild)}
      <div className="my-1 border-t border-line" />
      {item("Get text of this section", <FileText className={ic} />, () => onGetText("text"), { hint: keyOf("bmText") })}
      {item("OCR this section", <ScanText className={ic} />, () => onGetText("ocr"), { hint: keyOf("bmOcr") })}
      <div className="my-1 border-t border-line" />
      {item("Move up", <ArrowUp className={ic} />, () => onMove("up"), { disabled: !can("up"), hint: "Alt+↑" })}
      {item("Move down", <ArrowDown className={ic} />, () => onMove("down"), { disabled: !can("down"), hint: "Alt+↓" })}
      {item("Indent (nest under the one above)", <ArrowRight className={ic} />, () => onMove("indent"), { disabled: !can("indent"), hint: "Alt+→" })}
      {item("Outdent", <ArrowLeft className={ic} />, () => onMove("outdent"), { disabled: !can("outdent"), hint: "Alt+←" })}
      <div className="my-1 border-t border-line" />
      {item(hasChildren ? "Delete (with the bookmarks inside)" : "Delete", <Trash2 className="size-3.5" />, onDelete, { danger: true, hint: "Del" })}
    </div>
  );
}
