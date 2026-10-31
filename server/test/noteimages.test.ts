import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, createTestContext } from "./helpers.js";

afterAll(cleanupTempDirs);

let ctx: ReturnType<typeof createTestContext>;
beforeAll(() => {
  ctx = createTestContext();
});

// 1×1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const upload = (body: Buffer | string, type = "image/png") =>
  request(ctx.app).post("/api/images").set("Content-Type", type).set("X-StudySpace", "1").send(body);

describe("pictures as notes", () => {
  it("stores a picture by its hash and serves it back", async () => {
    const up = await upload(PNG);
    expect(up.status).toBe(201);
    expect(up.body.name).toMatch(/^[0-9a-f]{64}\.png$/);
    expect(up.body.src).toBe(`/api/images/${up.body.name}`);
    expect(fs.existsSync(path.join(ctx.dataDir, "images", up.body.name))).toBe(true);

    const got = await request(ctx.app).get(up.body.src).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(got.body, PNG)).toBe(0);
  });

  it("keeps one file for the same picture", async () => {
    const a = await upload(PNG);
    const b = await upload(PNG);
    expect(a.body.name).toBe(b.body.name);
    expect(fs.readdirSync(path.join(ctx.dataDir, "images")).filter((f) => !f.startsWith("."))).toHaveLength(1);
  });

  it("refuses what is not a picture, even when it says it is", async () => {
    expect((await upload("<svg onload=alert(1)/>", "image/png")).status).toBe(400);
    expect((await upload(PNG, "text/html")).status).toBe(400);
    expect((await upload(Buffer.alloc(0))).status).toBe(400);
  });

  it("only serves names it made", async () => {
    await request(ctx.app).get("/api/images/..%2Fstudyspace.db").expect(404);
    await request(ctx.app).get("/api/images/x.png").expect(404);
    await request(ctx.app).get(`/api/images/${"0".repeat(64)}.png`).expect(404);
    await request(ctx.app).get(`/api/images/${"0".repeat(64)}.svg`).expect(404);
  });
});
