import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

// ── App auth ──────────────────────────────────────────────────────────────────
// Stateless signed-cookie session: token = "<expiryMs>.<role>.<hmac>". Signed
// with SESSION_SECRET so it works identically on Replit dev and Railway (no
// session store needed).
//
// Roles (designed for future growth — club logins, extra admins):
//   "admin"  — can view everything AND write data (today: the ADMIN_PASSWORD)
//   "viewer" — can view everything, no writes (future: club coach/analyst logins)
//
// The whole API requires a session (any role); writes additionally require
// the admin role. Only /auth/* stays open so users can bootstrap a session.

const COOKIE_NAME = "bufc_session";
const SESSION_DAYS = 30;

export type SessionRole = "admin" | "viewer";
const ROLES: readonly SessionRole[] = ["admin", "viewer"];

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function makeSessionToken(role: SessionRole): string {
  const exp = String(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const payload = `${exp}.${role}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the session's role, or null when the token is missing/invalid/expired. */
export function verifySessionToken(token: string | undefined): SessionRole | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [exp, role, sig] = parts;
  if (!ROLES.includes(role as SessionRole)) return null;
  const expected = sign(`${exp}.${role}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) <= Date.now()) return null;
  return role as SessionRole;
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

export function setSessionCookie(res: Response, role: SessionRole): void {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(makeSessionToken(role))}`,
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

export function getSessionRole(req: Request): SessionRole | null {
  return verifySessionToken(readSessionCookie(req));
}

/**
 * Gate the whole /api surface behind a session:
 * - /auth/* stays open (login/logout/me must be reachable to bootstrap)
 * - any valid session (any role) may read
 * - only the admin role may write
 */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "OPTIONS") return next();
  if (req.path === "/auth/login" || req.path === "/auth/logout" || req.path === "/auth/me") return next();
  if (req.path === "/healthz") return next(); // deploy health check must stay open
  const role = getSessionRole(req);
  if (!role) {
    res.status(401).json({ error: "Not authenticated — log in first" });
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") return next();
  // The Coach Assistant is a read-style POST (chat) — open to any signed-in role.
  if (req.path === "/assistant/chat") return next();
  if (role !== "admin") {
    res.status(403).json({ error: "Admin access required to change data" });
    return;
  }
  next();
}
