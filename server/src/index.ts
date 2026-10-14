import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/index.js";
import { insertDirectory, listDirectories } from "./db/directories.js";
import { syncLibrary } from "./library/sync.js";
import { createAIProvider } from "./ai/index.js";
import { createApp } from "./app.js";

const config = loadConfig();
if (!config.webDistDir) {
  const guess = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (fs.existsSync(path.join(guess, "index.html"))) config.webDistDir = guess;
}

const dbPath = path.join(config.dataDir, "studyspace.db");
const db = openDatabase(dbPath);

// First run: seed library directories from STUDYSPACE_LIBRARY_DIRS.
if (listDirectories(db).length === 0) {
  for (const dir of config.seedLibraryDirs) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      insertDirectory(db, { path: fs.realpathSync(dir), label: path.basename(dir), excludes: config.seedExcludes });
      console.log(`[studyspace] added library directory ${dir}`);
    } else {
      console.warn(`[studyspace] STUDYSPACE_LIBRARY_DIRS entry is not a directory: ${dir}`);
    }
  }
}

const ai = createAIProvider(config.ai);
const app = createApp({ db, config, ai });

const server = app.listen(config.port, config.host, () => {
  console.log(`[studyspace] API listening on http://${config.host}:${config.port}`);
  console.log(`[studyspace] database: ${dbPath}`);
  console.log(`[studyspace] AI provider: ${ai.id}${ai.enabled ? "" : " (disabled)"}`);
  if (config.webDistDir) console.log(`[studyspace] serving web UI from ${config.webDistDir}`);
  syncLibrary(db)
    .then((r) =>
      console.log(
        `[studyspace] library scan: ${r.scanned} PDFs (${r.added} new, ${r.moved} moved, ${r.changed} changed, ${r.missing} missing)`,
      ),
    )
    .catch((err) => console.error("[studyspace] library scan failed", err));
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
