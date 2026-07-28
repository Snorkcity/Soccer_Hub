import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { db, usersTable, userLeagueAccessTable, seasonsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── App auth ──────────────────────────────────────────────────────────────────
// Stateless signed-cookie session: token = "<expiryMs>.<userId>.<hmac>", signed
// with SESSION_SECRET so it works identically on Replit dev and Railway (no
// session store needed). The user's role/access is looked up in the DB on each
// request, so revoking access or deleting a user takes effect immediately.
//
// Access model:
//   superadmin — sees and can write everything, manages users ("god access")
//   per-league — user_league_access rows: role "admin" (write) or "viewer"
// League scoping is enforced centrally here: requests carrying a seasonId or
// leagueId param are rejected when the user has no access to that league.

const COOKIE_NAME = "bufc_session";
const SESSION_DAYS = 30;

export type SessionRole = "admin" | "viewer";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  isSuperadmin: boolean;
  /** leagueId → role */
  leagues: Map<number, SessionRole>;
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function makeSessionToken(userId: number): string {
  const exp = String(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const payload = `${exp}.${userId}`;
  return `${payload}.${sign(payload)}`;
}

/** Returns the session's userId, or null when the token is missing/invalid/expired. */
export function verifySessionToken(token: string | undefined): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [exp, userId, sig] = parts;
  if (!/^\d+$/.test(userId)) return null; // old role-based tokens fail here → re-login
  const expected = sign(`${exp}.${userId}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) <= Date.now()) return null;
  return Number(userId);
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

export function setSessionCookie(res: Response, userId: number): void {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(makeSessionToken(userId))}`,
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

/** Loads the session's user (with league access) from the DB, or null. */
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const cached = (req as { _sessionUser?: SessionUser | null })._sessionUser;
  if (cached !== undefined) return cached;
  const userId = verifySessionToken(readSessionCookie(req));
  let user: SessionUser | null = null;
  if (userId !== null) {
    const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (rows.length > 0) {
      const access = await db.select().from(userLeagueAccessTable).where(eq(userLeagueAccessTable.userId, userId));
      user = {
        id: rows[0].id,
        email: rows[0].email,
        name: rows[0].name,
        isSuperadmin: rows[0].isSuperadmin,
        leagues: new Map(access.map((a) => [a.leagueId, a.role as SessionRole])),
      };
    }
  }
  (req as { _sessionUser?: SessionUser | null })._sessionUser = user;
  return user;
}

/** Effective app-wide role for back-compat UI checks: admin if the user can write anywhere. */
export function effectiveRole(user: SessionUser): SessionRole {
  if (user.isSuperadmin) return "admin";
  for (const role of user.leagues.values()) if (role === "admin") return "admin";
  return "viewer";
}

export function canSeeLeague(user: SessionUser, leagueId: number): boolean {
  return user.isSuperadmin || user.leagues.has(leagueId);
}

export function canWriteLeague(user: SessionUser, leagueId: number): boolean {
  return user.isSuperadmin || user.leagues.get(leagueId) === "admin";
}

// seasonId → leagueId cache (seasons never change league; tiny table)
const seasonLeague = new Map<number, number>();
export async function leagueIdForSeason(seasonId: number): Promise<number | null> {
  const hit = seasonLeague.get(seasonId);
  if (hit !== undefined) return hit;
  const rows = await db.select({ leagueId: seasonsTable.leagueId }).from(seasonsTable).where(eq(seasonsTable.id, seasonId)).limit(1);
  if (rows.length === 0) return null;
  seasonLeague.set(seasonId, rows[0].leagueId);
  return rows[0].leagueId;
}

/**
 * Gate the whole /api surface behind a session:
 * - /auth/login|logout|me stay open (must be reachable to bootstrap)
 * - any signed-in user may read, but requests scoped by seasonId/leagueId are
 *   checked against the user's league access (superadmins see everything)
 * - writes require write access: superadmin, or league admin when the request
 *   is league-scoped (unscoped writes require admin somewhere)
 */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  void (async () => {
    if (req.method === "OPTIONS") return next();
    if (req.path === "/auth/login" || req.path === "/auth/logout" || req.path === "/auth/me") return next();
    if (req.path === "/healthz") return next(); // deploy health check must stay open

    const user = await getSessionUser(req);
    if (!user) {
      res.status(401).json({ error: "Not authenticated — log in first" });
      return;
    }

    // Central league scoping: any request that names a season or league — in
    // the query string OR the (already-parsed) JSON body — is checked against
    // the user's access. Superadmins skip the check.
    if (!user.isSuperadmin) {
      const leagueIds = new Set<number>();
      const asId = (v: unknown): number | null => {
        if (typeof v === "number" && Number.isInteger(v)) return v;
        if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
        return null;
      };
      const body = (req.body ?? {}) as Record<string, unknown>;
      for (const source of [req.query as Record<string, unknown>, body]) {
        const l = asId(source.leagueId);
        if (l !== null) leagueIds.add(l);
        const s = asId(source.seasonId);
        if (s !== null) {
          const fromSeason = await leagueIdForSeason(s);
          if (fromSeason !== null) leagueIds.add(fromSeason);
        }
      }
      const isWrite = req.method !== "GET" && req.method !== "HEAD";
      for (const leagueId of leagueIds) {
        if (!canSeeLeague(user, leagueId)) {
          res.status(403).json({ error: "No access to this league" });
          return;
        }
        if (isWrite && !canWriteLeague(user, leagueId)) {
          res.status(403).json({ error: "Admin access to this league is required to change data" });
          return;
        }
      }
      // Creating a league itself names no existing league — superadmin only.
      if (isWrite && req.path === "/leagues") {
        res.status(403).json({ error: "Only a superadmin can create leagues" });
        return;
      }
    }

    if (req.method === "GET" || req.method === "HEAD") return next();
    // The Coach Assistant is a read-style POST (chat) — open to any signed-in user.
    if (req.path === "/assistant/chat") return next();
    // Account self-service is handled (and further checked) in the auth routes.
    if (req.path.startsWith("/auth/")) return next();
    if (effectiveRole(user) !== "admin") {
      res.status(403).json({ error: "Admin access required to change data" });
      return;
    }
    next();
  })().catch(next);
}
