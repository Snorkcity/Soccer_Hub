import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, matchPrepReportsTable, MATCH_PREP_REPORT_KINDS } from "@workspace/db";
import { CreateMatchPrepReportBody, UpdateMatchPrepReportBody } from "@workspace/api-zod";
import { mayTouchLeagueRow } from "../middlewares/entryAuth";
import { focusClubForLeagueRequest } from "../lib/focusClub";

const router: IRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type Row = typeof matchPrepReportsTable.$inferSelect;

function reportJson(r: Row) {
  return {
    id: r.id,
    leagueId: r.leagueId,
    kind: r.kind,
    title: r.title,
    opponent: r.opponent,
    matchDate: r.matchDate,
    data: r.data ?? {},
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// League-private: reports belong to ONE league; the list requires a leagueId
// (the central middleware verifies the caller's access to it).
router.get("/match-prep/reports", async (req, res) => {
  const leagueId = Number(req.query.leagueId);
  if (!Number.isInteger(leagueId) || leagueId <= 0)
    return res.status(400).json({ error: "leagueId is required" });
  const club = await focusClubForLeagueRequest(req, leagueId);
  const rows = await db
    .select()
    .from(matchPrepReportsTable)
    .where(and(
      eq(matchPrepReportsTable.leagueId, leagueId),
      eq(matchPrepReportsTable.club, club),
    ))
    .orderBy(desc(matchPrepReportsTable.updatedAt), desc(matchPrepReportsTable.id));
  return res.json(rows.map(reportJson));
});

router.post("/match-prep/reports", async (req, res) => {
  const parsed = CreateMatchPrepReportBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { leagueId, kind, title, opponent, matchDate, data } = parsed.data;
  if (!(MATCH_PREP_REPORT_KINDS as readonly string[]).includes(kind))
    return res.status(400).json({ error: "Invalid kind" });
  if (!(await mayTouchLeagueRow(req, leagueId, "match-prep")))
    return res.status(403).json({ error: "No access to this league's reports" });
  const club = await focusClubForLeagueRequest(req, leagueId);
  const [row] = await db
    .insert(matchPrepReportsTable)
    .values({ leagueId, club, kind, title, opponent: opponent ?? null, matchDate: matchDate ?? null, data })
    .returning();
  return res.json(reportJson(row));
});

/** Loads a report and checks the caller may touch its league; null → respond already sent. */
async function loadGuarded(req: Request, res: Response, id: number): Promise<Row | null> {
  const [row] = await db.select().from(matchPrepReportsTable).where(eq(matchPrepReportsTable.id, id)).limit(1);
  if (!row) {
    res.status(404).json({ error: "Report not found" });
    return null;
  }
  if (!(await mayTouchLeagueRow(req, row.leagueId, "match-prep"))) {
    res.status(403).json({ error: "No access to this league's reports" });
    return null;
  }
  const club = await focusClubForLeagueRequest(req, row.leagueId);
  if (row.club !== club) {
    res.status(404).json({ error: "Report not found" });
    return null;
  }
  return row;
}

router.patch("/match-prep/reports/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
  if (!(await loadGuarded(req, res, id))) return;
  const parsed = UpdateMatchPrepReportBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const d = parsed.data;
  const patch: Partial<typeof matchPrepReportsTable.$inferInsert> = { updatedAt: new Date() };
  if (d.title !== undefined) patch.title = d.title;
  if (d.opponent !== undefined) patch.opponent = d.opponent;
  if (d.matchDate !== undefined) patch.matchDate = d.matchDate;
  if (d.data !== undefined) patch.data = d.data;
  const [row] = await db
    .update(matchPrepReportsTable)
    .set(patch)
    .where(eq(matchPrepReportsTable.id, id))
    .returning();
  if (!row) return res.status(404).json({ error: "Report not found" });
  return res.json(reportJson(row));
});

router.delete("/match-prep/reports/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
  if (!(await loadGuarded(req, res, id))) return;
  const deleted = await db
    .delete(matchPrepReportsTable)
    .where(eq(matchPrepReportsTable.id, id))
    .returning({ id: matchPrepReportsTable.id });
  return res.json({ deleted: deleted.length > 0 });
});

export default router;
