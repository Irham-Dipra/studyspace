import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FileCode2, FileText, FileType2, Folder, FolderOpen, History, Library, Pencil, Presentation, RefreshCw, Settings, Trash2 } from "lucide-react";
import { hasUnsavedChanges, isPaged, type Directory, type DocumentRecord, type ReadingProgress } from "../lib/types";
import { Button, IconButton, KeyHint, Modal, cx } from "./ui";
import { keyOf, matches, withKey } from "../lib/shortcuts";

interface TreeNode {
  name: string;
  key: string;
  folders: Map<string, TreeNode>;
  docs: DocumentRecord[];
  count: number;
}

function buildTree(docs: DocumentRecord[], dirKey: string): TreeNode {
  const root: TreeNode = { name: "", key: dirKey, folders: new Map(), docs: [], count: 0 };
  for (const d of docs) {
    const parts = d.relPath.split("/");
    parts.pop();
    let node = root;
    node.count++;
    for (const part of parts) {
      let next = node.folders.get(part);
      if (!next) {
        next = { name: part, key: `${node.key}/${part}`, folders: new Map(), docs: [], count: 0 };
        node.folders.set(part, next);
      }
      next.count++;
      node = next;
    }
    node.docs.push(d);
  }
  return root;
}

const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

interface Props {
  directories: Directory[];
  documents: DocumentRecord[];
  recent: (ReadingProgress & { title: string })[];
  activeId: string | null;
  scanning: boolean;
  onOpen: (doc: DocumentRecord) => void;
  onRename: (doc: DocumentRecord, name: string) => void;
  /** Called once the user confirmed; the file goes to the Trash. */
  onDelete: (doc: DocumentRecord) => void;
  /** Set by the parent (F2) to start renaming a file; cleared through onRenameRequestDone. */
  renameRequest: { id: string; nonce: number } | null;
  onRenameRequestDone: () => void;
  onRescan: () => void;
  onOpenSettings: () => void;
}

const docHref = (d: DocumentRecord) => `#/doc/${d.id}`;

const KIND_NOTE: Record<DocumentRecord["kind"], string> = {
  pdf: "",
  slides: "\nSlides: shown as pages, can't be edited",
  html: "\nHTML page (e.g. a Claude artifact): read, highlight and take notes; the file isn't changed",
  markdown: "\nMarkdown: read, highlight and take notes; the file isn't changed",
};

function KindIcon({ kind }: { kind: DocumentRecord["kind"] }) {
  if (kind === "slides") return <Presentation className="size-4 shrink-0 text-warn opacity-80" aria-label="Slides" />;
  if (kind === "html") return <FileCode2 className="size-4 shrink-0 text-sky-600 opacity-80 dark:text-sky-400" aria-label="HTML page" />;
  if (kind === "markdown") return <FileType2 className="size-4 shrink-0 text-emerald-600 opacity-80 dark:text-emerald-400" aria-label="Markdown" />;
  return <FileText className="size-4 shrink-0 opacity-70" />;
}
const fileName = (d: DocumentRecord) => d.relPath.split("/").pop() ?? d.title;

/** The keys of the folders above a file, from the top down. */
function folderKeys(d: DocumentRecord): string[] {
  let key = `d${d.directoryId}`;
  return d.relPath
    .split("/")
    .slice(0, -1)
    .map((part) => (key = `${key}/${part}`));
}

export function LibraryPanel(p: Props) {
  const { directories, documents, recent, activeId, scanning, onOpen, onRescan, onOpenSettings } = p;
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DocumentRecord | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("ss-open-folders") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  const saveOpen = (n: Set<string>) => {
    try {
      localStorage.setItem("ss-open-folders", JSON.stringify([...n]));
    } catch {
      /* storage unavailable */
    }
    return n;
  };

  const toggle = (key: string) => {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return saveOpen(n);
    });
  };

  const q = filter.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? documents.filter((d) => d.relPath.toLowerCase().includes(q)) : documents),
    [documents, q],
  );

  const trees = useMemo(
    () =>
      directories
        .filter((d) => d.enabled)
        .map((dir) => ({ dir, tree: buildTree(filtered.filter((d) => d.directoryId === dir.id), `d${dir.id}`) })),
    [directories, filtered],
  );

  const activeDoc = documents.find((d) => d.id === activeId);
  // Strings, so a refreshed document list (new objects) doesn't count as opening the file again.
  const activeDir = activeDoc?.directoryId;
  const activeRel = activeDoc?.relPath;
  const activeAncestors = useMemo(
    () => new Set(activeRel === undefined ? [] : folderKeys({ directoryId: activeDir, relPath: activeRel } as DocumentRecord)),
    [activeDir, activeRel],
  );

  // The open file's folders are opened once when it opens. They used to be forced open on every
  // render, so a folder holding the open file couldn't be closed.
  useEffect(() => {
    if (!activeAncestors.size) return;
    setOpen((s) => ([...activeAncestors].every((k) => s.has(k)) ? s : saveOpen(new Set([...s, ...activeAncestors]))));
  }, [activeAncestors]);

  const isOpen = (key: string) => !!q || open.has(key);

  const focusRow = (id: string) =>
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-doc-id="${CSS.escape(id)}"]`)?.focus());

  // F2 anywhere renames the open file: show its row (clear the filter, open its folders), then edit it.
  useEffect(() => {
    const req = p.renameRequest;
    if (!req) return;
    p.onRenameRequestDone();
    const d = documents.find((x) => x.id === req.id);
    if (!d) return;
    if (q && !d.relPath.toLowerCase().includes(q)) setFilter("");
    setOpen((s) => saveOpen(new Set([...s, ...folderKeys(d)])));
    setEditing(d.id);
  }, [p.renameRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishRename = (d: DocumentRecord, name: string | null) => {
    setEditing(null);
    focusRow(d.id);
    if (name !== null && name.trim() && name.trim() !== fileName(d)) p.onRename(d, name.trim());
  };

  /** ↑ / ↓ move between the rows that are showing; → / ← open and close folders. */
  const onListKey = (e: React.KeyboardEvent) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-lib-row]");
    if (!row || editing) return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-lib-row]") ?? [])];
    const i = rows.indexOf(row);
    const folder = row.dataset.folder;
    const docId = row.dataset.docId;
    const doc = docId ? documents.find((d) => d.id === docId) : undefined;
    const n = e.nativeEvent;
    let handled = true;
    if (e.key === "ArrowDown" && !e.altKey) rows[i + 1]?.focus();
    else if (e.key === "ArrowUp" && !e.altKey) {
      if (rows[i - 1]) rows[i - 1].focus();
      else document.querySelector<HTMLInputElement>("[data-panel-filter]")?.focus();
    } else if (e.key === "ArrowRight" && !e.altKey) {
      if (folder && !isOpen(folder)) toggle(folder);
      else if (folder) rows[i + 1]?.focus();
    } else if (e.key === "ArrowLeft" && !e.altKey) {
      // Closes the folder, or goes up to the folder this row is in.
      if (folder && isOpen(folder) && !q) toggle(folder);
      else {
        const parent = folder ? folder.slice(0, folder.lastIndexOf("/")) : doc && folderKeys(doc).at(-1);
        rows.find((r) => r.dataset.folder === parent)?.focus();
      }
    } else if (doc && matches(n, "fileRename")) setEditing(doc.id);
    else if (doc && matches(n, "fileDelete")) setConfirmDelete(doc);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
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

  /** A plain click opens the PDF in this tab; Ctrl/Cmd/Shift-click and middle-click keep the browser's new-tab behaviour. */
  const openHere = (e: React.MouseEvent, d: DocumentRecord) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen(d);
  };

  const renderNode = (node: TreeNode, depth: number) => {
    const folders = [...node.folders.values()].sort((a, b) => naturalSort(a.name, b.name));
    const docs = [...node.docs].sort((a, b) => naturalSort(a.title, b.title));
    return (
      <ul>
        {folders.map((f) => {
          const expanded = isOpen(f.key);
          return (
            <li key={f.key}>
              <button
                data-lib-row
                data-folder={f.key}
                className={cx(
                  "flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50",
                  depth === 0 ? "font-semibold text-ink" : "text-ink-2",
                )}
                style={{ paddingLeft: 4 + depth * 14 }}
                onClick={() => toggle(f.key)}
                aria-expanded={expanded}
              >
                <ChevronRight className={cx("size-3.5 shrink-0 text-ink-3 transition-transform", expanded && "rotate-90")} />
                {expanded ? <FolderOpen className="size-4 shrink-0 text-accent/80" /> : <Folder className="size-4 shrink-0 text-ink-3" />}
                <span className="truncate">{f.name}</span>
                <span className="ml-auto pl-2 text-[11px] font-normal text-ink-3">{f.count}</span>
              </button>
              {expanded && renderNode(f, depth + 1)}
            </li>
          );
        })}
        {docs.map((d) => {
          const icon = <KindIcon kind={d.kind} />;
          const rowCls = cx(
            "group flex w-full items-center gap-1.5 rounded-md py-1 pr-1 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
            d.id === activeId ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-hover hover:text-ink",
          );
          return (
            <li key={d.id}>
              {editing === d.id ? (
                <div className={rowCls} style={{ paddingLeft: 22 + depth * 14 }}>
                  {icon}
                  <FileNameInput initial={fileName(d)} onDone={(name) => finishRename(d, name)} />
                </div>
              ) : (
                <a
                  href={docHref(d)}
                  data-lib-row
                  data-doc-id={d.id}
                  className={rowCls}
                  style={{ paddingLeft: 22 + depth * 14 }}
                  onClick={(e) => openHere(e, d)}
                  title={`${d.relPath}${KIND_NOTE[d.kind]}\nCtrl+click or middle-click to open in a new tab`}
                >
                  {icon}
                  <span className="min-w-0 flex-1 truncate">{d.title}</span>
                  {hasUnsavedChanges(d) && (
                    <span
                      className="size-1.5 shrink-0 rounded-full bg-warn group-hover:hidden group-focus-visible:hidden"
                      title="Highlights or bookmarks not yet saved into the PDF"
                    />
                  )}
                  <span className="hidden shrink-0 items-center group-hover:flex group-focus-visible:flex [@media(hover:none)]:flex">
                    {rowAction(withKey("Rename", "fileRename"), <Pencil className="size-3.5" />, () => setEditing(d.id))}
                    {rowAction(withKey("Delete (to the Trash)", "fileDelete"), <Trash2 className="size-3.5" />, () => setConfirmDelete(d))}
                  </span>
                </a>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-3 pb-2 pt-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Course materials</h2>
        <div className="ml-auto flex">
          <IconButton label={withKey("Rescan folders", "rescan")} onClick={onRescan} disabled={scanning}>
            <RefreshCw className={cx("size-4", scanning && "animate-spin")} />
          </IconButton>
          <IconButton label={withKey("Library settings", "settings")} onClick={onOpenSettings}>
            <Settings className="size-4" />
          </IconButton>
        </div>
      </div>
      <div className="px-3 pb-2">
        <input
          className="h-8 w-full rounded-md border border-line bg-subtle px-2.5 text-[13px] outline-none placeholder:text-ink-3 focus:border-accent"
          placeholder={`Filter files… (${keyOf("filter")})`}
          data-panel-filter
          onKeyDown={(e) => {
            if (e.key === "Escape") (setFilter(""), e.currentTarget.blur());
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              listRef.current?.querySelector<HTMLElement>("[data-lib-row]")?.focus();
            }
          }}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div ref={listRef} className="ss-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4" onKeyDown={onListKey}>
        {!q && recent.length > 0 && (
          <section className="mb-3">
            <h3 className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              <History className="size-3.5" /> Continue reading
            </h3>
            <ul>
              {recent.slice(0, 4).map((r) => {
                const d = documents.find((x) => x.id === r.documentId);
                if (!d) return null;
                return (
                  <li key={r.documentId}>
                    <a
                      href={docHref(d)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] text-ink-2 hover:bg-hover hover:text-ink"
                      onClick={(e) => openHere(e, d)}
                    >
                      <span className="truncate">{d.title}</span>
                      {isPaged(d.kind) && <span className="ml-auto shrink-0 text-[11px] text-ink-3">p. {r.page}</span>}
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {directories.length === 0 ? (
          <div className="mx-2 mt-6 rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-3">
            <Library className="mx-auto mb-2 size-6" />
            <p>No folders yet.</p>
            <button className="mt-2 font-medium text-accent hover:underline" onClick={onOpenSettings}>
              Add a study folder
            </button>
          </div>
        ) : (
          trees.map(({ dir, tree }) => (
            <section key={dir.id} className="mb-3">
              {trees.length > 1 && (
                <h3 className="truncate px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3" title={dir.path}>
                  {dir.label}
                </h3>
              )}
              {tree.count === 0 ? (
                <p className="px-2 py-1 text-xs text-ink-3">{q ? "No matches" : "No PDFs, slides, HTML or Markdown files found"}</p>
              ) : (
                renderNode(tree, 0)
              )}
            </section>
          ))
        )}
      </div>
      {confirmDelete && (
        <DeleteDialog
          doc={confirmDelete}
          isOpen={confirmDelete.id === activeId}
          onCancel={() => (setConfirmDelete(null), focusRow(confirmDelete.id))}
          onConfirm={() => {
            setConfirmDelete(null);
            p.onDelete(confirmDelete);
          }}
        />
      )}
    </div>
  );
}

/** The name box shown in place of a file row. The name without its extension is selected first. */
function FileNameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="File name"
      maxLength={250}
      className="h-6 min-w-0 flex-1 rounded border border-accent bg-panel px-1.5 text-[13px] font-normal text-ink outline-none"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}

function DeleteDialog({ doc, isOpen, onCancel, onConfirm }: { doc: DocumentRecord; isOpen: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal
      title="Delete this file?"
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel <KeyHint id="close" />
          </Button>
          <Button variant="danger" autoFocus onClick={onConfirm}>
            Move to Trash <KeyHint id="confirm" />
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-sm text-ink-2">
        <p>
          <span className="font-medium text-ink">{fileName(doc)}</span> goes to the Trash
          {isOpen ? " and closes here" : ""}.
        </p>
        <p>Its notes, highlights and bookmarks are kept. Ctrl+Z puts it all back, and so does restoring the file from the Trash (then rescan).</p>
        {hasUnsavedChanges(doc) && <p className="text-warn">Some highlights or bookmarks aren't saved into the PDF yet. They stay in StudySpace.</p>}
      </div>
    </Modal>
  );
}
