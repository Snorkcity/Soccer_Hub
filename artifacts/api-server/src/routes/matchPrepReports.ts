import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, matchPrepReportsTable, MATCH_PREP_REPORT_KINDS } from "@workspace/db";
import { CreateMatchPrepReportBody, UpdateMatchPrepReportBody } from "@workspace/api-zod";

const router: IRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type Row = typeof matchPrepReportsTable.$inferSelect;

function reportJson(r: Row) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    opponent: r.opponent,
    matchDate: r.matchDate,
    data: r.data ?? {},
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

router.get("/match-prep/reports", async (_req, res) => {
  const rows = await db
    .select()
    .from(matchPrepReportsTable)
    .orderBy(desc(matchPrepReportsTable.updatedAt), desc(matchPrepReportsTable.id));
  return res.json(rows.map(reportJson));
});

router.post("/match-prep/reports", async (req, res) => {
  const parsed = CreateMatchPrepReportBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { kind, title, opponent, matchDate, data } = parsed.data;
  if (!(MATCH_PREP_REPORT_KINDS as readonly string[]).includes(kind))
    return res.status(400).json({ error: "Invalid kind" });
  const [row] = await db
    .insert(matchPrepReportsTable)
    .values({ kind, title, opponent: opponent ?? null, matchDate: matchDate ?? null, data })
    .returning();
  return res.json(reportJson(row));
});

router.patch("/match-prep/reports/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
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
  const deleted = await db
    .delete(matchPrepReportsTable)
    .where(eq(matchPrepReportsTable.id, id))
    .returning({ id: matchPrepReportsTable.id });
  return res.json({ deleted: deleted.length > 0 });
});

export default router;
