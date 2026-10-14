import { useEffect, useRef, useState } from "react";
import { Eye, Pencil } from "lucide-react";
import type { ResourceInput } from "../lib/api";
import { RESOURCE_TYPE_LABEL, type Resource, type ResourceScope, type ResourceType } from "../lib/types";
import { Markdown } from "./Markdown";
import { Button, NumberInput, cx, inputCls } from "./ui";

interface Props {
  page: number;
  pageCount: number;
  initial?: Resource;
  defaults?: Partial<ResourceInput>;
  onSave: (input: ResourceInput) => Promise<void>;
  onCancel: () => void;
  /** Reports whether the form holds changes that haven't been saved yet. */
  onDirtyChange?: (dirty: boolean) => void;
}

const TYPES: ResourceType[] = ["note", "summary", "pyq", "ai_explanation", "link"];
const SCOPES: { id: ResourceScope; label: string }[] = [
  { id: "page", label: "This page" },
  { id: "range", label: "Page range" },
  { id: "document", label: "Whole document" },
];

export function ResourceEditor({ page, pageCount, initial, defaults, onSave, onCancel, onDirtyChange }: Props) {
  const [type, setType] = useState<ResourceType>(initial?.type ?? defaults?.type ?? "note");
  const [scope, setScope] = useState<ResourceScope>(initial?.scope ?? defaults?.scope ?? "page");
  const [start, setStart] = useState<number>(initial?.pageStart ?? defaults?.pageStart ?? page);
  const [end, setEnd] = useState<number>(initial?.pageEnd ?? defaults?.pageEnd ?? page);
  const [title, setTitle] = useState(initial?.title ?? defaults?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? defaults?.content ?? "");
  const [url, setUrl] = useState(initial?.url ?? defaults?.url ?? "");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const snapshot = JSON.stringify([type, scope, start, end, title, content, url]);
  const [pristine] = useState(snapshot);
  const dirty = snapshot !== pristine;
  const dirtyRef = useRef(onDirtyChange);
  dirtyRef.current = onDirtyChange;
  useEffect(() => dirtyRef.current?.(dirty), [dirty]);
  useEffect(() => () => dirtyRef.current?.(false), []);

  useEffect(() => {
    const el = contentRef.current;
    if (el && !initial) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [initial]);

  const submit = async () => {
    setError(null);
    if (type === "link" && !url.trim()) return setError("A link needs a URL.");
    if (!title.trim() && !content.trim() && !url.trim()) return setError("Add a title, some content or a URL.");
    const max = pageCount || Number.MAX_SAFE_INTEGER;
    if (scope !== "document" && (start < 1 || start > max || (scope === "range" && (end < 1 || end > max)))) {
      return setError(`Pages must be between 1 and ${pageCount}.`);
    }
    setBusy(true);
    try {
      await onSave({
        type,
        scope,
        pageStart: scope === "document" ? null : start,
        pageEnd: scope === "document" ? null : scope === "page" ? start : end,
        title: title.trim(),
        content,
        url: url.trim() || null,
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form
      className="rounded-lg border border-accent/40 bg-panel p-3 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          void submit();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="mb-2 flex flex-wrap gap-1">
        {TYPES.map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => setType(t)}
            className={cx(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium",
              type === t ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:bg-hover",
            )}
          >
            {RESOURCE_TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <input className={cx(inputCls, "mb-2")} placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />

      {(type === "link" || url) && (
        <input
          className={cx(inputCls, "mb-2")}
          placeholder="https://…"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      )}

      <div className="relative">
        <div className="absolute right-1 top-1 z-10 flex rounded-md border border-line bg-panel text-[11px]">
          <button type="button" className={cx("flex items-center gap-1 px-1.5 py-0.5", !preview && "text-accent")} onClick={() => setPreview(false)}>
            <Pencil className="size-3" /> Write
          </button>
          <button type="button" className={cx("flex items-center gap-1 px-1.5 py-0.5", preview && "text-accent")} onClick={() => setPreview(true)}>
            <Eye className="size-3" /> Preview
          </button>
        </div>
        {preview ? (
          <div className="min-h-28 rounded-md border border-line bg-subtle px-2.5 pb-2 pt-7">
            {content.trim() ? <Markdown>{content}</Markdown> : <p className="text-sm text-ink-3">Nothing to preview</p>}
          </div>
        ) : (
          <textarea
            ref={contentRef}
            className="block min-h-28 w-full resize-y rounded-md border border-line bg-panel px-2.5 pb-2 pt-7 font-mono text-[13px] leading-relaxed outline-none placeholder:text-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20"
            placeholder={type === "pyq" ? "Paste the question, year and your answer… (Markdown, $math$ supported)" : "Write in Markdown… $E = mc^2$ works too"}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
          />
        )}
      </div>

      <div className="mt-2">
        <div className="flex rounded-md border border-line p-0.5 text-xs">
          {SCOPES.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => {
                setScope(s.id);
                if (s.id === "range" && end < start) setEnd(start);
              }}
              className={cx("flex-1 rounded px-2 py-1 font-medium", scope === s.id ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-hover")}
            >
              {s.label}
            </button>
          ))}
        </div>
        {scope !== "document" && (
          <div className="mt-2 flex items-center gap-2 text-xs text-ink-2">
            <span>{scope === "page" ? "Page" : "From"}</span>
            <NumberInput
              aria-label={scope === "page" ? "Page" : "First page"}
              min={1}
              max={pageCount || undefined}
              className={cx(inputCls, "h-7 w-20")}
              value={start}
              onChange={setStart}
            />
            {scope === "range" && (
              <>
                <span>to</span>
                <NumberInput
                  aria-label="Last page"
                  min={1}
                  max={pageCount || undefined}
                  className={cx(inputCls, "h-7 w-20")}
                  value={end}
                  onChange={setEnd}
                />
              </>
            )}
            {pageCount > 0 && <span className="text-ink-3">of {pageCount}</span>}
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-ink-3">Ctrl+Enter to save</span>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {initial ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}
