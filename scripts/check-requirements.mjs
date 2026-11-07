// Checks that this computer has what StudySpace needs: `npm run check` (or `node scripts/check-requirements.mjs`).
// No dependencies and plain syntax, so it also runs on an old Node and before `npm install`.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
let missingRequired = 0;

// Plain tags rather than ✔/✖: old Windows consoles can't show those.
const ok = (label, detail = "") => console.log(`  [ok]  ${label}${detail ? `  (${detail})` : ""}`);
const bad = (label, fix) => console.log(`  [!!]  ${label}\n        -> ${fix}`);
const info = (label, note) => console.log(`  [--]  ${label}${note ? `  (${note})` : ""}`);

const envFile = path.join(root, ".env");
if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envFile); // real environment variables still win
  } catch {
    /* a broken .env is reported by the server itself */
  }
}

/** The first place a program is found: its setting in .env, the PATH, then the usual install folders. */
function find(names, setting, places = []) {
  const isFile = (p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (setting && /[\\/]/.test(setting)) return isFile(setting) ? setting : null;
  if (setting) names = [setting]; // a bare name: look it up on the PATH
  const exts = win ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    for (const name of names) for (const ext of exts) if (dir && isFile(path.join(dir, name + ext))) return path.join(dir, name + ext);
  }
  return places.find(isFile) || null;
}

const portFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });

console.log("\nStudySpace setup check\n\nRequired");

const [major, minor] = process.versions.node.split(".").map(Number);
if (major >= 24) ok(`Node.js ${process.versions.node}`);
else {
  missingRequired++;
  bad(`Node.js ${process.versions.node} is too old (needs 24 or newer)`, "install Node.js 24 LTS: see REQUIREMENTS.md");
}

try {
  await import("node:sqlite");
  ok("Built-in SQLite (node:sqlite)");
} catch {
  missingRequired++;
  bad("Node's built-in SQLite (node:sqlite) is missing", `comes with Node.js 24; this Node is ${major}.${minor}`);
}

const npmAgent = /npm\/([\d.]+)/.exec(process.env.npm_config_user_agent || "");
if (npmAgent) ok(`npm ${npmAgent[1]}`);
else info("npm", "run this as `npm run check` to see npm's version");

const deps = ["express", "pdf-lib", "tsx", "vite", "react", "pdfjs-dist"];
const absent = deps.filter((d) => !fs.existsSync(path.join(root, "node_modules", d, "package.json")));
if (!absent.length) ok("npm packages installed");
else {
  missingRequired++;
  bad(`npm packages not installed (${absent.join(", ")})`, "run: npm install");
}

console.log("\nOptional");

if (fs.existsSync(envFile)) ok(".env file", "your settings");
else info("No .env file", "fine: add your folders in Settings, or copy .env.example to .env");

const programFiles = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
const soffice = find(["soffice", "libreoffice"], process.env.STUDYSPACE_SOFFICE, [
  ...programFiles.map((d) => path.join(d, "LibreOffice", "program", "soffice.exe")),
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
]);
if (soffice) ok("LibreOffice, for slides (.pptx, .ppt)", soffice);
else info("LibreOffice not found", "only needed to open slides; see REQUIREMENTS.md");

const tesseract = find(["tesseract"], process.env.STUDYSPACE_TESSERACT, programFiles.map((d) => path.join(d, "Tesseract-OCR", "tesseract.exe")));
const ocrmypdf = find(["ocrmypdf"], process.env.STUDYSPACE_OCRMYPDF);
const gs = find(win ? ["gswin64c", "gswin32c", "gs"] : ["gs"]);
if (tesseract) ok("Tesseract, for OCR of a region", tesseract);
else info("Tesseract not found", "only needed for OCR; see REQUIREMENTS.md");
if (ocrmypdf && gs) ok("OCRmyPDF + Ghostscript, for OCR of whole pages", ocrmypdf);
else info(`${ocrmypdf ? "Ghostscript" : "OCRmyPDF"} not found`, "only needed for OCR of whole pages; see REQUIREMENTS.md");
if (win && tesseract && !find(["tesseract"])) {
  info("Tesseract is installed but not on the PATH", "OCRmyPDF needs it there: see REQUIREMENTS.md");
}

console.log("\nPorts");
const apiPort = Number(process.env.STUDYSPACE_PORT || 4317);
for (const [port, what, busy] of [
  [apiPort, "the server", "is StudySpace already running? Or set STUDYSPACE_PORT in .env"],
  [5173, "the web page", "npm run dev then takes the next free port; it prints which"],
]) {
  if (await portFree(port)) ok(`${port} is free`, what);
  else info(`${port} is in use`, busy);
}

console.log(
  missingRequired
    ? `\n${missingRequired} required part(s) missing. Fix the [!!] lines above, then run this again.\n`
    : "\nEverything StudySpace needs is here. Start it with: npm run dev  (then open http://localhost:5173)\n",
);
process.exitCode = missingRequired ? 1 : 0;
