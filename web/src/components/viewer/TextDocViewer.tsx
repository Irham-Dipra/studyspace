import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Loader2 } from "lucide-react";
import { api } from "../../lib/api";
import { selectionToAnchor } from "../../lib/noteAnchors";
import { belowSelection, useTouchSelection } from "../../lib/touchSelection";
import type { DocumentRecord, TextHighlight } from "../../lib/types";
import frameHelper from "../../lib/artifactFrame.js?raw";
import { Markdown } from "../Markdown";
import { NotePopovers, type Anchor, type NotePopover } from "../NoteAnnotations";
import type { PdfViewerHandle } from "./PdfViewer";
import type { Tool } from "./geometry";

interface Props {
  ref?: Ref<PdfViewerHandle>;
  doc: DocumentRecord;
  /** Text size (Markdown) or page zoom (HTML); 1 = 100%. */
  zoom: number;
  /** Where to open: 0 = top, 1 = bottom. */
  initialTop: number | null;
  highlights: TextHighlight[];
  tool: Tool;
  color: string;
  onLoaded: () => void;
  /** How far down the reader is (0..1), as they scroll. */
  onScrollTop: (top: number) => void;
  onCreateHighlight: (anchor: Anchor, color: string) => Promise<TextHighlight | undefined>;
  onUpdateHighlight: (id: string, patch: { color?: string; comment?: string }) => void;
  onDeleteHighlights: (ids: string[]) => void;
  onQuoteToNote: (text: string) => void;
}

/**
 * The sandbox of an HTML document: its scripts run (artifacts need them), but in a frame of its own,
 * with no access to StudySpace (no allow-same-origin), so it can't read or change your library.
 */
const SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads";

/** The page with the helper script (lib/artifactFrame.js) first in it, after any doctype. */
function withHelper(html: string): string {
  const tag = `<script>${frameHelper}</` + "script>";
  const head = /<head(\s[^>]*)?>/i.exec(html);
  const at = head ?? /<html(\s[^>]*)?>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  if (!at) return tag + html;
  const end = at.index + at[0].length;
  return html.slice(0, end) + tag + html.slice(end);
}

type FrameMessage =
  | { type: "ready" }
  | { type: "selection"; anchor: Anchor; rect: { left: number; top: number; right: number; bottom: number }; point: { x: number; y: number } | null }
  | { type: "highlight"; id: string; point: { x: number; y: number } }
  | { type: "pointerdown" }
  | { type: "scroll"; top: number }
  | { type: "painted"; missing: string[]; unsupported?: boolean }
  | { type: "key"; key: string; code: string; shiftKey: boolean };

const fraction = (el: HTMLElement) => {
  const room = el.scrollHeight - el.clientHeight;
  return room > 0 ? Math.min(1, Math.max(0, el.scrollTop / room)) : 0;
};

/**
 * Shows an HTML page (e.g. a Claude artifact) or a Markdown file: text that flows, with no pages.
 * Select text to highlight it, comment on it or quote it into a note. Read-only: the file itself is
 * never changed.
 */
export function TextDocViewer(props: Props) {
  const { doc, zoom } = props;
  const isHtml = doc.kind === "html";
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popover, setPopover] = useState<NotePopover | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [unsupported, setUnsupported] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const topRef = useRef(props.initialTop ?? 0);
  const restored = useRef(false);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    let alive = true;
    setText(null);
    setError(null);
    restored.current = false;
    api.fileText(doc).then(
      (t) => alive && setText(t),
      (e: Error) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [doc.id, doc.fingerprint]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (text !== null) latest.current.onLoaded();
  }, [text]);

  // ---- HTML: talk to the page in its frame ----------------------------------------------
  const srcDoc = useMemo(() => (isHtml && text !== null ? withHelper(text) : undefined), [isHtml, text]);
  const toFrame = useCallback((msg: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage({ ...msg, ss: "parent" }, "*");
  }, []);
  const sendHighlights = useCallback(
    () => toFrame({ type: "highlights", items: latest.current.highlights.map(({ id, color, quote, prefix, suffix, comment }) => ({ id, color, quote, prefix, suffix, comment })) }),
    [toFrame],
  );

  useEffect(() => {
    if (!isHtml) return;
    let missingTimer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (e: MessageEvent) => {
      // Only the frame's own messages; anything the page itself sends is treated the same way, so
      // they carry nothing that could change the library on their own.
      if (!frameRef.current || e.source !== frameRef.current.contentWindow || e.data?.ss !== "frame") return;
      const m = e.data as FrameMessage;
      const box = frameRef.current.getBoundingClientRect();
      const p = latest.current;
      if (m.type === "ready") {
        // Sent again when the page has fully loaded; the page stops following once the reader scrolls.
        sendHighlights();
        toFrame({ type: "zoom", value: p.zoom });
        toFrame({ type: "scrollTo", top: topRef.current });
      } else if (m.type === "selection") {
        if (m.point && p.tool === "highlight") {
          void p.onCreateHighlight(m.anchor, p.color).then(() => toFrame({ type: "clearSelection" }));
          return;
        }
        const at = m.point ? { x: box.left + m.point.x, y: box.top + m.point.y } : { x: box.left + m.rect.left, y: box.top + m.rect.bottom + 16 };
        setPopover({ kind: "selection", ...at, resourceId: p.doc.id, anchor: m.anchor });
      } else if (m.type === "highlight") {
        setPopover({ kind: "highlight", x: box.left + m.point.x, y: box.top + m.point.y, highlightId: m.id });
      } else if (m.type === "pointerdown") {
        setPopover(null);
      } else if (m.type === "scroll") {
        setPopover(null);
        topRef.current = m.top;
        p.onScrollTop(m.top);
      } else if (m.type === "painted") {
        // Pages that build themselves change for a moment after loading: wait before saying a
        // highlight can't be found.
        clearTimeout(missingTimer);
        missingTimer = setTimeout(() => setMissing(m.missing), 800);
        setUnsupported(!!m.unsupported);
      } else if (m.type === "key") {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: m.key, code: m.code, shiftKey: m.shiftKey, bubbles: true, cancelable: true }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      clearTimeout(missingTimer);
      window.removeEventListener("message", onMessage);
    };
  }, [isHtml, sendHighlights, toFrame]);

  useEffect(() => {
    if (isHtml) sendHighlights();
  }, [isHtml, props.highlights, sendHighlights]);

  useEffect(() => {
    if (isHtml) toFrame({ type: "zoom", value: zoom });
  }, [isHtml, zoom, toFrame]);

  // ---- Markdown: rendered here -------------------------------------------------------------
  const assetUrl = useCallback((src: string) => api.assetUrl(doc.id, src), [doc.id]);

  // Back to where the reader was, once the text is laid out.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (isHtml || text === null || !el || restored.current) return;
    el.scrollTop = topRef.current * Math.max(0, el.scrollHeight - el.clientHeight);
    restored.current = true;
  }, [isHtml, text]);

  // Highlights whose text is no longer in the file.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (isHtml || !el) return;
    const shown = new Set([...el.querySelectorAll<HTMLElement>("[data-hl]")].map((m) => m.dataset.hl));
    const gone = props.highlights.filter((h) => !shown.has(h.id)).map((h) => h.id);
    setMissing((prev) => (prev.length === gone.length && prev.every((id, i) => id === gone[i]) ? prev : gone));
  }, [isHtml, text, props.highlights]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setPopover(null);
    topRef.current = fraction(el);
    props.onScrollTop(topRef.current);
  };

  const onMouseUp = (e: React.MouseEvent) => {
    const { clientX, clientY } = e;
    const target = e.target as HTMLElement;
    setTimeout(() => {
      const el = contentRef.current;
      const sel = window.getSelection();
      if (el && sel && !sel.isCollapsed && sel.rangeCount) {
        const anchor = selectionToAnchor(el, sel.getRangeAt(0));
        if (anchor && props.tool === "highlight") {
          void props.onCreateHighlight(anchor, props.color).then(() => window.getSelection()?.removeAllRanges());
          return;
        }
        if (anchor) return setPopover({ kind: "selection", x: clientX, y: clientY, resourceId: doc.id, anchor });
      }
      const mark = target.closest<HTMLElement>("[data-hl]");
      if (mark?.dataset.hl) setPopover({ kind: "highlight", x: clientX, y: clientY, highlightId: mark.dataset.hl });
    }, 0);
  };

  // Phones: a long-press selection always gets the bar (its handles may still be dragged).
  useTouchSelection(
    contentRef,
    (range) => {
      const anchor = contentRef.current && selectionToAnchor(contentRef.current, range);
      if (anchor) setPopover({ kind: "selection", ...belowSelection(range), resourceId: doc.id, anchor });
    },
    !isHtml,
  );

  // ---- The handle the app uses (same as the PDF viewer's) ---------------------------------
  useImperativeHandle(
    props.ref,
    () => ({
      goToPage: (_page: number, top?: number | null) => {
        const t = Math.min(1, Math.max(0, top ?? 0));
        topRef.current = t;
        if (isHtml) toFrame({ type: "scrollTo", top: t, force: true });
        else if (scrollRef.current) scrollRef.current.scrollTop = t * (scrollRef.current.scrollHeight - scrollRef.current.clientHeight);
      },
      getPosition: () => ({ page: 1, top: topRef.current }),
      fitWidthZoom: () => 1,
      fitPageZoom: () => 1,
      getPdf: () => null,
    }),
    [isHtml, toFrame],
  );

  const closePopover = useCallback(() => setPopover(null), []);

  const onCreate = async (_resourceId: string, anchor: Anchor, color: string) => {
    const h = await props.onCreateHighlight(anchor, color);
    if (isHtml) toFrame({ type: "clearSelection" });
    return h;
  };

  let body: React.ReactNode;
  if (error) {
    body = (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-danger">
        <div>
          <p className="font-medium">Could not open {isHtml ? "this page" : "this file"}</p>
          <p className="mt-1 text-ink-3">{error}</p>
        </div>
      </div>
    );
  } else if (text === null) {
    body = (
      <div className="grid h-full place-items-center text-ink-3">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  } else if (isHtml) {
    body = <iframe ref={frameRef} title={doc.title} sandbox={SANDBOX} srcDoc={srcDoc} className="block h-full w-full border-0 bg-white" />;
  } else {
    body = (
      <div ref={scrollRef} className="ss-scroll h-full overflow-auto bg-viewer px-2 py-4 sm:px-6" onScroll={onScroll}>
        <article
          ref={contentRef}
          className="ss-doc mx-auto max-w-3xl rounded-lg border border-line bg-panel px-5 py-6 shadow-sm sm:px-10 sm:py-8"
          style={{ fontSize: `${16 * zoom}px` }}
          onMouseUp={onMouseUp}
        >
          <Markdown highlights={props.highlights} structure={false} assetUrl={assetUrl}>
            {text}
          </Markdown>
        </article>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0">
      {body}
      {(missing.length > 0 || unsupported) && (
        <p className="absolute inset-x-3 bottom-3 mx-auto flex max-w-xl items-center gap-2 rounded-md border border-warn/30 bg-panel px-3 py-1.5 text-xs text-warn shadow-sm">
          {unsupported ? (
            <span className="flex-1">This browser can't show highlights on HTML pages. A recent Firefox, Chrome or Safari can.</span>
          ) : (
            <>
              <span className="flex-1">
                {missing.length} highlight{missing.length === 1 ? "" : "s"} no longer match{missing.length === 1 ? "es" : ""} the text of this file.
              </span>
              <button className="font-medium underline" onClick={() => props.onDeleteHighlights(missing)}>
                Remove
              </button>
            </>
          )}
        </p>
      )}
      {popover && (
        <NotePopovers
          popover={popover}
          highlights={props.highlights}
          defaultColor={props.color}
          onClose={closePopover}
          onSwitch={setPopover}
          onCreate={onCreate}
          onUpdate={props.onUpdateHighlight}
          onDelete={(id) => props.onDeleteHighlights([id])}
          onQuote={props.onQuoteToNote}
        />
      )}
    </div>
  );
}
