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

export interface LeagueGrant {
  role: SessionRole; // legacy; kept for display/back-compat
  modules: Set<string>;
}

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  isSuperadmin: boolean;
  /** leagueId → grant */
  leagues: Map<number, LeagueGrant>;
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
        leagues: new Map(access.map((a) => [a.leagueId, {
          role: a.role as SessionRole,
          modules: new Set(Array.isArray(a.modules) ? a.modules : []),
        }])),
      };
    }
  }
  (req as { _sessionUser?: SessionUser | null })._sessionUser = user;
  return user;
}

/** Effective app-wide role for back-compat UI checks: admin if the user can enter data anywhere. */
export function effectiveRole(user: SessionUser): SessionRole {
  if (user.isSuperadmin) return "admin";
  for (const g of user.leagues.values()) if (g.modules.has("data-entry")) return "admin";
  return "viewer";
}

export function canSeeLeague(user: SessionUser, leagueId: number): boolean {
  if (user.isSuperadmin) return true;
  const g = user.leagues.get(leagueId);
  return !!g && g.modules.size > 0;
}

export function hasModule(user: SessionUser, leagueId: number, module: string): boolean {
  if (user.isSuperadmin) return true;
  return user.leagues.get(leagueId)?.modules.has(module) ?? false;
}

export function hasModuleAnywhere(user: SessionUser, module: string): boolean {
  if (user.isSuperadmin) return true;
  for (const g of user.leagues.values()) if (g.modules.has(module)) return true;
  return false;
}

export function canWriteLeague(user: SessionUser, leagueId: number): boolean {
  if (user.isSuperadmin) return true;
  const g = user.leagues.get(leagueId);
  return !!g && g.modules.size > 0; // per-module write checks happen in requireSession
}

// Route prefix → module that owns it. A request under one of these prefixes
// requires the module ticked for the scoped league (or in at least one league
// when the request carries no league/season scope). Prefixes not listed
// (analytics, teams, seasons, assistant, sessions, practices, …) stay open to
// any league member — Match Prep and the shared tools read from them.
const MODULE_ROUTES: Array<[prefix: string, module: string]> = [
  ["/entry/athletic-tests", "testing"], // trainer xlsx upload lives under /entry
  ["/entry/gps-sessions", "gps"],       // GPS import lives under /entry too
  ["/entry", "data-entry"],
  ["/journal/prematch-brief", "match-prep"],   // Match Prep report briefs live
  ["/journal/week-ahead-brief", "match-prep"], // under /journal, not /match-prep

  ["/gps-sessions", "gps"],
  ["/gps-player-positions", "gps"],
  ["/athletic-tests", "testing"],
  ["/match-prep", "match-prep"],
  ["/journal", "reflections"], // reflection journal routes
];

// Setup-style writes (creating seasons/teams/clubs) belong to Data Entry, but
// their GETs feed every page's dropdowns, so the module applies to writes only.
const WRITE_MODULE_ROUTES: Array<[prefix: string, module: string]> = [
  ["/seasons", "data-entry"],
  ["/teams", "data-entry"],
  ["/clubs", "data-entry"],
  ["/players", "data-entry"],
  ["/matches", "data-entry"],
  ["/goals", "data-entry"],
  ["/player-stats", "data-entry"],
];

// Shared tools: writes open to any signed-in user (per coach).
const SHARED_WRITE_PREFIXES = ["/sessions", "/library", "/assistant", "/auth"];

export function isSharedWritePath(path: string): boolean {
  return SHARED_WRITE_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

export function moduleForPath(path: string, isWrite: boolean): string | null {
  const routes = isWrite ? [...MODULE_ROUTES, ...WRITE_MODULE_ROUTES] : MODULE_ROUTES;
  for (const [prefix, module] of routes) {
    if (path === prefix || path.startsWith(prefix + "/") || path.startsWith(prefix + "?")) return module;
  }
  return null;
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
    const isWrite = req.method !== "GET" && req.method !== "HEAD";
    const module = moduleForPath(req.path, isWrite);
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
      for (const leagueId of leagueIds) {
        if (!canSeeLeague(user, leagueId)) {
          res.status(403).json({ error: "No access to this league" });
          return;
        }
        // Module-owned routes need that module ticked for the scoped league
        if (module && !hasModule(user, leagueId, module)) {
          res.status(403).json({ error: "You don't have access to this page for this league" });
          return;
        }
      }
      // Module-owned routes with no league scope: need the module somewhere
      if (module && leagueIds.size === 0 && !hasModuleAnywhere(user, module)) {
        res.status(403).json({ error: "You don't have access to this page" });
        return;
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
    // Module-owned writes were already checked above. Shared tools (session
    // planner, session library, assistant) are open to any signed-in user.
    // Anything else falls back to the legacy safety net: must be able to
    // enter data somewhere.
    if (!module && !isSharedWritePath(req.path) && effectiveRole(user) !== "admin") {
      res.status(403).json({ error: "You don't have access to change this data" });
      return;
    }
    next();
  })().catch(next);
}
