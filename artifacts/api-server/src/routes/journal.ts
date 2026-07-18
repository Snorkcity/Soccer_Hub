import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  journalCyclesTable,
  journalEntriesTable,
  JOURNAL_CYCLE_KINDS,
  JOURNAL_STANDALONE_KINDS,
} from "@workspace/db";
import {
  CreateJournalCycleBody,
  UpdateJournalCycleBody,
  UpsertJournalEntryBody,
  CreateJournalReflectionBody,
  UpdateJournalReflectionBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

type EntryRow = typeof journalEntriesTable.$inferSelect;

function entryJson(e: EntryRow) {
  return {
    id: e.id,
    cycleId: e.cycleId,
    weekNo: e.weekNo,
    kind: e.kind,
    title: e.title,
    entryDate: e.entryDate,
    source: e.source,
    content: e.content ?? {},
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

async function loadCycleDetail(id: number) {
  const [cycle] = await db.select().from(journalCyclesTable).where(eq(journalCyclesTable.id, id));
  if (!cycle) return null;
  const entries = await db
    .select()
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.cycleId, id));
  entries.sort((a, b) => (a.weekNo ?? 0) - (b.weekNo ?? 0) || a.kind.localeCompare(b.kind));
  return {
    id: cycle.id,
    title: cycle.title,
    weeksCount: cycle.weeksCount,
    startDate: cycle.startDate,
    notes: cycle.notes,
    updatedAt: cycle.updatedAt.toISOString(),
    entries: entries.map(entryJson),
  };
}

// ── Cycles ────────────────────────────────────────────────────────────────────

router.get("/journal/cycles", async (_req, res) => {
  const rows = await db
    .select({
      id: journalCyclesTable.id,
      title: journalCyclesTable.title,
      weeksCount: journalCyclesTable.weeksCount,
      startDate: journalCyclesTable.startDate,
      notes: journalCyclesTable.notes,
      updatedAt: journalCyclesTable.updatedAt,
      entryCount: sql<number>`(SELECT count(*)::int FROM journal_entries e WHERE e.cycle_id = ${journalCyclesTable.id})`,
    })
    .from(journalCyclesTable)
    .orderBy(desc(journalCyclesTable.id));
  return res.json(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      weeksCount: r.weeksCount,
      startDate: r.startDate,
      notes: r.notes,
      entryCount: r.entryCount,
      updatedAt: r.updatedAt.toISOString(),
    })),
  );
});

router.post("/journal/cycles", async (req, res) => {
  const parsed = CreateJournalCycleBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { title, weeksCount, startDate, notes } = parsed.data;
  const [created] = await db
    .insert(journalCyclesTable)
    .values({ title, weeksCount, startDate: startDate ?? null, notes: notes ?? null })
    .returning({ id: journalCyclesTable.id });
  return res.json(await loadCycleDetail(created.id));
});

router.get("/journal/cycles/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
  const detail = await loadCycleDetail(id);
  if (!detail) return res.status(404).json({ error: "Cycle not found" });
  return res.json(detail);
});

router.patch("/journal/cycles/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
  const parsed = UpdateJournalCycleBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const patch: Partial<typeof journalCyclesTable.$inferInsert> = {};
  const d = parsed.data;
  if (d.title !== undefined) patch.title = d.title;
  if (d.weeksCount !== undefined) patch.weeksCount = d.weeksCount;
  if (d.startDate !== undefined) patch.startDate = d.startDate;
  if (d.notes !== undefined) patch.notes = d.notes;
  patch.updatedAt = new Date();
  const [updated] = await db
    .update(journalCyclesTable)
    .set(patch)
    .where(eq(journalCyclesTable.id, id))
    .returning({ id: journalCyclesTable.id });
  if (!updated) return res.status(404).json({ error: "Cycle not found" });
  return res.json(await loadCycleDetail(id));
});

router.delete("/journal/cycles/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
  const deleted = await db
    .delete(journalCyclesTable)
    .where(eq(journalCyclesTable.id, id))
    .returning({ id: journalCyclesTable.id });
  return res.json({ deleted: deleted.length > 0 });
});

// ── Cycle entries (upsert by week+kind) ───────────────────────────────────────

router.put("/journal/cycles/:id/entries/:week/:kind", async (req, res) => {
  const id = parseId(req.params.id);
  const week = parseId(req.params.week);
  const kind = req.params.kind;
  if (id == null || week == null) return res.status(400).json({ error: "Invalid id or week" });
  if (!(JOURNAL_CYCLE_KINDS as readonly string[]).includes(kind))
    return res.status(400).json({ error: "Invalid kind" });
  const parsed = UpsertJournalEntryBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const [cycle] = await db
    .select({ id: journalCyclesTable.id, weeksCount: journalCyclesTable.weeksCount })
    .from(journalCyclesTable)
    .where(eq(journalCyclesTable.id, id));
  if (!cycle) return res.status(404).json({ error: "Cycle not found" });
  if (week > cycle.weeksCount) return res.status(400).json({ error: "Week beyond cycle length" });

  const { content, entryDate, source } = parsed.data;
  // Atomic upsert against the partial unique index (cycle_id, week_no, kind)
  // WHERE cycle_id IS NOT NULL — avoids read-then-write races.
  const [row] = await db
    .insert(journalEntriesTable)
    .values({
      cycleId: id,
      weekNo: week,
      kind,
      content,
      entryDate: entryDate ?? null,
      source: source ?? "manual",
    })
    .onConflictDoUpdate({
      target: [journalEntriesTable.cycleId, journalEntriesTable.weekNo, journalEntriesTable.kind],
      targetWhere: sql`cycle_id IS NOT NULL`,
      set: {
        content,
        ...(entryDate !== undefined ? { entryDate } : {}),
        ...(source !== undefined ? { source } : {}),
        updatedAt: new Date(),
      },
    })
    .returning();
  return res.json(entryJson(row));
});

// ── Standalone reflections ────────────────────────────────────────────────────

router.get("/journal/reflections", async (_req, res) => {
  const rows = await db
    .select()
    .from(journalEntriesTable)
    .where(isNull(journalEntriesTable.cycleId))
    .orderBy(desc(journalEntriesTable.id));
  return res.json(rows.map(entryJson));
});

router.post("/journal/reflections", async (req, res) => {
  const parsed = CreateJournalReflectionBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const { kind, title, entryDate, source, content } = parsed.data;
  if (!(JOURNAL_STANDALONE_KINDS as readonly string[]).includes(kind))
    return res.status(400).json({ error: "Invalid kind" });
  const [row] = await db
    .insert(journalEntriesTable)
    .values({
      kind,
      title: title ?? null,
      entryDate: entryDate ?? null,
      source: source ?? "manual",
      content,
    })
    .returning();
  return res.json(entryJson(row));
});

router.patch("/journal/reflections/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
  const parsed = UpdateJournalReflectionBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const d = parsed.data;
  const patch: Partial<typeof journalEntriesTable.$inferInsert> = { updatedAt: new Date() };
  if (d.title !== undefined) patch.title = d.title;
  if (d.entryDate !== undefined) patch.entryDate = d.entryDate;
  if (d.content !== undefined) patch.content = d.content;
  const [row] = await db
    .update(journalEntriesTable)
    .set(patch)
    .where(and(eq(journalEntriesTable.id, id), isNull(journalEntriesTable.cycleId)))
    .returning();
  if (!row) return res.status(404).json({ error: "Reflection not found" });
  return res.json(entryJson(row));
});

router.delete("/journal/reflections/:id", async (req, res) => {
  const id = parseId(req.params.id);
  if (id == null) return res.status(400).json({ error: "Invalid id" });
  const deleted = await db
    .delete(journalEntriesTable)
    .where(and(eq(journalEntriesTable.id, id), isNull(journalEntriesTable.cycleId)))
    .returning({ id: journalEntriesTable.id });
  return res.json({ deleted: deleted.length > 0 });
});

export default router;
