import os from "node:os";
import { promisify } from "node:util";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import type { DB } from "./db/index.js";
import { SESSION_DAYS, createSession, deleteExpiredSessions, deleteSession, useSession } from "./db/sessions.js";
import { HttpError } from "./types.js";

/**
 * Who may use StudySpace. This computer itself always may, with no password. Other devices (a phone
 * over Wi-Fi, or through `tailscale serve`) need STUDYSPACE_PASSWORD and then keep a login cookie.
 * Writes must carry the X-StudySpace header, which other websites can't send, and requests must be
 * addressed to a name of this computer, which stops DNS-rebinding pages.
 */

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const NO_PASSWORD =
  "StudySpace only works on this computer until a password is set. Add STUDYSPACE_PASSWORD=… to .env and restart it.";

/** The name a request was sent to, without the port: "[::1]:4317" → "::1", "pc.ts.net:443" → "pc.ts.net". */
export function requestHost(req: Request): string {
  const raw = (req.headers.host ?? "").trim().toLowerCase();
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end > 0 ? raw.slice(1, end) : raw;
  }
  const colon = raw.indexOf(":");
  return colon >= 0 && raw.lastIndexOf(":") === colon ? raw.slice(0, colon) : raw;
}

const fromLoopback = (req: Request) => LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? "");

/**
 * This computer itself: sent from 127.0.0.1 to localhost (the Vite dev proxy does that too). A phone
 * through `tailscale serve` also arrives from 127.0.0.1, but addressed to the *.ts.net name.
 */
export function isLocalRequest(req: Request): boolean {
  return fromLoopback(req) && LOOPBACK_NAMES.has(requestHost(req)) && !req.headers["x-forwarded-for"];
}

let names: { at: number; set: Set<string> } | null = null;

/** localhost, this computer's name and every address it has now (Wi-Fi, Tailscale…). Re-read every 30 s. */
function machineNames(): Set<string> {
  if (names && Date.now() - names.at < 30_000) return names.set;
  const set = new Set(LOOPBACK_NAMES);
  const host = os.hostname().toLowerCase();
  set.add(host);
  set.add(`${host}.local`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) set.add(a.address.toLowerCase().replace(/%.*$/, ""));
  }
  names = { at: Date.now(), set };
  return set;
}

export function isAllowedHost(host: string, extra: string[]): boolean {
  return !!host && (machineNames().has(host) || host.endsWith(".ts.net") || extra.includes(host));
}

const WINDOW_MS = 60_000;
const MAX_TRIES = 5;

/** Wrong passwords per client: after 5 in a minute, logging in is refused until the minute is over. */
class LoginLimiter {
  private tries = new Map<string, { n: number; until: number }>();

  blocked(key: string): boolean {
    const t = this.tries.get(key);
    return !!t && t.until > Date.now() && t.n >= MAX_TRIES;
  }

  fail(key: string): void {
    const now = Date.now();
    const t = this.tries.get(key);
    if (!t || t.until <= now) this.tries.set(key, { n: 1, until: now + WINDOW_MS });
    else t.n++;
    if (this.tries.size > 1000) for (const [k, v] of this.tries) if (v.until <= now) this.tries.delete(k);
  }

  reset(key: string): void {
    this.tries.delete(key);
  }
}

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

export function createAuth(db: DB, config: AppConfig) {
  // The port is in the name so a second StudySpace on another port (e.g. a test copy) has its own login.
  const cookieName = `ss_session_${config.port}`;
  const salt = randomBytes(16);
  const expected = config.password ? scryptAsync(config.password, salt, 32) : null;
  const limiter = new LoginLimiter();
  deleteExpiredSessions(db);

  const loggedIn = (req: Request) => {
    const token = readCookie(req, cookieName);
    return !!token && useSession(db, token);
  };

  // Behind tailscale serve every request comes from 127.0.0.1, so the real client is in X-Forwarded-For.
  const clientKey = (req: Request) => {
    const fwd = req.headers["x-forwarded-for"];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
    return fromLoopback(req) && first ? first : (req.socket.remoteAddress ?? "?");
  };

  const cookie = (req: Request, value: string, maxAgeSeconds: number) => {
    const https = req.secure || (fromLoopback(req) && (req.headers["x-forwarded-proto"] === "https" || requestHost(req).endsWith(".ts.net")));
    return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${https ? "; Secure" : ""}`;
  };

  const status = (req: Request) => {
    const local = isLocalRequest(req);
    return { local, loggedIn: local || loggedIn(req), passwordSet: !!config.password };
  };

  /** Every request, pages included: only names of this computer. */
  const checkHost = (req: Request, _res: Response, next: NextFunction) => {
    if (!isAllowedHost(requestHost(req), config.allowedHosts)) {
      throw new HttpError(403, `Unknown address “${req.headers.host ?? ""}”. Add it to STUDYSPACE_ALLOWED_HOSTS to allow it.`);
    }
    next();
  };

  /** /api writes: only from StudySpace's own pages. */
  const checkCsrf = (req: Request, _res: Response, next: NextFunction) => {
    if (config.requireCsrfHeader && !SAFE_METHODS.has(req.method) && req.get("x-studyspace") !== "1") {
      throw new HttpError(403, "Request refused: it didn't come from StudySpace (missing X-StudySpace header).");
    }
    next();
  };

  /** /api, except /health and /auth: this computer, or a logged-in device. */
  const requireLogin = (req: Request, _res: Response, next: NextFunction) => {
    if (isLocalRequest(req)) return next();
    if (!config.password) throw new HttpError(403, NO_PASSWORD);
    if (!loggedIn(req)) throw new HttpError(401, "Log in first.");
    next();
  };

  /** Adding, changing or browsing folders: only on this computer, even when logged in. */
  const localOnly = (req: Request, _res: Response, next: NextFunction) => {
    if (!isLocalRequest(req)) throw new HttpError(403, "Study folders can only be changed on the computer itself.");
    next();
  };

  const router = express.Router();

  router.get("/auth/status", (req, res) => {
    res.json(status(req));
  });

  router.post("/auth/login", async (req, res) => {
    const { password } = z.object({ password: z.string().max(1000) }).parse(req.body);
    if (isLocalRequest(req)) {
      res.json(status(req));
      return;
    }
    if (!expected) throw new HttpError(403, NO_PASSWORD);
    const key = clientKey(req);
    if (limiter.blocked(key)) throw new HttpError(429, "Too many wrong passwords. Wait a minute, then try again.");
    const got = await scryptAsync(password, salt, 32);
    if (!timingSafeEqual(got, await expected)) {
      limiter.fail(key);
      throw new HttpError(401, "Wrong password.");
    }
    limiter.reset(key);
    const token = createSession(db, req.get("user-agent") ?? "");
    res.setHeader("Set-Cookie", cookie(req, token, SESSION_DAYS * 24 * 60 * 60));
    res.json({ local: false, loggedIn: true, passwordSet: true });
  });

  router.post("/auth/logout", (req, res) => {
    const token = readCookie(req, cookieName);
    if (token) deleteSession(db, token);
    res.setHeader("Set-Cookie", cookie(req, "", 0));
    res.status(204).end();
  });

  return { checkHost, checkCsrf, requireLogin, localOnly, router, isLocal: isLocalRequest };
}
