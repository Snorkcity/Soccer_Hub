import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, sessionsTable, sessionPracticesTable, practicesTable, SESSION_PARTS } from "@workspace/db";
import { embedTexts } from "../assistant/curriculumStore";
import { loadPractices, rankPractices, type PracticeEntry } from "../assistant/practiceStore";
import {
  ListSessionsResponse,
  CreateSessionBody,
  GenerateSessionBody,
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

// Pre-fill a new session from the most recently created one so the coach
// doesn't have to re-type team, location, time slot, squad list, etc.
// (skips blank sessions that never had details filled in).
async function createPrefilledSession(title: string, theme?: string | null): Promise<number> {
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
      title,
      sessionDate: todayStr,
      team: last?.team ?? null,
      sessionNumber: nextNumber,
      theme: theme ?? null,
      cycleCode: last?.cycleCode ?? null,
      location: last?.location ?? null,
      timeSlot: last?.timeSlot ?? null,
      squadText: last?.squadText ?? null,
    })
    .returning({ id: sessionsTable.id });
  return row.id;
}

router.post("/sessions", async (req, res): Promise<void> => {
  const body = CreateSessionBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const id = await createPrefilledSession(body.data.title ?? "New session");
  const detail = await loadSessionDetail(id);
  res.json(GetSessionResponse.parse(detail));
});

// ── AI session generation (16+ / professional development phase) ────────────
const CYCLE_SECTION: Record<string, string> = { small: "Small Games", medium: "Medium Games", big: "Big Games" };

router.post("/sessions/generate", async (req, res): Promise<void> => {
  const body = GenerateSessionBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { theme, players, minutes, endGame, endGamePlan } = body.data;

  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey) {
    res.status(503).json({ error: "AI is not configured on this server" });
    return;
  }

  const entries = await loadPractices();
  if (!entries.some((e) => e.embedding)) {
    res.status(503).json({ error: "The practice library is still being prepared — try again in a minute" });
    return;
  }

  // Retrieve candidates: intro from Activations, main from Main Part, end game
  // from the requested game-cycle section.
  const [themeVec, endVec] = await embedTexts([theme, endGamePlan?.trim() ? `${endGamePlan} ${theme}` : theme]);
  const intros = rankPractices(entries, themeVec, "Activations", 8);
  const mains = rankPractices(entries, themeVec, "Main Part", 8);
  const section = CYCLE_SECTION[endGame];
  let ends = rankPractices(entries, endVec, "End Games", 6, (e) => e.sectionName === section);
  if (ends.length === 0) ends = rankPractices(entries, endVec, "End Games", 6);

  const list = (xs: PracticeEntry[]) =>
    xs.map((e) => `[id ${e.id}] ${e.title ?? "(untitled)"} — section: ${e.sectionName ?? "?"}\n${e.text.slice(0, 900)}`).join("\n\n");

  const sys = `You assemble a football training session for a senior / 16+ squad from the coach's OWN practice library. Never invent drills — you may only pick from the candidate practices listed, and your coaching messages and rules must be grounded in the language of the chosen practices (adapt numbers/area to the squad, keep the coach's terminology). The Introduction and Main part must train the same theme with consistent coaching messages. Respond with JSON only:
{
  "title": "short session title",
  "introId": <id from INTRODUCTION candidates>,
  "mainId": <id from MAIN candidates>,
  "endId": <id from END GAME candidates>,
  "parts": {
    "introduction": { "rules": "...", "tasks": "coaching messages, one per line", "coachingPoints": "...", "players": "...", "size": "...", "timing": "..." },
    "main": { "rules": "...", "tasks": "...", "coachingPoints": "...", "players": "...", "size": "...", "timing": "..." },
    "endgame": { "rules": "...", "tasks": "...", "players": "...", "size": "...", "timing": "..." }
  }
}`;
  const usr = `Theme: ${theme}
Players available: ${players ?? "unknown"}
Session length: ${minutes ?? 90} minutes (allow ~10-15 min warmup + passing activation before the introduction)
End game cycle: ${endGame} games${endGamePlan ? ` — coach's plan: ${endGamePlan}` : ""}

INTRODUCTION candidates (technical activations):
${list(intros)}

MAIN candidates:
${list(mains)}

END GAME candidates:
${list(ends)}`;

  const aiRes = await fetch(`${baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-5.6-terra",
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
    }),
  });
  if (!aiRes.ok) {
    const text = await aiRes.text();
    console.error("generate-session AI call failed", aiRes.status, text.slice(0, 400));
    res.status(502).json({ error: "The AI had a problem assembling the session — please try again" });
    return;
  }
  const json = (await aiRes.json()) as { choices?: { message?: { content?: string } }[] };
  let plan: {
    title?: string;
    introId?: number;
    mainId?: number;
    endId?: number;
    parts?: Record<string, Record<string, string | undefined>>;
  };
  try {
    plan = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  } catch {
    res.status(502).json({ error: "The AI returned an unreadable plan — please try again" });
    return;
  }

  // Validate picks against the candidate lists; fall back to the top-ranked candidate.
  const pick = (id: number | undefined, pool: PracticeEntry[]) =>
    pool.find((e) => e.id === id) ?? pool[0] ?? null;
  const intro = pick(plan.introId, intros);
  const main = pick(plan.mainId, mains);
  const end = pick(plan.endId, ends);

  // Standard dynamic warmup = first Warmup-chapter slide in the deck.
  const warmup = entries.filter((e) => e.chapter === "Warmup").sort((a, b) => a.ordinal - b.ordinal)[0] ?? null;

  const sessionId = await createPrefilledSession(plan.title?.trim() || `Session — ${theme}`, theme);
  const now = new Date();
  const partRows: (typeof sessionPracticesTable.$inferInsert)[] = [];
  if (warmup) partRows.push({ sessionId, part: "warmup", practiceId: warmup.id, updatedAt: now });
  const f = (part: string, entry: PracticeEntry | null) => {
    if (!entry) return;
    const p = plan.parts?.[part] ?? {};
    const t = (k: string) => (typeof p[k] === "string" && p[k]?.trim() ? (p[k] as string).trim() : null);
    partRows.push({
      sessionId,
      part: part === "introduction" ? "introduction" : part,
      practiceId: entry.id,
      rules: t("rules"),
      tasks: t("tasks"),
      coachingPoints: t("coachingPoints"),
      players: t("players"),
      size: t("size"),
      timing: t("timing"),
      updatedAt: now,
    });
  };
  f("introduction", intro);
  f("main", main);
  f("endgame", end);
  if (partRows.length) await db.insert(sessionPracticesTable).values(partRows);

  const detail = await loadSessionDetail(sessionId);
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
