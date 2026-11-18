import { useMemo, useRef, useState } from "react";
import { Columns2, GripVertical, Star } from "lucide-react";
import { hasUnsavedChanges, isPaged, type Directory, type DocumentRecord } from "../lib/types";
import { favoriteDocs, moveFavorite, type FavoriteChange } from "../lib/favorites";
import { keyOf, matches, withKey } from "../lib/shortcuts";
import { KIND_NOTE, KindIcon, docHref } from "./LibraryPanel";
import { cx } from "./ui";

interface Props {
  directories: Directory[];
  /** The files not hidden; the favourites among them are listed. */
  documents: DocumentRecord[];
  activeId: string | null;
  onOpen: (doc: DocumentRecord) => void;
  onOpenBeside: (doc: DocumentRecord) => void;
  onRemove: (doc: DocumentRecord) => void;
  /** A favourite moved (by Alt+↑ / ↓ or a drag): the new places. */
  onMove: (changes: FavoriteChange[], doc: DocumentRecord) => void;
}

/** Where a dragged favourite would land: before or after this row. */
type DropSpot = { id: string; after: boolean };

/** The Favourites tab of the left column: the files starred in the files list, in the user's order. */
export function FavoritesPanel(p: Props) {
  const [filter, setFilter] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropSpot | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const all = useMemo(() => favoriteDocs(p.documents), [p.documents]);
  const q = filter.trim().toLowerCase();
  const shown = q ? all.filter((d) => d.relPath.toLowerCase().includes(q)) : all;

  // Where each file sits: its folders, with the library folder's name when there are several.
  const several = p.directories.filter((d) => d.enabled).length > 1;
  const where = (d: DocumentRecord) => {
    const folders = d.relPath.split("/").slice(0, -1);
    const lib = p.directories.find((x) => x.id === d.directoryId)?.label;
    return (several || !folders.length ? [lib, ...folders] : folders).filter(Boolean).join(" › ");
  };

  const focusRow = (id: string) =>
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-fav-id="${CSS.escape(id)}"]`)?.focus());

  const move = (d: DocumentRecord, to: number) => {
    const changes = moveFavorite(all, all.indexOf(d), to);
    if (changes.length) p.onMove(changes, d);
    focusRow(d.id);
  };

  const onKey = (e: React.KeyboardEvent, d: DocumentRecord) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-fav-id]") ?? [])];
    const i = rows.indexOf(e.currentTarget as HTMLElement);
    const n = e.nativeEvent;
    let handled = true;
    // Moving works on the whole list, so not while it is filtered.
    if (matches(n, "favReorder") && !q) move(d, all.indexOf(d) + (e.key === "ArrowUp" ? -1 : 1));
    else if (matches(n, "favRemove")) {
      (rows[i + 1] ?? rows[i - 1])?.focus();
      p.onRemove(d);
    } else if (matches(n, "favBeside") && isPaged(d.kind)) p.onOpenBeside(d);
    else if (e.key === "ArrowDown" && !e.altKey) rows[i + 1]?.focus();
    else if (e.key === "ArrowUp" && !e.altKey) (rows[i - 1] ?? document.querySelector<HTMLInputElement>("[data-fav-filter]"))?.focus();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  /** A plain click opens the file in this tab; Ctrl/Cmd-click and middle-click keep the browser's new-tab behaviour. */
  const openHere = (e: React.MouseEvent, d: DocumentRecord) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    p.onOpen(d);
  };

  const rowAction = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      tabIndex={-1}
      className="grid size-6 shrink-0 place-items-center rounded text-ink-3 hover:bg-panel hover:text-ink"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {icon}
    </button>
  );

  // ---- Dragging a favourite to another place (not while filtering) ---------------------------
  const DRAG_TYPE = "application/x-studyspace-favorite";
  const endDrag = () => (setDragId(null), setDrop(null));
  const onDragOver = (e: React.DragEvent, d: DocumentRecord) => {
    if (!dragId || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    if (drop?.id !== d.id || drop.after !== after) setDrop({ id: d.id, after });
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dragged = all.find((x) => x.id === dragId);
    const target = all.find((x) => x.id === drop?.id);
    endDrag();
    if (!dragged || !target || !drop) return;
    // The index in the list without the dragged file.
    const from = all.indexOf(dragged);
    let to = all.indexOf(target) + (drop.after ? 1 : 0);
    if (to > from) to--;
    move(dragged, to);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[52px] items-center gap-1 px-3 pb-2 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Favourites</h2>
        {all.length > 0 && <span className="ml-auto text-[11px] text-ink-3">{all.length}</span>}
      </div>
      {all.length > 0 && (
        <div className="px-3 pb-2">
          <input
            className="h-8 w-full rounded-md border border-line bg-subtle px-2.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-accent"
            placeholder={`Filter favourites… (${keyOf("filter")})`}
            data-panel-filter
            data-fav-filter
            onKeyDown={(e) => {
              if (e.key === "Escape") (setFilter(""), e.currentTarget.blur());
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                listRef.current?.querySelector<HTMLElement>("[data-fav-id]")?.focus();
              }
            }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      <div className="ss-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {all.length === 0 ? (
          <div className="mx-2 mt-4 rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-3">
            <Star className="mx-auto mb-2 size-6" />
            <p>No favourites yet.</p>
            <p className="mt-2 text-xs leading-relaxed">
              In the Files tab, click the star on a file (or press {keyOf("fileFavorite")} on it, or on several selected files). {keyOf("favorite")} stars the open file.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <p className="px-2 py-1 text-xs text-ink-3">No matches</p>
        ) : (
          <ul ref={listRef} onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrop(null)}>
            {shown.map((d) => {
              const place = where(d);
              return (
                <li key={d.id} className="relative">
                  {drop?.id === d.id && dragId !== d.id && (
                    <div className={cx("pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded bg-accent", drop.after ? "-bottom-px" : "-top-px")} />
                  )}
                  <a
                    href={docHref(d)}
                    data-fav-id={d.id}
                    draggable={!q}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, d.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(d.id);
                    }}
                    onDragEnd={endDrag}
                    onDragOver={(e) => onDragOver(e, d)}
                    onDrop={onDrop}
                    onClick={(e) => openHere(e, d)}
                    onKeyDown={(e) => onKey(e, d)}
                    title={`${d.relPath}${KIND_NOTE[d.kind]}\nCtrl+click or middle-click to open in a new tab${q ? "" : `\nDrag, or ${keyOf("favReorder")} / Alt+↓, to move it`}`}
                    className={cx(
                      "group flex w-full items-center gap-1.5 rounded-md py-1 pl-1 pr-1 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                      d.id === p.activeId ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-hover hover:text-ink",
                      dragId === d.id && "opacity-40",
                    )}
                  >
                    <GripVertical className={cx("size-3.5 shrink-0 text-ink-3 opacity-0", !q && "group-hover:opacity-60 [@media(hover:none)]:hidden")} />
                    <KindIcon kind={d.kind} />
                    <span className="min-w-0 flex-1">
                      <span className={cx("block truncate", d.id === p.activeId && "font-medium")}>{d.title}</span>
                      {place && <span className="block truncate text-[11px] text-ink-3">{place}</span>}
                    </span>
                    {hasUnsavedChanges(d) && (
                      <span
                        className="size-1.5 shrink-0 rounded-full bg-warn group-hover:hidden group-focus-visible:hidden"
                        title="Highlights or bookmarks not yet saved into the PDF"
                      />
                    )}
                    <span className="hidden shrink-0 items-center group-hover:flex group-focus-visible:flex [@media(hover:none)]:flex">
                      {isPaged(d.kind) && rowAction(withKey("Open beside the open PDF", "favBeside"), <Columns2 className="size-3.5" />, () => p.onOpenBeside(d))}
                      {rowAction(withKey("Take it out of the favourites", "favRemove"), <Star className="size-3.5 fill-current text-amber-500" />, () => p.onRemove(d))}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
