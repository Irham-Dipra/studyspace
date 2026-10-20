import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  FileQuestion,
  Highlighter,
  Link2,
  NotebookPen,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
} from "lucide-react";
import type { ResourceInput } from "../lib/api";
import {
  RESOURCE_TYPE_LABEL,
  resourceCoversPage,
  scopeLabel,
  type Annotation,
  type NoteHighlight,
  type Resource,
  type ResourceType,
} from "../lib/types";
import { NoteBody, NotePopovers, type Anchor, type NotePopover } from "./NoteAnnotations";
import { ResourceEditor } from "./ResourceEditor";
import { Button, IconButton, KeyHint, cx } from "./ui";

export interface EditorRequest {
  nonce: number;
  defaults: Partial<ResourceInput>;
}

interface Props {
  page: number;
  pageCount: number;
  /** False for documents without pages (HTML, Markdown): every note is for the whole document. */
  paged: boolean;
  resources: Resource[];
  annotations: Annotation[];
  /** Highlights inside notes/resources of this document. */
  noteHighlights: NoteHighlight[];
  highlightColor: string;
  onCreateNoteHighlight: (resourceId: string, anchor: Anchor, color: string) => Promise<NoteHighlight | undefined>;
  onUpdateNoteHighlight: (id: string, patch: { color?: string; comment?: string }) => void;
  onDeleteNoteHighlights: (ids: string[]) => void;
  editorRequest: EditorRequest | null;
  onEditorRequestHandled: () => void;
  /** Whether a note/resource form holds unsaved text (so the app can warn before leaving the PDF). */
  onDraftChange?: (dirty: boolean) => void;
  onCreate: (input: ResourceInput) => Promise<void>;
  onUpdate: (id: string, input: ResourceInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onJump: (page: number) => void;
  /** Changes (a timestamp) when the "close all / expand all notes" key is pressed. */
  toggleAllRequest?: number;
}

const TYPE_ICON: Record<ResourceType, typeof NotebookPen> = {
  note: NotebookPen,
  ai_explanation: Bot,
  summary: ScrollText,
  pyq: FileQuestion,
  link: Link2,
};

/** Order of the sections in the single combined list. */
const GROUPS: { type: ResourceType; label: string }[] = [
  { type: "note", label: "My Notes" },
  { type: "summary", label: "Summaries" },
  { type: "ai_explanation", label: "AI Explanations" },
  { type: "pyq", label: "Previous Year Questions" },
  { type: "link", label: "External Links" },
];

export function ResourcePanel(props: Props) {
  const { page, resources } = props;
  const [editing, setEditing] = useState<{ resource?: Resource; defaults?: Partial<ResourceInput>; key: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [popover, setPopover] = useState<NotePopover | null>(null);
  const closePopover = useCallback(() => setPopover(null), []);
  const highlightsByResource = useMemo(() => {
    const m = new Map<string, NoteHighlight[]>();
    for (const h of props.noteHighlights) m.set(h.resourceId, [...(m.get(h.resourceId) ?? []), h]);
    return m;
  }, [props.noteHighlights]);
  /** Cards start open; this holds the ids the user has closed (reset when another PDF is opened). */
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // Open the editor when another part of the UI asks for it (e.g. "quote to note" from a selection).
  const { editorRequest, onEditorRequestHandled } = props;
  useEffect(() => {
    if (!editorRequest) return;
    setEditing({ defaults: editorRequest.defaults, key: editorRequest.nonce });
    onEditorRequestHandled();
  }, [editorRequest, onEditorRequestHandled]);

  // Filtered client-side from the document's full list so page changes update instantly.
  const visible = useMemo(() => resources.filter((r) => resourceCoversPage(r, page)), [resources, page]);
  const pageHighlights = props.annotations.filter((a) => a.page === page && a.kind === "highlight" && a.text);

  // The C key: close every card on this page, or open them all if they are all closed already.
  useEffect(() => {
    if (!props.toggleAllRequest) return;
    setClosed((s) => {
      const allOpen = visible.every((r) => !s.has(r.id));
      const n = new Set(s);
      for (const r of visible) allOpen ? n.add(r.id) : n.delete(r.id);
      return n;
    });
  }, [props.toggleAllRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAdd = () =>
    setEditing({ key: Date.now(), defaults: props.paged ? { type: "note", scope: "page", pageStart: page, pageEnd: page } : { type: "note", scope: "document" } });

  const card = (r: Resource) => {
    if (editing?.resource?.id === r.id) {
      return (
        <ResourceEditor
          key={r.id}
          page={page}
          pageCount={props.pageCount}
          paged={props.paged}
          initial={r}
          onCancel={() => setEditing(null)}
          onDirtyChange={props.onDraftChange}
          onSave={async (input) => {
            await props.onUpdate(r.id, input);
            setEditing(null);
          }}
        />
      );
    }
    const Icon = TYPE_ICON[r.type];
    const offPage = r.scope !== "document" && r.pageStart !== null && r.pageStart !== page;
    const open = !closed.has(r.id);
    const hasBody = !!r.url || !!r.content.trim();
    const title = r.title || firstLine(r.content) || (r.type === "link" ? r.url : null) || RESOURCE_TYPE_LABEL[r.type];
    return (
      <article key={r.id} className="group rounded-lg border border-line bg-panel px-3 py-2.5 transition hover:border-ink-3/40">
        <header className="flex items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            {/* The toggle flows inline right after the last word of the title, even when it wraps. */}
            <h4 className="break-words text-sm font-semibold leading-snug">
              <button className="text-left hover:text-accent" onClick={() => toggle(r.id)} aria-expanded={open}>
                <span className="ss-title-hl">{title}</span>
              </button>
              {hasBody && (
                <button
                  onClick={() => toggle(r.id)}
                  aria-expanded={open}
                  aria-label={open ? "Close" : "Expand"}
                  className={cx(
                    "ml-1.5 inline-flex h-5 items-center gap-0.5 whitespace-nowrap rounded-full border px-1.5 align-[1px] text-[11px] font-medium transition",
                    open ? "border-line text-ink-3 hover:bg-hover hover:text-ink" : "border-accent/40 bg-accent-soft text-accent hover:brightness-95",
                  )}
                >
                  {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  {open ? "Close" : "Expand"}
                </button>
              )}
            </h4>
            <button
              className={cx("mt-0.5 text-[11px] text-ink-3", offPage && "hover:text-accent hover:underline")}
              onClick={() => offPage && props.onJump(r.pageStart!)}
              title={offPage ? `Go to page ${r.pageStart}` : undefined}
            >
              {r.type !== "note" && `${RESOURCE_TYPE_LABEL[r.type]} · `}
              {scopeLabel(r)}
            </button>
          </div>
          <div className="flex opacity-60 transition group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <IconButton label="Edit" className="size-7" onClick={() => setEditing({ resource: r, key: Date.now() })}>
              <Pencil className="size-3.5" />
            </IconButton>
            <IconButton label="Delete" className="size-7 hover:text-danger" onClick={() => setConfirmDelete(r.id)}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        </header>
        {confirmDelete === r.id && (
          <div className="mt-2 flex items-center gap-2 rounded-md bg-subtle px-2 py-1.5 text-xs">
            <span className="flex-1">Delete this {r.type === "note" ? "note" : "resource"}?</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
              Keep
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                setConfirmDelete(null);
                await props.onDelete(r.id);
              }}
            >
              Delete
            </Button>
          </div>
        )}
        {open && (
          <div className="pl-6">
            {r.url && (
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 flex items-center gap-1.5 truncate text-xs font-medium text-accent hover:underline"
              >
                <ExternalLink className="size-3.5 shrink-0" />
                <span className="truncate">{r.url}</span>
              </a>
            )}
            {r.content.trim() && (
              <NoteBody
                resourceId={r.id}
                content={r.content}
                highlights={highlightsByResource.get(r.id) ?? NO_HIGHLIGHTS}
                onPopover={setPopover}
                onRemoveHighlights={props.onDeleteNoteHighlights}
              />
            )}
          </div>
        )}
      </article>
    );
  };

  /** Expand-all / collapse-all for the cards currently listed. */
  const bulkToggle = (items: Resource[]) => {
    if (items.length < 2) return null;
    const allOpen = items.every((r) => !closed.has(r.id));
    return (
      <div className="flex justify-end">
        <button
          className="flex items-center gap-1 text-[11px] font-medium text-ink-3 hover:text-accent"
          onClick={() =>
            setClosed((s) => {
              const n = new Set(s);
              for (const r of items) allOpen ? n.add(r.id) : n.delete(r.id);
              return n;
            })
          }
        >
          {allOpen ? <ChevronsDownUp className="size-3.5" /> : <ChevronsUpDown className="size-3.5" />}
          {allOpen ? "Close all" : "Expand all"}
          <KeyHint id="toggleNotes" />
        </button>
      </div>
    );
  };

  const empty = (text: string) => <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3">{text}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{props.paged ? "Page resources" : "Notes & resources"}</h2>
        <span className="rounded-full bg-accent-soft px-1.5 text-[11px] font-medium tabular-nums text-accent" title={props.paged ? "Items shown for this page" : "Items for this document"}>
          {visible.length}
        </span>
        {props.paged && (
          <span className="ml-auto text-sm font-semibold tabular-nums">
            Page {page}
            {props.pageCount > 0 && <span className="font-normal text-ink-3"> / {props.pageCount}</span>}
          </span>
        )}
      </div>

      <div className="ss-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" onScroll={() => popover && setPopover(null)}>
        {editing && !editing.resource && (
          <ResourceEditor
            key={editing.key}
            page={page}
            pageCount={props.pageCount}
            paged={props.paged}
            defaults={editing.defaults}
            onCancel={() => setEditing(null)}
            onDirtyChange={props.onDraftChange}
            onSave={async (input) => {
              await props.onCreate(input);
              setEditing(null);
            }}
          />
        )}

        {visible.length === 0 && !editing && empty(props.paged ? "No notes or resources for this page yet." : "No notes or resources for this document yet.")}
        {bulkToggle(visible)}

        {GROUPS.map((g) => {
          const items = visible.filter((r) => r.type === g.type);
          if (!items.length) return null;
          const Icon = TYPE_ICON[g.type];
          return (
            <section key={g.type} className="space-y-2">
              <h3 className="flex items-center gap-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                <Icon className="size-3.5" /> {g.label}
                <span className="font-normal normal-case tracking-normal">({items.length})</span>
              </h3>
              {items.map(card)}
            </section>
          );
        })}

        {pageHighlights.length > 0 && (
          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              <Highlighter className="size-3.5" /> Highlights on this page
            </h3>
            <ul className="space-y-1.5">
              {pageHighlights.map((a) => (
                <li key={a.id} className="flex gap-2 rounded-md bg-subtle px-2 py-1.5 text-xs text-ink-2">
                  <span className="mt-0.5 w-1 shrink-0 self-stretch rounded" style={{ background: a.color }} />
                  <span className="line-clamp-3 flex-1">{a.text}</span>
                  <button
                    className="shrink-0 self-start text-[11px] font-medium text-accent hover:underline"
                    onClick={() =>
                      setEditing({ key: Date.now(), defaults: { type: "note", scope: "page", pageStart: page, content: `> ${a.text}\n\n` } })
                    }
                  >
                    Note
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

      </div>

      <div className="border-t border-line p-3">
        <Button variant="primary" className="w-full" onClick={startAdd} disabled={!!editing && !editing.resource}>
          <Plus className="size-4" /> Add note or resource
          <KeyHint id="newNote" className="border-white/40 bg-white/10 text-white/80" />
        </Button>
        {props.paged && (
          <p className="mt-1.5 flex items-center justify-center gap-1 text-[11px] text-ink-3">
            <BookOpen className="size-3" /> Showing items for page {page} and the whole document
          </p>
        )}
      </div>

      {popover && (
        <NotePopovers
          popover={popover}
          highlights={props.noteHighlights}
          defaultColor={props.highlightColor}
          onClose={closePopover}
          onSwitch={setPopover}
          onCreate={props.onCreateNoteHighlight}
          onUpdate={props.onUpdateNoteHighlight}
          onDelete={(id) => props.onDeleteNoteHighlights([id])}
        />
      )}
    </div>
  );
}

const NO_HIGHLIGHTS: NoteHighlight[] = [];

/** First non-empty line of Markdown content, stripped of quote/heading markers, for untitled cards. */
function firstLine(content: string): string {
  const line = content.split("\n").map((l) => l.replace(/^\s*(?:[>#*-]+\s*)+/, "").trim()).find(Boolean) ?? "";
  return line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line;
}
