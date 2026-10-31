import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  ExternalLink,
  FileQuestion,
  Highlighter,
  ImagePlus,
  Link2,
  NotebookPen,
  Pencil,
  Plus,
  ScrollText,
  StickyNote,
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
import { withKey } from "../lib/shortcuts";
import { anchorToRange } from "../lib/noteAnchors";
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
  onSetNoteStyle: (resourceId: string, key: string, color: string | null) => void;
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
  /** Downloads all of this document's notes, one .md file each, in a .zip. */
  onDownloadNotes?: () => void;
  /** A picture dropped on the notes goes to the Pictures section; the button there shows how many are for this page. */
  onAddPicture?: (file: Blob) => void;
  pictureCount?: number;
  onOpenPictures?: () => void;
  /**
   * A note to show (its marker on the page was clicked): opened, scrolled to and outlined; with an
   * `anchor`, at that passage, which lights up for a moment.
   */
  focusRequest?: { id: string; nonce: number; anchor?: Anchor | null } | null;
  /** Notes with markers on the PDF, and scrolling the PDF to the next one of a note's markers. */
  markedNotes?: Set<string>;
  onShowMarker?: (r: Resource) => void;
  /** "Pin on page" for selected text of a note. */
  onPinPassage?: (resourceId: string, anchor: Anchor) => void;
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

type Tab = "page" | "whole";

export function ResourcePanel(props: Props) {
  const { page, resources } = props;
  const [editing, setEditing] = useState<{ resource?: Resource; defaults?: Partial<ResourceInput>; key: number } | null>(null);
  /** Notes for this page (and ranges with it) and notes for the whole PDF are two tabs. */
  const [tab, setTab] = useState<Tab>("page");
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
    setTab(editorRequest.defaults.scope === "document" ? "whole" : "page");
    onEditorRequestHandled();
  }, [editorRequest, onEditorRequestHandled]);

  // A note opened from its marker: shown even when the current page is a neighbouring one (the
  // marker's page may be the one lower down the screen), until the page changes.
  const [focused, setFocused] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const { focusRequest } = props;
  useEffect(() => {
    if (!focusRequest) return;
    const { id } = focusRequest;
    setFocused(id);
    setTab("page"); // markers are for pages
    setFlash(id);
    setClosed((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    setReveal({ id, anchor: focusRequest.anchor ?? null });
    const t = setTimeout(() => (setFlash(null), setPassage(null)), 1800);
    return () => clearTimeout(t);
  }, [focusRequest]);
  /** A note to scroll to (at its passage) once its card has rendered open. */
  const [reveal, setReveal] = useState<{ id: string; anchor: Anchor | null; top?: boolean } | null>(null);
  // After every render until the card (and its text, when it has a passage to show) is there.
  useLayoutEffect(() => {
    if (!reveal) return;
    const card = document.querySelector<HTMLElement>(`[data-resource-id="${CSS.escape(reveal.id)}"]`);
    const body = card?.querySelector(`[data-note="${CSS.escape(reveal.id)}"]`);
    if (!card || (reveal.anchor && !body && closed.has(reveal.id))) return;
    setReveal(null);
    const range = reveal.anchor && body ? anchorToRange(body, reveal.anchor) : null;
    if (!range) {
      // Newer browsers return a promise, which React would take for a clean-up function.
      card.scrollIntoView({ block: reveal.top ? "start" : "nearest", behavior: "smooth" });
      return;
    }
    const first = range.getClientRects()[0] ?? range.getBoundingClientRect();
    const scroller = card.closest<HTMLElement>(".ss-scroll");
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      scroller.scrollTo({ top: scroller.scrollTop + first.top - box.top - box.height / 3, behavior: "smooth" });
    }
    setPassage({ id: reveal.id, rects: passageRects(card, range) });
  });
  /** The passage a marker points at, lit up for a moment (rectangles relative to its card). */
  const [passage, setPassage] = useState<{ id: string; rects: { left: number; top: number; width: number; height: number }[] } | null>(null);
  useEffect(() => setFocused(null), [page]);

  // Filtered client-side from the document's full list so page changes update instantly.
  const visible = useMemo(() => resources.filter((r) => resourceCoversPage(r, page) || r.id === focused), [resources, page, focused]);
  const pageItems = useMemo(() => visible.filter((r) => r.scope !== "document"), [visible]);
  const wholeItems = useMemo(() => visible.filter((r) => r.scope === "document"), [visible]);
  // Files without pages have only whole-file notes, so no tabs.
  const activeTab: Tab = props.paged ? tab : "whole";
  const active = activeTab === "page" ? pageItems : wholeItems;
  /** The tab's notes in the order they are listed (by kind): the index follows it. */
  const ordered = useMemo(() => GROUPS.flatMap((g) => active.filter((r) => r.type === g.type)), [active]);

  // A note added from elsewhere (a picture, an undo) shows up in its own tab.
  const seenIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const prev = seenIds.current;
    seenIds.current = new Set(resources.map((r) => r.id));
    if (!prev?.size) return; // the first load of the file's notes
    const added = resources.filter((r) => !prev.has(r.id));
    if (added.length === 1) setTab(added[0].scope === "document" ? "whole" : "page");
  }, [resources]);

  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Index click: open that note, scroll it to the top of the list and outline it. */
  const jumpTo = (id: string) => {
    setClosed((s) => {
      if (!s.has(id)) return s;
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    setFlash(id);
    setReveal({ id, anchor: null, top: true });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1500);
  };
  const setAllOpen = (open: boolean) =>
    setClosed((s) => {
      const n = new Set(s);
      for (const r of active) open ? n.delete(r.id) : n.add(r.id);
      return n;
    });
  const pageHighlights = props.annotations.filter((a) => a.page === page && a.kind === "highlight" && a.text);

  // The C key: close every card on this page, or open them all if they are all closed already.
  useEffect(() => {
    if (!props.toggleAllRequest) return;
    setClosed((s) => {
      const allOpen = active.every((r) => !s.has(r.id));
      const n = new Set(s);
      for (const r of active) allOpen ? n.add(r.id) : n.delete(r.id);
      return n;
    });
  }, [props.toggleAllRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAdd = () =>
    setEditing({
      key: Date.now(),
      defaults: props.paged && activeTab === "page" ? { type: "note", scope: "page", pageStart: page, pageEnd: page } : { type: "note", scope: "document" },
    });

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
            setTab(input.scope === "document" ? "whole" : "page");
            setEditing(null);
          }}
        />
      );
    }
    const Icon = TYPE_ICON[r.type];
    const offPage = r.scope !== "document" && r.pageStart !== null && r.pageStart !== page;
    const open = !closed.has(r.id);
    const hasBody = !!r.url || !!r.content.trim();
    const title = noteName(r);
    return (
      <article
        key={r.id}
        data-resource-id={r.id}
        className={cx("group relative rounded-lg border bg-panel px-3 py-2.5 transition hover:border-ink-3/40", flash === r.id ? "border-amber-500 ring-2 ring-amber-400/60" : "border-line")}
      >
        {passage?.id === r.id &&
          passage.rects.map((b, i) => (
            <span key={i} className="ss-passage pointer-events-none absolute rounded-sm bg-amber-300/50" style={{ left: b.left, top: b.top, width: b.width, height: b.height }} />
          ))}
        <header className="flex items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            {/* The toggle flows inline right after the last word of the title, even when it wraps. */}
            <h4 className="break-words text-sm font-semibold leading-snug">
              <button className="text-left hover:text-accent" onClick={() => toggle(r.id)} aria-expanded={open}>
                <span
                  className="ss-title-hl"
                  style={r.styles.title ? (styleObject(r.styles.title) as React.CSSProperties) : undefined}
                  onContextMenu={(e) => {
                    // A click opens or closes the card, so the title's colour menu is on right-click.
                    e.preventDefault();
                    setPopover({ kind: "style", x: e.clientX, y: e.clientY, resourceId: r.id, key: "title" });
                  }}
                >
                  {title}
                </span>
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
            {props.markedNotes?.has(r.id) && props.onShowMarker && (
              <IconButton label="Show its marker on the page (again: the next one)" className="size-7 text-amber-600" onClick={() => props.onShowMarker!(r)}>
                <StickyNote className="size-3.5" />
              </IconButton>
            )}
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
                styles={r.styles}
                onPopover={setPopover}
                onRemoveHighlights={props.onDeleteNoteHighlights}
              />
            )}
          </div>
        )}
      </article>
    );
  };

  const empty = (text: string) => <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3">{text}</p>;

  const hasPicture = (e: React.DragEvent) => [...e.dataTransfer.items].some((i) => i.kind === "file" && i.type.startsWith("image/"));

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onDragOver={(e) => props.onAddPicture && hasPicture(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!props.onAddPicture || !hasPicture(e)) return;
        e.preventDefault();
        for (const f of e.dataTransfer.files) if (f.type.startsWith("image/")) props.onAddPicture(f);
      }}
    >
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
        {props.onDownloadNotes && props.resources.length > 0 && (
          <IconButton label={withKey("Download all this file's notes (.md files in a .zip)", "downloadNotes")} className={cx("-my-1 -mr-2 size-7", !props.paged && "ml-auto")} onClick={props.onDownloadNotes}>
            <Download className="size-4" />
          </IconButton>
        )}
      </div>

      {props.paged && (
        <div role="tablist" className="flex border-b border-line px-2">
          {(
            [
              ["page", "On this page", pageItems.length],
              ["whole", "Whole PDF", wholeItems.length],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cx(
                "-mb-px flex flex-1 items-center justify-center gap-1.5 border-b-2 px-2 py-2 text-xs font-semibold transition",
                tab === id ? "border-accent text-accent" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              {label}
              <span className={cx("rounded-full px-1.5 text-[11px] font-medium tabular-nums", tab === id ? "bg-accent-soft" : "bg-subtle")}>{n}</span>
            </button>
          ))}
        </div>
      )}

      {active.length > 0 && (
        <div className="space-y-1.5 border-b border-line bg-subtle/50 px-4 py-2">
          <div className="flex items-center gap-1">
            <button
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-2 hover:bg-hover hover:text-accent"
              onClick={() => setAllOpen(true)}
              title="Open every note in this tab"
            >
              <ChevronsUpDown className="size-3.5" /> Open all
            </button>
            <button
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-ink-2 hover:bg-hover hover:text-accent"
              onClick={() => setAllOpen(false)}
              title="Close every note in this tab"
            >
              <ChevronsDownUp className="size-3.5" /> Close all
            </button>
            <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-3" title="Opens all notes, or closes them if all are open">
              open / close <KeyHint id="toggleNotes" />
            </span>
          </div>
          {ordered.length > 1 && (
            <nav aria-label="Index of notes" className="flex max-h-[4.5rem] flex-wrap gap-1 overflow-y-auto">
              <span className="py-0.5 pr-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Index</span>
              {ordered.map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => jumpTo(r.id)}
                  title={noteName(r)}
                  className="flex max-w-[11rem] items-center gap-1 rounded-full border border-line bg-panel px-2 py-0.5 text-[11px] text-ink-2 transition hover:border-accent hover:text-accent"
                >
                  <span className="font-semibold tabular-nums text-ink-3">{i + 1}</span>
                  <span className="truncate">{noteName(r)}</span>
                </button>
              ))}
            </nav>
          )}
        </div>
      )}

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
              setTab(input.scope === "document" ? "whole" : "page");
              setEditing(null);
            }}
          />
        )}

        {active.length === 0 &&
          !editing &&
          (activeTab === "page" ? (
            <>
              {empty("No notes or resources for this page yet.")}
              {wholeItems.length > 0 && (
                <button className="w-full text-center text-xs font-medium text-accent hover:underline" onClick={() => setTab("whole")}>
                  {wholeItems.length} for the whole PDF →
                </button>
              )}
            </>
          ) : (
            empty(props.paged ? "No notes or resources for the whole PDF yet." : "No notes or resources for this document yet.")
          ))}

        {GROUPS.map((g) => {
          const items = active.filter((r) => r.type === g.type);
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
        <div className="flex gap-2">
          <Button variant="primary" className="min-w-0 flex-1" onClick={startAdd} disabled={!!editing && !editing.resource}>
            <Plus className="size-4" /> Add note or resource
            <KeyHint id="newNote" className="border-white/40 bg-white/10 text-white/80" />
          </Button>
          {props.onOpenPictures && (
            <Button className="shrink-0" onClick={props.onOpenPictures} title={withKey("Show the pictures saved for this page", "viewPictures")}>
              <ImagePlus className="size-4" /> Pictures
              {!!props.pictureCount && (
                <span className="rounded-full bg-accent-soft px-1.5 text-[11px] font-medium tabular-nums text-accent">{props.pictureCount}</span>
              )}
              <KeyHint id="viewPictures" />
            </Button>
          )}
        </div>
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
          onPin={props.onPinPassage}
          styleOf={(id, key) => props.resources.find((x) => x.id === id)?.styles[key]}
          onStyle={props.onSetNoteStyle}
        />
      )}
    </div>
  );
}

const NO_HIGHLIGHTS: NoteHighlight[] = [];

/** `--hl` for a picked title colour, as the note elements get it from rehypeNoteStyles. */
const styleObject = (color: string) => ({ "--hl": color === "none" ? "transparent" : color });

/** First non-empty line of Markdown content, stripped of quote/heading markers, for untitled cards. */
/** A range's line boxes, relative to `card` (which is `position: relative`). */
function passageRects(card: HTMLElement, range: Range) {
  const c = card.getBoundingClientRect();
  return [...range.getClientRects()]
    .filter((r) => r.width > 0.5 && r.height > 0.5)
    .map((r) => ({ left: r.left - c.left - 1, top: r.top - c.top - 1, width: r.width + 2, height: r.height + 2 }));
}

/** What a card is called: its title, else its first line, else its kind. */
const noteName = (r: Resource) => r.title || firstLine(r.content) || (r.type === "link" ? r.url : null) || RESOURCE_TYPE_LABEL[r.type];

function firstLine(content: string): string {
  const line = content.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1 Picture").split("\n").map((l) => l.replace(/^\s*(?:[>#*-]+\s*)+/, "").trim()).find(Boolean) ?? "";
  return line.length > 60 ? `${line.slice(0, 60).trimEnd()}…` : line;
}
