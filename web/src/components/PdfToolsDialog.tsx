import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, FileOutput, FolderOpen, Loader2, Plus, X } from "lucide-react";
import { api, type CreatePdfsRequest, type LibraryFolder } from "../lib/api";
import { openPdf, parsePageList } from "../lib/pdf";
import { buildBookmarkTree, readOutline, type BookmarkTreeNode } from "../lib/outline";
import type { Bookmark, DocumentRecord } from "../lib/types";
import { uuid } from "../lib/uuid";
import { Button, Field, Modal, NumberInput, cx, inputCls, selectAllOnFocus } from "./ui";

export type PdfTool = "extract" | "split" | "merge";

interface Props {
  tool: PdfTool;
  doc: DocumentRecord;
  page: number;
  pageCount: number;
  documents: DocumentRecord[];
  bookmarks: Bookmark[];
  onClose: () => void;
  /** Called after new PDFs were written (refresh the library). */
  onCreated: (docs: DocumentRecord[]) => void;
  /** Extract with "remove from this PDF": deletes the pages from the open PDF (an undoable edit). */
  onRemovePages: (pages: number[]) => Promise<boolean>;
  onOpen: (doc: DocumentRecord) => void;
}

/** "3", "3-5", "3, 5-7" (compact, for file names). */
function pagesText(pages: number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    runs.push(i === j ? `${pages[i]}` : `${pages[i]}-${pages[j]}`);
    i = j;
  }
  return runs.length > 3 ? `${runs.slice(0, 3).join(", ")}…` : runs.join(", ");
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const pad = (n: number, total: number) => String(n).padStart(String(total).length, "0");
/** Characters that file managers dislike, replaced the way the server would. */
const cleanName = (s: string) => s.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();

interface Part {
  name: string;
  pages: number[];
}

type SplitMode = "every" | "ranges" | "bookmarks";

interface MergeItem {
  key: string;
  doc: DocumentRecord;
  /** Empty = every page. */
  pages: string;
}

const TITLES: Record<PdfTool, string> = {
  extract: "Extract pages to a new PDF",
  split: "Split this PDF into several",
  merge: "Merge PDFs into one",
};

export function PdfToolsDialog(p: Props) {
  const docDir = p.doc.path.replace(/[\\/][^\\/]*$/, ""); // "\" too: Windows paths

  // ---- Where to save ----------------------------------------------------------------
  const [folders, setFolders] = useState<LibraryFolder[] | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folder, setFolder] = useState(docDir);
  const [newFolder, setNewFolder] = useState(p.tool === "split" ? cleanName(`${p.doc.title} - split`) : "");
  useEffect(() => {
    api.libraryFolders().then(
      (fs) => {
        setFolders(fs);
        if (!fs.some((f) => f.path === docDir) && fs[0]) setFolder(fs[0].path);
      },
      (e: Error) => setFolderError(e.message),
    );
  }, [docDir]);

  // ---- What to carry over ------------------------------------------------------------
  const [copyNotes, setCopyNotes] = useState(true);
  const [copyHighlights, setCopyHighlights] = useState(true);
  const [copyBookmarks, setCopyBookmarks] = useState(true);
  const [bookmarkPerSource, setBookmarkPerSource] = useState(true);

  // ---- Extract -----------------------------------------------------------------------
  const [extractPages, setExtractPages] = useState(String(p.page));
  const [extractName, setExtractName] = useState<string | null>(null); // null = follow the pages
  const [removeAfter, setRemoveAfter] = useState(false);

  // ---- Split ---------------------------------------------------------------------------
  const [splitMode, setSplitMode] = useState<SplitMode>(p.bookmarks.length ? "bookmarks" : "every");
  const [every, setEvery] = useState(10);
  const [ranges, setRanges] = useState(`1-${Math.min(10, p.pageCount)}`);
  const [level, setLevel] = useState(1);
  const [frontMatter, setFrontMatter] = useState(true);
  const [renamed, setRenamed] = useState<Record<number, string>>({});

  // ---- Merge ---------------------------------------------------------------------------
  const [items, setItems] = useState<MergeItem[]>([{ key: uuid(), doc: p.doc, pages: "" }]);
  const [mergeName, setMergeName] = useState(cleanName(`Merged - ${p.doc.title}`));
  const [query, setQuery] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<DocumentRecord[] | null>(null);

  const tree = useMemo(() => buildBookmarkTree(p.bookmarks), [p.bookmarks]);
  const maxLevel = useMemo(() => {
    let m = 0;
    const walk = (xs: BookmarkTreeNode[], d: number) => xs.forEach((x) => ((m = Math.max(m, d)), walk(x.children, d + 1)));
    walk(tree, 1);
    return Math.min(m, 3);
  }, [tree]);

  // ---- The files that will be made ----------------------------------------------------------
  const plan = useMemo((): { parts: Part[]; error: string | null } => {
    const title = p.doc.title;
    try {
      if (p.tool === "extract") {
        const pages = parsePageList(extractPages, p.pageCount);
        if (!pages.length) return { parts: [], error: "Type the pages to extract." };
        return { parts: [{ name: extractName ?? cleanName(`${title} - p${pagesText(pages)}`), pages }], error: null };
      }
      if (p.tool === "split") {
        let parts: Part[] = [];
        if (splitMode === "every") {
          const n = Math.max(1, every);
          const count = Math.ceil(p.pageCount / n);
          parts = range(1, count).map((i) => {
            const pages = range((i - 1) * n + 1, Math.min(i * n, p.pageCount));
            return { name: cleanName(`${title} - ${n === 1 ? `page ${pad(i, count)}` : `part ${pad(i, count)} (p${pagesText(pages)})`}`), pages };
          });
        } else if (splitMode === "ranges") {
          for (const raw of ranges.split(/[,;\n]/)) {
            if (!raw.trim()) continue;
            const pages = parsePageList(raw, p.pageCount);
            parts.push({ name: cleanName(`${title} - p${pagesText(pages)}`), pages });
          }
        } else {
          // Each bookmark at the chosen level starts a part that runs until the next one.
          const starts: { title: string; page: number }[] = [];
          const walk = (xs: BookmarkTreeNode[], d: number) => {
            for (const x of xs) {
              if (d === level) starts.push({ title: x.title, page: x.page });
              else walk(x.children, d + 1);
            }
          };
          walk(tree, 1);
          starts.sort((a, b) => a.page - b.page);
          const unique = starts.filter((s, i) => !starts[i + 1] || starts[i + 1].page !== s.page);
          if (!unique.length) return { parts: [], error: "This PDF has no bookmarks at that level." };
          if (frontMatter && unique[0].page > 1) parts.push({ name: cleanName(`${pad(0, unique.length)} Front matter`), pages: range(1, unique[0].page - 1) });
          unique.forEach((s, i) => {
            const end = (unique[i + 1]?.page ?? p.pageCount + 1) - 1;
            parts.push({ name: cleanName(`${pad(i + 1, unique.length)} ${s.title}`), pages: range(s.page, end) });
          });
        }
        parts = parts.map((x, i) => (renamed[i] !== undefined ? { ...x, name: renamed[i] } : x));
        if (!parts.length) return { parts, error: "Nothing to split." };
        if (parts.length > 500) return { parts, error: `That makes ${parts.length} files; the limit is 500 at once.` };
        return { parts, error: null };
      }
      return { parts: [], error: items.length < 2 ? "Add at least one more PDF to merge." : null };
    } catch (e) {
      return { parts: [], error: (e as Error).message };
    }
  }, [p.tool, p.doc.title, p.pageCount, extractPages, extractName, splitMode, every, ranges, level, frontMatter, tree, renamed, items.length]);

  const mergeErrors = useMemo(() => {
    const out = new Map<string, string>();
    for (const it of items) {
      if (!it.pages.trim()) continue;
      try {
        parsePageList(it.pages, it.doc.pageCount ?? 100000);
      } catch (e) {
        out.set(it.key, (e as Error).message);
      }
    }
    return out;
  }, [items]);

  const removeError =
    p.tool === "extract" && removeAfter && plan.parts[0] && plan.parts[0].pages.length >= p.pageCount ? "You can't remove every page from this PDF." : null;
  const nameError = (p.tool === "extract" && !cleanName(plan.parts[0]?.name ?? "x")) || (p.tool === "merge" && !cleanName(mergeName)) ? "Give the new file a name." : null;
  const problem = plan.error ?? (mergeErrors.size ? "Fix the page lists marked in red." : null) ?? removeError ?? nameError ?? folderError;

  const run = async () => {
    if (problem || busy) return;
    const outputs: CreatePdfsRequest["outputs"] =
      p.tool === "merge"
        ? [
            {
              name: mergeName,
              segments: items.map((it) => ({
                documentId: it.doc.id,
                title: it.doc.title,
                ...(it.pages.trim() ? { pages: parsePageList(it.pages, it.doc.pageCount ?? 100000) } : {}),
              })),
            },
          ]
        : plan.parts.map((x) => ({ name: x.name, segments: [{ documentId: p.doc.id, pages: x.pages }] }));
    setBusy(true);
    setError(null);
    try {
      if (copyBookmarks) {
        // PDFs never opened in StudySpace haven't had their own bookmarks read yet; read them now.
        const unread = new Map(outputs.flatMap((o) => o.segments).map((s) => [s.documentId, p.documents.find((d) => d.id === s.documentId)]));
        for (const d of unread.values()) {
          if (!d || d.outlineImported) continue;
          const task = openPdf(api.fileUrl(d));
          try {
            await api.importOutline(d.id, await readOutline(await task.promise));
          } catch {
            /* unreadable outline: merge without it */
          } finally {
            void task.destroy();
          }
        }
      }
      const res = await api.createPdfs({
        folder,
        newFolder: newFolder.trim() || undefined,
        outputs,
        copyNotes,
        copyHighlights,
        copyBookmarks,
        bookmarkPerSource: p.tool === "merge" && bookmarkPerSource,
      });
      p.onCreated(res.documents);
      if (p.tool === "extract" && removeAfter) await p.onRemovePages(plan.parts[0].pages);
      setCreated(res.documents);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---- Done: list what was made ------------------------------------------------------------
  if (created) {
    const where = created[0]?.relPath.split("/").slice(0, -1).join("/") || "the library folder";
    return (
      <Modal wide title={TITLES[p.tool]} onClose={p.onClose} footer={<Button variant="primary" onClick={p.onClose} autoFocus>Done</Button>}>
        <p className="flex items-center gap-2 text-sm text-ink">
          <CheckCircle2 className="size-4 text-emerald-600" />
          Saved {created.length === 1 ? "a new PDF" : `${created.length} new PDFs`} in <span className="font-medium">{where}</span>.
        </p>
        {p.tool === "extract" && removeAfter && <p className="mt-1 text-xs text-ink-3">The pages were removed from “{p.doc.title}”. Ctrl+Z puts them back.</p>}
        <ul className="ss-scroll mt-3 max-h-72 overflow-y-auto rounded-md border border-line">
          {created.map((d) => (
            <li key={d.id} className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 text-[13px] last:border-0">
              <FileOutput className="size-4 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1 truncate" title={d.relPath}>{d.title}</span>
              <span className="shrink-0 text-xs text-ink-3">{d.pageCount} p.</span>
              <button className="shrink-0 text-xs font-medium text-accent hover:underline" onClick={() => p.onOpen(d)}>
                Open
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    );
  }

  const check = (label: string, value: boolean, set: (v: boolean) => void, hint?: string) => (
    <label className="flex cursor-pointer items-start gap-2 text-[13px] text-ink">
      <input type="checkbox" className="mt-0.5" checked={value} onChange={(e) => set(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </span>
    </label>
  );

  const pagesHint = `This page is ${p.page}. Examples: "4", "3, 5-7" · the PDF has ${p.pageCount} pages`;

  return (
    <Modal
      wide
      title={TITLES[p.tool]}
      onClose={() => !busy && p.onClose()}
      footer={
        <>
          <Button variant="ghost" onClick={p.onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={busy || !!problem}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileOutput className="size-4" />}
            {busy
              ? "Saving…"
              : p.tool === "extract"
                ? removeAfter
                  ? "Extract and remove"
                  : "Extract"
                : p.tool === "split"
                  ? `Split into ${plan.parts.length || ""} file${plan.parts.length === 1 ? "" : "s"}`
                  : items.length < 2
                    ? "Merge"
                    : `Merge ${items.length} PDFs`}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-ink-3">
        {p.tool === "merge" ? "The PDFs you merge are not changed." : `“${p.doc.title}” is not changed${p.tool === "extract" ? " unless you choose to remove the pages" : ""}.`} The new
        {p.tool === "split" ? " files are" : " file is"} saved in your library folder and {p.tool === "split" ? "show" : "shows"} up in the library.
      </p>

      {p.tool === "extract" && (
        <>
          <Field label="Pages to extract" hint={pagesHint}>
            <input
              className={inputCls}
              value={extractPages}
              onChange={(e) => setExtractPages(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void run()}
              onFocus={selectAllOnFocus}
              autoFocus
            />
          </Field>
          <div className="mt-3">
            <Field label="New file name">
              <input className={inputCls} value={plan.parts[0]?.name ?? extractName ?? ""} onChange={(e) => setExtractName(e.target.value)} onFocus={selectAllOnFocus} />
            </Field>
          </div>
        </>
      )}

      {p.tool === "split" && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["every", "Every N pages", "Equal parts; 1 = one file per page"],
                ["ranges", "Page ranges", "One file per range you type"],
                ["bookmarks", "By chapters", p.bookmarks.length ? "One file per bookmark" : "This PDF has no bookmarks"],
              ] as const
            ).map(([id, label, hint]) => (
              <label
                key={id}
                className={cx(
                  "rounded-md border px-2.5 py-2 text-xs",
                  id === "bookmarks" && !p.bookmarks.length ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                  splitMode === id ? "border-accent bg-accent-soft" : "border-line hover:bg-hover",
                )}
              >
                <input
                  type="radio"
                  name="split"
                  className="sr-only"
                  disabled={id === "bookmarks" && !p.bookmarks.length}
                  checked={splitMode === id}
                  onChange={() => (setSplitMode(id), setRenamed({}))}
                />
                <span className="block font-medium text-ink">{label}</span>
                <span className="block text-ink-3">{hint}</span>
              </label>
            ))}
          </div>
          <div className="mt-3">
            {splitMode === "every" && (
              <div className="grid grid-cols-3 gap-3">
                <Field label="Pages per file">
                  <NumberInput aria-label="Pages per file" min={1} max={p.pageCount} className={inputCls} value={every} onChange={(n) => (setEvery(n), setRenamed({}))} />
                </Field>
              </div>
            )}
            {splitMode === "ranges" && (
              <Field label="Ranges, one file each" hint={`Separate files with commas, e.g. "1-12, 13-30, 31-${p.pageCount}"`}>
                <input className={inputCls} value={ranges} onChange={(e) => (setRanges(e.target.value), setRenamed({}))} onFocus={selectAllOnFocus} />
              </Field>
            )}
            {splitMode === "bookmarks" && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
                {maxLevel > 1 && (
                  <label className="flex items-center gap-2 whitespace-nowrap">
                    Split at
                    <select className={cx(inputCls, "w-auto")} value={level} onChange={(e) => (setLevel(Number(e.target.value)), setRenamed({}))}>
                      {range(1, maxLevel).map((l) => (
                        <option key={l} value={l}>
                          {l === 1 ? "top-level bookmarks (chapters)" : l === 2 ? "second-level bookmarks (sections)" : "third-level bookmarks"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {check("Pages before the first one as their own file", frontMatter, (v) => (setFrontMatter(v), setRenamed({})))}
              </div>
            )}
          </div>
          {plan.parts.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-ink-2">
                {plan.parts.length} file{plan.parts.length === 1 ? "" : "s"} · click a name to change it
              </p>
              <ul className="ss-scroll max-h-56 overflow-y-auto rounded-md border border-line">
                {plan.parts.slice(0, 500).map((x, i) => (
                  <li key={i} className="flex items-center gap-2 border-b border-line px-2 py-1 last:border-0">
                    <input
                      aria-label={`Name of file ${i + 1}`}
                      className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 text-[13px] text-ink outline-none hover:border-line focus:border-accent"
                      value={x.name}
                      onChange={(e) => setRenamed((r) => ({ ...r, [i]: e.target.value }))}
                    />
                    <span className="shrink-0 text-xs tabular-nums text-ink-3">
                      p{pagesText(x.pages)} · {x.pages.length} page{x.pages.length === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {p.tool === "merge" && (
        <>
          <p className="mb-1 text-xs font-medium text-ink-2">PDFs, in order · leave pages empty for all of them</p>
          <ul className="rounded-md border border-line">
            {items.map((it, i) => (
              <li key={it.key} className="flex items-center gap-2 border-b border-line px-2 py-1.5 last:border-0">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-3">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate text-[13px]" title={it.doc.relPath}>
                  {it.doc.title}
                  {it.doc.pageCount ? <span className="text-ink-3"> · {it.doc.pageCount} p.</span> : null}
                </span>
                <div className="w-32 shrink-0">
                  <input
                    aria-label={`Pages of ${it.doc.title}`}
                    placeholder="all pages"
                    className={cx(inputCls, "h-7 text-[13px]", mergeErrors.has(it.key) && "border-danger")}
                    title={mergeErrors.get(it.key)}
                    value={it.pages}
                    onChange={(e) => setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, pages: e.target.value } : x)))}
                  />
                </div>
                <div className="flex shrink-0">
                  <button
                    className="grid size-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-30"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => setItems((xs) => [...xs.slice(0, i - 1), xs[i], xs[i - 1], ...xs.slice(i + 1)])}
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    className="grid size-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-30"
                    aria-label="Move down"
                    disabled={i === items.length - 1}
                    onClick={() => setItems((xs) => [...xs.slice(0, i), xs[i + 1], xs[i], ...xs.slice(i + 2)])}
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    className="grid size-6 place-items-center rounded text-ink-3 hover:bg-hover hover:text-danger"
                    aria-label={`Remove ${it.doc.title}`}
                    onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
            {items.length === 0 && <li className="px-2.5 py-2 text-xs text-ink-3">Add PDFs below.</li>}
          </ul>
          <div className="mt-3">
            <input className={inputCls} placeholder="Add PDFs: search your library…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul className="ss-scroll mt-1 max-h-36 overflow-y-auto rounded-md border border-line">
              {p.documents
                .filter((d) => !query.trim() || d.relPath.toLowerCase().includes(query.trim().toLowerCase()))
                .slice(0, 50)
                .map((d) => (
                  <li key={d.id}>
                    <button
                      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px] hover:bg-hover"
                      title={d.relPath}
                      onClick={() => setItems((xs) => [...xs, { key: uuid(), doc: d, pages: "" }])}
                    >
                      <Plus className="size-3.5 shrink-0 text-ink-3" />
                      <span className="truncate">{d.relPath}</span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
          <div className="mt-3">
            <Field label="New file name">
              <input className={inputCls} value={mergeName} onChange={(e) => setMergeName(e.target.value)} onFocus={selectAllOnFocus} />
            </Field>
          </div>
        </>
      )}

      {/* Where */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Save in folder" hint={folders && !folders.length ? "Add a study folder first (Settings)." : undefined}>
          <div className="relative">
            <FolderOpen className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <select aria-label="Save in folder" className={cx(inputCls, "pl-8")} value={folder} onChange={(e) => setFolder(e.target.value)} disabled={!folders}>
              {!folders && <option>Loading folders…</option>}
              {folders?.map((f) => (
                <option key={f.path} value={f.path}>
                  {"  ".repeat(f.depth)}
                  {f.depth ? f.label.split("/").pop() : f.label}
                  {f.path === docDir ? "  (this PDF's folder)" : ""}
                </option>
              ))}
            </select>
          </div>
        </Field>
        <Field label="In a new sub-folder (optional)">
          <input className={inputCls} placeholder="e.g. Extracted" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} />
        </Field>
      </div>

      {/* What comes along */}
      <div className="mt-4 space-y-2 rounded-lg border border-line p-3">
        <p className="text-xs font-medium text-ink-2">Bring along, for the pages that are copied</p>
        {check("Notes and resources", copyNotes, setCopyNotes, "Page and range notes (whole-document notes stay with the original)")}
        {check("Highlights and drawings", copyHighlights, setCopyHighlights)}
        {check("Bookmarks", copyBookmarks, setCopyBookmarks, "Written into the new PDF's outline")}
        {p.tool === "merge" && check("A bookmark for each merged PDF", bookmarkPerSource, setBookmarkPerSource, "Named after the PDF, with its own bookmarks inside")}
        {p.tool === "extract" &&
          check(
            "Remove these pages from this PDF afterwards",
            removeAfter,
            setRemoveAfter,
            "Moves the pages out: this rewrites the original PDF (undo with Ctrl+Z). Notes on those pages are deleted there, after being copied.",
          )}
      </div>

      {(error || problem) && <p className="mt-3 text-xs text-danger">{error ?? problem}</p>}
    </Modal>
  );
}
