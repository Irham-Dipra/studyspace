import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SlidesConfig } from "../config.js";
import type { DocumentRecord } from "../types.js";
import { HttpError } from "../types.js";

export const LIBREOFFICE_HINT = "Install LibreOffice (sudo snap install libreoffice, or sudo apt install libreoffice-impress) to open slides.";

/** Generous: the first start of a snap LibreOffice alone takes ~30 s, and big decks take longer. */
const TIMEOUT_MS = 10 * 60_000;

/**
 * Turns PowerPoint files into PDFs with LibreOffice, so the viewer, notes and highlights work on
 * them like on any PDF. The PDF is kept in <dataDir>/converted/<docId>-<fingerprint>.pdf and is made
 * again only when the slides change. One conversion runs at a time (LibreOffice is heavy).
 */
export class SlideConverter {
  private running = new Map<string, Promise<string>>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private dataDir: string,
    private config: SlidesConfig,
  ) {}

  pdfPath(doc: Pick<DocumentRecord, "id" | "fingerprint">): string {
    return convertedPdfPath(this.dataDir, doc);
  }

  /** The converted PDF if it is ready, else null. */
  ready(doc: Pick<DocumentRecord, "id" | "fingerprint">): string | null {
    const file = this.pdfPath(doc);
    return existsSync(file) ? file : null;
  }

  /** The converted PDF, converting `file` first when needed. Waits for a conversion already running. */
  convert(doc: DocumentRecord, file: string): Promise<string> {
    const out = this.pdfPath(doc);
    if (existsSync(out)) return Promise.resolve(out);
    let job = this.running.get(out);
    if (!job) {
      job = this.queue.catch(() => undefined).then(() => this.run(doc, file, out));
      this.queue = job;
      this.running.set(out, job);
      job.then(
        () => this.running.delete(out),
        () => this.running.delete(out),
      );
    }
    return job;
  }

  private async run(doc: DocumentRecord, file: string, out: string): Promise<string> {
    if (existsSync(out)) return out;
    const soffice = this.config.soffice || findOnPath(["soffice", "libreoffice"]);
    if (!soffice) throw new HttpError(501, `LibreOffice is not installed. ${LIBREOFFICE_HINT}`);
    const workRoot = this.config.workDir || defaultWorkDir(soffice, this.dataDir);
    const jobDir = path.join(workRoot, randomUUID());
    await fs.mkdir(jobDir, { recursive: true });
    try {
      // Work on a copy: LibreOffice may not be allowed to read the library folder (snap), and this
      // way it can never write next to the user's file.
      const input = path.join(jobDir, `slides${path.extname(file).toLowerCase()}`);
      await fs.copyFile(file, input);
      const args = [
        // Own profile: works while the user has LibreOffice open, and never touches their settings.
        `-env:UserInstallation=${pathToFileURL(path.join(workRoot, "profile")).href}`,
        "--headless",
        "--norestore",
        "--nologo",
        "--convert-to",
        "pdf",
        "--outdir",
        jobDir,
        input,
      ];
      const result = await new Promise<{ code: number | string | null; stderr: string }>((resolve) => {
        execFile(soffice, args, { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, _stdout, stderr) =>
          resolve({ code: err ? ((err as NodeJS.ErrnoException).code ?? 1) : 0, stderr: String(stderr) }),
        );
      });
      if (result.code === "ENOENT") throw new HttpError(501, `LibreOffice was not found (${soffice}). ${LIBREOFFICE_HINT}`);
      const produced = path.join(jobDir, "slides.pdf");
      if (!existsSync(produced)) {
        const why = result.stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300);
        throw new HttpError(500, `LibreOffice could not turn ${path.basename(doc.path)} into a PDF.${why ? ` ${why}` : ""}`);
      }
      await fs.mkdir(path.dirname(out), { recursive: true });
      const tmp = `${out}.${process.pid}.tmp`;
      await fs.copyFile(produced, tmp);
      await fs.rename(tmp, out);
      await this.removeOlder(doc.id, out);
      return out;
    } finally {
      await fs.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** Drops PDFs made from earlier versions of the same slides. */
  private async removeOlder(docId: string, keep: string): Promise<void> {
    const dir = path.dirname(keep);
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      const file = path.join(dir, name);
      if (name.startsWith(`${docId}-`) && name.endsWith(".pdf") && file !== keep) await fs.rm(file, { force: true });
    }
  }
}

/** Where the PDF of this version of the slides lives (whether or not it exists yet). */
export function convertedPdfPath(dataDir: string, doc: Pick<DocumentRecord, "id" | "fingerprint">): string {
  const fp = doc.fingerprint.replace(/^v\d+:/, "").slice(0, 16);
  return path.join(dataDir, "converted", `${doc.id}-${fp}.pdf`);
}

function findOnPath(names: string[]): string | null {
  for (const name of names) {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      const file = path.join(dir, name);
      if (dir && existsSync(file)) return file;
    }
  }
  return null;
}

/** A snap LibreOffice only sees non-hidden folders in home, and its own folder under ~/snap. */
function defaultWorkDir(soffice: string, dataDir: string): string {
  let real = soffice;
  try {
    real = realpathSync(soffice);
  } catch {
    /* keep the name */
  }
  const snap = soffice.startsWith("/snap/") || real.endsWith("/usr/bin/snap");
  return snap ? path.join(os.homedir(), "snap", "libreoffice", "common", "studyspace") : path.join(dataDir, "convert-tmp");
}
