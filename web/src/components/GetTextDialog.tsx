import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bookmark as BookmarkIcon, Check, Copy, Download, FileText, Highlighter, Loader2, NotebookText, ScanText, StickyNote } from "lucide-react";
import { api, type OcrStatus, type ResourceInput } from "../lib/api";
import { openPdf, type PDFDocumentProxy } from "../lib/pdf";
import { renderRegionPng } from "../lib/pageImage";
import { extractPages, ocrTextToFormat, textlessPages, type TextFormat } from "../lib/pdfToMarkdown";
import { notesForText } from "../lib/notesText";
import { bookmarkPages, buildBookmarkTree, currentBookmarkId, flattenBookmarkTree, type BookmarkTreeNode } from "../lib/outline";
import type { Annotation, Bookmark, DocumentRecord, NormRect, Resource } from "../lib/types";
import { isTyping, matches, type ShortcutId } from "../lib/shortcuts";
import { Markdown } from "./Markdown";
import { Button, KeyHint, Modal, NumberInput, cx, inputCls } from "./ui";

/** Choices to open the pages dialog with (from a shortcut or menu item); `auto` starts right away. */
export interface TextPreset {
  mode: PageMode;
  method: "text" | "ocr";
  /** For mode "bookmark": the bookmark whose section to read (default: the one you're in). */
  bookmarkId?: string;
  auto?: boolean;
}

/** Which pages: this one, a range, the whole PDF, or a bookmark's section (up to the next bookmark). */
type PageMode = "this" | "range" | "all" | "bookmark";

/** What to read: pages (choose in the dialog) or a box drawn with the region tool. */
export type TextRequest = { kind: "pages"; preset?: TextPreset } | { kind: "region"; page: number; rect: NormRect };

interface Props {
  request: TextRequest;
  doc: DocumentRecord;
  page: number;
  pageCount: number;
  /** The viewer's loaded PDF. */
  getPdf: () => PDFDocumentProxy | null;
  /** The document's highlights (only text and area highlights are used), for marking ==highlighted== text. */
  highlights: Annotation[];
  /** The PDF's bookmarks, for reading a bookmark's section. */
  bookmarks: Bookmark[];
  /** The PDF's notes (any kind), to include after the pages they're for. */
  notes: Resource[];
  onClose: () => void;
  onSaveNote: (input: ResourceInput) => Promise<void>;
  /** "Add to PDF": applies an OCR job's text layer as an undoable file edit. Resolves true on success. */
  onApplyOcr: (jobId: string, pages: number[]) => Promise<boolean>;
}

/** `label`: the bookmark the pages were chosen by, if any. */
type Source = { kind: "pages"; pages: number[]; emptyPages: number[]; ocrJobId?: string; label?: string } | { kind: "region"; page: number; from: "ocr" | "text" };

/** How the text is built: format, ==highlight== marks, and the user's notes in between pages. */
interface Build {
  format: TextFormat;
  marks: boolean;
  notes: boolean;
}

interface Result {
  text: string;
  source: Source;
  /** Rebuilds the text another way (edits in the text box are replaced). */
  regenerate: (b: Build) => Promise<string>;
  /** Region only: the other way of reading it (OCR vs the PDF's own text), when both exist. */
  alternative?: { from: "ocr" | "text"; regenerate: (b: Build) => Promise<string> };
}

const PREVIEW_LIMIT = 30_000;
const NOTE_LIMIT = 1_000_000;
const NOTE_SLOW = 150_000;

/** Pixels for region OCR: about 300 dpi, with the longer side of the crop capped. */
/** The PDF's own text inside a region (lines in reading order), or "" when there is none. */
async function regionText(pdf: PDFDocumentProxy, pageNumber: number, rect: NormRect): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const lines: { y: number; parts: { x: number; s: string }[] }[] = [];
  for (const it of content.items) {
    if (!("str" in it) || !it.str.trim()) continue;
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]) as [number, number];
    const nx = x / vp.width;
    const ny = y / vp.height;
    if (nx < rect.x - 0.01 || nx > rect.x + rect.w || ny < rect.y || ny > rect.y + rect.h + 0.01) continue;
    const size = Math.hypot(it.transform[2], it.transform[3]) || 10;
    let line = lines.find((l) => Math.abs(l.y - y) < size * 0.5);
    if (!line) lines.push((line = { y, parts: [] }));
    line.parts.push({ x, s: it.str });
  }
  return lines
    .sort((a, b) => a.y - b.y)
    .map((l) => l.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim())
    .join("\n");
}

const describePages = (pages: number[], total: number) => {
  if (pages.length === total && total > 1) return "whole PDF";
  if (pages.length === 1) return `page ${pages[0]}`;
  return `pages ${pages[0]}–${pages[pages.length - 1]}`;
};

/** An on/off choice remembered between uses. */
function useRemembered(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? initial : v === "1";
    } catch {
      return initial;
    }
  });
  const set = (v: boolean) => {
    setValue(v);
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };
  return [value, set];
}

const pagesBetween = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export function GetTextDialog({ request, doc, page, pageCount, getPdf, highlights, bookmarks, notes, onClose, onSaveNote, onApplyOcr }: Props) {
  const preset = request.kind === "pages" ? request.preset : undefined;
  const [status, setStatus] = useState<OcrStatus | null>(null);
  const [mode, setMode] = useState<PageMode>(preset?.mode === "bookmark" && !bookmarks.length ? "this" : (preset?.mode ?? "this"));
  const [from, setFrom] = useState(page);
  const [to, setTo] = useState(Math.min(pageCount, page + 4));
  const [method, setMethod] = useState<"text" | "ocr">(preset?.method ?? "text");
  /** Mark highlighted passages as ==text== / put my notes in (both remembered between uses). */
  const [marks, setMarks] = useRemembered("ss-text-marks", true);
  const [withNotes, setWithNotes] = useRemembered("ss-text-notes", false);
  const fromRef = useRef<HTMLInputElement>(null);
  const findRef = useRef<HTMLInputElement>(null);

  // Bookmarks in reading order, and the pages each one's section covers.
  const ordered = useMemo(() => flattenBookmarkTree(buildBookmarkTree(bookmarks)), [bookmarks]);
  const [bookmarkId, setBookmarkId] = useState<string | null>(() => preset?.bookmarkId ?? currentBookmarkId(bookmarks, page) ?? ordered[0]?.id ?? null);
  /** A chapter's section includes the bookmarks nested inside it (runs to the next chapter). */
  const [withInside, setWithInside] = useState(true);
  const sections = useMemo(() => {
    const m = new Map<string, { start: number; end: number }>();
    for (const b of ordered) m.set(b.id, bookmarkPages(ordered, b.id, pageCount, withInside)!);
    return m;
  }, [ordered, pageCount, withInside]);
  const chosenBookmark = ordered.find((b) => b.id === bookmarkId) ?? null;
  const [format, setFormat] = useState<TextFormat>("markdown");
  const [pageMarkers, setPageMarkers] = useState(true);
  const [dropRepeated, setDropRepeated] = useState(true);

  const [working, setWorking] = useState<{ label: string; done: number; total: number; startedAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [text, setText] = useState("");
  const [view, setView] = useState<"preview" | "raw">("preview");
  const [done, setDone] = useState<{ copied?: boolean; saved?: boolean; applied?: boolean }>({});
  const [confirmApply, setConfirmApply] = useState(false);
  const [, tick] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  /** OCR jobs started here: discarded on close unless their layer was added to the PDF. */
  const jobsRef = useRef<{ id: string; applied: boolean }[]>([]);
  /** pdf.js loading task of the OCRed copy (destroying it frees the document). */
  const ocrPdfRef = useRef<ReturnType<typeof openPdf> | null>(null);

  useEffect(() => {
    api.ocrStatus().then(setStatus, () => setStatus(null));
  }, []);

  // Clean up on close: stop work, drop unapplied OCR results, free the OCRed PDF.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      for (const j of jobsRef.current) if (!j.applied) void api.discardOcr(j.id).catch(() => undefined);
      void ocrPdfRef.current?.destroy();
    },
    [],
  );

  // Elapsed-time display while working.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [working]);

  const pagesToRead = useMemo(() => {
    if (mode === "this") return [page];
    if (mode === "all") return pagesBetween(1, pageCount);
    if (mode === "bookmark") {
      const r = bookmarkId ? sections.get(bookmarkId) : undefined;
      return r ? pagesBetween(r.start, r.end) : [];
    }
    return pagesBetween(Math.min(from, to), Math.min(pageCount, Math.max(from, to)));
  }, [mode, page, pageCount, from, to, bookmarkId, sections]);
  const label = mode === "bookmark" ? chosenBookmark?.title : undefined;

  const show = (r: Result) => {
    setResult(r);
    setText(r.text);
    setDone({});
    setConfirmApply(false);
    setView(r.text.length > PREVIEW_LIMIT ? "raw" : "preview");
  };

  const fail = (e: unknown) => {
    if ((e as Error)?.name === "AbortError") return;
    setError((e as Error)?.message ?? String(e));
  };

  /** StudySpace's text and area highlights by page, for ==marks== in the text. */
  const highlightMap = useMemo(() => {
    const m = new Map<number, NormRect[]>();
    for (const a of highlights) {
      if (a.kind === "ink") continue;
      m.set(a.page, [...(m.get(a.page) ?? []), ...a.rects]);
    }
    return m;
  }, [highlights]);
  const markedCount = (t: string) => Math.floor((t.match(/==(?=\S)[^\n]*?\S==/g) ?? []).length);

  const extractFrom = async (pdf: PDFDocumentProxy, pages: number[], b: Build, signal?: AbortSignal, ocrPages?: number[]) => {
    const n = b.notes ? notesForText(notes, pages, pageCount, b.format) : null;
    const r = await extractPages(
      pdf,
      pages,
      { format: b.format, pageMarkers: pageMarkers && pages.length > 1, dropRepeated, ocrPages, highlights: b.marks ? highlightMap : null, afterPage: n?.afterPage },
      (d, t) => setWorking((w) => (w ? { ...w, done: d, total: t } : w)),
      signal,
    );
    return n?.whole ? { ...r, text: `${r.text.trimEnd()}\n\n${n.whole}\n` } : r;
  };
  const build: Build = { format, marks, notes: withNotes };

  /** Reads pages from the PDF's own text layer. */
  const runText = async (pages: number[], label?: string) => {
    const pdf = getPdf();
    if (!pdf) return setError("The PDF is still loading. Try again in a moment.");
    const ac = (abortRef.current = new AbortController());
    setError(null);
    setWorking({ label: "Reading the PDF's text", done: 0, total: pages.length, startedAt: Date.now() });
    try {
      const r = await extractFrom(pdf, pages, build, ac.signal);
      show({ text: r.text, source: { kind: "pages", pages, emptyPages: r.emptyPages, label }, regenerate: async (b) => (await extractFrom(pdf, pages, b)).text });
    } catch (e) {
      fail(e);
    } finally {
      setWorking(null);
    }
  };

  /** OCRs `ocrPages` on a copy of the PDF, then reads `pages` from the OCRed copy. */
  const runOcr = async (pages: number[], ocrPages: number[], label?: string) => {
    const ac = (abortRef.current = new AbortController());
    setError(null);
    setWorking({ label: `Recognising text (OCR) on ${ocrPages.length} page${ocrPages.length === 1 ? "" : "s"}`, done: 0, total: ocrPages.length, startedAt: Date.now() });
    let jobId: string | null = null;
    try {
      // Pages that had no text before OCR: their text will be OCR text (laid out without headings).
      const original = getPdf();
      const scanned = original ? await textlessPages(original, ocrPages, ac.signal) : ocrPages;
      const job = await api.startOcr(doc.id, ocrPages, doc.fingerprint);
      jobId = job.id;
      if (ac.signal.aborted) {
        void api.discardOcr(job.id).catch(() => undefined);
        throw new DOMException("Cancelled", "AbortError");
      }
      jobsRef.current.push({ id: job.id, applied: false });
      ac.signal.addEventListener("abort", () => void api.discardOcr(job.id).catch(() => undefined));
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        if (ac.signal.aborted) throw new DOMException("Cancelled", "AbortError");
        const j = await api.ocrJob(job.id);
        setWorking((w) => (w ? { ...w, done: Math.min(j.progress, ocrPages.length) } : w));
        if (j.state === "failed") throw new Error(j.error ?? "OCR failed.");
        if (j.state === "done") break;
      }
      setWorking((w) => (w ? { ...w, label: "Reading the recognised text", done: 0, total: pages.length } : w));
      void ocrPdfRef.current?.destroy();
      const task = (ocrPdfRef.current = openPdf(api.ocrJobFileUrl(job.id)));
      const pdf = await task.promise;
      const r = await extractFrom(pdf, pages, build, ac.signal, scanned);
      show({
        text: r.text,
        source: { kind: "pages", pages, emptyPages: r.emptyPages, ocrJobId: job.id, label },
        regenerate: async (b) => (await extractFrom(pdf, pages, b, undefined, scanned)).text,
      });
    } catch (e) {
      if (jobId && ac.signal.aborted) jobsRef.current = jobsRef.current.filter((j) => j.id !== jobId);
      fail(e);
    } finally {
      setWorking(null);
    }
  };

  /** Region: OCR of the drawn box, plus the PDF's own text there when it has some. */
  const runRegion = async (req: Extract<TextRequest, { kind: "region" }>) => {
    const pdf = getPdf();
    if (!pdf) return setError("The PDF is still loading. Try again in a moment.");
    const ac = (abortRef.current = new AbortController());
    setError(null);
    setWorking({ label: "Recognising text in the region", done: 0, total: 1, startedAt: Date.now() });
    try {
      const own = await regionText(pdf, req.page, req.rect);
      const ownText = (b: Build) => Promise.resolve(ocrTextToFormat(own, b.format));
      const st = status ?? (await api.ocrStatus().catch(() => null));
      if (!st?.tesseract.available) {
        if (own.trim().length >= 3) {
          return show({ text: await ownText(build), source: { kind: "region", page: req.page, from: "text" }, regenerate: ownText });
        }
        throw new Error(`OCR isn't installed, and this part of the page has no text of its own. ${st?.installHint ?? ""}`);
      }
      const png = await renderRegionPng(pdf, req.page, req.rect);
      if (ac.signal.aborted) return;
      const plain = await api.ocrImage(png);
      if (ac.signal.aborted) return;
      const ocrText = (b: Build) => Promise.resolve(ocrTextToFormat(plain, b.format));
      show({
        text: await ocrText(build),
        source: { kind: "region", page: req.page, from: "ocr" },
        regenerate: ocrText,
        alternative: own.trim().length >= 3 ? { from: "text", regenerate: ownText } : undefined,
      });
    } catch (e) {
      fail(e);
    } finally {
      setWorking(null);
    }
  };

  // A region starts right away (and is cancelled if the dialog goes away); pages wait for the user's choices.
  useEffect(() => {
    if (request.kind !== "region") return;
    void runRegion(request);
    return () => abortRef.current?.abort();
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Starts reading the chosen pages (or `pick`, e.g. a bookmark double-clicked before its choice is shown). */
  const start = (pick?: { pages: number[]; label?: string }) => {
    const { pages, label: l } = pick ?? { pages: pagesToRead, label };
    if (!pages.length) return setError(mode === "bookmark" ? "Choose a bookmark first." : "Choose some pages first.");
    return method === "ocr" ? runOcr(pages, pages, l) : runText(pages, l);
  };

  // A shortcut can open the dialog and start straight away. Started on a timer the effect's cleanup
  // cancels, so React's development double-mount doesn't start (and then abandon) a second OCR job.
  useEffect(() => {
    if (!preset?.auto) return;
    const t = setTimeout(() => void start(), 0);
    return () => {
      clearTimeout(t);
      abortRef.current?.abort();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (preset?.auto) return;
    if (preset?.mode === "range") requestAnimationFrame(() => fromRef.current?.focus());
    if (preset?.mode === "bookmark") requestAnimationFrame(() => findRef.current?.focus());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pickMode = (m: PageMode) => {
    if (m === "bookmark" && !ordered.length) return;
    setMode(m);
    if (m === "range") requestAnimationFrame(() => fromRef.current?.focus());
    if (m === "bookmark") requestAnimationFrame(() => findRef.current?.focus());
  };

  // ---- Result actions ----------------------------------------------------------------------
  const src = result?.source;
  const scopeForNote = (): Pick<ResourceInput, "scope" | "pageStart" | "pageEnd"> => {
    if (!src || src.kind === "region") return { scope: "page", pageStart: src?.page ?? page, pageEnd: src?.page ?? page };
    const pages = src.pages;
    if (pages.length === pageCount && pageCount > 1) return { scope: "document", pageStart: null, pageEnd: null };
    if (pages.length === 1) return { scope: "page", pageStart: pages[0], pageEnd: pages[0] };
    return { scope: "range", pageStart: pages[0], pageEnd: pages[pages.length - 1] };
  };
  const titleSuffix = !src
    ? ""
    : src.kind === "region"
      ? `page ${src.page} (region)`
      : src.label
        ? `${src.label} (${describePages(src.pages, pageCount)})`
        : describePages(src.pages, pageCount);
  const fileBase = `${doc.title} - ${titleSuffix}`.replace(/[\\/:*?"<>|]+/g, " ").trim();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone((d) => ({ ...d, copied: true }));
    } catch {
      setError("The browser didn't allow copying. Select the text and press Ctrl+C instead.");
    }
  };
  const download = (ext: "md" | "txt") => {
    const url = URL.createObjectURL(new Blob([text], { type: ext === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileBase}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const saveNote = async () => {
    try {
      await onSaveNote({ type: "note", ...scopeForNote(), title: `${doc.title} — ${titleSuffix}`, content: text, url: null });
      setDone((d) => ({ ...d, saved: true }));
    } catch (e) {
      fail(e);
    }
  };
  const apply = async () => {
    if (!src || src.kind !== "pages" || !src.ocrJobId) return;
    const ok = await onApplyOcr(src.ocrJobId, src.pages);
    if (ok) {
      jobsRef.current = jobsRef.current.map((j) => (j.id === src.ocrJobId ? { ...j, applied: true } : j));
      setDone((d) => ({ ...d, applied: true }));
    }
    setConfirmApply(false);
  };
  const regenerate = async (b: Build) => {
    if (!result) return;
    try {
      const t = await result.regenerate(b);
      setText(t);
      setResult({ ...result, text: t });
    } catch (e) {
      fail(e);
    }
  };
  const changeFormat = (f: TextFormat) => {
    setFormat(f);
    void regenerate({ ...build, format: f });
  };
  const changeMarks = (m: boolean) => {
    setMarks(m);
    void regenerate({ ...build, marks: m });
  };
  const changeNotes = (n: boolean) => {
    setWithNotes(n);
    void regenerate({ ...build, notes: n });
  };
  const switchRegionSource = async () => {
    if (!result?.alternative || result.source.kind !== "region") return;
    const alt = result.alternative;
    const back = { from: result.source.from, regenerate: result.regenerate };
    const t = await alt.regenerate(build);
    show({ text: t, source: { ...result.source, from: alt.from }, regenerate: alt.regenerate, alternative: back });
  };

  const ocrAvailable = !!status?.ocrmypdf.available;

  // ---- Keys (see "In the Get text window" in lib/shortcuts.ts) ------------------------------
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keysRef.current = (e: KeyboardEvent) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey || working) return;
    const is = (id: ShortcutId) => matches(e, id);
    const onButton = document.activeElement instanceof HTMLButtonElement; // Enter there clicks the button itself
    let handled = true;
    if (result && src) {
      if (is("gtCopy")) void copy();
      else if (is("gtNote")) {
        if (text.trim() && text.length <= NOTE_LIMIT && !done.saved) void saveNote();
      } else if (is("gtDownload")) download(format === "markdown" ? "md" : "txt");
      else if (is("gtFormat")) changeFormat(format === "markdown" ? "text" : "markdown");
      else if (is("gtMarks") && src.kind === "pages") changeMarks(!marks);
      else if (is("gtNotes") && src.kind === "pages") changeNotes(!withNotes);
      else if (is("gtView")) setView((v) => (v === "preview" ? "raw" : "preview"));
      else if (is("gtBack") && request.kind === "pages") setResult(null);
      else if (is("gtApply") && src.kind === "pages" && src.ocrJobId && !done.applied) {
        if (confirmApply) void apply();
        else setConfirmApply(true);
      } else if (e.key === "Enter" && confirmApply && !onButton) void apply();
      else handled = false;
    } else if (request.kind === "pages") {
      if (is("gtThis")) pickMode("this");
      else if (is("gtRange")) pickMode("range");
      else if (is("gtAll")) pickMode("all");
      else if (is("gtBookmark")) pickMode("bookmark");
      else if (is("gtText")) setMethod("text");
      else if (is("gtOcr")) setMethod("ocr");
      else if (is("gtFormat")) setFormat((f) => (f === "markdown" ? "text" : "markdown"));
      else if (is("gtMarks")) setMarks(!marks);
      else if (is("gtNotes")) setWithNotes(!withNotes);
      else if (is("gtStart") && !onButton) {
        if (!(method === "ocr" && !ocrAvailable)) void start();
      } else handled = false;
    } else handled = false;
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const installNote = (
    <div className="rounded-md bg-subtle px-3 py-2 text-xs leading-relaxed text-ink-2">
      OCR isn't installed. Install it once in a terminal:
      <code className="mt-1 block select-all rounded bg-panel px-2 py-1 font-mono text-[11px] text-ink">sudo apt install ocrmypdf tesseract-ocr</code>
      Other languages: add e.g. <code>tesseract-ocr-ben</code> and set <code>STUDYSPACE_OCR_LANG=eng+ben</code> in <code>.env</code>. Then try again; no restart needed.
    </div>
  );

  // ---- Rendering ------------------------------------------------------------------------------
  const elapsed = working ? Math.round((Date.now() - working.startedAt) / 1000) : 0;
  const title = request.kind === "region" ? `Text from a region of page ${request.page}` : "Get text / OCR pages";

  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (working) {
    body = (
      <div className="py-6 text-center">
        <Loader2 className="mx-auto size-6 animate-spin text-accent" />
        <p className="mt-3 text-sm font-medium text-ink">{working.label}…</p>
        {working.total > 1 && (
          <div className="mx-auto mt-3 h-1.5 w-64 overflow-hidden rounded-full bg-subtle">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.round((working.done / working.total) * 100)}%` }} />
          </div>
        )}
        <p className="mt-2 text-xs text-ink-3">
          {working.total > 1 ? `${working.done} / ${working.total} pages · ` : ""}
          {elapsed}s
        </p>
        <p className="mt-3 text-[11px] text-ink-3">Your PDF isn't changed while this runs.</p>
      </div>
    );
    footer = (
      <Button variant="ghost" onClick={() => (abortRef.current?.abort(), setWorking(null))}>
        Cancel
      </Button>
    );
  } else if (result && src) {
    const tooBig = text.length > NOTE_LIMIT;
    const notesIn = src.kind === "pages" && withNotes ? notesForText(notes, src.pages, pageCount, format).count : 0;
    const preview = text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}\n\n*… preview cut here; the full text is in Raw, and in Copy / Download / Save.*` : text;
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-3">
            {src.kind === "region"
              ? `Read with ${src.from === "ocr" ? "OCR" : "the PDF's own text"}`
              : `${src.ocrJobId ? "OCR" : "PDF text"} · ${src.label ? `“${src.label}”, ` : ""}${describePages(src.pages, pageCount)}`}{" "}
            · {text.length.toLocaleString()} characters
            {src.kind === "pages" && marks ? ` · ${markedCount(text)} highlighted passage${markedCount(text) === 1 ? "" : "s"} marked` : ""}
            {src.kind === "pages" && withNotes ? ` · ${notesIn} note${notesIn === 1 ? "" : "s"} included` : ""}
          </span>
          {src.kind === "pages" && (
            <>
              <button
                className={cx("ml-auto flex items-center gap-1 rounded-md border px-2 py-0.5", marks ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:bg-hover")}
                onClick={() => changeMarks(!marks)}
                aria-pressed={marks}
                title="Mark the text you highlighted in the PDF as ==text== (H)"
              >
                <Highlighter className="size-3.5" /> {marks ? "Highlights marked" : "Highlights not marked"} <KeyHint id="gtMarks" />
              </button>
              <button
                className={cx("flex items-center gap-1 rounded-md border px-2 py-0.5", withNotes ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:bg-hover")}
                onClick={() => changeNotes(!withNotes)}
                aria-pressed={withNotes}
                title="Put your notes for these pages in the text, after the pages they're for (I)"
              >
                <NotebookText className="size-3.5" /> {withNotes ? "Notes included" : "Notes left out"} <KeyHint id="gtNotes" />
              </button>
            </>
          )}
          <div className={cx("flex items-center rounded-md border border-line p-0.5", src.kind !== "pages" && "ml-auto")}>
            {(["markdown", "text"] as const).map((f) => (
              <button key={f} className={cx("rounded px-2 py-0.5", format === f ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-hover")} onClick={() => void changeFormat(f)}>
                {f === "markdown" ? "Markdown" : "Plain text"}
              </button>
            ))}
            <KeyHint id="gtFormat" className="mx-1" />
          </div>
          <div className="flex items-center rounded-md border border-line p-0.5">
            {(["preview", "raw"] as const).map((v) => (
              <button key={v} className={cx("rounded px-2 py-0.5", view === v ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-hover")} onClick={() => setView(v)}>
                {v === "preview" ? "Preview" : "Raw / edit"}
              </button>
            ))}
            <KeyHint id="gtView" className="mx-1" />
          </div>
        </div>

        {src.kind === "region" && result.alternative && (
          <p className="text-xs text-ink-3">
            This part of the page also has {result.alternative.from === "text" ? "its own text" : "an image OCR can read"}.{" "}
            <button className="font-medium text-accent hover:underline" onClick={() => void switchRegionSource()}>
              Use {result.alternative.from === "text" ? "the PDF's text" : "OCR"} instead
            </button>
          </p>
        )}

        {view === "raw" || format === "text" ? (
          <textarea
            className="ss-scroll h-[45vh] w-full resize-y rounded-md border border-line bg-panel p-2.5 font-mono text-xs leading-relaxed outline-none focus:border-accent"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <div className="ss-scroll h-[45vh] overflow-y-auto rounded-md border border-line p-3">
            {text.trim() ? <Markdown>{preview}</Markdown> : <p className="text-sm text-ink-3">No text found.</p>}
          </div>
        )}

        {src.kind === "pages" && src.emptyPages.length > 0 && (
          <div className="flex gap-2 rounded-md bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1">
              {src.emptyPages.length === src.pages.length ? "These pages are" : `${src.emptyPages.length} of these pages are`} scanned images with no text
              {src.ocrJobId ? ", and OCR found no text on them either (handwriting or a picture?)." : "."}
              {!src.ocrJobId &&
                (ocrAvailable ? (
                  <Button size="sm" variant="secondary" className="ml-2" onClick={() => void runOcr(src.pages, src.emptyPages, src.label)}>
                    <ScanText className="size-3.5" /> Run OCR on {src.emptyPages.length === 1 ? "it" : `these ${src.emptyPages.length}`}
                  </Button>
                ) : (
                  <div className="mt-2 text-ink-2">{installNote}</div>
                ))}
            </div>
          </div>
        )}

        {src.kind === "pages" && src.ocrJobId && !done.applied && (
          <div className="rounded-md border border-line px-3 py-2 text-xs leading-relaxed text-ink-2">
            {confirmApply ? (
              <>
                <p className="font-medium text-ink">Add the recognised text to the PDF file?</p>
                <p className="mt-1">
                  This saves an invisible text layer into {describePages(src.pages, pageCount)} of the original PDF, so the text can be selected, highlighted and searched,
                  here and in other PDF readers. The pages look exactly the same. Undo with Ctrl+Z.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => void apply()} autoFocus>
                    Add text layer <KeyHint id="gtStart" className="border-white/40 bg-white/10 text-white/80" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmApply(false)}>
                    Not now
                  </Button>
                </div>
              </>
            ) : (
              <>
                The PDF itself is unchanged. You can{" "}
                <button className="font-medium text-accent hover:underline" onClick={() => setConfirmApply(true)}>
                  add this text to the PDF
                </button>{" "}
                <KeyHint id="gtApply" />{" "}
                to make these pages selectable and searchable.
              </>
            )}
          </div>
        )}
        {done.applied && (
          <p className="flex items-center gap-1.5 text-xs text-ink-2">
            <Check className="size-3.5 text-accent" /> Text layer added to the PDF (Ctrl+Z to undo).
          </p>
        )}
        {text.length > NOTE_SLOW && !tooBig && (
          <p className="text-[11px] text-ink-3">This is long for a note: it will be slow to show in the notes panel. Consider saving a smaller page range, or downloading it.</p>
        )}
        <p className="text-[11px] text-ink-3">Formulas can't be recovered as LaTeX: they come out as plain characters. OCR of handwriting is often poor.</p>
      </div>
    );
    footer = (
      <>
        {request.kind === "pages" && (
          <Button variant="ghost" className="mr-auto" onClick={() => setResult(null)}>
            Back <KeyHint id="gtBack" />
          </Button>
        )}
        <Button variant="secondary" onClick={() => void copy()} disabled={!text}>
          {done.copied ? <Check className="size-4" /> : <Copy className="size-4" />} {done.copied ? "Copied" : "Copy"} <KeyHint id="gtCopy" />
        </Button>
        <Button variant="secondary" onClick={() => download(format === "markdown" ? "md" : "txt")} disabled={!text}>
          <Download className="size-4" /> Download .{format === "markdown" ? "md" : "txt"} <KeyHint id="gtDownload" />
        </Button>
        <Button variant="primary" onClick={() => void saveNote()} disabled={!text.trim() || tooBig || done.saved} title={tooBig ? "Too long for one note: choose fewer pages" : undefined}>
          {done.saved ? <Check className="size-4" /> : <StickyNote className="size-4" />} {done.saved ? "Saved as note" : "Save as note"}{" "}
          <KeyHint id="gtNote" className="border-white/40 bg-white/10 text-white/80" />
        </Button>
      </>
    );
  } else if (request.kind === "region") {
    body = error ? null : <p className="py-6 text-center text-sm text-ink-3">Starting…</p>;
    footer = <Button variant="ghost" onClick={onClose}>Close</Button>;
  } else {
    body = (
      <div className="space-y-4 text-sm">
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-2">Pages</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {(
              [
                ["this", `This page (${page})`, "gtThis"],
                ["range", "Pages", "gtRange"],
                ["all", `Whole PDF (${pageCount})`, "gtAll"],
                ["bookmark", "A bookmark's section", "gtBookmark"],
              ] as const
            ).map(([id, text, key]) => (
              <label
                key={id}
                className={cx("flex items-center gap-1.5", id === "bookmark" && !ordered.length ? "cursor-not-allowed opacity-50" : "cursor-pointer")}
                title={id === "bookmark" && !ordered.length ? "This PDF has no bookmarks" : undefined}
              >
                <input type="radio" name="pages" checked={mode === id} disabled={id === "bookmark" && !ordered.length} onChange={() => pickMode(id)} />
                {text} <KeyHint id={key} />
              </label>
            ))}
            {mode === "range" && (
              <span className="flex items-center gap-1.5 text-xs text-ink-2">
                <NumberInput
                  ref={fromRef}
                  aria-label="From page"
                  data-shortcut-letters
                  min={1}
                  max={pageCount}
                  className={cx(inputCls, "h-7 w-16")}
                  value={from}
                  onChange={setFrom}
                  onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), void start())}
                />
                to
                <NumberInput
                  aria-label="To page"
                  data-shortcut-letters
                  min={1}
                  max={pageCount}
                  className={cx(inputCls, "h-7 w-16")}
                  value={to}
                  onChange={setTo}
                  onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur(), void start())}
                />
              </span>
            )}
          </div>
          {mode === "bookmark" && (
            <BookmarkPicker
              inputRef={findRef}
              ordered={ordered}
              sections={sections}
              value={bookmarkId}
              onChange={setBookmarkId}
              onStart={(id) => {
                const r = sections.get(id);
                if (r) void start({ pages: pagesBetween(r.start, r.end), label: ordered.find((b) => b.id === id)?.title });
              }}
              withInside={withInside}
              onWithInside={chosenBookmark?.children.length ? setWithInside : undefined}
            />
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-ink-2">How</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["text", "Use the PDF's text", "Instant and exact, for PDFs made on a computer (slides, books). Scanned pages are reported so you can OCR them.", "gtText"],
                ["ocr", "Run OCR", "Reads scanned pages as images. Takes a few seconds per page. The PDF isn't changed unless you choose to add the text to it afterwards.", "gtOcr"],
              ] as const
            ).map(([id, label, hint, key]) => (
              <label key={id} className={cx("flex cursor-pointer gap-2 rounded-lg border p-2.5", method === id ? "border-accent bg-accent-soft" : "border-line hover:bg-hover")}>
                <input type="radio" name="method" className="mt-0.5" checked={method === id} onChange={() => setMethod(id)} />
                <span>
                  <span className="flex items-center gap-1.5 font-medium text-ink">
                    {label} <KeyHint id={key} />
                  </span>
                  <span className="block text-xs text-ink-3">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          {method === "ocr" && status && !ocrAvailable && <div className="mt-2">{installNote}</div>}
          {method === "ocr" && ocrAvailable && (
            <p className="mt-1.5 text-[11px] text-ink-3">
              Language: {status?.language}. Text already in the PDF is kept; only what's in the page images is read.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-2">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="format" checked={format === "markdown"} onChange={() => setFormat("markdown")} /> Markdown
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="format" checked={format === "text"} onChange={() => setFormat("text")} /> Plain text
          </label>
          <KeyHint id="gtFormat" />
          <span className="w-px bg-line" />
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={pageMarkers} onChange={(e) => setPageMarkers(e.target.checked)} /> Page markers
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={dropRepeated} onChange={(e) => setDropRepeated(e.target.checked)} /> Skip repeated headers/footers
          </label>
        </div>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2.5 text-xs text-ink-2">
          <input type="checkbox" className="mt-0.5" checked={marks} onChange={(e) => setMarks(e.target.checked)} />
          <span>
            <span className="flex items-center gap-1.5 font-medium text-ink">
              <Highlighter className="size-3.5" /> Mark my highlights <KeyHint id="gtMarks" />
            </span>
            Text you highlighted in this PDF (in StudySpace or another reader) comes out as <code>==highlighted text==</code>, shown highlighted in notes.
            Untick for the text without marks.
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-2.5 text-xs text-ink-2">
          <input type="checkbox" className="mt-0.5" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} />
          <span>
            <span className="flex items-center gap-1.5 font-medium text-ink">
              <NotebookText className="size-3.5" /> Include my notes <KeyHint id="gtNotes" />
            </span>
            Your notes for these pages (from the notes panel) go in as quotes, each after the last page it's for. Notes for the whole PDF go at the end
            when you read the whole PDF.
            {withNotes && ` Notes for these pages: ${notesForText(notes, pagesToRead, pageCount, format).count}.`}
          </span>
        </label>
      </div>
    );
    footer = (
      <>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void start()} disabled={method === "ocr" && !ocrAvailable} autoFocus={!!preset && preset.mode !== "range" && preset.mode !== "bookmark"}>
          {method === "ocr" ? <ScanText className="size-4" /> : <FileText className="size-4" />}
          {method === "ocr" ? "Run OCR" : "Get text"} <KeyHint id="gtStart" className="border-white/40 bg-white/10 text-white/80" />
        </Button>
      </>
    );
  }

  return (
    <Modal wide title={title} onClose={onClose} footer={footer}>
      {error && (
        <p className="mb-3 flex gap-2 rounded-md bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">{error}</span>
        </p>
      )}
      {body}
    </Modal>
  );
}

/** Finds and picks a bookmark: type to filter, ↑ / ↓ to move, Enter (or a double-click) to start. */
function BookmarkPicker(p: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  ordered: BookmarkTreeNode[];
  sections: Map<string, { start: number; end: number }>;
  value: string | null;
  onChange: (id: string) => void;
  onStart: (id: string) => void;
  withInside: boolean;
  /** Only offered when the chosen bookmark has bookmarks inside it. */
  onWithInside?: (v: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? p.ordered.filter((b) => b.title.toLowerCase().includes(q)) : p.ordered), [q, p.ordered]);

  // Keep the chosen one in view (it starts as the bookmark you're reading in).
  useEffect(() => {
    listRef.current?.querySelector(`[data-bm="${p.value}"]`)?.scrollIntoView({ block: "nearest" });
  }, [p.value, shown]);

  const moveBy = (d: number) => {
    if (!shown.length) return;
    const i = shown.findIndex((b) => b.id === p.value);
    const j = i < 0 ? (d > 0 ? 0 : shown.length - 1) : Math.max(0, Math.min(shown.length - 1, i + d));
    p.onChange(shown[j].id);
  };
  const range = (id: string) => {
    const r = p.sections.get(id);
    return !r ? "" : r.start === r.end ? `p. ${r.start}` : `pp. ${r.start}–${r.end}`;
  };

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-line" data-arrow-nav="off">
      <input
        ref={p.inputRef}
        aria-label="Find a bookmark"
        className="h-8 w-full border-b border-line bg-transparent px-2.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent"
        placeholder="Find a bookmark… (↑ / ↓ to pick, Enter to start)"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          const t = e.target.value.trim().toLowerCase();
          const first = t ? p.ordered.find((b) => b.title.toLowerCase().includes(t)) : null;
          if (first) p.onChange(first.id);
        }}
        onKeyDown={(e) => {
          const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[e.key];
          if (step) moveBy(step);
          else if (e.key === "Enter" && p.value) p.onStart(p.value);
          else if (e.key === "Escape" && query) setQuery("");
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      <div ref={listRef} role="listbox" aria-label="Bookmarks" className="ss-scroll max-h-52 overflow-y-auto p-1">
        {shown.map((b) => (
          <button
            key={b.id}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={b.id === p.value}
            data-bm={b.id}
            className={cx(
              "flex w-full items-center gap-2 rounded py-1 pr-2 text-left text-[13px]",
              b.id === p.value ? "bg-accent-soft font-medium text-accent" : "text-ink hover:bg-hover",
            )}
            style={{ paddingLeft: 8 + (q ? 0 : Math.min(b.depth, 6) * 14) }}
            onClick={() => p.onChange(b.id)}
            onDoubleClick={() => p.onStart(b.id)}
          >
            <BookmarkIcon className="size-3 shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1 truncate">{b.title}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-ink-3">{range(b.id)}</span>
          </button>
        ))}
        {!shown.length && <p className="px-2 py-3 text-center text-xs text-ink-3">No bookmark matches “{query.trim()}”.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-2.5 py-1.5 text-[11px] text-ink-3">
        <span>From the bookmark's page up to where the next bookmark starts.</span>
        {p.onWithInside && (
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-ink-2">
            <input type="checkbox" checked={p.withInside} onChange={(e) => p.onWithInside!(e.target.checked)} />
            Include the bookmarks inside it (whole chapter)
          </label>
        )}
      </div>
    </div>
  );
}
