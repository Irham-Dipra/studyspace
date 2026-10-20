import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { loadConfig, type AppConfig } from "../src/config.js";
import { openDatabase, type DB } from "../src/db/index.js";
import { createApp } from "../src/app.js";
import { DisabledProvider } from "../src/ai/providers/none.js";

const created: string[] = [];

export function tempDir(prefix = "studyspace-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const d of created.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

/** Writes a PDF with `pages` pages, each labelled "<label> page N" so content differs per file. */
export async function writePdf(file: string, pages: number, label = path.basename(file)): Promise<string> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = pdf.addPage([400, 600]);
    p.drawText(`${label} page ${i}`, { x: 40, y: 540, size: 18, font });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await pdf.save());
  return file;
}

export function createTestContext(overrides: Partial<AppConfig> = {}) {
  const dataDir = tempDir("studyspace-data-");
  const config: AppConfig = {
    ...loadConfig({}),
    dataDir,
    trashDir: path.join(dataDir, "Trash"),
    historyLimit: 3,
    // The older tests send no X-StudySpace header; auth.test.ts turns the check back on.
    requireCsrfHeader: false,
    ...overrides,
  };
  const db: DB = openDatabase(path.join(dataDir, "test.db"));
  const app = createApp({ db, config, ai: new DisabledProvider() });
  return { db, app, config, dataDir };
}
