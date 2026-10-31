import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, FileCode2, FileText, FileType2, Highlighter, Images, Loader2, NotebookText, Presentation, StickyNote, X } from "lucide-react";
import { api } from "../lib/api";
import { openPdf, type PDFDocumentProxy } from "../lib/pdf";
import { downloadBlob } from "../lib/pageImage";
import { PICTURE_DPIS, loadPicturePrefs, makePictures, mbPerPage, safeName, savePicturePrefs, type PictureFormat } from "../lib/pictures";
import { extractPages, type TextFormat } from "../lib/pdfToMarkdown";
import { notesForText } from "../lib/notesText";
import { fetchNoteImages, notesZip } from "../lib/notesZip";
import { isTyping, matches, type ShortcutId } from "../lib/shortcuts";
import { isPaged, type DocumentRecord, type NormRect } from "../lib/types";
import { Button, KeyHint, Modal, cx } from "./ui";

interface Props {
  /** The files selected in the library (pictures and text only for those with pages). */
  docs: DocumentRecord[];
  onClose: () => void;
}

type What = "pictures" | "text" | "notes";
const WHATS: What[] = ["pictures", "text", "notes"];
const WHAT_LABEL: Record<What, string> = { pictures: "Pictures", text: "Text", notes: "Notes" };

interface Job {
  state: "waiting" | "working" | "done" | "failed";
  done: number;
  total: number;
  message?: string;
}

interface PictureChoice {
  format: PictureFormat;
  dpi: number;
}
interface TextChoice {
  format: TextFormat;
  marks: boolean;
  notes: boolean;
}

/** A download waiting its turn, with the choices made when it was asked for. */
interface Queued {
  key: string;
  doc: DocumentRecord;
  what: What;
  pictures: PictureChoice;
  text: TextChoice;
  ac: AbortController;
}

const jobKey = (docId: string, what: What) => `${docId}:${what}`;
const allPages = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const cancelled = () => new DOMException("Cancelled", "AbortError");

/** The same on/off choices as the Get text window (shared keys in localStorage). */
function remembered(key: string, initial: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? initial : v === "1";
  } catch {
    return initial;
  }
}
function remember(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
}

/** Opens a library file's PDF (slides are converted on the server first). */
async function openFile(doc: DocumentRecord, signal: AbortSignal): Promise<{ pdf: PDFDocumentProxy; close: () => void }> {
  if (doc.kind === "slides") await api.convert(doc.id);
  if (signal.aborted) throw cancelled();
  const task = openPdf(api.fileUrl(doc));
  const close = () => void task.destroy();
  try {
    return { pdf: await task.promise, close };
  } catch (e) {
    close();
    throw e;
  }
}

/** The whole file as text, like the Get text window's "whole PDF" (PDF text, not OCR). */
async function fileText(pdf: PDFDocumentProxy, doc: DocumentRecord, c: TextChoice, onProgress: (done: number, total: number) => void, signal: AbortSignal) {
  const pages = allPages(pdf.numPages);
  const [annotations, notes] = await Promise.all([c.marks ? api.annotations(doc.id) : [], c.notes ? api.resources(doc.id) : []]);
  const highlights = new Map<number, NormRect[]>();
  for (const a of annotations) if (a.kind === "highlight" || a.kind === "area") highlights.set(a.page, [...(highlights.get(a.page) ?? []), ...a.rects]);
  const n = c.notes ? notesForText(notes, pages, pdf.numPages, c.format) : null;
  const r = await extractPages(
    pdf,
    pages,
    { format: c.format, pageMarkers: pages.length > 1, dropRepeated: true, highlights: c.marks ? highlights : null, afterPage: n?.afterPage },
    onProgress,
    signal,
  );
  return { text: n?.whole ? `${r.text.trimEnd()}\n\n${n.whole}\n` : r.text, emptyPages: r.emptyPages.length, pages: pages.length };
}

/**
 * Pictures, text and notes of several library files, from one window: each file has its own buttons, and
 * downloads asked for while another runs wait their turn (one file is open at a time).
 */
export function SelectedFilesDialog({ docs, onClose }: Props) {
  const prefs = useRef(loadPicturePrefs());
  const [picFormat, setPicFormat] = useState<PictureFormat>(prefs.current.format);
  const [dpi, setDpi] = useState(prefs.current.dpi);
  const [textFormat, setTextFormat] = useState<TextFormat>("markdown");
  const [marks, setMarksState] = useState(() => remembered("ss-text-marks", true));
  const [withNotes, setNotesState] = useState(() => remembered("ss-text-notes", false));
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [cur, setCur] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const queueRef = useRef<Queued[]>([]);
  const runningRef = useRef<Queued | null>(null);

  useEffect(() => savePicturePrefs({ format: picFormat, dpi }), [picFormat, dpi]);
  const setMarks = (v: boolean) => (setMarksState(v), remember("ss-text-marks", v));
  const setWithNotes = (v: boolean) => (setNotesState(v), remember("ss-text-notes", v));

  // Closing the window stops what's running and drops what's waiting.
  useEffect(
    () => () => {
      for (const q of queueRef.current) q.ac.abort();
      queueRef.current = [];
      runningRef.current?.ac.abort();
    },
    [],
  );

  // Take the focus from the files list behind, whose own keys (↓, Esc, Del) would act there.
  useEffect(() => listRef.current?.focus(), []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${cur}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cur]);

  const setJob = (key: string, job: Job | null) =>
    setJobs((j) => {
      const n = { ...j };
      if (job) n[key] = job;
      else delete n[key];
      return n;
    });

  const run = async (q: Queued) => {
    const { doc, what, ac } = q;
    const progress = (done: number, total: number) => !ac.signal.aborted && setJob(q.key, { state: "working", done, total });
    setJob(q.key, { state: "working", done: 0, total: doc.pageCount ?? 0 });
    let close: (() => void) | undefined;
    try {
      // Notes need no PDF: they're StudySpace's own, one .md each.
      if (what === "notes") {
        const notes = await api.resources(doc.id);
        const r = notesZip(doc.title, notes, await fetchNoteImages(notes));
        if (ac.signal.aborted) throw cancelled();
        if (!r) throw new Error("This file has no notes yet.");
        downloadBlob(r.blob, r.name);
        return setJob(q.key, { state: "done", done: r.count, total: r.count, message: `Saved ${r.count} note${r.count === 1 ? "" : "s"} (.md files in a .zip)` });
      }
      const opened = await openFile(doc, ac.signal);
      close = opened.close;
      const { pdf } = opened;
      if (ac.signal.aborted) throw cancelled();
      const pages = allPages(pdf.numPages);
      if (what === "pictures") {
        const { blob, name } = await makePictures(pdf, pages, { ...q.pictures, base: doc.title }, progress, ac.signal);
        if (ac.signal.aborted) throw cancelled();
        downloadBlob(blob, name);
        setJob(q.key, { state: "done", done: pages.length, total: pages.length, message: pages.length === 1 ? "Saved the picture" : `Saved ${pages.length} pictures (.zip)` });
      } else {
        const r = await fileText(pdf, doc, q.text, progress, ac.signal);
        if (ac.signal.aborted) throw cancelled();
        if (!r.text.trim()) throw new Error("No text: its pages are scanned images. Open it and OCR it (Shift+W).");
        const ext = q.text.format === "markdown" ? "md" : "txt";
        downloadBlob(new Blob([r.text], { type: ext === "md" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8" }), `${safeName(`${doc.title} - whole PDF`)}.${ext}`);
        const scanned = r.emptyPages ? ` · ${r.emptyPages} of ${r.pages} pages are scanned (no text; OCR them from the file)` : "";
        setJob(q.key, { state: "done", done: r.pages, total: r.pages, message: `Saved the text (.${ext})${scanned}` });
      }
    } catch (e) {
      if ((e as Error)?.name === "AbortError") setJob(q.key, null);
      else setJob(q.key, { state: "failed", done: 0, total: 0, message: (e as Error)?.message ?? String(e) });
    } finally {
      close?.();
    }
  };

  const pump = async () => {
    if (runningRef.current) return;
    for (let q = queueRef.current.shift(); q; q = queueRef.current.shift()) {
      runningRef.current = q;
      await run(q);
      runningRef.current = null;
    }
  };

  const busy = (key: string) => runningRef.current?.key === key || queueRef.current.some((q) => q.key === key);

  const ask = (doc: DocumentRecord, what: What) => {
    const key = jobKey(doc.id, what);
    if (doc.missing || busy(key) || (what !== "notes" && !isPaged(doc.kind))) return;
    queueRef.current.push({ key, doc, what, pictures: { format: picFormat, dpi }, text: { format: textFormat, marks, notes: withNotes }, ac: new AbortController() });
    setJob(key, { state: "waiting", done: 0, total: 0 });
    void pump();
  };

  const cancel = (doc: DocumentRecord) => {
    for (const what of WHATS) {
      const key = jobKey(doc.id, what);
      const waiting = queueRef.current.find((q) => q.key === key);
      if (waiting) {
        waiting.ac.abort();
        queueRef.current = queueRef.current.filter((q) => q !== waiting);
        setJob(key, null);
      }
      if (runningRef.current?.key === key) runningRef.current.ac.abort();
    }
  };

  const active = Object.values(jobs).filter((j) => j.state === "waiting" || j.state === "working").length;

  // ---- Keys (see "In the selected-files window" in lib/shortcuts.ts) ---------------------------
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keysRef.current = (e: KeyboardEvent) => {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const is = (id: ShortcutId) => matches(e, id);
    const doc = docs[cur];
    let handled = true;
    if (e.key === "ArrowDown") setCur((c) => Math.min(docs.length - 1, c + 1));
    else if (e.key === "ArrowUp") setCur((c) => Math.max(0, c - 1));
    else if (is("sfPictures") && doc) ask(doc, "pictures");
    else if (is("sfText") && doc) ask(doc, "text");
    else if (is("sfNoteFiles") && doc) ask(doc, "notes");
    else if (is("sfCancel") && doc) cancel(doc);
    else if (is("sfPicFormat")) setPicFormat((f) => (f === "png" ? "jpeg" : "png"));
    else if (is("sfPicQuality")) setDpi((d) => PICTURE_DPIS[(PICTURE_DPIS.indexOf(d) + 1) % PICTURE_DPIS.length]);
    else if (is("sfTextFormat")) setTextFormat((f) => (f === "markdown" ? "text" : "markdown"));
    else if (is("sfMarks")) setMarks(!marks);
    else if (is("sfNotes")) setWithNotes(!withNotes);
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
      className={cx("rounded px-2 py-0.5", current === value ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-hover")}
      onClick={() => set(value)}
      aria-pressed={current === value}
    >
      {label}
    </button>
  );
  const toggle = (on: boolean, set: (v: boolean) => void, icon: React.ReactNode, onLabel: string, offLabel: string, id: ShortcutId) => (
    <button
      className={cx("flex items-center gap-1 rounded-md border px-2 py-0.5", on ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-2 hover:bg-hover")}
      onClick={() => set(!on)}
      aria-pressed={on}
    >
      {icon} {on ? onLabel : offLabel} <KeyHint id={id} />
    </button>
  );

  const jobLine = (what: What, j: Job | undefined) => {
    if (!j) return null;
    const label = WHAT_LABEL[what];
    if (j.state === "waiting") return <span className="block text-ink-3">{label}: waiting…</span>;
    if (j.state === "working")
      return (
        <span className="flex items-center gap-1.5 text-ink-2">
          <Loader2 className="size-3 animate-spin text-accent" /> {label}:{" "}
          {j.done ? `${j.done} / ${j.total} pages` : "opening…"}
          {j.total > 0 && (
            <span className="h-1 w-20 overflow-hidden rounded-full bg-subtle">
              <span className="block h-full bg-accent transition-all" style={{ width: `${Math.round((j.done / j.total) * 100)}%` }} />
            </span>
          )}
        </span>
      );
    if (j.state === "done")
      return (
        <span className="flex items-center gap-1 text-ink-2">
          <Check className="size-3 shrink-0 text-accent" /> {j.message}
        </span>
      );
    return (
      <span className="flex items-start gap-1 text-danger">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {label}: {j.message}
      </span>
    );
  };

  return (
    <Modal
      title={`Selected files (${docs.length})`}
      wide
      onClose={onClose}
      footer={
        <>
          <p className="mr-auto self-center text-[11px] text-ink-3">
            {active ? `${active} download${active === 1 ? "" : "s"} still to finish: closing cancels ${active === 1 ? "it" : "them"}.` : "Each download is the whole file. Your files aren't changed."}
          </p>
          <Button variant="ghost" onClick={onClose}>
            Close <KeyHint id="close" />
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="text-ink-2">Pictures</span>
            <span className="flex rounded-md border border-line p-0.5">
              {choice<PictureFormat>("png", picFormat, setPicFormat, "PNG")}
              {choice<PictureFormat>("jpeg", picFormat, setPicFormat, "JPEG")}
            </span>
            <KeyHint id="sfPicFormat" />
            <span className="flex rounded-md border border-line p-0.5">{PICTURE_DPIS.map((d) => choice(d, dpi, setDpi, `${d} dpi`))}</span>
            <KeyHint id="sfPicQuality" />
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-2">Text</span>
            <span className="flex rounded-md border border-line p-0.5">
              {choice<TextFormat>("markdown", textFormat, setTextFormat, "Markdown")}
              {choice<TextFormat>("text", textFormat, setTextFormat, "Plain text")}
            </span>
            <KeyHint id="sfTextFormat" />
            {toggle(marks, setMarks, <Highlighter className="size-3.5" />, "Highlights marked", "Highlights not marked", "sfMarks")}
            {toggle(withNotes, setWithNotes, <NotebookText className="size-3.5" />, "Notes included", "Notes left out", "sfNotes")}
          </span>
        </div>

        <ul ref={listRef} tabIndex={-1} aria-label="Selected files" className="ss-scroll outline-none max-h-[50vh] divide-y divide-line overflow-y-auto rounded-md border border-line">
          {docs.map((d, i) => {
            const rowJobs = WHATS.map((w) => [w, jobs[jobKey(d.id, w)]] as const).filter(([, j]) => j);
            const running = rowJobs.some(([, j]) => j.state === "waiting" || j.state === "working");
            const paged = isPaged(d.kind);
            const noPages = paged ? undefined : "HTML and Markdown files have no pages: only their notes";
            const mb = d.pageCount ? d.pageCount * mbPerPage(picFormat, dpi) : null;
            const here = i === cur;
            const folder = d.relPath.split("/").slice(0, -1).join(" / ");
            return (
              <li key={d.id} data-row={i} className={cx("px-3 py-2", here && "bg-accent-soft")} onMouseDown={() => setCur(i)}>
                <div className="flex flex-wrap items-center gap-2">
                  {d.kind === "slides" ? (
                    <Presentation className="size-4 shrink-0 text-warn opacity-80" />
                  ) : d.kind === "html" ? (
                    <FileCode2 className="size-4 shrink-0 text-sky-600 opacity-80 dark:text-sky-400" />
                  ) : d.kind === "markdown" ? (
                    <FileType2 className="size-4 shrink-0 text-emerald-600 opacity-80 dark:text-emerald-400" />
                  ) : (
                    <FileText className="size-4 shrink-0 opacity-70" />
                  )}
                  <div className="min-w-[12rem] flex-1 basis-0">
                    <p className={cx("truncate text-[13px]", here ? "font-medium text-ink" : "text-ink-2")} title={d.relPath}>
                      {d.title}
                    </p>
                    <p className="truncate text-[11px] text-ink-3">
                      {folder && `${folder} · `}
                      {d.missing ? "file missing" : !paged ? (d.kind === "html" ? "HTML page" : "Markdown") : d.pageCount ? `${d.pageCount} page${d.pageCount === 1 ? "" : "s"} · pictures about ${mb! < 1 ? "1" : Math.round(mb!)} MB` : d.kind === "slides" ? "slides" : "PDF"}
                    </p>
                  </div>
                  {running && (
                    <button className="grid size-6 shrink-0 place-items-center rounded text-ink-3 hover:bg-hover hover:text-ink" title="Cancel (Del)" aria-label="Cancel" onClick={() => cancel(d)}>
                      <X className="size-3.5" />
                    </button>
                  )}
                  <Button size="sm" variant="secondary" disabled={d.missing || !paged} onClick={() => (setCur(i), ask(d, "pictures"))} title={noPages ?? `Save every page as a ${picFormat.toUpperCase()} picture, in one .zip`}>
                    <Images className="size-3.5" /> Pictures {here && <KeyHint id="sfPictures" />}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={d.missing || !paged} onClick={() => (setCur(i), ask(d, "text"))} title={noPages ?? `Download the whole file's text as .${textFormat === "markdown" ? "md" : "txt"}`}>
                    <FileText className="size-3.5" /> Text {here && <KeyHint id="sfText" />}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => (setCur(i), ask(d, "notes"))} title="Download this file's notes: one .md file per note, in one .zip">
                    <StickyNote className="size-3.5" /> Notes {here && <KeyHint id="sfNoteFiles" />}
                  </Button>
                </div>
                {rowJobs.length > 0 && <div className="mt-1 space-y-0.5 pl-6 text-[11px]">{rowJobs.map(([w, j]) => <div key={w}>{jobLine(w, j)}</div>)}</div>}
                {here && mb !== null && mb > 300 && <p className="mt-1 pl-6 text-[11px] text-warn">That's a lot of pictures: choose JPEG or a lower sharpness.</p>}
              </li>
            );
          })}
        </ul>
        <p className="text-[11px] text-ink-3">
          Text comes from the PDF's own text layer, as with <KeyHint id="textAll" />; scanned pages need OCR, from the file itself. Pictures are the whole file, as with <KeyHint id="savePictures" /> → Whole PDF. Notes come as one .md file per note, in a .zip, as with <KeyHint id="downloadNotes" />.
        </p>
      </div>
    </Modal>
  );
}
