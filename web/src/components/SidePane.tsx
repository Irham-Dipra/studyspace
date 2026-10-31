import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ChevronLeft, ChevronRight, FileText, MoveHorizontal, Presentation, X, ZoomIn, ZoomOut } from "lucide-react";
import { api } from "../lib/api";
import { isPaged, type Annotation, type DocumentRecord, type ReadingProgress } from "../lib/types";
import { keyOf, withKey } from "../lib/shortcuts";
import { MAX_ZOOM, MIN_ZOOM, PdfViewer, type PdfViewerHandle } from "./viewer/PdfViewer";
import { IconButton, KeyHint, Modal, cx, inputCls } from "./ui";

/** What the second pane shows; kept in localStorage so a reload brings it back. */
export interface SideState {
  id: string;
  page: number;
  /** null until it's first shown: then it's fitted to the pane's width. */
  zoom: number | null;
}

const SIDE_KEY = "ss-side";
export function loadSide(): SideState | null {
  try {
    const s = JSON.parse(localStorage.getItem(SIDE_KEY) ?? "null") as SideState | null;
    return s && typeof s.id === "string" ? { id: s.id, page: Number(s.page) || 1, zoom: typeof s.zoom === "number" ? s.zoom : null } : null;
  } catch {
    return null;
  }
}
export function saveSide(s: SideState | null) {
  try {
    if (s) localStorage.setItem(SIDE_KEY, JSON.stringify(s));
    else localStorage.removeItem(SIDE_KEY);
  } catch {
    /* storage unavailable */
  }
}

const ZOOM_STEP = 1.2;
const noop = () => undefined;

interface Props {
  doc: DocumentRecord;
  state: SideState;
  /** The open PDF's highlights when it's the same file; otherwise loaded here. */
  annotations: Annotation[] | null;
  onChange: (s: SideState) => void;
  onPick: () => void;
  onSwap: () => void;
  onClose: () => void;
  /** Set by App so the side keys (Shift+←/→) can turn its pages. */
  handleRef: React.RefObject<PdfViewerHandle | null>;
}

/** The second PDF of side by side: read, scroll, zoom and copy text. Its notes and tools come with a swap. */
export function SidePane({ doc, state, annotations, onChange, onPick, onSwap, onClose, handleRef }: Props) {
  const [own, setOwn] = useState<Annotation[]>([]);
  const [pageCount, setPageCount] = useState(doc.pageCount ?? 0);
  const stateRef = useRef(state);
  stateRef.current = state;
  // The page and zoom shown when the file opens (later changes come from the viewer itself).
  const [start] = useState(state.page);

  useEffect(() => {
    if (annotations) return;
    let live = true;
    api.annotations(doc.id).then((a) => live && setOwn(a), () => undefined);
    return () => {
      live = false;
    };
  }, [doc.id, annotations]);

  // Reading progress, so "Continue reading" knows this file too (after a pause, not on every page).
  useEffect(() => {
    const t = setTimeout(() => void api.saveProgress(doc.id, state.page, state.zoom ?? 1).catch(() => undefined), 1500);
    return () => clearTimeout(t);
  }, [doc.id, state.page, state.zoom]);

  const zoom = state.zoom ?? 1;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const setZoom = useCallback(
    (z: number) => onChangeRef.current({ ...stateRef.current, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100)) }),
    [],
  );
  const fitWidth = useCallback(() => {
    const z = handleRef.current?.fitWidthZoom();
    if (z) setZoom(z);
  }, [handleRef, setZoom]);
  // Stable: the viewer reloads the file whenever onLoaded changes.
  const onLoaded = useCallback(
    (n: number) => {
      setPageCount(n);
      // First time here: fit the page to the pane (after the viewer has measured it).
      if (stateRef.current.zoom === null) requestAnimationFrame(() => (handleRef.current?.fitWidthZoom() ? fitWidth() : setZoom(1)));
    },
    [handleRef, fitWidth, setZoom],
  );
  const onPageChange = useCallback((page: number) => page !== stateRef.current.page && onChangeRef.current({ ...stateRef.current, page }), []);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-panel" aria-label={`Beside: ${doc.title}`}>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2 text-[13px]">
        {doc.kind === "slides" ? <Presentation className="size-4 shrink-0 text-warn opacity-80" /> : <FileText className="size-4 shrink-0 text-ink-3" />}
        <button className="min-w-0 truncate rounded px-1 text-left font-medium text-ink hover:bg-hover" title={`${doc.relPath}\nClick to open another PDF here (${keyOf("sideOpen")})`} onClick={onPick}>
          {doc.title}
        </button>
        <span className="ml-auto flex shrink-0 items-center">
          <IconButton label={withKey("Previous page", "sidePrev")} className="size-7" onClick={() => handleRef.current?.goToPage(state.page - 1)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <span className="px-1 text-xs tabular-nums text-ink-2">
            {state.page}
            {pageCount > 0 && <span className="text-ink-3"> / {pageCount}</span>}
          </span>
          <IconButton label={withKey("Next page", "sideNext")} className="size-7" onClick={() => handleRef.current?.goToPage(state.page + 1)}>
            <ChevronRight className="size-4" />
          </IconButton>
          <span className="mx-1 h-5 w-px bg-line" />
          <IconButton label="Zoom out" className="size-7" onClick={() => setZoom(zoom / ZOOM_STEP)}>
            <ZoomOut className="size-4" />
          </IconButton>
          <span className="w-10 text-center text-xs tabular-nums text-ink-2">{Math.round(zoom * 100)}%</span>
          <IconButton label="Zoom in" className="size-7" onClick={() => setZoom(zoom * ZOOM_STEP)}>
            <ZoomIn className="size-4" />
          </IconButton>
          <IconButton label="Fit width" className="size-7" onClick={fitWidth}>
            <MoveHorizontal className="size-4" />
          </IconButton>
          <span className="mx-1 h-5 w-px bg-line" />
          <IconButton label={withKey("Swap the two PDFs", "sideSwap")} className="size-7" onClick={onSwap}>
            <ArrowLeftRight className="size-4" />
          </IconButton>
          <IconButton label={withKey("Close the PDF beside", "sideClose")} className="size-7" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <PdfViewer
          key={`${doc.id}:${doc.fingerprint}`}
          ref={handleRef}
          doc={doc}
          initialPage={start}
          zoom={zoom}
          onZoomChange={setZoom}
          onPageChange={onPageChange}
          onLoaded={onLoaded}
          annotations={annotations ?? own}
          tool="select"
          color=""
          penWidth={1}
          onCreateAnnotation={noop}
          onDeleteAnnotation={noop}
          onUpdateAnnotation={noop}
          onQuoteToNote={noop}
          readOnly
        />
      </div>
    </section>
  );
}

/** Choose the PDF to show beside the open one: type to filter, ↑ / ↓, Enter. */
export function OpenBesideDialog({
  documents,
  recent,
  currentId,
  onPick,
  onClose,
}: {
  documents: DocumentRecord[];
  recent: (ReadingProgress & { title: string })[];
  currentId: string | null;
  onPick: (d: DocumentRecord) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cur, setCur] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Recently read files first, then the rest by path.
    const order = new Map(recent.map((r, i) => [r.documentId, i]));
    return documents
      .filter((d) => isPaged(d.kind) && !d.missing && (!q || d.relPath.toLowerCase().includes(q)))
      .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || a.relPath.localeCompare(b.relPath, undefined, { numeric: true }))
      .slice(0, 100);
  }, [documents, recent, query]);
  const i = Math.min(cur, Math.max(0, candidates.length - 1));

  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: "nearest" });
  }, [i]);

  return (
    <Modal title="Open a PDF beside" onClose={onClose}>
      <input
        className={inputCls}
        placeholder="Type part of the name…"
        value={query}
        autoFocus
        data-arrow-nav="off"
        onChange={(e) => (setQuery(e.target.value), setCur(0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setCur(Math.min(candidates.length - 1, i + 1));
          else if (e.key === "ArrowUp") setCur(Math.max(0, i - 1));
          else if (e.key === "Enter" && candidates[i]) onPick(candidates[i]);
          else return;
          e.preventDefault();
        }}
      />
      <ul ref={listRef} className="ss-scroll mt-2 max-h-[50vh] overflow-y-auto rounded-md border border-line">
        {candidates.map((d, n) => (
          <li key={d.id} data-i={n}>
            <button
              className={cx("flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[13px]", n === i ? "bg-accent-soft text-accent" : "hover:bg-hover")}
              onClick={() => onPick(d)}
              onMouseMove={() => n !== i && setCur(n)}
              title={d.relPath}
            >
              <span className="min-w-0 flex-1 truncate">{d.relPath}</span>
              {d.id === currentId && <span className="shrink-0 text-xs text-ink-3">this PDF</span>}
              {d.pageCount ? <span className="shrink-0 text-xs text-ink-3">{d.pageCount} p.</span> : null}
            </button>
          </li>
        ))}
        {candidates.length === 0 && <li className="px-2.5 py-2 text-xs text-ink-3">No matching PDFs or slides</li>}
      </ul>
      <p className="mt-2 text-[11px] text-ink-3">
        ↑ / ↓ then Enter. The open PDF keeps its tools and notes; <KeyHint id="sideSwap" /> swaps the two.
      </p>
    </Modal>
  );
}
