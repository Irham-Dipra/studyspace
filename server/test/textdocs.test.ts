import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, createTestContext, tempDir, writePdf } from "./helpers.js";

afterAll(cleanupTempDirs);

interface Doc {
  id: string;
  kind: string;
  title: string;
  relPath: string;
  fingerprint: string;
}

async function setup() {
  const ctx = createTestContext();
  const root = tempDir("studyspace-lib-");
  await writePdf(path.join(root, "Book.pdf"), 2);
  fs.writeFileSync(path.join(root, "Planner.html"), "<!doctype html><title>P</title><p>Hello <b>artifact</b></p><script>1</script>");
  fs.writeFileSync(path.join(root, "Revision Notes.md"), "# Compilers\n\nA *parser* reads tokens. ![fig](img/tree.png)\n");
  fs.mkdirSync(path.join(root, "img"));
  fs.writeFileSync(path.join(root, "img", "tree.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(root, "secret.txt"), "not a picture");
  await request(ctx.app).post("/api/directories").send({ path: root }).expect(201);
  const docs = (await request(ctx.app).get("/api/library")).body.documents as Doc[];
  const by = (rel: string) => docs.find((d) => d.relPath === rel)!;
  return { ...ctx, root, docs, pdf: by("Book.pdf"), html: by("Planner.html"), md: by("Revision Notes.md") };
}

describe("HTML and Markdown documents", () => {
  it("are listed with their kind and a title without the extension", async () => {
    const { docs, html, md } = await setup();
    expect(docs).toHaveLength(3);
    expect(html).toMatchObject({ kind: "html", title: "Planner" });
    expect(md).toMatchObject({ kind: "markdown", title: "Revision Notes" });
  });

  it("are served as text, HTML sandboxed", async () => {
    const { app, html, md } = await setup();
    const h = await request(app).get(`/api/documents/${html.id}/file`).expect(200);
    expect(h.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(h.headers["content-security-policy"]).toBe("sandbox");
    expect(h.text).toContain("Hello <b>artifact</b>");
    const m = await request(app).get(`/api/documents/${md.id}/file`).expect(200);
    expect(m.headers["content-type"]).toBe("text/markdown; charset=utf-8");
    expect(m.text).toContain("# Compilers");
  });

  it("refuse page edits, Save to PDF, OCR and use as a PDF source, with a clear message", async () => {
    const { app, root, pdf, html, md } = await setup();
    const before = fs.readFileSync(path.join(root, "Planner.html"));
    for (const [url, body] of [
      [`/api/documents/${html.id}/pages/delete`, { pages: [1] }],
      [`/api/documents/${md.id}/pages/insert-blank`, { after: 1 }],
      [`/api/documents/${html.id}/annotations/save`, {}],
      [`/api/documents/${md.id}/ocr`, { pages: [1] }],
      [`/api/documents/${pdf.id}/pages/insert-from`, { after: 1, sourceDocumentId: md.id, fromPage: 1, toPage: 1 }],
    ] as const) {
      const r = await request(app).post(url).send(body);
      expect(r.status, url).toBe(400);
      expect(r.body.error, url).toMatch(/not a PDF/);
    }
    const t = await request(app)
      .post("/api/pdf-tools/create")
      .send({ folder: root, outputs: [{ name: "x", segments: [{ documentId: html.id }] }] });
    expect(t.status).toBe(400);
    expect(t.body.error).toMatch(/not a PDF/);
    expect(fs.readFileSync(path.join(root, "Planner.html"))).toEqual(before);
  });

  it("keep text highlights, recreated with the same id for undo", async () => {
    const { app, md } = await setup();
    const h = { id: "0d9b4a8e-2f43-4d0e-9b38-6c1f2a7f5e11", color: "#fde047", quote: "parser", prefix: "A *", suffix: "* reads" };
    const c = await request(app).post(`/api/documents/${md.id}/text-highlights`).send(h).expect(201);
    expect(c.body).toMatchObject({ ...h, documentId: md.id, comment: "" });
    await request(app).post(`/api/documents/${md.id}/text-highlights`).send(h).expect(409);
    await request(app).patch(`/api/text-highlights/${h.id}`).send({ comment: "key word" }).expect(200);
    expect((await request(app).get(`/api/documents/${md.id}/text-highlights`)).body).toMatchObject([{ id: h.id, comment: "key word" }]);
    await request(app).delete(`/api/text-highlights/${h.id}`).expect(204);
    await request(app).post(`/api/documents/${md.id}/text-highlights`).send(h).expect(201);
    expect((await request(app).get(`/api/documents/${md.id}/text-highlights`)).body).toHaveLength(1);
  });

  it("remember how far down you were", async () => {
    const { app, md, pdf } = await setup();
    await request(app).put(`/api/documents/${md.id}/progress`).send({ page: 1, zoom: 1.2, top: 0.42 }).expect(200);
    expect((await request(app).get(`/api/documents/${md.id}`)).body.progress).toMatchObject({ page: 1, zoom: 1.2, top: 0.42 });
    // PDFs don't send it; the stored value is kept.
    await request(app).put(`/api/documents/${pdf.id}/progress`).send({ page: 2, zoom: 1 }).expect(200);
    expect((await request(app).get(`/api/documents/${pdf.id}`)).body.progress.top).toBeNull();
    await request(app).put(`/api/documents/${md.id}/progress`).send({ page: 1, zoom: 1 }).expect(200);
    expect((await request(app).get(`/api/documents/${md.id}`)).body.progress.top).toBe(0.42);
  });

  it("serve pictures next to a Markdown file, and nothing else", async () => {
    const { app, md } = await setup();
    const r = await request(app).get(`/api/documents/${md.id}/asset`).query({ path: "img/tree.png" }).expect(200);
    expect(r.headers["content-type"]).toBe("image/png");
    expect(r.headers["content-security-policy"]).toBe("sandbox");
    await request(app).get(`/api/documents/${md.id}/asset`).query({ path: "secret.txt" }).expect(400);
    await request(app).get(`/api/documents/${md.id}/asset`).query({ path: "../../etc/x.png" }).expect(404);
    await request(app).get(`/api/documents/${md.id}/asset`).query({ path: "img/missing.png" }).expect(404);
  });
});
