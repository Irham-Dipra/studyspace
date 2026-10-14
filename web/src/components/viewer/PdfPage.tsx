import { memo, useEffect, useRef, useState } from "react";
import { pdfjs, STUDYSPACE_AUTHOR, type PDFDocumentProxy, type PDFPageProxy } from "../../lib/pdf";
import type { Annotation, NormRect } from "../../lib/types";
import type { AnnotationInput } from "../../lib/api";
import { AnnotationOverlay } from "./AnnotationOverlay";
import type { Tool } from "./geometry";

interface LinkBox {
  left: number;
  top: number;
  width: number;
  height: number;
  url?: string;
  dest?: unknown;
}

interface Props {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  /** CSS pixels per PDF point. */
  scale: number;
  /** Page size in PDF points (rotation applied). */
  width: number;
  height: number;
  annotations: Annotation[];
  tool: Tool;
  color: string;
  penWidth: number;
  selectedAnnotationId: string | null;
  onSize: (page: number, w: number, h: number) => void;
  onCreateAnnotation: (a: AnnotationInput) => void;
  onEraseAnnotation: (id: string) => void;
  onNavigateDest: (dest: unknown) => void;
  onRegion?: (page: number, rect: NormRect) => void;
}

/** Max canvas pixels per page; keeps memory bounded at high zoom on HiDPI screens. */
const MAX_CANVAS_PIXELS = 16_000_000;

function PdfPageImpl(props: Props) {
  const { pdf, pageNumber, scale, width, height, onSize } = props;
  const holderRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [links, setLinks] = useState<LinkBox[]>([]);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cssW = Math.floor(width * scale);
  const cssH = Math.floor(height * scale);

  // Load the page, hide annotations StudySpace saved into the file (we draw those from the DB),
  // and collect link areas.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await pdf.getPage(pageNumber);
        const annots = await p.getAnnotations({ intent: "display" });
        for (const a of annots) {
          if (a.titleObj?.str === STUDYSPACE_AUTHOR || String(a.annotationName ?? "").startsWith("studyspace-")) {
            pdf.annotationStorage.setValue(a.id, { noView: true });
          }
        }
        if (cancelled) return;
        const vp = p.getViewport({ scale: 1 });
        onSize(pageNumber, vp.width, vp.height);
        setLinks(
          annots
            .filter((a) => a.subtype === "Link" && (a.url || a.dest))
            .map((a) => {
              const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]);
              const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
              return {
                left: Math.min(x1, x2) / vp.width,
                top: Math.min(y1, y2) / vp.height,
                width: Math.abs(x2 - x1) / vp.width,
                height: Math.abs(y2 - y1) / vp.height,
                url: a.url,
                dest: a.dest,
              };
            }),
        );
        setPage(p);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber, onSize]);

  // Render the canvas into a fresh element and swap it in when done, so zooming never flashes blank.
  useEffect(() => {
    if (!page || !holderRef.current) return;
    const viewport = page.getViewport({ scale });
    const dpr = window.devicePixelRatio || 1;
    const outputScale = Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    const ctx = canvas.getContext("2d", { alpha: false })!;
    const task = page.render({
      canvasContext: ctx,
      canvas,
      viewport,
      transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE,
    });
    let alive = true;
    task.promise.then(
      () => {
        if (!alive || !holderRef.current) return;
        holderRef.current.replaceChildren(canvas);
        setRendered(true);
      },
      (err: Error) => {
        if (err?.name !== "RenderingCancelledException" && alive) setError(err.message);
      },
    );
    return () => {
      alive = false;
      task.cancel();
    };
  }, [page, scale]);

  // Text layer (selection / highlighting).
  useEffect(() => {
    const container = textRef.current;
    if (!page || !container) return;
    container.replaceChildren();
    const viewport = page.getViewport({ scale });
    const layer = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
    layer.render().catch(() => undefined);
    return () => layer.cancel();
  }, [page, scale]);

  const textInteractive = props.tool === "select" || props.tool === "highlight";

  return (
    <div
      className="ss-page relative bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12),0_4px_14px_rgba(0,0,0,0.06)]"
      data-page={pageNumber}
      style={{ width: cssW, height: cssH, ["--total-scale-factor" as string]: String(scale) }}
    >
      <div ref={holderRef} className="absolute inset-0" />
      {!rendered && !error && (
        <div className="absolute inset-0 grid place-items-center text-xs text-neutral-400">Loading page {pageNumber}…</div>
      )}
      {error && <div className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-red-600">Could not render page: {error}</div>}
      <AnnotationOverlay
        page={pageNumber}
        width={cssW}
        height={cssH}
        annotations={props.annotations}
        tool={props.tool}
        color={props.color}
        penWidth={props.penWidth}
        selectedId={props.selectedAnnotationId}
        onCreate={props.onCreateAnnotation}
        onErase={props.onEraseAnnotation}
        onRegion={props.onRegion}
      />
      <div ref={textRef} className="textLayer" style={{ pointerEvents: textInteractive ? undefined : "none" }} />
      {textInteractive &&
        links.map((l, i) => (
          <a
            key={i}
            href={l.url ?? "#"}
            target={l.url ? "_blank" : undefined}
            rel="noreferrer noopener"
            title={l.url ?? "Go to linked page"}
            className="absolute z-[3] rounded-sm hover:bg-indigo-500/10"
            style={{ left: `${l.left * 100}%`, top: `${l.top * 100}%`, width: `${l.width * 100}%`, height: `${l.height * 100}%` }}
            onClick={(e) => {
              if (!l.url) {
                e.preventDefault();
                props.onNavigateDest(l.dest);
              }
            }}
          />
        ))}
    </div>
  );
}

export const PdfPage = memo(PdfPageImpl);
