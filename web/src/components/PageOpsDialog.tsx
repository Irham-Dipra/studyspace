import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { openPdf, parsePageList } from "../lib/pdf";
import { api, type OrphanPolicy } from "../lib/api";
import { scopeLabel, type Annotation, type DocumentRecord, type Resource } from "../lib/types";
import { Button, Field, Modal, NumberInput, cx, inputCls, selectAllOnFocus } from "./ui";

/** `preset` pre-fills the delete dialog's page list ("" for an empty field; default: the current page). */
export type PageOp = { kind: "blank" } | { kind: "from" } | { kind: "replace" } | { kind: "delete"; preset?: string } | { kind: "rotate" } | { kind: "move" };

interface Props {
  op: PageOp;
  doc: DocumentRecord;
  page: number;
  pageCount: number;
  documents: DocumentRecord[];
  resources: Resource[];
  annotations: Annotation[];
  busy: boolean;
  onClose: () => void;
  onInsertBlank: (after: number, count: number) => void;
  onInsertFrom: (after: number, sourceId: string, from: number, to: number) => void;
  onReplace: (page: number, sourceId: string, from: number, to: number, keepAnnotations: boolean) => void;
  onDelete: (pages: number[], orphans: OrphanPolicy) => void;
  onRotate: (pages: number[], angle: 90 | 180 | 270) => void;
  onMove: (pages: number[], after: number) => void;
}

function Warning({ children }: { children?: React.ReactNode }) {
  return (
    <p className="mb-3 flex gap-2 rounded-md bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        {children ??
          "This rewrites the original PDF on disk. Your notes and highlights stay with their pages as page numbers shift, and you can undo it with Ctrl+Z."}
      </span>
    </p>
  );
}

/** Page count of a library PDF, read from the file when the library doesn't know it yet. */
function useSourcePageCount(source: DocumentRecord | undefined): number | null {
  const [counted, setCounted] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (!source || source.pageCount) return;
    let cancelled = false;
    const task = openPdf(api.fileUrl(source));
    task.promise
      .then((pdf) => {
        if (cancelled) return;
        setCounted({ id: source.id, n: pdf.numPages });
        void api.setPageCount(source.id, pdf.numPages).catch(() => undefined);
      })
      .catch(() => undefined)
      .finally(() => void task.destroy());
    return () => {
      cancelled = true;
    };
  }, [source]);
  if (!source) return null;
  return source.pageCount || (counted?.id === source.id ? counted.n : null);
}

function SourcePicker(props: {
  documents: DocumentRecord[];
  currentId: string;
  /** Also offer the open PDF itself (e.g. to replace a page with another page of the same file). */
  includeCurrent?: boolean;
  selected: string | null;
  onSelect: (d: DocumentRecord) => void;
}) {
  const [query, setQuery] = useState("");
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const docs = props.documents.filter((d) => (props.includeCurrent || d.id !== props.currentId) && (!q || d.relPath.toLowerCase().includes(q)));
    docs.sort((a, b) => Number(b.id === props.currentId) - Number(a.id === props.currentId));
    return docs.slice(0, 50);
  }, [props.documents, props.currentId, props.includeCurrent, query]);

  return (
    <>
      <Field label="Source PDF">
        <input className={inputCls} placeholder="Search your library…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      </Field>
      <ul className="ss-scroll mt-2 max-h-48 overflow-y-auto rounded-md border border-line">
        {candidates.map((d) => (
          <li key={d.id}>
            <button
              className={cx("block w-full truncate px-2.5 py-1.5 text-left text-[13px]", d.id === props.selected ? "bg-accent-soft text-accent" : "hover:bg-hover")}
              onClick={() => props.onSelect(d)}
              title={d.relPath}
            >
              {d.relPath}
              {d.id === props.currentId && <span className="ml-2 text-ink-3">· this PDF</span>}
              {d.pageCount ? <span className="ml-2 text-ink-3">· {d.pageCount} pages</span> : null}
            </button>
          </li>
        ))}
        {candidates.length === 0 && <li className="px-2.5 py-2 text-xs text-ink-3">No matching PDFs</li>}
      </ul>
    </>
  );
}

export function PageOpsDialog(p: Props) {
  const [after, setAfter] = useState(p.page);
  const [count, setCount] = useState(1);
  const [pages, setPages] = useState(p.op.kind === "delete" && p.op.preset !== undefined ? p.op.preset : String(p.page));
  const [orphans, setOrphans] = useState<OrphanPolicy>("delete");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [target, setTarget] = useState(p.page);
  const [keepAnnotations, setKeepAnnotations] = useState(false);
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [moveAfter, setMoveAfter] = useState(Math.min(p.page + 1, p.pageCount));

  const source = p.documents.find((d) => d.id === sourceId);
  const sourcePages = useSourcePageCount(source);
  const pickSource = (d: DocumentRecord) => {
    setSourceId(d.id);
    setFrom(1);
    setTo(1);
  };

  let parsed: number[] = [];
  let parseError: string | null = null;
  try {
    parsed = parsePageList(pages, p.pageCount);
  } catch (err) {
    parseError = (err as Error).message;
  }

  const afterField = (
    <Field label="Insert after page" hint="0 inserts before the first page">
      <NumberInput min={0} max={p.pageCount} className={inputCls} value={after} onChange={setAfter} />
    </Field>
  );

  if (p.op.kind === "blank") {
    return (
      <Modal
        title="Insert blank page"
        onClose={p.onClose}
        footer={
          <>
            <Button variant="ghost" onClick={p.onClose}>Cancel</Button>
            <Button variant="primary" disabled={p.busy} onClick={() => p.onInsertBlank(after, count)}>Insert</Button>
          </>
        }
      >
        <Warning />
        <div className="grid grid-cols-2 gap-3">
          {afterField}
          <Field label="How many">
            <NumberInput min={1} max={50} className={inputCls} value={count} onChange={setCount} />
          </Field>
        </div>
      </Modal>
    );
  }

  if (p.op.kind === "delete") {
    const deleted = new Set(parsed);
    const firstDeleted = parsed[0] ?? Infinity;
    const paged = p.resources.filter((r) => r.scope !== "document" && r.pageStart !== null && r.pageEnd !== null);
    const orphaned = paged.filter((r) => {
      for (let x = r.pageStart!; x <= r.pageEnd!; x++) if (!deleted.has(x)) return false;
      return true;
    });
    const shrinking = paged.filter((r) => !orphaned.includes(r) && [...deleted].some((d) => d >= r.pageStart! && d <= r.pageEnd!));
    const shifting = paged.filter((r) => !orphaned.includes(r) && r.pageStart! > firstDeleted).length;
    const highlightsGone = p.annotations.filter((a) => deleted.has(a.page)).length;
    const valid = !parseError && parsed.length > 0 && parsed.length < p.pageCount;
    return (
      <Modal
        wide
        title={parsed.length === 1 ? `Delete page ${parsed[0]}` : "Delete pages"}
        onClose={p.onClose}
        footer={
          <>
            <Button variant="ghost" onClick={p.onClose}>Cancel</Button>
            <Button variant="danger" disabled={p.busy || !valid} onClick={() => p.onDelete(parsed, orphans)}>
              Delete {parsed.length || ""} page{parsed.length === 1 ? "" : "s"}
            </Button>
          </>
        }
      >
        <Warning />
        <Field label="Pages to delete" hint={`This page is ${p.page}. Examples: "4", "3, 5-7" · the document has ${p.pageCount} pages`}>
          <input
            className={inputCls}
            value={pages}
            onChange={(e) => setPages(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && valid && !p.busy && p.onDelete(parsed, orphans)}
            onFocus={selectAllOnFocus}
            autoFocus
          />
        </Field>
        {parseError && <p className="mt-2 text-xs text-danger">{parseError}</p>}
        {parsed.length >= p.pageCount && <p className="mt-2 text-xs text-danger">You can't delete every page.</p>}

        {valid && (
          <div className="mt-4 space-y-2 text-xs leading-relaxed text-ink-2">
            <p className="font-semibold text-ink">What happens to your notes</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                {shifting > 0
                  ? `${shifting} note${shifting === 1 ? "" : "s"} on later pages move up together with their pages: each stays on the same content, only its page number changes.`
                  : "Notes on later pages keep following their pages as the numbers shift."}
              </li>
              {shrinking.length > 0 && (
                <li>
                  {shrinking.length} page-range resource{shrinking.length === 1 ? "" : "s"} will shrink to the pages that remain.
                </li>
              )}
              {highlightsGone > 0 && (
                <li>
                  {highlightsGone} highlight{highlightsGone === 1 ? "" : "s"}/drawing{highlightsGone === 1 ? "" : "s"} on the deleted page{parsed.length === 1 ? "" : "s"} will be removed with {parsed.length === 1 ? "it" : "them"}.
                </li>
              )}
            </ul>

            {orphaned.length > 0 && (
              <div className="mt-3 rounded-lg border border-line p-3">
                <p className="font-semibold text-ink">
                  {orphaned.length} note{orphaned.length === 1 ? "" : "s"}/resource{orphaned.length === 1 ? "" : "s"} belong only to the deleted page{parsed.length === 1 ? "" : "s"}:
                </p>
                <ul className="mt-1 max-h-24 overflow-y-auto pl-1 text-ink-3">
                  {orphaned.map((r) => (
                    <li key={r.id} className="truncate">• {r.title || r.content.slice(0, 60) || r.url || "Untitled"} <span className="opacity-70">({scopeLabel(r)})</span></li>
                  ))}
                </ul>
                <p className="mt-2 text-ink-3">They are never moved onto a different page. Choose:</p>
                <div className="mt-1.5 space-y-1.5">
                  {(
                    [
                      ["delete", "Delete them together with the page", "Undo (Ctrl+Z) brings the page and these notes back."],
                      ["document", "Keep them as whole-document notes", "They stay visible on every page of this PDF."],
                    ] as const
                  ).map(([id, label, hint]) => (
                    <label key={id} className={cx("flex cursor-pointer gap-2 rounded-md border px-2.5 py-2", orphans === id ? "border-accent bg-accent-soft" : "border-line hover:bg-hover")}>
                      <input type="radio" name="orphans" className="mt-0.5" checked={orphans === id} onChange={() => setOrphans(id)} />
                      <span>
                        <span className="block font-medium text-ink">{label}</span>
                        <span className="block text-ink-3">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    );
  }

  if (p.op.kind === "rotate") {
    const valid = !parseError && parsed.length > 0;
    const run = () => valid && !p.busy && p.onRotate(parsed, angle);
    return (
      <Modal
        title="Turn pages"
        onClose={p.onClose}
        footer={
          <>
            <Button variant="ghost" onClick={p.onClose}>Cancel</Button>
            <Button variant="primary" disabled={p.busy || !valid} onClick={run}>
              Turn {parsed.length > 1 ? `${parsed.length} pages` : "page"}
            </Button>
          </>
        }
      >
        <Warning>This rewrites the original PDF on disk. Your highlights and drawings turn with their pages, and you can undo it with Ctrl+Z.</Warning>
        <Field label="Pages" hint={`This page is ${p.page}. Examples: "4", "3, 5-7" · the document has ${p.pageCount} pages`}>
          <input className={inputCls} value={pages} onChange={(e) => setPages(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} onFocus={selectAllOnFocus} autoFocus />
        </Field>
        <div className="mt-1.5 flex gap-3 text-xs">
          <button className="text-accent hover:underline" onClick={() => setPages(String(p.page))}>This page</button>
          <button className="text-accent hover:underline" onClick={() => setPages(`1-${p.pageCount}`)}>All pages</button>
        </div>
        {parseError && <p className="mt-2 text-xs text-danger">{parseError}</p>}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {(
            [
              [90, "Right", "↻ clockwise"],
              [270, "Left", "↺ anticlockwise"],
              [180, "Upside down", "↻ 180°"],
            ] as const
          ).map(([a, label, hint]) => (
            <label key={a} className={cx("cursor-pointer rounded-md border px-2.5 py-2 text-xs", angle === a ? "border-accent bg-accent-soft" : "border-line hover:bg-hover")}>
              <input type="radio" name="angle" className="sr-only" checked={angle === a} onChange={() => setAngle(a)} />
              <span className="block font-medium text-ink">{label}</span>
              <span className="block text-ink-3">{hint}</span>
            </label>
          ))}
        </div>
      </Modal>
    );
  }

  if (p.op.kind === "move") {
    const moved = new Set(parsed);
    const order = (() => {
      const rest = Array.from({ length: p.pageCount }, (_, i) => i + 1).filter((x) => !moved.has(x));
      const at = rest.filter((x) => x <= moveAfter).length;
      return [...rest.slice(0, at), ...parsed, ...rest.slice(at)];
    })();
    const unchanged = order.every((old, i) => old === i + 1);
    const error = parseError ?? (moved.has(moveAfter) ? "The pages can't go after one of themselves." : parsed.length && unchanged ? "The pages are already there." : null);
    const valid = !error && parsed.length > 0;
    const run = () => valid && !p.busy && p.onMove(parsed, moveAfter);
    const newFirst = order.indexOf(parsed[0]) + 1;
    return (
      <Modal
        title="Move pages"
        onClose={p.onClose}
        footer={
          <>
            <Button variant="ghost" onClick={p.onClose}>Cancel</Button>
            <Button variant="primary" disabled={p.busy || !valid} onClick={run}>
              Move {parsed.length > 1 ? `${parsed.length} pages` : "page"}
            </Button>
          </>
        }
      >
        <Warning>This rewrites the original PDF on disk. Notes, highlights and bookmarks move with their pages, and you can undo it with Ctrl+Z.</Warning>
        <Field label="Pages to move" hint={`This page is ${p.page}. Examples: "4", "3, 5-7" · the document has ${p.pageCount} pages`}>
          <input className={inputCls} value={pages} onChange={(e) => setPages(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} onFocus={selectAllOnFocus} autoFocus />
        </Field>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Put them after page" hint="0 moves them to the start">
            <NumberInput aria-label="Put them after page" min={0} max={p.pageCount} className={inputCls} value={moveAfter} onChange={setMoveAfter} />
          </Field>
        </div>
        <div className="mt-1.5 flex gap-3 text-xs">
          <button className="text-accent hover:underline" onClick={() => setMoveAfter(0)}>To the start</button>
          <button className="text-accent hover:underline" onClick={() => setMoveAfter(p.pageCount)}>To the end</button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        {valid && (
          <p className="mt-3 text-xs text-ink-2">
            {parsed.length === 1 ? `Page ${parsed[0]} becomes page ${newFirst}.` : `These ${parsed.length} pages become pages ${newFirst}–${newFirst + parsed.length - 1}, in their current order.`}
          </p>
        )}
      </Modal>
    );
  }

  if (p.op.kind === "replace") {
    const count = Math.max(0, to - from + 1);
    const last = target + count - 1;
    const error = !source
      ? null
      : to < from
        ? "“To page” can't be before “With page”."
        : sourcePages && to > sourcePages
          ? `The source PDF has only ${sourcePages} pages.`
          : last > p.pageCount
            ? `Replacing ${count} pages from page ${target} goes past the end (this PDF has ${p.pageCount} pages).`
            : source.id === p.doc.id && from === target
              ? "That would replace the pages with themselves."
              : null;
    const valid = !!source && !error && count > 0;
    const pagesLabel = count === 1 ? `page ${target}` : `pages ${target}–${last}`;
    const notesKept = p.resources.filter(
      (r) => r.scope !== "document" && r.pageStart !== null && r.pageEnd !== null && r.pageStart <= last && r.pageEnd >= target,
    ).length;
    const marks = p.annotations.filter((a) => a.page >= target && a.page <= last).length;
    return (
      <Modal
        wide
        title="Replace pages"
        onClose={p.onClose}
        footer={
          <>
            <Button variant="ghost" onClick={p.onClose}>Cancel</Button>
            <Button variant="primary" disabled={p.busy || !valid} onClick={() => valid && p.onReplace(target, source!.id, from, to, keepAnnotations)}>
              Replace {count > 1 ? `${count} pages` : "page"}
            </Button>
          </>
        }
      >
        <Warning>This rewrites the original PDF on disk. Page numbers don't change, so your notes stay on their pages. You can undo it with Ctrl+Z.</Warning>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Replace page" hint={`of ${p.pageCount}`}>
            <NumberInput aria-label="Replace page" min={1} max={p.pageCount} className={inputCls} value={target} onChange={setTarget} />
          </Field>
        </div>
        <div className="mt-3">
          <SourcePicker documents={p.documents} currentId={p.doc.id} includeCurrent selected={sourceId} onSelect={pickSource} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Field label="With page">
            <NumberInput
              aria-label="With page"
              min={1}
              max={sourcePages || undefined}
              className={inputCls}
              value={from}
              onChange={(n) => {
                // Keep a single-page replacement single when the start moves.
                if (to === from || to < n) setTo(n);
                setFrom(n);
              }}
            />
          </Field>
          <Field label="To page (optional)" hint={sourcePages ? `of ${sourcePages}` : source ? "Counting pages…" : "for several pages"}>
            <NumberInput aria-label="To page" min={1} max={sourcePages || undefined} className={inputCls} value={to} onChange={setTo} />
          </Field>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        {valid && (
          <div className="mt-4 space-y-2 text-xs leading-relaxed text-ink-2">
            <p className="font-semibold text-ink">What happens</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                {count === 1 ? `Page ${target} is` : `Pages ${target}–${last} are`} replaced by {count === 1 ? `page ${from}` : `pages ${from}–${to}`} of “
                {source!.title}”. Every other page keeps its number.
              </li>
              <li>
                {notesKept > 0
                  ? `${notesKept} note${notesKept === 1 ? "" : "s"}/resource${notesKept === 1 ? "" : "s"} on ${pagesLabel} stay${notesKept === 1 ? "s" : ""} attached to ${count === 1 ? "it" : "them"}.`
                  : `Notes you add to ${pagesLabel} later work as usual.`}
              </li>
            </ul>
            {marks > 0 && (
              <label className="mt-2 flex cursor-pointer gap-2 rounded-lg border border-line p-3 hover:bg-hover">
                <input type="checkbox" className="mt-0.5" checked={keepAnnotations} onChange={(e) => setKeepAnnotations(e.target.checked)} />
                <span>
                  <span className="block font-medium text-ink">
                    Keep my {marks} highlight{marks === 1 ? "" : "s"}/drawing{marks === 1 ? "" : "s"} on {pagesLabel}
                  </span>
                  <span className="block text-ink-3">
                    They were made on the old page and probably won't line up with the new one, so they are removed unless you tick this. Undo brings them back either way.
                  </span>
                </span>
              </label>
            )}
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      wide
      title="Insert pages from another PDF"
      onClose={p.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={p.onClose}>Cancel</Button>
          <Button variant="primary" disabled={p.busy || !source || from < 1 || to < from} onClick={() => source && p.onInsertFrom(after, source.id, from, to)}>
            Insert {source ? `${to - from + 1} page${to === from ? "" : "s"}` : ""}
          </Button>
        </>
      }
    >
      <Warning />
      <SourcePicker documents={p.documents} currentId={p.doc.id} selected={sourceId} onSelect={pickSource} />
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Field label="From page">
          <NumberInput min={1} max={sourcePages || undefined} className={inputCls} value={from} onChange={setFrom} />
        </Field>
        <Field label="To page" hint={sourcePages ? `of ${sourcePages}` : source ? "Counting pages…" : undefined}>
          <NumberInput min={1} max={sourcePages || undefined} className={inputCls} value={to} onChange={setTo} />
        </Field>
        {afterField}
      </div>
    </Modal>
  );
}
