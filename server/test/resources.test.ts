import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, createTestContext, tempDir, writePdf } from "./helpers.js";

afterAll(cleanupTempDirs);

let ctx: ReturnType<typeof createTestContext>;
let docId: string;

beforeAll(async () => {
  ctx = createTestContext();
  const root = tempDir();
  await writePdf(path.join(root, "Course", "Book.pdf"), 30);
  await request(ctx.app).post("/api/directories").send({ path: root }).expect(201);
  docId = (await request(ctx.app).get("/api/library")).body.documents[0].id;
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe("resource CRUD", () => {
  it("creates, reads, updates and deletes a note", async () => {
    const created = await request(ctx.app)
      .post(`/api/documents/${docId}/resources`)
      .send({ type: "note", scope: "page", pageStart: 5, title: "Def", content: "# Heading\n\n**bold**" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ type: "note", scope: "page", pageStart: 5, pageEnd: 5, title: "Def" });

    const id = created.body.id;
    const got = await request(ctx.app).get(`/api/resources/${id}`);
    expect(got.body.content).toBe("# Heading\n\n**bold**");

    const patched = await request(ctx.app).patch(`/api/resources/${id}`).send({ content: "updated" });
    expect(patched.body.content).toBe("updated");
    expect(patched.body.pageStart).toBe(5);

    await request(ctx.app).delete(`/api/resources/${id}`).expect(204);
    await request(ctx.app).get(`/api/resources/${id}`).expect(404);
    await request(ctx.app).delete(`/api/resources/${id}`).expect(404);
  });

  it("validates input", async () => {
    const bad = [
      { type: "bogus", scope: "page", pageStart: 1 },
      { type: "note", scope: "page" },
      { type: "note", scope: "page", pageStart: 0 },
      { type: "link", scope: "document", url: "not a url" },
    ];
    for (const body of bad) {
      const res = await request(ctx.app).post(`/api/documents/${docId}/resources`).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    await request(ctx.app)
      .post(`/api/documents/nope/resources`)
      .send({ type: "note", scope: "document" })
      .expect(404);
  });

  it("stores all resource types", async () => {
    for (const type of ["note", "ai_explanation", "summary", "pyq", "link"]) {
      const res = await request(ctx.app)
        .post(`/api/documents/${docId}/resources`)
        .send({ type, scope: "document", title: `t-${type}`, url: type === "link" ? "https://example.com" : undefined });
      expect(res.status).toBe(201);
    }
  });
});

describe("page-resource associations", () => {
  let fresh: string;
  beforeAll(async () => {
    const root = tempDir();
    await writePdf(path.join(root, "Assoc.pdf"), 30);
    await request(ctx.app).post("/api/directories").send({ path: root }).expect(201);
    fresh = (await request(ctx.app).get("/api/library")).body.documents.find((d: { title: string }) => d.title === "Assoc").id;
    const add = (body: object) => request(ctx.app).post(`/api/documents/${fresh}/resources`).send(body).expect(201);
    await add({ type: "note", scope: "page", pageStart: 10, title: "p10" });
    await add({ type: "pyq", scope: "range", pageStart: 8, pageEnd: 12, title: "r8-12" });
    await add({ type: "summary", scope: "range", pageStart: 20, pageEnd: 15, title: "r15-20" }); // reversed input
    await add({ type: "link", scope: "document", title: "whole", url: "https://example.org" });
  });

  it("returns page, covering range and document resources for a page", async () => {
    const at = async (p: number) => titles((await request(ctx.app).get(`/api/documents/${fresh}/resources?page=${p}`)).body);
    expect(await at(10)).toEqual(["p10", "r8-12", "whole"]);
    expect(await at(8)).toEqual(["r8-12", "whole"]);
    expect(await at(12)).toEqual(["r8-12", "whole"]);
    expect(await at(13)).toEqual(["whole"]);
    expect(await at(15)).toEqual(["r15-20", "whole"]);
    expect(await at(1)).toEqual(["whole"]);
  });

  it("normalises reversed ranges", async () => {
    const all = (await request(ctx.app).get(`/api/documents/${fresh}/resources`)).body;
    expect(all.find((r: { title: string }) => r.title === "r15-20")).toMatchObject({ pageStart: 15, pageEnd: 20 });
  });

  it("moves a resource between scopes", async () => {
    const all = (await request(ctx.app).get(`/api/documents/${fresh}/resources`)).body;
    const p10 = all.find((r: { title: string }) => r.title === "p10");
    const toDoc = await request(ctx.app).patch(`/api/resources/${p10.id}`).send({ scope: "document" });
    expect(toDoc.body).toMatchObject({ scope: "document", pageStart: null, pageEnd: null });
    expect(titles((await request(ctx.app).get(`/api/documents/${fresh}/resources?page=25`)).body)).toContain("p10");

    const toRange = await request(ctx.app).patch(`/api/resources/${p10.id}`).send({ scope: "range", pageStart: 2, pageEnd: 3 });
    expect(toRange.body).toMatchObject({ scope: "range", pageStart: 2, pageEnd: 3 });
    expect(titles((await request(ctx.app).get(`/api/documents/${fresh}/resources?page=25`)).body)).not.toContain("p10");
    expect(titles((await request(ctx.app).get(`/api/documents/${fresh}/resources?page=3`)).body)).toContain("p10");
  });

  it("searches resource content", async () => {
    const res = await request(ctx.app).get("/api/search?q=r8-12");
    expect(res.body.resources.map((r: { title: string }) => r.title)).toEqual(["r8-12"]);
  });
});

describe("reading progress", () => {
  it("saves and restores last page and zoom", async () => {
    await request(ctx.app).put(`/api/documents/${docId}/progress`).send({ page: 7, zoom: 1.5 }).expect(200);
    const doc = await request(ctx.app).get(`/api/documents/${docId}`);
    expect(doc.body.progress).toMatchObject({ page: 7, zoom: 1.5 });
    const recent = await request(ctx.app).get("/api/recent");
    expect(recent.body[0].documentId).toBe(docId);
  });
});

describe("highlights inside notes", () => {
  it("creates, lists, recolours, comments on and deletes note highlights", async () => {
    const note = (
      await request(ctx.app).post(`/api/documents/${docId}/resources`).send({ type: "note", scope: "page", pageStart: 2, content: "Mutual exclusion and hold and wait" })
    ).body;
    const created = await request(ctx.app)
      .post(`/api/resources/${note.id}/highlights`)
      .send({ color: "#ffd54f", quote: "hold and wait", prefix: "Mutual exclusion and ", suffix: "" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ resourceId: note.id, quote: "hold and wait", comment: "" });

    const list = (await request(ctx.app).get(`/api/documents/${docId}/note-highlights`)).body;
    expect(list.map((h: { id: string }) => h.id)).toContain(created.body.id);

    const patched = await request(ctx.app).patch(`/api/note-highlights/${created.body.id}`).send({ color: "#81c784", comment: "Coffman #2" });
    expect(patched.body).toMatchObject({ color: "#81c784", comment: "Coffman #2" });

    await request(ctx.app).post(`/api/resources/${note.id}/highlights`).send({ color: "red", quote: "x" }).expect(400);
    await request(ctx.app).post(`/api/resources/${note.id}/highlights`).send({ color: "#ffd54f", quote: "" }).expect(400);
    await request(ctx.app).post(`/api/resources/nope/highlights`).send({ color: "#ffd54f", quote: "x" }).expect(404);

    await request(ctx.app).delete(`/api/note-highlights/${created.body.id}`).expect(204);
    await request(ctx.app).delete(`/api/note-highlights/${created.body.id}`).expect(404);
  });

  it("removes a note's highlights when the note is deleted", async () => {
    const note = (await request(ctx.app).post(`/api/documents/${docId}/resources`).send({ type: "note", scope: "document", content: "abc" })).body;
    const h = (await request(ctx.app).post(`/api/resources/${note.id}/highlights`).send({ color: "#ffd54f", quote: "abc" })).body;
    await request(ctx.app).delete(`/api/resources/${note.id}`).expect(204);
    const list = (await request(ctx.app).get(`/api/documents/${docId}/note-highlights`)).body;
    expect(list.find((x: { id: string }) => x.id === h.id)).toBeUndefined();
  });
});

describe("note colours", () => {
  it("keeps colours picked for single elements, and leaves them alone on other edits", async () => {
    const created = await request(ctx.app)
      .post(`/api/documents/${docId}/resources`)
      .send({ type: "note", scope: "document", content: "# A", styles: { "h:A": "#ff0000" } })
      .expect(201);
    expect(created.body.styles).toEqual({ "h:A": "#ff0000" });
    const id = created.body.id;

    const edited = await request(ctx.app).patch(`/api/resources/${id}`).send({ content: "# A\n\nmore" }).expect(200);
    expect(edited.body.styles).toEqual({ "h:A": "#ff0000" });

    const recoloured = await request(ctx.app).patch(`/api/resources/${id}`).send({ styles: { title: "none" } }).expect(200);
    expect(recoloured.body.styles).toEqual({ title: "none" });

    await request(ctx.app).patch(`/api/resources/${id}`).send({ styles: { "h:A": "red" } }).expect(400);
    const plain = await request(ctx.app).post(`/api/documents/${docId}/resources`).send({ type: "note", scope: "document" }).expect(201);
    expect(plain.body.styles).toEqual({});
  });
});
