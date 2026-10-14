import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from "pdf-lib";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, createTestContext, tempDir, writePdf } from "./helpers.js";

afterAll(cleanupTempDirs);

async function setup(pages = 10) {
  const ctx = createTestContext();
  const root = tempDir();
  const file = await writePdf(path.join(root, "Book.pdf"), pages, "book");
  await request(ctx.app).post("/api/directories").send({ path: root }).expect(201);
  const doc = (await request(ctx.app).get("/api/library")).body.documents[0];
  return { ...ctx, root, file, doc };
}

interface Outline {
  title: string;
  page: number;
  top: number | null;
  collapsed: boolean;
  children: Outline[];
}

/** Reads a PDF's outline with pdf-lib: titles, 1-based target pages and the XYZ top. */
async function readOutline(file: string): Promise<Outline[] | null> {
  const pdf = await PDFDocument.load(fs.readFileSync(file));
  const root = pdf.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  if (!root) return null;
  const pageRefs = pdf.getPages().map((p) => p.ref.toString());
  const walk = (first: PDFDict | undefined): Outline[] => {
    const out: Outline[] = [];
    for (let item = first; item; item = item.lookupMaybe(PDFName.of("Next"), PDFDict)) {
      const title = item.lookup(PDFName.of("Title")) as PDFHexString | PDFString;
      const dest = item.lookup(PDFName.of("Dest"), PDFArray);
      const target = dest.get(0) as PDFRef;
      const top = dest.lookup(3);
      const count = item.lookupMaybe(PDFName.of("Count"), PDFNumber)?.asNumber() ?? 0;
      out.push({
        title: title.decodeText(),
        page: pageRefs.indexOf(target.toString()) + 1,
        top: top instanceof PDFNumber ? top.asNumber() : null,
        collapsed: count < 0,
        children: walk(item.lookupMaybe(PDFName.of("First"), PDFDict)),
      });
    }
    return out;
  };
  return walk(root.lookupMaybe(PDFName.of("First"), PDFDict));
}

const shape = (list: Outline[]): unknown[] => list.map((o) => [o.title, o.page, ...(o.children.length ? [shape(o.children)] : [])]);

describe("bookmarks", () => {
  it("creates, renames, nests, reorders and deletes bookmarks", async () => {
    const { app, doc } = await setup();
    const add = (body: object) => request(app).post(`/api/documents/${doc.id}/bookmarks`).send(body);
    const a = (await add({ title: "Chapter 1", page: 1 }).expect(201)).body;
    const b = (await add({ title: "Chapter 2", page: 5, top: 0.4 }).expect(201)).body;
    expect(b.position).toBeGreaterThan(a.position);
    expect(b.top).toBeCloseTo(0.4);
    await add({ title: "   ", page: 1 }).expect(400);
    await add({ title: "x", page: 0 }).expect(400);

    const c = (await add({ title: "1.1", page: 2, parentId: a.id }).expect(201)).body;
    await request(app).patch(`/api/bookmarks/${c.id}`).send({ title: "Section 1.1" }).expect(200);
    // Cycles are refused: a bookmark can't go inside itself or its own child.
    await request(app).patch(`/api/bookmarks/${a.id}`).send({ parentId: c.id }).expect(400);
    await request(app).patch(`/api/bookmarks/${a.id}`).send({ parentId: a.id }).expect(400);
    // Moving under another parent appends it there.
    const moved = (await request(app).patch(`/api/bookmarks/${c.id}`).send({ parentId: b.id }).expect(200)).body;
    expect(moved.parentId).toBe(b.id);
    // Outdent back to the top level.
    expect((await request(app).patch(`/api/bookmarks/${c.id}`).send({ parentId: null }).expect(200)).body.parentId).toBeNull();
    await request(app).patch(`/api/bookmarks/${c.id}`).send({ parentId: b.id }).expect(200);

    let list = (await request(app).get(`/api/documents/${doc.id}/bookmarks`).expect(200)).body;
    expect(list.bookmarks.map((x: { title: string }) => x.title).sort()).toEqual(["Chapter 1", "Chapter 2", "Section 1.1"]);
    expect((await request(app).get(`/api/documents/${doc.id}`)).body.bookmarksDirty).toBe(true);

    // Deleting a parent deletes its children.
    await request(app).delete(`/api/bookmarks/${b.id}`).expect(204);
    list = (await request(app).get(`/api/documents/${doc.id}/bookmarks`)).body;
    expect(list.bookmarks.map((x: { id: string }) => x.id)).toEqual([a.id]);
    await request(app).delete(`/api/bookmarks/${b.id}`).expect(404);

    // Client ids (for undo) are accepted once.
    const id = "6f1c2a52-1111-4a8c-9b7e-1234567890ab";
    await add({ id, title: "again", page: 3 }).expect(201);
    await add({ id, title: "again", page: 3 }).expect(409);
  });

  it("imports the PDF's outline once, without marking it unsaved", async () => {
    const { app, doc } = await setup();
    const entries = [
      { title: "Part I", page: 1, children: [{ title: "Intro", page: 2, top: 0.25 }] },
      { title: "  ", page: 50 },
    ];
    const res = (await request(app).post(`/api/documents/${doc.id}/bookmarks/import`).send({ entries }).expect(200)).body;
    expect(res.imported).toBe(true);
    expect(res.bookmarks).toHaveLength(3);
    const intro = res.bookmarks.find((b: { title: string }) => b.title === "Intro");
    const part = res.bookmarks.find((b: { title: string }) => b.title === "Part I");
    expect(intro.parentId).toBe(part.id);
    expect(res.bookmarks.some((b: { title: string }) => b.title === "Untitled")).toBe(true);
    expect((await request(app).get(`/api/documents/${doc.id}`)).body.bookmarksDirty).toBe(false);

    // A second import (another tab, a reload) changes nothing.
    const again = (await request(app).post(`/api/documents/${doc.id}/bookmarks/import`).send({ entries: [{ title: "x", page: 1 }] }))
      .body;
    expect(again.bookmarks).toHaveLength(3);
  });

  it("writes the bookmarks into the PDF as its outline when saving, and undo restores both", async () => {
    const { app, doc, file } = await setup();
    const original = fs.readFileSync(file);
    await request(app).post(`/api/documents/${doc.id}/bookmarks/import`).send({ entries: [] }).expect(200);
    const add = async (body: object) => (await request(app).post(`/api/documents/${doc.id}/bookmarks`).send(body).expect(201)).body;
    const ch1 = await add({ title: "Chapter 1 — Basics", page: 1 });
    await add({ title: "Ω and ∑ (unicode)", page: 3, top: 0.5, parentId: ch1.id });
    await add({ title: "Chapter 2", page: 7 });

    const saved = await request(app).post(`/api/documents/${doc.id}/annotations/save`).send({}).expect(200);
    const outline = await readOutline(file);
    expect(shape(outline!)).toEqual([["Chapter 1 — Basics", 1, [["Ω and ∑ (unicode)", 3]]], ["Chapter 2", 7]]);
    expect(outline![0].top).toBe(600); // no position -> top of the page
    expect(outline![0].children[0].top).toBeCloseTo(300); // halfway down a 600pt page
    expect(outline![0].collapsed).toBe(true);
    const after = (await request(app).get(`/api/documents/${doc.id}`)).body;
    expect(after.bookmarksDirty).toBe(false);

    // Saving again replaces the outline instead of adding a second copy.
    await request(app).patch(`/api/bookmarks/${ch1.id}`).send({ title: "Chapter One" }).expect(200);
    await request(app).post(`/api/documents/${doc.id}/annotations/save`).send({}).expect(200);
    expect(shape((await readOutline(file))!)).toEqual([["Chapter One", 1, [["Ω and ∑ (unicode)", 3]]], ["Chapter 2", 7]]);

    // Deleting every bookmark and saving removes the outline.
    for (const b of (await request(app).get(`/api/documents/${doc.id}/bookmarks`)).body.bookmarks) {
      await request(app).delete(`/api/bookmarks/${b.id}`);
    }
    const emptied = await request(app).post(`/api/documents/${doc.id}/annotations/save`).send({}).expect(200);
    expect(await readOutline(file)).toBeNull();

    // Undoing a save restores the file; the bookmarks are as they were when it ran (the deletions
    // above are separate undo steps in the browser), so they now differ from the file: unsaved.
    await request(app).post(`/api/documents/${doc.id}/history/${emptied.body.editId}/undo`).expect(200);
    expect(shape((await readOutline(file))!)).toEqual([["Chapter One", 1, [["Ω and ∑ (unicode)", 3]]], ["Chapter 2", 7]]);
    expect((await request(app).get(`/api/documents/${doc.id}/bookmarks`)).body.bookmarks).toHaveLength(0);
    expect((await request(app).get(`/api/documents/${doc.id}`)).body.bookmarksDirty).toBe(true);
    const history = (await request(app).get(`/api/documents/${doc.id}/history`)).body;
    for (const h of history) await request(app).post(`/api/documents/${doc.id}/history/${h.id}/undo`).expect(200);
    expect(saved.body.editId).toBeTruthy();
    expect(fs.readFileSync(file).equals(original)).toBe(true);
    expect(await readOutline(file)).toBeNull();
    const back = (await request(app).get(`/api/documents/${doc.id}/bookmarks`)).body.bookmarks;
    expect(back.map((b: { title: string }) => b.title).sort()).toEqual(["Chapter 1 — Basics", "Chapter 2", "Ω and ∑ (unicode)"]);
    expect((await request(app).get(`/api/documents/${doc.id}`)).body.bookmarksDirty).toBe(true);
  });

  it("does not rewrite a PDF's own outline before it has been read", async () => {
    const { app, doc, file } = await setup();
    // A highlight save on a PDF whose outline the browser never imported keeps the file's outline alone.
    await request(app).post(`/api/documents/${doc.id}/annotations`).send({ page: 1, kind: "highlight", color: "#ffee00", rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 }] }).expect(201);
    await request(app).post(`/api/documents/${doc.id}/annotations/save`).send({}).expect(200);
    expect(await readOutline(file)).toBeNull();
  });

  it("moves bookmarks with their pages when pages are inserted or deleted, and undo puts them back", async () => {
    const { app, doc } = await setup(10);
    await request(app).post(`/api/documents/${doc.id}/bookmarks/import`).send({ entries: [] });
    const add = async (title: string, page: number, top?: number) =>
      (await request(app).post(`/api/documents/${doc.id}/bookmarks`).send({ title, page, top }).expect(201)).body;
    await add("p2", 2);
    await add("p5", 5, 0.3);
    await add("p8", 8);
    const pages = async () =>
      Object.fromEntries(
        (await request(app).get(`/api/documents/${doc.id}/bookmarks`)).body.bookmarks.map((b: { title: string; page: number; top: number | null }) => [
          b.title,
          [b.page, b.top],
        ]),
      );

    const ins = await request(app).post(`/api/documents/${doc.id}/pages/insert-blank`).send({ after: 3, count: 2 }).expect(200);
    expect(await pages()).toEqual({ p2: [2, null], p5: [7, 0.3], p8: [10, null] });

    const del = await request(app).post(`/api/documents/${doc.id}/pages/delete`).send({ pages: [7, 8] }).expect(200);
    // The bookmark on a deleted page moves to the next page that survives (its old position is meaningless).
    expect(await pages()).toEqual({ p2: [2, null], p5: [7, null], p8: [8, null] });

    await request(app).post(`/api/documents/${doc.id}/history/${del.body.editId}/undo`).expect(200);
    expect(await pages()).toEqual({ p2: [2, null], p5: [7, 0.3], p8: [10, null] });
    await request(app).post(`/api/documents/${doc.id}/history/${ins.body.editId}/undo`).expect(200);
    expect(await pages()).toEqual({ p2: [2, null], p5: [5, 0.3], p8: [8, null] });
  });

  it("keeps bookmarks added after an edit when that edit is undone", async () => {
    const { app, doc } = await setup(10);
    await request(app).post(`/api/documents/${doc.id}/bookmarks/import`).send({ entries: [] });
    const ins = await request(app).post(`/api/documents/${doc.id}/pages/insert-blank`).send({ after: 0, count: 1 }).expect(200);
    await request(app).post(`/api/documents/${doc.id}/bookmarks`).send({ title: "late", page: 6 }).expect(201);
    await request(app).post(`/api/documents/${doc.id}/history/${ins.body.editId}/undo`).expect(200);
    const list = (await request(app).get(`/api/documents/${doc.id}/bookmarks`)).body.bookmarks;
    expect(list.map((b: { title: string; page: number }) => [b.title, b.page])).toEqual([["late", 5]]);
  });

  it("re-reads the outline after another program changes the file, unless bookmarks are unsaved", async () => {
    const { app, doc, file } = await setup(4);
    await request(app).post(`/api/documents/${doc.id}/bookmarks/import`).send({ entries: [{ title: "old", page: 1 }] });
    await writePdf(file, 6, "rewritten");
    await request(app).post("/api/library/scan").expect(200);
    let res = (await request(app).get(`/api/documents/${doc.id}/bookmarks`)).body;
    expect(res).toEqual({ imported: false, bookmarks: [] });

    // With unsaved bookmarks, nothing is thrown away.
    await request(app).post(`/api/documents/${doc.id}/bookmarks/import`).send({ entries: [] });
    await request(app).post(`/api/documents/${doc.id}/bookmarks`).send({ title: "mine", page: 2 }).expect(201);
    await writePdf(file, 3, "rewritten again");
    await request(app).post("/api/library/scan").expect(200);
    res = (await request(app).get(`/api/documents/${doc.id}/bookmarks`)).body;
    expect(res.imported).toBe(true);
    expect(res.bookmarks.map((b: { title: string }) => b.title)).toEqual(["mine"]);
  });
});
