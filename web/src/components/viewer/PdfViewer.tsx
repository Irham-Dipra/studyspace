import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { AArrowDown, AArrowUp, Highlighter, Loader2, MessageSquarePlus, Copy, Pencil, Trash2, StickyNote } from "lucide-react";
import { CSS_UNITS, openPdf, type PDFDocumentProxy } from "../../lib/pdf";
import { resolveDest, type PdfPosition } from "../../lib/outline";
import { keyOf, matches } from "../../lib/shortcuts";
import { Kbd } from "../ui";
import type { Annotation, DocumentRecord, NormPoint, NormRect } from "../../lib/types";
import { api, type AnnotationInput, type AnnotationPatch } from "../../lib/api";
import { copyText } from "../../lib/pageImage";
import { belowSelection, useTouchSelection } from "../../lib/touchSelection";
import { PdfPage } from "./PdfPage";
import type { PageMarker } from "./NoteMarkers";
import { HIGHLIGHT_COLORS, HIGHLIGHT_OPACITY, TEXT_SIZES, hitTest, mergeLineRects, type Tool } from "./geometry";

export interface PdfViewerHandle {
  /** Scrolls to `page`; with `top` (0 = top of the page, 1 = bottom) to that spot on it. */
  goToPage: (page: number, top?: number | null) => void;
  /** The page and the spot on it at the top of the view (where a bookmark added now points). */
  getPosition: () => PdfPosition;
  /** Back / forward through the places you jumped from (a link, bookmark, note, page number...). */
  goBack: () => void;
  goForward: () => void;
  fitWidthZoom: () => number | null;
  fitPageZoom: () => number | null;
  /** Phones: the width, or the whole page when both the screen and the page lie on their side. */
  fitScreenZoom: () => number | null;
  getPdf: () => PDFDocumentProxy | null;
}

interface Props {
  ref?: Ref<PdfViewerHandle>;
  doc: DocumentRecord;
  initialPage: number;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onPageChange: (page: number) => void;
  /** The pages Back and Forward would go to (null: nothing there). Called when they change. */
  onHistoryChange?: (h: { back: number | null; forward: number | null }) => void;
  onLoaded: (pageCount: number, pdf: PDFDocumentProxy) => void;
  annotations: Annotation[];
  tool: Tool;
  color: string;
  penWidth: number;
  onCreateAnnotation: (a: AnnotationInput) => void;
  onDeleteAnnotation: (id: string) => void;
  /** A box drawn with the "OCR a region" tool. */
  onRegion?: (page: number, rect: NormRect) => void;
  onUpdateAnnotation: (id: string, patch: AnnotationPatch) => void;
  /** Colour and size for new text boxes. */
  textColor?: string;
  textSize?: number;
  /** Notes' markers (all pages); without the handlers none are shown. */
  markers?: PageMarker[];
  onOpenMarker?: (id: string) => void;
  onMoveMarker?: (id: string, at: NormPoint) => void;
  onDeleteMarker?: (id: string) => void;
  onPlaceMarker?: (page: number, at: NormPoint) => void;
  onQuoteToNote: (page: number, text: string) => void;
  /** The second pane of side by side: no tools, and selected text can only be copied. */
  readOnly?: boolean;
  /** Phones: thin margins, so the page gets nearly the whole screen. */
  compact?: boolean;
  /** The view changed size (a phone was turned) or the current page's size became known. */
  onFitNeeded?: () => void;
  /** A double tap on the page (touch screens). */
  onDoubleTap?: () => void;
}

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
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [range, setRange] = useState<[number, number]>([1, 1]);
  const [viewportWidth, setViewportWidth] = useState(800);
  const [selMenu, setSelMenu] = useState<SelMenu | null>(null);
  const [annMenu, setAnnMenu] = useState<AnnMenu | null>(null);

  const GAP = props.compact ? 6 : 14;
  const PAD = props.compact ? 4 : 16;
  /** Room kept for the scrollbar; a phone's lies over the page. */
  const BAR = props.compact ? 0 : 8;
  const contentRef = useRef<HTMLDivElement>(null);
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
    setConverting(doc.kind === "slides");
    let task: ReturnType<typeof openPdf> | null = null;
    // Slides are turned into a PDF on the server first; that can take a while, so say so.
    const ready = doc.kind === "slides" ? api.convert(doc.id) : Promise.resolve();
    ready
      .then(() => {
        if (cancelled) return;
        setConverting(false);
        task = openPdf(api.fileUrl({ id: doc.id, fingerprint: doc.fingerprint }));
        task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
          if (total) setProgress(Math.min(1, loaded / total));
        };
        return task.promise;
      })
      .then(
      async (p) => {
        if (cancelled || !p) return;
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
        if (!cancelled) {
          setConverting(false);
          setLoadError(err.message || "Failed to load PDF");
        }
      },
    );
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [doc.id, doc.fingerprint, doc.kind, onLoaded]);

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
  }, [sizes, scale, GAP, PAD]);

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
    const pinched = pinchEnd.current;
    if (pinched) {
      // After a pinch the spot that was between the fingers stays between them.
      pinchEnd.current = null;
      if (contentRef.current) contentRef.current.style.transform = "";
      const pp = Math.min(pinched.page, layout.tops.length);
      el.scrollTop = layout.tops[pp - 1] + pinched.frac * Math.floor(sizes[pp - 1].h * scale) - pinched.y;
      el.scrollLeft = el.scrollWidth / 2 + pinched.dx * (zoom / pinched.zoom) - pinched.x;
      updateFromScroll();
      return;
    }
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
    let w = el.clientWidth;
    let h = el.clientHeight;
    const ro = new ResizeObserver(() => {
      setViewportWidth(el.clientWidth);
      updateFromScroll();
      if (el.clientWidth !== w || el.clientHeight !== h) fitNeededRef.current?.();
      w = el.clientWidth;
      h = el.clientHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateFromScroll]);

  const fitNeededRef = useRef(props.onFitNeeded);
  fitNeededRef.current = props.onFitNeeded;
  // Pages first take page 1's size; when the current page's real size arrives, a fit must be redone.
  const cur = sizes[currentRef.current - 1];
  useEffect(() => {
    if (cur) fitNeededRef.current?.();
  }, [cur?.w, cur?.h]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Two fingers zoom (touch screens). The page is stretched while the fingers move and drawn again
  // sharp once they lift; a double tap is passed on (the phone layout fits the page again).
  const pinchEnd = useRef<{ page: number; frac: number; x: number; y: number; dx: number; zoom: number } | null>(null);
  const layoutRef = useRef({ layout, sizes, scale, pageAt });
  layoutRef.current = { layout, sizes, scale, pageAt };
  const toolRef = useRef(props.tool);
  toolRef.current = props.tool;
  const doubleTapRef = useRef(props.onDoubleTap);
  doubleTapRef.current = props.onDoubleTap;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let pinch: { dist: number; x: number; y: number; k: number } | null = null;
    let tap: { t: number; x: number; y: number; moved: boolean } | null = null;
    let lastTap: { t: number; x: number; y: number } | null = null;
    const spread = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const limit = (k: number) => Math.min(MAX_ZOOM / zoomRef.current, Math.max(MIN_ZOOM / zoomRef.current, k));
    const onStart = (e: TouchEvent) => {
      const content = contentRef.current;
      if (e.touches.length === 2 && content && !pinchEnd.current) {
        const box = el.getBoundingClientRect();
        const x = (e.touches[0].clientX + e.touches[1].clientX) / 2 - box.left;
        const y = (e.touches[0].clientY + e.touches[1].clientY) / 2 - box.top;
        pinch = { dist: spread(e) || 1, x, y, k: 1 };
        content.style.transformOrigin = `${el.scrollLeft + x - content.offsetLeft}px ${el.scrollTop + y}px`;
        tap = null;
        setSelMenu(null);
        setAnnMenu(null);
      } else if (e.touches.length === 1) {
        tap = { t: performance.now(), x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false };
      } else tap = null;
    };
    const onMove = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2 && contentRef.current) {
        e.preventDefault();
        pinch.k = limit(spread(e) / pinch.dist);
        contentRef.current.style.transform = `scale(${pinch.k})`;
      } else if (tap && Math.hypot(e.touches[0].clientX - tap.x, e.touches[0].clientY - tap.y) > 10) tap.moved = true;
    };
    const onEnd = (e: TouchEvent) => {
      if (pinch) {
        const p = pinch;
        pinch = null;
        const content = contentRef.current;
        const { layout: l, sizes: sz, scale: sc, pageAt: at } = layoutRef.current;
        const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoomRef.current * p.k * 100) / 100));
        if (!content || !l.tops.length || z === zoomRef.current) {
          if (content) content.style.transform = "";
          return;
        }
        const top = el.scrollTop + p.y;
        const page = at(top);
        pinchEnd.current = {
          page,
          frac: (top - l.tops[page - 1]) / (Math.floor(sz[page - 1].h * sc) || 1),
          x: p.x,
          y: p.y,
          dx: el.scrollLeft + p.x - el.scrollWidth / 2,
          zoom: zoomRef.current,
        };
        jumpedAt.current = performance.now();
        props.onZoomChange(z);
        return;
      }
      if (!tap || e.touches.length) return;
      const now = performance.now();
      const t = tap;
      tap = null;
      const target = e.target as HTMLElement;
      if (t.moved || now - t.t > 300 || toolRef.current !== "select" || target.closest("a,button,input,textarea,[contenteditable],[data-floating-menu]")) return void (lastTap = null);
      if (lastTap && now - lastTap.t < 350 && Math.hypot(t.x - lastTap.x, t.y - lastTap.y) < 40) {
        lastTap = null;
        doubleTapRef.current?.();
      } else lastTap = { t: now, x: t.x, y: t.y };
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [props.onZoomChange]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Keys for the open floating bar; returns true when it used the key. */
  const menuKeysRef = useRef<(e: KeyboardEvent) => boolean>(() => false);
  menuKeysRef.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || props.readOnly) return false;
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
      const palette = annMenu.annotation.kind === "ink" || annMenu.annotation.kind === "text" ? INK_MENU_COLORS : HIGHLIGHT_COLORS;
      if (annMenu.annotation.kind === "text" && matches(e, "selEditText")) {
        setEditTextId(annMenu.annotation.id);
        setAnnMenu(null);
        return true;
      }
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
  /** Scrolls to a spot without touching the history (`top` as in `goToPage`). */
  const scrollToSpot = useCallback(
    (page: number, top?: number | null) => {
      const el = scrollRef.current;
      const frac = top ? Math.min(1, Math.max(0, top)) : 0;
      if (!el || !layout.tops.length) {
        currentRef.current = page;
        anchorRef.current = { page, frac };
        return;
      }
      const p = Math.min(Math.max(1, Math.round(page)), layout.tops.length);
      jumpedAt.current = performance.now();
      burst.current = null;
      el.scrollTop = layout.tops[p - 1] + frac * Math.floor(sizes[p - 1].h * scale) - 8;
      updateFromScroll();
    },
    [layout, sizes, scale, updateFromScroll],
  );

  /** Where the view is now, as `goToPage` takes it (a few pixels of slack so "top of the page" stays exactly that). */
  const hereSpot = useCallback((): PdfPosition => {
    const a = anchorRef.current ?? { page: currentRef.current, frac: 0 };
    const top = a.frac < 0.02 ? null : Math.round(Math.min(0.98, a.frac + 8 / Math.max(1, (sizes[a.page - 1]?.h ?? 800) * scale)) * 10000) / 10000;
    return { page: a.page, top };
  }, [sizes, scale]);

  // The places jumped from, for Back and Forward (a viewer is made again for each file, so it starts empty).
  const history = useRef<{ back: PdfPosition[]; forward: PdfPosition[] }>({ back: [], forward: [] });
  const onHistoryRef = useRef(props.onHistoryChange);
  onHistoryRef.current = props.onHistoryChange;
  const announceHistory = () => {
    const h = history.current;
    onHistoryRef.current?.({ back: h.back.at(-1)?.page ?? null, forward: h.forward.at(-1)?.page ?? null });
  };

  /** Puts a place on the Back list (not twice in a row), and forgets what Forward had. */
  const remember = (spot: PdfPosition) => {
    const h = history.current;
    const last = h.back.at(-1);
    if (!last || last.page !== spot.page || Math.abs((last.top ?? 0) - (spot.top ?? 0)) > 0.02) h.back.push(spot);
    if (h.back.length > 50) h.back.shift();
    h.forward = [];
    announceHistory();
  };

  const goToPage = useCallback(
    (page: number, top?: number | null) => {
      if (scrollRef.current && layout.tops.length) {
        // Only a jump is remembered: turning to the next or previous page, or a spot a short way
        // along the same page, isn't (Back would then just undo a page turn).
        const here = hereSpot();
        const target = Math.min(Math.max(1, Math.round(page)), layout.tops.length);
        const apart = Math.abs(target - here.page);
        const far = apart > 1 || (apart === 1 && !!top) || (apart === 0 && !!top && Math.abs(top - (here.top ?? 0)) > 0.1);
        if (far) remember(here);
      }
      scrollToSpot(page, top);
    },
    [layout, hereSpot, scrollToSpot], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // A quick scroll over several pages (wheel, scrollbar, trackpad) is a jump too. Reading on, a bit
  // at a time with pauses, isn't: a burst of scrolling ends when the view has rested half a second.
  const burst = useRef<PdfPosition | null>(null);
  const jumpedAt = useRef(0);
  const hereRef = useRef(hereSpot);
  hereRef.current = hereSpot;
  const rememberRef = useRef(remember);
  rememberRef.current = remember;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let timer = 0;
    const onScroll = () => {
      // Scrolls we caused (a jump, Back, a zoom) don't start a burst.
      if (!burst.current && performance.now() - jumpedAt.current > 400) burst.current = hereRef.current();
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const from = burst.current;
        burst.current = null;
        if (from && Math.abs(hereRef.current().page - from.page) >= 3) rememberRef.current(from);
      }, 500);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
    };
  }, [pdf]);

  const goBack = useCallback(() => {
    const h = history.current;
    const to = h.back.pop();
    if (!to) return;
    h.forward.push(hereSpot());
    scrollToSpot(to.page, to.top);
    announceHistory();
  }, [hereSpot, scrollToSpot]); // eslint-disable-line react-hooks/exhaustive-deps
  const goForward = useCallback(() => {
    const h = history.current;
    const to = h.forward.pop();
    if (!to) return;
    h.back.push(hereSpot());
    scrollToSpot(to.page, to.top);
    announceHistory();
  }, [hereSpot, scrollToSpot]); // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(
    props.ref,
    () => ({
      goToPage,
      getPdf: () => pdf,
      getPosition: hereSpot,
      goBack,
      goForward,
      // The width is read from the element: right after a phone is turned the state is still the old one.
      fitWidthZoom: () => {
        const s = sizes[currentRef.current - 1] ?? sizes[0];
        const el = scrollRef.current;
        if (!s || !el) return null;
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (el.clientWidth - PAD * 2 - BAR) / (s.w * CSS_UNITS)));
      },
      fitPageZoom: () => {
        const s = sizes[currentRef.current - 1] ?? sizes[0];
        const el = scrollRef.current;
        if (!s || !el) return null;
        const z = Math.min((el.clientWidth - PAD * 2 - BAR) / (s.w * CSS_UNITS), (el.clientHeight - PAD * 2) / (s.h * CSS_UNITS));
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
      },
      fitScreenZoom: () => {
        const s = sizes[currentRef.current - 1] ?? sizes[0];
        const el = scrollRef.current;
        if (!s || !el) return null;
        const byWidth = (el.clientWidth - PAD * 2 - BAR) / (s.w * CSS_UNITS);
        const sideways = el.clientWidth > el.clientHeight && s.w > s.h;
        const z = sideways ? Math.min(byWidth, (el.clientHeight - PAD * 2) / (s.h * CSS_UNITS)) : byWidth;
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
      },
    }),
    [goToPage, goBack, goForward, hereSpot, pdf, sizes, scale, viewportWidth, PAD, BAR],
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

  const markersByPage = useMemo(() => {
    const m = new Map<number, PageMarker[]>();
    for (const n of props.markers ?? []) m.set(n.page, [...(m.get(n.page) ?? []), n]);
    return m;
  }, [props.markers]);

  /** A text box to edit, asked for from its menu (its page's layer opens it). */
  const [editTextId, setEditTextId] = useState<string | null>(null);
  const onTextEditDone = useCallback(() => setEditTextId(null), []);
  /** A text box's font one size up or down (sizes between the toolbar's are kept in step). */
  const resizeText = (a: Annotation, dir: 1 | -1) => {
    const next = dir > 0 ? TEXT_SIZES.find((s) => s > a.strokeWidth + 1e-4) : [...TEXT_SIZES].reverse().find((s) => s < a.strokeWidth - 1e-4);
    if (!next) return;
    props.onUpdateAnnotation(a.id, { strokeWidth: next });
    // The menu stays open: its copy of the box takes the new size, so another click goes on from it.
    setAnnMenu((m) => (m && m.annotation.id === a.id ? { ...m, annotation: { ...m.annotation, strokeWidth: next } } : m));
  };

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
        if (it.rects?.length) props.onCreateAnnotation({ page: it.page, kind: "highlight", color, opacity: HIGHLIGHT_OPACITY, rects: it.rects, text: it.text });
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
      if (props.readOnly) return;
      const pageEl = (e.target as HTMLElement).closest<HTMLElement>(".ss-page");
      if (!pageEl) return setAnnMenu(null);
      const page = Number(pageEl.dataset.page);
      const box = pageEl.getBoundingClientRect();
      const hit = hitTest(annotationsByPage.get(page) ?? [], [(e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height], box.height / box.width);
      setAnnMenu(hit ? { x: e.clientX, y: e.clientY, annotation: hit } : null);
    }, 0);
  };

  // Phones: a long-press selection always gets the bar (also with the highlight tool), since its
  // handles may still be dragged after it first settles.
  useTouchSelection(
    scrollRef,
    (r) => {
      const items = selectionToItems();
      if (items.length) setSelMenu({ ...belowSelection(r), items });
    },
    props.tool === "select" || props.tool === "highlight",
  );

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
            textColor={props.textColor ?? "#212121"}
            textSize={props.textSize ?? TEXT_SIZES[1]}
            editTextId={editTextId}
            onTextEditDone={onTextEditDone}
            onUpdateAnnotation={props.onUpdateAnnotation}
            markers={markersByPage.get(p) ?? NO_MARKERS}
            onOpenMarker={props.onOpenMarker}
            onMoveMarker={props.onMoveMarker}
            onDeleteMarker={props.onDeleteMarker}
            onPlaceMarker={props.onPlaceMarker}
          />
        </div>,
      );
    }
  }

  // On a phone the bar is about as wide as the screen: it starts at the left edge and may wrap.
  const menuStyle = (x: number, y: number) => {
    const narrow = window.innerWidth < 640;
    return {
      left: narrow ? 8 : Math.min(x, window.innerWidth - 300),
      top: Math.min(y + 12, window.innerHeight - (narrow ? 110 : 60)),
      maxWidth: "calc(100vw - 16px)",
    };
  };

  return (
    <div className={`relative h-full min-h-0 ${props.tool === "pen" || props.tool === "area" || props.tool === "eraser" ? "ss-tool-draw" : ""}`}>
      <div ref={scrollRef} className="ss-scroll h-full touch-pan-x touch-pan-y overflow-auto bg-viewer" onMouseUp={onMouseUp}>
        {loadError ? (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-danger">
            <div>
              <p className="font-medium">Could not open {doc.kind === "slides" ? "these slides" : "this PDF"}</p>
              <p className="mt-1 text-ink-3">{loadError}</p>
            </div>
          </div>
        ) : !pdf ? (
          <div className="grid h-full place-items-center text-sm text-ink-3">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="size-6 animate-spin" />
              {converting ? (
                <span className="max-w-xs text-center">
                  Turning the slides of {doc.title} into pages…
                  <br />
                  <span className="text-xs">The first time takes up to a minute; after that they open at once.</span>
                </span>
              ) : (
                <span>Opening {doc.title}{progress ? ` · ${Math.round(progress * 100)}%` : "…"}</span>
              )}
            </div>
          </div>
        ) : (
          <div ref={contentRef} className="relative mx-auto" style={{ height: layout.total, width: Math.max(layout.maxW + PAD * 2, 1), minWidth: "100%" }}>
            {pages}
          </div>
        )}
      </div>

      {selMenu && (
        <div
          data-floating-menu
          className="fixed z-50 flex flex-wrap items-center gap-1 rounded-lg border border-line bg-panel p-1 shadow-lg"
          style={menuStyle(selMenu.x, selMenu.y)}
          onMouseDown={(e) => e.preventDefault()}
        >
          {!props.readOnly && <Highlighter className="mx-1 size-4 text-ink-3" />}
          {!props.readOnly && HIGHLIGHT_COLORS.map((c, i) => (
            <button
              key={c}
              title={`Highlight (${i + 1})`}
              className="size-6 rounded-full border border-black/10 transition hover:scale-110"
              style={{ background: c }}
              onClick={() => createHighlights(selMenu.items, c)}
            />
          ))}
          {!props.readOnly && (
            <>
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
            </>
          )}
          <MenuButton
            icon={<Copy className="size-4" />}
            label="Copy"
            hint={keyOf("selCopy")}
            onClick={() => {
              void copyText(selMenu.items.map((i) => i.text).join(" "));
              setSelMenu(null);
            }}
          />
        </div>
      )}

      {annMenu && (
        <div data-floating-menu
          className="fixed z-50 flex flex-wrap items-center gap-1 rounded-lg border border-line bg-panel p-1 shadow-lg" style={menuStyle(annMenu.x, annMenu.y)}>
          {(annMenu.annotation.kind === "ink" || annMenu.annotation.kind === "text" ? INK_MENU_COLORS : HIGHLIGHT_COLORS).map((c, i) => (
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
          {annMenu.annotation.kind === "text" && (
            <>
              <MenuButton
                icon={<Pencil className="size-4" />}
                label="Edit"
                hint={keyOf("selEditText")}
                onClick={() => {
                  setEditTextId(annMenu.annotation.id);
                  setAnnMenu(null);
                }}
              />
              <button className="rounded-md p-1 text-ink-2 hover:bg-hover" title="Smaller text" aria-label="Smaller text" onClick={() => resizeText(annMenu.annotation, -1)}>
                <AArrowDown className="size-4" />
              </button>
              <button className="rounded-md p-1 text-ink-2 hover:bg-hover" title="Larger text" aria-label="Larger text" onClick={() => resizeText(annMenu.annotation, 1)}>
                <AArrowUp className="size-4" />
              </button>
            </>
          )}
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
const NO_MARKERS: PageMarker[] = [];
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
