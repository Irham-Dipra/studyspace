import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, createTestContext, tempDir, writePdf } from "./helpers.js";

afterAll(cleanupTempDirs);

/**
 * A stand-in for LibreOffice: writes a ready-made PDF as `<outdir>/<input name>.pdf`, the way
 * `soffice --convert-to pdf --outdir` does, and counts its runs.
 */
async function sofficeStub(mode: "ok" | "fail" = "ok") {
  const dir = tempDir("studyspace-soffice-");
  const pdf = await writePdf(path.join(dir, "out.pdf"), 3, "slide");
  const file = path.join(dir, "soffice");
  fs.writeFileSync(
    file,
    `#!${process.execPath}
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(dir, "runs.log"))}, JSON.stringify(args) + "\\n");
if (${JSON.stringify(mode)} === "fail") { console.error("Error: source file could not be loaded"); process.exit(1); }
const out = args[args.indexOf("--outdir") + 1];
const input = args[args.length - 1];
fs.copyFileSync(${JSON.stringify(pdf)}, path.join(out, path.basename(input).replace(/\\.[^.]+$/, ".pdf")));
`,
    { mode: 0o755 },
  );
  const runs = () => fs.readFileSync(path.join(dir, "runs.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as string[]);
  return { file, runs };
}

async function setup(mode: "ok" | "fail" = "ok") {
  const stub = await sofficeStub(mode);
  const workDir = tempDir("studyspace-convert-");
  const ctx = createTestContext({ slides: { soffice: stub.file, workDir } });
  const root = tempDir();
  fs.writeFileSync(path.join(root, "Lecture 1.pptx"), "not really a pptx");
  fs.writeFileSync(path.join(root, "Old deck.ppt"), "old format");
  await writePdf(path.join(root, "Notes.pdf"), 2);
  const original = fs.readFileSync(path.join(root, "Lecture 1.pptx"));
  await request(ctx.app).post("/api/directories").send({ path: root }).expect(201);
  const docs = (await request(ctx.app).get("/api/library")).body.documents as { id: string; title: string; kind: string }[];
  const deck = docs.find((d) => d.title === "Lecture 1")!;
  return { ...ctx, root, docs, deck, stub, workDir, original };
}

// The stub soffice is a script with a #! line, which Windows can't run.
describe.skipIf(process.platform === "win32")("slides", () => {
  it("lists .pptx and .ppt files as slides next to PDFs", async () => {
    const { docs } = await setup();
    expect(docs.map((d) => [d.title, d.kind])).toEqual([
      ["Lecture 1", "slides"],
      ["Notes", "pdf"],
      ["Old deck", "slides"],
    ]);
  });

  it("converts once, serves the PDF, and leaves the slides file alone", async () => {
    const { app, deck, stub, root, original, workDir, dataDir } = await setup();
    await request(app).post(`/api/documents/${deck.id}/convert`).expect(200, { ready: true });
    const res = await request(app).get(`/api/documents/${deck.id}/file`).buffer(true).expect(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("Lecture%201.pdf");
    expect(Buffer.from(res.body).subarray(0, 5).toString()).toBe("%PDF-");
    await request(app).get(`/api/documents/${deck.id}/file`).expect(200);
    expect(stub.runs()).toHaveLength(1);
    // LibreOffice works on a copy in its own folder, with its own profile.
    const args = stub.runs()[0];
    expect(args).toContain("--headless");
    expect(args.find((a) => a.startsWith("-env:UserInstallation="))).toContain(encodeURI(workDir));
    expect(args[args.length - 1].startsWith(workDir)).toBe(true);
    expect(fs.readFileSync(path.join(root, "Lecture 1.pptx"))).toEqual(original);
    expect(fs.readdirSync(path.join(dataDir, "converted"))).toHaveLength(1);
    expect(fs.readdirSync(workDir).filter((n) => n !== "profile")).toEqual([]);
  });

  it("converts again when the slides change, and drops the old PDF", async () => {
    const { app, deck, stub, root, dataDir } = await setup();
    await request(app).post(`/api/documents/${deck.id}/convert`).expect(200);
    fs.writeFileSync(path.join(root, "Lecture 1.pptx"), "edited in PowerPoint");
    await request(app).post("/api/library/scan").expect(200);
    await request(app).post(`/api/documents/${deck.id}/convert`).expect(200);
    expect(stub.runs()).toHaveLength(2);
    expect(fs.readdirSync(path.join(dataDir, "converted"))).toHaveLength(1);
  });

  it("refuses page edits, saving into the file and OCR", async () => {
    const { app, deck, root, original } = await setup();
    await request(app).post(`/api/documents/${deck.id}/convert`).expect(200);
    const del = await request(app).post(`/api/documents/${deck.id}/pages/delete`).send({ pages: [1] }).expect(400);
    expect(del.body.error).toMatch(/Slides can't be changed/);
    await request(app).post(`/api/documents/${deck.id}/annotations/save`).send({}).expect(400);
    await request(app).post(`/api/documents/${deck.id}/ocr`).send({ pages: [1] }).expect(400);
    expect(fs.readFileSync(path.join(root, "Lecture 1.pptx"))).toEqual(original);
  });

  it("can be a source for new PDFs once converted", async () => {
    const { app, deck, root } = await setup();
    const body = { folder: root, outputs: [{ name: "From slides", segments: [{ documentId: deck.id, pages: [2, 3] }] }] };
    const early = await request(app).post("/api/pdf-tools/create").send(body).expect(409);
    expect(early.body.error).toMatch(/Open “Lecture 1” once first/);
    await request(app).post(`/api/documents/${deck.id}/convert`).expect(200);
    await request(app).post("/api/pdf-tools/create").send(body).expect(201);
    expect(fs.existsSync(path.join(root, "From slides.pdf"))).toBe(true);
  });

  it("reports a failed conversion", async () => {
    const { app, deck } = await setup("fail");
    const res = await request(app).post(`/api/documents/${deck.id}/convert`).expect(500);
    expect(res.body.error).toMatch(/LibreOffice could not turn Lecture 1.pptx into a PDF/);
  });

  it("says when LibreOffice is missing", async () => {
    const ctx = createTestContext({ slides: { soffice: "/nonexistent/soffice", workDir: tempDir() } });
    const root = tempDir();
    fs.writeFileSync(path.join(root, "Deck.pptx"), "x");
    await request(ctx.app).post("/api/directories").send({ path: root }).expect(201);
    const doc = (await request(ctx.app).get("/api/library")).body.documents[0];
    const res = await request(ctx.app).post(`/api/documents/${doc.id}/convert`).expect(501);
    expect(res.body.error).toMatch(/LibreOffice was not found/);
  });
});
