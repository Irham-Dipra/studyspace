import { useEffect, useRef, useState } from "react";
import { Check, Copy, Download, Images, Loader2 } from "lucide-react";
import type { PDFDocumentProxy } from "../lib/pdf";
import { parsePageList } from "../lib/pdf";
import { canvasToBlob, copyToClipboard, downloadBlob, renderRegion } from "../lib/pageImage";
import { ZipWriter } from "../lib/zip";
import { isTyping, matches, type ShortcutId } from "../lib/shortcuts";
import { Button, KeyHint, Modal, cx, inputCls, selectAllOnFocus } from "./ui";

interface Props {
  getPdf: () => PDFDocumentProxy | null;
  title: string;
  page: number;
  pageCount: number;
  onClose: () => void;
  onError: (e: unknown) => void;
  onDone: (message: string) => void;
}

type Mode = "this" | "range" | "all";
type Format = "png" | "jpeg";
const DPIS = [100, 150, 200, 300];

/** Remembered choices (format and sharpness). */
const PREFS_KEY = "ss-picture-prefs";
const loadPrefs = (): { format: Format; dpi: number } => {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { format?: Format; dpi?: number };
    return { format: p.format === "jpeg" ? "jpeg" : "png", dpi: DPIS.includes(p.dpi ?? 0) ? p.dpi! : 150 };
  } catch {
    return { format: "png", dpi: 150 };
  }
};

const safeName = (s: string) => s.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "page";

/** "3", "3-5", "3, 5-7" for file names. */
function pagesText(pages: number[]): string {
  const runs: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    runs.push(i === j ? `${pages[i]}` : `${pages[i]}-${pages[j]}`);
    i = j;
  }
  return runs.length > 3 ? `${runs.slice(0, 3).join(", ")}…` : runs.join(", ");
}

/** Saves one page as a picture, or several as one .zip (each page its own picture). */
export function PageImagesDialog(p: Props) {
  const prefs = useRef(loadPrefs());
  const [mode, setMode] = useState<Mode>("this");
  const [range, setRange] = useState(String(p.page));
  const [format, setFormat] = useState<Format>(prefs.current.format);
  const [dpi, setDpi] = useState(prefs.current.dpi);
  const [working, setWorking] = useState<{ done: number; total: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const rangeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ format, dpi }));
    } catch {
      /* storage unavailable */
    }
  }, [format, dpi]);
  useEffect(() => () => abortRef.current?.abort(), []);

  let pages: number[] = [];
  let error: string | null = null;
  try {
    pages = mode === "this" ? [p.page] : mode === "all" ? Array.from({ length: p.pageCount }, (_, i) => i + 1) : parsePageList(range, p.pageCount);
    if (!pages.length) error = "Type the pages, e.g. 3, 5-9.";
  } catch (e) {
    error = (e as Error).message;
  }
  // Rough size per page: a 200 dpi PNG of a text page is about 0.5 MB, a JPEG about a third of that.
  const mbPerPage = (format === "png" ? 0.5 : 0.18) * (dpi / 200) ** 2;
  const estimate = pages.length * mbPerPage;

  const render = async (pdf: PDFDocumentProxy, n: number) => {
    const canvas = await renderRegion(pdf, n, undefined, { dpi, maxSide: Math.round((dpi / 72) * 1400) });
    const blob = await canvasToBlob(canvas, format === "png" ? "image/png" : "image/jpeg", 0.9);
    canvas.width = canvas.height = 0; // free the pixels now
    return blob;
  };
  const ext = format === "png" ? "png" : "jpg";
  const base = safeName(p.title);

  const save = async () => {
    const pdf = p.getPdf();
    if (!pdf || error || working) return;
    const ac = (abortRef.current = new AbortController());
    setWorking({ done: 0, total: pages.length });
    try {
      if (pages.length === 1) {
        downloadBlob(await render(pdf, pages[0]), `${base} - p${pages[0]}.${ext}`);
        p.onDone(`Saved page ${pages[0]} as a picture`);
      } else {
        const zip = new ZipWriter();
        const width = String(Math.max(...pages)).length;
        for (const [i, n] of pages.entries()) {
          if (ac.signal.aborted) return;
          zip.add(`${base} - p${String(n).padStart(width, "0")}.${ext}`, new Uint8Array(await (await render(pdf, n)).arrayBuffer()));
          setWorking({ done: i + 1, total: pages.length });
        }
        downloadBlob(zip.finish(), `${base} - pages ${pagesText(pages)} (${ext}).zip`);
        p.onDone(`Saved ${pages.length} pages as pictures in one .zip`);
      }
      p.onClose();
    } catch (e) {
      p.onError(e);
    } finally {
      if (!ac.signal.aborted) setWorking(null);
    }
  };

  const copy = () => {
    const pdf = p.getPdf();
    if (!pdf || pages.length !== 1) return;
    // PNG on the clipboard: it's what other apps paste.
    copyToClipboard(renderRegion(pdf, pages[0], undefined, { dpi, maxSide: 4000 }).then((c) => canvasToBlob(c, "image/png"))).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, p.onError);
  };

  const pick = (m: Mode) => {
    setMode(m);
    if (m === "range") requestAnimationFrame(() => (rangeRef.current?.focus(), rangeRef.current?.select()));
  };

  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keysRef.current = (e: KeyboardEvent) => {
    if (working || isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const is = (id: ShortcutId) => matches(e, id);
    const onButton = document.activeElement instanceof HTMLButtonElement;
    let handled = true;
    if (is("picThis")) pick("this");
    else if (is("picRange")) pick("range");
    else if (is("picAll")) pick("all");
    else if (is("picFormat")) setFormat((f) => (f === "png" ? "jpeg" : "png"));
    else if (is("picQuality")) setDpi((d) => DPIS[(DPIS.indexOf(d) + 1) % DPIS.length]);
    else if (is("picCopy")) copy();
    else if (is("picSave") && !onButton) void save();
    else handled = false;
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const choice = <T extends string | number>(value: T, current: T, set: (v: T) => void, label: string) => (
    <button
      key={String(value)}
      className={cx("rounded px-2.5 py-1", current === value ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-hover")}
      onClick={() => set(value)}
      aria-pressed={current === value}
    >
      {label}
    </button>
  );

  return (
    <Modal
      title="Save pages as pictures"
      onClose={() => {
        abortRef.current?.abort();
        p.onClose();
      }}
      footer={
        working ? (
          <Button variant="ghost" onClick={() => (abortRef.current?.abort(), setWorking(null))}>
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={copy} disabled={pages.length !== 1 || !!error} title="Copy the picture to the clipboard (one page only)">
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copied" : "Copy"} <KeyHint id="picCopy" />
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={!!error} autoFocus>
              <Download className="size-4" />
              {pages.length > 1 ? `Save ${pages.length} pictures (.zip)` : "Save picture"}
              <KeyHint id="picSave" className="border-white/40 bg-white/10 text-white/80" />
            </Button>
          </>
        )
      }
    >
      {working ? (
        <div className="py-6 text-center">
          <Loader2 className="mx-auto size-6 animate-spin text-accent" />
          <p className="mt-3 text-sm font-medium text-ink">Making pictures…</p>
          <div className="mx-auto mt-3 h-1.5 w-64 overflow-hidden rounded-full bg-subtle">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.round((working.done / working.total) * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-ink-3">
            {working.done} / {working.total} pages
          </p>
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-2">Pages</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {(
                [
                  ["this", `This page (${p.page})`, "picThis"],
                  ["range", "Pages", "picRange"],
                  ["all", `Whole PDF (${p.pageCount})`, "picAll"],
                ] as const
              ).map(([id, label, key]) => (
                <label key={id} className="flex cursor-pointer items-center gap-1.5">
                  <input type="radio" name="picture-pages" checked={mode === id} onChange={() => pick(id)} />
                  {label} <KeyHint id={key} />
                </label>
              ))}
            </div>
            {mode === "range" && (
              <input
                ref={rangeRef}
                aria-label="Pages to save"
                data-shortcut-letters
                className={cx(inputCls, "mt-2")}
                value={range}
                onChange={(e) => setRange(e.target.value)}
                onFocus={selectAllOnFocus}
                onKeyDown={(e) => e.key === "Enter" && void save()}
                placeholder="e.g. 3, 5-9"
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-ink-2">Format</span>
              <div className="flex rounded-md border border-line p-0.5">
                {choice<Format>("png", format, setFormat, "PNG")}
                {choice<Format>("jpeg", format, setFormat, "JPEG")}
              </div>
              <KeyHint id="picFormat" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink-2">Sharpness</span>
              <div className="flex rounded-md border border-line p-0.5">{DPIS.map((d) => choice(d, dpi, setDpi, `${d} dpi`))}</div>
              <KeyHint id="picQuality" />
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-md bg-subtle px-3 py-2 text-xs leading-relaxed text-ink-2">
            <Images className="mt-0.5 size-4 shrink-0 text-ink-3" />
            <span>
              {error ? (
                <span className="text-danger">{error}</span>
              ) : pages.length === 1 ? (
                <>One {format.toUpperCase()} picture, through your browser's download.</>
              ) : (
                <>
                  {pages.length} pictures, one per page, in a single .zip, about {estimate < 1 ? "1" : Math.round(estimate)} MB.
                </>
              )}{" "}
              PNG is sharpest; JPEG is much smaller. 150 dpi is fine for screens, 300 dpi for printing. Highlights saved into the PDF are included.
              {!error && estimate > 300 && <span className="mt-1 block text-warn">That's a lot: choose JPEG or a lower sharpness, or fewer pages.</span>}
            </span>
          </p>
        </div>
      )}
    </Modal>
  );
}
