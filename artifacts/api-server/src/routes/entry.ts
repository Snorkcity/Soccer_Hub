import { Router, type IRouter, type Request } from "express";
import { getSessionUser, hasModule, leagueIdForSeason } from "../middlewares/entryAuth";
import { eq, and, desc, isNull, inArray, sql, type AnyColumn } from "drizzle-orm";
import {
  db,
  leagueMatchesTable,
  leagueGoalsTable,
  leaguePlayerStatsTable,
  matchesTable,
  goalsTable,
  playerStatsTable,
  playersTable,
  athleticTestsTable,
  gpsSessionsTable,
  leaguesTable,
  clubsTable,
  seasonsTable,
} from "@workspace/db";
import { driblClubNamesFor } from "./dribl";
import {
  ListLeagueMatchesQueryParams,
  ListLeagueMatchesResponse,
  GetGoalOptionsQueryParams,
  GetGoalOptionsResponse,
  GetGoalTallyQueryParams,
  GetGoalTallyResponse,
  GetPlayerTallyQueryParams,
  GetPlayerTallyResponse,
  ListEntryGoalsQueryParams,
  ListEntryGoalsResponse,
  DeleteEntryGoalResponse,
  CreateEntryMatchBody,
  CreateEntryMatchResponse,
  CreateEntryGoalBody,
  CreateEntryGoalResponse,
  SaveEntryPlayerStatsBody,
  SaveEntryPlayerStatsResponse,
  ListEntryPlayerStatsQueryParams,
  ListEntryPlayerStatsResponse,
  DeleteEntryPlayerStatResponse,
  ListEntryGpsUploadsQueryParams,
  ListEntryGpsUploadsResponse,
  UpdateEntryGpsUploadBody,
  UpdateEntryGpsUploadResponse,
  DeleteEntryGpsUploadQueryParams,
  DeleteEntryGpsUploadResponse,
  UpdateEntryGoalBody,
  UpdateEntryGoalResponse,
  UpdateEntryPlayerStatBody,
  UpdateEntryPlayerStatResponse,
  DeleteEntryPlayerStatsQueryParams,
  DeleteEntryPlayerStatsResponse,
  ExtractPlayersFromImageBody,
  ExtractPlayersFromImageResponse,
  ExtractClubsFromLeagueBody,
  ExtractClubsFromLeagueResponse,
  FillClubBrandingBody,
  FillClubBrandingResponse,
  SaveEntryAthleticTestsBody,
  SaveEntryAthleticTestsResponse,
  SaveEntryGpsSessionsBody,
  SaveEntryGpsSessionsResponse,
  ListEntryGpsFixturesQueryParams,
  ListEntryGpsFixturesResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { focusClubForRequest } from "../lib/focusClub";

const router: IRouter = Router();

const n2s = (v: number | null | undefined): string | null => (v == null ? null : String(v));

// ── League fixtures (entry pickers) ──────────────────────────────────────────
router.get("/entry/league-matches", async (req, res): Promise<void> => {
  const query = ListLeagueMatchesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, query.data.seasonId))
    .orderBy(desc(leagueMatchesTable.matchDate));
  res.json(ListLeagueMatchesResponse.parse(rows.map(r => ({
    id: r.id, matchId: r.matchId, matchDate: r.matchDate,
    homeTeam: r.homeTeam, awayTeam: r.awayTeam, fullScore: r.fullScore,
    homeGoals: r.homeGoals, awayGoals: r.awayGoals,
  }))));
});

// ── Goal tally: logged-so-far vs the final score, per team ───────────────────
router.get("/entry/goal-tally", async (req, res): Promise<void> => {
  const query = GetGoalTallyQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { seasonId, matchId } = query.data;
  const [fixture] = await db
    .select()
    .from(leagueMatchesTable)
    .where(and(eq(leagueMatchesTable.seasonId, seasonId), eq(leagueMatchesTable.matchId, matchId)));
  if (!fixture) {
    res.status(404).json({ error: `No fixture "${matchId}" this season` });
    return;
  }
  const logged = await db
    .select({ scorerTeam: leagueGoalsTable.scorerTeam })
    .from(leagueGoalsTable)
    .where(and(eq(leagueGoalsTable.seasonId, seasonId), eq(leagueGoalsTable.matchId, matchId)));
  res.json(GetGoalTallyResponse.parse({
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeExpected: fixture.homeGoals,
    awayExpected: fixture.awayGoals,
    homeLogged: logged.filter(g => g.scorerTeam === fixture.homeTeam).length,
    awayLogged: logged.filter(g => g.scorerTeam === fixture.awayTeam).length,
  }));
});

// ── Dropdown vocabulary (keeps spellings consistent with existing data) ──────
router.get("/entry/player-tally", async (req, res): Promise<void> => {
  const query = GetPlayerTallyQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { seasonId, matchId } = query.data;
  const [fixture] = await db
    .select()
    .from(leagueMatchesTable)
    .where(and(eq(leagueMatchesTable.seasonId, seasonId), eq(leagueMatchesTable.matchId, matchId)));
  if (!fixture) {
    res.status(404).json({ error: `No fixture "${matchId}" this season` });
    return;
  }
  const rows = await db
    .select({ club: leaguePlayerStatsTable.club })
    .from(leaguePlayerStatsTable)
    .where(and(eq(leaguePlayerStatsTable.seasonId, seasonId), eq(leaguePlayerStatsTable.matchId, matchId)));
  res.json(GetPlayerTallyResponse.parse({
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeSaved: rows.filter(r => r.club === fixture.homeTeam).length,
    awaySaved: rows.filter(r => r.club === fixture.awayTeam).length,
  }));
});

router.get("/entry/goals", async (req, res): Promise<void> => {
  const query = ListEntryGoalsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { seasonId, matchId } = query.data;
  const rows = await db
    .select({
      id: leagueGoalsTable.id,
      scorerTeam: leagueGoalsTable.scorerTeam,
      minuteScored: leagueGoalsTable.minuteScored,
      scorer: leagueGoalsTable.scorer,
      assist: leagueGoalsTable.assist,
      goalType: leagueGoalsTable.goalType,
      assistType: leagueGoalsTable.assistType,
      howPenetrated: leagueGoalsTable.howPenetrated,
      buildupLane: leagueGoalsTable.buildupLane,
      firstTimeFinish: leagueGoalsTable.firstTimeFinish,
      finishType: leagueGoalsTable.finishType,
      passString: leagueGoalsTable.passString,
      goalX: leagueGoalsTable.goalX,
      goalY: leagueGoalsTable.goalY,
    })
    .from(leagueGoalsTable)
    .where(and(eq(leagueGoalsTable.seasonId, seasonId), eq(leagueGoalsTable.matchId, matchId)))
    .orderBy(leagueGoalsTable.minuteScored, leagueGoalsTable.id);
  // numeric columns come back as strings from Drizzle — convert for the schema
  const goals = rows.map(g => ({
    ...g,
    goalX: g.goalX == null ? null : Number(g.goalX),
    goalY: g.goalY == null ? null : Number(g.goalY),
  }));
  res.json(ListEntryGoalsResponse.parse({ goals }));
});


// ID-parameter deletes carry no seasonId in the query/body, so the central
// middleware can't scope them to a league. Re-check here against the row's own
// season before deleting (prevents cross-league deletes by ID).
async function canEnterDataForSeason(req: Request, seasonId: number): Promise<boolean> {
  const user = await getSessionUser(req);
  if (!user) return false;
  const leagueId = await leagueIdForSeason(seasonId);
  if (leagueId == null) return false;
  return hasModule(user, leagueId, "data-entry");
}

router.delete("/entry/goal/:goalId", async (req, res): Promise<void> => {
  const goalId = Number(req.params.goalId);
  if (!Number.isInteger(goalId)) {
    res.status(400).json({ error: "Invalid goal id" });
    return;
  }
  const [goal] = await db.select().from(leagueGoalsTable).where(eq(leagueGoalsTable.id, goalId));
  if (!goal) {
    res.status(404).json({ error: "That goal is already gone" });
    return;
  }
  if (!(await canEnterDataForSeason(req, goal.seasonId))) {
    res.status(403).json({ error: "You don't have data entry access for this league" });
    return;
  }

  const focusClub = await focusClubForRequest(req, goal.seasonId);

  // Single transaction: remove league goal + its Belconnen copy together
  const belconnenDeleted = await db.transaction(async (tx) => {
    await tx.delete(leagueGoalsTable).where(eq(leagueGoalsTable.id, goalId));

    if (goal.homeTeam !== focusClub && goal.awayTeam !== focusClub) return false;
    // A fixture may exist under several team contexts; consider every mirror partition
    const matchRows = await tx
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(and(eq(matchesTable.matchId, goal.matchId), eq(matchesTable.seasonId, goal.seasonId)));
    if (matchRows.length === 0) return false;

    // Match the legacy copy on EVERY mirrored field (null-safe) so we can only
    // ever hit exact duplicates of the deleted league goal — never a different goal.
    const nullSafe = <T extends AnyColumn>(col: T, val: unknown) =>
      val == null ? isNull(col) : eq(col, val as never);
    const candidates = await tx
      .select({ id: goalsTable.id })
      .from(goalsTable)
      .where(and(
        inArray(goalsTable.matchId, matchRows.map(m => m.id)),
        eq(goalsTable.seasonId, goal.seasonId),
        nullSafe(goalsTable.scorerTeam, goal.scorerTeam),
        nullSafe(goalsTable.minuteScored, goal.minuteScored),
        nullSafe(goalsTable.scorer, goal.scorer),
        nullSafe(goalsTable.assist, goal.assist),
        nullSafe(goalsTable.goalType, goal.goalType),
        nullSafe(goalsTable.assistType, goal.assistType),
        nullSafe(goalsTable.howPenetrated, goal.howPenetrated),
        nullSafe(goalsTable.buildupLane, goal.buildupLane),
        nullSafe(goalsTable.firstTimeFinish, goal.firstTimeFinish),
        nullSafe(goalsTable.finishType, goal.finishType),
        nullSafe(goalsTable.passString, goal.passString),
        nullSafe(goalsTable.goalX, goal.goalX),
        nullSafe(goalsTable.goalY, goal.goalY),
      ));
    if (candidates.length === 0) {
      logger.warn({ leagueGoalId: goalId, matchId: goal.matchId }, "No matching Belconnen goal copy found to delete");
      return false;
    }
    // Exact-duplicate copies are interchangeable — deleting any one of them is correct
    await tx.delete(goalsTable).where(eq(goalsTable.id, candidates[0].id));
    return true;
  });

  res.json(DeleteEntryGoalResponse.parse({ deleted: true, belconnenDeleted }));
});

// ── Edit a logged goal in place (league row + Belconnen mirror copy) ─────────
router.patch("/entry/goal/:goalId", async (req, res): Promise<void> => {
  const goalId = Number(req.params.goalId);
  if (!Number.isInteger(goalId)) {
    res.status(400).json({ error: "Invalid goal id" });
    return;
  }
  const parsed = UpdateEntryGoalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;

  const [goal] = await db.select().from(leagueGoalsTable).where(eq(leagueGoalsTable.id, goalId));
  if (!goal) {
    res.status(404).json({ error: "That goal no longer exists" });
    return;
  }
  if (!(await canEnterDataForSeason(req, goal.seasonId))) {
    res.status(403).json({ error: "You don't have data entry access for this league" });
    return;
  }
  if (b.scorerTeam !== goal.homeTeam && b.scorerTeam !== goal.awayTeam) {
    res.status(400).json({ error: `Scorer team must be ${goal.homeTeam} or ${goal.awayTeam}` });
    return;
  }

  const focusClub = await focusClubForRequest(req, goal.seasonId);

  const detail = {
    scorerTeam: b.scorerTeam,
    minuteScored: b.minuteScored ?? null,
    scorer: b.scorer ?? null,
    assist: b.assist ?? null,
    goalType: b.goalType ?? null,
    assistType: b.assistType ?? null,
    howPenetrated: b.howPenetrated ?? null,
    buildupLane: b.buildupLane ?? null,
    firstTimeFinish: b.firstTimeFinish ?? null,
    finishType: b.finishType ?? null,
    passString: b.passString ?? null,
    goalX: n2s(b.goalX),
    goalY: n2s(b.goalY),
  };

  // Single transaction: update league goal + its Belconnen copy together.
  const belconnenUpdated = await db.transaction(async (tx) => {
    await tx.update(leagueGoalsTable).set(detail).where(eq(leagueGoalsTable.id, goalId));

    if (goal.homeTeam !== focusClub && goal.awayTeam !== focusClub) return false;
    const matchRows = await tx
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(and(eq(matchesTable.matchId, goal.matchId), eq(matchesTable.seasonId, goal.seasonId)));
    if (matchRows.length === 0) return false;

    // Locate the legacy copy by exact-match on the goal's OLD values (null-safe),
    // same as the delete route — we can only ever hit an exact duplicate.
    const nullSafe = <T extends AnyColumn>(col: T, val: unknown) =>
      val == null ? isNull(col) : eq(col, val as never);
    const candidates = await tx
      .select({ id: goalsTable.id })
      .from(goalsTable)
      .where(and(
        inArray(goalsTable.matchId, matchRows.map(m => m.id)),
        eq(goalsTable.seasonId, goal.seasonId),
        nullSafe(goalsTable.scorerTeam, goal.scorerTeam),
        nullSafe(goalsTable.minuteScored, goal.minuteScored),
        nullSafe(goalsTable.scorer, goal.scorer),
        nullSafe(goalsTable.assist, goal.assist),
        nullSafe(goalsTable.goalType, goal.goalType),
        nullSafe(goalsTable.assistType, goal.assistType),
        nullSafe(goalsTable.howPenetrated, goal.howPenetrated),
        nullSafe(goalsTable.buildupLane, goal.buildupLane),
        nullSafe(goalsTable.firstTimeFinish, goal.firstTimeFinish),
        nullSafe(goalsTable.finishType, goal.finishType),
        nullSafe(goalsTable.passString, goal.passString),
        nullSafe(goalsTable.goalX, goal.goalX),
        nullSafe(goalsTable.goalY, goal.goalY),
      ));
    if (candidates.length === 0) {
      logger.warn({ leagueGoalId: goalId, matchId: goal.matchId }, "No matching Belconnen goal copy found to edit");
      return false;
    }
    await tx.update(goalsTable).set(detail).where(eq(goalsTable.id, candidates[0].id));
    return true;
  });

  res.json(UpdateEntryGoalResponse.parse({ updated: true, belconnenUpdated }));
});

router.get("/entry/goal-options", async (req, res): Promise<void> => {
  const query = GetGoalOptionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { seasonId } = query.data;

  const distinct = (values: (string | null)[]): string[] =>
    Array.from(new Set(values.filter((v): v is string => !!v && v.trim().length > 0))).sort();

  const goalRows = await db
    .select({
      goalType: leagueGoalsTable.goalType,
      assistType: leagueGoalsTable.assistType,
      howPenetrated: leagueGoalsTable.howPenetrated,
      buildupLane: leagueGoalsTable.buildupLane,
      finishType: leagueGoalsTable.finishType,
    })
    .from(leagueGoalsTable)
    .where(eq(leagueGoalsTable.seasonId, seasonId));

  const matchRows = await db
    .select({
      conditions: matchesTable.conditions,
      venue: matchesTable.venue,
      formation: matchesTable.formation,
      oppFormation: matchesTable.oppFormation,
    })
    .from(matchesTable)
    .where(eq(matchesTable.seasonId, seasonId));

  res.json(GetGoalOptionsResponse.parse({
    goalTypes: distinct(goalRows.map(r => r.goalType)),
    assistTypes: distinct(goalRows.map(r => r.assistType)),
    howPenetrated: distinct(goalRows.map(r => r.howPenetrated)),
    buildupLanes: distinct(goalRows.map(r => r.buildupLane)),
    finishTypes: distinct(goalRows.map(r => r.finishType)),
    conditions: distinct(matchRows.map(r => r.conditions)),
    venues: distinct(matchRows.map(r => r.venue)),
    formations: distinct([...matchRows.map(r => r.formation), ...matchRows.map(r => r.oppFormation)]),
  }));
});

// ── Record a fixture ──────────────────────────────────────────────────────────
// Writes league_matches always; when Belconnen is one of the two clubs, also
// writes the Belconnen `matches` row (with the Veo team stats) so the coach
// never enters the same fixture twice.
router.post("/entry/match", async (req, res): Promise<void> => {
  const parsed = CreateEntryMatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  if (b.homeTeam.trim() === b.awayTeam.trim()) {
    res.status(400).json({ error: "Home and away team must be different clubs" });
    return;
  }

  const [existing] = await db
    .select({ id: leagueMatchesTable.id })
    .from(leagueMatchesTable)
    .where(and(eq(leagueMatchesTable.matchId, b.matchId), eq(leagueMatchesTable.seasonId, b.seasonId)));
  if (existing) {
    res.status(409).json({ error: `Match ID "${b.matchId}" already exists this season` });
    return;
  }

  const focusClub = await focusClubForRequest(req, b.seasonId);
  const fullScore = `${b.homeGoals}-${b.awayGoals}`;
  // Single transaction: the league row and the Belconnen row commit together or not at all
  const { leagueMatch, belconnenMatchId } = await db.transaction(async (tx) => {
    const [leagueMatch] = await tx.insert(leagueMatchesTable).values({
      matchId: b.matchId,
      matchDate: b.matchDate,
      homeTeam: b.homeTeam.trim(),
      awayTeam: b.awayTeam.trim(),
      fullScore,
      halfScore: b.halfScore ?? null,
      homeGoals: b.homeGoals,
      awayGoals: b.awayGoals,
      seasonId: b.seasonId,
    }).returning();

    let belconnenMatchId: number | null = null;
    const isHome = b.homeTeam.trim() === focusClub;
    const isAway = b.awayTeam.trim() === focusClub;
    if (isHome || isAway) {
      const goalsScored = isHome ? b.homeGoals : b.awayGoals;
      const goalsConceded = isHome ? b.awayGoals : b.homeGoals;
      const [match] = await tx.insert(matchesTable).values({
      matchId: b.matchId,
      matchDate: b.matchDate,
      venue: b.venue ?? null,
      opponent: isHome ? b.awayTeam.trim() : b.homeTeam.trim(),
      halfScore: b.halfScore ?? null,
      fullScore,
      goalsScored,
      goalsConceded,
      cleanSheet: goalsConceded === 0,
      formation: b.formation ?? null,
      oppFormation: b.oppFormation ?? null,
      conditions: b.conditions ?? null,
      possession: n2s(b.possession),
      shots: b.shots ?? null,
      passes: b.passes ?? null,
      oppShots: b.oppShots ?? null,
      oppPasses: b.oppPasses ?? null,
      teamId: b.teamId,
      seasonId: b.seasonId,
    }).returning();
      belconnenMatchId = match.id;
    }
    return { leagueMatch, belconnenMatchId };
  });

  res.status(201).json(CreateEntryMatchResponse.parse({
    leagueMatchId: leagueMatch.id,
    belconnenMatchId,
    fullScore,
  }));
});

// ── Record a goal ─────────────────────────────────────────────────────────────
// Writes league_goals always; when the fixture involves Belconnen, duplicates
// the row into the legacy Belconnen `goals` table (keyed by matches.id) so the
// team-tab charts keep working without re-entry.
router.post("/entry/goal", async (req, res): Promise<void> => {
  const parsed = CreateEntryGoalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;

  const [fixture] = await db
    .select()
    .from(leagueMatchesTable)
    .where(and(eq(leagueMatchesTable.matchId, b.matchId), eq(leagueMatchesTable.seasonId, b.seasonId)));
  if (!fixture) {
    res.status(404).json({ error: `No fixture with Match ID "${b.matchId}" this season — record the match first` });
    return;
  }
  if (b.scorerTeam !== fixture.homeTeam && b.scorerTeam !== fixture.awayTeam) {
    res.status(400).json({ error: `Scorer team must be ${fixture.homeTeam} or ${fixture.awayTeam}` });
    return;
  }

  const detail = {
    matchDate: fixture.matchDate,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    scorerTeam: b.scorerTeam,
    minuteScored: b.minuteScored ?? null,
    scorer: b.scorer ?? null,
    assist: b.assist ?? null,
    goalType: b.goalType ?? null,
    assistType: b.assistType ?? null,
    howPenetrated: b.howPenetrated ?? null,
    buildupLane: b.buildupLane ?? null,
    firstTimeFinish: b.firstTimeFinish ?? null,
    finishType: b.finishType ?? null,
    passString: b.passString ?? null,
  };

  const focusClub = await focusClubForRequest(req, b.seasonId);

  // Single transaction: league goal + legacy Belconnen copy commit together
  const { leagueGoal, belconnenGoalId } = await db.transaction(async (tx) => {
    const [leagueGoal] = await tx.insert(leagueGoalsTable).values({
      matchId: b.matchId,
      ...detail,
      goalX: n2s(b.goalX),
      goalY: n2s(b.goalY),
      seasonId: b.seasonId,
    }).returning();

    let belconnenGoalId: number | null = null;
    if (fixture.homeTeam === focusClub || fixture.awayTeam === focusClub) {
      const [match] = await tx
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(and(
          eq(matchesTable.matchId, b.matchId),
          eq(matchesTable.seasonId, b.seasonId),
          eq(matchesTable.teamId, b.teamId),
        ));
      if (match) {
        const [goal] = await tx.insert(goalsTable).values({
          matchId: match.id,
          ...detail,
          goalX: n2s(b.goalX),
          goalY: n2s(b.goalY),
          teamId: b.teamId,
          seasonId: b.seasonId,
        }).returning();
        belconnenGoalId = goal.id;
      } else {
        logger.warn({ matchId: b.matchId }, "Belconnen fixture missing from matches table — goal saved to league only");
      }
    }
    return { leagueGoal, belconnenGoalId };
  });

  res.status(201).json(CreateEntryGoalResponse.parse({
    leagueGoalId: leagueGoal.id,
    belconnenGoalId,
  }));
});

// ── Save player rows for one club in one match ────────────────────────────────
// Replace semantics: re-saving the same match+club overwrites the previous rows,
// so a re-upload after a fix never double-counts. When the fixture involves
// Belconnen, rows are mirrored into the legacy player_stats table (per-player
// FK), creating players on first sight.
router.post("/entry/player-stats", async (req, res): Promise<void> => {
  const parsed = SaveEntryPlayerStatsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;

  const [fixture] = await db
    .select()
    .from(leagueMatchesTable)
    .where(and(eq(leagueMatchesTable.matchId, b.matchId), eq(leagueMatchesTable.seasonId, b.seasonId)));
  if (!fixture) {
    res.status(404).json({ error: `No fixture with Match ID "${b.matchId}" this season — record the match first` });
    return;
  }
  if (b.club !== fixture.homeTeam && b.club !== fixture.awayTeam) {
    res.status(400).json({ error: `Club must be ${fixture.homeTeam} or ${fixture.awayTeam}` });
    return;
  }
  if (b.rows.length === 0) {
    res.status(400).json({ error: "No player rows to save" });
    return;
  }
  const names = b.rows.map(r => r.playerName.trim());
  if (new Set(names).size !== names.length) {
    res.status(400).json({ error: "Duplicate player names in the rows — each player should appear once" });
    return;
  }

  const year = b.year ?? (fixture.matchDate ? fixture.matchDate.slice(0, 4) : null);
  const focusClub = await focusClubForRequest(req, b.seasonId);

  // Dribl imports send ifMissing so a sync can never overwrite rows that were
  // hand-entered (or imported) between preview and import.
  if (b.ifMissing) {
    const [existing] = await db
      .select({ id: leaguePlayerStatsTable.id })
      .from(leaguePlayerStatsTable)
      .where(and(
        eq(leaguePlayerStatsTable.matchId, b.matchId),
        eq(leaguePlayerStatsTable.seasonId, b.seasonId),
        eq(leaguePlayerStatsTable.club, b.club),
      ))
      .limit(1);
    if (existing) {
      res.json(SaveEntryPlayerStatsResponse.parse({ saved: 0, replaced: 0, belconnenCopies: 0, skipped: true }));
      return;
    }
  }

  // Single transaction: replace (delete+insert) both the league rows and the
  // legacy mirror atomically — a failed insert can never wipe existing rows.
  const { replaced, belconnenCopies } = await db.transaction(async (tx) => {
    const replaced = (await tx
      .delete(leaguePlayerStatsTable)
      .where(and(
        eq(leaguePlayerStatsTable.matchId, b.matchId),
        eq(leaguePlayerStatsTable.seasonId, b.seasonId),
        eq(leaguePlayerStatsTable.club, b.club),
      ))
      .returning({ id: leaguePlayerStatsTable.id })).length;

    await tx.insert(leaguePlayerStatsTable).values(b.rows.map(r => ({
      matchId: b.matchId,
      playerName: r.playerName.trim(),
      minsPlayed: r.minsPlayed ?? null,
      position: r.position ?? null,
      discipline: r.discipline ?? null,
      started: r.started,
      appearance: r.appearance,
      club: b.club,
      year,
      seasonId: b.seasonId,
    })));

    // Mirror into the legacy Belconnen-scoped table when this fixture is a
    // Belconnen game (it stores BOTH teams' rows for those games).
    let belconnenCopies = 0;
    if (fixture.homeTeam === focusClub || fixture.awayTeam === focusClub) {
      const [match] = await tx
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(and(
          eq(matchesTable.matchId, b.matchId),
          eq(matchesTable.seasonId, b.seasonId),
          eq(matchesTable.teamId, b.teamId),
        ));
      if (match) {
        await tx.delete(playerStatsTable).where(and(
          eq(playerStatsTable.matchId, match.id),
          eq(playerStatsTable.club, b.club),
        ));
        for (const r of b.rows) {
          const name = r.playerName.trim();
          let [player] = await tx
            .select({ id: playersTable.id })
            .from(playersTable)
            .where(and(eq(playersTable.name, name), eq(playersTable.club, b.club)));
          if (!player) {
            [player] = await tx.insert(playersTable).values({
              name,
              position: r.position ?? null,
              club: b.club,
            }).returning({ id: playersTable.id });
          }
          await tx.insert(playerStatsTable).values({
            matchId: match.id,
            playerId: player.id,
            playerName: name,
            minsPlayed: r.minsPlayed ?? null,
            position: r.position ?? null,
            discipline: r.discipline ?? null,
            started: r.started,
            appearance: r.appearance,
            club: b.club,
            year,
          });
          belconnenCopies++;
        }
      } else {
        logger.warn({ matchId: b.matchId }, "Belconnen fixture missing from matches table — player rows saved to league only");
      }
    }
    return { replaced, belconnenCopies };
  });

  res.json(SaveEntryPlayerStatsResponse.parse({
    saved: b.rows.length,
    replaced,
    belconnenCopies,
  }));
});

// ── Saved player rows for one club in a fixture (review/removal) ─────────────
router.get("/entry/player-stats", async (req, res): Promise<void> => {
  const query = ListEntryPlayerStatsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { seasonId, matchId, club } = query.data;
  const rows = await db
    .select({
      id: leaguePlayerStatsTable.id,
      playerName: leaguePlayerStatsTable.playerName,
      minsPlayed: leaguePlayerStatsTable.minsPlayed,
      position: leaguePlayerStatsTable.position,
      discipline: leaguePlayerStatsTable.discipline,
      started: leaguePlayerStatsTable.started,
      appearance: leaguePlayerStatsTable.appearance,
    })
    .from(leaguePlayerStatsTable)
    .where(and(
      eq(leaguePlayerStatsTable.seasonId, seasonId),
      eq(leaguePlayerStatsTable.matchId, matchId),
      eq(leaguePlayerStatsTable.club, club),
    ))
    .orderBy(leaguePlayerStatsTable.playerName);
  res.json(ListEntryPlayerStatsResponse.parse({ rows }));
});

// ── Remove ALL saved player rows for one club in a fixture ───────────────────
// Same replace-semantics delete the save endpoint uses, without the re-insert —
// clears the league rows and (for Belconnen fixtures) the legacy mirror together.
router.delete("/entry/player-stats", async (req, res): Promise<void> => {
  const query = DeleteEntryPlayerStatsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { seasonId, matchId, club } = query.data;

  const [fixture] = await db
    .select()
    .from(leagueMatchesTable)
    .where(and(eq(leagueMatchesTable.matchId, matchId), eq(leagueMatchesTable.seasonId, seasonId)));
  if (!fixture) {
    res.status(404).json({ error: `No fixture "${matchId}" this season` });
    return;
  }

  const focusClub = await focusClubForRequest(req, seasonId);

  const { removed, belconnenRemoved } = await db.transaction(async (tx) => {
    const removed = (await tx
      .delete(leaguePlayerStatsTable)
      .where(and(
        eq(leaguePlayerStatsTable.seasonId, seasonId),
        eq(leaguePlayerStatsTable.matchId, matchId),
        eq(leaguePlayerStatsTable.club, club),
      ))
      .returning({ id: leaguePlayerStatsTable.id })).length;

    let belconnenRemoved = 0;
    if (fixture.homeTeam === focusClub || fixture.awayTeam === focusClub) {
      const matchRows = await tx
        .select({ id: matchesTable.id })
        .from(matchesTable)
        .where(and(eq(matchesTable.matchId, matchId), eq(matchesTable.seasonId, seasonId)));
      if (matchRows.length > 0) {
        belconnenRemoved = (await tx
          .delete(playerStatsTable)
          .where(and(
            inArray(playerStatsTable.matchId, matchRows.map(m => m.id)),
            eq(playerStatsTable.club, club),
          ))
          .returning({ id: playerStatsTable.id })).length;
      }
    }
    return { removed, belconnenRemoved };
  });

  res.json(DeleteEntryPlayerStatsResponse.parse({ removed, belconnenRemoved }));
});

// ── Edit one saved player row (league row + Belconnen mirror copy) ──────────
router.patch("/entry/player-stat/:rowId", async (req, res): Promise<void> => {
  const rowId = Number(req.params.rowId);
  if (!Number.isInteger(rowId)) {
    res.status(400).json({ error: "Invalid row id" });
    return;
  }
  const body = UpdateEntryPlayerStatBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const edit = body.data;
  if (edit.playerName === undefined && edit.minsPlayed === undefined && edit.position === undefined && edit.started === undefined && edit.appearance === undefined) {
    res.status(400).json({ error: "Nothing to change" });
    return;
  }

  const [row] = await db.select().from(leaguePlayerStatsTable).where(eq(leaguePlayerStatsTable.id, rowId));
  if (!row) {
    res.status(404).json({ error: "That player row no longer exists" });
    return;
  }
  if (row.seasonId == null) {
    res.status(400).json({ error: "Row has no season — cannot safely mirror-edit" });
    return;
  }
  if (!(await canEnterDataForSeason(req, row.seasonId))) {
    res.status(403).json({ error: "You don't have data entry access for this league" });
    return;
  }

  const newName = edit.playerName?.trim();
  if (newName !== undefined && newName.length === 0) {
    res.status(400).json({ error: "Player name can't be empty" });
    return;
  }
  // Names are unique per club per match — renaming onto an existing teammate is a mistake.
  if (newName !== undefined && newName !== row.playerName) {
    const [clash] = await db
      .select({ id: leaguePlayerStatsTable.id })
      .from(leaguePlayerStatsTable)
      .where(and(
        eq(leaguePlayerStatsTable.seasonId, row.seasonId),
        eq(leaguePlayerStatsTable.matchId, row.matchId),
        eq(leaguePlayerStatsTable.club, row.club ?? ""),
        eq(leaguePlayerStatsTable.playerName, newName),
      ));
    if (clash) {
      res.status(409).json({ error: `"${newName}" is already saved for ${row.club} in this match` });
      return;
    }
  }

  const focusClub = await focusClubForRequest(req, row.seasonId);

  // Status invariant: a starter always counts as an appearance. Check against
  // the row's final (merged) values so partial patches can't sneak in an
  // impossible combination.
  const finalStarted = edit.started ?? row.started ?? false;
  const finalAppearance = edit.appearance ?? row.appearance ?? false;
  if (finalStarted && !finalAppearance) {
    res.status(400).json({ error: "A player who started must also count as an appearance" });
    return;
  }

  const patch: { playerName?: string; minsPlayed?: number | null; position?: string | null; started?: boolean; appearance?: boolean } = {};
  if (newName !== undefined) patch.playerName = newName;
  if (edit.minsPlayed !== undefined) patch.minsPlayed = edit.minsPlayed;
  if (edit.position !== undefined) patch.position = edit.position === null ? null : edit.position.trim() || null;
  if (edit.started !== undefined) patch.started = edit.started;
  if (edit.appearance !== undefined) patch.appearance = edit.appearance;

  const belconnenUpdated = await db.transaction(async (tx) => {
    await tx.update(leaguePlayerStatsTable).set(patch).where(eq(leaguePlayerStatsTable.id, rowId));

    const [fixture] = await tx
      .select()
      .from(leagueMatchesTable)
      .where(and(eq(leagueMatchesTable.matchId, row.matchId), eq(leagueMatchesTable.seasonId, row.seasonId!)));
    if (!fixture || (fixture.homeTeam !== focusClub && fixture.awayTeam !== focusClub)) return false;

    const matchRows = await tx
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(and(eq(matchesTable.matchId, row.matchId), eq(matchesTable.seasonId, row.seasonId!)));
    if (matchRows.length === 0) return false;

    // Locate the legacy copy by matching every mirrored field against the row's
    // OLD values (null-safe), same as the delete route — exact duplicates only.
    const nullSafe = <T extends AnyColumn>(col: T, val: unknown) =>
      val == null ? isNull(col) : eq(col, val as never);
    const candidates = await tx
      .select({ id: playerStatsTable.id })
      .from(playerStatsTable)
      .where(and(
        inArray(playerStatsTable.matchId, matchRows.map(m => m.id)),
        eq(playerStatsTable.playerName, row.playerName),
        nullSafe(playerStatsTable.club, row.club),
        nullSafe(playerStatsTable.minsPlayed, row.minsPlayed),
        nullSafe(playerStatsTable.position, row.position),
        nullSafe(playerStatsTable.discipline, row.discipline),
        nullSafe(playerStatsTable.started, row.started),
        nullSafe(playerStatsTable.appearance, row.appearance),
      ));
    if (candidates.length === 0) {
      logger.warn({ leagueRowId: rowId, matchId: row.matchId }, "No matching Belconnen player-stats copy found to edit");
      return false;
    }
    await tx.update(playerStatsTable).set(patch).where(eq(playerStatsTable.id, candidates[0].id));
    return true;
  });

  res.json(UpdateEntryPlayerStatResponse.parse({ updated: true, belconnenUpdated }));
});

// ── Delete one saved player row (league row + Belconnen mirror copy) ─────────
router.delete("/entry/player-stat/:rowId", async (req, res): Promise<void> => {
  const rowId = Number(req.params.rowId);
  if (!Number.isInteger(rowId)) {
    res.status(400).json({ error: "Invalid row id" });
    return;
  }
  const [row] = await db.select().from(leaguePlayerStatsTable).where(eq(leaguePlayerStatsTable.id, rowId));
  if (!row) {
    res.status(404).json({ error: "That player row is already gone" });
    return;
  }
  if (row.seasonId == null) {
    res.status(400).json({ error: "Row has no season — cannot safely mirror-delete" });
    return;
  }
  if (!(await canEnterDataForSeason(req, row.seasonId))) {
    res.status(403).json({ error: "You don't have data entry access for this league" });
    return;
  }

  const focusClub = await focusClubForRequest(req, row.seasonId);

  // Single transaction: remove the league row + its legacy Belconnen mirror together.
  // The mirror is keyed by playerName+club within the fixture's matches partitions —
  // player names are unique per club per match (enforced on save), so this is exact.
  const belconnenDeleted = await db.transaction(async (tx) => {
    await tx.delete(leaguePlayerStatsTable).where(eq(leaguePlayerStatsTable.id, rowId));

    const [fixture] = await tx
      .select()
      .from(leagueMatchesTable)
      .where(and(eq(leagueMatchesTable.matchId, row.matchId), eq(leagueMatchesTable.seasonId, row.seasonId!)));
    if (!fixture || (fixture.homeTeam !== focusClub && fixture.awayTeam !== focusClub)) return false;

    const matchRows = await tx
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(and(eq(matchesTable.matchId, row.matchId), eq(matchesTable.seasonId, row.seasonId!)));
    if (matchRows.length === 0) return false;

    // Match the legacy copy on EVERY mirrored field (null-safe) so we can only
    // ever hit exact duplicates of the deleted league row — never a different one.
    const nullSafe = <T extends AnyColumn>(col: T, val: unknown) =>
      val == null ? isNull(col) : eq(col, val as never);
    const candidates = await tx
      .select({ id: playerStatsTable.id })
      .from(playerStatsTable)
      .where(and(
        inArray(playerStatsTable.matchId, matchRows.map(m => m.id)),
        eq(playerStatsTable.playerName, row.playerName),
        nullSafe(playerStatsTable.club, row.club),
        nullSafe(playerStatsTable.minsPlayed, row.minsPlayed),
        nullSafe(playerStatsTable.position, row.position),
        nullSafe(playerStatsTable.discipline, row.discipline),
        nullSafe(playerStatsTable.started, row.started),
        nullSafe(playerStatsTable.appearance, row.appearance),
      ));
    if (candidates.length === 0) {
      logger.warn({ leagueRowId: rowId, matchId: row.matchId }, "No matching Belconnen player-stats copy found to delete");
      return false;
    }
    // Exact-duplicate copies are interchangeable — deleting any one of them is correct
    await tx.delete(playerStatsTable).where(eq(playerStatsTable.id, candidates[0].id));
    return true;
  });

  res.json(DeleteEntryPlayerStatResponse.parse({ deleted: true, belconnenDeleted }));
});

// ── AI screenshot reader ──────────────────────────────────────────────────────
// Sends the Dribl team-sheet screenshot to a vision model and returns rows for
// the coach to review — nothing is saved here.
router.post("/entry/extract-players", async (req, res): Promise<void> => {
  const parsed = ExtractPlayersFromImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "Screenshot reader is not configured on this server (no AI credentials). Enter rows manually." });
    return;
  }

  const raw = parsed.data.imageBase64;
  const dataUrl = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;

  // Naming convention is per league (leagues.name_format). Coach's ongoing
  // standard (2026-07) is "S.Smith" — the default for every league unless the
  // league explicitly says 'surname' (NPLW + Reserves keep their existing
  // surname-only history).
  let nameFormat: string | null = "initial-surname";
  if (parsed.data.leagueId != null) {
    const [league] = await db.select({ nameFormat: leaguesTable.nameFormat })
      .from(leaguesTable).where(eq(leaguesTable.id, parsed.data.leagueId));
    nameFormat = league?.nameFormat ?? "initial-surname";
  }
  const nameRule = nameFormat === "initial-surname"
    ? "- playerName: return FIRST-INITIAL DOT SURNAME, e.g. \"S.Smith\" — capital first initial, a dot, no space, then the surname. For hyphenated or multi-word surnames keep the full surname (e.g. \"J.Smith-Jones\", \"P.van Dyk\"). If no first name or initial is visible, return the surname alone and add a warning naming the player."
    : "- playerName: return the SURNAME ONLY, e.g. \"Bloggs\" — even when a first name or initial is visible, drop it. For hyphenated or multi-word surnames keep the full surname (e.g. \"Smith-Jones\", \"van Dyk\"). If two players share a surname, keep the first-initial prefix for both (e.g. \"J.Bloggs\", \"K.Bloggs\") and add a warning naming them.";

  const prompt = [
    "You are reading a screenshot of a football (soccer) team sheet from the Dribl app or a similar match-day listing.",
    parsed.data.club ? `The screenshot is the team sheet for the club "${parsed.data.club}".` : "",
    "Extract EVERY player row you can see and return STRICT JSON only (no markdown, no commentary) in this exact shape:",
    `{"rows":[{"playerName":"...","minsPlayed":90,"position":"GK","discipline":null,"started":true,"appearance":true}],"warnings":["..."]}`,
    "Rules:",
    nameRule,
    "- minsPlayed: compute from the substitution icons next to each player. Dribl shows a RED circular arrow with a minute (e.g. 46') when a player CAME OFF, and a GREEN circular arrow with a minute when a player CAME ON. Apply these rules:",
    "  * Starting lineup, no icons: played the full match — minsPlayed 90.",
    "  * Starting lineup, red icon only: started and was subbed off — minsPlayed = the red minute (e.g. red 32' = 32).",
    "  * Bench, green icon only: came on and finished the match — minsPlayed = 90 minus the green minute (e.g. green 70' = 20).",
    "  * Bench, BOTH green and red icons: came on at the green minute and off at the red minute — minsPlayed = red minus green (e.g. green 32' and red 70' = 38).",
    "  * Cap everything at 90: treat any minute over 90 (stoppage time like 92') as 90 before calculating. A red 92' on a starter = 90 minutes.",
    "  * Bench player with no icons: did not play — minsPlayed 0, appearance false.",
    "  * Bench player WITH a green icon always took the field — appearance true, even when the capped calculation gives 0 minutes (e.g. came on at 92').",
    "  * A ball icon means a goal — ignore it for minutes.",
    "  * If minutes are printed directly as a number of minutes played, use that instead. Never guess beyond these rules.",
    "- position: the position shown, mapped to one of exactly: GK, LB, RB, CB, LWB, RWB, DM, CM, AM, LM, RM, LW, RW, ST, F. Otherwise null.",
    "- discipline: card info if shown (e.g. \"Yellow\", \"Red\"), otherwise null.",
    "- started: true if the player is in the starting lineup section, false if listed as a substitute/bench.",
    "- appearance: true if the player actually took the field (starters, and substitutes shown as having come on). Unused bench players: appearance false.",
    "- If the screenshot distinguishes starters from bench, use it. If it does not, set started=true for the first 11 and add a warning.",
    "- Add a warning for anything unreadable, ambiguous, cut off, or any duplicate names.",
  ].filter(Boolean).join("\n");

  try {
    const aiRes = await fetch(`${baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-5.4",
        max_completion_tokens: 8192,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
      }),
    });
    if (!aiRes.ok) {
      const text = await aiRes.text();
      logger.error({ status: aiRes.status, text: text.slice(0, 500) }, "AI extraction request failed");
      res.status(502).json({ error: "The screenshot reader had a problem — try again, or enter rows manually" });
      return;
    }
    const payload = await aiRes.json() as { choices?: { message?: { content?: string } }[] };
    let content = payload.choices?.[0]?.message?.content ?? "";
    content = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const extracted = JSON.parse(content) as { rows?: unknown[]; warnings?: unknown[] };

    const result = ExtractPlayersFromImageResponse.safeParse({
      rows: (extracted.rows ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        return {
          playerName: String(row.playerName ?? "").trim(),
          minsPlayed: typeof row.minsPlayed === "number" && Number.isFinite(row.minsPlayed)
            ? Math.max(0, Math.min(130, Math.round(row.minsPlayed))) : null,
          position: typeof row.position === "string" && row.position.trim() ? row.position.trim() : null,
          discipline: typeof row.discipline === "string" && row.discipline.trim() ? row.discipline.trim() : null,
          started: row.started === true,
          appearance: row.appearance !== false,
        };
      }).filter(r => r.playerName.length > 0),
      warnings: (extracted.warnings ?? []).map(w => String(w)).slice(0, 20),
    });
    if (!result.success) {
      res.status(502).json({ error: "The screenshot reader returned an unexpected shape — try again" });
      return;
    }
    res.json(result.data);
  } catch (err) {
    logger.error({ err }, "AI extraction failed");
    res.status(502).json({ error: "Could not read the screenshot — try a clearer image, or enter rows manually" });
  }
});

// ── AI club finder ────────────────────────────────────────────────────────────
// Reads a ladder/fixture screenshot (or works from the league name alone) and
// returns the club list with short display names, brand colours and logo URLs
// for the coach to review — nothing is saved here. Logo URLs are verified
// server-side (must actually serve an image) before being returned.

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// SSRF guard: logoUrl values come from model output (which could be prompt-
// injected via the screenshot), so the server only ever fetches from a short
// allowlist of known logo hosts, over HTTPS, and re-validates every redirect
// hop against the same policy. Anything else is dropped (the coach can still
// paste any URL in the UI — the browser, not the server, loads that one).
const LOGO_HOST_ALLOWLIST = new Set([
  "upload.wikimedia.org",
  "commons.wikimedia.org",
  "en.wikipedia.org",
]);

/** True when the URL is HTTPS and on an allowlisted logo host. */
export function isAllowedLogoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && LOGO_HOST_ALLOWLIST.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function verifyLogoUrl(url: string): Promise<boolean> {
  let current = url;
  for (let hop = 0; hop < 3; hop++) {
    if (!isAllowedLogoUrl(current)) return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(current, {
          method: "GET",
          redirect: "manual", // every hop re-checked against the allowlist above
          signal: controller.signal,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; BUFC-Hub club setup)" },
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) return false;
          current = new URL(loc, current).toString();
          continue;
        }
        if (!res.ok) return false;
        const type = res.headers.get("content-type") ?? "";
        // Read nothing further — the headers are enough
        void res.body?.cancel().catch(() => undefined);
        return type.startsWith("image/");
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return false;
    }
  }
  return false; // too many redirects
}

/** Look a club's crest up on Wikipedia (page image of the best-matching article).
 * Wikipedia rate-limits aggressively — call this SEQUENTIALLY, never in parallel. */
async function wikipediaLogoLookup(clubName: string, attempt = 0): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const url = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({
        action: "query",
        generator: "search",
        gsrsearch: `${clubName} football club`,
        gsrlimit: "3",
        prop: "pageimages",
        piprop: "original|thumbnail",
        pithumbsize: "400",
        pilicense: "any", // club crests are usually non-free images — include them
        format: "json",
        origin: "*",
      }).toString();
      const wikiRes = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "BUFC-Hub club setup (contact: app admin)" },
      });
      if (wikiRes.status === 429 && attempt < 2) {
        await sleep(1500 * (attempt + 1));
        return wikipediaLogoLookup(clubName, attempt + 1);
      }
      if (!wikiRes.ok) return null;
      const data = await wikiRes.json() as {
        query?: { pages?: Record<string, {
          index?: number; title?: string;
          original?: { source?: string }; thumbnail?: { source?: string };
        }> };
      };
      const pages = Object.values(data.query?.pages ?? {}).sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
      // Take the best-ranked page whose title shares a distinctive word with the
      // club name and has a page image. Prefer the thumbnail (PNG-rendered, so
      // SVG crests still display everywhere) over the original.
      const stop = new Set(["the", "and", "united", "football", "club", "soccer"]);
      const words = clubName.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !stop.has(w));
      for (const p of pages) {
        const title = (p.title ?? "").toLowerCase();
        const src = p.thumbnail?.source ?? p.original?.source;
        if (src && words.some(w => title.includes(w))) return src;
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

router.post("/entry/extract-clubs", async (req, res): Promise<void> => {
  const parsed = ExtractClubsFromLeagueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;

  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "The club finder is not configured on this server (no AI credentials). Add clubs manually." });
    return;
  }

  const [league] = await db.select({ name: leaguesTable.name, region: leaguesTable.region })
    .from(leaguesTable).where(eq(leaguesTable.id, b.leagueId));
  const leagueLabel = (b.leagueName?.trim() || league?.name || "").trim();
  if (!b.imageBase64 && !leagueLabel) {
    res.status(400).json({ error: "Give me a ladder screenshot or a league name to work from" });
    return;
  }

  // When the league maps to Dribl, pull the definitive club list from the
  // official fixtures feed for THIS season — the AI then only fills in short
  // names, colours and logos instead of guessing (which can drift to an older
  // season's line-up).
  let driblClubs: string[] | null = null;
  if (!b.imageBase64 && leagueLabel) {
    const [latestSeason] = await db.select({ year: seasonsTable.year })
      .from(seasonsTable).where(eq(seasonsTable.leagueId, b.leagueId))
      .orderBy(desc(seasonsTable.year)).limit(1);
    const year = latestSeason?.year ?? String(new Date().getFullYear());
    driblClubs = await driblClubNamesFor(leagueLabel, year);
  }

  const prompt = [
    "You are helping set up an Australian football (soccer) league in a club analytics app.",
    b.imageBase64
      ? "Attached is a screenshot of a league ladder or fixture list. Extract EVERY club you can see in it."
      : driblClubs
        ? `The definitive club list for "${leagueLabel}" this season, straight from the official fixtures feed, is:\n${driblClubs.map(n => `- ${n}`).join("\n")}\nUse EXACTLY these clubs — one entry per club, no additions, no omissions. Your job is only the short display name, colours and logo for each.`
        : `List every club competing in this league: "${leagueLabel}"${league?.region ? ` (region: ${league.region})` : ""}. Only include clubs you are confident about; if you are not sure of the exact club list, include the ones you know and add a warning saying the list may be incomplete.`,
    leagueLabel && b.imageBase64 ? `The league is "${leagueLabel}"${league?.region ? ` (region: ${league.region})` : ""}.` : "",
    "Return STRICT JSON only (no markdown, no commentary) in this exact shape:",
    `{"clubs":[{"name":"Monaro","fullName":"Monaro Panthers FC","primaryColor":"#e31b23","logoUrl":"https://..."}],"warnings":["..."]}`,
    "Rules:",
    "- name: a SHORT display name — the single distinctive word or pair of words a coach would say, e.g. \"Monaro\" not \"Monaro Panthers FC All Age Men\", \"Belconnen\" not \"Belconnen United FC\", \"West Canberra\" not \"West Canberra Wanderers SC\". Strip FC/SC/United/Wanderers-style suffixes and any age/division wording unless needed to tell two clubs apart.",
    "- fullName: the club's full official name as written by the league.",
    "- primaryColor: the club's main real-world kit/brand colour as a 6-digit hex code like \"#005baa\". Use your knowledge of the club; if genuinely unknown, use \"#888888\" and add a warning naming the club.",
    "- logoUrl: a direct, publicly reachable URL to the club's crest/logo IMAGE file (png/svg/jpg) — for example a Wikipedia/Wikimedia upload URL. Only give a URL you are confident is real; otherwise use null. Never invent URLs.",
    "- One entry per club — no duplicates, no divisions of the same club listed twice.",
    "- Add a warning for anything unreadable, ambiguous or uncertain.",
  ].filter(Boolean).join("\n");

  const content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] =
    [{ type: "text", text: prompt }];
  if (b.imageBase64) {
    const raw = b.imageBase64;
    content.push({ type: "image_url", image_url: { url: raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}` } });
  }

  try {
    const aiRes = await fetch(`${baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-5.4",
        max_completion_tokens: 8192,
        messages: [{ role: "user", content }],
      }),
    });
    if (!aiRes.ok) {
      const text = await aiRes.text();
      logger.error({ status: aiRes.status, text: text.slice(0, 500) }, "AI club extraction request failed");
      res.status(502).json({ error: "The club finder had a problem — try again, or add clubs manually" });
      return;
    }
    const payload = await aiRes.json() as { choices?: { message?: { content?: string } }[] };
    let text = payload.choices?.[0]?.message?.content ?? "";
    text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const extracted = JSON.parse(text) as { clubs?: unknown[]; warnings?: unknown[] };

    const warnings = (extracted.warnings ?? []).map(w => String(w)).slice(0, 20);
    const seen = new Set<string>();
    const clubs = (extracted.clubs ?? []).map((c) => {
      const club = c as Record<string, unknown>;
      const hex = typeof club.primaryColor === "string" && /^#[0-9a-fA-F]{6}$/.test(club.primaryColor.trim())
        ? club.primaryColor.trim().toLowerCase() : "#888888";
      return {
        name: String(club.name ?? "").trim(),
        fullName: typeof club.fullName === "string" && club.fullName.trim() ? club.fullName.trim() : null,
        primaryColor: hex,
        logoUrl: typeof club.logoUrl === "string" && /^https?:\/\//.test(club.logoUrl.trim()) ? club.logoUrl.trim() : null,
      };
    }).filter(c => {
      if (!c.name) return false;
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Verify every suggested logo actually serves an image; for the ones the AI
    // couldn't source (or that fail), fall back to a Wikipedia crest lookup.
    // Sequential on purpose: Wikipedia 429s parallel bursts.
    for (const c of clubs) {
      if (c.logoUrl && !(await verifyLogoUrl(c.logoUrl))) c.logoUrl = null;
      if (!c.logoUrl) {
        const wiki = await wikipediaLogoLookup(c.fullName ?? c.name);
        if (wiki && (await verifyLogoUrl(wiki))) c.logoUrl = wiki;
        await sleep(250);
      }
      if (!c.logoUrl) warnings.push(`Couldn't find a logo for ${c.name} — paste a URL in if you have one`);
    }

    const result = ExtractClubsFromLeagueResponse.safeParse({ clubs, warnings: warnings.slice(0, 25) });
    if (!result.success) {
      res.status(502).json({ error: "The club finder returned an unexpected shape — try again" });
      return;
    }
    res.json(result.data);
  } catch (err) {
    logger.error({ err }, "AI club extraction failed");
    res.status(502).json({ error: "Could not work out the club list — try a clearer screenshot, or add clubs manually" });
  }
});

// ── Fill in logos/colours for a league's EXISTING clubs ──────────────────────
// Same Wikipedia + AI lookup as the club finder, but keyed to the clubs already
// saved. Returns suggestions only — the coach reviews, then PATCH /clubs/:id.
router.post("/entry/fill-club-branding", async (req, res): Promise<void> => {
  const parsed = FillClubBrandingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { leagueId } = parsed.data;

  const clubs = await db.select().from(clubsTable)
    .where(eq(clubsTable.leagueId, leagueId)).orderBy(clubsTable.name);
  if (clubs.length === 0) {
    res.status(404).json({ error: "No clubs saved in this league yet — use the club finder to add them" });
    return;
  }

  const [league] = await db.select({ name: leaguesTable.name, region: leaguesTable.region })
    .from(leaguesTable).where(eq(leaguesTable.id, leagueId));

  const warnings: string[] = [];
  // AI pass: real kit colours + any logo URLs it is confident about (optional —
  // without credentials we still do the Wikipedia lookup below).
  const aiByName = new Map<string, { primaryColor: string | null; logoUrl: string | null }>();
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (apiKey) {
    try {
      const prompt = [
        "You are helping fill in branding for Australian football (soccer) clubs in an analytics app.",
        `These clubs play in the league "${league?.name ?? ""}"${league?.region ? ` (region: ${league.region})` : ""}:`,
        clubs.map(c => `- ${c.name}`).join("\n"),
        "For EACH club above, return its real-world branding. Return STRICT JSON only (no markdown) in this exact shape:",
        `{"clubs":[{"name":"<exactly as listed above>","primaryColor":"#e31b23","logoUrl":"https://..."}],"warnings":["..."]}`,
        "Rules:",
        "- name: copy the club name EXACTLY as listed — it is the lookup key.",
        "- primaryColor: the club's main real-world kit/brand colour as a 6-digit hex code. If genuinely unknown, use null and add a warning naming the club.",
        "- logoUrl: a direct, publicly reachable URL to the club's crest IMAGE file (png/svg/jpg), e.g. a Wikipedia/Wikimedia upload URL. Only give a URL you are confident is real; otherwise null. Never invent URLs.",
      ].join("\n");
      const aiRes = await fetch(`${baseUrl ?? "https://api.openai.com/v1"}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-5.4",
          max_completion_tokens: 8192,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (aiRes.ok) {
        const payload = await aiRes.json() as { choices?: { message?: { content?: string } }[] };
        let text = payload.choices?.[0]?.message?.content ?? "";
        text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const extracted = JSON.parse(text) as { clubs?: unknown[]; warnings?: unknown[] };
        for (const w of (extracted.warnings ?? []).slice(0, 10)) warnings.push(String(w));
        for (const raw of extracted.clubs ?? []) {
          const c = raw as Record<string, unknown>;
          const name = String(c.name ?? "").trim().toLowerCase();
          if (!name) continue;
          const hex = typeof c.primaryColor === "string" && /^#[0-9a-fA-F]{6}$/.test(c.primaryColor.trim())
            ? c.primaryColor.trim().toLowerCase() : null;
          const url = typeof c.logoUrl === "string" && /^https?:\/\//.test(c.logoUrl.trim()) ? c.logoUrl.trim() : null;
          aiByName.set(name, { primaryColor: hex, logoUrl: url });
        }
      } else {
        logger.warn({ status: aiRes.status }, "AI branding lookup failed — falling back to Wikipedia only");
        warnings.push("The AI colour lookup had a problem — logos come from Wikipedia only this time");
      }
    } catch (err) {
      logger.warn({ err }, "AI branding lookup failed — falling back to Wikipedia only");
      warnings.push("The AI colour lookup had a problem — logos come from Wikipedia only this time");
    }
  }

  // Logo pass — sequential on purpose: Wikipedia 429s parallel bursts.
  const suggestions = [];
  for (const club of clubs) {
    const ai = aiByName.get(club.name.trim().toLowerCase());
    let logoUrl = ai?.logoUrl ?? null;
    if (logoUrl && !(await verifyLogoUrl(logoUrl))) logoUrl = null;
    if (!logoUrl && !club.logoUrl) {
      // Short saved names ("Croatia", "Wanderers") are ambiguous on Wikipedia —
      // add the league's region so the search lands on the local club.
      const wiki = await wikipediaLogoLookup([club.name, league?.region].filter(Boolean).join(" "));
      if (wiki && (await verifyLogoUrl(wiki))) logoUrl = wiki;
      await sleep(250);
    }
    if (!logoUrl && !club.logoUrl) warnings.push(`Couldn't find a logo for ${club.name} — paste a URL in if you have one`);
    suggestions.push({
      clubId: club.id,
      name: club.name,
      currentColor: club.primaryColor,
      currentLogoUrl: club.logoUrl ?? null,
      primaryColor: ai?.primaryColor ?? null,
      logoUrl,
    });
  }

  const result = FillClubBrandingResponse.safeParse({ suggestions, warnings: warnings.slice(0, 25) });
  if (!result.success) {
    res.status(502).json({ error: "The branding lookup returned an unexpected shape — try again" });
    return;
  }
  res.json(result.data);
});

// ── Athletic testing bulk save (trainer's spreadsheet) ───────────────────────
// Replace-semantics per year+team: clears that year's results and inserts the
// uploaded rows, so re-uploading a corrected spreadsheet just works.
router.post("/entry/athletic-tests", async (req, res): Promise<void> => {
  const parsed = SaveEntryAthleticTestsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { leagueId, year, teamId, rows } = parsed.data;

  const cleanRows = rows
    .map(r => ({ ...r, playerName: r.playerName.trim() }))
    .filter(r => r.playerName.length > 0 && !/^averages?$/i.test(r.playerName));
  if (cleanRows.length === 0) {
    res.status(400).json({ error: "No player rows to save" });
    return;
  }

  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const r of cleanRows) {
    const key = r.playerName.toLowerCase();
    if (seen.has(key)) dupes.add(r.playerName);
    seen.add(key);
  }
  if (dupes.size > 0) {
    res.status(400).json({ error: `The file lists ${[...dupes].join(", ")} more than once — fix the duplicate row(s) and re-upload` });
    return;
  }

  // Best-effort link to the players table by exact name (nice-to-have; charts key off playerName).
  // This endpoint is season-agnostic (keyed by year+team, no seasonId), so the focus club can't be
  // resolved per-league here — retain the ACT NPLW default. Athletic tests are Belconnen-only today.
  const knownPlayers = await db
    .select({ id: playersTable.id, name: playersTable.name })
    .from(playersTable)
    .where(eq(playersTable.club, "Belconnen"));
  const idByName = new Map(knownPlayers.map(p => [p.name.toLowerCase(), p.id]));

  const { saved, replaced } = await db.transaction(async (tx) => {
    const replaced = (await tx
      .delete(athleticTestsTable)
      .where(and(eq(athleticTestsTable.leagueId, leagueId), eq(athleticTestsTable.year, year), eq(athleticTestsTable.teamId, teamId)))
      .returning({ id: athleticTestsTable.id })).length;

    const inserted = await tx.insert(athleticTestsTable).values(cleanRows.map(r => ({
      leagueId,
      playerId: idByName.get(r.playerName.toLowerCase()) ?? null,
      playerName: r.playerName,
      teamId,
      year,
      position: r.position ?? null,
      verticalStart: n2s(r.verticalStart),
      verticalM: n2s(r.verticalM),
      verticalTotal: n2s(r.verticalTotal),
      horizontalM: n2s(r.horizontalM),
      balsomS: n2s(r.balsomS),
      split010: n2s(r.split010),
      split1020: n2s(r.split1020),
      split2030: n2s(r.split2030),
      total30m: n2s(r.total30m),
    }))).returning({ id: athleticTestsTable.id });

    return { saved: inserted.length, replaced };
  });

  res.json(SaveEntryAthleticTestsResponse.parse({ saved, replaced }));
});

// ── GPS fixture picker ────────────────────────────────────────────────────────
// Known fixtures for the GPS upload form: this league's own games (1sts) plus
// the games of any league that reads its GPS from this one (e.g. the Reserves
// feed league). Picking a Reserves fixture lets the form stamp the R#-res
// round the feed relies on.

/** Fixture match_date arrives as free text ("2026/07/25", "25/07/2026", ISO…) — normalise to YYYY-MM-DD where possible. */
function fixtureDateIso(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

router.get("/entry/gps-fixtures", async (req, res): Promise<void> => {
  const query = ListEntryGpsFixturesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { leagueId } = query.data;

  const leagues = await db.select().from(leaguesTable);
  const mine = leagues.find(l => l.id === leagueId);
  if (!mine) {
    res.status(404).json({ error: "League not found" });
    return;
  }
  // Squad per league: the GPS league itself is the 1sts; leagues fed from it
  // (leagues.gps_source_league_id) carry their configured squad label.
  const squadOfLeague = new Map<number, string>([[mine.id, "1sts"]]);
  for (const l of leagues) {
    if (l.gpsSourceLeagueId === mine.id && l.gpsSourceSquad) squadOfLeague.set(l.id, l.gpsSourceSquad);
  }

  const seasons = await db.select().from(seasonsTable)
    .where(inArray(seasonsTable.leagueId, [...squadOfLeague.keys()]));
  if (!seasons.length) {
    res.json(ListEntryGpsFixturesResponse.parse([]));
    return;
  }
  const seasonInfo = new Map(seasons.map(s => [s.id, { year: s.year, squad: squadOfLeague.get(s.leagueId)! }]));

  const fixtures = await db.select().from(matchesTable)
    .where(inArray(matchesTable.seasonId, [...seasonInfo.keys()]));

  const out = fixtures.flatMap(f => {
    const info = seasonInfo.get(f.seasonId);
    if (!info) return [];
    const rd = /^(R\d+)(?:$|-)/i.exec(f.matchId ?? "");
    if (!rd) return [];
    return [{
      round: rd[1].toUpperCase(),
      opponent: f.opponent,
      matchDate: f.matchDate,
      matchDateIso: fixtureDateIso(f.matchDate),
      year: info.year,
      squad: info.squad,
    }];
  });
  const roundNum = (r: string) => Number(r.slice(1)) || 0;
  const squadRank = (s: string) => (s === "1sts" ? 0 : 1);
  out.sort((a, b) =>
    b.year.localeCompare(a.year) ||
    roundNum(b.round) - roundNum(a.round) ||
    squadRank(a.squad) - squadRank(b.squad));
  res.json(ListEntryGpsFixturesResponse.parse(out));
});

// ── GPS match upload (Catapult CSV) ──────────────────────────────────────────
// Replace-semantics per (year, round): re-uploading a corrected CSV for a
// round cleanly replaces every row previously saved for that round.
router.post("/entry/gps-sessions", async (req, res): Promise<void> => {
  const parsed = SaveEntryGpsSessionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { leagueId, year, teamId, round, opponent, sessionDate, sessionTitle, rows } = parsed.data;

  // Feed leagues (leagues.gps_source_league_id) share another league's GPS
  // rows read-only — uploading into them would create the very duplication
  // the feed exists to avoid.
  const [feedLeague] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId)).limit(1);
  if (feedLeague?.gpsSourceLeagueId) {
    res.status(400).json({ error: "This league's GPS data is fed from another league — upload GPS data there instead" });
    return;
  }

  const cleanRows = rows
    .map(r => ({ ...r, playerName: r.playerName.trim() }))
    .filter(r => r.playerName.length > 0);
  if (cleanRows.length === 0) {
    res.status(400).json({ error: "No player rows to save" });
    return;
  }

  const { saved, replaced } = await db.transaction(async (tx) => {
    const replaced = (await tx
      .delete(gpsSessionsTable)
      .where(and(
        eq(gpsSessionsTable.leagueId, leagueId),
        eq(gpsSessionsTable.year, year),
        eq(gpsSessionsTable.round, round),
        eq(gpsSessionsTable.teamId, teamId),
      ))
      .returning({ id: gpsSessionsTable.id })).length;

    const inserted = await tx.insert(gpsSessionsTable).values(cleanRows.map(r => ({
      leagueId,
      playerName: r.playerName,
      playerId: null,
      teamId,
      year,
      round,
      opponent: opponent ?? null,
      sessionDate: sessionDate ?? null,
      sessionTitle: sessionTitle ?? null,
      splitName: r.splitName ?? null,
      tags: "game", // match uploads are always game rows — charts filter on this
      minsPlayed: n2s(r.minsPlayed),
      distanceKm: n2s(r.distanceKm),
      sprintDistanceM: n2s(r.sprintDistanceM),
      powerPlays: n2s(r.powerPlays),
      energyKcal: n2s(r.energyKcal),
      impacts: n2s(r.impacts),
      hrLoad: n2s(r.hrLoad),
      timeInRedZoneMin: n2s(r.timeInRedZoneMin),
      playerLoad: n2s(r.playerLoad),
      topSpeedMs: n2s(r.topSpeedMs),
      distancePerMinMm: n2s(r.distancePerMinMm),
      powerScoreWkg: n2s(r.powerScoreWkg),
      workRatio: n2s(r.workRatio),
      hrMaxBpm: n2s(r.hrMaxBpm),
      maxDecelerationMss: n2s(r.maxDecelerationMss),
      maxAccelerationMss: n2s(r.maxAccelerationMss),
      distanceZone1Km: n2s(r.distanceZone1Km),
      distanceZone2Km: n2s(r.distanceZone2Km),
      distanceZone3Km: n2s(r.distanceZone3Km),
      distanceZone4Km: n2s(r.distanceZone4Km),
      distanceZone5Km: n2s(r.distanceZone5Km),
      accelCount34: n2s(r.accelCount34),
      accelCountOver4: n2s(r.accelCountOver4),
      decelCount34: n2s(r.decelCount34),
      decelCountOver4: n2s(r.decelCountOver4),
    }))).returning({ id: gpsSessionsTable.id });

    return { saved: inserted.length, replaced };
  });

  logger.info({ year, round, saved, replaced }, "gps sessions saved");
  res.json(SaveEntryGpsSessionsResponse.parse({ saved, replaced }));
});

// ── GPS upload management ────────────────────────────────────────────────────
// A "upload" (batch) = every gps_sessions row saved for one (league, year,
// round, team) — the same predicate the replace-on-upload uses. There is no
// batch id column, so the four keys ARE the batch identity.

/** Squad label from the Catapult round suffix — mirrors gpsSessions.ts / frontend. */
function squadOfRoundEntry(round: string | null | undefined): string {
  if (!round) return "1sts";
  if (/-(res|r)$/i.test(round)) return "Reserves";
  if (/-1[78]s$/i.test(round)) return "17s / 18s";
  return "1sts";
}

/** Feed leagues are read-only — all upload management happens in the source league. */
async function rejectGpsFeedLeague(leagueId: number, res: Parameters<Parameters<IRouter["get"]>[1]>[1]): Promise<boolean> {
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId)).limit(1);
  if (league?.gpsSourceLeagueId) {
    res.status(400).json({ error: "This league's GPS data is fed from another league — manage uploads there instead" });
    return true;
  }
  return false;
}

router.get("/entry/gps-uploads", async (req, res): Promise<void> => {
  const query = ListEntryGpsUploadsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { leagueId } = query.data;

  const rows = await db.select({
    year: gpsSessionsTable.year,
    round: gpsSessionsTable.round,
    teamId: gpsSessionsTable.teamId,
    opponent: gpsSessionsTable.opponent,
    sessionDate: gpsSessionsTable.sessionDate,
    sessionTitle: gpsSessionsTable.sessionTitle,
    players: sql<number>`count(distinct ${gpsSessionsTable.playerName})::int`,
    rows: sql<number>`count(*)::int`,
  })
    .from(gpsSessionsTable)
    .where(eq(gpsSessionsTable.leagueId, leagueId))
    .groupBy(
      gpsSessionsTable.year, gpsSessionsTable.round, gpsSessionsTable.teamId,
      gpsSessionsTable.opponent, gpsSessionsTable.sessionDate, gpsSessionsTable.sessionTitle,
    );

  // Round number only from a leading R# — "CS-18s" must not pick up the squad's 18.
  const roundNum = (r: string | null) => Number(/^R(\d+)/i.exec(r ?? "")?.[1]) || 0;
  const out = rows
    .map(r => ({
      year: r.year ?? "",
      round: r.round ?? "",
      squad: squadOfRoundEntry(r.round),
      teamId: r.teamId ?? 0,
      opponent: r.opponent,
      sessionDate: r.sessionDate,
      sessionTitle: r.sessionTitle,
      players: r.players,
      rows: r.rows,
    }))
    .sort((a, b) =>
      b.year.localeCompare(a.year) ||
      roundNum(b.round) - roundNum(a.round) ||
      a.squad.localeCompare(b.squad));
  res.json(ListEntryGpsUploadsResponse.parse(out));
});

router.patch("/entry/gps-uploads", async (req, res): Promise<void> => {
  const parsed = UpdateEntryGpsUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { leagueId, year, round, teamId, opponent, sessionDate, sessionTitle } = parsed.data;
  if (await rejectGpsFeedLeague(leagueId, res)) return;

  // Only touch the fields the request actually carries — undefined = leave alone.
  const patch: Partial<typeof gpsSessionsTable.$inferInsert> = {};
  if (opponent !== undefined) patch.opponent = opponent;
  if (sessionDate !== undefined) patch.sessionDate = sessionDate;
  if (sessionTitle !== undefined) patch.sessionTitle = sessionTitle;
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  const updated = (await db.update(gpsSessionsTable)
    .set(patch)
    .where(and(
      eq(gpsSessionsTable.leagueId, leagueId),
      eq(gpsSessionsTable.year, year),
      eq(gpsSessionsTable.round, round),
      eq(gpsSessionsTable.teamId, teamId),
    ))
    .returning({ id: gpsSessionsTable.id })).length;
  if (updated === 0) {
    res.status(404).json({ error: "No GPS rows found for that upload" });
    return;
  }
  logger.info({ leagueId, year, round, teamId, updated }, "gps upload details updated");
  res.json(UpdateEntryGpsUploadResponse.parse({ updated }));
});

router.delete("/entry/gps-uploads", async (req, res): Promise<void> => {
  const query = DeleteEntryGpsUploadQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { leagueId, year, round, teamId } = query.data;
  if (await rejectGpsFeedLeague(leagueId, res)) return;

  const deleted = (await db.delete(gpsSessionsTable)
    .where(and(
      eq(gpsSessionsTable.leagueId, leagueId),
      eq(gpsSessionsTable.year, year),
      eq(gpsSessionsTable.round, round),
      eq(gpsSessionsTable.teamId, teamId),
    ))
    .returning({ id: gpsSessionsTable.id })).length;
  if (deleted === 0) {
    res.status(404).json({ error: "No GPS rows found for that upload" });
    return;
  }
  logger.info({ leagueId, year, round, teamId, deleted }, "gps upload deleted");
  res.json(DeleteEntryGpsUploadResponse.parse({ deleted }));
});

export default router;
