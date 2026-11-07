import { useEffect, useMemo, useRef } from "react";
import { Eye, EyeOff, FileText, Folder } from "lucide-react";
import type { Directory, DocumentRecord } from "../lib/types";
import { matches, withKey } from "../lib/shortcuts";
import { Button, KeyHint, Modal } from "./ui";

interface Props {
  /** The hidden files (only those). */
  documents: DocumentRecord[];
  directories: Directory[];
  /** Folders hidden with the Hide button. */
  folders: { dirId: number; rule: string; name: string; library: string }[];
  onUnhideFolder: (f: { dirId: number; rule: string; name: string }) => void;
  onUnhide: (docs: DocumentRecord[]) => void;
  onOpen: (doc: DocumentRecord) => void;
  onClose: () => void;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** The files hidden from the library list, to unhide (or open) them. */
export function HiddenFilesDialog({ documents, folders, onUnhideFolder, directories, onUnhide, onOpen, onClose }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const label = (d: DocumentRecord) => directories.find((x) => x.id === d.directoryId)?.label ?? "";
  const docs = useMemo(
    () => [...documents].sort((a, b) => natural(label(a), label(b)) || natural(a.relPath, b.relPath)),
    [documents, directories], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const several = new Set(docs.map((d) => d.directoryId)).size > 1;

  const rows = () => [...(listRef.current?.querySelectorAll<HTMLElement>("[data-hidden-row]") ?? [])];
  // The window takes the focus, so its keys don't reach the files list behind it.
  useEffect(() => {
    (rows()[0] ?? listRef.current?.closest<HTMLElement>("[role=dialog]"))?.focus();
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    const n = e.nativeEvent;
    const all = rows();
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-hidden-row]");
    const i = row ? all.indexOf(row) : -1;
    const doc = docs.find((d) => d.id === row?.dataset.id);
    let handled = true;
    if (matches(n, "hfMove")) all[e.key === "ArrowDown" ? Math.min(i + 1, all.length - 1) : Math.max(i - 1, 0)]?.focus();
    else if (matches(n, "hfUnhideAll") && docs.length) onUnhide(docs);
    else if (doc && matches(n, "hfUnhide")) {
      // The focus moves on to the next file (or the one before, at the end).
      (all[i + 1] ?? all[i - 1])?.focus();
      onUnhide([doc]);
    } else if (doc && matches(n, "hfOpen")) onOpen(doc);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <Modal
      title={`Hidden files and folders (${docs.length + folders.length})`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close <KeyHint id="close" />
          </Button>
          <Button variant="primary" disabled={!docs.length} onClick={() => onUnhide(docs)}>
            <Eye className="size-4" /> Unhide all <KeyHint id="hfUnhideAll" className="border-white/40 bg-white/10 text-white/80" />
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-ink-3">
        These files are left out of the files list and the search. They stay on disk with their notes, highlights and bookmarks. Hide a file or folder with{" "}
        <EyeOff className="inline size-3" /> on its row, <KeyHint id="fileHide" /> in the files list, or <em>Hide</em> with several files selected.
        Files hidden by a rule in Settings (<em>Hide folders and files</em>) aren't listed here.
      </p>
      {folders.length > 0 && (
        <ul className="mb-2 space-y-0.5 border-b border-line pb-2">
          {folders.map((f) => (
            <li key={`${f.dirId}${f.rule}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-hover">
              <Folder className="size-4 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1 truncate">
                {f.name} <span className="text-[11px] text-ink-3">folder{folders.some((x) => x.library !== f.library) ? ` in ${f.library}` : ""}</span>
              </span>
              <Button size="sm" onClick={() => onUnhideFolder(f)}>
                <Eye className="size-3.5" /> Unhide
              </Button>
            </li>
          ))}
        </ul>
      )}
      {docs.length === 0 && folders.length > 0 ? null : docs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-ink-3">No hidden files.</p>
      ) : (
        <ul ref={listRef} className="ss-scroll max-h-[55vh] space-y-0.5 overflow-y-auto" onKeyDown={onKey}>
          {docs.map((d) => (
            <li key={d.id}>
              <div
                tabIndex={0}
                data-hidden-row
                data-id={d.id}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/50"
              >
                <FileText className="size-4 shrink-0 text-ink-3" />
                <button
                  tabIndex={-1}
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                  title={withKey("Open (it stays hidden)", "hfOpen")}
                  onClick={() => onOpen(d)}
                >
                  {d.title}
                  <span className="ml-2 text-[11px] text-ink-3">
                    {several && `${label(d)}/`}
                    {d.relPath}
                  </span>
                </button>
                <Button size="sm" tabIndex={-1} title={withKey("Unhide", "hfUnhide")} onClick={() => onUnhide([d])}>
                  <Eye className="size-3.5" /> Unhide
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
