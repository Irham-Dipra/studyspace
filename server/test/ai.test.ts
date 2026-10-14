import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createAIProvider, type AIProvider } from "../src/ai/index.js";
import { cleanupTempDirs, createTestContext, tempDir, writePdf } from "./helpers.js";

afterAll(cleanupTempDirs);

async function withDoc(ai?: AIProvider) {
  const ctx = createTestContext();
  const app = ai ? createApp({ db: ctx.db, config: ctx.config, ai }) : ctx.app;
  const root = tempDir();
  await writePdf(path.join(root, "Notes.pdf"), 3);
  await request(app).post("/api/directories").send({ path: root }).expect(201);
  const doc = (await request(app).get("/api/library")).body.documents[0];
  return { app, doc };
}

describe("AI integration point", () => {
  it("is disabled by default and the app still works offline", async () => {
    const { app, doc } = await withDoc();
    const status = await request(app).get("/api/ai/status");
    expect(status.body).toMatchObject({ provider: "none", enabled: false });
    const res = await request(app)
      .post("/api/ai/generate")
      .send({ documentId: doc.id, task: "explain", pageStart: 1, pageEnd: 1, text: "hello" });
    expect(res.status).toBe(503);
  });

  it("reports unknown providers instead of crashing", () => {
    const p = createAIProvider({ provider: "does-not-exist" });
    expect(p.enabled).toBe(false);
    expect(p.statusMessage).toMatch(/Unknown AI_PROVIDER/);
  });

  it("stores provider output as a page-scoped resource", async () => {
    const fake: AIProvider = {
      id: "fake",
      enabled: true,
      statusMessage: "ok",
      generate: async (input) => ({ title: `Explained p${input.pageStart}`, content: `About: ${input.text}` }),
    };
    const { app, doc } = await withDoc(fake);
    const res = await request(app)
      .post("/api/ai/generate")
      .send({ documentId: doc.id, task: "explain", pageStart: 2, pageEnd: 2, text: "deadlocks" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: "ai_explanation", scope: "page", pageStart: 2, title: "Explained p2", content: "About: deadlocks" });
    const onPage = (await request(app).get(`/api/documents/${doc.id}/resources?page=2`)).body;
    expect(onPage).toHaveLength(1);
  });
});
