import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OcrConfig } from "../config.js";
import { loadPdf } from "../pdf/operations.js";
import { HttpError } from "../types.js";

/**
 * OCR via the system's OCRmyPDF (whole pages) and Tesseract (a region of a page).
 *
 * Nothing here ever writes to a library file. Page OCR works on a copy in <dataDir>/tmp/ocr/<job>/,
 * and only an explicit "Add to PDF" (documentEditor.applyOcrLayer) puts the result into the library,
 * as an undoable edit.
 */

export const INSTALL_HINT = "Install it once with: sudo apt install ocrmypdf tesseract-ocr";

interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

/** Runs a program without a shell. A missing program becomes a 501 with the install hint. */
function run(
  cmd: string,
  args: string[],
  opts: { input?: Buffer; timeoutMs: number; onStderr?: (text: string) => void; signal?: AbortSignal },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], signal: opts.signal });
    const out: Buffer[] = [];
    let err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs);
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => {
      const text = b.toString("utf8");
      err = (err + text).slice(-64_000);
      opts.onStderr?.(text);
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (e.code === "ENOENT") reject(new HttpError(501, `${path.basename(cmd)} is not installed. ${INSTALL_HINT}`));
      else if (e.name === "AbortError") reject(new HttpError(499, "OCR was cancelled."));
      else reject(e);
    });
    child.on("close", (code, sig) => {
      clearTimeout(timer);
      if (sig === "SIGKILL" && !opts.signal?.aborted) return reject(new HttpError(504, "OCR took too long and was stopped."));
      resolve({ code, stdout: Buffer.concat(out), stderr: err });
    });
    child.stdin.on("error", () => undefined); // the program may exit before reading all input
    child.stdin.end(opts.input);
  });
}

const lastLines = (text: string, n = 3) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .join(" · ");

// ---- Status ----------------------------------------------------------------------------

export interface OcrStatus {
  available: boolean;
  /** Whole-page OCR (and "Add to PDF"). */
  ocrmypdf: { available: boolean; version?: string };
  /** Region OCR. */
  tesseract: { available: boolean; version?: string; languages: string[] };
  language: string;
  installHint: string;
}

let cached: { at: number; key: string; value: OcrStatus } | null = null;

export async function ocrStatus(cfg: OcrConfig): Promise<OcrStatus> {
  const key = `${cfg.ocrmypdf}|${cfg.tesseract}|${cfg.language}`;
  // Re-check every time while something is missing (so installing it is noticed without a restart).
  if (cached && cached.key === key && cached.value.available && Date.now() - cached.at < 5 * 60_000) return cached.value;
  const version = async (cmd: string) => {
    try {
      const r = await run(cmd, ["--version"], { timeoutMs: 15_000 });
      const line = (r.stdout.toString("utf8") || r.stderr).split("\n").find((l) => l.trim());
      return r.code === 0 ? (line?.trim() ?? "unknown") : undefined;
    } catch {
      return undefined;
    }
  };
  const [ocrmypdfVersion, tesseractVersion] = await Promise.all([version(cfg.ocrmypdf), version(cfg.tesseract)]);
  let languages: string[] = [];
  if (tesseractVersion) {
    try {
      const r = await run(cfg.tesseract, ["--list-langs"], { timeoutMs: 15_000 });
      languages = (r.stdout.toString("utf8") || r.stderr)
        .split("\n")
        .slice(1)
        .map((l) => l.trim())
        .filter((l) => /^[\w-]+$/.test(l));
    } catch {
      /* keep empty */
    }
  }
  const value: OcrStatus = {
    available: !!ocrmypdfVersion && !!tesseractVersion,
    ocrmypdf: { available: !!ocrmypdfVersion, version: ocrmypdfVersion },
    tesseract: { available: !!tesseractVersion, version: tesseractVersion, languages },
    language: cfg.language,
    installHint: INSTALL_HINT,
  };
  cached = { at: Date.now(), key, value };
  return value;
}

/** "1-3,7" for OCRmyPDF's --pages. */
export function compactPages(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(i === j ? `${sorted[i]}` : `${sorted[i]}-${sorted[j]}`);
    i = j;
  }
  return parts.join(",");
}

// ---- Page OCR ---------------------------------------------------------------------------

/**
 * Runs OCRmyPDF on `inFile`, writing `outFile`. Only `pages` are processed.
 *
 * --redo-ocr OCRs whatever is in the page images and leaves visible text untouched (no duplicates
 * on slides). Unlike --skip-text it isn't fooled by scans that carry a tiny text stamp such as
 * "45.jpg" or "Scanned with CamScanner", which made --skip-text skip every page. No rotation,
 * deskewing, image optimisation or PDF/A conversion: pages keep their exact geometry and look, so
 * highlights still line up afterwards.
 */
export async function ocrPdfPages(
  cfg: OcrConfig,
  inFile: string,
  outFile: string,
  pages: number[],
  onPage: (pageNumber: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const jobs = Math.max(1, Math.min(8, os.availableParallelism() - 1));
  const args = ["--pages", compactPages(pages), "--redo-ocr", "--output-type", "pdf", "--optimize", "0", "-l", cfg.language, "--jobs", String(jobs), inFile, outFile];
  const r = await run(cfg.ocrmypdf, args, {
    timeoutMs: 60 * 60_000,
    signal,
    // OCRmyPDF prefixes per-page log lines with the page number; use them as progress.
    onStderr: (text) => {
      for (const m of text.matchAll(/^\s*(\d+)\s+\S/gm)) onPage(Number(m[1]));
    },
  });
  if (r.code === 0) return;
  const detail = lastLines(r.stderr);
  switch (r.code) {
    case 2:
      throw new HttpError(422, `OCRmyPDF could not read this PDF. ${detail}`);
    case 3:
      throw new HttpError(501, `OCRmyPDF is missing something it needs (often a language pack, e.g. tesseract-ocr-${cfg.language.split("+").pop()}). ${detail}`);
    case 4:
      throw new HttpError(422, `OCRmyPDF produced a PDF that didn't pass its own check, so it wasn't used. ${detail}`);
    case 8:
      throw new HttpError(422, "This PDF is encrypted, so it can't be OCRed.");
    default:
      throw new HttpError(500, `OCR failed (OCRmyPDF exit code ${r.code}). ${detail}`);
  }
}

// ---- Region OCR -------------------------------------------------------------------------

/** OCRs one image (a region cut out of a page) with Tesseract and returns its text. */
export async function ocrImage(cfg: OcrConfig, png: Buffer): Promise<string> {
  const r = await run(cfg.tesseract, ["stdin", "stdout", "-l", cfg.language], { input: png, timeoutMs: 120_000 });
  if (r.code !== 0) throw new HttpError(500, `Tesseract failed: ${lastLines(r.stderr) || `exit code ${r.code}`}`);
  return r.stdout.toString("utf8").replace(/\f/g, "").trim();
}

// ---- Jobs ---------------------------------------------------------------------------------

export interface OcrJob {
  id: string;
  documentId: string;
  /** Fingerprint of the file the OCR was run on; "Add to PDF" refuses if the file changed since. */
  sourceFingerprint: string;
  pages: number[];
  state: "running" | "done" | "failed";
  /** Pages OCRmyPDF has reported on so far (best effort). */
  progress: number;
  error?: string;
  dir: string;
  outFile: string;
  startedAt: number;
  finishedAt?: number;
  abort: AbortController;
}

export type PublicOcrJob = Pick<OcrJob, "id" | "documentId" | "pages" | "state" | "progress" | "error" | "startedAt" | "finishedAt">;

export const publicJob = (j: OcrJob): PublicOcrJob => ({
  id: j.id,
  documentId: j.documentId,
  pages: j.pages,
  state: j.state,
  progress: j.progress,
  error: j.error,
  startedAt: j.startedAt,
  finishedAt: j.finishedAt,
});

/** Page-OCR jobs. Results live in temp files until applied or discarded (or 30 minutes pass). */
export class OcrJobs {
  private jobs = new Map<string, OcrJob>();
  private readonly root: string;
  private sweeper: NodeJS.Timeout;

  constructor(
    dataDir: string,
    private cfg: OcrConfig,
    private ttlMs = 30 * 60_000,
  ) {
    this.root = path.join(dataDir, "tmp", "ocr");
    // Leftovers from a previous run were never applied: they're just temp files.
    rmSync(this.root, { recursive: true, force: true });
    this.sweeper = setInterval(() => void this.sweep(), 60_000);
    this.sweeper.unref();
  }

  /** Copies the PDF to a temp folder and starts OCRmyPDF on the copy. The library file is only read. */
  async start(documentId: string, file: string, fingerprint: string, pages: number[]): Promise<OcrJob> {
    for (const j of this.jobs.values()) {
      if (j.documentId === documentId && j.state === "running") throw new HttpError(409, "OCR is already running for this PDF.");
    }
    const id = randomUUID();
    const dir = path.join(this.root, id);
    await fs.mkdir(dir, { recursive: true });
    const inFile = path.join(dir, "in.pdf");
    try {
      await fs.copyFile(file, inFile);
      const count = (await loadPdf(await fs.readFile(inFile))).getPageCount();
      const bad = pages.find((p) => p < 1 || p > count);
      if (bad !== undefined) throw new HttpError(400, `Page ${bad} is out of range (the PDF has ${count} pages).`);
    } catch (e) {
      await fs.rm(dir, { recursive: true, force: true });
      throw e;
    }
    const job: OcrJob = {
      id,
      documentId,
      sourceFingerprint: fingerprint,
      pages: [...new Set(pages)].sort((a, b) => a - b),
      state: "running",
      progress: 0,
      dir,
      outFile: path.join(dir, "out.pdf"),
      startedAt: Date.now(),
      abort: new AbortController(),
    };
    this.jobs.set(id, job);
    const seen = new Set<number>();
    ocrPdfPages(this.cfg, inFile, job.outFile, job.pages, (p) => {
      if (job.pages.includes(p)) seen.add(p);
      job.progress = seen.size;
    }, job.abort.signal).then(
      () => {
        job.state = "done";
        job.progress = job.pages.length;
        job.finishedAt = Date.now();
        void fs.rm(inFile, { force: true });
      },
      (e: unknown) => {
        job.state = "failed";
        job.error = e instanceof Error ? e.message : String(e);
        job.finishedAt = Date.now();
      },
    );
    return job;
  }

  get(id: string): OcrJob {
    const job = this.jobs.get(id);
    if (!job) throw new HttpError(404, "This OCR result is no longer available. Run OCR again.");
    return job;
  }

  /** The OCRed PDF of a finished job. */
  async output(id: string): Promise<{ job: OcrJob; bytes: Buffer }> {
    const job = this.get(id);
    if (job.state !== "done") throw new HttpError(409, job.state === "running" ? "OCR is still running." : (job.error ?? "OCR failed."));
    return { job, bytes: await fs.readFile(job.outFile) };
  }

  async discard(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    job.abort.abort();
    this.jobs.delete(id);
    await fs.rm(job.dir, { recursive: true, force: true });
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    for (const j of [...this.jobs.values()]) {
      if (j.finishedAt && now - j.finishedAt > this.ttlMs) await this.discard(j.id);
    }
  }

  close(): void {
    clearInterval(this.sweeper);
    for (const j of this.jobs.values()) j.abort.abort();
  }
}
