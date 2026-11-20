import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { join } from "node:path";
import { dataDir, ensureDataDir } from "./paths.js";

/**
 * The API's login: a secret token, the way Jupyter does it.
 *
 * The Origin and Host checks stop other *web pages*; they do nothing about
 * another program on the machine, which sends no Origin at all. Without this,
 * any local process could `PATCH` a provider's command and then `POST` its
 * check to run that command as the user. The token lives in the data folder
 * (0600), so it survives a restart and a bookmarked login link keeps working;
 * deleting the file makes a new one.
 */
export const tokenPath = () => join(dataDir(), "token");

export function loadToken(): string {
  const path = tokenPath();
  if (existsSync(path)) {
    const saved = readFileSync(path, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(saved)) return saved;
  }
  ensureDataDir();
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, `${token}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best effort; Windows and some filesystems have no equivalent.
  }
  return token;
}

/**
 * Per port, because cookies ignore the port: two servers on one machine
 * would otherwise overwrite each other's login.
 */
export const cookieName = (port: number) => `corella_token_${port}`;

/** The login cookie; long-lived, because the token itself is. */
export function loginCookie(token: string, port: number): string {
  return `${cookieName(port)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000`;
}

/** The cookie from the browser, or `Authorization: Bearer` from a script. */
export function authorized(req: IncomingMessage, token: string, port: number): boolean {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ") && sameToken(header.slice(7).trim(), token)) return true;
  return sameToken(readCookie(req.headers.cookie, cookieName(port)), token);
}

/** Constant-time, so the comparison does not leak how much of a guess was right. */
export function sameToken(given: string | null | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}
