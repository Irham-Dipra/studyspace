import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, Bookmark as BookmarkIcon, ChevronRight, Crop, CircleHelp, Library, Moon, PanelLeft, PanelRight, Settings, Sun } from "lucide-react";
import { api, ApiError, setMutationListener, type AnnotationInput, type BookmarkInput, type EditResult, type ResourceInput } from "./lib/api";
import { announceChange, classifyMutation, onRemoteChange, type TabChange } from "./lib/tabSync";
import { useUndoHistory } from "./lib/undo";
import { uuid } from "./lib/uuid";
import { setNotifier } from "./lib/notify";
import {
  canEditFile,
  hasUnsavedChanges,
  isPaged,
  SLIDES_READ_ONLY,
  type Annotation,
  type AppConfigInfo,
  type Bookmark,
  type Directory,
  type DocumentRecord,
  type NoteHighlight,
  type ReadingProgress,
  type Resource,
  type TextHighlight,
} from "./lib/types";
import { buildBookmarkTree, currentBookmarkId, readOutline, type BookmarkTreeNode } from "./lib/outline";
import type { PDFDocumentProxy } from "./lib/pdf";
import type { Anchor } from "./components/NoteAnnotations";
import { LibraryPanel } from "./components/LibraryPanel";
import { BookmarksPanel, type BookmarkPatch } from "./components/BookmarksPanel";
import { ResourcePanel, type EditorRequest } from "./components/ResourcePanel";
import { PdfViewer, MAX_ZOOM, MIN_ZOOM, type PdfViewerHandle } from "./components/viewer/PdfViewer";
import { ViewerToolbar } from "./components/viewer/ViewerToolbar";
import { TextDocViewer } from "./components/viewer/TextDocViewer";
import { HIGHLIGHT_COLORS, PEN_COLORS, type Tool } from "./components/viewer/geometry";
import { StatusBar, ZOOM_STEPS } from "./components/StatusBar";
import { SearchBox } from "./components/SearchBox";
import { SettingsDialog } from "./components/SettingsDialog";
import { PageOpsDialog, type PageOp } from "./components/PageOpsDialog";
import { HelpDialog } from "./components/HelpDialog";
import { UnsavedDialog } from "./components/UnsavedDialog";
import { GetTextDialog, type TextRequest } from "./components/GetTextDialog";
import { PdfToolsDialog, type PdfTool } from "./components/PdfToolsDialog";
import { PageHalvesDialog } from "./components/PageHalvesDialog";
import { PageImagesDialog } from "./components/PageImagesDialog";
import { SnipOverlay } from "./components/SnipOverlay";
import { captureWindowRegion, type ScreenRect } from "./lib/snip";
import { COPY_QUALITY, canvasToPng, copyToClipboard, renderRegion } from "./lib/pageImage";
import { isTyping, matches, withKey, type ShortcutId } from "./lib/shortcuts";
import { ResizeHandle } from "./components/ResizeHandle";
import { IconButton, KeyHint, Toasts, cx, type ToastMsg } from "./components/ui";

function useMediaQuery(q: string) {
  const [match, setMatch] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [q]);
  return match;
}

function useWindowWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/** Resizable side-panel widths in px (desktop layout). */
const PANEL = {
  left: { default: 288, min: 200, max: 560 },
  right: { default: 380, min: 280, max: 760 },
};
/** The PDF viewer never gets narrower than this when panels are dragged wider. */
const CENTER_MIN = 360;

function usePersistentState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* storage unavailable */
    }
  }, [key, v]);
  return [v, setV] as const;
}

/** The undo stack used while no PDF is open (e.g. for deleting the open PDF's file). */
const LIBRARY_UNDO = "library";

/** Keys that act on pages (or the PDF's outline), so not on HTML / Markdown. */
const PAGED_ONLY: ShortcutId[] = [
  "nextPage",
  "prevPage",
  "firstPage",
  "lastPage",
  "goToPage",
  "addBookmark",
  "bookmarks",
  "deletePage",
  "deletePages",
  "insertBlank",
  "insertFrom",
  "replace",
  "turn",
  "move",
  "textPage",
  "textPages",
  "textAll",
  "ocrPage",
  "ocrPages",
  "ocrAll",
  "textSection",
  "ocrSection",
  "extract",
  "split",
  "merge",
  "copyPage",
  "halves",
  "savePictures",
];

/** Why a file's pages can't be edited: slides are read-only; HTML and Markdown have no pages. */
const readOnlyMessage = (d: DocumentRecord) =>
  d.kind === "slides" ? SLIDES_READ_ONLY : `“${d.title}” is ${d.kind === "html" ? "an HTML page" : "a Markdown file"}: it has no pages to edit.`;

const docIdFromHash = () => /^#\/doc\/([\w-]+)/.exec(window.location.hash)?.[1] ?? null;

export default function App() {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const [leftOpen, setLeftOpen] = usePersistentState("ss-left-open", true);
  const [leftWidth, setLeftWidth] = usePersistentState("ss-left-width", PANEL.left.default);
  const [rightWidth, setRightWidth] = usePersistentState("ss-right-width", PANEL.right.default);
  const windowWidth = useWindowWidth();
  const [rightOpen, setRightOpen] = usePersistentState("ss-right-open", true);
  const [mobilePanel, setMobilePanel] = useState<"left" | "right" | null>(null);

  const [directories, setDirectories] = useState<Directory[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [recent, setRecent] = useState<(ReadingProgress & { title: string })[]>([]);
  const [config, setConfig] = useState<AppConfigInfo | null>(null);
  const [scanning, setScanning] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);

  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [startPage, setStartPage] = useState(1);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [resources, setResources] = useState<Resource[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [noteHighlights, setNoteHighlights] = useState<NoteHighlight[]>([]);
  /** Highlights on the text of an HTML or Markdown document. */
  const [textHighlights, setTextHighlights] = useState<TextHighlight[]>([]);
  /** HTML / Markdown: how far down to open (0..1). */
  const [startTop, setStartTop] = useState<number | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  /** The PDF's own outline has been read (false while it is, or if reading it failed). */
  const [bookmarksReady, setBookmarksReady] = useState(false);
  const [bookmarksError, setBookmarksError] = useState<string | null>(null);
  const [leftTab, setLeftTab] = usePersistentState<"files" | "bookmarks">("ss-left-tab", "files");
  const [bookmarkRename, setBookmarkRename] = useState<{ id: string; nonce: number } | null>(null);
  const [fileRename, setFileRename] = useState<{ id: string; nonce: number } | null>(null);

  const [tool, setTool] = useState<Tool>("select");
  const [highlightColor, setHighlightColor] = usePersistentState("ss-hl-color", HIGHLIGHT_COLORS[0]);
  const [penColor, setPenColor] = usePersistentState("ss-pen-color", PEN_COLORS[0]);
  const [penWidth, setPenWidth] = usePersistentState("ss-pen-width", 0.003);

  const [editorRequest, setEditorRequest] = useState<EditorRequest | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [pageOp, setPageOp] = useState<PageOp | null>(null);
  const [busy, setBusy] = useState<null | "save" | "pages">(null);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  /** A note/resource form in the right panel has unsaved text. */
  const [noteDraft, setNoteDraft] = useState(false);
  const noteDraftRef = useRef(noteDraft);
  noteDraftRef.current = noteDraft;
  /** Another PDF the user asked to open while this one has unsaved work (shows the prompt). */
  const [pendingOpen, setPendingOpen] = useState<{ target: DocumentRecord | string; atPage?: number } | null>(null);
  /** The "Get text / OCR" dialog (pages, or a region drawn with the OCR tool). */
  const [textRequest, setTextRequest] = useState<TextRequest | null>(null);
  /** Extract / split / merge into new PDFs. */
  const [pdfTool, setPdfTool] = useState<PdfTool | null>(null);
  /** The "cut this page in half" window. */
  const [halvesOpen, setHalvesOpen] = useState(false);
  /** The "save pages as pictures" window. */
  const [picturesOpen, setPicturesOpen] = useState(false);
  /** Choosing a part of the window for a screenshot. */
  const [snipping, setSnipping] = useState(false);
  /** Bumped to close all / expand all notes in the notes panel. */
  const [notesToggle, setNotesToggle] = useState(0);

  const viewerRef = useRef<PdfViewerHandle>(null);
  /** First time a document is opened (no saved progress) it is fitted to the viewer width. */
  const fitOnLoadRef = useRef(false);
  const isDesktopRef = useRef(isDesktop);
  isDesktopRef.current = isDesktop;
  const docRef = useRef(doc);
  docRef.current = doc;
  const pageRef = useRef(page);
  pageRef.current = page;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  /** HTML / Markdown: how far down the reader is (0..1). */
  const textTopRef = useRef(0);

  const toast = useCallback((text: string, kind: ToastMsg["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  const toastError = useCallback((e: unknown) => toast((e as Error).message ?? String(e), "error"), [toast]);
  useEffect(() => {
    setNotifier(toast);
    return () => setNotifier(null);
  }, [toast]);

  // Every page edit changes the file, and only PDFs can be changed: say so instead of opening the dialog.
  useEffect(() => {
    const d = docRef.current;
    if (pageOp && d && !canEditFile(d.kind)) {
      toast(readOnlyMessage(d), "error");
      setPageOp(null);
    }
  }, [pageOp, toast]);

  // ---- Library ---------------------------------------------------------------
  const refreshLibrary = useCallback(async () => {
    const [lib, rec] = await Promise.all([api.library(), api.recent()]);
    setDirectories(lib.directories);
    setDocuments(lib.documents);
    setRecent(rec);
    setLibraryLoaded(true);
    return lib;
  }, []);

  useEffect(() => {
    refreshLibrary().catch(toastError);
    api.config().then(setConfig, toastError);
  }, [refreshLibrary, toastError]);

  const rescan = async () => {
    setScanning(true);
    try {
      const r = await api.scan();
      await refreshLibrary();
      toast(`Scan complete: ${r.scanned} files${r.added ? `, ${r.added} new` : ""}${r.moved ? `, ${r.moved} moved` : ""}${r.missing ? `, ${r.missing} missing` : ""}`, "success");
    } catch (e) {
      toastError(e);
    } finally {
      setScanning(false);
    }
  };

  // ---- Opening documents -------------------------------------------------------
  const openDocument = useCallback(
    async (target: DocumentRecord | string, atPage?: number) => {
      const id = typeof target === "string" ? target : target.id;
      if (docRef.current?.id === id) {
        if (atPage) viewerRef.current?.goToPage(atPage);
        if (!isDesktop) setMobilePanel(null);
        return;
      }
      try {
        const [full, res, anns, hls, bms, ths] = await Promise.all([
          api.document(id),
          api.resources(id),
          api.annotations(id),
          api.noteHighlights(id),
          api.bookmarks(id),
          api.textHighlights(id),
        ]);
        if (full.missing) throw new Error("This file is no longer on disk. Rescan your library.");
        const p = atPage ?? full.progress?.page ?? 1;
        setTextHighlights(ths);
        setStartTop(full.progress?.top ?? null);
        textTopRef.current = full.progress?.top ?? 0;
        // Text that flows has only the select and highlight tools.
        if (!isPaged(full.kind)) setTool((t) => (t === "select" || t === "highlight" ? t : "select"));
        setStartPage(p);
        setPage(p);
        setPageCount(full.pageCount ?? 0);
        setZoom(full.progress?.zoom ?? 1);
        fitOnLoadRef.current = !full.progress;
        setResources(res);
        setAnnotations(anns);
        setNoteHighlights(hls);
        setBookmarks(bms.bookmarks);
        setBookmarksReady(bms.imported);
        setBookmarksError(null);
        setDoc(full);
        if (window.location.hash !== `#/doc/${id}`) window.history.replaceState(null, "", `#/doc/${id}`);
        if (!isDesktop) setMobilePanel(null);
      } catch (e) {
        toastError(e);
      }
    },
    [isDesktop, toastError],
  );

  // Restore the document from the URL on first load.
  useEffect(() => {
    const id = docIdFromHash();
    if (id) void openDocument(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Opens another PDF in this tab, first asking what to do with unsaved work in the current one. */
  const requestOpen = (target: DocumentRecord | string, atPage?: number) => {
    const id = typeof target === "string" ? target : target.id;
    const cur = docRef.current;
    if (cur && cur.id !== id && (hasUnsavedChanges(cur) || noteDraftRef.current)) {
      setPendingOpen({ target, atPage });
      return;
    }
    void openDocument(target, atPage);
  };
  const requestOpenRef = useRef(requestOpen);
  requestOpenRef.current = requestOpen;

  // Follow edits of the address bar (e.g. pasting a #/doc/... link).
  useEffect(() => {
    const onHash = () => {
      const id = docIdFromHash();
      if (id && id !== docRef.current?.id) requestOpenRef.current(id);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const cancelPendingOpen = () => {
    setPendingOpen(null);
    const cur = docRef.current;
    if (cur && window.location.hash !== `#/doc/${cur.id}`) window.history.replaceState(null, "", `#/doc/${cur.id}`);
  };

  /** Shows the empty viewer again (after the open PDF's file was deleted). */
  const closeDocument = useCallback(() => {
    setDoc(null);
    setResources([]);
    setAnnotations([]);
    setNoteHighlights([]);
    setTextHighlights([]);
    setBookmarks([]);
    setPageCount(0);
    setNoteDraft(false);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  // Closing or reloading the tab would lose a half-written note, so let the browser ask first.
  useEffect(() => {
    if (!noteDraft) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [noteDraft]);

  /** Reads the PDF's own outline into StudySpace's bookmarks, once per PDF (and again if another program changed it). */
  const importingRef = useRef<string | null>(null);
  const importOutline = useCallback(async (pdf: PDFDocumentProxy) => {
    const d = docRef.current;
    if (!d || d.outlineImported || importingRef.current === d.id) return;
    importingRef.current = d.id;
    setBookmarksError(null);
    try {
      const res = await api.importOutline(d.id, await readOutline(pdf));
      if (docRef.current?.id !== d.id) return;
      setBookmarks(res.bookmarks);
      setBookmarksReady(true);
      setDoc((cur) => (cur && cur.id === d.id ? { ...cur, outlineImported: true } : cur));
    } catch (e) {
      // Without the PDF's own outline, saving could overwrite it, so editing waits for a retry.
      if (docRef.current?.id === d.id) setBookmarksError((e as Error).message || String(e));
    } finally {
      importingRef.current = null;
    }
  }, []);

  const onLoaded = useCallback(
    (count: number, pdf: PDFDocumentProxy) => {
      setPageCount(count);
      void importOutline(pdf);
      // Fit to width on first open; on small screens also when the saved zoom would overflow.
      const fitAlways = fitOnLoadRef.current;
      fitOnLoadRef.current = false;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const z = viewerRef.current?.fitWidthZoom();
          if (!z) return;
          const fitted = Math.min(2, Math.round(z * 100) / 100);
          if (fitAlways) setZoom(fitted);
          else if (!isDesktopRef.current) setZoom((cur) => Math.min(cur, fitted));
        }),
      );
      const d = docRef.current;
      if (d && d.pageCount !== count) {
        api.setPageCount(d.id, count).catch(() => undefined);
        setDocuments((ds) => ds.map((x) => (x.id === d.id ? { ...x, pageCount: count } : x)));
      }
    },
    [importOutline],
  );

  // Persist reading progress (debounced). HTML / Markdown also keep how far down the reader is.
  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => {
      api.saveProgress(doc.id, page, zoom, isPaged(doc.kind) ? undefined : textTopRef.current).then(
        () => setRecent((r) => [{ documentId: doc.id, page, zoom, updatedAt: new Date().toISOString(), title: doc.title }, ...r.filter((x) => x.documentId !== doc.id)]),
        () => undefined,
      );
    }, 700);
    return () => clearTimeout(t);
  }, [doc, page, zoom]);

  const scrollSaveRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** HTML / Markdown scrolled: saved a moment after the reader stops. */
  const onTextScroll = useCallback((top: number) => {
    textTopRef.current = top;
    clearTimeout(scrollSaveRef.current);
    const d = docRef.current;
    if (!d) return;
    scrollSaveRef.current = setTimeout(() => void api.saveProgress(d.id, 1, zoomRef.current, top).catch(() => undefined), 700);
  }, []);

  /** HTML / Markdown loaded: one "page", and no outline to read. */
  const onTextLoaded = useCallback(() => {
    setPageCount(1);
    setBookmarksReady(true);
  }, []);

  const goToPage = useCallback((p: number, top?: number | null) => viewerRef.current?.goToPage(p, top), []);
  const changeZoom = useCallback((z: number) => setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100))), []);

  // ---- Undo / redo ----------------------------------------------------------------
  const history = useUndoHistory(
    doc?.id ?? LIBRARY_UNDO,
    toastError,
    useCallback((m: string) => toast(m), [toast]),
  );

  // ---- Renaming / deleting library files (both undoable) ---------------------------------
  /** Puts a renamed or restored file's new name into the list and the open PDF. */
  const applyDocRecord = useCallback((d: DocumentRecord) => {
    setDocuments((ds) => ds.map((x) => (x.id === d.id ? { ...x, ...d } : x)));
    setDoc((cur) => (cur?.id === d.id ? { ...cur, path: d.path, relPath: d.relPath, title: d.title } : cur));
  }, []);

  const fileName = (d: DocumentRecord) => d.relPath.split("/").pop() ?? d.title;

  const renameFile = async (d: DocumentRecord, name: string) => {
    const from = fileName(d);
    try {
      const after = await api.renameFile(d.id, name);
      const to = fileName(after);
      if (to === from) return;
      applyDocRecord(after);
      history.push(docRef.current?.id ?? LIBRARY_UNDO, {
        label: `Rename “${from}” to “${to}”`,
        undo: async () => applyDocRecord(await api.renameFile(d.id, from)),
        redo: async () => applyDocRecord(await api.renameFile(d.id, to)),
      });
      toast(`Renamed to “${to}” · Ctrl+Z to undo`, "success");
    } catch (e) {
      toastError(e);
    }
  };

  const deleteFile = async (d: DocumentRecord) => {
    const name = fileName(d);
    try {
      let trashName = (await api.trashFile(d.id)).trashName;
      if (docRef.current?.id === d.id) closeDocument();
      await refreshLibrary();
      // Notes, highlights and bookmarks stay in the database, so putting the file back restores everything.
      history.push(docRef.current && docRef.current.id !== d.id ? docRef.current.id : LIBRARY_UNDO, {
        label: `Delete “${name}”`,
        undo: async () => {
          await api.restoreFile(d.id, trashName);
          await refreshLibrary();
        },
        redo: async () => {
          trashName = (await api.trashFile(d.id)).trashName;
          if (docRef.current?.id === d.id) closeDocument();
          await refreshLibrary();
        },
      });
      toast(`Moved “${name}” to the Trash · Ctrl+Z to undo`, "success");
    } catch (e) {
      toastError(e);
    }
  };

  /** Re-reads notes and highlights from the server (after undo/redo or a file edit). */
  const reloadDocData = useCallback(async (docId: string) => {
    const [res, anns, hls, bms, ths] = await Promise.all([
      api.resources(docId),
      api.annotations(docId),
      api.noteHighlights(docId),
      api.bookmarks(docId),
      api.textHighlights(docId),
    ]);
    if (docRef.current?.id !== docId) return;
    setResources(res);
    setAnnotations(anns);
    setNoteHighlights(hls);
    setTextHighlights(ths);
    setBookmarks(bms.bookmarks);
    if (bms.imported) setBookmarksReady(true);
  }, []);

  /** Ignores "already gone" / "already exists" so replaying an undo step is idempotent. */
  const tolerate = (codes: number[]) => (e: unknown) => {
    if (e instanceof ApiError && codes.includes(e.status)) return;
    throw e;
  };

  const markDirty = useCallback(() => {
    setDoc((d) => (d && !d.annotationsDirty ? { ...d, annotationsDirty: true } : d));
    setDocuments((ds) => ds.map((x) => (x.id === docRef.current?.id ? { ...x, annotationsDirty: true } : x)));
  }, []);

  const markBookmarksDirty = useCallback(() => {
    setDoc((d) => (d && !d.bookmarksDirty ? { ...d, bookmarksDirty: true } : d));
    setDocuments((ds) => ds.map((x) => (x.id === docRef.current?.id ? { ...x, bookmarksDirty: true } : x)));
  }, []);

  // ---- Resources ---------------------------------------------------------------
  const resourceFields = (r: Resource): ResourceInput => ({
    type: r.type,
    scope: r.scope,
    pageStart: r.pageStart,
    pageEnd: r.pageEnd,
    title: r.title,
    content: r.content,
    url: r.url,
    styles: r.styles,
  });
  const resourceWord = (t: ResourceInput["type"]) => (t === "note" ? "note" : "resource");

  const createResource = async (input: ResourceInput) => {
    if (!doc) return;
    const docId = doc.id;
    const id = uuid();
    const r = await api.createResource(docId, { ...input, id });
    setResources((rs) => [...rs, r]);
    toast("Saved", "success");
    history.push(docId, {
      label: `Add ${resourceWord(input.type)}`,
      undo: async () => {
        await api.deleteResource(id).catch(tolerate([404]));
        await reloadDocData(docId);
      },
      redo: async () => {
        await api.createResource(docId, { ...resourceFields(r), id }).catch(tolerate([400]));
        await reloadDocData(docId);
      },
    });
  };

  const updateResource = async (id: string, input: ResourceInput) => {
    const before = resources.find((x) => x.id === id);
    const r = await api.updateResource(id, input);
    setResources((rs) => rs.map((x) => (x.id === id ? r : x)));
    if (doc && before) {
      const docId = doc.id;
      history.push(docId, {
        label: `Edit ${resourceWord(before.type)}`,
        undo: async () => {
          await api.updateResource(id, resourceFields(before));
          await reloadDocData(docId);
        },
        redo: async () => {
          await api.updateResource(id, resourceFields(r));
          await reloadDocData(docId);
        },
      });
    }
  };

  /** Colour one heading, label or mark of a note (`key` from rehypeNoteStyles); null = its default. */
  const setNoteStyle = (id: string, key: string, color: string | null) => {
    const before = resources.find((x) => x.id === id);
    if (!doc || !before) return;
    const docId = doc.id;
    const styles = { ...before.styles };
    if (color === null) delete styles[key];
    else styles[key] = color;
    api.updateResource(id, { styles }).then((r) => {
      setResources((rs) => rs.map((x) => (x.id === id ? r : x)));
      history.push(docId, {
        label: "Change colour in note",
        undo: async () => {
          await api.updateResource(id, { styles: before.styles });
          await reloadDocData(docId);
        },
        redo: async () => {
          await api.updateResource(id, { styles });
          await reloadDocData(docId);
        },
      });
    }, toastError);
  };

  const deleteResource = async (id: string) => {
    const before = resources.find((x) => x.id === id);
    try {
      await api.deleteResource(id);
      setResources((rs) => rs.filter((x) => x.id !== id));
    } catch (e) {
      return toastError(e);
    }
    if (doc && before) {
      const docId = doc.id;
      toast(`Deleted ${resourceWord(before.type)} · Ctrl+Z to undo`);
      history.push(docId, {
        label: `Delete ${resourceWord(before.type)}`,
        undo: async () => {
          await api.createResource(docId, { ...resourceFields(before), id }).catch(tolerate([400]));
          await reloadDocData(docId);
        },
        redo: async () => {
          await api.deleteResource(id).catch(tolerate([404]));
          await reloadDocData(docId);
        },
      });
    }
  };

  // ---- Annotations -------------------------------------------------------------
  const annotationLabel = (k: AnnotationInput["kind"]) => (k === "ink" ? "drawing" : k === "area" ? "area highlight" : "highlight");
  const annotationFields = (a: Annotation): AnnotationInput => ({
    id: a.id,
    page: a.page,
    kind: a.kind,
    color: a.color,
    opacity: a.opacity,
    rects: a.rects,
    paths: a.paths,
    strokeWidth: a.strokeWidth,
    text: a.text,
  });

  const createAnnotation = useCallback(
    (input: AnnotationInput) => {
      const d = docRef.current;
      if (!d) return;
      const docId = d.id;
      const id = uuid();
      api.createAnnotation(docId, { ...input, id }).then((a) => {
        setAnnotations((as) => [...as, a]);
        markDirty();
        history.push(docId, {
          label: `Add ${annotationLabel(input.kind)}`,
          undo: async () => {
            await api.deleteAnnotation(id).catch(tolerate([404]));
            markDirty();
            await reloadDocData(docId);
          },
          redo: async () => {
            await api.createAnnotation(docId, annotationFields(a)).catch(tolerate([409]));
            markDirty();
            await reloadDocData(docId);
          },
        });
      }, toastError);
    },
    [markDirty, toastError, history.push, reloadDocData], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  const deleteAnnotation = useCallback(
    (id: string) => {
      const d = docRef.current;
      const removed = annotationsRef.current.find((a) => a.id === id);
      if (!d || !removed) return;
      const docId = d.id;
      setAnnotations((as) => as.filter((a) => a.id !== id));
      api.deleteAnnotation(id).then(
        () => {
          markDirty();
          history.push(docId, {
            label: `Delete ${annotationLabel(removed.kind)}`,
            undo: async () => {
              await api.createAnnotation(docId, annotationFields(removed)).catch(tolerate([409]));
              markDirty();
              await reloadDocData(docId);
            },
            redo: async () => {
              await api.deleteAnnotation(id).catch(tolerate([404]));
              markDirty();
              await reloadDocData(docId);
            },
          });
        },
        (e) => {
          setAnnotations((as) => [...as, removed]);
          toastError(e);
        },
      );
    },
    [markDirty, toastError, history.push, reloadDocData], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const updateAnnotation = useCallback(
    (id: string, patch: { color?: string }) => {
      const d = docRef.current;
      const before = annotationsRef.current.find((a) => a.id === id);
      if (!d || !before) return;
      const docId = d.id;
      api.updateAnnotation(id, patch).then((a) => {
        setAnnotations((as) => as.map((x) => (x.id === id ? a : x)));
        markDirty();
        history.push(docId, {
          label: `Recolour ${annotationLabel(before.kind)}`,
          undo: async () => {
            await api.updateAnnotation(id, { color: before.color });
            markDirty();
            await reloadDocData(docId);
          },
          redo: async () => {
            await api.updateAnnotation(id, patch);
            markDirty();
            await reloadDocData(docId);
          },
        });
      }, toastError);
    },
    [markDirty, toastError, history.push, reloadDocData], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---- Highlights inside notes ----------------------------------------------------------
  const noteHighlightsRef = useRef(noteHighlights);
  noteHighlightsRef.current = noteHighlights;
  const noteHighlightFields = (h: NoteHighlight) => ({
    id: h.id,
    color: h.color,
    quote: h.quote,
    prefix: h.prefix,
    suffix: h.suffix,
    comment: h.comment,
  });

  const createNoteHighlight = async (resourceId: string, anchor: Anchor, color: string) => {
    const d = docRef.current;
    if (!d) return undefined;
    const docId = d.id;
    try {
      const h = await api.createNoteHighlight(resourceId, { id: uuid(), color, ...anchor });
      setNoteHighlights((hs) => [...hs, h]);
      history.push(docId, {
        label: "Highlight in note",
        undo: async () => {
          await api.deleteNoteHighlight(h.id).catch(tolerate([404]));
          await reloadDocData(docId);
        },
        redo: async () => {
          await api.createNoteHighlight(resourceId, noteHighlightFields(h)).catch(tolerate([409]));
          await reloadDocData(docId);
        },
      });
      return h;
    } catch (e) {
      toastError(e);
      return undefined;
    }
  };

  const updateNoteHighlight = (id: string, patch: { color?: string; comment?: string }) => {
    const d = docRef.current;
    const before = noteHighlightsRef.current.find((h) => h.id === id);
    if (!d || !before) return;
    const docId = d.id;
    api.updateNoteHighlight(id, patch).then((h) => {
      setNoteHighlights((hs) => hs.map((x) => (x.id === id ? h : x)));
      history.push(docId, {
        label: patch.comment !== undefined ? "Edit comment in note" : "Recolour highlight in note",
        undo: async () => {
          await api.updateNoteHighlight(id, { color: before.color, comment: before.comment });
          await reloadDocData(docId);
        },
        redo: async () => {
          await api.updateNoteHighlight(id, patch);
          await reloadDocData(docId);
        },
      });
    }, toastError);
  };

  const deleteNoteHighlights = (ids: string[]) => {
    const d = docRef.current;
    const removed = noteHighlightsRef.current.filter((h) => ids.includes(h.id));
    if (!d || !removed.length) return;
    const docId = d.id;
    setNoteHighlights((hs) => hs.filter((h) => !ids.includes(h.id)));
    Promise.all(removed.map((h) => api.deleteNoteHighlight(h.id).catch(tolerate([404])))).then(() => {
      history.push(docId, {
        label: removed.length === 1 ? "Remove highlight in note" : `Remove ${removed.length} highlights in note`,
        undo: async () => {
          for (const h of removed) await api.createNoteHighlight(h.resourceId, noteHighlightFields(h)).catch(tolerate([409]));
          await reloadDocData(docId);
        },
        redo: async () => {
          for (const h of removed) await api.deleteNoteHighlight(h.id).catch(tolerate([404]));
          await reloadDocData(docId);
        },
      });
    }, (e) => {
      toastError(e);
      void reloadDocData(docId);
    });
  };

  // ---- Highlights on HTML / Markdown documents ----------------------------------------------
  const textHighlightsRef = useRef(textHighlights);
  textHighlightsRef.current = textHighlights;
  const textHighlightFields = (h: TextHighlight) => ({
    id: h.id,
    color: h.color,
    quote: h.quote,
    prefix: h.prefix,
    suffix: h.suffix,
    comment: h.comment,
  });

  const createTextHighlight = async (anchor: Anchor, color: string) => {
    const d = docRef.current;
    if (!d) return undefined;
    const docId = d.id;
    try {
      const h = await api.createTextHighlight(docId, { id: uuid(), color, ...anchor });
      setTextHighlights((hs) => [...hs, h]);
      history.push(docId, {
        label: "Highlight",
        undo: async () => {
          await api.deleteTextHighlight(h.id).catch(tolerate([404]));
          await reloadDocData(docId);
        },
        redo: async () => {
          await api.createTextHighlight(docId, textHighlightFields(h)).catch(tolerate([409]));
          await reloadDocData(docId);
        },
      });
      return h;
    } catch (e) {
      toastError(e);
      return undefined;
    }
  };

  const updateTextHighlight = (id: string, patch: { color?: string; comment?: string }) => {
    const d = docRef.current;
    const before = textHighlightsRef.current.find((h) => h.id === id);
    if (!d || !before) return;
    const docId = d.id;
    api.updateTextHighlight(id, patch).then((h) => {
      setTextHighlights((hs) => hs.map((x) => (x.id === id ? h : x)));
      history.push(docId, {
        label: patch.comment !== undefined ? "Edit comment" : "Recolour highlight",
        undo: async () => {
          await api.updateTextHighlight(id, { color: before.color, comment: before.comment });
          await reloadDocData(docId);
        },
        redo: async () => {
          await api.updateTextHighlight(id, patch);
          await reloadDocData(docId);
        },
      });
    }, toastError);
  };

  const deleteTextHighlights = (ids: string[]) => {
    const d = docRef.current;
    const removed = textHighlightsRef.current.filter((h) => ids.includes(h.id));
    if (!d || !removed.length) return;
    const docId = d.id;
    setTextHighlights((hs) => hs.filter((h) => !ids.includes(h.id)));
    Promise.all(removed.map((h) => api.deleteTextHighlight(h.id).catch(tolerate([404])))).then(() => {
      history.push(docId, {
        label: removed.length === 1 ? "Remove highlight" : `Remove ${removed.length} highlights`,
        undo: async () => {
          for (const h of removed) await api.createTextHighlight(docId, textHighlightFields(h)).catch(tolerate([409]));
          await reloadDocData(docId);
        },
        redo: async () => {
          for (const h of removed) await api.deleteTextHighlight(h.id).catch(tolerate([404]));
          await reloadDocData(docId);
        },
      });
    }, (e) => {
      toastError(e);
      void reloadDocData(docId);
    });
  };

  // ---- File edits (rewrite the PDF; undone by restoring the previous version) ---------
  /** Reloads the document after its file changed, showing `preferPage` (or the server's remapped page). */
  const refreshAfterFileChange = async (docId: string, preferPage?: number) => {
    const [full, res, anns, hls, bms] = await Promise.all([
      api.document(docId),
      api.resources(docId),
      api.annotations(docId),
      api.noteHighlights(docId),
      api.bookmarks(docId),
    ]);
    if (docRef.current?.id !== docId) return full;
    const p = Math.max(1, Math.min(preferPage ?? full.progress?.page ?? pageRef.current, full.pageCount ?? 1));
    setStartPage(p);
    setPage(p);
    setPageCount(full.pageCount ?? 0);
    setResources(res);
    setAnnotations(anns);
    setNoteHighlights(hls);
    setBookmarks(bms.bookmarks);
    setBookmarksReady(bms.imported); // false when another program changed the file: its outline is read again
    setDoc({ ...full });
    setDocuments((ds) => ds.map((x) => (x.id === docId ? { ...x, ...full } : x)));
    return full;
  };

  /** Runs a file edit, reloads the document, and records an undo step for it. */
  const applyFileEdit = async (
    kind: "save" | "pages",
    label: string,
    run: (d: DocumentRecord) => Promise<EditResult>,
    success: string,
  ): Promise<boolean> => {
    const d = docRef.current;
    if (!d) return false;
    if (!canEditFile(d.kind)) {
      toast(readOnlyMessage(d), "error");
      return false;
    }
    const docId = d.id;
    setBusy(kind);
    try {
      await api.saveProgress(docId, pageRef.current, zoom);
      const result = await run(d);
      await refreshAfterFileChange(docId);
      setPageOp(null);
      if (result.editId) {
        let editId = result.editId;
        let pageBefore = pageRef.current;
        history.push(docId, {
          label,
          undo: async () => {
            pageBefore = pageRef.current;
            await api.undoFileEdit(docId, editId);
            await refreshAfterFileChange(docId);
          },
          redo: async () => {
            const cur = docRef.current;
            if (!cur || cur.id !== docId) throw new Error("Open the document to redo this change.");
            const again = await run(cur);
            if (again.editId) editId = again.editId;
            await refreshAfterFileChange(docId, kind === "save" ? pageBefore : undefined);
          },
        });
        toast(`${success} · Ctrl+Z to undo`, "success");
      } else {
        toast(`${success} (undo is disabled: STUDYSPACE_HISTORY_LIMIT=0)`, "success");
      }
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const saveToFile = () => {
    const d = docRef.current;
    const what = !d?.bookmarksDirty ? "Highlights and drawings" : d.annotationsDirty ? "Highlights, drawings and bookmarks" : "Bookmarks";
    return applyFileEdit(
      "save",
      "Save highlights and bookmarks into the PDF",
      (cur) => api.saveAnnotationsToFile(cur.id, cur.fingerprint),
      `${what} saved into the PDF`,
    );
  };

  // ---- Bookmarks ---------------------------------------------------------------------------
  const bookmarksRef = useRef(bookmarks);
  bookmarksRef.current = bookmarks;
  const bookmarkFields = (b: Bookmark): BookmarkInput => ({
    id: b.id,
    title: b.title,
    page: b.page,
    top: b.top,
    parentId: b.parentId,
    position: b.position,
  });
  /** Runs a bookmark change again after undo/redo, then re-reads the bookmarks. */
  const bookmarkStep = (docId: string, run: () => Promise<unknown>) => async () => {
    await run();
    markBookmarksDirty();
    await reloadDocData(docId);
  };

  /**
   * Bookmarks the spot at the top of the view. Selected text in the PDF becomes its title; otherwise
   * it is named after the page and opened for renaming. It goes right after the bookmark you're
   * reading in (same level), or inside `parentId` when given.
   */
  const addBookmark = async (parentId?: string | null) => {
    const d = docRef.current;
    if (!d || !bookmarksReady) return;
    const docId = d.id;
    const pos = viewerRef.current?.getPosition() ?? { page: pageRef.current, top: null };
    const sel = window.getSelection();
    const selected = sel && !sel.isCollapsed && sel.anchorNode?.parentElement?.closest(".textLayer") ? sel.toString().replace(/\s+/g, " ").trim() : "";
    const title = selected && selected.length <= 200 ? selected : `Page ${pos.page}`;

    const list = bookmarksRef.current;
    const tree = buildBookmarkTree(list);
    const nodes = new Map<string, BookmarkTreeNode>();
    const walk = (xs: BookmarkTreeNode[]) => xs.forEach((x) => (nodes.set(x.id, x), walk(x.children)));
    walk(tree);
    const ordered = [...nodes.values()];
    let parent: string | null = null;
    let position: number;
    if (parentId) {
      parent = parentId;
      position = (nodes.get(parentId)?.children.at(-1)?.position ?? 0) + 1;
    } else {
      const before = ordered.filter((b) => b.page < pos.page || (b.page === pos.page && (b.top ?? 0) <= (pos.top ?? 0)));
      const after = nodes.get(currentBookmarkId(before, pos.page) ?? "");
      if (after) {
        parent = after.parentId;
        const sibs = parent ? nodes.get(parent)!.children : tree;
        const next = sibs[sibs.findIndex((x) => x.id === after.id) + 1];
        position = next ? (after.position + next.position) / 2 : after.position + 1;
      } else {
        position = (tree[0]?.position ?? 1) - 1;
      }
    }

    const id = uuid();
    const input: BookmarkInput = { id, title, page: pos.page, top: pos.top, parentId: parent, position };
    try {
      const b = await api.createBookmark(docId, input);
      setBookmarks((bs) => [...bs, b]);
      markBookmarksDirty();
      setLeftTab("bookmarks");
      if (isDesktopRef.current) setLeftOpen(true);
      if (title !== selected) setBookmarkRename({ id, nonce: Date.now() });
      else toast(`Bookmarked “${title}”`, "success");
      history.push(docId, {
        label: "Add bookmark",
        undo: bookmarkStep(docId, () => api.deleteBookmark(id).catch(tolerate([404]))),
        redo: bookmarkStep(docId, () => api.createBookmark(docId, bookmarkFields(b)).catch(tolerate([409]))),
      });
    } catch (e) {
      toastError(e);
    }
  };

  const updateBookmark = (id: string, patch: BookmarkPatch, label: string) => {
    const d = docRef.current;
    const before = bookmarksRef.current.find((b) => b.id === id);
    if (!d || !before) return;
    const docId = d.id;
    // Show the change at once; the server's answer (or a re-read on failure) settles it.
    setBookmarks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch, parentId: patch.parentId === undefined ? b.parentId : patch.parentId } : b)));
    api.updateBookmark(id, patch).then(
      (b) => {
        setBookmarks((bs) => bs.map((x) => (x.id === id ? b : x)));
        markBookmarksDirty();
        const { id: _id, ...prev } = bookmarkFields(before);
        history.push(docId, {
          label,
          undo: bookmarkStep(docId, () => api.updateBookmark(id, prev)),
          redo: bookmarkStep(docId, () => api.updateBookmark(id, patch)),
        });
      },
      (e) => {
        toastError(e);
        void reloadDocData(docId);
      },
    );
  };

  const retargetBookmark = (id: string) => {
    const pos = viewerRef.current?.getPosition() ?? { page: pageRef.current, top: null };
    updateBookmark(id, { page: pos.page, top: pos.top }, "Point bookmark here");
  };

  const deleteBookmark = (id: string) => {
    const d = docRef.current;
    if (!d) return;
    const docId = d.id;
    // The bookmark and everything inside it, parents first (so undo can re-create them in order).
    const removed: Bookmark[] = [];
    const collect = (pid: string) => {
      const b = bookmarksRef.current.find((x) => x.id === pid);
      if (!b) return;
      removed.push(b);
      bookmarksRef.current.filter((x) => x.parentId === pid).forEach((x) => collect(x.id));
    };
    collect(id);
    if (!removed.length) return;
    const gone = new Set(removed.map((b) => b.id));
    setBookmarks((bs) => bs.filter((b) => !gone.has(b.id)));
    api.deleteBookmark(id).then(
      () => {
        markBookmarksDirty();
        const n = removed.length;
        toast(`Deleted ${n === 1 ? "bookmark" : `${n} bookmarks`} · Ctrl+Z to undo`);
        history.push(docId, {
          label: n === 1 ? "Delete bookmark" : `Delete ${n} bookmarks`,
          undo: bookmarkStep(docId, async () => {
            for (const b of removed) await api.createBookmark(docId, bookmarkFields(b)).catch(tolerate([409]));
          }),
          redo: bookmarkStep(docId, () => api.deleteBookmark(id).catch(tolerate([404]))),
        });
      },
      (e) => {
        toastError(e);
        void reloadDocData(docId);
      },
    );
  };

  const jumpToBookmark = (b: Bookmark) => {
    goToPage(b.page, b.top);
    if (!isDesktopRef.current) setMobilePanel(null);
  };

  // ---- Several tabs ------------------------------------------------------------------------
  // Tell other StudySpace tabs about every change made here...
  useEffect(() => {
    setMutationListener((_method, url) => {
      const c = classifyMutation(url);
      if (!c) return;
      if (c.scope === "library") announceChange(null, false);
      else if (docRef.current) announceChange(docRef.current.id, c.file);
    });
    return () => setMutationListener(null);
  }, []);

  // ...and re-read what other tabs changed (batched, since one action can send several messages).
  const remoteRef = useRef<(c: TabChange) => void>(() => undefined);
  remoteRef.current = (c: TabChange) => {
    const d = docRef.current;
    if (!d || c.docId !== d.id) {
      // Keeps page counts and "unsaved" dots current, and follows a rename or delete of the open file.
      void refreshLibrary().then((lib) => {
        const cur = docRef.current;
        if (!cur || c.docId) return;
        const now = lib.documents.find((x) => x.id === cur.id);
        if (!now) {
          closeDocument();
          toast(`“${cur.title}” was deleted in another tab, so it was closed here.`);
        } else if (now.path !== cur.path) applyDocRecord(now);
      }, () => undefined);
      return;
    }
    if (c.file) {
      void refreshAfterFileChange(d.id, pageRef.current).then(
        () => toast(`“${d.title}” was changed in another tab, so it was reloaded here.`),
        toastError,
      );
      return;
    }
    void reloadDocData(d.id).catch(() => undefined);
    void api.document(d.id).then((full) => {
      if (docRef.current?.id !== full.id) return;
      const flags = { annotationsDirty: full.annotationsDirty, bookmarksDirty: full.bookmarksDirty, outlineImported: full.outlineImported };
      const same = (x: DocumentRecord) =>
        x.annotationsDirty === flags.annotationsDirty && x.bookmarksDirty === flags.bookmarksDirty && x.outlineImported === flags.outlineImported;
      setDoc((cur) => (cur && !same(cur) ? { ...cur, ...flags } : cur));
      setDocuments((ds) => ds.map((x) => (x.id === full.id && !same(x) ? { ...x, ...flags } : x)));
    }, () => undefined);
  };
  useEffect(() => {
    const queued = new Map<string, TabChange>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onRemoteChange((c) => {
      const key = c.docId ?? "";
      const prev = queued.get(key);
      queued.set(key, { ...c, file: c.file || !!prev?.file });
      clearTimeout(timer);
      timer = setTimeout(() => {
        const batch = [...queued.values()];
        queued.clear();
        for (const change of batch) remoteRef.current(change);
      }, 250);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  const newNoteHere = useCallback(() => {
    setEditorRequest({ nonce: Date.now(), defaults: { type: "note", scope: "page", pageStart: pageRef.current, pageEnd: pageRef.current } });
    if (isDesktopRef.current) setRightOpen(true);
    else setMobilePanel("right");
  }, [setRightOpen]);

  /** Copies a screenshot of part of the window (or all of it) to the clipboard. */
  const finishSnip = (rect: ScreenRect | null) => {
    setSnipping(false);
    const r = rect ?? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    // Started inside the click / key press that chose the part, so the browser allows the copy.
    copyToClipboard(captureWindowRegion(r)).then(
      () => toast(`Screenshot copied (${Math.round(r.w)} × ${Math.round(r.h)}). Paste it anywhere with Ctrl+V.`, "success"),
      toastError,
    );
  };

  /** Copies the page you're reading to the clipboard as a picture. */
  const copyPageImage = () => {
    const pdf = viewerRef.current?.getPdf();
    if (!pdf) return;
    const p = pageRef.current;
    // The image is handed over as a promise so the browser still counts the key press that asked for it.
    copyToClipboard(renderRegion(pdf, p, undefined, COPY_QUALITY).then(canvasToPng)).then(
      () => toast(`Page ${p} copied as an image. Paste it anywhere (Ctrl+V).`, "success"),
      toastError,
    );
  };

  // ---- Global keyboard shortcuts (keys are defined in lib/shortcuts.ts) ----------------------
  const shortcutRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  shortcutRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || isTyping(e) || snipping) return; // the screenshot overlay has its own keys
    const is = (id: ShortcutId) => matches(e, id);
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };

    if (is("help")) return run(() => setShowHelp((h) => !h));
    if (is("search")) return; // handled by the search box
    if (is("snip") && !document.querySelector('[role="dialog"]')) return run(() => setSnipping(true));
    // Dialogs have their own keys (Esc, Enter...).
    if (showSettings || showHelp || pageOp || pendingOpen || textRequest || pdfTool || halvesOpen || picturesOpen || document.querySelector('[role="dialog"]')) return;

    // Work with or without an open PDF.
    const openLeft = () => (isDesktopRef.current ? setLeftOpen(true) : setMobilePanel("left"));
    if (is("settings")) return run(() => setShowSettings(true));
    if (is("theme")) return run(toggleTheme);
    if (is("rescan")) return run(() => void rescan());
    if (is("toggleLeft")) return run(() => (isDesktopRef.current ? setLeftOpen((o) => !o) : setMobilePanel((m) => (m === "left" ? null : "left"))));
    if (is("toggleRight")) return run(() => (isDesktopRef.current ? setRightOpen((o) => !o) : setMobilePanel((m) => (m === "right" ? null : "right"))));
    if (is("files")) return run(() => (setLeftTab("files"), openLeft()));
    if (is("filter"))
      return run(() => {
        openLeft();
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>("[data-panel-filter]")?.focus());
      });
    if (is("undo")) return run(() => void history.undo());
    if (is("redo")) return run(() => void history.redo());
    if (!docRef.current) return;
    // HTML and Markdown have no pages: page keys, page tools, Get text, pictures, new PDFs and
    // bookmarks are for PDFs. Their keys (arrows, Home, End…) then scroll the text as usual.
    if (!isPaged(docRef.current.kind) && PAGED_ONLY.some(is)) return;

    const zoomIn = () => setZoom((z) => ZOOM_STEPS.find((s) => s > z + 0.001) ?? z);
    const zoomOut = () => setZoom((z) => [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? z);
    const fit = (z: number | null | undefined) => z && changeZoom(z);
    const go = (p: number) => viewerRef.current?.goToPage(p);

    if (is("save")) run(() => hasUnsavedChanges(docRef.current!) && !busy && void saveToFile());
    else if (is("zoomIn")) run(zoomIn);
    else if (is("zoomOut")) run(zoomOut);
    else if (is("zoomReset")) run(() => setZoom(1));
    else if (is("nextPage")) run(() => go(pageRef.current + 1));
    else if (is("prevPage")) run(() => go(pageRef.current - 1));
    else if (is("firstPage")) run(() => go(1));
    else if (is("lastPage")) run(() => go(Number.MAX_SAFE_INTEGER));
    else if (is("fitWidth")) run(() => fit(viewerRef.current?.fitWidthZoom()));
    else if (is("fitPage")) run(() => fit(viewerRef.current?.fitPageZoom()));
    else if (is("goToPage"))
      run(() => {
        const input = document.querySelector<HTMLInputElement>('input[aria-label="Current page"]');
        input?.focus();
        input?.select();
      });
    else if (is("newNote")) run(newNoteHere);
    else if (is("toggleNotes"))
      run(() => {
        setNotesToggle(Date.now());
        if (isDesktopRef.current) setRightOpen(true);
      });
    else if (is("addBookmark")) run(() => void addBookmark());
    else if (is("bookmarks")) run(() => (setLeftTab("bookmarks"), openLeft()));
    else if (is("renameFile"))
      run(() => {
        setLeftTab("files");
        openLeft();
        setFileRename({ id: docRef.current!.id, nonce: Date.now() });
      });
    else if (is("deletePage")) run(() => setPageOp({ kind: "delete" }));
    else if (is("deletePages")) run(() => setPageOp({ kind: "delete", preset: "" }));
    else if (is("insertBlank")) run(() => setPageOp({ kind: "blank" }));
    else if (is("insertFrom")) run(() => setPageOp({ kind: "from" }));
    else if (is("replace")) run(() => setPageOp({ kind: "replace" }));
    else if (is("turn")) run(() => setPageOp({ kind: "rotate" }));
    else if (is("move")) run(() => setPageOp({ kind: "move" }));
    else if (is("textPage")) run(() => setTextRequest({ kind: "pages", preset: { mode: "this", method: "text", auto: true } }));
    else if (is("textPages")) run(() => setTextRequest({ kind: "pages", preset: { mode: "range", method: "text" } }));
    else if (is("textAll")) run(() => setTextRequest({ kind: "pages", preset: { mode: "all", method: "text", auto: true } }));
    else if (is("ocrPage")) run(() => setTextRequest({ kind: "pages", preset: { mode: "this", method: "ocr", auto: true } }));
    else if (is("ocrPages")) run(() => setTextRequest({ kind: "pages", preset: { mode: "range", method: "ocr" } }));
    else if (is("ocrAll")) run(() => setTextRequest({ kind: "pages", preset: { mode: "all", method: "ocr" } }));
    else if (is("textSection")) run(() => setTextRequest({ kind: "pages", preset: { mode: "bookmark", method: "text" } }));
    else if (is("ocrSection")) run(() => setTextRequest({ kind: "pages", preset: { mode: "bookmark", method: "ocr" } }));
    else if (is("extract")) run(() => setPdfTool("extract"));
    else if (is("split")) run(() => setPdfTool("split"));
    else if (is("merge")) run(() => setPdfTool("merge"));
    else if (is("copyPage")) run(copyPageImage);
    else if (is("halves")) run(() => setHalvesOpen(true));
    else if (is("savePictures")) run(() => setPicturesOpen(true));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => shortcutRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const quoteToNote = useCallback(
    (p: number, text: string) => {
      setEditorRequest({
        nonce: Date.now(),
        defaults: { type: "note", scope: "page", pageStart: p, pageEnd: p, content: text ? `> ${text}\n\n` : "" },
      });
      if (isDesktop) setRightOpen(true);
      else setMobilePanel("right");
    },
    [isDesktop, setRightOpen],
  );
  const clearEditorRequest = useCallback(() => setEditorRequest(null), []);

  // ---- Theme ---------------------------------------------------------------------
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("ss-theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable */
    }
  };

  /** Sources for page edits and new PDFs: files with pages. */
  const pagedDocuments = useMemo(() => documents.filter((d) => isPaged(d.kind)), [documents]);

  const course = useMemo(() => {
    if (!doc) return null;
    const parts = doc.relPath.split("/");
    return parts.length > 1 ? parts[0] : (directories.find((d) => d.id === doc.directoryId)?.label ?? null);
  }, [doc, directories]);

  const toolColor = tool === "pen" ? penColor : highlightColor;
  const setToolColor = (c: string) => (tool === "pen" ? setPenColor(c) : setHighlightColor(c));

  const showLeft = isDesktop ? leftOpen : mobilePanel === "left";
  const showRight = isDesktop ? rightOpen : mobilePanel === "right";

  // Column widths (desktop). Each side panel is clamped so the viewer keeps at least CENTER_MIN px.
  const rightShown = showRight && !!doc;
  const leftMax = Math.max(PANEL.left.min, Math.min(PANEL.left.max, windowWidth - CENTER_MIN - (rightShown ? rightWidth : 0)));
  const leftW = Math.min(Math.max(leftWidth, PANEL.left.min), leftMax);
  const rightMax = Math.max(PANEL.right.min, Math.min(PANEL.right.max, windowWidth - CENTER_MIN - (showLeft ? leftW : 0)));
  const rightW = Math.min(Math.max(rightWidth, PANEL.right.min), rightMax);

  const libraryPanel = (
    <LibraryPanel
      directories={directories}
      documents={documents}
      recent={recent}
      activeId={doc?.id ?? null}
      scanning={scanning}
      onOpen={(d) => requestOpen(d)}
      onRename={(d, name) => void renameFile(d, name)}
      onDelete={(d) => void deleteFile(d)}
      renameRequest={fileRename}
      onRenameRequestDone={() => setFileRename(null)}
      onRescan={rescan}
      onOpenSettings={() => setShowSettings(true)}
    />
  );

  const tab = (id: "files" | "bookmarks", label: string, icon: React.ReactNode, key: ShortcutId) => (
    <button
      role="tab"
      aria-selected={leftTab === id}
      className={cx(
        "-mb-px flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium",
        leftTab === id ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink",
      )}
      onClick={() => setLeftTab(id)}
      title={withKey(label, key)}
    >
      {icon}
      {label}
      <KeyHint id={key} className="hidden lg:inline" />
    </button>
  );
  // With a PDF open, the left column switches between the library and that PDF's bookmarks.
  const library = doc && isPaged(doc.kind) ? (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" className="flex shrink-0 gap-1 border-b border-line px-2">
        {tab("files", "Files", <Library className="size-4" />, "files")}
        {tab("bookmarks", "Bookmarks", <BookmarkIcon className="size-4" />, "bookmarks")}
      </div>
      <div className="min-h-0 flex-1">
        {leftTab === "bookmarks" ? (
          <BookmarksPanel
            key={doc.id}
            bookmarks={bookmarks}
            ready={bookmarksReady}
            error={bookmarksError}
            onRetry={() => {
              const pdf = viewerRef.current?.getPdf();
              if (pdf) void importOutline(pdf);
            }}
            page={page}
            dirty={doc.bookmarksDirty}
            saving={busy === "save"}
            renameRequest={bookmarkRename}
            onJump={jumpToBookmark}
            onAdd={(parentId) => void addBookmark(parentId)}
            onUpdate={updateBookmark}
            onDelete={deleteBookmark}
            onRetarget={retargetBookmark}
            onGetText={(id, method) => setTextRequest({ kind: "pages", preset: { mode: "bookmark", bookmarkId: id, method, auto: true } })}
            onSave={() => void saveToFile()}
          />
        ) : (
          libraryPanel
        )}
      </div>
    </div>
  ) : (
    libraryPanel
  );

  const rightPanel = (
    <ResourcePanel
      key={doc?.id}
      page={page}
      pageCount={pageCount}
      paged={!doc || isPaged(doc.kind)}
      resources={resources}
      annotations={annotations}
      noteHighlights={noteHighlights}
      highlightColor={highlightColor}
      onCreateNoteHighlight={createNoteHighlight}
      onUpdateNoteHighlight={updateNoteHighlight}
      onDeleteNoteHighlights={deleteNoteHighlights}
      onSetNoteStyle={setNoteStyle}
      editorRequest={editorRequest}
      onEditorRequestHandled={clearEditorRequest}
      onDraftChange={setNoteDraft}
      onCreate={createResource}
      onUpdate={updateResource}
      onDelete={deleteResource}
      onJump={goToPage}
      toggleAllRequest={notesToggle}
    />
  );

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 sm:px-3">
        <IconButton
          label={withKey("Show / hide the library", "toggleLeft")}
          active={showLeft}
          onClick={() => (isDesktop ? setLeftOpen((o) => !o) : setMobilePanel((m) => (m === "left" ? null : "left")))}
        >
          <PanelLeft className="size-4" />
        </IconButton>
        <div className="flex items-center gap-2 pr-1">
          <img src="/favicon.svg" alt="" className="size-6" />
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">StudySpace</span>
        </div>
        {doc && (
          <div className="hidden min-w-0 items-center gap-1 text-sm text-ink-2 md:flex">
            {course && (
              <>
                <span className="truncate font-medium">{course}</span>
                <ChevronRight className="size-3.5 shrink-0 text-ink-3" />
              </>
            )}
            <span className="max-w-64 truncate text-ink-3" title={doc.relPath}>{doc.title}</span>
          </div>
        )}
        <div className="mx-auto flex min-w-0 flex-1 justify-end px-2 sm:justify-center">
          <SearchBox documents={documents} onOpenDocument={(d, p) => requestOpen(d, p)} />
        </div>
        <IconButton label={withKey("Screenshot part of the window", "snip")} onClick={() => setSnipping(true)}>
          <Crop className="size-4" />
        </IconButton>
        <IconButton label={withKey(dark ? "Light mode" : "Dark mode", "theme")} onClick={toggleTheme}>
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </IconButton>
        <IconButton label={withKey("Help & keyboard shortcuts", "help")} onClick={() => setShowHelp(true)}>
          <CircleHelp className="size-4" />
        </IconButton>
        <IconButton label={withKey("Settings", "settings")} onClick={() => setShowSettings(true)}>
          <Settings className="size-4" />
        </IconButton>
        <IconButton
          label={withKey("Show / hide notes & resources", "toggleRight")}
          active={showRight}
          onClick={() => (isDesktop ? setRightOpen((o) => !o) : setMobilePanel((m) => (m === "right" ? null : "right")))}
        >
          <PanelRight className="size-4" />
        </IconButton>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Left: library */}
        {isDesktop ? (
          showLeft && (
            <>
              <aside className="shrink-0 overflow-hidden bg-panel" style={{ width: leftW }}>
                {library}
              </aside>
              <ResizeHandle
                panel="left"
                label="Resize library"
                value={leftW}
                min={PANEL.left.min}
                max={leftMax}
                defaultValue={PANEL.left.default}
                onChange={setLeftWidth}
              />
            </>
          )
        ) : (
          showLeft && (
            <>
              <div className="absolute inset-0 z-30 bg-black/30" onClick={() => setMobilePanel(null)} />
              <aside className="absolute inset-y-0 left-0 z-40 w-[85vw] max-w-80 border-r border-line bg-panel shadow-2xl">{library}</aside>
            </>
          )
        )}

        {/* Center: viewer */}
        <main className="flex min-w-0 flex-1 flex-col">
          {doc ? (
            <>
              <ViewerToolbar
                tool={tool}
                onTool={setTool}
                color={toolColor}
                onColor={setToolColor}
                penWidth={penWidth}
                onPenWidth={setPenWidth}
                dirty={hasUnsavedChanges(doc)}
                kind={doc.kind}
                annotationCount={annotations.length + bookmarks.length}
                saving={busy === "save"}
                onSaveToFile={saveToFile}
                onInsertBlank={() => setPageOp({ kind: "blank" })}
                onInsertFrom={() => setPageOp({ kind: "from" })}
                onReplace={() => setPageOp({ kind: "replace" })}
                onGetText={(preset) => setTextRequest({ kind: "pages", preset })}
                onDeletePage={() => setPageOp({ kind: "delete" })}
                onDeletePages={() => setPageOp({ kind: "delete", preset: "" })}
                onRotate={() => setPageOp({ kind: "rotate" })}
                onMove={() => setPageOp({ kind: "move" })}
                onExtract={() => setPdfTool("extract")}
                onSplit={() => setPdfTool("split")}
                onMerge={() => setPdfTool("merge")}
                onCopyPage={copyPageImage}
                onHalves={() => setHalvesOpen(true)}
                onSavePictures={() => setPicturesOpen(true)}
                onSnip={() => setSnipping(true)}
                canUndo={!!history.undoLabel && !history.running && !busy}
                canRedo={!!history.redoLabel && !history.running && !busy}
                undoLabel={history.undoLabel}
                redoLabel={history.redoLabel}
                onUndo={() => void history.undo()}
                onRedo={() => void history.redo()}
                undoing={history.running}
              />
              <div className="min-h-0 flex-1">
                {isPaged(doc.kind) ? (
                <PdfViewer
                  key={doc.id}
                  ref={viewerRef}
                  doc={doc}
                  initialPage={startPage}
                  zoom={zoom}
                  onZoomChange={changeZoom}
                  onPageChange={setPage}
                  onLoaded={onLoaded}
                  annotations={annotations}
                  tool={tool}
                  color={toolColor}
                  penWidth={penWidth}
                  onCreateAnnotation={createAnnotation}
                  onDeleteAnnotation={deleteAnnotation}
                  onRegion={(p, rect) => setTextRequest({ kind: "region", page: p, rect })}
                  onUpdateAnnotation={updateAnnotation}
                  onQuoteToNote={quoteToNote}
                />
                ) : (
                  <TextDocViewer
                    key={doc.id}
                    ref={viewerRef}
                    doc={doc}
                    zoom={zoom}
                    initialTop={startTop}
                    highlights={textHighlights}
                    tool={tool}
                    color={highlightColor}
                    onLoaded={onTextLoaded}
                    onScrollTop={onTextScroll}
                    onCreateHighlight={createTextHighlight}
                    onUpdateHighlight={updateTextHighlight}
                    onDeleteHighlights={deleteTextHighlights}
                    onQuoteToNote={(text) => quoteToNote(1, text)}
                  />
                )}
              </div>
            </>
          ) : (
            <Welcome
              loaded={libraryLoaded}
              hasFolders={directories.length > 0}
              docCount={documents.length}
              recent={recent}
              documents={documents}
              onOpen={(d) => requestOpen(d)}
              onSettings={() => setShowSettings(true)}
            />
          )}
        </main>

        {/* Right: resources */}
        {doc &&
          showRight &&
          (isDesktop ? (
            <>
              <ResizeHandle
                panel="right"
                label="Resize notes & resources"
                value={rightW}
                min={PANEL.right.min}
                max={rightMax}
                defaultValue={PANEL.right.default}
                onChange={setRightWidth}
              />
              <aside className="shrink-0 overflow-hidden bg-canvas" style={{ width: rightW }}>
                {rightPanel}
              </aside>
            </>
          ) : (
            <>
              <div className="absolute inset-0 z-30 bg-black/30" onClick={() => setMobilePanel(null)} />
              <aside className="absolute inset-y-0 right-0 z-40 w-[90vw] max-w-96 border-l border-line bg-canvas shadow-2xl">
                {rightPanel}
              </aside>
            </>
          ))}
      </div>

      {doc && (
        <StatusBar
          paged={isPaged(doc.kind)}
          page={page}
          pageCount={pageCount}
          zoom={zoom}
          onPage={goToPage}
          onZoom={changeZoom}
          onFitWidth={() => {
            const z = viewerRef.current?.fitWidthZoom();
            if (z) changeZoom(z);
          }}
          onFitPage={() => {
            const z = viewerRef.current?.fitPageZoom();
            if (z) changeZoom(z);
          }}
        />
      )}

      {showSettings && (
        <SettingsDialog
          directories={directories}
          config={config}
          onClose={() => setShowSettings(false)}
          onChanged={(m) => {
            void refreshLibrary();
            if (m) toast(m, "success");
          }}
          onError={(m) => toast(m, "error")}
        />
      )}

      {pageOp && doc && canEditFile(doc.kind) && (
        <PageOpsDialog
          op={pageOp}
          doc={doc}
          page={page}
          pageCount={pageCount}
          documents={pagedDocuments}
          busy={busy === "pages"}
          onClose={() => setPageOp(null)}
          resources={resources}
          annotations={annotations}
          onInsertBlank={(after, count) =>
            applyFileEdit(
              "pages",
              count === 1 ? `Insert blank page after page ${after}` : `Insert ${count} blank pages after page ${after}`,
              (d) => api.insertBlankPage(d.id, after, d.fingerprint, count),
              `Inserted ${count} blank page${count > 1 ? "s" : ""}`,
            )
          }
          onInsertFrom={(after, sourceDocumentId, fromPage, toPage) =>
            applyFileEdit(
              "pages",
              `Insert ${toPage - fromPage + 1} page${toPage > fromPage ? "s" : ""} after page ${after}`,
              (d) => api.insertPagesFrom(d.id, { after, sourceDocumentId, fromPage, toPage, fingerprint: d.fingerprint }),
              `Inserted ${toPage - fromPage + 1} page${toPage > fromPage ? "s" : ""}`,
            )
          }
          onReplace={(page, sourceDocumentId, fromPage, toPage, keepAnnotations) => {
            const n = toPage - fromPage + 1;
            const what = n === 1 ? `page ${page}` : `pages ${page}–${page + n - 1}`;
            return applyFileEdit(
              "pages",
              `Replace ${what}`,
              (d) => api.replacePages(d.id, { page, sourceDocumentId, fromPage, toPage, keepAnnotations, fingerprint: d.fingerprint }),
              `Replaced ${what}`,
            );
          }}
          onRotate={(pages, angle) =>
            applyFileEdit(
              "pages",
              `Turn ${describePages(pages)} ${angle === 180 ? "upside down" : angle === 90 ? "right" : "left"}`,
              (d) => api.rotatePages(d.id, pages, angle, d.fingerprint),
              `Turned ${describePages(pages)}`,
            )
          }
          onMove={(pages, after) =>
            applyFileEdit(
              "pages",
              `Move ${describePages(pages)} ${after === 0 ? "to the start" : `after page ${after}`}`,
              (d) => api.movePages(d.id, pages, after, d.fingerprint),
              `Moved ${describePages(pages)}`,
            )
          }
          onDelete={(pages, orphans) =>
            applyFileEdit(
              "pages",
              `Delete ${describePages(pages)}`,
              (d) => api.deletePages(d.id, pages, d.fingerprint, orphans),
              `Deleted ${describePages(pages)}`,
            )
          }
        />
      )}

      {pdfTool && doc && (
        <PdfToolsDialog
          key={`${doc.id}:${pdfTool}`}
          tool={pdfTool}
          doc={doc}
          page={page}
          pageCount={pageCount}
          documents={pagedDocuments}
          bookmarks={bookmarks}
          onClose={() => setPdfTool(null)}
          onCreated={() => void refreshLibrary().catch(toastError)}
          onRemovePages={(pages) =>
            applyFileEdit("pages", `Delete ${describePages(pages)}`, (d) => api.deletePages(d.id, pages, d.fingerprint, "delete"), `Removed ${describePages(pages)}`)
          }
          onOpen={(d) => {
            setPdfTool(null);
            requestOpen(d);
          }}
        />
      )}

      {halvesOpen && doc && (
        <PageHalvesDialog
          key={doc.id}
          getPdf={() => viewerRef.current?.getPdf() ?? null}
          title={doc.title}
          page={page}
          pageCount={pageCount}
          onClose={() => setHalvesOpen(false)}
          onError={toastError}
        />
      )}

      {picturesOpen && doc && (
        <PageImagesDialog
          key={doc.id}
          getPdf={() => viewerRef.current?.getPdf() ?? null}
          title={doc.title}
          page={page}
          pageCount={pageCount}
          onClose={() => setPicturesOpen(false)}
          onError={toastError}
          onDone={(m) => toast(m, "success")}
        />
      )}

      {textRequest && doc && (
        <GetTextDialog
          key={`${doc.id}:${textRequest.kind === "region" ? `${textRequest.page}:${textRequest.rect.x}:${textRequest.rect.y}` : JSON.stringify(textRequest.preset ?? {})}`}
          highlights={annotations}
          bookmarks={bookmarks}
          notes={resources}
          request={textRequest}
          doc={doc}
          page={page}
          pageCount={pageCount}
          getPdf={() => viewerRef.current?.getPdf() ?? null}
          onClose={() => setTextRequest(null)}
          onSaveNote={createResource}
          onApplyOcr={(jobId, pages) =>
            applyFileEdit(
              "pages",
              `Add OCR text layer (${describePages(pages)})`,
              (d) => api.applyOcr(jobId, d.fingerprint),
              "Text layer added to the PDF",
            )
          }
        />
      )}

      {pendingOpen && doc && (
        <UnsavedDialog
          title={doc.title}
          annotationsUnsaved={doc.annotationsDirty}
          bookmarksUnsaved={doc.bookmarksDirty}
          noteDraft={noteDraft}
          saving={busy === "save"}
          onCancel={cancelPendingOpen}
          onOpenAnyway={() => {
            setPendingOpen(null);
            void openDocument(pendingOpen.target, pendingOpen.atPage);
          }}
          onSaveAndOpen={async () => {
            const next = pendingOpen;
            if (await saveToFile()) {
              setPendingOpen(null);
              void openDocument(next.target, next.atPage);
            }
          }}
        />
      )}

      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}

      {snipping && <SnipOverlay onPick={finishSnip} onCancel={() => setSnipping(false)} />}

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}

/** "page 4" / "pages 3, 5–7" */
function describePages(pages: number[]): string {
  const sorted = [...pages].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return `${sorted.length === 1 ? "page" : "pages"} ${parts.join(", ")}`;
}

function Welcome({
  loaded,
  hasFolders,
  docCount,
  recent,
  documents,
  onOpen,
  onSettings,
}: {
  loaded: boolean;
  hasFolders: boolean;
  docCount: number;
  recent: (ReadingProgress & { title: string })[];
  documents: DocumentRecord[];
  onOpen: (d: DocumentRecord) => void;
  onSettings: () => void;
}) {
  if (!loaded) return <div className="flex-1 bg-viewer" />;
  return (
    <div className="grid flex-1 place-items-center overflow-y-auto bg-viewer p-6">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-panel p-6 text-center shadow-sm">
        <BookOpenText className="mx-auto size-10 text-accent" />
        <h1 className="mt-3 text-lg font-semibold">Welcome to StudySpace</h1>
        {!hasFolders ? (
          <>
            <p className="mt-2 text-sm text-ink-2">Add a folder containing your course PDFs. StudySpace reads them in place — nothing is copied or uploaded.</p>
            <button className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:brightness-110" onClick={onSettings}>
              Add study folder
            </button>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-2">
              {docCount} file{docCount === 1 ? "" : "s"} in your library. Pick one on the left, or search with <kbd className="rounded border border-line px-1 text-xs">Ctrl K</kbd>.
            </p>
            {recent.length > 0 && (
              <ul className="mt-4 space-y-1 text-left">
                {recent.slice(0, 5).map((r) => {
                  const d = documents.find((x) => x.id === r.documentId);
                  return (
                    d && (
                      <li key={r.documentId}>
                        <button className={cx("flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-hover")} onClick={() => onOpen(d)}>
                          <span className="truncate font-medium">{d.title}</span>
                          {isPaged(d.kind) && <span className="ml-auto shrink-0 text-xs text-ink-3">page {r.page}</span>}
                        </button>
                      </li>
                    )
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
