import { Router, type IRouter, type Request, type Response } from "express";
import { desc, eq, and } from "drizzle-orm";
import { db, gpsMatchReportsTable, gpsCoachEmailsTable } from "@workspace/db";
import { CreateGpsMatchReportBody, UpdateGpsMatchReportBody, SaveGpsCoachEmailsBody } from "@workspace/api-zod";
import { mayTouchLeagueRow, getSessionUser, effectiveRole } from "../middlewares/entryAuth";

const router: IRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type Row = typeof gpsMatchReportsTable.$inferSelect;

function reportJson(r: Row) {
  return {
    id: r.id,
    leagueId: r.leagueId,
    title: r.title,
    round: r.round,
    opponent: r.opponent,
    matchDate: r.matchDate,
    data: r.data ?? {},
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// League-private: reports belong to ONE league; the list requires a leagueId
// (the central middleware verifies the caller's access to it).
router.get("/gps-match-reports", async (req, res) => {
  const leagueId = Number(req.query.leagueId);
  if (!Number.isInteger(leagueId) || leagueId <= 0)
    return res.status(400).json({ error: "leagueId is required" });
  const rows = await db
    .select()
    .from(gpsMatchReportsTable)
    .where(eq(gpsMatchReportsTable.leagueId, leagueId))
    .orderBy(desc(gpsMatchReportsTable.updatedAt), desc(gpsMatchReportsTable.id));
  return res.json(rows.map(reportJson));
});

router.post("/gps-match-reports", async (req, res) => {
  const parsed = CreateGpsMatchReportBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { leagueId, title, round, opponent, matchDate, data } = parsed.data;
  if (!(await mayTouchLeagueRow(req, leagueId, "gps")))
    return res.status(403).json({ error: "No access to this league's GPS reports" });
  const [row] = await db
    .insert(gpsMatchReportsTable)
    .values({ leagueId, title, round: round ?? null, opponent: opponent ?? null, matchDate: matchDate ?? null, data })
    .returning();
  return res.json(reportJson(row));
});

/** Loads a report and checks the caller may touch its league; null → response already sent. */
async function loadGuarded(req: Request, res: Response, id: number): Promise<Row | null> {
  const [row] = await db.select().from(gpsMatchReportsTable).where(eq(gpsMatchReportsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Report not found" });
    return null;
  }
  if (!(await mayTouchLeagueRow(req, row.leagueId, "gps"))) {
    res.status(403).json({ error: "No access to this league's GPS reports" });
    return null;
  }
  return row;
}

router.patch("/gps-match-reports/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
  if (!(await loadGuarded(req, res, id))) return;
  const parsed = UpdateGpsMatchReportBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const d = parsed.data;
  const patch: Partial<typeof gpsMatchReportsTable.$inferInsert> = { updatedAt: new Date() };
  if (d.title !== undefined) patch.title = d.title;
  if (d.opponent !== undefined) patch.opponent = d.opponent;
  if (d.matchDate !== undefined) patch.matchDate = d.matchDate;
  if (d.data !== undefined) patch.data = d.data;
  const [row] = await db
    .update(gpsMatchReportsTable)
    .set(patch)
    .where(eq(gpsMatchReportsTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Report not found" });
  return res.json(reportJson(row));
});

router.delete("/gps-match-reports/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
  if (!(await loadGuarded(req, res, id))) return;
  const deleted = await db
    .delete(gpsMatchReportsTable)
    .where(eq(gpsMatchReportsTable.id, id))
    .returning({ id: gpsMatchReportsTable.id });
  return res.json({ deleted: deleted.length > 0 });
});

// ── Coach email list (per league + squad) ────────────────────────────────────

router.get("/gps-coach-emails", async (req, res) => {
  const leagueId = Number(req.query.leagueId);
  if (!Number.isInteger(leagueId) || leagueId <= 0)
    return res.status(400).json({ error: "leagueId is required" });
  const rows = await db
    .select()
    .from(gpsCoachEmailsTable)
    .where(eq(gpsCoachEmailsTable.leagueId, leagueId))
    .orderBy(gpsCoachEmailsTable.squad, gpsCoachEmailsTable.id);
  return res.json(rows);
});

/** Replace the coach list for one league + squad (simple, small lists).
 * Admin-only: this list decides who receives future report emails, and the
 * send endpoint itself is admin-gated — the two must match. */
router.put("/gps-coach-emails", async (req, res) => {
  const user = await getSessionUser(req);
  if (!user || effectiveRole(user) !== "admin")
    return res.status(403).json({ error: "Admins only" });
  const parsed = SaveGpsCoachEmailsBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { leagueId, squad, coaches } = parsed.data;
  if (!(await mayTouchLeagueRow(req, leagueId, "gps")))
    return res.status(403).json({ error: "No access to this league's coach list" });
  const cleaned = coaches
    .map(c => ({ name: c.name?.trim() || null, email: c.email.trim() }))
    .filter(c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email));
  await db.transaction(async tx => {
    await tx
      .delete(gpsCoachEmailsTable)
      .where(and(eq(gpsCoachEmailsTable.leagueId, leagueId), eq(gpsCoachEmailsTable.squad, squad)));
    if (cleaned.length) {
      await tx.insert(gpsCoachEmailsTable).values(cleaned.map(c => ({ leagueId, squad, name: c.name, email: c.email })));
    }
  });
  return res.json({ saved: cleaned.length });
});

export default router;
