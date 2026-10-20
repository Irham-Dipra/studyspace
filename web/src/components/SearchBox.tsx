import { useEffect, useRef, useState } from "react";
import { FileText, NotebookPen, Search, X } from "lucide-react";
import { api } from "../lib/api";
import { scopeLabel, type DocumentRecord, type Resource } from "../lib/types";
import { cx } from "./ui";

interface Props {
  onOpenDocument: (doc: DocumentRecord, page?: number) => void;
  documents: DocumentRecord[];
}

type Results = Awaited<ReturnType<typeof api.search>>;

export function SearchBox({ onOpenDocument, documents }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Results | null>(null);
  const [active, setActive] = useState(0);
  /** Narrow screens (phones) show only a search button; it opens the box over the header. */
  const [expanded, setExpanded] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) return setResults(null);
    const t = setTimeout(() => {
      api.search(term).then(setResults, () => setResults(null));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setExpanded(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const items: ({ kind: "doc"; doc: DocumentRecord } | { kind: "res"; res: Resource & { documentTitle: string } })[] = [
    ...(results?.documents.slice(0, 8).map((doc) => ({ kind: "doc" as const, doc })) ?? []),
    ...(results?.resources.slice(0, 12).map((res) => ({ kind: "res" as const, res })) ?? []),
  ];

  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    if (it.kind === "doc") onOpenDocument(it.doc);
    else {
      const doc = documents.find((d) => d.id === it.res.documentId);
      if (doc) onOpenDocument(doc, it.res.pageStart ?? undefined);
    }
    setOpen(false);
    setExpanded(false);
    setQ("");
    inputRef.current?.blur();
  };

  const collapse = () => {
    setOpen(false);
    setExpanded(false);
    setQ("");
    inputRef.current?.blur(); // else typing would go on into the hidden box
  };

  return (
    <>
      <button
        className="grid size-8 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink sm:hidden"
        aria-label="Search files and notes"
        title="Search files and notes"
        // Focused right in the tap: phones only open the keyboard for a focus the tap itself made.
        onClick={() => inputRef.current?.focus()}
      >
        <Search className="size-4" />
      </button>
      <div
        ref={boxRef}
        className={cx(
          "relative w-full max-w-md",
          // Collapsed, the box stays in the page (invisible) so the button can focus it.
          expanded
            ? "max-sm:fixed max-sm:inset-x-2 max-sm:top-2 max-sm:z-[60] max-sm:max-w-none"
            : "max-sm:pointer-events-none max-sm:absolute max-sm:size-px max-sm:overflow-hidden max-sm:opacity-0",
        )}
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <input
          data-arrow-nav="off"
          ref={inputRef}
          className="h-8 w-full rounded-md border border-line bg-subtle pl-8 pr-9 text-sm outline-none placeholder:text-ink-3 focus:border-accent focus:bg-panel max-sm:text-base sm:pr-14"
          placeholder="Search files and notes…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => (setOpen(true), setExpanded(true))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(items.length - 1, a + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
            else if (e.key === "Enter") choose(active);
            else if (e.key === "Escape") (collapse(), e.currentTarget.blur());
          }}
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1 text-[10px] text-ink-3 sm:block">Ctrl K</kbd>
        <button
          className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-ink-3 hover:text-ink sm:hidden"
          aria-label="Close search"
          onClick={collapse}
        >
          <X className="size-4" />
        </button>
        {open && q.trim() && results && (
          <div className="absolute left-0 right-0 top-10 z-50 max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-xl">
            {items.length === 0 && <p className="px-3 py-3 text-sm text-ink-3">No matches for “{q}”</p>}
            {items.map((it, i) => (
              <button
                key={it.kind === "doc" ? it.doc.id : it.res.id}
                className={cx("flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left", i === active ? "bg-hover" : "hover:bg-hover")}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
              >
                {it.kind === "doc" ? (
                  <>
                    <FileText className="mt-0.5 size-4 shrink-0 text-ink-3" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{it.doc.title}</span>
                      <span className="block truncate text-xs text-ink-3">{it.doc.relPath}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <NotebookPen className="mt-0.5 size-4 shrink-0 text-accent" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{it.res.title || it.res.content.slice(0, 80) || it.res.url}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {it.res.documentTitle} · {scopeLabel(it.res)}
                      </span>
                    </span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
