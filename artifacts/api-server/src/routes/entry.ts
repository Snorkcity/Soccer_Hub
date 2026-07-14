import { Router, type IRouter } from "express";
import { eq, and, desc, isNull, inArray, type AnyColumn } from "drizzle-orm";
import {
  db,
  leagueMatchesTable,
  leagueGoalsTable,
  leaguePlayerStatsTable,
  matchesTable,
  goalsTable,
  playerStatsTable,
  playersTable,
} from "@workspace/db";
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
  DeleteEntryPlayerStatsQueryParams,
  DeleteEntryPlayerStatsResponse,
  ExtractPlayersFromImageBody,
  ExtractPlayersFromImageResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const FOCUS_CLUB = "Belconnen";
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
    })
    .from(leagueGoalsTable)
    .where(and(eq(leagueGoalsTable.seasonId, seasonId), eq(leagueGoalsTable.matchId, matchId)))
    .orderBy(leagueGoalsTable.minuteScored, leagueGoalsTable.id);
  res.json(ListEntryGoalsResponse.parse({ goals: rows }));
});

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

  // Single transaction: remove league goal + its Belconnen copy together
  const belconnenDeleted = await db.transaction(async (tx) => {
    await tx.delete(leagueGoalsTable).where(eq(leagueGoalsTable.id, goalId));

    if (goal.homeTeam !== FOCUS_CLUB && goal.awayTeam !== FOCUS_CLUB) return false;
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
    const isHome = b.homeTeam.trim() === FOCUS_CLUB;
    const isAway = b.awayTeam.trim() === FOCUS_CLUB;
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
    if (fixture.homeTeam === FOCUS_CLUB || fixture.awayTeam === FOCUS_CLUB) {
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
    if (fixture.homeTeam === FOCUS_CLUB || fixture.awayTeam === FOCUS_CLUB) {
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
    if (fixture.homeTeam === FOCUS_CLUB || fixture.awayTeam === FOCUS_CLUB) {
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

  // Single transaction: remove the league row + its legacy Belconnen mirror together.
  // The mirror is keyed by playerName+club within the fixture's matches partitions —
  // player names are unique per club per match (enforced on save), so this is exact.
  const belconnenDeleted = await db.transaction(async (tx) => {
    await tx.delete(leaguePlayerStatsTable).where(eq(leaguePlayerStatsTable.id, rowId));

    const [fixture] = await tx
      .select()
      .from(leagueMatchesTable)
      .where(and(eq(leagueMatchesTable.matchId, row.matchId), eq(leagueMatchesTable.seasonId, row.seasonId!)));
    if (!fixture || (fixture.homeTeam !== FOCUS_CLUB && fixture.awayTeam !== FOCUS_CLUB)) return false;

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

  const prompt = [
    "You are reading a screenshot of a football (soccer) team sheet from the Dribl app or a similar match-day listing.",
    parsed.data.club ? `The screenshot is the team sheet for the club "${parsed.data.club}".` : "",
    "Extract EVERY player row you can see and return STRICT JSON only (no markdown, no commentary) in this exact shape:",
    `{"rows":[{"playerName":"...","minsPlayed":90,"position":"GK","discipline":null,"started":true,"appearance":true}],"warnings":["..."]}`,
    "Rules:",
    "- playerName: return the SURNAME ONLY, e.g. \"Bloggs\" — even when a first name or initial is visible, drop it. For hyphenated or multi-word surnames keep the full surname (e.g. \"Smith-Jones\", \"van Dyk\"). If two players share a surname, keep the first-initial prefix for both (e.g. \"J.Bloggs\", \"K.Bloggs\") and add a warning naming them.",
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

export default router;
