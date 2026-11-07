import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { excludeError, isExcluded, scanForDocuments } from "../src/library/scanner.js";
import { resolveInsideRoots } from "../src/library/pathGuard.js";
import { fingerprintFile } from "../src/library/fingerprint.js";
import { cleanupTempDirs, createTestContext, tempDir, writePdf } from "./helpers.js";

afterAll(cleanupTempDirs);

async function makeLibrary() {
  const root = tempDir("studyspace-lib-");
  await writePdf(path.join(root, "CSE 301", "Chapter 1.pdf"), 3);
  await writePdf(path.join(root, "CSE 301", "Books", "Ross.PDF"), 2);
  await writePdf(path.join(root, "CSE 309", "Slides.pdf"), 4);
  await writePdf(path.join(root, "Offllines", "lab.pdf"), 1);
  await writePdf(path.join(root, "CSE 309", "node_modules", "junk.pdf"), 1);
  await writePdf(path.join(root, ".hidden", "secret.pdf"), 1);
  fs.writeFileSync(path.join(root, "CSE 301", "notes.txt"), "not a pdf");
  return root;
}

describe("file discovery", () => {
  it("finds PDFs recursively, skipping hidden, node_modules and excluded folders", async () => {
    const root = await makeLibrary();
    const files = await scanForDocuments(root, ["Offllines"]);
    expect(files.map((f) => f.relPath)).toEqual(["CSE 301/Books/Ross.PDF", "CSE 301/Chapter 1.pdf", "CSE 309/Slides.pdf"]);
    expect(files[0].size).toBeGreaterThan(0);
  });

  it("matches excludes by folder name or by relative path", () => {
    expect(isExcluded("Offllines", ["offllines"])).toBe(true);
    expect(isExcluded("CSE 301/Books", ["Books"])).toBe(true);
    expect(isExcluded("CSE 301/Books", ["CSE 301/Books"])).toBe(true);
    expect(isExcluded("CSE 309/Books", ["CSE 301/Books"])).toBe(false);
    expect(isExcluded("CSE 301", ["CSE 301/Books"])).toBe(false);
  });

  it("hides files and folders by wildcard, path or regex", () => {
    // A name pattern: any depth.
    expect(isExcluded("notes.md", ["*.md"])).toBe(true);
    expect(isExcluded("CSE 301/Books/notes.MD", ["*md"])).toBe(true);
    expect(isExcluded("CSE 301/Chapter 1.pdf", ["*.md"])).toBe(false);
    expect(isExcluded("CSE 301/Syllabus.pdf", ["syllabus.pdf"])).toBe(true);
    expect(isExcluded("CSE 301/Ch?.pdf", ["ch?.pdf"])).toBe(true);
    // A path: from the library folder; "*" stays inside one folder.
    expect(isExcluded("CSE 301/a.md", ["CSE 301/*.md"])).toBe(true);
    expect(isExcluded("CSE 301/Books/a.md", ["CSE 301/*.md"])).toBe(false);
    expect(isExcluded("CSE 301/Books/a.md", ["CSE 301/**/*.md"])).toBe(true);
    expect(isExcluded("CSE 301/a.md", ["CSE 301/**/*.md"])).toBe(true);
    expect(isExcluded("CSE 309/a.md", ["CSE 301/*.md"])).toBe(false);
    expect(isExcluded("CSE 301/Books/Ross.pdf", ["CSE 301/B*"])).toBe(true); // a folder hides what's inside
    // A leading "/": only in the library folder itself.
    expect(isExcluded("a.md", ["/*.md"])).toBe(true);
    expect(isExcluded("CSE 301/a.md", ["/*.md"])).toBe(false);
    // A folder whose name ends in a space is still matched by the trimmed rule.
    expect(isExcluded("CSE 313/RRR ma_am /a.pdf", ["/CSE 313/RRR ma_am"])).toBe(true);
    expect(isExcluded("CSE 313/RRR ma_am /a.pdf", ["/CSE 313/RRR ma_am "])).toBe(true);
    // Regular expressions on the whole relative path.
    expect(isExcluded("CSE 301/Lecture 3 (old).pdf", ["re:\\(old\\)\\.pdf$"])).toBe(true);
    expect(isExcluded("CSE 301/Lecture 3.pdf", ["re:\\(old\\)\\.pdf$"])).toBe(false);
    expect(isExcluded("CSE 301/x.pdf", ["re:("])).toBe(false); // broken: ignored
    expect(excludeError("re:(")).toMatch(/regular expression/);
    expect(excludeError("*.md")).toBeNull();
    // Dots and brackets are literal outside regexes.
    expect(isExcluded("CSE 301/aXmd", ["*.md"])).toBe(false);
    expect(isExcluded("[draft] a.pdf", ["[draft]*"])).toBe(true);
  });

  it("leaves hidden files out of a scan", async () => {
    const root = await makeLibrary();
    await writePdf(path.join(root, "Syllabus.pdf"), 1);
    fs.writeFileSync(path.join(root, "CSE 301", "summary.md"), "# Hi");
    fs.writeFileSync(path.join(root, "todo.md"), "# Todo");
    const files = await scanForDocuments(root, ["Offllines", "/*.md", "syllabus.pdf", "CSE 301/Books/*"]);
    expect(files.map((f) => f.relPath)).toEqual(["CSE 301/Chapter 1.pdf", "CSE 301/summary.md", "CSE 309/Slides.pdf"]);
  });

  it("does not follow symlinks that escape the root", async () => {
    const root = tempDir();
    const outside = tempDir();
    await writePdf(path.join(outside, "outside.pdf"), 1);
    fs.symlinkSync(path.join(outside, "outside.pdf"), path.join(root, "link.pdf"));
    fs.symlinkSync(outside, path.join(root, "linked-dir"));
    expect(await scanForDocuments(root)).toEqual([]);
  });

  it("fingerprints by content, independent of the file name", async () => {
    const dir = tempDir();
    const a = await writePdf(path.join(dir, "a.pdf"), 2, "same");
    fs.copyFileSync(a, path.join(dir, "b.pdf"));
    const c = await writePdf(path.join(dir, "c.pdf"), 2, "different");
    expect(await fingerprintFile(a)).toBe(await fingerprintFile(path.join(dir, "b.pdf")));
    expect(await fingerprintFile(a)).not.toBe(await fingerprintFile(c));
  });
});

describe("path guard", () => {
  it("rejects traversal and paths outside the roots", async () => {
    const root = tempDir();
    const inside = await writePdf(path.join(root, "x.pdf"), 1);
    expect(resolveInsideRoots(inside, [root])).toBe(fs.realpathSync(inside));
    expect(resolveInsideRoots(path.join(root, "..", "..", "etc", "passwd"), [root])).toBeNull();
    expect(resolveInsideRoots("/etc/passwd", [root])).toBeNull();
    expect(resolveInsideRoots("relative/x.pdf", [root])).toBeNull();
    // Prefix trick: /tmp/lib-evil must not count as inside /tmp/lib
    const evil = `${root}-evil`;
    fs.mkdirSync(evil);
    const evilPdf = await writePdf(path.join(evil, "e.pdf"), 1);
    expect(resolveInsideRoots(evilPdf, [root])).toBeNull();
    fs.rmSync(evil, { recursive: true });
  });
});

describe("library sync API", () => {
  it("adds a directory, lists documents and streams files without copying them", async () => {
    const { app, dataDir } = createTestContext();
    const root = await makeLibrary();
    const add = await request(app).post("/api/directories").send({ path: root, excludes: ["Offllines"] });
    expect(add.status).toBe(201);
    expect(add.body.scan.added).toBe(3);

    const lib = await request(app).get("/api/library");
    expect(lib.body.documents).toHaveLength(3);
    const doc = lib.body.documents.find((d: { relPath: string }) => d.relPath === "CSE 309/Slides.pdf");
    expect(doc.title).toBe("Slides");
    expect(doc.id).toMatch(/^[0-9a-f-]{36}$/);

    const file = await request(app).get(`/api/documents/${doc.id}/file`).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.from(file.body).subarray(0, 5).toString()).toBe("%PDF-");

    const range = await request(app).get(`/api/documents/${doc.id}/file`).set("Range", "bytes=0-9");
    expect(range.status).toBe(206);
    expect(range.headers["content-length"]).toBe("10");

    // No PDFs were copied into the data directory.
    const copied = fs.readdirSync(dataDir, { recursive: true }).filter((f) => String(f).toLowerCase().endsWith(".pdf"));
    expect(copied).toEqual([]);
  });

  it("refuses to serve a document whose path is outside the configured roots", async () => {
    const { app, db } = createTestContext();
    const root = await makeLibrary();
    await request(app).post("/api/directories").send({ path: root });
    const doc = (await request(app).get("/api/library")).body.documents[0];
    db.prepare("UPDATE documents SET path = '/etc/hostname' WHERE id = ?").run(doc.id);
    const res = await request(app).get(`/api/documents/${doc.id}/file`);
    expect(res.status).toBe(403);
  });

  it("hides files by the folder's settings and brings them back with their notes", async () => {
    const { app } = createTestContext();
    const root = await makeLibrary();
    const dir = (await request(app).post("/api/directories").send({ path: root }).expect(201)).body.directory;
    const ross = (await request(app).get("/api/library")).body.documents.find((d: { relPath: string }) => d.relPath.endsWith("Ross.PDF"));
    await request(app).post(`/api/documents/${ross.id}/resources`).send({ type: "note", scope: "document", content: "keep me" }).expect(201);
    const paths = async () => (await request(app).get("/api/library")).body.documents.map((d: { relPath: string }) => d.relPath).sort();

    const bad = await request(app).patch(`/api/directories/${dir.id}`).send({ excludes: ["re:("] });
    expect(bad.status).toBe(400);
    expect(bad.body.issues.join(" ")).toMatch(/regular expression/);

    await request(app).patch(`/api/directories/${dir.id}`).send({ excludes: ["Offllines", "CSE 309/*.pdf", "draft*"] }).expect(200);
    expect(await paths()).toEqual(["CSE 301/Books/Ross.PDF", "CSE 301/Chapter 1.pdf"]);

    // Renaming into a hidden name is refused (the file would vanish on the next scan).
    const r = await request(app).post(`/api/documents/${ross.id}/rename`).send({ name: "Draft" });
    expect([r.status, r.body.error]).toEqual([400, expect.stringMatching(/hidden/)]);

    await request(app).patch(`/api/directories/${dir.id}`).send({ excludes: ["*books*"] }).expect(200);
    expect(await paths()).toEqual(["CSE 301/Chapter 1.pdf", "CSE 309/Slides.pdf", "Offllines/lab.pdf"]);

    await request(app).patch(`/api/directories/${dir.id}`).send({ excludes: [] }).expect(200);
    expect(await paths()).toContain("CSE 301/Books/Ross.PDF");
    const notes = (await request(app).get(`/api/documents/${ross.id}/resources`)).body;
    expect(notes.map((n: { content: string }) => n.content)).toEqual(["keep me"]);
  });

  it("rejects non-existent directories", async () => {
    const { app } = createTestContext();
    const res = await request(app).post("/api/directories").send({ path: "/definitely/not/here" });
    expect(res.status).toBe(400);
  });

  it("keeps the same document id (and its notes) when a file is renamed or moved", async () => {
    const { app } = createTestContext();
    const root = await makeLibrary();
    await request(app).post("/api/directories").send({ path: root });
    const before = (await request(app).get("/api/library")).body.documents.find(
      (d: { title: string }) => d.title === "Chapter 1",
    );
    await request(app)
      .post(`/api/documents/${before.id}/resources`)
      .send({ type: "note", scope: "page", pageStart: 2, content: "remember this" })
      .expect(201);

    fs.mkdirSync(path.join(root, "CSE 301", "Moved"));
    fs.renameSync(path.join(root, "CSE 301", "Chapter 1.pdf"), path.join(root, "CSE 301", "Moved", "Ch1 renamed.pdf"));
    const scan = await request(app).post("/api/library/scan");
    expect(scan.body.moved).toBe(1);
    expect(scan.body.added).toBe(0);

    const after = (await request(app).get(`/api/documents/${before.id}`)).body;
    expect(after.relPath).toBe("CSE 301/Moved/Ch1 renamed.pdf");
    expect(after.title).toBe("Ch1 renamed");
    const notes = (await request(app).get(`/api/documents/${before.id}/resources?page=2`)).body;
    expect(notes.map((n: { content: string }) => n.content)).toEqual(["remember this"]);
  });

  it("marks deleted files missing instead of dropping their notes, and restores them", async () => {
    const { app } = createTestContext();
    const root = await makeLibrary();
    await request(app).post("/api/directories").send({ path: root });
    const doc = (await request(app).get("/api/library")).body.documents.find((d: { title: string }) => d.title === "Slides");
    const backup = path.join(tempDir(), "Slides.pdf");
    fs.renameSync(path.join(root, "CSE 309", "Slides.pdf"), backup);

    expect((await request(app).post("/api/library/scan")).body.missing).toBe(1);
    expect((await request(app).get("/api/library")).body.documents).toHaveLength(3); // 4 found, 1 now missing
    expect((await request(app).get(`/api/documents/${doc.id}/file`)).status).toBe(410);

    fs.renameSync(backup, path.join(root, "CSE 309", "Slides.pdf"));
    await request(app).post("/api/library/scan");
    expect((await request(app).get(`/api/documents/${doc.id}`)).body.missing).toBe(false);
  });
});
