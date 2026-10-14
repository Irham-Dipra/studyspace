import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, ArrowUpDown, Check, ChevronLeft, ChevronRight, Copy, Download, Loader2 } from "lucide-react";
import type { PDFDocumentProxy } from "../lib/pdf";
import {
  COPY_QUALITY,
  canvasToPng,
  copyToClipboard,
  cutCanvas,
  downloadPng,
  imagesHtml,
  renderRegion,
  stackCanvases,
  type CutDirection,
} from "../lib/pageImage";
import { isTyping, matches } from "../lib/shortcuts";
import { Button, KeyHint, Modal, cx } from "./ui";

interface Props {
  getPdf: () => PDFDocumentProxy | null;
  title: string;
  page: number;
  pageCount: number;
  onClose: () => void;
  onError: (e: unknown) => void;
}

type Done = "first" | "second" | "both" | "saved" | null;

/** Cuts a page into two images (top/bottom or left/right) to copy one at a time or both together. */
export function PageHalvesDialog(p: Props) {
  const [page, setPage] = useState(p.page);
  const [source, setSource] = useState<{ page: number; canvas: HTMLCanvasElement; preview: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** null = chosen from the page's shape (portrait: across; landscape: down the middle). */
  const [chosenDirection, setChosenDirection] = useState<CutDirection | null>(null);
  const [at, setAt] = useState(0.5);
  const [done, setDone] = useState<Done>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const pdf = p.getPdf();
    if (!pdf) return;
    let cancelled = false;
    setError(null);
    renderRegion(pdf, page, undefined, COPY_QUALITY).then(
      (canvas) => {
        if (cancelled) return;
        // A small copy for the on-screen previews; the full-size canvas is what gets copied.
        const k = Math.min(1, 900 / Math.max(canvas.width, canvas.height));
        const small = document.createElement("canvas");
        small.width = Math.round(canvas.width * k);
        small.height = Math.round(canvas.height * k);
        small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
        setSource({ page, canvas, preview: small.toDataURL("image/png") });
      },
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = source?.page === page ? source : null;
  const direction: CutDirection = chosenDirection ?? (ready && ready.canvas.width > ready.canvas.height ? "down" : "across");
  const names = direction === "across" ? (["top", "bottom"] as const) : (["left", "right"] as const);
  const ratio = ready ? ready.canvas.width / ready.canvas.height : 0.7;

  const flash = (d: Done) => {
    setDone(d);
    clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(() => setDone(null), 2200);
  };

  const parts = () => (ready ? cutCanvas(ready.canvas, direction, at) : null);
  const copy = (which: "first" | "second" | "both") => {
    const ps = parts();
    if (!ps) return;
    const run =
      which === "both"
        ? copyToClipboard(canvasToPng(stackCanvases(ps)), imagesHtml(ps))
        : copyToClipboard(canvasToPng(ps[which === "first" ? 0 : 1]));
    run.then(() => flash(which), p.onError);
  };
  const save = async () => {
    const ps = parts();
    if (!ps) return;
    try {
      for (const [i, c] of ps.entries()) downloadPng(await canvasToPng(c), `${p.title} - p${page} - ${names[i]}`);
      flash("saved");
    } catch (e) {
      p.onError(e);
    }
  };

  const turnPage = (d: number) => setPage((x) => Math.min(p.pageCount, Math.max(1, x + d)));
  const toggleDirection = () => setChosenDirection(direction === "across" ? "down" : "across");

  // The window's own keys (the app's shortcuts are paused while a dialog is open).
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keysRef.current = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    const step = e.shiftKey ? 0.05 : 0.01;
    let handled = true;
    if (matches(e, "halfFirst")) copy("first");
    else if (matches(e, "halfSecond")) copy("second");
    else if (matches(e, "halfBoth")) copy("both");
    else if (matches(e, "halfSave")) void save();
    else if (matches(e, "halfDirection")) toggleDirection();
    else if (matches(e, "halfCentre")) setAt(0.5);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") setAt((a) => Math.max(0.1, Math.round((a - step) * 100) / 100));
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") setAt((a) => Math.min(0.9, Math.round((a + step) * 100) / 100));
    else if (e.key === "PageUp") turnPage(-1);
    else if (e.key === "PageDown") turnPage(1);
    else handled = false;
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  /** One half of the preview, cropped with CSS from the small preview image. */
  const half = (i: 0 | 1) => {
    const frac = i === 0 ? at : 1 - at;
    const across = direction === "across";
    const img: React.CSSProperties = across
      ? { width: "100%", top: i === 0 ? 0 : `-${(at / (1 - at)) * 100}%`, left: 0 }
      : { height: "100%", width: `${100 / frac}%`, left: i === 0 ? 0 : `-${(at / (1 - at)) * 100}%`, top: 0 };
    return (
      <div
        className="relative mx-auto max-w-full overflow-hidden rounded border border-line bg-white"
        style={{ aspectRatio: across ? `${ratio} / ${frac}` : `${ratio * frac} / 1`, height: across ? "8.5rem" : "14rem" }}
      >
        {ready && <img src={ready.preview} alt="" className="absolute max-w-none" style={img} />}
      </div>
    );
  };

  const copyButton = (which: "first" | "second" | "both", label: string, id: "halfFirst" | "halfSecond" | "halfBoth") => (
    <Button size="sm" variant={which === "both" ? "primary" : "secondary"} disabled={!ready} onClick={() => copy(which)}>
      {done === which ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {done === which ? "Copied" : label}
      <KeyHint id={id} className={which === "both" ? "border-white/40 bg-white/10 text-white/80" : ""} />
    </Button>
  );

  return (
    <Modal
      wide
      title={`Cut page ${page} in half`}
      onClose={p.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={save} disabled={!ready}>
            {done === "saved" ? <Check className="size-4" /> : <Download className="size-4" />} {done === "saved" ? "Saved" : "Save both as PNG"} <KeyHint id="halfSave" />
          </Button>
          {copyButton("both", "Copy both", "halfBoth")}
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* The page, with the cut line: click to move it. */}
        <div>
          <div
            className="relative mx-auto max-h-80 cursor-crosshair overflow-hidden rounded border border-line bg-white"
            style={{ aspectRatio: `${ratio}`, height: ratio < 1 ? "20rem" : undefined, width: ratio < 1 ? undefined : "100%" }}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const f = direction === "across" ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
              setAt(Math.min(0.9, Math.max(0.1, Math.round(f * 100) / 100)));
            }}
            title="Click to move the cut line"
          >
            {ready ? (
              <img src={ready.preview} alt={`Page ${page}`} className="size-full" />
            ) : (
              <div className="grid size-full place-items-center text-xs text-ink-3">
                {error ? <span className="px-3 text-danger">{error}</span> : <Loader2 className="size-5 animate-spin" />}
              </div>
            )}
            <div
              className="pointer-events-none absolute border-dashed border-danger"
              style={direction === "across" ? { left: 0, right: 0, top: `${at * 100}%`, borderTopWidth: 2 } : { top: 0, bottom: 0, left: `${at * 100}%`, borderLeftWidth: 2 }}
            />
          </div>
          <div className="mt-2 flex items-center justify-center gap-1 text-xs text-ink-2">
            <button className="grid size-7 place-items-center rounded hover:bg-hover disabled:opacity-40" disabled={page <= 1} onClick={() => turnPage(-1)} title="Previous page (PgUp)">
              <ChevronLeft className="size-4" />
            </button>
            <span className="tabular-nums">
              Page {page} / {p.pageCount}
            </span>
            <button className="grid size-7 place-items-center rounded hover:bg-hover disabled:opacity-40" disabled={page >= p.pageCount} onClick={() => turnPage(1)} title="Next page (PgDn)">
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex rounded-md border border-line p-0.5" role="radiogroup" aria-label="Cut direction">
              {(
                [
                  ["across", "Top / bottom", ArrowUpDown],
                  ["down", "Left / right", ArrowLeftRight],
                ] as const
              ).map(([d, label, Icon]) => (
                <button
                  key={d}
                  role="radio"
                  aria-checked={direction === d}
                  className={cx("flex items-center gap-1 rounded px-2 py-1", direction === d ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-hover")}
                  onClick={() => setChosenDirection(d)}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
            <KeyHint id="halfDirection" />
            <label className="ml-auto flex items-center gap-2 text-ink-2">
              Cut at
              <input
                type="range"
                min={10}
                max={90}
                value={Math.round(at * 100)}
                onChange={(e) => setAt(Number(e.target.value) / 100)}
                aria-label="Cut position"
                className="w-24 accent-accent"
              />
              <span className="w-8 tabular-nums">{Math.round(at * 100)}%</span>
            </label>
          </div>

          <div className={cx("grid gap-3", direction === "across" ? "grid-cols-1" : "grid-cols-2")}>
            {([0, 1] as const).map((i) => (
              <div key={i} className="flex flex-col items-start gap-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">{names[i]} half</p>
                {half(i)}
                {copyButton(i === 0 ? "first" : "second", `Copy ${names[i]}`, i === 0 ? "halfFirst" : "halfSecond")}
              </div>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-ink-3">
            <b>Copy both</b> pastes two separate pictures into editors like Google Docs, Word or Notion, and one picture with both halves one under the
            other elsewhere. Move the cut with ← → (Shift for bigger steps), or click the page.
          </p>
        </div>
      </div>
    </Modal>
  );
}
