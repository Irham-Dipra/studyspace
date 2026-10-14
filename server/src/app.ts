import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import type { AppConfig } from "./config.js";
import type { DB } from "./db/index.js";
import type { AIProvider } from "./ai/index.js";
import { deleteDirectory, insertDirectory, listDirectories, updateDirectory } from "./db/directories.js";
import { getDocument, listDocuments, setPageCount } from "./db/documents.js";
import {
  createResource,
  deleteResource,
  getResource,
  listResources,
  listResourcesForPage,
  searchResources,
  updateResource,
} from "./db/resources.js";
import { createAnnotation, deleteAnnotation, listAnnotations, updateAnnotation } from "./db/annotations.js";
import { createBookmark, deleteBookmark, importOutline, listBookmarks, updateBookmark, type OutlineEntry } from "./db/bookmarks.js";
import {
  createNoteHighlight,
  deleteNoteHighlight,
  listNoteHighlightsForDocument,
  updateNoteHighlight,
} from "./db/noteHighlights.js";
import { getProgress, recentDocuments, saveProgress } from "./db/progress.js";
import { syncLibrary } from "./library/sync.js";
import {
  insertBlank,
  insertFromDocument,
  replaceFromDocument,
  applyOcrLayer,
  listHistory,
  removePages,
  moveDocumentPages,
  rotateDocumentPages,
  undoEdit,
  resolveDocumentFile,
  saveAnnotationsToFile,
  type EditorOptions,
} from "./services/documentEditor.js";
import { createPdfs, listLibraryFolders } from "./services/pdfTools.js";
import { INSTALL_HINT, OcrJobs, ocrImage, ocrStatus, publicJob } from "./services/ocr.js";
import { ANNOTATION_KINDS, HttpError, RESOURCE_SCOPES, RESOURCE_TYPES } from "./types.js";

export interface AppDeps {
  db: DB;
  config: AppConfig;
  ai: AIProvider;
}

const page = z.number().int().min(1);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const unit = z.number().min(-0.05).max(1.05);

const clientId = z.string().uuid().optional();

const resourceCreate = z.object({
  id: clientId,
  type: z.enum(RESOURCE_TYPES),
  scope: z.enum(RESOURCE_SCOPES),
  pageStart: page.nullish(),
  pageEnd: page.nullish(),
  title: z.string().max(500).optional(),
  content: z.string().max(1_000_000).optional(),
  url: z.string().url().max(4000).nullish().or(z.literal("").transform(() => null)),
});
const resourcePatch = resourceCreate.omit({ id: true }).partial();

const annotationCreate = z.object({
  id: clientId,
  page,
  kind: z.enum(ANNOTATION_KINDS),
  color,
  opacity: z.number().min(0.05).max(1).optional(),
  rects: z.array(z.object({ x: unit, y: unit, w: z.number().min(0).max(1.1), h: z.number().min(0).max(1.1) })).max(500).optional(),
  paths: z.array(z.array(z.tuple([unit, unit])).max(5000)).max(200).optional(),
  strokeWidth: z.number().min(0.0005).max(0.1).optional(),
  text: z.string().max(20000).optional(),
});

const bookmarkTitle = z.string().trim().min(1).max(1000);
const bookmarkCreate = z.object({
  id: clientId,
  title: bookmarkTitle,
  page,
  top: unit.nullish(),
  parentId: z.string().uuid().nullish(),
  position: z.number().finite().optional(),
});
const bookmarkPatch = bookmarkCreate.omit({ id: true }).partial();
const outlineEntry: z.ZodType<OutlineEntry> = z.lazy(() =>
  z.object({
    title: z.string().max(1000).transform((t) => t.trim() || "Untitled"),
    page,
    top: unit.nullish(),
    children: z.array(outlineEntry).max(5000).optional(),
  }),
);

const directoryCreate = z.object({
  path: z.string().min(1),
  label: z.string().max(200).optional(),
  excludes: z.array(z.string().max(500)).max(200).optional(),
});

const fp = z.string().optional();

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : (v as string);
}

export function createApp({ db, config, ai }: AppDeps): express.Express {
  const app = express();
  const editor: EditorOptions = { dataDir: config.dataDir, historyLimit: config.historyLimit };
  const ocrJobs = new OcrJobs(config.dataDir, config.ocr);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "5mb" }));

  const api = express.Router();

  api.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  api.get("/config", (_req, res) => {
    res.json({
      dataDir: config.dataDir,
      databasePath: path.join(config.dataDir, "studyspace.db"),
      historyLimit: config.historyLimit,
      ai: { provider: ai.id, enabled: ai.enabled, message: ai.statusMessage },
    });
  });

  // ---- Directories -------------------------------------------------------
  api.get("/directories", (_req, res) => {
    res.json(listDirectories(db));
  });

  api.post("/directories", async (req, res) => {
    const body = directoryCreate.parse(req.body);
    const abs = path.resolve(body.path.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
    let real: string;
    try {
      real = fs.realpathSync(abs);
      if (!fs.statSync(real).isDirectory()) throw new Error();
    } catch {
      throw new HttpError(400, `Not an existing directory: ${abs}`);
    }
    if (listDirectories(db).some((d) => d.path === real)) throw new HttpError(409, "Directory is already configured");
    const dir = insertDirectory(db, {
      path: real,
      label: body.label?.trim() || path.basename(real) || real,
      excludes: body.excludes ?? [],
    });
    const scan = await syncLibrary(db);
    res.status(201).json({ directory: dir, scan });
  });

  api.patch("/directories/:id", async (req, res) => {
    const body = z
      .object({ label: z.string().max(200).optional(), excludes: z.array(z.string()).optional(), enabled: z.boolean().optional() })
      .parse(req.body);
    const dir = updateDirectory(db, Number(param(req, "id")), body);
    if (!dir) throw new HttpError(404, "Directory not found");
    const scan = await syncLibrary(db);
    res.json({ directory: dir, scan });
  });

  api.delete("/directories/:id", async (req, res) => {
    if (!deleteDirectory(db, Number(param(req, "id")))) throw new HttpError(404, "Directory not found");
    // Documents are kept (marked missing) so notes survive if the directory is re-added later.
    await syncLibrary(db);
    res.status(204).end();
  });

  /** Lists sub-directories of a path so the settings UI can offer a folder picker. Directories only. */
  api.get("/fs/browse", (req, res) => {
    const requested = typeof req.query.path === "string" && req.query.path ? req.query.path : (process.env.HOME ?? "/");
    const abs = path.resolve(requested);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      throw new HttpError(400, `Cannot read directory: ${abs}`);
    }
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const pdfCount = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf")).length;
    res.json({ path: abs, parent: path.dirname(abs) === abs ? null : path.dirname(abs), dirs, pdfCount });
  });

  // ---- Library -----------------------------------------------------------
  api.get("/library", (_req, res) => {
    res.json({ directories: listDirectories(db), documents: listDocuments(db) });
  });

  api.post("/library/scan", async (_req, res) => {
    res.json(await syncLibrary(db));
  });

  api.get("/recent", (_req, res) => {
    res.json(recentDocuments(db));
  });

  api.get("/search", (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      res.json({ documents: [], resources: [] });
      return;
    }
    const needle = q.toLowerCase();
    const documents = listDocuments(db)
      .filter((d) => d.title.toLowerCase().includes(needle) || d.relPath.toLowerCase().includes(needle))
      .slice(0, 30);
    res.json({ documents, resources: searchResources(db, q) });
  });

  // ---- Documents ---------------------------------------------------------
  const requireDoc = (id: string) => {
    const doc = getDocument(db, id);
    if (!doc) throw new HttpError(404, "Document not found");
    return doc;
  };

  api.get("/documents/:id", (req, res) => {
    const doc = requireDoc(param(req, "id"));
    res.json({ ...doc, progress: getProgress(db, doc.id) ?? null });
  });

  /** Streams the PDF straight from its location on disk (supports HTTP Range requests). */
  api.get("/documents/:id/file", (req, res, next) => {
    const { doc, file } = resolveDocumentFile(db, param(req, "id"));
    res.sendFile(
      file,
      {
        dotfiles: "allow",
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(doc.path))}`,
          "Cache-Control": "private, no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      },
      (err) => {
        if (err && !res.headersSent) next(err);
      },
    );
  });

  api.patch("/documents/:id/meta", (req, res) => {
    const body = z.object({ pageCount: z.number().int().min(1) }).parse(req.body);
    const doc = requireDoc(param(req, "id"));
    setPageCount(db, doc.id, body.pageCount);
    res.json(getDocument(db, doc.id));
  });

  api.get("/documents/:id/progress", (req, res) => {
    const doc = requireDoc(param(req, "id"));
    res.json(getProgress(db, doc.id) ?? { documentId: doc.id, page: 1, zoom: 1, updatedAt: null });
  });

  api.put("/documents/:id/progress", (req, res) => {
    const body = z.object({ page, zoom: z.number().min(0.1).max(8) }).parse(req.body);
    const doc = requireDoc(param(req, "id"));
    res.json(saveProgress(db, doc.id, body.page, body.zoom));
  });

  // ---- Resources ---------------------------------------------------------
  api.get("/documents/:id/resources", (req, res) => {
    const doc = requireDoc(param(req, "id"));
    if (req.query.page !== undefined) {
      const p = page.parse(Number(req.query.page));
      res.json(listResourcesForPage(db, doc.id, p));
    } else {
      res.json(listResources(db, doc.id));
    }
  });

  api.post("/documents/:id/resources", (req, res) => {
    const doc = requireDoc(param(req, "id"));
    const body = resourceCreate.parse(req.body);
    try {
      res.status(201).json(createResource(db, doc.id, body));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  api.get("/resources/:id", (req, res) => {
    const r = getResource(db, param(req, "id"));
    if (!r) throw new HttpError(404, "Resource not found");
    res.json(r);
  });

  api.patch("/resources/:id", (req, res) => {
    const body = resourcePatch.parse(req.body);
    let r;
    try {
      r = updateResource(db, param(req, "id"), body);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    if (!r) throw new HttpError(404, "Resource not found");
    res.json(r);
  });

  api.delete("/resources/:id", (req, res) => {
    if (!deleteResource(db, param(req, "id"))) throw new HttpError(404, "Resource not found");
    res.status(204).end();
  });

  // ---- Highlights inside notes/resources --------------------------------
  const noteHighlightCreate = z.object({
    id: clientId,
    color,
    quote: z.string().min(1).max(20000),
    prefix: z.string().max(200).optional(),
    suffix: z.string().max(200).optional(),
    comment: z.string().max(20000).optional(),
  });

  api.get("/documents/:id/note-highlights", (req, res) => {
    const doc = requireDoc(param(req, "id"));
    res.json(listNoteHighlightsForDocument(db, doc.id));
  });

  api.post("/resources/:id/highlights", (req, res) => {
    const r = getResource(db, param(req, "id"));
    if (!r) throw new HttpError(404, "Resource not found");
    const body = noteHighlightCreate.parse(req.body);
    try {
      res.status(201).json(createNoteHighlight(db, r.id, body));
    } catch (err) {
      throw new HttpError(409, (err as Error).message);
    }
  });

  api.patch("/note-highlights/:id", (req, res) => {
    const body = z.object({ color: color.optional(), comment: z.string().max(20000).optional() }).parse(req.body);
    const h = updateNoteHighlight(db, param(req, "id"), body);
    if (!h) throw new HttpError(404, "Highlight not found");
    res.json(h);
  });

  api.delete("/note-highlights/:id", (req, res) => {
    if (!deleteNoteHighlight(db, param(req, "id"))) throw new HttpError(404, "Highlight not found");
    res.status(204).end();
  });

  // ---- Annotations -------------------------------------------------------
  api.get("/documents/:id/annotations", (req, res) => {
    const doc = requireDoc(param(req, "id"));
    res.json(listAnnotations(db, doc.id));
  });

  api.post("/documents/:id/annotations", (req, res) => {
    const doc = requireDoc(param(req, "id"));
    const body = annotationCreate.parse(req.body);
    try {
      res.status(201).json(createAnnotation(db, doc.id, body));
    } catch (err) {
      throw new HttpError(409, (err as Error).message);
    }
  });

  api.patch("/annotations/:id", (req, res) => {
    const body = z
      .object({ color: color.optional(), opacity: z.number().min(0.05).max(1).optional(), text: z.string().max(20000).optional() })
      .parse(req.body);
    const a = updateAnnotation(db, param(req, "id"), body);
    if (!a) throw new HttpError(404, "Annotation not found");
    res.json(a);
  });

  api.delete("/annotations/:id", (req, res) => {
    if (!deleteAnnotation(db, param(req, "id"))) throw new HttpError(404, "Annotation not found");
    res.status(204).end();
  });

  // ---- Bookmarks (the PDF outline) ---------------------------------------
  const bookmarkResponse = (id: string) => {
    const doc = requireDoc(id);
    return { imported: doc.outlineImported, bookmarks: listBookmarks(db, id) };
  };

  api.get("/documents/:id/bookmarks", (req, res) => {
    res.json(bookmarkResponse(param(req, "id")));
  });

  // Stores the PDF's own outline (read by the browser with pdf.js) the first time a PDF is opened.
  api.post("/documents/:id/bookmarks/import", (req, res) => {
    const doc = requireDoc(param(req, "id"));
    const { entries } = z.object({ entries: z.array(outlineEntry).max(5000) }).parse(req.body);
    let count = 0;
    const clamp = (list: OutlineEntry[]): OutlineEntry[] =>
      list.map((e) => {
        count++;
        return { ...e, page: Math.min(e.page, doc.pageCount ?? e.page), children: e.children && clamp(e.children) };
      });
    const clamped = clamp(entries);
    if (count > 20000) throw new HttpError(413, "This outline is too large to import.");
    importOutline(db, doc.id, clamped);
    res.json(bookmarkResponse(doc.id));
  });

  api.post("/documents/:id/bookmarks", (req, res) => {
    const doc = requireDoc(param(req, "id"));
    const body = bookmarkCreate.parse(req.body);
    res.status(201).json(createBookmark(db, doc.id, body));
  });

  api.patch("/bookmarks/:id", (req, res) => {
    const b = updateBookmark(db, param(req, "id"), bookmarkPatch.parse(req.body));
    if (!b) throw new HttpError(404, "Bookmark not found");
    res.json(b);
  });

  api.delete("/bookmarks/:id", (req, res) => {
    if (!deleteBookmark(db, param(req, "id"))) throw new HttpError(404, "Bookmark not found");
    res.status(204).end();
  });

  // ---- File edits (rewrite the original PDF in place) ---------------------
  api.post("/documents/:id/annotations/save", async (req, res) => {
    const body = z.object({ fingerprint: fp }).parse(req.body ?? {});
    res.json(await saveAnnotationsToFile(db, editor, param(req, "id"), body.fingerprint));
  });

  api.post("/documents/:id/pages/insert-blank", async (req, res) => {
    const body = z
      .object({ after: z.number().int().min(0), count: z.number().int().min(1).max(50).default(1), fingerprint: fp })
      .parse(req.body);
    res.json(await insertBlank(db, editor, param(req, "id"), body.after, body.count, body.fingerprint));
  });

  api.post("/documents/:id/pages/insert-from", async (req, res) => {
    const body = z
      .object({ after: z.number().int().min(0), sourceDocumentId: z.string(), fromPage: page, toPage: page, fingerprint: fp })
      .parse(req.body);
    res.json(await insertFromDocument(db, editor, param(req, "id"), body, body.fingerprint));
  });

  api.post("/documents/:id/pages/replace", async (req, res) => {
    const body = z
      .object({
        page,
        sourceDocumentId: z.string(),
        fromPage: page,
        toPage: page,
        keepAnnotations: z.boolean().default(false),
        fingerprint: fp,
      })
      .parse(req.body);
    res.json(await replaceFromDocument(db, editor, param(req, "id"), body, body.fingerprint));
  });

  api.post("/documents/:id/pages/delete", async (req, res) => {
    const body = z
      .object({ pages: z.array(page).min(1).max(5000), fingerprint: fp, orphans: z.enum(["delete", "document"]).default("delete") })
      .parse(req.body);
    res.json(await removePages(db, editor, param(req, "id"), body.pages, body.fingerprint, body.orphans));
  });

  // ---- Undo history for file edits ------------------------------------------
  api.post("/documents/:id/pages/rotate", async (req, res) => {
    const body = z
      .object({ pages: z.array(page).min(1).max(20000), angle: z.union([z.literal(90), z.literal(180), z.literal(270)]), fingerprint: fp })
      .parse(req.body);
    res.json(await rotateDocumentPages(db, editor, param(req, "id"), body.pages, body.angle, body.fingerprint));
  });

  api.post("/documents/:id/pages/move", async (req, res) => {
    const body = z
      .object({ pages: z.array(page).min(1).max(20000), after: z.number().int().min(0), fingerprint: fp })
      .parse(req.body);
    res.json(await moveDocumentPages(db, editor, param(req, "id"), body.pages, body.after, body.fingerprint));
  });

  // ---- New PDFs from pages of library PDFs: extract, split, merge -----------
  api.get("/library/folders", async (_req, res) => {
    res.json(await listLibraryFolders(db));
  });

  const segment = z.object({ documentId: z.string(), pages: z.array(page).max(20000).optional(), title: z.string().max(1000).optional() });
  api.post("/pdf-tools/create", async (req, res) => {
    const body = z
      .object({
        folder: z.string().min(1).max(4096),
        newFolder: z.string().max(200).optional(),
        outputs: z.array(z.object({ name: z.string().max(300), segments: z.array(segment).min(1).max(500) })).min(1).max(500),
        copyNotes: z.boolean().default(true),
        copyHighlights: z.boolean().default(true),
        copyBookmarks: z.boolean().default(true),
        bookmarkPerSource: z.boolean().default(false),
      })
      .parse(req.body);
    res.status(201).json(await createPdfs(db, body));
  });

  api.get("/documents/:id/history", (req, res) => {
    const doc = requireDoc(param(req, "id"));
    res.json(listHistory(db, doc.id));
  });

  api.post("/documents/:id/history/:editId/undo", async (req, res) => {
    res.json(await undoEdit(db, editor, param(req, "id"), param(req, "editId")));
  });

  // ---- OCR (optional; only ever runs when the user asks) --------------------
  api.get("/ocr/status", async (_req, res) => {
    res.json(await ocrStatus(config.ocr));
  });

  // OCRs pages of a *copy* of the PDF. The library file is untouched until /apply.
  api.post("/documents/:id/ocr", async (req, res) => {
    const body = z.object({ pages: z.array(page).min(1).max(5000), fingerprint: fp }).parse(req.body);
    const { doc, file } = resolveDocumentFile(db, param(req, "id"));
    if (body.fingerprint && body.fingerprint !== doc.fingerprint) {
      throw new HttpError(409, "The PDF changed on disk since it was opened. Reload it and try again.");
    }
    if (!(await ocrStatus(config.ocr)).ocrmypdf.available) throw new HttpError(501, `OCRmyPDF is not installed. ${INSTALL_HINT}`);
    const job = await ocrJobs.start(doc.id, file, doc.fingerprint, body.pages);
    res.status(202).json(publicJob(job));
  });

  api.get("/ocr/jobs/:jobId", (req, res) => {
    res.json(publicJob(ocrJobs.get(param(req, "jobId"))));
  });

  // The OCRed copy, so the client can read its text (with pdf.js, like any PDF).
  api.get("/ocr/jobs/:jobId/file", async (req, res) => {
    const { job } = await ocrJobs.output(param(req, "jobId"));
    // dotfiles: the data dir is usually under ~/.local, which sendFile would otherwise refuse (404).
    res.sendFile(job.outFile, { dotfiles: "allow", headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" } });
  });

  // "Add to PDF": puts the OCRed copy (with its invisible text layer) in place of the library file.
  api.post("/ocr/jobs/:jobId/apply", async (req, res) => {
    const body = z.object({ fingerprint: fp }).parse(req.body ?? {});
    const { job, bytes } = await ocrJobs.output(param(req, "jobId"));
    const doc = requireDoc(job.documentId);
    const stale = new HttpError(409, "This PDF changed after the OCR ran, so the text layer can't be added. Run OCR again.");
    if (doc.fingerprint !== job.sourceFingerprint || (body.fingerprint && body.fingerprint !== doc.fingerprint)) throw stale;
    let result;
    try {
      result = await applyOcrLayer(db, editor, doc.id, bytes, job.sourceFingerprint, job.pages);
    } catch (e) {
      throw e instanceof HttpError && e.status === 409 ? stale : e;
    }
    // The result is kept until it expires, so Ctrl+Z then Ctrl+Shift+Z can apply it again (it only
    // ever applies to the exact file version it was made from).
    res.json(result);
  });

  api.delete("/ocr/jobs/:jobId", async (req, res) => {
    await ocrJobs.discard(param(req, "jobId"));
    res.status(204).end();
  });

  // OCR of a region: the client renders the part of the page and sends it as a PNG.
  api.post("/ocr/image", express.raw({ type: "image/png", limit: "25mb" }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, "Send the region as a PNG image.");
    if (!(await ocrStatus(config.ocr)).tesseract.available) throw new HttpError(501, `Tesseract is not installed. ${INSTALL_HINT}`);
    res.json({ text: await ocrImage(config.ocr, req.body) });
  });

  // ---- AI (optional; disabled unless a provider is configured) -------------
  api.get("/ai/status", (_req, res) => {
    res.json({ provider: ai.id, enabled: ai.enabled, message: ai.statusMessage });
  });

  api.post("/ai/generate", async (req, res) => {
    const body = z
      .object({
        documentId: z.string(),
        task: z.enum(["explain", "summarize"]),
        pageStart: page,
        pageEnd: page,
        text: z.string().max(200_000),
      })
      .parse(req.body);
    const doc = requireDoc(body.documentId);
    if (!ai.enabled) throw new HttpError(503, ai.statusMessage);
    const out = await ai.generate({ ...body, documentTitle: doc.title });
    const resource = createResource(db, doc.id, {
      type: body.task === "summarize" ? "summary" : "ai_explanation",
      scope: body.pageStart === body.pageEnd ? "page" : "range",
      pageStart: body.pageStart,
      pageEnd: body.pageEnd,
      title: out.title,
      content: out.content,
    });
    res.status(201).json(resource);
  });

  app.use("/api", api);
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));

  // Production: serve the built frontend from the same origin.
  if (config.webDistDir && fs.existsSync(path.join(config.webDistDir, "index.html"))) {
    const dist = path.resolve(config.webDistDir);
    app.use(express.static(dist, { index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "Invalid request", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      return;
    }
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const e = err as { status?: number; statusCode?: number; message?: string; code?: string };
    const status = e.status ?? e.statusCode ?? (e.code === "ENOENT" ? 404 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? "Internal server error" : (e.message ?? "Error") });
  });

  return app;
}
