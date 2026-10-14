import { useMemo, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen, History, Library, RefreshCw, Settings } from "lucide-react";
import { hasUnsavedChanges, type Directory, type DocumentRecord, type ReadingProgress } from "../lib/types";
import { IconButton, cx } from "./ui";
import { keyOf, withKey } from "../lib/shortcuts";

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
  onRescan: () => void;
  onOpenSettings: () => void;
}

const docHref = (d: DocumentRecord) => `#/doc/${d.id}`;

export function LibraryPanel({ directories, documents, recent, activeId, scanning, onOpen, onRescan, onOpenSettings }: Props) {
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("ss-open-folders") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  const toggle = (key: string) => {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      try {
        localStorage.setItem("ss-open-folders", JSON.stringify([...n]));
      } catch {
        /* storage unavailable */
      }
      return n;
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
  const activeAncestors = useMemo(() => {
    const s = new Set<string>();
    if (!activeDoc) return s;
    let key = `d${activeDoc.directoryId}`;
    for (const part of activeDoc.relPath.split("/").slice(0, -1)) {
      key = `${key}/${part}`;
      s.add(key);
    }
    return s;
  }, [activeDoc]);

  const isOpen = (key: string) => !!q || open.has(key) || activeAncestors.has(key);

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
                className={cx(
                  "flex w-full items-center gap-1 rounded-md py-1 pr-2 text-left text-[13px] hover:bg-hover",
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
        {docs.map((d) => (
          <li key={d.id}>
            <a
              href={docHref(d)}
              className={cx(
                "flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px]",
                d.id === activeId ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-hover hover:text-ink",
              )}
              style={{ paddingLeft: 22 + depth * 14 }}
              onClick={(e) => openHere(e, d)}
              title={`${d.relPath}\nCtrl+click or middle-click to open in a new tab`}
            >
              <FileText className="size-4 shrink-0 opacity-70" />
              <span className="truncate">{d.title}</span>
              {hasUnsavedChanges(d) && (
                <span className="ml-auto size-1.5 shrink-0 rounded-full bg-warn" title="Highlights or bookmarks not yet saved into the PDF" />
              )}
            </a>
          </li>
        ))}
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
          onKeyDown={(e) => e.key === "Escape" && (setFilter(""), e.currentTarget.blur())}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="ss-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-4">
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
                      <span className="ml-auto shrink-0 text-[11px] text-ink-3">p. {r.page}</span>
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
                <p className="px-2 py-1 text-xs text-ink-3">{q ? "No matches" : "No PDFs found"}</p>
              ) : (
                renderNode(tree, 0)
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
