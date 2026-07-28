import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, usersTable, userLeagueAccessTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { hashPassword, verifyPassword } from "../lib/passwords";
import {
  setSessionCookie,
  clearSessionCookie,
  getSessionUser,
  effectiveRole,
  type SessionUser,
} from "../middlewares/entryAuth";

const router: IRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const LEAGUE_ROLES = ["admin", "viewer"] as const;

const LoginBody = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

const LeagueAccessInput = z.object({
  leagueId: z.number().int(),
  role: z.enum(LEAGUE_ROLES),
});

const CreateUserBody = z.object({
  email: z.string().trim().toLowerCase().min(3),
  name: z.string().trim().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
  isSuperadmin: z.boolean().optional().default(false),
  leagues: z.array(LeagueAccessInput).optional().default([]),
});

const UpdateUserBody = z.object({
  email: z.string().trim().toLowerCase().min(3).optional(),
  name: z.string().trim().min(1).optional(),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  isSuperadmin: z.boolean().optional(),
  leagues: z.array(LeagueAccessInput).optional(),
});

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

async function authStatusPayload(user: SessionUser) {
  return {
    authenticated: true,
    role: effectiveRole(user),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isSuperadmin: user.isSuperadmin,
      leagues: [...user.leagues.entries()].map(([leagueId, role]) => ({ leagueId, role })),
    },
  };
}

async function userInfo(userId: number) {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!row) return null;
  const access = await db.select().from(userLeagueAccessTable).where(eq(userLeagueAccessTable.userId, userId));
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isSuperadmin: row.isSuperadmin,
    leagues: access.map((a) => ({ leagueId: a.leagueId, role: a.role })),
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireSuperadmin(req: Parameters<typeof getSessionUser>[0]): Promise<SessionUser | null> {
  const user = await getSessionUser(req);
  return user?.isSuperadmin ? user : null;
}

// ── Session endpoints ─────────────────────────────────────────────────────────

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your email and password" });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  const [row] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!row || !verifyPassword(parsed.data.password, row.passwordHash)) {
    res.status(401).json({ error: "Incorrect email or password" });
    return;
  }
  setSessionCookie(res, row.id);
  // Build the status from a fresh session-user shape
  const access = await db.select().from(userLeagueAccessTable).where(eq(userLeagueAccessTable.userId, row.id));
  const user: SessionUser = {
    id: row.id, email: row.email, name: row.name, isSuperadmin: row.isSuperadmin,
    leagues: new Map(access.map((a) => [a.leagueId, a.role as "admin" | "viewer"])),
  };
  logger.info({ userId: row.id, email }, "User logged in");
  res.json(await authStatusPayload(user));
});

router.post("/auth/logout", async (_req, res): Promise<void> => {
  clearSessionCookie(res);
  res.json({ authenticated: false });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  res.json(user ? await authStatusPayload(user) : { authenticated: false });
});

router.post("/auth/change-password", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
  if (!row || !verifyPassword(parsed.data.currentPassword, row.passwordHash)) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }
  await db.update(usersTable)
    .set({ passwordHash: hashPassword(parsed.data.newPassword), updatedAt: new Date() })
    .where(eq(usersTable.id, user.id));
  res.json({ ok: true });
});

// ── User management (superadmin only) ─────────────────────────────────────────

router.get("/auth/users", async (req, res): Promise<void> => {
  if (!(await requireSuperadmin(req))) {
    res.status(403).json({ error: "Superadmin access required" });
    return;
  }
  const rows = await db.select().from(usersTable).orderBy(asc(usersTable.id));
  const access = await db.select().from(userLeagueAccessTable);
  res.json(rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    isSuperadmin: row.isSuperadmin,
    leagues: access.filter((a) => a.userId === row.id).map((a) => ({ leagueId: a.leagueId, role: a.role })),
    createdAt: row.createdAt.toISOString(),
  })));
});

router.post("/auth/users", async (req, res): Promise<void> => {
  if (!(await requireSuperadmin(req))) {
    res.status(403).json({ error: "Superadmin access required" });
    return;
  }
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  const { email, name, password, isSuperadmin, leagues } = parsed.data;
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "A user with that email already exists" });
    return;
  }
  const [created] = await db.insert(usersTable)
    .values({ email, name, passwordHash: hashPassword(password), isSuperadmin })
    .returning({ id: usersTable.id });
  if (leagues.length > 0) {
    await db.insert(userLeagueAccessTable).values(leagues.map((l) => ({ userId: created.id, leagueId: l.leagueId, role: l.role })));
  }
  logger.info({ userId: created.id, email }, "User created");
  res.status(201).json(await userInfo(created.id));
});

router.patch("/auth/users/:id", async (req, res): Promise<void> => {
  const admin = await requireSuperadmin(req);
  if (!admin) {
    res.status(403).json({ error: "Superadmin access required" });
    return;
  }
  const id = Number(req.params.id);
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid user id" : parsed.error.issues[0]?.message ?? "Invalid request" });
    return;
  }
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (admin.id === id && parsed.data.isSuperadmin === false) {
    res.status(400).json({ error: "You can't remove your own superadmin access" });
    return;
  }
  const { email, name, password, isSuperadmin, leagues } = parsed.data;
  if (email && email !== row.email) {
    const clash = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (clash.length > 0 && clash[0].id !== id) {
      res.status(409).json({ error: "A user with that email already exists" });
      return;
    }
  }
  await db.update(usersTable).set({
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
    ...(password ? { passwordHash: hashPassword(password) } : {}),
    ...(isSuperadmin !== undefined ? { isSuperadmin } : {}),
    updatedAt: new Date(),
  }).where(eq(usersTable.id, id));
  if (leagues) {
    await db.delete(userLeagueAccessTable).where(eq(userLeagueAccessTable.userId, id));
    if (leagues.length > 0) {
      await db.insert(userLeagueAccessTable).values(leagues.map((l) => ({ userId: id, leagueId: l.leagueId, role: l.role })));
    }
  }
  res.json(await userInfo(id));
});

router.delete("/auth/users/:id", async (req, res): Promise<void> => {
  const admin = await requireSuperadmin(req);
  if (!admin) {
    res.status(403).json({ error: "Superadmin access required" });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  if (admin.id === id) {
    res.status(400).json({ error: "You can't delete your own account" });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.json({ ok: true });
});

export default router;
