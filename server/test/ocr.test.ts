import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, createTestContext, tempDir, writePdf } from "./helpers.js";

afterAll(cleanupTempDirs);

/**
 * Stand-ins for the real OCRmyPDF / Tesseract (not installed in CI): small Node scripts that behave
 * like them on the command line. The OCRmyPDF stub copies the input and appends a marker, so the
 * "OCRed" file differs from the original.
 */
function stub(dir: string, name: string, body: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!${process.execPath}\nconst args = process.argv.slice(2);\n${body}\n`, { mode: 0o755 });
  return file;
}

function ocrStubs(mode: "ok" | "fail" | "slow" = "ok") {
  const dir = tempDir("studyspace-ocr-bin-");
  const ocrmypdf = stub(
    dir,
    "ocrmypdf",
    `
const fs = require("node:fs");
if (args[0] === "--version") { console.log("16.0.0-stub"); process.exit(0); }
fs.writeFileSync(${JSON.stringify(path.join(dir, "args.json"))}, JSON.stringify(args));
if (${JSON.stringify(mode)} === "fail") { console.error("    1 something broke\\nInputFileError: cannot read"); process.exit(2); }
const [input, output] = args.slice(-2);
const go = () => {
  const pages = args[args.indexOf("--pages") + 1];
  for (const p of pages.split(",")) console.error("    " + p.split("-")[0] + " [ocr] page done");
  fs.writeFileSync(output, Buffer.concat([fs.readFileSync(input), Buffer.from("\\n%stub-ocr-layer\\n")]));
};
${mode === "slow" ? "setTimeout(go, 1500);" : "go();"}
`,
  );
  const tesseract = stub(
    dir,
    "tesseract",
    `
if (args[0] === "--version") { console.log("tesseract 5.3.4-stub"); process.exit(0); }
if (args[0] === "--list-langs") { console.log("List of available languages in \\"/x\\" (2):\\neng\\nosd"); process.exit(0); }
const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => { process.stdout.write("Region text\\n• first point\\n(" + Buffer.concat(chunks).length + " bytes, " + args.join(" ") + ")\\f"); });
`,
  );
  return { dir, ocr: { ocrmypdf, tesseract, language: "eng" } };
}

async function setup(mode: "ok" | "fail" | "slow" = "ok") {
  const stubs = ocrStubs(mode);
  // Data under a dot-folder, like the real ~/.local/share/studyspace (sendFile refuses those by default).
  const ctx = createTestContext({ ocr: stubs.ocr, dataDir: path.join(tempDir(), ".local", "share", "studyspace") });
  const root = tempDir();
  const file = await writePdf(path.join(root, "Scan.pdf"), 4, "scan");
  await request(ctx.app).post("/api/directories").send({ path: root }).expect(201);
  const doc = (await request(ctx.app).get("/api/library")).body.documents[0];
  return { ...ctx, file, doc, stubs };
}

async function waitForJob(app: Parameters<typeof request>[0], id: string) {
  for (let i = 0; i < 100; i++) {
    const job = (await request(app).get(`/api/ocr/jobs/${id}`)).body;
    if (job.state !== "running") return job;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("OCR job did not finish");
}

describe("OCR", () => {
  it("reports when OCR isn't installed, and refuses to run", async () => {
    const ctx = createTestContext({ ocr: { ocrmypdf: "/nonexistent/ocrmypdf", tesseract: "/nonexistent/tesseract", language: "eng" } });
    const root = tempDir();
    await writePdf(path.join(root, "A.pdf"), 2);
    await request(ctx.app).post("/api/directories").send({ path: root }).expect(201);
    const doc = (await request(ctx.app).get("/api/library")).body.documents[0];

    const status = (await request(ctx.app).get("/api/ocr/status")).body;
    expect(status).toMatchObject({ available: false, ocrmypdf: { available: false }, tesseract: { available: false } });
    expect(status.installHint).toMatch(/sudo apt install ocrmypdf tesseract-ocr/);
    const res = await request(ctx.app).post(`/api/documents/${doc.id}/ocr`).send({ pages: [1] });
    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/apt install/);
    await request(ctx.app).post("/api/ocr/image").set("Content-Type", "image/png").send(Buffer.from("png")).expect(501);
  });

  it("OCRs pages on a copy, leaves the PDF alone until 'Add to PDF', and can be undone", async () => {
    const { app, doc, file, stubs } = await setup();
    const original = fs.readFileSync(file);
    const note = (await request(app).post(`/api/documents/${doc.id}/resources`).send({ type: "note", scope: "page", pageStart: 2, title: "kept" })).body;

    const status = (await request(app).get("/api/ocr/status")).body;
    expect(status).toMatchObject({ available: true, ocrmypdf: { version: "16.0.0-stub" }, tesseract: { languages: ["eng", "osd"] } });

    const started = await request(app).post(`/api/documents/${doc.id}/ocr`).send({ pages: [2, 1, 3], fingerprint: doc.fingerprint });
    expect(started.status).toBe(202);
    const job = await waitForJob(app, started.body.id);
    expect(job).toMatchObject({ state: "done", pages: [1, 2, 3], progress: 3 });
    // The flags that keep pages exactly as they were.
    const args = JSON.parse(fs.readFileSync(path.join(stubs.dir, "args.json"), "utf8"));
    expect(args.slice(0, 9)).toEqual(["--pages", "1-3", "--redo-ocr", "--output-type", "pdf", "--optimize", "0", "-l", "eng"]);
    expect(args).not.toContain("--rotate-pages");
    expect(args).not.toContain("--deskew");

    // Running OCR changed nothing in the library.
    expect(fs.readFileSync(file).equals(original)).toBe(true);
    const out = await request(app).get(`/api/ocr/jobs/${job.id}/file`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(out.status).toBe(200);
    expect(out.body.toString("latin1")).toContain("%stub-ocr-layer");

    const applied = await request(app).post(`/api/ocr/jobs/${job.id}/apply`).send({ fingerprint: doc.fingerprint });
    expect(applied.status).toBe(200);
    expect(applied.body.pageCount).toBe(4);
    expect(fs.readFileSync(file).toString("latin1")).toContain("%stub-ocr-layer");
    const history = (await request(app).get(`/api/documents/${doc.id}/history`)).body;
    expect(history[0]).toMatchObject({ kind: "ocr", label: "Add OCR text layer (pages 1–3)" });
    expect((await request(app).get(`/api/resources/${note.id}`)).body.pageStart).toBe(2);
    // Applying twice in a row is refused: the file is no longer the version the OCR ran on.
    await request(app).post(`/api/ocr/jobs/${job.id}/apply`).send({}).expect(409);

    await request(app).post(`/api/documents/${doc.id}/history/${applied.body.editId}/undo`).expect(200);
    expect(fs.readFileSync(file).equals(original)).toBe(true);
    // Redo after undo: the original is back, so the same result applies again.
    await request(app).post(`/api/ocr/jobs/${job.id}/apply`).send({}).expect(200);
    expect(fs.readFileSync(file).toString("latin1")).toContain("%stub-ocr-layer");
  });

  it("refuses to add a stale OCR result, and discarding removes it", async () => {
    const { app, doc, file, config } = await setup();
    const dataDir = config.dataDir;
    const job = await waitForJob(app, (await request(app).post(`/api/documents/${doc.id}/ocr`).send({ pages: [1] })).body.id);
    // The PDF changes after the OCR ran.
    await request(app).post(`/api/documents/${doc.id}/pages/insert-blank`).send({ after: 4 }).expect(200);
    const before = fs.readFileSync(file);
    const res = await request(app).post(`/api/ocr/jobs/${job.id}/apply`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Run OCR again/);
    expect(fs.readFileSync(file).equals(before)).toBe(true);

    expect(fs.existsSync(path.join(dataDir, "tmp", "ocr", job.id))).toBe(true);
    await request(app).delete(`/api/ocr/jobs/${job.id}`).expect(204);
    expect(fs.existsSync(path.join(dataDir, "tmp", "ocr", job.id))).toBe(false);
    await request(app).get(`/api/ocr/jobs/${job.id}`).expect(404);
  });

  it("allows one OCR job per PDF at a time and validates pages", async () => {
    const { app, doc } = await setup("slow");
    const first = await request(app).post(`/api/documents/${doc.id}/ocr`).send({ pages: [1] });
    expect(first.status).toBe(202);
    await request(app).post(`/api/documents/${doc.id}/ocr`).send({ pages: [2] }).expect(409);
    await request(app).post(`/api/ocr/jobs/${first.body.id}/apply`).send({}).expect(409); // still running
    await request(app).delete(`/api/ocr/jobs/${first.body.id}`).expect(204);
    await request(app).post(`/api/documents/${doc.id}/ocr`).send({ pages: [9] }).expect(400);
    await request(app).post(`/api/documents/${doc.id}/ocr`).send({ pages: [1], fingerprint: "v1:stale" }).expect(409);
  });

  it("reports a failed OCR run with OCRmyPDF's message", async () => {
    const { app, doc, file } = await setup("fail");
    const original = fs.readFileSync(file);
    const job = await waitForJob(app, (await request(app).post(`/api/documents/${doc.id}/ocr`).send({ pages: [1] })).body.id);
    expect(job.state).toBe("failed");
    expect(job.error).toMatch(/could not read this PDF.*cannot read/);
    expect(fs.readFileSync(file).equals(original)).toBe(true);
  });

  it("OCRs a region image with Tesseract", async () => {
    const { app } = await setup();
    const res = await request(app).post("/api/ocr/image").set("Content-Type", "image/png").send(Buffer.alloc(1234, 1));
    expect(res.status).toBe(200);
    expect(res.body.text).toBe("Region text\n• first point\n(1234 bytes, stdin stdout -l eng)");
    await request(app).post("/api/ocr/image").set("Content-Type", "image/png").send(Buffer.alloc(0)).expect(400);
  });
});
