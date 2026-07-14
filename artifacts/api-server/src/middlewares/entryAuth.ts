import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

// ── Data-entry auth ───────────────────────────────────────────────────────────
// Stateless signed-cookie session: token = "<expiryMs>.<hmac>". Signed with
// SESSION_SECRET so it works identically on Replit dev and Railway (no session
// store needed). All mutating /api requests require it except login/logout.

const COOKIE_NAME = "bufc_entry";
const SESSION_DAYS = 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function makeSessionToken(): string {
  const exp = String(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  return `${exp}.${sign(exp)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(exp) > Date.now();
}

export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function setSessionCookie(res: Response): void {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(makeSessionToken())}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

export function isAuthenticated(req: Request): boolean {
  return verifySessionToken(readSessionCookie(req));
}

/**
 * Gate every mutating /api request behind the entry session. Reads stay public
 * (the dashboard is read-only); login/logout must stay reachable to bootstrap.
 */
export function requireEntrySession(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.path === "/auth/login" || req.path === "/auth/logout") return next();
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: "Not authenticated — log in on the Data Entry page first" });
}
