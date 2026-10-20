import path from "node:path";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, createTestContext, tempDir, writePdf } from "./helpers.js";

afterAll(cleanupTempDirs);

// supertest connects from 127.0.0.1. A Host other than localhost makes a request count as another
// device, the way a phone behind `tailscale serve` arrives.
const PHONE = "my-pc.tail1234.ts.net";
const H = { "X-StudySpace": "1" };

async function setup(password = "secret") {
  const ctx = createTestContext({ password, requireCsrfHeader: true, allowedHosts: ["phone-test.lan"] });
  const root = tempDir("studyspace-lib-");
  await writePdf(path.join(root, "a.pdf"), 1);
  await request(ctx.app).post("/api/directories").set(H).send({ path: root }).expect(201);
  return ctx;
}

const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[])[0].split(";")[0];

describe("access from this computer", () => {
  it("needs no login", async () => {
    const { app } = await setup();
    await request(app).get("/api/library").expect(200);
    expect((await request(app).get("/api/auth/status")).body).toEqual({ local: true, loggedIn: true, passwordSet: true });
    expect((await request(app).get("/api/config")).body.dataDir).toBeTruthy();
  });

  it("refuses writes without the X-StudySpace header", async () => {
    const { app } = await setup();
    const r = await request(app).post("/api/library/scan").expect(403);
    expect(r.body.error).toMatch(/X-StudySpace/);
    await request(app).post("/api/library/scan").set(H).expect(200);
  });

  it("refuses addresses that aren't this computer (DNS rebinding)", async () => {
    const { app } = await setup();
    await request(app).get("/api/library").set("Host", "evil.example:4317").expect(403);
    await request(app).get("/").set("Host", "evil.example").expect(403);
  });
});

describe("access from another device", () => {
  it("asks for the password, then keeps the login", async () => {
    const { app } = await setup();
    await request(app).get("/api/library").set("Host", PHONE).expect(401);
    expect((await request(app).get("/api/auth/status").set("Host", PHONE)).body).toEqual({ local: false, loggedIn: false, passwordSet: true });

    const login = await request(app).post("/api/auth/login").set("Host", PHONE).set(H).send({ password: "secret" }).expect(200);
    const setCookie = (login.headers["set-cookie"] as unknown as string[])[0];
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Secure/); // a *.ts.net name is reached over https
    const c = cookieOf(login);

    await request(app).get("/api/library").set("Host", PHONE).set("Cookie", c).expect(200);
    expect((await request(app).get("/api/auth/status").set("Host", PHONE).set("Cookie", c)).body.loggedIn).toBe(true);
    // Paths on the computer stay private.
    const cfg = (await request(app).get("/api/config").set("Host", PHONE).set("Cookie", c)).body;
    expect(cfg.dataDir).toBeUndefined();
    expect(cfg.local).toBe(false);

    await request(app).post("/api/auth/logout").set("Host", PHONE).set(H).set("Cookie", c).expect(204);
    await request(app).get("/api/library").set("Host", PHONE).set("Cookie", c).expect(401);
  });

  it("doesn't set Secure over plain http (home Wi-Fi)", async () => {
    const { app } = await setup();
    const login = await request(app).post("/api/auth/login").set("Host", "phone-test.lan:4317").set(H).send({ password: "secret" }).expect(200);
    expect((login.headers["set-cookie"] as unknown as string[])[0]).not.toMatch(/Secure/);
  });

  it("refuses a made-up cookie", async () => {
    const { app, config } = await setup();
    await request(app).get("/api/library").set("Host", PHONE).set("Cookie", `ss_session_${config.port}=nope`).expect(401);
  });

  it("stops after 5 wrong passwords", async () => {
    const { app } = await setup();
    for (let i = 0; i < 5; i++) {
      await request(app).post("/api/auth/login").set("Host", PHONE).set(H).send({ password: "wrong" }).expect(401);
    }
    await request(app).post("/api/auth/login").set("Host", PHONE).set(H).send({ password: "secret" }).expect(429);
    // Another client (by X-Forwarded-For, as tailscale serve sends) isn't blocked.
    await request(app).post("/api/auth/login").set("Host", PHONE).set("X-Forwarded-For", "100.64.0.9").set(H).send({ password: "secret" }).expect(200);
  });

  it("can't manage folders, even when logged in", async () => {
    const { app } = await setup();
    const c = cookieOf(await request(app).post("/api/auth/login").set("Host", PHONE).set(H).send({ password: "secret" }));
    await request(app).get("/api/fs/browse").set("Host", PHONE).set("Cookie", c).expect(403);
    await request(app).post("/api/directories").set("Host", PHONE).set(H).set("Cookie", c).send({ path: "/" }).expect(403);
    await request(app).get("/api/directories").set("Host", PHONE).set("Cookie", c).expect(200);
  });

  it("is turned off when no password is set", async () => {
    const { app } = await setup("");
    const r = await request(app).get("/api/library").set("Host", PHONE).expect(403);
    expect(r.body.error).toMatch(/STUDYSPACE_PASSWORD/);
    await request(app).post("/api/auth/login").set("Host", PHONE).set(H).send({ password: "" }).expect(403);
    await request(app).get("/api/library").expect(200);
  });
});
