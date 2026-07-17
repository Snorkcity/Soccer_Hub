import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, sessionsTable, sessionPracticesTable, practicesTable, SESSION_PARTS } from "@workspace/db";
import {
  ListSessionsResponse,
  CreateSessionBody,
  GetSessionResponse,
  UpdateSessionBody,
  DeleteSessionResponse,
  UpsertSessionPartBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isPart(raw: string): raw is (typeof SESSION_PARTS)[number] {
  return (SESSION_PARTS as readonly string[]).includes(raw);
}

async function loadSessionDetail(id: number) {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!session) return null;
  const slots = await db
    .select({
      part: sessionPracticesTable.part,
      rules: sessionPracticesTable.rules,
      tasks: sessionPracticesTable.tasks,
      progressions: sessionPracticesTable.progressions,
      coachingPoints: sessionPracticesTable.coachingPoints,
      players: sessionPracticesTable.players,
      size: sessionPracticesTable.size,
      timing: sessionPracticesTable.timing,
      scoring: sessionPracticesTable.scoring,
      intensity: sessionPracticesTable.intensity,
      practiceId: practicesTable.id,
      practiceTitle: practicesTable.title,
      practiceDiagram: practicesTable.diagram,
    })
    .from(sessionPracticesTable)
    .leftJoin(practicesTable, eq(sessionPracticesTable.practiceId, practicesTable.id))
    .where(eq(sessionPracticesTable.sessionId, id));

  const order = new Map(SESSION_PARTS.map((p, i) => [p as string, i]));
  slots.sort((a, b) => (order.get(a.part) ?? 99) - (order.get(b.part) ?? 99));

  return {
    id: session.id,
    title: session.title,
    sessionDate: session.sessionDate,
    team: session.team,
    sessionNumber: session.sessionNumber,
    theme: session.theme,
    cycleCode: session.cycleCode,
    location: session.location,
    timeSlot: session.timeSlot,
    comments: session.comments,
    squadText: session.squadText,
    updatedAt: session.updatedAt.toISOString(),
    parts: slots.map((s) => ({
      part: s.part,
      practice:
        s.practiceId != null
          ? { id: s.practiceId, title: s.practiceTitle, diagram: s.practiceDiagram as Record<string, unknown> }
          : null,
      rules: s.rules,
      tasks: s.tasks,
      progressions: s.progressions,
      coachingPoints: s.coachingPoints,
      players: s.players,
      size: s.size,
      timing: s.timing,
      scoring: s.scoring,
      intensity: s.intensity,
    })),
  };
}

// ── Sessions (training-session builder) ──────────────────────────────────────
router.get("/sessions", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: sessionsTable.id,
      title: sessionsTable.title,
      sessionDate: sessionsTable.sessionDate,
      team: sessionsTable.team,
      sessionNumber: sessionsTable.sessionNumber,
      theme: sessionsTable.theme,
      updatedAt: sessionsTable.updatedAt,
      partCount: sql<number>`(SELECT count(*)::int FROM session_practices sp WHERE sp.session_id = ${sessionsTable.id})`,
    })
    .from(sessionsTable)
    .orderBy(desc(sessionsTable.updatedAt));
  res.json(
    ListSessionsResponse.parse(rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }))),
  );
});

router.post("/sessions", async (req, res): Promise<void> => {
  const body = CreateSessionBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  // Pre-fill the new session from the most recently created one so the coach
  // doesn't have to re-type team, location, time slot, squad list, etc.
  // (skips blank sessions that never had details filled in).
  const [last] = await db
    .select()
    .from(sessionsTable)
    .where(
      sql`coalesce(nullif(trim(${sessionsTable.team}), ''), nullif(trim(${sessionsTable.location}), ''), nullif(trim(${sessionsTable.timeSlot}), ''), nullif(trim(${sessionsTable.squadText}), ''), nullif(trim(${sessionsTable.cycleCode}), '')) is not null`,
    )
    .orderBy(desc(sessionsTable.createdAt), desc(sessionsTable.id))
    .limit(1);

  // Bump the session number if the last one looks like "S30" → "S31".
  let nextNumber: string | null = last?.sessionNumber ?? null;
  if (nextNumber) {
    const m = nextNumber.match(/^(.*?)(\d+)\s*$/);
    if (m) nextNumber = `${m[1]}${Number(m[2]) + 1}`;
  }

  // Today's date in the coach's "9.07.2026" format (Canberra time).
  const now = new Date();
  const canberra = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Canberra",
    day: "numeric",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(now);
  const get = (t: string) => canberra.find((p) => p.type === t)?.value ?? "";
  const todayStr = `${get("day")}.${get("month")}.${get("year")}`;

  const [row] = await db
    .insert(sessionsTable)
    .values({
      title: body.data.title ?? "New session",
      sessionDate: todayStr,
      team: last?.team ?? null,
      sessionNumber: nextNumber,
      cycleCode: last?.cycleCode ?? null,
      location: last?.location ?? null,
      timeSlot: last?.timeSlot ?? null,
      squadText: last?.squadText ?? null,
    })
    .returning({ id: sessionsTable.id });
  const detail = await loadSessionDetail(row.id);
  res.json(GetSessionResponse.parse(detail));
});

router.get("/sessions/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }
  const detail = await loadSessionDetail(id);
  if (!detail) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(GetSessionResponse.parse(detail));
});

router.patch("/sessions/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }
  const body = UpdateSessionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .update(sessionsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(sessionsTable.id, id))
    .returning({ id: sessionsTable.id });
  if (!row) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const detail = await loadSessionDetail(id);
  res.json(GetSessionResponse.parse(detail));
});

router.delete("/sessions/:id", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid session id" });
    return;
  }
  const rows = await db.delete(sessionsTable).where(eq(sessionsTable.id, id)).returning({ id: sessionsTable.id });
  res.json(DeleteSessionResponse.parse({ deleted: rows.length > 0 }));
});

router.put("/sessions/:id/parts/:part", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const part = req.params.part;
  if (!id || !isPart(part)) {
    res.status(400).json({ error: "Invalid session id or part" });
    return;
  }
  const body = UpsertSessionPartBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [exists] = await db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.id, id));
  if (!exists) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (body.data.practiceId != null) {
    const [p] = await db
      .select({ id: practicesTable.id })
      .from(practicesTable)
      .where(eq(practicesTable.id, body.data.practiceId));
    if (!p) {
      res.status(400).json({ error: "Unknown practice id" });
      return;
    }
  }
  const values = { ...body.data, sessionId: id, part, updatedAt: new Date() };
  await db
    .insert(sessionPracticesTable)
    .values(values)
    .onConflictDoUpdate({
      target: [sessionPracticesTable.sessionId, sessionPracticesTable.part],
      set: { ...body.data, updatedAt: new Date() },
    });
  await db.update(sessionsTable).set({ updatedAt: new Date() }).where(eq(sessionsTable.id, id));
  const detail = await loadSessionDetail(id);
  res.json(GetSessionResponse.parse(detail));
});

router.delete("/sessions/:id/parts/:part", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  const part = req.params.part;
  if (!id || !isPart(part)) {
    res.status(400).json({ error: "Invalid session id or part" });
    return;
  }
  await db
    .delete(sessionPracticesTable)
    .where(and(eq(sessionPracticesTable.sessionId, id), eq(sessionPracticesTable.part, part)));
  const detail = await loadSessionDetail(id);
  if (!detail) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(GetSessionResponse.parse(detail));
});

export default router;
