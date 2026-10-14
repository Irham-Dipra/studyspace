import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { afterAll, describe, expect, it } from "vitest";
import { orderAfterMove } from "../src/pdf/pageMap.js";
import { rotateNormRect } from "../src/pdf/coords.js";
import { cleanupTempDirs, createTestContext, tempDir } from "./helpers.js";

afterAll(cleanupTempDirs);

/** A PDF whose page i is (300 + i) points wide, so page order can be checked without reading text. */
async function writeNumbered(file: string, pages: number, offset = 0): Promise<string> {
  const pdf = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) pdf.addPage([300 + offset + i, 500]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, await pdf.save());
  return file;
}

const widths = async (file: string) => (await PDFDocument.load(fs.readFileSync(file))).getPages().map((p) => p.getWidth() - 300);

async function setup() {
  const ctx = createTestContext();
  const root = tempDir();
  const file = await writeNumbered(path.join(root, "Course", "Book.pdf"), 10);
  const other = await writeNumbered(path.join(root, "Course", "Slides.pdf"), 4, 100);
  await request(ctx.app).post("/api/directories").send({ path: root }).expect(201);
  const docs = (await request(ctx.app).get("/api/library")).body.documents;
  const doc = docs.find((d: { title: string }) => d.title === "Book");
  const slides = docs.find((d: { title: string }) => d.title === "Slides");
  return { ...ctx, root, file, other, doc, slides, folder: path.join(root, "Course") };
}

/** Titles and pages of a PDF's outline (one level of children). */
async function outline(file: string) {
  const pdf = await PDFDocument.load(fs.readFileSync(file));
  const refs = pdf.getPages().map((p) => p.ref.toString());
  const root = pdf.catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  const walk = (item: PDFDict | undefined): unknown[] => {
    const out: unknown[] = [];
    for (; item; item = item.lookupMaybe(PDFName.of("Next"), PDFDict)) {
      const title = (item.lookup(PDFName.of("Title")) as unknown as { decodeText(): string }).decodeText();
      const dest = item.lookup(PDFName.of("Dest")) as unknown as { get(i: number): { toString(): string } };
      const kids = walk(item.lookupMaybe(PDFName.of("First"), PDFDict));
      out.push([title, refs.indexOf(dest.get(0).toString()) + 1, ...(kids.length ? [kids] : [])]);
    }
    return out;
  };
  return root ? walk(root.lookupMaybe(PDFName.of("First"), PDFDict)) : [];
}

describe("helpers", () => {
  it("computes the page order after a move", () => {
    expect(orderAfterMove([8, 9], 2, 10)).toEqual([1, 2, 8, 9, 3, 4, 5, 6, 7, 10]);
    expect(orderAfterMove([1], 10, 10)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 1]);
    expect(orderAfterMove([5, 3], 0, 5)).toEqual([3, 5, 1, 2, 4]);
  });
  it("turns rectangles with the page", () => {
    const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    expect(rotateNormRect(r, 90)).toEqual({ x: expect.closeTo(0.7), y: 0.1, w: expect.closeTo(0.1), h: expect.closeTo(0.3) });
    for (const a of [90, 180, 270]) {
      const back = rotateNormRect(rotateNormRect(r, a), 360 - a);
      for (const k of ["x", "y", "w", "h"] as const) expect(back[k]).toBeCloseTo(r[k]);
    }
  });
});

describe("new PDFs from pages (extract, split, merge)", () => {
  it("extracts pages into a new library PDF with their notes, highlights and bookmarks", async () => {
    const { app, doc, file, folder } = await setup();
    const before = fs.readFileSync(file);
    const id = doc.id;
    const note = (body: object) => request(app).post(`/api/documents/${id}/resources`).send({ type: "note", title: "n", content: "c", ...body }).expect(201);
    const p3 = (await note({ scope: "page", pageStart: 3, title: "on 3" })).body;
    await note({ scope: "range", pageStart: 2, pageEnd: 4, title: "2-4" });
    await note({ scope: "range", pageStart: 8, pageEnd: 9, title: "8-9" });
    await note({ scope: "document", title: "whole" });
    await request(app).post(`/api/resources/${p3.id}/highlights`).send({ color: "#ffee00", quote: "c" }).expect(201);
    const ann = (page: number) =>
      request(app).post(`/api/documents/${id}/annotations`).send({ page, kind: "highlight", color: "#ffee00", rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 }] }).expect(201);
    await ann(3);
    await ann(7);
    await request(app).post(`/api/documents/${id}/bookmarks/import`).send({ entries: [{ title: "Ch 1", page: 3, children: [{ title: "1.1", page: 4 }] }, { title: "Ch 2", page: 7 }] });

    const res = await request(app)
      .post("/api/pdf-tools/create")
      .send({ folder, outputs: [{ name: "Book - pages 3-5", segments: [{ documentId: id, pages: [3, 4, 5] }] }] })
      .expect(201);
    const created = res.body.documents[0];
    expect(created.relPath).toBe("Course/Book - pages 3-5.pdf");
    expect(created.pageCount).toBe(3);
    expect(await widths(created.path)).toEqual([3, 4, 5]);
    expect(await outline(created.path)).toEqual([["Ch 1", 1, [["1.1", 2]]]]);
    expect(fs.readFileSync(file).equals(before)).toBe(true); // the source is only read

    const notes = (await request(app).get(`/api/documents/${created.id}/resources`)).body;
    expect(notes.map((r: { title: string; scope: string; pageStart: number; pageEnd: number }) => [r.title, r.scope, r.pageStart, r.pageEnd]).sort()).toEqual([
      ["2-4", "range", 1, 2],
      ["on 3", "page", 1, 1],
    ]);
    expect((await request(app).get(`/api/documents/${created.id}/note-highlights`)).body).toHaveLength(1);
    expect((await request(app).get(`/api/documents/${created.id}/annotations`)).body.map((a: { page: number }) => a.page)).toEqual([1]);
    expect(created.annotationsDirty).toBe(true); // the source's highlights weren't saved into its file yet

    // It shows up in the library, and a rescan keeps the same entry.
    await request(app).post("/api/library/scan").expect(200);
    const lib = (await request(app).get("/api/library")).body.documents;
    expect(lib.filter((d: { title: string }) => d.title.startsWith("Book - pages")).map((d: { id: string }) => d.id)).toEqual([created.id]);
  });

  it("never overwrites a file, and can leave notes, highlights and bookmarks behind", async () => {
    const { app, doc, folder } = await setup();
    fs.writeFileSync(path.join(folder, "Part.pdf"), "not mine to overwrite");
    await request(app).post(`/api/documents/${doc.id}/annotations`).send({ page: 1, kind: "highlight", color: "#ffee00", rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 }] });
    const body = {
      folder,
      outputs: [
        { name: "Part.pdf", segments: [{ documentId: doc.id, pages: [1] }] },
        { name: "Part", segments: [{ documentId: doc.id, pages: [2] }] },
      ],
      copyNotes: false,
      copyHighlights: false,
      copyBookmarks: false,
    };
    const docs = (await request(app).post("/api/pdf-tools/create").send(body).expect(201)).body.documents;
    expect(docs.map((d: { title: string }) => d.title)).toEqual(["Part (2)", "Part (3)"]);
    expect(fs.readFileSync(path.join(folder, "Part.pdf"), "utf8")).toBe("not mine to overwrite");
    expect((await request(app).get(`/api/documents/${docs[0].id}/annotations`)).body).toEqual([]);
    expect(docs[0].annotationsDirty).toBe(false);
  });

  it("only saves inside library folders, with safe names", async () => {
    const { app, doc, folder, root } = await setup();
    const out = (body: object) => request(app).post("/api/pdf-tools/create").send({ outputs: [{ name: "x", segments: [{ documentId: doc.id, pages: [1] }] }], ...body });
    await out({ folder: tempDir() }).expect(403);
    await out({ folder: path.join(folder, "..", "..") }).expect(403);
    // Separators in names can't climb out of the folder.
    const evil = (await request(app).post("/api/pdf-tools/create").send({ folder, outputs: [{ name: "../../evil", segments: [{ documentId: doc.id, pages: [1] }] }] }).expect(201)).body;
    expect(path.dirname(evil.documents[0].path)).toBe(folder);
    // A new sub-folder is created inside the chosen one.
    const sub = (await out({ folder: root, newFolder: "Extracted" }).expect(201)).body;
    expect(sub.documents[0].relPath).toBe("Extracted/x.pdf");
    expect(fs.existsSync(path.join(root, "Extracted", "x.pdf"))).toBe(true);
    await out({ folder: root, newFolder: ".." }).expect(400);
    await request(app).post("/api/pdf-tools/create").send({ folder, outputs: [{ name: "x", segments: [{ documentId: doc.id, pages: [11] }] }] }).expect(400);
    // A failed request leaves no files behind.
    const failed = await request(app)
      .post("/api/pdf-tools/create")
      .send({ folder, outputs: [{ name: "ok", segments: [{ documentId: doc.id, pages: [1] }] }, { name: "bad", segments: [{ documentId: doc.id, pages: [99] }] }] });
    expect(failed.status).toBe(400);
    expect(fs.existsSync(path.join(folder, "ok.pdf"))).toBe(false);

    const folders = (await request(app).get("/api/library/folders").expect(200)).body;
    expect(folders.map((f: { label: string }) => f.label)).toEqual(expect.arrayContaining([expect.stringMatching(/Course$/), expect.stringMatching(/Extracted$/)]));
  });

  it("splits one PDF into several and merges several into one", async () => {
    const { app, doc, slides, folder } = await setup();
    const split = (
      await request(app)
        .post("/api/pdf-tools/create")
        .send({
          folder,
          outputs: [
            { name: "Part 1", segments: [{ documentId: doc.id, pages: [1, 2, 3, 4] }] },
            { name: "Part 2", segments: [{ documentId: doc.id, pages: [5, 6, 7, 8, 9, 10] }] },
          ],
        })
        .expect(201)
    ).body.documents;
    expect(await widths(split[0].path)).toEqual([1, 2, 3, 4]);
    expect(await widths(split[1].path)).toEqual([5, 6, 7, 8, 9, 10]);

    await request(app).post(`/api/documents/${slides.id}/bookmarks/import`).send({ entries: [{ title: "Intro slide", page: 2 }] });
    const merged = (
      await request(app)
        .post("/api/pdf-tools/create")
        .send({
          folder,
          bookmarkPerSource: true,
          outputs: [{ name: "Merged", segments: [{ documentId: doc.id, pages: [9, 10] }, { documentId: slides.id, title: "Lecture slides" } /* no pages: all of them */] }],
        })
        .expect(201)
    ).body.documents[0];
    expect(await widths(merged.path)).toEqual([9, 10, 101, 102, 103, 104]);
    expect(await outline(merged.path)).toEqual([["Book", 1], ["Lecture slides", 3, [["Intro slide", 4]]]]);
  });
});

describe("rotating and moving pages", () => {
  it("turns pages and their highlights, and undo turns them back", async () => {
    const { app, doc, file } = await setup();
    const original = fs.readFileSync(file);
    const a = (await request(app).post(`/api/documents/${doc.id}/annotations`).send({ page: 2, kind: "highlight", color: "#ffee00", rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }] })).body;
    const res = await request(app).post(`/api/documents/${doc.id}/pages/rotate`).send({ pages: [2, 3], angle: 90 }).expect(200);
    const pdf = await PDFDocument.load(fs.readFileSync(file));
    expect(pdf.getPages().map((p) => p.getRotation().angle)).toEqual([0, 90, 90, 0, 0, 0, 0, 0, 0, 0]);
    const turned = (await request(app).get(`/api/documents/${doc.id}/annotations`)).body[0];
    expect(turned.rects[0].x).toBeCloseTo(0.7);
    expect(turned.rects[0].y).toBeCloseTo(0.1);
    // Drawn after the turn: turned back by undo too.
    const later = (await request(app).post(`/api/documents/${doc.id}/annotations`).send({ page: 3, kind: "highlight", color: "#ffee00", rects: [{ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }] })).body;
    await request(app).post(`/api/documents/${doc.id}/history/${res.body.editId}/undo`).expect(200);
    expect(fs.readFileSync(file).equals(original)).toBe(true);
    const anns = (await request(app).get(`/api/documents/${doc.id}/annotations`)).body;
    expect(anns.find((x: { id: string }) => x.id === a.id).rects[0]).toEqual({ x: 0.1, y: 0.2, w: 0.3, h: 0.1 });
    const back = anns.find((x: { id: string }) => x.id === later.id).rects[0];
    expect(back.x).toBeCloseTo(0.5);
    expect(back.y).toBeCloseTo(0.4);
    await request(app).post(`/api/documents/${doc.id}/pages/rotate`).send({ pages: [2], angle: 45 }).expect(400);
  });

  it("moves pages with their notes, highlights and bookmarks, and undo moves them back", async () => {
    const { app, doc, file } = await setup();
    const id = doc.id;
    await request(app).post(`/api/documents/${id}/resources`).send({ type: "note", scope: "page", pageStart: 8, title: "on 8" }).expect(201);
    await request(app).post(`/api/documents/${id}/resources`).send({ type: "note", scope: "page", pageStart: 3, title: "on 3" }).expect(201);
    await request(app).post(`/api/documents/${id}/annotations`).send({ page: 9, kind: "highlight", color: "#ffee00", rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 }] });
    await request(app).post(`/api/documents/${id}/bookmarks/import`).send({ entries: [{ title: "eight", page: 8 }] });

    const res = await request(app).post(`/api/documents/${id}/pages/move`).send({ pages: [8, 9], after: 2 }).expect(200);
    expect(await widths(file)).toEqual([1, 2, 8, 9, 3, 4, 5, 6, 7, 10]);
    const pages = async () => ({
      notes: Object.fromEntries((await request(app).get(`/api/documents/${id}/resources`)).body.map((r: { title: string; pageStart: number }) => [r.title, r.pageStart])),
      ann: (await request(app).get(`/api/documents/${id}/annotations`)).body.map((a: { page: number }) => a.page),
      bm: (await request(app).get(`/api/documents/${id}/bookmarks`)).body.bookmarks.map((b: { page: number }) => b.page),
    });
    expect(await pages()).toEqual({ notes: { "on 8": 3, "on 3": 5 }, ann: [4], bm: [3] });

    await request(app).post(`/api/documents/${id}/history/${res.body.editId}/undo`).expect(200);
    expect(await widths(file)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(await pages()).toEqual({ notes: { "on 8": 8, "on 3": 3 }, ann: [9], bm: [8] });

    await request(app).post(`/api/documents/${id}/pages/move`).send({ pages: [3], after: 3 }).expect(400);
    await request(app).post(`/api/documents/${id}/pages/move`).send({ pages: [3], after: 2 }).expect(400); // already there
  });
});
