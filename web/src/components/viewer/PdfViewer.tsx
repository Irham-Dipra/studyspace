import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { Highlighter, Loader2, MessageSquarePlus, Copy, Trash2, StickyNote } from "lucide-react";
import { CSS_UNITS, openPdf, type PDFDocumentProxy } from "../../lib/pdf";
import { resolveDest, type PdfPosition } from "../../lib/outline";
import { keyOf } from "../../lib/shortcuts";
import { Kbd } from "../ui";
import type { Annotation, DocumentRecord, NormRect } from "../../lib/types";
import type { AnnotationInput } from "../../lib/api";
import { PdfPage } from "./PdfPage";
import { HIGHLIGHT_COLORS, hitTest, mergeLineRects, type Tool } from "./geometry";

export interface PdfViewerHandle {
  /** Scrolls to `page`; with `top` (0 = top of the page, 1 = bottom) to that spot on it. */
  goToPage: (page: number, top?: number | null) => void;
  /** The page and the spot on it at the top of the view (where a bookmark added now points). */
  getPosition: () => PdfPosition;
  fitWidthZoom: () => number | null;
  fitPageZoom: () => number | null;
  getPdf: () => PDFDocumentProxy | null;
}

interface Props {
  ref?: Ref<PdfViewerHandle>;
  doc: DocumentRecord;
  initialPage: number;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onPageChange: (page: number) => void;
  onLoaded: (pageCount: number, pdf: PDFDocumentProxy) => void;
  annotations: Annotation[];
  tool: Tool;
  color: string;
  penWidth: number;
  onCreateAnnotation: (a: AnnotationInput) => void;
  onDeleteAnnotation: (id: string) => void;
  /** A box drawn with the "OCR a region" tool. */
  onRegion?: (page: number, rect: NormRect) => void;
  onUpdateAnnotation: (id: string, patch: { color?: string }) => void;
  onQuoteToNote: (page: number, text: string) => void;
}

const GAP = 14;
const PAD = 16;
const OVERSCAN = 2;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

type SelMenu = { x: number; y: number; items: { page: number; rects: AnnotationInput["rects"]; text: string }[] };
type AnnMenu = { x: number; y: number; annotation: Annotation };

export function PdfViewer(props: Props) {
  const { doc, zoom, onPageChange, onLoaded } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [range, setRange] = useState<[number, number]>([1, 1]);
  const [viewportWidth, setViewportWidth] = useState(800);
  const [selMenu, setSelMenu] = useState<SelMenu | null>(null);
  const [annMenu, setAnnMenu] = useState<AnnMenu | null>(null);

  const scale = zoom * CSS_UNITS;
  const currentRef = useRef(props.initialPage);
  /** Page to show when the file (re)loads; the parent updates it when reopening after an edit. */
  const startPageRef = useRef(props.initialPage);
  startPageRef.current = props.initialPage;
  /** Where the user is looking: page + fraction into that page. Restored whenever layout changes. */
  const anchorRef = useRef<{ page: number; frac: number } | null>({ page: props.initialPage, frac: 0 });

  // ---- Load document -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setPdf(null);
    setLoadError(null);
    setSizes([]);
    setProgress(0);
    const task = openPdf(`/api/documents/${doc.id}/file?v=${encodeURIComponent(doc.fingerprint)}`);
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (total) setProgress(Math.min(1, loaded / total));
    };
    task.promise.then(
      async (p) => {
        if (cancelled) return;
        const first = await p.getPage(1);
        const vp = first.getViewport({ scale: 1 });
        if (cancelled) return;
        setSizes(Array.from({ length: p.numPages }, () => ({ w: vp.width, h: vp.height })));
        const start = Math.min(Math.max(1, startPageRef.current), p.numPages);
        currentRef.current = start;
        anchorRef.current = { page: start, frac: 0 };
        setPdf(p);
        setProgress(null);
        onLoaded(p.numPages, p);
      },
      (err: Error) => {
        if (!cancelled) setLoadError(err.message || "Failed to load PDF");
      },
    );
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [doc.id, doc.fingerprint, onLoaded]);

  // Fetch true page sizes in the background (mixed-size PDFs), in batches to limit re-renders.
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    (async () => {
      let batch: [number, number, number][] = [];
      const flush = () => {
        const b = batch;
        batch = [];
        if (b.length)
          setSizes((s) => {
            let changed = false;
            const next = s.slice();
            for (const [i, w, h] of b) {
              if (next[i] && (Math.abs(next[i].w - w) > 0.5 || Math.abs(next[i].h - h) > 0.5)) {
                next[i] = { w, h };
                changed = true;
              }
            }
            return changed ? next : s;
          });
      };
      for (let i = 2; i <= pdf.numPages && !cancelled; i++) {
        try {
          const vp = (await pdf.getPage(i)).getViewport({ scale: 1 });
          batch.push([i - 1, vp.width, vp.height]);
        } catch {
          /* ignore unreadable page */
        }
        if (batch.length >= 40) flush();
      }
      if (!cancelled) flush();
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  const onSize = useCallback((page: number, w: number, h: number) => {
    setSizes((s) => {
      const cur = s[page - 1];
      if (!cur || (Math.abs(cur.w - w) < 0.5 && Math.abs(cur.h - h) < 0.5)) return s;
      const next = s.slice();
      next[page - 1] = { w, h };
      return next;
    });
  }, []);

  // ---- Layout --------------------------------------------------------------
  const layout = useMemo(() => {
    const tops: number[] = [];
    let y = PAD;
    let maxW = 0;
    for (const s of sizes) {
      tops.push(y);
      y += Math.floor(s.h * scale) + GAP;
      maxW = Math.max(maxW, Math.floor(s.w * scale));
    }
    return { tops, total: y - GAP + PAD, maxW };
  }, [sizes, scale]);

  const pageAt = useCallback(
    (y: number) => {
      const { tops } = layout;
      let lo = 0,
        hi = tops.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tops[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo + 1;
    },
    [layout],
  );

  /** Recomputes visible range and the current page (the page occupying most of the viewport). */
  const updateFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !layout.tops.length) return;
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    const first = pageAt(top);
    const last = pageAt(bottom);
    setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));

    let best = first;
    let bestVisible = -1;
    for (let p = first; p <= last; p++) {
      const pTop = layout.tops[p - 1];
      const pBottom = pTop + Math.floor(sizes[p - 1].h * scale);
      const visible = Math.min(bottom, pBottom) - Math.max(top, pTop);
      if (visible > bestVisible + 1) {
        best = p;
        bestVisible = visible;
      }
    }
    // At the very end of the document, the last page is current even if it is short.
    if (top + el.clientHeight >= el.scrollHeight - 2) best = last;
    const h = Math.floor(sizes[best - 1].h * scale) || 1;
    anchorRef.current = { page: best, frac: (top - layout.tops[best - 1]) / h };
    if (best !== currentRef.current) {
      currentRef.current = best;
      onPageChange(best);
    }
  }, [layout, pageAt, sizes, scale, onPageChange]);

  // Restore the anchor after any layout change (zoom, late page sizes) so the view doesn't jump.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchorRef.current;
    if (!el || !a || !layout.tops.length) return;
    const p = Math.min(a.page, layout.tops.length);
    const target = layout.tops[p - 1] + a.frac * Math.floor(sizes[p - 1].h * scale);
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
    updateFromScroll();
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateFromScroll);
      setSelMenu(null);
      setAnnMenu(null);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [updateFromScroll]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setViewportWidth(el.clientWidth);
      updateFromScroll();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateFromScroll]);

  // Ctrl/⌘ + wheel zoom.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0025);
      props.onZoomChange(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoomRef.current * factor * 100) / 100)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [props.onZoomChange]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Keys for the open floating bar; returns true when it used the key. */
  const menuKeysRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  menuKeysRef.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    const digit = /^Digit[1-9]$/.test(e.code) ? Number(e.code.slice(5)) - 1 : -1;
    if (selMenu) {
      if (digit >= 0 && HIGHLIGHT_COLORS[digit]) {
        createHighlights(selMenu.items, HIGHLIGHT_COLORS[digit]);
        return true;
      }
      if (e.key.toLowerCase() === "n") {
        props.onQuoteToNote(selMenu.items[0].page, selMenu.items.map((i) => i.text).join(" "));
        window.getSelection()?.removeAllRanges();
        setSelMenu(null);
        return true;
      }
    } else if (annMenu) {
      const palette = annMenu.annotation.kind === "ink" ? INK_MENU_COLORS : HIGHLIGHT_COLORS;
      if (digit >= 0 && palette[digit]) {
        props.onUpdateAnnotation(annMenu.annotation.id, { color: palette[digit] });
        setAnnMenu(null);
        return true;
      }
      if (e.key.toLowerCase() === "n" && annMenu.annotation.text) {
        props.onQuoteToNote(annMenu.annotation.page, annMenu.annotation.text);
        setAnnMenu(null);
        return true;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        props.onDeleteAnnotation(annMenu.annotation.id);
        setAnnMenu(null);
        return true;
      }
    }
    return false;
  };

  // Esc closes the floating highlight bar / annotation menu (and drops the text selection).
  // A click anywhere outside them closes them too.
  const menuOpen = !!selMenu || !!annMenu;
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => {
      setSelMenu(null);
      setAnnMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        window.getSelection()?.removeAllRanges();
        close();
        return;
      }
      // The bar's own keys: 1–5 colours, N note, Delete (see lib/shortcuts.ts).
      if (menuKeysRef.current(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-floating-menu]")) close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [menuOpen]);

  // ---- Imperative API -------------------------------------------------------
  const goToPage = useCallback(
    (page: number, top?: number | null) => {
      const el = scrollRef.current;
      const frac = top ? Math.min(1, Math.max(0, top)) : 0;
      if (!el || !layout.tops.length) {
        currentRef.current = page;
        anchorRef.current = { page, frac };
        return;
      }
      const p = Math.min(Math.max(1, Math.round(page)), layout.tops.length);
      el.scrollTop = layout.tops[p - 1] + frac * Math.floor(sizes[p - 1].h * scale) - 8;
      updateFromScroll();
    },
    [layout, sizes, scale, updateFromScroll],
  );

  useImperativeHandle(
    props.ref,
    () => ({
      goToPage,
      getPdf: () => pdf,
      getPosition: () => {
        const a = anchorRef.current ?? { page: currentRef.current, frac: 0 };
        // A few pixels of slack so "top of the page" stays exactly that.
        const top = a.frac < 0.02 ? null : Math.round(Math.min(0.98, a.frac + 8 / Math.max(1, (sizes[a.page - 1]?.h ?? 800) * scale)) * 10000) / 10000;
        return { page: a.page, top };
      },
      fitWidthZoom: () => {
        const s = sizes[currentRef.current - 1] ?? sizes[0];
        if (!s) return null;
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (viewportWidth - PAD * 2 - 8) / (s.w * CSS_UNITS)));
      },
      fitPageZoom: () => {
        const s = sizes[currentRef.current - 1] ?? sizes[0];
        const el = scrollRef.current;
        if (!s || !el) return null;
        const z = Math.min((viewportWidth - PAD * 2 - 8) / (s.w * CSS_UNITS), (el.clientHeight - PAD * 2) / (s.h * CSS_UNITS));
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
      },
    }),
    [goToPage, pdf, sizes, scale, viewportWidth],
  );

  const navigateDest = useCallback(
    async (dest: unknown) => {
      if (!pdf) return;
      const pos = await resolveDest(pdf, dest); // null for a broken link
      if (pos) goToPage(pos.page, pos.top);
    },
    [pdf, goToPage],
  );

  // ---- Annotations by page --------------------------------------------------
  const annotationsByPage = useMemo(() => {
    const m = new Map<number, Annotation[]>();
    for (const a of props.annotations) {
      const list = m.get(a.page);
      if (list) list.push(a);
      else m.set(a.page, [a]);
    }
    return m;
  }, [props.annotations]);

  // ---- Text selection → highlight / quote ----------------------------------
  const selectionToItems = useCallback((): SelMenu["items"] => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return [];
    const range = sel.getRangeAt(0);
    const root = scrollRef.current;
    if (!root || !root.contains(range.commonAncestorContainer)) return [];
    const clientRects = Array.from(range.getClientRects());
    const items: SelMenu["items"] = [];
    root.querySelectorAll<HTMLElement>(".ss-page").forEach((pageEl) => {
      const box = pageEl.getBoundingClientRect();
      const inside = clientRects
        .filter((r) => r.top + r.height / 2 >= box.top && r.top + r.height / 2 <= box.bottom && r.right > box.left && r.left < box.right)
        .map((r) => ({ left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height }));
      if (!inside.length) return;
      const rects = mergeLineRects(inside).map((l) => ({
        x: Math.max(0, l.x1 / box.width),
        y: Math.max(0, l.y1 / box.height),
        w: Math.min(1, (l.x2 - l.x1) / box.width),
        h: Math.min(1, (l.y2 - l.y1) / box.height),
      }));
      const page = Number(pageEl.dataset.page);
      // Text for this page only, joining the text layer's spans with spaces (they carry no separators).
      const textLayer = pageEl.querySelector(".textLayer");
      const text = textLayer ? textInRange(range, textLayer) : "";
      items.push({ page, rects, text: text.replace(/\s+/g, " ").trim() });
    });
    return items;
  }, []);

  const createHighlights = useCallback(
    (items: SelMenu["items"], color: string) => {
      for (const it of items) {
        if (it.rects?.length) props.onCreateAnnotation({ page: it.page, kind: "highlight", color, opacity: 0.4, rects: it.rects, text: it.text });
      }
      window.getSelection()?.removeAllRanges();
      setSelMenu(null);
    },
    [props.onCreateAnnotation], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onMouseUp = (e: React.MouseEvent) => {
    if (props.tool !== "select" && props.tool !== "highlight") return;
    // Let the browser finalise the selection first.
    setTimeout(() => {
      const items = selectionToItems();
      if (items.length) {
        if (props.tool === "highlight") createHighlights(items, props.color);
        else setSelMenu({ x: e.clientX, y: e.clientY, items });
        return;
      }
      // No selection: was an annotation clicked?
      const pageEl = (e.target as HTMLElement).closest<HTMLElement>(".ss-page");
      if (!pageEl) return setAnnMenu(null);
      const page = Number(pageEl.dataset.page);
      const box = pageEl.getBoundingClientRect();
      const hit = hitTest(annotationsByPage.get(page) ?? [], [(e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height], box.height / box.width);
      setAnnMenu(hit ? { x: e.clientX, y: e.clientY, annotation: hit } : null);
    }, 0);
  };

  // ---- Render ---------------------------------------------------------------
  const first = Math.max(1, range[0] - OVERSCAN);
  const last = Math.min(sizes.length, range[1] + OVERSCAN);
  const pages = [];
  if (pdf) {
    for (let p = first; p <= last; p++) {
      const s = sizes[p - 1];
      pages.push(
        <div key={p} className="absolute left-1/2 -translate-x-1/2" style={{ top: layout.tops[p - 1] }}>
          <PdfPage
            pdf={pdf}
            pageNumber={p}
            scale={scale}
            width={s.w}
            height={s.h}
            annotations={annotationsByPage.get(p) ?? EMPTY}
            tool={props.tool}
            color={props.color}
            penWidth={props.penWidth}
            selectedAnnotationId={annMenu?.annotation.page === p ? annMenu.annotation.id : null}
            onSize={onSize}
            onCreateAnnotation={props.onCreateAnnotation}
            onEraseAnnotation={props.onDeleteAnnotation}
            onNavigateDest={navigateDest}
            onRegion={props.onRegion}
          />
        </div>,
      );
    }
  }

  const menuStyle = (x: number, y: number) => ({
    left: Math.min(x, window.innerWidth - 300),
    top: Math.min(y + 12, window.innerHeight - 60),
  });

  return (
    <div className={`relative h-full min-h-0 ${props.tool === "pen" || props.tool === "area" || props.tool === "eraser" ? "ss-tool-draw" : ""}`}>
      <div ref={scrollRef} className="ss-scroll h-full overflow-auto bg-viewer" onMouseUp={onMouseUp}>
        {loadError ? (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-danger">
            <div>
              <p className="font-medium">Could not open this PDF</p>
              <p className="mt-1 text-ink-3">{loadError}</p>
            </div>
          </div>
        ) : !pdf ? (
          <div className="grid h-full place-items-center text-sm text-ink-3">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="size-6 animate-spin" />
              <span>Opening {doc.title}{progress ? ` · ${Math.round(progress * 100)}%` : "…"}</span>
            </div>
          </div>
        ) : (
          <div className="relative mx-auto" style={{ height: layout.total, width: Math.max(layout.maxW + PAD * 2, 1), minWidth: "100%" }}>
            {pages}
          </div>
        )}
      </div>

      {selMenu && (
        <div
          data-floating-menu
          className="fixed z-50 flex items-center gap-1 rounded-lg border border-line bg-panel p-1 shadow-lg"
          style={menuStyle(selMenu.x, selMenu.y)}
          onMouseDown={(e) => e.preventDefault()}
        >
          <Highlighter className="mx-1 size-4 text-ink-3" />
          {HIGHLIGHT_COLORS.map((c, i) => (
            <button
              key={c}
              title={`Highlight (${i + 1})`}
              className="size-6 rounded-full border border-black/10 transition hover:scale-110"
              style={{ background: c }}
              onClick={() => createHighlights(selMenu.items, c)}
            />
          ))}
          <div className="mx-1 h-5 w-px bg-line" />
          <MenuButton
            icon={<MessageSquarePlus className="size-4" />}
            label="Note"
            hint={keyOf("selNote")}
            onClick={() => {
              const it = selMenu.items[0];
              props.onQuoteToNote(it.page, selMenu.items.map((i) => i.text).join(" "));
              window.getSelection()?.removeAllRanges();
              setSelMenu(null);
            }}
          />
          <MenuButton
            icon={<Copy className="size-4" />}
            label="Copy"
            hint={keyOf("selCopy")}
            onClick={() => {
              void navigator.clipboard?.writeText(selMenu.items.map((i) => i.text).join(" "));
              setSelMenu(null);
            }}
          />
        </div>
      )}

      {annMenu && (
        <div data-floating-menu
          className="fixed z-50 flex items-center gap-1 rounded-lg border border-line bg-panel p-1 shadow-lg" style={menuStyle(annMenu.x, annMenu.y)}>
          {(annMenu.annotation.kind === "ink" ? INK_MENU_COLORS : HIGHLIGHT_COLORS).map((c, i) => (
            <button
              key={c}
              title={`Change colour (${i + 1})`}
              className={`size-6 rounded-full border transition hover:scale-110 ${annMenu.annotation.color === c ? "border-ink ring-2 ring-accent/40" : "border-black/10"}`}
              style={{ background: c }}
              onClick={() => {
                props.onUpdateAnnotation(annMenu.annotation.id, { color: c });
                setAnnMenu(null);
              }}
            />
          ))}
          <div className="mx-1 h-5 w-px bg-line" />
          {annMenu.annotation.text && (
            <MenuButton
              icon={<StickyNote className="size-4" />}
              label="Note"
              hint={keyOf("selNote")}
              onClick={() => {
                props.onQuoteToNote(annMenu.annotation.page, annMenu.annotation.text);
                setAnnMenu(null);
              }}
            />
          )}
          <MenuButton
            icon={<Trash2 className="size-4" />}
            label="Delete"
            hint={keyOf("selDelete")}
            danger
            onClick={() => {
              props.onDeleteAnnotation(annMenu.annotation.id);
              setAnnMenu(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

const EMPTY: Annotation[] = [];
const INK_MENU_COLORS = ["#e53935", "#1e88e5", "#43a047", "#212121"];

function textInRange(range: Range, layer: Element): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    const t = node.textContent ?? "";
    const from = node === range.startContainer ? range.startOffset : 0;
    const to = node === range.endContainer ? range.endOffset : t.length;
    parts.push(t.slice(from, to));
  }
  return parts.join(" ");
}

function MenuButton({ icon, label, onClick, danger, hint }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; hint?: string }) {
  return (
    <button
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium hover:bg-hover ${danger ? "text-danger" : "text-ink-2"}`}
      onClick={onClick}
      title={hint ? `${label} (${hint})` : undefined}
    >
      {icon}
      {label}
      {hint && <Kbd>{hint}</Kbd>}
    </button>
  );
}
