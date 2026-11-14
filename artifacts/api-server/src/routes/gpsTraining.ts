import { Router, type Request, type Response } from "express";
import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { db, gpsTrainingTable, leaguesTable, seasonsTable, seasonRosterTable } from "@workspace/db";
import {
  ListGpsTrainingQueryParams, ListGpsTrainingResponse,
  PreviewGpsTrainingBody, PreviewGpsTrainingResponse,
  SaveGpsTrainingBody, SaveGpsTrainingResponse,
  UpdateGpsTrainingPlanBody, UpdateGpsTrainingPlanParams, UpdateGpsTrainingPlanResponse,
  type TrainingGpsImportInput,
} from "@workspace/api-zod";
import { getSessionUser, canSeeLeague, hasModule } from "../middlewares/entryAuth";
import { focusClubForLeagueRequest } from "../lib/focusClub";
import { parseTrainingCsv } from "../lib/gpsTrainingCsv";

const router = Router();
async function scope(req: Request, res: Response, leagueId: number, year: string, write = false) {
  const user = await getSessionUser(req);
  if (!user || !canSeeLeague(user, leagueId) || !hasModule(user, leagueId, "gps", year) ||
      (write && !hasModule(user, leagueId, "data-entry", year))) {
    res.status(403).json({ error: write ? "GPS and Data Entry access are required." : "No GPS access to this competition." });
    return null;
  }
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) { res.status(404).json({ error: "Competition not found." }); return null; }
  if (write && league.gpsSourceLeagueId) {
    res.status(400).json({ error: "This competition shares GPS read-only. Import training in its source hub." });
    return null;
  }
  const club = await focusClubForLeagueRequest(req, leagueId);
  return { club, league };
}

async function prepare(input: TrainingGpsImportInput, club: string, focusClub: string | null) {
  const [season] = await db.select().from(seasonsTable)
    .where(and(eq(seasonsTable.leagueId, input.leagueId), eq(seasonsTable.year, input.year)));
  if (!season) throw new Error("Create or select this competition's campaign season before importing.");
  const roster = club === (focusClub ?? "Belconnen") ? await db.select({
    id: seasonRosterTable.id, playerName: seasonRosterTable.playerName,
    squad: seasonRosterTable.squad, positionCode: seasonRosterTable.positionCode,
  }).from(seasonRosterTable).innerJoin(seasonsTable, eq(seasonsTable.id, seasonRosterTable.seasonId))
    .where(and(eq(seasonsTable.year, input.year), or(
      eq(seasonsTable.leagueId, input.leagueId), eq(seasonRosterTable.gpsLeagueId, input.leagueId),
    ))) : [];
  return parseTrainingCsv(input.csv, input, roster, input.playerMappings);
}

function sessionPredicate(leagueId: number, club: string, year: string, date: string, title: string) {
  return and(eq(gpsTrainingTable.leagueId, leagueId), eq(gpsTrainingTable.club, club),
    eq(gpsTrainingTable.year, year), eq(gpsTrainingTable.date, date), eq(gpsTrainingTable.title, title));
}
function sameMeasurements(existing: typeof gpsTrainingTable.$inferSelect, prepared: ReturnType<typeof parseTrainingCsv>) {
  return existing.sourceHash === prepared.session.sourceHash &&
    isDeepStrictEqual(existing.rows, prepared.session.rows);
}

router.get("/gps-training", async (req, res): Promise<void> => {
  const query = ListGpsTrainingQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: "Choose a valid league and campaign year." }); return; }
  const { leagueId, year } = query.data;
  const access = await scope(req, res, leagueId, year);
  if (!access) return;
  // Shared GPS hubs are viewed from their source competition, keeping
  // private training ownership explicit rather than silently copying it.
  const rows = await db.select().from(gpsTrainingTable)
    .where(and(eq(gpsTrainingTable.leagueId, leagueId), eq(gpsTrainingTable.club, access.club), eq(gpsTrainingTable.year, year)))
    .orderBy(desc(gpsTrainingTable.date), desc(gpsTrainingTable.id));
  res.json(ListGpsTrainingResponse.parse(rows));
});

router.post("/entry/gps-training/preview", async (req, res): Promise<void> => {
  const parsed = PreviewGpsTrainingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A valid campaign and training CSV are required." }); return; }
  const input = parsed.data, access = await scope(req, res, input.leagueId, input.year, true);
  if (!access) return;
  let prepared: ReturnType<typeof parseTrainingCsv>;
  try { prepared = await prepare(input, access.club, access.league.focusClub); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Invalid training CSV." }); return; }
  const [existing] = await db.select().from(gpsTrainingTable).where(
    sessionPredicate(input.leagueId, access.club, input.year, prepared.session.date, prepared.session.title));
  res.json(PreviewGpsTrainingResponse.parse({
    ...prepared, existingId: existing?.id ?? null, existingVersion: existing?.version ?? null,
    identical: !!existing && sameMeasurements(existing, prepared),
  }));
});

router.post("/entry/gps-training", async (req, res): Promise<void> => {
  const parsed = SaveGpsTrainingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A valid campaign and training CSV are required." }); return; }
  const input = parsed.data, access = await scope(req, res, input.leagueId, input.year, true);
  if (!access) return;
  let prepared: ReturnType<typeof parseTrainingCsv>;
  try { prepared = await prepare(input, access.club, access.league.focusClub); }
  catch (err) { res.status(400).json({ error: err instanceof Error ? err.message : "Invalid training CSV." }); return; }
  if ((prepared.unmatchedNames.length || prepared.ambiguousNames.length) && !input.allowUnmatched) {
    res.status(400).json({ error: "Map the flagged names, or explicitly confirm keeping them unassigned." }); return;
  }
  const result = await db.transaction(async tx => {
    const identity = `${input.leagueId}:${access.club}:${input.year}:${prepared.session.date}:${prepared.session.title}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${identity}, 0))`);
    const [existing] = await tx.select().from(gpsTrainingTable).where(
      sessionPredicate(input.leagueId, access.club, input.year, prepared.session.date, prepared.session.title));
    if (existing && sameMeasurements(existing, prepared)) return { session: existing };
    if (existing && (!input.replace || input.expectedVersion !== existing.version)) return { conflict: true as const };
    const { rows, warnings, sourceHash, sourceFilename } = prepared.session;
    if (existing) {
      const [session] = await tx.update(gpsTrainingTable).set({
        rows, warnings, sourceHash, sourceFilename, version: existing.version + 1, updatedAt: new Date(),
      }).where(and(eq(gpsTrainingTable.id, existing.id), eq(gpsTrainingTable.version, existing.version))).returning();
      return session ? { session } : { conflict: true as const };
    }
    const [session] = await tx.insert(gpsTrainingTable).values({
      leagueId: input.leagueId, club: access.club, year: input.year,
      date: prepared.session.date, title: prepared.session.title,
      rows, warnings, sourceHash, sourceFilename,
    }).returning();
    return { session };
  });
  if ("conflict" in result || !result.session) {
    res.status(409).json({ error: "This training session already exists or changed since preview. Preview again and explicitly confirm replacement." }); return;
  }
  res.json(SaveGpsTrainingResponse.parse(result.session));
});

router.patch("/entry/gps-training/:id/plan", async (req, res): Promise<void> => {
  const params = UpdateGpsTrainingPlanParams.safeParse(req.params), body = UpdateGpsTrainingPlanBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid session plan." }); return; }
  const input = body.data, access = await scope(req, res, input.leagueId, input.year, true);
  if (!access) return;
  if (input.allowances.some(a => a.part === "recording" || a.minMinutes > a.maxMinutes) ||
      new Set(input.allowances.map(a => a.part)).size !== input.allowances.length) {
    res.status(400).json({ error: "Choose one valid minimum/maximum allowance per selected part." }); return;
  }
  const predicate = and(eq(gpsTrainingTable.id, params.data.id), eq(gpsTrainingTable.leagueId, input.leagueId),
    eq(gpsTrainingTable.club, access.club), eq(gpsTrainingTable.year, input.year));
  const [existing] = await db.select({ version: gpsTrainingTable.version }).from(gpsTrainingTable).where(predicate);
  if (!existing) { res.status(404).json({ error: "Training session not found." }); return; }
  const [session] = await db.update(gpsTrainingTable).set({
    plannedMinutes: input.plannedMinutes, scheduledStartTime: input.scheduledStartTime,
    allowances: input.allowances, version: existing.version + 1, updatedAt: new Date(),
  }).where(and(predicate, eq(gpsTrainingTable.version, input.expectedVersion))).returning();
  if (!session) { res.status(409).json({ error: "This session changed. Reload before saving its plan." }); return; }
  res.json(UpdateGpsTrainingPlanResponse.parse(session));
});

export default router;
