import { createHash, randomBytes } from "node:crypto";
import type { DB } from "./index.js";

/** How long a phone stays logged in without being used. Each use moves the end forward. */
export const SESSION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Makes a new login and returns its token (for the cookie). Only the token's hash is stored. */
export function createSession(db: DB, userAgent: string): string {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * DAY_MS).toISOString();
  db.prepare("INSERT INTO sessions (token_hash, user_agent, expires_at) VALUES (?, ?, ?)").run(hash(token), userAgent.slice(0, 300), expires);
  return token;
}

/** True when the token belongs to a login that hasn't run out. Keeps it alive for another SESSION_DAYS. */
export function useSession(db: DB, token: string): boolean {
  const h = hash(token);
  const row = db.prepare("SELECT expires_at, last_seen_at FROM sessions WHERE token_hash = ?").get(h) as
    | { expires_at: string; last_seen_at: string }
    | undefined;
  if (!row) return false;
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(h);
    return false;
  }
  // At most one write an hour, not one per request.
  if (now - Date.parse(row.last_seen_at) > 60 * 60 * 1000) {
    db.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?").run(
      new Date(now).toISOString(),
      new Date(now + SESSION_DAYS * DAY_MS).toISOString(),
      h,
    );
  }
  return true;
}

export function deleteSession(db: DB, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(token));
}

export function deleteExpiredSessions(db: DB): void {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}
