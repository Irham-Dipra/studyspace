import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { afterAll, describe, expect, it } from "vitest";
import { countStudySpaceAnnotations } from "../src/pdf/operations.js";
import { displayToPdf } from "../src/pdf/coords.js";
import { DeletionMap, mapRangeAfterInsert, unmapPageAfterDelete, unmapPageAfterInsert } from "../src/pdf/pageMap.js";
import { cleanupTempDirs, createTestContext, tempDir, writePdf } from "./helpers.js";

afterAll(cleanupTempDirs);

async function setup(pages = 10) {
  const ctx = createTestContext();
  const root = tempDir();
  const file = await writePdf(path.join(root, "Edit me.pdf"), pages, "main");
  await writePdf(path.join(root, "Source.pdf"), 5, "source");
  await request(ctx.app).post("/api/directories").send({ path: root }).expect(201);
  const docs = (await request(ctx.app).get("/api/library")).body.documents;
  const doc = docs.find((d: { title: string }) => d.title === "Edit me");
  const source = docs.find((d: { title: string }) => d.title === "Source");
  return { ...ctx, root, file, doc, source };
}

const pageCount = async (file: string) => (await PDFDocument.load(fs.readFileSync(file))).getPageCount();

describe("page map", () => {
  it("remaps ranges after insertion", () => {
    expect(mapRangeAfterInsert(3, 3, 5, 2)).toEqual([3, 3]);
    expect(mapRangeAfterInsert(6, 8, 5, 2)).toEqual([8, 10]);
    expect(mapRangeAfterInsert(4, 7, 5, 2)).toEqual([4, 9]);
    expect(mapRangeAfterInsert(1, 1, 0, 1)).toEqual([2, 2]);
  });

  it("remaps pages after deletion", () => {
    const m = new DeletionMap([2, 5, 6], 10);
    expect(m.newPageCount).toBe(7);
    expect(m.map(1)).toBe(1);
    expect(m.map(2)).toBeNull();
    expect(m.map(3)).toBe(2);
    expect(m.map(7)).toBe(4);
    expect(m.mapRange(4, 7)).toEqual([3, 4]);
    expect(m.mapRange(5, 6)).toBeNull();
    expect(m.nearest(5)).toBe(4); // next survivor is old page 7 -> new 4
    expect(new DeletionMap([10], 10).nearest(10)).toBe(9);
  });

  it("inverts insertions and deletions (for undo)", () => {
    expect([1, 2, 3, 4, 5, 6].map((p) => unmapPageAfterInsert(p, 2, 2))).toEqual([1, 2, null, null, 3, 4]);
    const m = new DeletionMap([2, 5, 6], 10);
    for (let p = 1; p <= 10; p++) {
      const n = m.map(p);
      if (n !== null) expect(unmapPageAfterDelete(n, [2, 5, 6], 10)).toBe(p);
    }
  });
});

describe("coordinate conversion", () => {
  const box: [number, number, number, number] = [0, 0, 400, 600];
  it("handles unrotated pages", () => {
    expect(displayToPdf(0, 0, { box, rotation: 0 })).toEqual([0, 600]);
    expect(displayToPdf(1, 1, { box, rotation: 0 })).toEqual([400, 0]);
  });
  it("handles rotated pages", () => {
    // 90° clockwise: displayed top-left is PDF bottom-left.
    expect(displayToPdf(0, 0, { box, rotation: 90 })).toEqual([0, 0]);
    expect(displayToPdf(1, 0, { box, rotation: 90 })).toEqual([0, 600]);
    expect(displayToPdf(0, 0, { box, rotation: 180 })).toEqual([400, 0]);
    expect(displayToPdf(0, 0, { box, rotation: 270 })).toEqual([400, 600]);
  });
  it("honours crop box offsets", () => {
    expect(displayToPdf(0.5, 0.5, { box: [100, 100, 300, 500], rotation: 0 })).toEqual([200, 300]);
  });
});

describe("page editing", () => {
  it("inserts a blank page and shifts page-scoped notes, annotations and progress", async () => {
    const { app, doc, file, dataDir } = await setup(10);
    const add = (body: object) => request(app).post(`/api/documents/${doc.id}/resources`).send(body).expect(201);
    const p3 = (await add({ type: "note", scope: "page", pageStart: 3, title: "p3" })).body;
    const p6 = (await add({ type: "note", scope: "page", pageStart: 6, title: "p6" })).body;
    const r4to7 = (await add({ type: "pyq", scope: "range", pageStart: 4, pageEnd: 7, title: "r" })).body;
    const ann = (
      await request(app)
        .post(`/api/documents/${doc.id}/annotations`)
        .send({ page: 8, kind: "highlight", color: "#ffeb3b", rects: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.05 }] })
    ).body;
    await request(app).put(`/api/documents/${doc.id}/progress`).send({ page: 9, zoom: 1 });

    const res = await request(app)
      .post(`/api/documents/${doc.id}/pages/insert-blank`)
      .send({ after: 5, count: 1, fingerprint: doc.fingerprint });
    expect(res.status).toBe(200);
    expect(res.body.pageCount).toBe(11);
    expect(res.body.fingerprint).not.toBe(doc.fingerprint);
    expect(await pageCount(file)).toBe(11);

    const get = async (id: string) => (await request(app).get(`/api/resources/${id}`)).body;
    expect((await get(p3.id)).pageStart).toBe(3);
    expect((await get(p6.id)).pageStart).toBe(7);
    expect(await get(r4to7.id)).toMatchObject({ pageStart: 4, pageEnd: 8 });
    const anns = (await request(app).get(`/api/documents/${doc.id}/annotations`)).body;
    expect(anns.find((a: { id: string }) => a.id === ann.id).page).toBe(9);
    expect((await request(app).get(`/api/documents/${doc.id}/progress`)).body.page).toBe(10);

    // The previous version was kept in the data dir for undo.
    expect(res.body.editId).toBeTruthy();
    expect(fs.readdirSync(path.join(dataDir, "history", doc.id))).toEqual([`${res.body.editId}.pdf`]);

    // The rewritten file is still recognised as the same document on rescan.
    const scan = await request(app).post("/api/library/scan");
    expect(scan.body.added).toBe(0);
    expect((await request(app).get("/api/library")).body.documents).toHaveLength(2);
  });

  it("deletes pages without moving notes onto other pages", async () => {
    const { app, doc, file } = await setup(10);
    const add = (body: object) => request(app).post(`/api/documents/${doc.id}/resources`).send(body).expect(201);
    const onDeleted = (await add({ type: "note", scope: "page", pageStart: 4, title: "gone page" })).body;
    const after = (await add({ type: "note", scope: "page", pageStart: 8, title: "after" })).body;
    const range = (await add({ type: "summary", scope: "range", pageStart: 3, pageEnd: 6, title: "range" })).body;
    const wholeDoc = (await add({ type: "note", scope: "document", title: "doc" })).body;
    const annOnDeleted = (
      await request(app)
        .post(`/api/documents/${doc.id}/annotations`)
        .send({ page: 4, kind: "ink", color: "#ff0000", paths: [[[0.1, 0.1], [0.2, 0.2]]] })
    ).body;

    const res = await request(app).post(`/api/documents/${doc.id}/pages/delete`).send({ pages: [4, 5] });
    expect(res.status).toBe(200);
    expect(res.body.pageCount).toBe(8);
    expect(await pageCount(file)).toBe(8);

    const get = async (id: string) => (await request(app).get(`/api/resources/${id}`)).body;
    // A note that only belonged to a deleted page is removed with it, never re-attached to another page.
    expect((await request(app).get(`/api/resources/${onDeleted.id}`)).status).toBe(404);
    expect((await get(after.id)).pageStart).toBe(6);
    expect(await get(range.id)).toMatchObject({ pageStart: 3, pageEnd: 4 });
    expect((await get(wholeDoc.id)).scope).toBe("document");
    const anns = (await request(app).get(`/api/documents/${doc.id}/annotations`)).body;
    expect(anns.find((a: { id: string }) => a.id === annOnDeleted.id)).toBeUndefined();
  });

  it("refuses to delete every page", async () => {
    const { app, doc } = await setup(2);
    await request(app).post(`/api/documents/${doc.id}/pages/delete`).send({ pages: [1, 2] }).expect(400);
  });

  it("inserts pages from another library PDF", async () => {
    const { app, doc, source, file } = await setup(4);
    const res = await request(app)
      .post(`/api/documents/${doc.id}/pages/insert-from`)
      .send({ after: 2, sourceDocumentId: source.id, fromPage: 2, toPage: 4 });
    expect(res.status).toBe(200);
    expect(res.body.pageCount).toBe(7);
    expect(await pageCount(file)).toBe(7);
    await request(app)
      .post(`/api/documents/${doc.id}/pages/insert-from`)
      .send({ after: 2, sourceDocumentId: source.id, fromPage: 4, toPage: 9 })
      .expect(400);
  });

  it("replaces pages one for one: notes keep their pages, highlights on replaced pages go", async () => {
    const { app, doc, file, root } = await setup(6);
    // A source whose pages are a different size, so the swapped-in pages are recognisable.
    const src = await PDFDocument.create();
    for (let i = 0; i < 3; i++) src.addPage([300, 300 + i * 10]);
    fs.writeFileSync(path.join(root, "Square.pdf"), await src.save());
    await request(app).post("/api/library/scan").expect(200);
    const square = (await request(app).get("/api/library")).body.documents.find((d: { title: string }) => d.title === "Square");

    const add = async (body: object) => (await request(app).post(`/api/documents/${doc.id}/resources`).send(body).expect(201)).body;
    const onP3 = await add({ type: "note", scope: "page", pageStart: 3, title: "p3" });
    const onP5 = await add({ type: "note", scope: "page", pageStart: 5, title: "p5" });
    const range = await add({ type: "pyq", scope: "range", pageStart: 2, pageEnd: 4, title: "r2-4" });
    const ann = (p: number) =>
      request(app).post(`/api/documents/${doc.id}/annotations`).send({ page: p, kind: "area", color: "#ffd54f", rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] });
    const annOn3 = (await ann(3)).body;
    const annOn4 = (await ann(4)).body;
    const annOn5 = (await ann(5)).body;

    const res = await request(app)
      .post(`/api/documents/${doc.id}/pages/replace`)
      .send({ page: 3, sourceDocumentId: square.id, fromPage: 2, toPage: 3 });
    expect(res.status).toBe(200);
    expect(res.body.pageCount).toBe(6);
    const sizes = (await PDFDocument.load(fs.readFileSync(file))).getPages().map((pg) => [pg.getWidth(), pg.getHeight()]);
    expect(sizes).toEqual([[400, 600], [400, 600], [300, 310], [300, 320], [400, 600], [400, 600]]);

    const get = async (id: string) => (await request(app).get(`/api/resources/${id}`)).body;
    expect((await get(onP3.id)).pageStart).toBe(3);
    expect((await get(onP5.id)).pageStart).toBe(5);
    expect(await get(range.id)).toMatchObject({ pageStart: 2, pageEnd: 4 });
    const anns = (await request(app).get(`/api/documents/${doc.id}/annotations`)).body.map((a: { id: string }) => a.id);
    expect(anns).toEqual([annOn5.id]);

    const history = (await request(app).get(`/api/documents/${doc.id}/history`)).body;
    expect(history[0]).toMatchObject({ kind: "replace", label: "Replace pages 3–4 with pages 2–3 of “Square”" });

    // Undo restores the original pages and the removed highlights.
    await request(app).post(`/api/documents/${doc.id}/history/${res.body.editId}/undo`).expect(200);
    const back = (await PDFDocument.load(fs.readFileSync(file))).getPages().map((pg) => pg.getWidth());
    expect(back).toEqual([400, 400, 400, 400, 400, 400]);
    const restored = (await request(app).get(`/api/documents/${doc.id}/annotations`)).body.map((a: { id: string; page: number }) => [a.id, a.page]);
    expect(restored.sort()).toEqual([[annOn3.id, 3], [annOn4.id, 4], [annOn5.id, 5]].sort());
  });

  it("can keep highlights on replaced pages, and replace from the same PDF", async () => {
    const { app, doc, file } = await setup(4);
    const a = (
      await request(app)
        .post(`/api/documents/${doc.id}/annotations`)
        .send({ page: 2, kind: "area", color: "#ffd54f", rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] })
    ).body;
    const res = await request(app)
      .post(`/api/documents/${doc.id}/pages/replace`)
      .send({ page: 2, sourceDocumentId: doc.id, fromPage: 4, toPage: 4, keepAnnotations: true });
    expect(res.status).toBe(200);
    expect(await pageCount(file)).toBe(4);
    expect((await request(app).get(`/api/documents/${doc.id}/annotations`)).body.map((x: { id: string }) => x.id)).toEqual([a.id]);
  });

  it("validates replacement ranges", async () => {
    const { app, doc, source } = await setup(4);
    const replace = (body: object) => request(app).post(`/api/documents/${doc.id}/pages/replace`).send({ sourceDocumentId: source.id, ...body });
    await replace({ page: 4, fromPage: 1, toPage: 2 }).expect(400); // runs past the last page
    await replace({ page: 1, fromPage: 5, toPage: 6 }).expect(400); // source has 5 pages
    await replace({ page: 5, fromPage: 1, toPage: 1 }).expect(400);
    await replace({ page: 1, fromPage: 3, toPage: 2 }).expect(400);
    await request(app).post(`/api/documents/${doc.id}/pages/replace`).send({ page: 1, sourceDocumentId: "nope", fromPage: 1, toPage: 1 }).expect(404);
  });

  it("rejects edits when the client's fingerprint is stale", async () => {
    const { app, doc } = await setup(3);
    await request(app)
      .post(`/api/documents/${doc.id}/pages/insert-blank`)
      .send({ after: 1, fingerprint: "v1:stale" })
      .expect(409);
  });
});

describe("saving annotations into the PDF", () => {
  it("writes standard annotations idempotently and leaves other annotations alone", async () => {
    const { app, doc, file } = await setup(3);
    const post = (body: object) => request(app).post(`/api/documents/${doc.id}/annotations`).send(body).expect(201);
    await post({ page: 1, kind: "highlight", color: "#ffeb3b", rects: [{ x: 0.1, y: 0.1, w: 0.4, h: 0.03 }], text: "hi" });
    await post({ page: 2, kind: "area", color: "#4caf50", rects: [{ x: 0.2, y: 0.2, w: 0.3, h: 0.3 }] });
    const ink = (await post({ page: 3, kind: "ink", color: "#2196f3", paths: [[[0.1, 0.5], [0.3, 0.6], [0.5, 0.5]]] })).body;

    expect((await request(app).get(`/api/documents/${doc.id}`)).body.annotationsDirty).toBe(true);
    const saved = await request(app).post(`/api/documents/${doc.id}/annotations/save`).send({});
    expect(saved.status).toBe(200);
    expect(saved.body.annotationsDirty).toBe(false);

    let pdf = await PDFDocument.load(fs.readFileSync(file));
    expect(countStudySpaceAnnotations(pdf)).toBe(3);

    // Saving again must replace, not duplicate.
    await request(app).delete(`/api/annotations/${ink.id}`).expect(204);
    await request(app).post(`/api/documents/${doc.id}/annotations/save`).send({}).expect(200);
    await request(app).post(`/api/documents/${doc.id}/annotations/save`).send({}).expect(200);
    pdf = await PDFDocument.load(fs.readFileSync(file));
    expect(countStudySpaceAnnotations(pdf)).toBe(2);
    const subtypes = pdf.getPages().flatMap((p) => {
      const annots = p.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
      return annots ? annots.asArray().map((r) => String(pdf.context.lookup(r, PDFDict).get(PDFName.of("Subtype")))) : [];
    });
    expect(subtypes).toEqual(["/Highlight", "/Highlight"]);
  });
});

describe("orphan policy and undo", () => {
  const seed = async (app: Parameters<typeof request>[0], docId: string) => {
    const add = async (body: object) => (await request(app).post(`/api/documents/${docId}/resources`).send(body).expect(201)).body;
    return {
      onP4: await add({ type: "note", scope: "page", pageStart: 4, title: "p4" }),
      onP7: await add({ type: "note", scope: "page", pageStart: 7, title: "p7" }),
      range: await add({ type: "pyq", scope: "range", pageStart: 3, pageEnd: 6, title: "r3-6" }),
      ann: (
        await request(app)
          .post(`/api/documents/${docId}/annotations`)
          .send({ page: 4, kind: "highlight", color: "#ffd54f", rects: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.03 }] })
      ).body,
    };
  };

  it("can keep notes from deleted pages as whole-document notes", async () => {
    const { app, doc } = await setup(10);
    const s = await seed(app, doc.id);
    await request(app).post(`/api/documents/${doc.id}/pages/delete`).send({ pages: [4], orphans: "document" }).expect(200);
    const get = async (id: string) => (await request(app).get(`/api/resources/${id}`)).body;
    expect(await get(s.onP4.id)).toMatchObject({ scope: "document", pageStart: null });
    expect((await get(s.onP7.id)).pageStart).toBe(6);
    expect(await get(s.range.id)).toMatchObject({ pageStart: 3, pageEnd: 5 });
  });

  it("undoes a page deletion: file, notes, ranges and highlights return to their original pages", async () => {
    const { app, doc, file } = await setup(10);
    const s = await seed(app, doc.id);
    await request(app).post(`/api/resources/${s.onP4.id}/highlights`).send({ color: "#ffd54f", quote: "p4" }).expect(201);
    const del = await request(app).post(`/api/documents/${doc.id}/pages/delete`).send({ pages: [4, 5] }).expect(200);
    expect((await request(app).get(`/api/documents/${doc.id}/note-highlights`)).body).toEqual([]);
    expect(await pageCount(file)).toBe(8);
    // A note added after the delete, on (new) page 5 = old page 7.
    const later = (
      await request(app).post(`/api/documents/${doc.id}/resources`).send({ type: "note", scope: "page", pageStart: 5, title: "later" })
    ).body;

    const history = (await request(app).get(`/api/documents/${doc.id}/history`)).body;
    expect(history[0]).toMatchObject({ id: del.body.editId, kind: "delete", label: "Delete 2 pages" });

    const undone = await request(app).post(`/api/documents/${doc.id}/history/${del.body.editId}/undo`);
    expect(undone.status).toBe(200);
    expect(undone.body.pageCount).toBe(10);
    expect(await pageCount(file)).toBe(10);
    const get = async (id: string) => (await request(app).get(`/api/resources/${id}`)).body;
    expect(await get(s.onP4.id)).toMatchObject({ scope: "page", pageStart: 4, pageEnd: 4 });
    expect((await get(s.onP7.id)).pageStart).toBe(7);
    expect(await get(s.range.id)).toMatchObject({ pageStart: 3, pageEnd: 6 });
    expect((await get(later.id)).pageStart).toBe(7);
    const anns = (await request(app).get(`/api/documents/${doc.id}/annotations`)).body;
    expect(anns.map((a: { id: string; page: number }) => [a.id, a.page])).toEqual([[s.ann.id, 4]]);
    expect((await request(app).get(`/api/documents/${doc.id}/history`)).body).toEqual([]);
    // Highlights inside the restored note come back with it.
    const hl = (await request(app).get(`/api/documents/${doc.id}/note-highlights`)).body;
    expect(hl.map((h: { resourceId: string }) => h.resourceId)).toEqual([s.onP4.id]);

    // The restored file is still the same document after a rescan.
    expect((await request(app).post("/api/library/scan")).body.added).toBe(0);
  });

  it("undoes an insertion and only allows undoing the latest edit", async () => {
    const { app, doc, file } = await setup(5);
    const s = await seed(app, doc.id);
    const first = (await request(app).post(`/api/documents/${doc.id}/pages/insert-blank`).send({ after: 2, count: 2 })).body;
    const second = (await request(app).post(`/api/documents/${doc.id}/pages/insert-blank`).send({ after: 0, count: 1 })).body;
    expect(await pageCount(file)).toBe(8);
    await request(app).post(`/api/documents/${doc.id}/history/${first.editId}/undo`).expect(409);
    await request(app).post(`/api/documents/${doc.id}/history/${second.editId}/undo`).expect(200);
    await request(app).post(`/api/documents/${doc.id}/history/${first.editId}/undo`).expect(200);
    expect(await pageCount(file)).toBe(5);
    expect((await request(app).get(`/api/resources/${s.onP4.id}`)).body.pageStart).toBe(4);
  });

  it("undoes saving annotations into the file", async () => {
    const { app, doc, file } = await setup(3);
    const before = fs.readFileSync(file);
    await request(app)
      .post(`/api/documents/${doc.id}/annotations`)
      .send({ page: 1, kind: "highlight", color: "#ffd54f", rects: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.03 }] });
    const saved = (await request(app).post(`/api/documents/${doc.id}/annotations/save`).send({})).body;
    expect(countStudySpaceAnnotations(await PDFDocument.load(fs.readFileSync(file)))).toBe(1);
    const undone = (await request(app).post(`/api/documents/${doc.id}/history/${saved.editId}/undo`)).body;
    expect(Buffer.compare(fs.readFileSync(file), before)).toBe(0);
    expect(undone.annotationsDirty).toBe(true);
    expect((await request(app).get(`/api/documents/${doc.id}/annotations`)).body).toHaveLength(1);
  });

  it("refuses to undo when the file was changed by another program", async () => {
    const { app, doc, file } = await setup(3);
    const ins = (await request(app).post(`/api/documents/${doc.id}/pages/insert-blank`).send({ after: 1 })).body;
    await writePdf(file, 2, "external edit");
    await request(app).post(`/api/documents/${doc.id}/history/${ins.editId}/undo`).expect(409);
  });

  it("recreates deleted annotations and resources with their original ids (for redo/undo)", async () => {
    const { app, doc } = await setup(3);
    const id = "3f2b8c1e-2a4d-4c6b-9f0e-1a2b3c4d5e6f";
    const body = { id, page: 1, kind: "ink", color: "#e53935", paths: [[[0.1, 0.1], [0.2, 0.2]]] };
    await request(app).post(`/api/documents/${doc.id}/annotations`).send(body).expect(201);
    await request(app).post(`/api/documents/${doc.id}/annotations`).send(body).expect(409);
    await request(app).delete(`/api/annotations/${id}`).expect(204);
    await request(app).post(`/api/documents/${doc.id}/annotations`).send(body).expect(201);
    const rid = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
    await request(app).post(`/api/documents/${doc.id}/resources`).send({ id: rid, type: "note", scope: "document" }).expect(201);
    await request(app).post(`/api/documents/${doc.id}/resources`).send({ id: rid, type: "note", scope: "document" }).expect(400);
  });
});
