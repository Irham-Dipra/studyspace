import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, createTestContext, tempDir, writePdf } from "./helpers.js";

afterAll(cleanupTempDirs);

async function setup() {
  const ctx = createTestContext();
  const root = tempDir("studyspace-lib-");
  await writePdf(path.join(root, "CSE 301", "Chapter 1.pdf"), 2);
  await writePdf(path.join(root, "CSE 301", "Other.pdf"), 1);
  await request(ctx.app).post("/api/directories").send({ path: root }).expect(201);
  const docs = (await request(ctx.app).get("/api/library")).body.documents as { id: string; relPath: string; path: string }[];
  const doc = docs.find((d) => d.relPath === "CSE 301/Chapter 1.pdf")!;
  await request(ctx.app).post(`/api/documents/${doc.id}/resources`).send({ type: "note", scope: "page", pageStart: 1, content: "hi" }).expect(201);
  return { ...ctx, root, doc };
}

describe("renaming files", () => {
  it("renames in place, keeps the extension and the notes", async () => {
    const { app, root, doc } = await setup();
    const r = await request(app).post(`/api/documents/${doc.id}/rename`).send({ name: "  Intro " }).expect(200);
    expect(r.body).toMatchObject({ id: doc.id, relPath: "CSE 301/Intro.pdf", title: "Intro", missing: false });
    expect(fs.existsSync(path.join(root, "CSE 301", "Intro.pdf"))).toBe(true);
    expect(fs.existsSync(doc.path)).toBe(false);
    expect((await request(app).get(`/api/documents/${doc.id}/resources`)).body).toHaveLength(1);
    // A rescan finds it as the same document.
    await request(app).post("/api/library/scan").expect(200);
    const docs = (await request(app).get("/api/library")).body.documents as { id: string }[];
    expect(docs.map((d) => d.id)).toContain(doc.id);
    expect(docs).toHaveLength(2);
  });

  it("refuses names that are taken, empty, hidden or contain a slash", async () => {
    const { app, doc } = await setup();
    for (const name of ["Other", "Other.pdf", "", "  ", ".x", "a/b"]) {
      const r = await request(app).post(`/api/documents/${doc.id}/rename`).send({ name });
      expect(r.status, name).toBeGreaterThanOrEqual(400);
    }
    expect(fs.existsSync(doc.path)).toBe(true);
  });
});

describe("deleting files", () => {
  it("moves the file to the Trash and puts it back with its notes", async () => {
    const { app, config, doc } = await setup();
    const before = fs.statSync(doc.path).mtimeMs;
    const t = await request(app).post(`/api/documents/${doc.id}/trash`).expect(200);
    expect(t.body.trashName).toBe("Chapter 1.pdf");
    expect(fs.existsSync(doc.path)).toBe(false);
    expect(fs.existsSync(path.join(config.trashDir, "files", "Chapter 1.pdf"))).toBe(true);
    const info = fs.readFileSync(path.join(config.trashDir, "info", "Chapter 1.pdf.trashinfo"), "utf8");
    expect(info).toContain(`Path=${doc.path.split("/").map(encodeURIComponent).join("/")}`);
    expect(info).toMatch(/DeletionDate=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/);
    let docs = (await request(app).get("/api/library")).body.documents as { id: string }[];
    expect(docs.map((d) => d.id)).not.toContain(doc.id);

    const r = await request(app).post(`/api/documents/${doc.id}/restore`).send({ trashName: t.body.trashName }).expect(200);
    expect(r.body.missing).toBe(false);
    expect(fs.statSync(doc.path).mtimeMs).toBe(before);
    expect(fs.existsSync(path.join(config.trashDir, "info", "Chapter 1.pdf.trashinfo"))).toBe(false);
    docs = (await request(app).get("/api/library")).body.documents as { id: string }[];
    expect(docs.map((d) => d.id)).toContain(doc.id);
    expect((await request(app).get(`/api/documents/${doc.id}/resources`)).body).toHaveLength(1);
  });

  it("picks a free name in the Trash and only restores its own file", async () => {
    const { app, config, doc } = await setup();
    fs.mkdirSync(path.join(config.trashDir, "files"), { recursive: true });
    fs.writeFileSync(path.join(config.trashDir, "files", "Chapter 1.pdf"), "someone else's");
    const t = await request(app).post(`/api/documents/${doc.id}/trash`).expect(200);
    expect(t.body.trashName).toBe("Chapter 1.2.pdf");
    await request(app).post(`/api/documents/${doc.id}/restore`).send({ trashName: "Chapter 1.pdf" }).expect(409);
    await request(app).post(`/api/documents/${doc.id}/restore`).send({ trashName: "../x" }).expect(400);
    await request(app).post(`/api/documents/${doc.id}/restore`).send({ trashName: t.body.trashName }).expect(200);
  });

  it("won't restore over a new file at the same place", async () => {
    const { app, doc } = await setup();
    const t = await request(app).post(`/api/documents/${doc.id}/trash`).expect(200);
    fs.writeFileSync(doc.path, "new");
    await request(app).post(`/api/documents/${doc.id}/restore`).send({ trashName: t.body.trashName }).expect(409);
    expect(fs.readFileSync(doc.path, "utf8")).toBe("new");
  });
});
