import { Router, type IRouter } from "express";
import { eq, and, sql, inArray, desc, ne, isNotNull } from "drizzle-orm";
import { db, matchesTable, goalsTable, playerStatsTable, gpsSessionsTable, gpsPlayerAliasesTable, teamsTable, seasonsTable, leagueMatchesTable, leagueGoalsTable, leaguePlayerStatsTable } from "@workspace/db";
import { GetGoalsByOpponentQueryParams, GetGoalsByOpponentResponse } from "@workspace/api-zod"; // eslint-disable-line @typescript-eslint/no-unused-vars
import {
  GetSeasonSummaryQueryParams,
  GetSeasonSummaryResponse,
  GetPlayerLeaderboardQueryParams,
  GetPlayerLeaderboardResponse,
  GetLeagueLadderQueryParams,
  GetLeagueLadderResponse,
  GetTeamFormQueryParams,
  GetTeamFormResponse,
  GetGoalsByIntervalQueryParams,
  GetGoalsByIntervalResponse,
  GetGoalBreakdownQueryParams,
  GetGoalBreakdownResponse,
  GetGpsLoadSummaryQueryParams,
  GetGpsLoadSummaryResponse,
  GetOpponentClubsQueryParams,
  GetOpponentClubsResponse,
  GetOpponentLeaderboardQueryParams,
  GetOpponentLeaderboardResponse,
  GetAssistsByOpponentQueryParams,
  GetAssistsByOpponentResponse,
  GetOpponentGoalBreakdownQueryParams,
  GetOpponentGoalBreakdownResponse,
  GetOpponentProfileQueryParams,
  GetPlayerTimelineQueryParams,
  GetPlayerTimelineResponse,
  GetOpponentProfileResponse,
  GetOpponentPlayersByOpponentQueryParams,
  GetOpponentPlayersByOpponentResponse,
  GetGoalCombosQueryParams,
  GetGoalCombosResponse,
  GetOpponentGoalCombosQueryParams,
  GetOpponentGoalCombosResponse,
  GetPlayerDnaQueryParams,
  GetPlayerDnaResponse,
  GetOpponentPlayerDnaQueryParams,
  GetOpponentPlayerDnaResponse,
  GetOpponentFirstSubQueryParams,
  GetOpponentFirstSubResponse,
} from "@workspace/api-zod";

// The "focus club" is the club whose players appear on Team/Player Insights tabs.
// All other clubs are opponents shown on the Opponent Insights tab.
// TODO: derive from team.clubName once the clubName field is aligned with player_stats.club values.
const FOCUS_CLUB = "Belconnen";

/**
 * Decides whether a goal counts as ours (scored) vs conceded.
 * A goal is ours if EITHER the scorer is on our roster (robust to however
 * `scorerTeam` is spelled in the source data) OR the goal's team label equals
 * our club. The team-label check adds two cases the roster alone misses:
 *   1. Own goals in our favour — stored with scorer "OG" and scorerTeam = our club.
 *   2. Goals stored with an unrecognised/mistyped scorer name but the correct team label.
 * A Belconnen player's own goal (into our own net) has scorerTeam = the opponent,
 * so it correctly stays conceded. See .agents/memory/goal-attribution.md.
 */
const isFocusGoal = (
  scorer: string | null | undefined,
  scorerTeam: string | null | undefined,
  roster: Set<string>,
): boolean => (!!scorer && roster.has(scorer)) || scorerTeam === FOCUS_CLUB;

/**
 * Aggregates assist->scorer partnerships ("combo threat") from a set of goals.
 * Own goals ("OG") and unassisted goals are excluded from the partnership tally
 * but still counted in `totalGoals`, so the chart can show what share of goals
 * came from a named partnership. Names are trimmed to fold whitespace variants.
 */
function buildCombos(goals: Array<{ scorer: string | null; assist: string | null }>) {
  const counts = new Map<string, { assister: string; scorer: string; count: number }>();
  let assistedGoals = 0;
  for (const g of goals) {
    const scorer = g.scorer?.trim();
    const assist = g.assist?.trim();
    if (!scorer || !assist) continue;
    if (scorer === "OG" || assist === "OG") continue;
    if (scorer === assist) continue; // a player can't assist their own goal
    assistedGoals++;
    const key = `${assist}\u0000${scorer}`;
    const existing = counts.get(key);
    if (existing) existing.count++;
    else counts.set(key, { assister: assist, scorer, count: 1 });
  }
  const combos = Array.from(counts.values()).sort(
    (a, b) => b.count - a.count || a.assister.localeCompare(b.assister) || a.scorer.localeCompare(b.scorer),
  );
  return { combos, totalGoals: goals.length, assistedGoals };
}

const router: IRouter = Router();

// ─── Season Summary ───────────────────────────────────────────────────────────

router.get("/analytics/season-summary", async (req, res): Promise<void> => {
  const query = GetSeasonSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { teamId, seasonId } = query.data;

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  const [season] = await db.select().from(seasonsTable).where(eq(seasonsTable.id, seasonId));
  if (!team || !season) {
    res.status(404).json({ error: "Team or season not found" });
    return;
  }

  const matches = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));

  const played = matches.length;
  const wins = matches.filter(m => (m.goalsScored ?? 0) > (m.goalsConceded ?? 0)).length;
  const draws = matches.filter(m => m.goalsScored != null && m.goalsConceded != null && m.goalsScored === m.goalsConceded).length;
  const losses = matches.filter(m => (m.goalsScored ?? 0) < (m.goalsConceded ?? 0)).length;
  const goalsScored = matches.reduce((acc, m) => acc + (m.goalsScored ?? 0), 0);
  const goalsConceded = matches.reduce((acc, m) => acc + (m.goalsConceded ?? 0), 0);
  const cleanSheets = matches.filter(m => m.cleanSheet === true).length;

  // Top scorer from goals table
  const focusTeamName = team.name;
  const goals = await db
    .select()
    .from(goalsTable)
    .where(and(eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId)));

  const focusGoals = goals.filter(g => g.scorerTeam === focusTeamName || g.scorerTeam === "Belconnen" || g.scorerTeam === "BelReserves");
  const scorerCounts: Record<string, number> = {};
  for (const g of focusGoals) {
    if (g.scorer) scorerCounts[g.scorer] = (scorerCounts[g.scorer] ?? 0) + 1;
  }
  let topScorer: string | null = null;
  let topScorerGoals: number | null = null;
  for (const [name, count] of Object.entries(scorerCounts)) {
    if (topScorerGoals == null || count > topScorerGoals) {
      topScorer = name;
      topScorerGoals = count;
    }
  }

  res.json(GetSeasonSummaryResponse.parse({
    matchesPlayed: played,
    wins,
    draws,
    losses,
    goalsScored,
    goalsConceded,
    goalDifference: goalsScored - goalsConceded,
    cleanSheets,
    winRate: played > 0 ? Math.round((wins / played) * 100) / 100 : 0,
    avgGoalsScored: played > 0 ? Math.round((goalsScored / played) * 100) / 100 : 0,
    avgGoalsConceded: played > 0 ? Math.round((goalsConceded / played) * 100) / 100 : 0,
    topScorer,
    topScorerGoals,
    teamName: team.name,
    seasonLabel: season.label,
  }));
});

// ─── Player Leaderboard ───────────────────────────────────────────────────────

router.get("/analytics/player-leaderboard", async (req, res): Promise<void> => {
  const query = GetPlayerLeaderboardQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { teamId, seasonId, lastN } = query.data;

  // Get all matches for this team+season — need both sides for on-field GD (plus/minus)
  let matches = await db
    .select({ id: matchesTable.id, goalsScored: matchesTable.goalsScored, goalsConceded: matchesTable.goalsConceded, matchDate: matchesTable.matchDate })
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));

  if (lastN != null && lastN > 0) {
    matches = matches
      .slice()
      .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""))
      .slice(0, lastN);
  }

  const matchIds = matches.map(m => m.id);
  const matchGoalsScoredMap: Record<number, number>   = {};
  const matchGoalsConcededMap: Record<number, number> = {};
  for (const m of matches) {
    matchGoalsScoredMap[m.id]   = m.goalsScored   ?? 0;
    matchGoalsConcededMap[m.id] = m.goalsConceded  ?? 0;
  }

  if (matchIds.length === 0) {
    res.json([]);
    return;
  }

  // Only Belconnen (focus-team) players
  const stats = await db
    .select()
    .from(playerStatsTable)
    .where(and(
      inArray(playerStatsTable.matchId, matchIds),
      eq(playerStatsTable.club, "Belconnen"),
    ));

  // Goals for scorer/assist tallying — filter by matchIds so lastN applies to goals too
  const goalConditions = [eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId), inArray(goalsTable.matchId, matchIds)];
  const goals = await db.select().from(goalsTable).where(and(...goalConditions));

  // Aggregate per player — keyed by playerId to avoid name-collision bugs
  type PlayerEntry = {
    playerId: number; playerName: string; position: string | null;
    goals: number; assists: number; appearances: number; starts: number;
    minsPlayed: number; yellowCards: number; redCards: number;
    goalsFor: number; goalsConceded: number;  // team GF/GA while player was on pitch
  };
  const playerMap: Record<number, PlayerEntry> = {};

  for (const s of stats) {
    if (!playerMap[s.playerId]) {
      playerMap[s.playerId] = {
        playerId: s.playerId, playerName: s.playerName, position: s.position,
        goals: 0, assists: 0, appearances: 0, starts: 0,
        minsPlayed: 0, yellowCards: 0, redCards: 0,
        goalsFor: 0, goalsConceded: 0,
      };
    }
    const e = playerMap[s.playerId];
    if (s.appearance) {
      e.appearances++;
      // Attribute the full match result for every match the player appeared in
      e.goalsFor      += matchGoalsScoredMap[s.matchId]   ?? 0;
      e.goalsConceded += matchGoalsConcededMap[s.matchId] ?? 0;
    }
    if (s.started) e.starts++;
    e.minsPlayed += s.minsPlayed ?? 0;
    if (s.discipline?.toLowerCase().includes("yellow")) e.yellowCards++;
    if (s.discipline?.toLowerCase().includes("red")) e.redCards++;
  }

  // Build name → playerId reverse map for goal/assist attribution (goals use text names)
  const nameToId: Record<string, number> = {};
  for (const p of Object.values(playerMap)) nameToId[p.playerName] = p.playerId;

  for (const g of goals) {
    const scorerId = g.scorer ? nameToId[g.scorer] : undefined;
    const assistId = g.assist ? nameToId[g.assist] : undefined;
    if (scorerId !== undefined) playerMap[scorerId].goals++;
    if (assistId !== undefined) playerMap[assistId].assists++;
  }

  const leaderboard = Object.values(playerMap).map(p => ({
    ...p,
    minsPerGoal:         p.goals > 0          ? Math.round(p.minsPlayed / p.goals)          : null,
    minsPerAssist:       p.assists > 0        ? Math.round(p.minsPlayed / p.assists)         : null,
    minsPerGoalConceded: p.goalsConceded > 0  ? Math.round(p.minsPlayed / p.goalsConceded)   : null,
  })).sort((a, b) => b.goals - a.goals || b.assists - a.assists || b.minsPlayed - a.minsPlayed);

  res.json(GetPlayerLeaderboardResponse.parse(leaderboard));
});

// ─── League Ladder ────────────────────────────────────────────────────────────

router.get("/analytics/league-ladder", async (req, res): Promise<void> => {
  const query = GetLeagueLadderQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { seasonId } = query.data;

  // Full league standings computed from ALL fixtures (every club, not just Belconnen's games)
  const matches = await db
    .select()
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));

  type Row = { played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number };
  const standings: Record<string, Row> = {};
  const ensure = (name: string): Row => (standings[name] ??= { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });

  for (const m of matches) {
    // Ladder counts league fixtures only — round games (R1, R2, …). Cup/tournament
    // games (CS, FCF, etc.) don't register on the league table.
    if (!/^R\d/.test(m.matchId)) continue;
    if (m.homeGoals == null || m.awayGoals == null) continue;
    const hg = m.homeGoals, ag = m.awayGoals;
    const home = ensure(m.homeTeam);
    const away = ensure(m.awayTeam);
    home.played++; away.played++;
    home.goalsFor += hg; home.goalsAgainst += ag;
    away.goalsFor += ag; away.goalsAgainst += hg;
    if (hg > ag)      { home.won++;  away.lost++; }
    else if (hg < ag) { away.won++;  home.lost++; }
    else              { home.drawn++; away.drawn++; }
  }

  const ladder = Object.entries(standings).map(([teamName, s]) => ({
    teamName,
    played: s.played,
    won: s.won,
    drawn: s.drawn,
    lost: s.lost,
    goalsFor: s.goalsFor,
    goalsAgainst: s.goalsAgainst,
    goalDiff: s.goalsFor - s.goalsAgainst,
    points: s.won * 3 + s.drawn,
    isFocusTeam: teamName === FOCUS_CLUB,
  })).sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor);

  res.json(GetLeagueLadderResponse.parse(ladder));
});

// ─── Team Form ────────────────────────────────────────────────────────────────

router.get("/analytics/team-form", async (req, res): Promise<void> => {
  const query = GetTeamFormQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { teamId, seasonId, limit } = query.data;
  const n = limit ?? 5;

  const matches = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)))
    .orderBy(matchesTable.matchDate)
    .limit(50);

  const recent = matches.slice(-n);

  const recentResults = recent.map(m => {
    const gs = m.goalsScored ?? 0;
    const gc = m.goalsConceded ?? 0;
    const result = m.goalsScored == null ? "?" : gs > gc ? "W" : gs === gc ? "D" : "L";
    return { opponent: m.opponent, result, goalsScored: gs, goalsConceded: gc, matchDate: m.matchDate };
  });

  const formString = recentResults.map(r => r.result).join("");
  const winsLast5 = recentResults.filter(r => r.result === "W").length;
  const drawsLast5 = recentResults.filter(r => r.result === "D").length;
  const lossesLast5 = recentResults.filter(r => r.result === "L").length;

  res.json(GetTeamFormResponse.parse({ recentResults, formString, winsLast5, drawsLast5, lossesLast5 }));
});

// ─── Goals by Interval ────────────────────────────────────────────────────────

router.get("/analytics/goals-by-interval", async (req, res): Promise<void> => {
  const query = GetGoalsByIntervalQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { teamId, seasonId, lastNMatches } = query.data;

  const [team] = await db.select().from(teamsTable).where(eq(teamsTable.id, teamId));
  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  let matchIds: number[] | null = null;
  if (lastNMatches) {
    const recentMatches = await db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)))
      .orderBy(desc(matchesTable.matchDate))
      .limit(lastNMatches);
    matchIds = recentMatches.map(m => m.id);
  }

  const conditions = [eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId)];
  const allGoals = await db.select().from(goalsTable).where(and(...conditions));

  const filteredGoals = matchIds ? allGoals.filter(g => matchIds!.includes(g.matchId)) : allGoals;

  // Belconnen roster over the relevant matches → attribute goals to us by scorer
  // name too (see isFocusGoal). Falls back to the team-label check when empty.
  const seasonMatchIds = matchIds ?? (await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)))
  ).map(m => m.id);
  const roster = new Set<string>();
  if (seasonMatchIds.length) {
    const rosterStats = await db
      .select({ playerName: playerStatsTable.playerName })
      .from(playerStatsTable)
      .where(and(inArray(playerStatsTable.matchId, seasonMatchIds), eq(playerStatsTable.club, FOCUS_CLUB)));
    for (const s of rosterStats) roster.add(s.playerName);
  }

  const intervals = [
    { label: "0-15", start: 0, end: 15 },
    { label: "16-30", start: 16, end: 30 },
    { label: "31-45", start: 31, end: 45 },
    { label: "46-60", start: 46, end: 60 },
    { label: "61-75", start: 61, end: 75 },
    { label: "76-90", start: 76, end: 90 },
  ];

  const buckets = intervals.map(interval => {
    const inInterval = filteredGoals.filter(g => {
      const min = g.minuteScored ?? 0;
      return min >= interval.start && min <= interval.end;
    });
    const scored = inInterval.filter(g => isFocusGoal(g.scorer, g.scorerTeam, roster)).length;
    const conceded = inInterval.filter(g => !isFocusGoal(g.scorer, g.scorerTeam, roster)).length;
    return {
      interval: interval.label,
      goalsScored: scored,
      goalsConceded: conceded,
      intervalStart: interval.start,
      intervalEnd: interval.end,
    };
  });

  res.json(GetGoalsByIntervalResponse.parse(buckets));
});

// ─── Goal Breakdown (focus team's own goals by type + detail dimensions) ────────

router.get("/analytics/goal-breakdown", async (req, res): Promise<void> => {
  const query = GetGoalBreakdownQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { teamId, seasonId, lastN } = query.data;

  let matches = await db
    .select({ id: matchesTable.id, opponent: matchesTable.opponent, matchDate: matchesTable.matchDate, matchCode: matchesTable.matchId, goalsScored: matchesTable.goalsScored, goalsConceded: matchesTable.goalsConceded })
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));

  // Optional "last N games" window — most-recent N matches by date.
  if (lastN != null && lastN > 0) {
    matches = matches
      .slice()
      .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""))
      .slice(0, lastN);
  }
  const matchIds = matches.map(m => m.id);

  if (matchIds.length === 0) {
    res.json(GetGoalBreakdownResponse.parse({ opponents: [], goals: [], conceded: [] }));
    return;
  }

  const matchOpponentMap: Record<number, string | null> = {};
  const matchDateMap: Record<number, string | null> = {};
  const matchCodeMap: Record<number, string | null> = {};
  // Authoritative W/D/L from the recorded final score (not derived from goal attribution).
  const matchResultMap: Record<number, string | null> = {};
  for (const m of matches) {
    matchOpponentMap[m.id] = m.opponent ?? null;
    matchDateMap[m.id] = m.matchDate ?? null;
    matchCodeMap[m.id] = m.matchCode ?? null;
    matchResultMap[m.id] =
      m.goalsScored == null || m.goalsConceded == null ? null
      : m.goalsScored > m.goalsConceded ? "W"
      : m.goalsScored < m.goalsConceded ? "L"
      : "D";
  }

  // Focus-team roster from player_stats → attribute goals to us by scorer name
  // (same roster-based approach as the leaderboard/goals-by-opponent endpoints,
  // robust to however scorerTeam is spelled in the data).
  const stats = await db
    .select({ playerName: playerStatsTable.playerName })
    .from(playerStatsTable)
    .where(and(inArray(playerStatsTable.matchId, matchIds), eq(playerStatsTable.club, FOCUS_CLUB)));
  const roster = new Set(stats.map(s => s.playerName));

  // Filter goals to the (possibly windowed) matchIds so lastN applies to goals too.
  const goals = await db
    .select()
    .from(goalsTable)
    .where(and(eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId), inArray(goalsTable.matchId, matchIds)));

  // Scored vs conceded via the shared attribution rule (roster OR our team label).
  const isOurs = (g: typeof goals[number]) => isFocusGoal(g.scorer, g.scorerTeam, roster);
  const ourGoals      = goals.filter(isOurs);
  const concededGoals = goals.filter(g => !isOurs(g));

  const toRecord = (g: typeof goals[number]) => {
    const opp = g.matchId != null ? matchOpponentMap[g.matchId] ?? null : null;
    return {
      id: g.id,
      matchId:         g.matchId ?? null,
      minuteScored:    g.minuteScored ?? null,
      goalType:        g.goalType ?? null,
      assistType:      g.assistType ?? null,
      buildupLane:     g.buildupLane ?? null,
      finishType:      g.finishType ?? null,
      howPenetrated:   g.howPenetrated ?? null,
      firstTimeFinish: g.firstTimeFinish ?? null,
      passString:      g.passString ?? null,
      goalX:           g.goalX != null ? Number(g.goalX) : null,
      goalY:           g.goalY != null ? Number(g.goalY) : null,
      scorer:          g.scorer ?? null,
      assist:          g.assist ?? null,
      opponent:        opp,
      matchDate:       g.matchId != null ? matchDateMap[g.matchId] ?? null : null,
      matchCode:       g.matchId != null ? matchCodeMap[g.matchId] ?? null : null,
      matchResult:     g.matchId != null ? matchResultMap[g.matchId] ?? null : null,
    };
  };

  const ourRecords      = ourGoals.map(toRecord);
  const concededRecords = concededGoals.map(toRecord);

  const opponentsSet = new Set<string>();
  for (const r of ourRecords) if (r.opponent) opponentsSet.add(r.opponent);

  res.json(GetGoalBreakdownResponse.parse({
    opponents: Array.from(opponentsSet).sort(),
    goals: ourRecords,
    conceded: concededRecords,
  }));
});

// ─── Goal Combos (focus team's assist→scorer partnerships) ─────────────────────

router.get("/analytics/goal-combos", async (req, res): Promise<void> => {
  const query = GetGoalCombosQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { teamId, seasonId, lastN } = query.data;

  let matches = await db
    .select({ id: matchesTable.id, matchDate: matchesTable.matchDate })
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));

  if (lastN != null && lastN > 0) {
    matches = matches.slice().sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? "")).slice(0, lastN);
  }
  const matchIds = matches.map(m => m.id);
  if (matchIds.length === 0) { res.json(GetGoalCombosResponse.parse({ combos: [], totalGoals: 0, assistedGoals: 0 })); return; }

  // Roster-based attribution (same rule as goal-breakdown) → only OUR goals count.
  const stats = await db
    .select({ playerName: playerStatsTable.playerName })
    .from(playerStatsTable)
    .where(and(inArray(playerStatsTable.matchId, matchIds), eq(playerStatsTable.club, FOCUS_CLUB)));
  const roster = new Set(stats.map(s => s.playerName));

  const goals = await db
    .select({ scorer: goalsTable.scorer, assist: goalsTable.assist, scorerTeam: goalsTable.scorerTeam })
    .from(goalsTable)
    .where(and(eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId), inArray(goalsTable.matchId, matchIds)));

  const ourGoals = goals.filter(g => isFocusGoal(g.scorer, g.scorerTeam, roster));
  res.json(GetGoalCombosResponse.parse(buildCombos(ourGoals)));
});

// ─── Player Scoring DNA (radar) ────────────────────────────────────────────────
// One focus-team player's attacking profile: goals/assists (raw + per-90), foot/head
// split, first-touch finish %, plus best-of callouts (favourite opponent, top assist
// partner). Also returns squad maxima per metric so the client can scale the radar
// (each spoke = player value ÷ squad best). Per-90 maxima ignore low-minute players
// so a cameo goal doesn't blow out the scale.
const MIN_MINS_FOR_RATE_MAX = 90;

// Shared DNA computation for both the focus-team endpoint (matches/goals tables) and
// the opponent endpoint (whole-league tables). Callers scope `goals` to the club's own
// goals and supply an opponentLabel per goal for the favourite-opponent callout.
type DnaGoalRow = {
  scorer: string | null;
  assist: string | null;
  finishType: string | null;
  firstTimeFinish: boolean | null;
  goalX: string | null;
  goalY: string | null;
  opponentLabel: string | null;
};

const emptyDnaMetrics = () => ({ goals: 0, goalsPer90: 0, assists: 0, assistsPer90: 0, firstTouchPct: 0, poacherPct: 0, rightFoot: 0, leftFoot: 0, header: 0 });
const emptyDnaResponse = (player: string) => ({
  player, minsPlayed: 0, appearances: 0, minsPerGoal: null,
  metrics: emptyDnaMetrics(), squadMax: emptyDnaMetrics(), squadAvg: emptyDnaMetrics(),
  firstTouchYes: 0, firstTouchTotal: 0, poacherYes: 0, poacherTotal: 0,
  favouriteOpponent: null, topAssistPartner: null,
});

function computeDnaResponse({ player, roster, minsMap, appsMap, goals }: {
  player: string;
  roster: Set<string>;
  minsMap: Map<string, number>;
  appsMap: Map<string, number>;
  goals: DnaGoalRow[];
}) {
  // Per-player aggregation.
  type Agg = { goals: number; assists: number; rightFoot: number; leftFoot: number; header: number; ftYes: number; ftTotal: number; poacherYes: number; poacherTotal: number };
  const agg = new Map<string, Agg>();
  const ensure = (name: string): Agg => {
    let a = agg.get(name);
    if (!a) { a = { goals: 0, assists: 0, rightFoot: 0, leftFoot: 0, header: 0, ftYes: 0, ftTotal: 0, poacherYes: 0, poacherTotal: 0 }; agg.set(name, a); }
    return a;
  };
  for (const name of roster) ensure(name);

  for (const g of goals) {
    const scorer = g.scorer?.trim();
    if (scorer && roster.has(scorer)) {
      const a = ensure(scorer);
      a.goals++;
      const ft = g.finishType?.trim().toLowerCase();
      if (ft === "right foot") a.rightFoot++;
      else if (ft === "left foot") a.leftFoot++;
      else if (ft === "head") a.header++;
      if (g.firstTimeFinish != null) { a.ftTotal++; if (g.firstTimeFinish) a.ftYes++; }
      // Poacher zone: the strip directly in front of goal — post-to-post width
      // (goalX 45–55, posts at 45 & 55) and out to 10 yds from the goal line.
      // goalY is yards from the goal line. Distinguishes poachers (high %) from
      // long-rangers / wide finishers (low %).
      const gx = g.goalX != null ? Number(g.goalX) : NaN;
      const gy = g.goalY != null ? Number(g.goalY) : NaN;
      if (Number.isFinite(gx) && Number.isFinite(gy)) {
        a.poacherTotal++;
        if (gx >= 45 && gx <= 55 && gy <= 10) a.poacherYes++;
      }
    }
    // Mirror ComboThreat: no assist is credited on an own goal (scorer "OG"),
    // and an "OG" assist / self-assist never counts.
    const assist = g.assist?.trim();
    if (assist && assist !== "OG" && scorer !== "OG" && assist !== scorer && roster.has(assist)) ensure(assist).assists++;
  }

  const metricsFor = (name: string) => {
    const a = agg.get(name) ?? { goals: 0, assists: 0, rightFoot: 0, leftFoot: 0, header: 0, ftYes: 0, ftTotal: 0, poacherYes: 0, poacherTotal: 0 };
    const mins = minsMap.get(name) ?? 0;
    return {
      goals: a.goals,
      goalsPer90: mins > 0 ? Math.round((a.goals / mins) * 90 * 100) / 100 : 0,
      assists: a.assists,
      assistsPer90: mins > 0 ? Math.round((a.assists / mins) * 90 * 100) / 100 : 0,
      firstTouchPct: a.ftTotal > 0 ? Math.round((a.ftYes / a.ftTotal) * 1000) / 10 : 0,
      poacherPct: a.poacherTotal > 0 ? Math.round((a.poacherYes / a.poacherTotal) * 1000) / 10 : 0,
      rightFoot: a.rightFoot,
      leftFoot: a.leftFoot,
      header: a.header,
    };
  };

  // Squad maxima per metric (per-90 maxima ignore low-minute cameos).
  const squadMax = emptyDnaMetrics();
  for (const name of roster) {
    const m = metricsFor(name);
    const mins = minsMap.get(name) ?? 0;
    squadMax.goals = Math.max(squadMax.goals, m.goals);
    squadMax.assists = Math.max(squadMax.assists, m.assists);
    squadMax.firstTouchPct = Math.max(squadMax.firstTouchPct, m.firstTouchPct);
    squadMax.poacherPct = Math.max(squadMax.poacherPct, m.poacherPct);
    squadMax.rightFoot = Math.max(squadMax.rightFoot, m.rightFoot);
    squadMax.leftFoot = Math.max(squadMax.leftFoot, m.leftFoot);
    squadMax.header = Math.max(squadMax.header, m.header);
    if (mins >= MIN_MINS_FOR_RATE_MAX) {
      squadMax.goalsPer90 = Math.max(squadMax.goalsPer90, m.goalsPer90);
      squadMax.assistsPer90 = Math.max(squadMax.assistsPer90, m.assistsPer90);
    }
  }
  // A high-rate cameo player could still exceed the floored max — never let the
  // selected player's own value be unreachable on their radar.
  const metrics = metricsFor(player);
  squadMax.goalsPer90 = Math.max(squadMax.goalsPer90, metrics.goalsPer90);
  squadMax.assistsPer90 = Math.max(squadMax.assistsPer90, metrics.assistsPer90);

  // Squad averages per metric. Population is chosen for a meaningful baseline, not a
  // strict per-axis contributor set:
  //   - goals / foot / header  → averaged over all SCORERS (goals > 0). Deliberate:
  //     averaging headers only over header-scorers would inflate the baseline and make a
  //     genuine aerial threat look ordinary; "avg headers per scorer" is the useful signal.
  //   - assists                → averaged over assisters (assists > 0).
  //   - goals/90, assists/90   → over contributors that also clear the MIN_MINS floor.
  //   - first-touch %          → over players with first-touch-eligible goals.
  //   - poacher %              → over players with location-mapped goals.
  // Non-contributors (zeros) are excluded so they don't drag the "typical" figure down.
  const avgSum = emptyDnaMetrics();
  const avgCnt = emptyDnaMetrics();
  for (const name of roster) {
    const m = metricsFor(name);
    const a = agg.get(name);
    const mins = minsMap.get(name) ?? 0;
    const scored = m.goals > 0;
    const assisted = m.assists > 0;
    if (scored) {
      avgSum.goals += m.goals; avgCnt.goals++;
      avgSum.rightFoot += m.rightFoot; avgCnt.rightFoot++;
      avgSum.leftFoot += m.leftFoot; avgCnt.leftFoot++;
      avgSum.header += m.header; avgCnt.header++;
    }
    if (assisted) { avgSum.assists += m.assists; avgCnt.assists++; }
    if (scored && mins >= MIN_MINS_FOR_RATE_MAX) { avgSum.goalsPer90 += m.goalsPer90; avgCnt.goalsPer90++; }
    if (assisted && mins >= MIN_MINS_FOR_RATE_MAX) { avgSum.assistsPer90 += m.assistsPer90; avgCnt.assistsPer90++; }
    if ((a?.ftTotal ?? 0) > 0) { avgSum.firstTouchPct += m.firstTouchPct; avgCnt.firstTouchPct++; }
    if ((a?.poacherTotal ?? 0) > 0) { avgSum.poacherPct += m.poacherPct; avgCnt.poacherPct++; }
  }
  const avgOf = (key: keyof ReturnType<typeof emptyDnaMetrics>, dp: number) =>
    avgCnt[key] > 0 ? Math.round((avgSum[key] / avgCnt[key]) * 10 ** dp) / 10 ** dp : 0;
  const squadAvg = {
    goals: avgOf("goals", 1),
    goalsPer90: avgOf("goalsPer90", 2),
    assists: avgOf("assists", 1),
    assistsPer90: avgOf("assistsPer90", 2),
    firstTouchPct: avgOf("firstTouchPct", 1),
    poacherPct: avgOf("poacherPct", 1),
    rightFoot: avgOf("rightFoot", 1),
    leftFoot: avgOf("leftFoot", 1),
    header: avgOf("header", 1),
  };

  // First-touch / poacher context for the selected player.
  const selAgg = agg.get(player);
  const firstTouchYes = selAgg?.ftYes ?? 0;
  const firstTouchTotal = selAgg?.ftTotal ?? 0;
  const poacherYes = selAgg?.poacherYes ?? 0;
  const poacherTotal = selAgg?.poacherTotal ?? 0;

  // Best-of callouts (from the selected player's scored goals only).
  const oppCount = new Map<string, number>();
  const partnerCount = new Map<string, number>();
  for (const g of goals) {
    if (g.scorer?.trim() !== player) continue;
    if (g.opponentLabel) oppCount.set(g.opponentLabel, (oppCount.get(g.opponentLabel) ?? 0) + 1);
    const assist = g.assist?.trim();
    if (assist && assist !== "OG" && assist !== player) partnerCount.set(assist, (partnerCount.get(assist) ?? 0) + 1);
  }
  const topOf = (m: Map<string, number>) => {
    let best: { label: string; count: number } | null = null;
    for (const [label, count] of m) if (!best || count > best.count) best = { label, count };
    return best;
  };

  const minsPlayed = minsMap.get(player) ?? 0;
  return {
    player,
    minsPlayed,
    appearances: appsMap.get(player) ?? 0,
    minsPerGoal: metrics.goals > 0 ? Math.round(minsPlayed / metrics.goals) : null,
    metrics,
    squadMax,
    squadAvg,
    firstTouchYes,
    firstTouchTotal,
    poacherYes,
    poacherTotal,
    favouriteOpponent: topOf(oppCount),
    topAssistPartner: topOf(partnerCount),
  };
}

router.get("/analytics/player-dna", async (req, res): Promise<void> => {
  const query = GetPlayerDnaQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { teamId, seasonId, player, lastN } = query.data;

  let matches = await db
    .select({ id: matchesTable.id, matchDate: matchesTable.matchDate, opponent: matchesTable.opponent })
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));

  if (lastN != null && lastN > 0) {
    matches = matches.slice().sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? "")).slice(0, lastN);
  }
  const matchIds = matches.map(m => m.id);
  if (matchIds.length === 0) { res.json(GetPlayerDnaResponse.parse(emptyDnaResponse(player))); return; }
  const matchOppMap = new Map<number, string | null>();
  for (const m of matches) matchOppMap.set(m.id, m.opponent ?? null);

  // Minutes + appearances per focus-team player (roster is the eligible player set).
  const stats = await db
    .select({ playerName: playerStatsTable.playerName, minsPlayed: playerStatsTable.minsPlayed, appearance: playerStatsTable.appearance })
    .from(playerStatsTable)
    .where(and(inArray(playerStatsTable.matchId, matchIds), eq(playerStatsTable.club, FOCUS_CLUB)));

  const minsMap = new Map<string, number>();
  const appsMap = new Map<string, number>();
  for (const s of stats) {
    const name = s.playerName;
    minsMap.set(name, (minsMap.get(name) ?? 0) + (s.minsPlayed ?? 0));
    if (s.appearance) appsMap.set(name, (appsMap.get(name) ?? 0) + 1);
  }
  const roster = new Set(stats.map(s => s.playerName));

  const goals = await db
    .select({
      scorer: goalsTable.scorer, assist: goalsTable.assist, scorerTeam: goalsTable.scorerTeam,
      matchId: goalsTable.matchId, finishType: goalsTable.finishType, firstTimeFinish: goalsTable.firstTimeFinish,
      goalX: goalsTable.goalX, goalY: goalsTable.goalY,
    })
    .from(goalsTable)
    .where(and(eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId), inArray(goalsTable.matchId, matchIds)));
  const ourGoals = goals.filter(g => isFocusGoal(g.scorer, g.scorerTeam, roster));

  const dnaGoals: DnaGoalRow[] = ourGoals.map(g => ({
    scorer: g.scorer, assist: g.assist, finishType: g.finishType, firstTimeFinish: g.firstTimeFinish,
    goalX: g.goalX, goalY: g.goalY,
    opponentLabel: matchOppMap.get(g.matchId) ?? null,
  }));
  res.json(GetPlayerDnaResponse.parse(computeDnaResponse({ player, roster, minsMap, appsMap, goals: dnaGoals })));
});

// ─── GPS Load Summary ─────────────────────────────────────────────────────────

router.get("/analytics/gps-load-summary", async (req, res): Promise<void> => {
  const query = GetGpsLoadSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { teamId, year } = query.data;

  const rawSessions = await db
    .select()
    .from(gpsSessionsTable)
    .where(and(eq(gpsSessionsTable.teamId, teamId), eq(gpsSessionsTable.year, year)));

  // Pool duplicate GPS identities under their canonical name
  const aliasRows = await db.select().from(gpsPlayerAliasesTable);
  const aliasMap = new Map(aliasRows.map(a => [a.alias, a.canonical]));
  const sessions = rawSessions.map(s => ({ ...s, playerName: aliasMap.get(s.playerName) ?? s.playerName }));

  const p = (v: string | null | undefined) => (v != null ? parseFloat(v) : null);

  // Aggregate by player
  const playerMap: Record<string, {
    playerId: number | null;
    playerName: string;
    sessions: number;
    distances: number[];
    sprints: number[];
    loads: number[];
    speeds: number[];
    hrLoads: number[];
  }> = {};

  for (const s of sessions) {
    if (!playerMap[s.playerName]) {
      playerMap[s.playerName] = { playerId: s.playerId, playerName: s.playerName, sessions: 0, distances: [], sprints: [], loads: [], speeds: [], hrLoads: [] };
    }
    const entry = playerMap[s.playerName];
    entry.sessions++;
    const dist = p(s.distanceKm);
    const sprint = p(s.sprintDistanceM);
    const load = p(s.playerLoad);
    const speed = p(s.topSpeedMs);
    const hr = p(s.hrLoad);
    if (dist != null) entry.distances.push(dist);
    if (sprint != null) entry.sprints.push(sprint);
    if (load != null) entry.loads.push(load);
    if (speed != null) entry.speeds.push(speed);
    if (hr != null) entry.hrLoads.push(hr);
  }

  const avg = (arr: number[]) => arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : null;
  const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : null;
  const sum = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) * 100) / 100 : null;

  const summary = Object.values(playerMap).map(p => ({
    playerId: p.playerId,
    playerName: p.playerName,
    sessions: p.sessions,
    avgDistanceKm: avg(p.distances),
    avgSprintDistanceM: avg(p.sprints),
    avgPlayerLoad: avg(p.loads),
    avgTopSpeedMs: avg(p.speeds),
    avgHrLoad: avg(p.hrLoads),
    totalDistanceKm: sum(p.distances),
    maxTopSpeedMs: max(p.speeds),
  })).sort((a, b) => b.sessions - a.sessions);

  res.json(GetGpsLoadSummaryResponse.parse(summary));
});

// ─── Opponent Clubs ───────────────────────────────────────────────────────────

router.get("/analytics/opponent-clubs", async (req, res): Promise<void> => {
  const query = GetOpponentClubsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { teamId, seasonId } = query.data;

  const matches = await db
    .select({ id: matchesTable.id })
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));

  const matchIds = matches.map(m => m.id);
  if (matchIds.length === 0) { res.json([]); return; }

  const rows = await db
    .selectDistinct({ club: playerStatsTable.club })
    .from(playerStatsTable)
    .where(and(
      inArray(playerStatsTable.matchId, matchIds),
      ne(playerStatsTable.club, FOCUS_CLUB),
      isNotNull(playerStatsTable.club),
    ));

  const clubs = rows.map(r => r.club).filter((c): c is string => c !== null).sort();
  res.json(GetOpponentClubsResponse.parse(clubs));
});

// ─── Opponent Leaderboard ─────────────────────────────────────────────────────

router.get("/analytics/opponent-leaderboard", async (req, res): Promise<void> => {
  const query = GetOpponentLeaderboardQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { teamId, seasonId, club, lastN } = query.data;

  let matches = await db
    .select({ id: matchesTable.id, goalsScored: matchesTable.goalsScored, goalsConceded: matchesTable.goalsConceded, matchDate: matchesTable.matchDate })
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));

  if (lastN != null && lastN > 0) {
    matches = matches
      .slice()
      .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""))
      .slice(0, lastN);
  }

  const matchIds = matches.map(m => m.id);
  if (matchIds.length === 0) {
    res.json(GetOpponentLeaderboardResponse.parse({
      players: [],
      headToHead: { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 },
      matches: [],
    }));
    return;
  }

  // Derive W/D/L from goals scored vs conceded (matchesTable has no result column).
  // Matches where either score is null are excluded — no score = result unknown.
  const getResult = (gf: number | null, ga: number | null): "W" | "D" | "L" | null => {
    if (gf == null || ga == null) return null;
    return gf > ga ? "W" : gf < ga ? "L" : "D";
  };

  // From the opponent's perspective: their GF = our goalsConceded, their GA = our goalsScored
  const matchOppGFMap: Record<number, number> = {};
  const matchOppGAMap: Record<number, number> = {};
  for (const m of matches) {
    matchOppGFMap[m.id] = m.goalsConceded ?? 0;
    matchOppGAMap[m.id] = m.goalsScored   ?? 0;
  }

  const stats = await db
    .select()
    .from(playerStatsTable)
    .where(and(inArray(playerStatsTable.matchId, matchIds), eq(playerStatsTable.club, club)));

  // Derive H2H from matches that had players from this club (reliable — same source as player data).
  // Only include matches where both score fields are present.
  const clubMatchIds = new Set(stats.map(s => s.matchId));
  const clubMatches  = matches.filter(m => clubMatchIds.has(m.id) && m.goalsScored != null && m.goalsConceded != null);
  const headToHead = {
    played:       clubMatches.length,
    won:          clubMatches.filter(m => getResult(m.goalsScored, m.goalsConceded) === "W").length,
    drawn:        clubMatches.filter(m => getResult(m.goalsScored, m.goalsConceded) === "D").length,
    lost:         clubMatches.filter(m => getResult(m.goalsScored, m.goalsConceded) === "L").length,
    goalsFor:     clubMatches.reduce((s, m) => s + (m.goalsScored   ?? 0), 0),
    goalsAgainst: clubMatches.reduce((s, m) => s + (m.goalsConceded ?? 0), 0),
  };

  // Aggregate per opponent player — keyed by name (opponents have playerId=0 in our DB)
  type OppEntry = {
    playerName: string; position: string | null;
    appearances: number; starts: number; minsPlayed: number;
    yellowCards: number; redCards: number; goalsFor: number; goalsConceded: number;
  };
  const playerMap: Record<string, OppEntry> = {};

  for (const s of stats) {
    if (!playerMap[s.playerName]) {
      playerMap[s.playerName] = {
        playerName: s.playerName, position: s.position,
        appearances: 0, starts: 0, minsPlayed: 0,
        yellowCards: 0, redCards: 0, goalsFor: 0, goalsConceded: 0,
      };
    }
    const e = playerMap[s.playerName];
    if (s.appearance) {
      e.appearances++;
      e.goalsFor      += matchOppGFMap[s.matchId] ?? 0;
      e.goalsConceded += matchOppGAMap[s.matchId] ?? 0;
    }
    if (s.started) e.starts++;
    e.minsPlayed += s.minsPlayed ?? 0;
    if (s.discipline?.toLowerCase().includes("yellow")) e.yellowCards++;
    if (s.discipline?.toLowerCase().includes("red")) e.redCards++;
  }

  const players = Object.values(playerMap)
    .sort((a, b) => b.appearances - a.appearances || b.minsPlayed - a.minsPlayed);

  // Include match history so the frontend can show a match-by-match table
  const matchHistory = clubMatches
    .slice()
    .sort((a, b) => (a.matchDate ?? "").localeCompare(b.matchDate ?? ""))
    .map(m => {
      const result = getResult(m.goalsScored, m.goalsConceded);
      return {
        matchId:       m.id,
        matchDate:     m.matchDate ?? null,
        goalsScored:   m.goalsScored   ?? 0,
        goalsConceded: m.goalsConceded ?? 0,
        result:        result ?? "?",
      };
    });

  res.json(GetOpponentLeaderboardResponse.parse({ players, headToHead, matches: matchHistory }));
});

// ─── Assists by Opponent (per-player, per-opponent breakdown) ─────────────────

router.get("/analytics/assists-by-opponent", async (req, res): Promise<void> => {
  const query = GetAssistsByOpponentQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { teamId, seasonId, lastN } = query.data;

  let matches = await db
    .select({ id: matchesTable.id, opponent: matchesTable.opponent, matchDate: matchesTable.matchDate })
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));

  if (!matches.length) { res.json(GetAssistsByOpponentResponse.parse({ opponents: [], players: [] })); return; }

  if (lastN != null && lastN > 0) {
    matches = matches
      .slice()
      .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""))
      .slice(0, lastN);
  }

  const matchIds = matches.map(m => m.id);
  const matchOpponentMap: Record<number, string> = {};
  for (const m of matches) matchOpponentMap[m.id] = m.opponent;

  // Player stats for Belconnen players — builds roster + per-match minutes
  const stats = await db
    .select({ playerName: playerStatsTable.playerName, matchId: playerStatsTable.matchId, minsPlayed: playerStatsTable.minsPlayed })
    .from(playerStatsTable)
    .where(and(inArray(playerStatsTable.matchId, matchIds), eq(playerStatsTable.club, FOCUS_CLUB)));

  const minsByPlayerOpp: Record<string, Record<string, number>> = {};
  const totalMinsByPlayer: Record<string, number> = {};
  for (const s of stats) {
    const opp = matchOpponentMap[s.matchId];
    if (!opp) continue;
    if (!minsByPlayerOpp[s.playerName]) minsByPlayerOpp[s.playerName] = {};
    minsByPlayerOpp[s.playerName][opp] = (minsByPlayerOpp[s.playerName][opp] ?? 0) + (s.minsPlayed ?? 0);
    totalMinsByPlayer[s.playerName] = (totalMinsByPlayer[s.playerName] ?? 0) + (s.minsPlayed ?? 0);
  }

  const belconnenRoster = new Set(Object.keys(minsByPlayerOpp));

  // Goals table — use the assist field (not scorer) for assist attribution
  const goals = await db
    .select({ assist: goalsTable.assist, matchId: goalsTable.matchId })
    .from(goalsTable)
    .where(and(eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId), inArray(goalsTable.matchId, matchIds)));

  // Only count assists by Belconnen players
  const assistsByPlayerOpp: Record<string, Record<string, number>> = {};
  for (const g of goals) {
    if (!g.assist || g.matchId == null) continue;
    if (!belconnenRoster.has(g.assist)) continue;
    const opp = matchOpponentMap[g.matchId];
    if (!opp) continue;
    if (!assistsByPlayerOpp[g.assist]) assistsByPlayerOpp[g.assist] = {};
    assistsByPlayerOpp[g.assist][opp] = (assistsByPlayerOpp[g.assist][opp] ?? 0) + 1;
  }

  const allOpponentsSet = new Set<string>();
  const players = Object.entries(assistsByPlayerOpp).map(([playerName, byOpp]) => {
    Object.keys(byOpp).forEach(o => allOpponentsSet.add(o));
    const totalAssists = Object.values(byOpp).reduce((s, v) => s + v, 0);
    const minsMap = minsByPlayerOpp[playerName] ?? {};
    return {
      playerName,
      totalMins:    totalMinsByPlayer[playerName] ?? 0,
      totalAssists,
      byOpponent: Object.fromEntries(
        Object.entries(byOpp).map(([o, a]) => [o, { assists: a, minsPlayed: minsMap[o] ?? 0 }])
      ),
    };
  }).sort((a, b) => b.totalAssists - a.totalAssists);

  const opponents = Array.from(allOpponentsSet).sort();
  res.json(GetAssistsByOpponentResponse.parse({ opponents, players }));
});

// ─── Opponent Goal Breakdown (scored & conceded vs a specific club) ───────────

router.get("/analytics/opponent-goal-breakdown", async (req, res): Promise<void> => {
  const query = GetOpponentGoalBreakdownQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { teamId, seasonId, club } = query.data;

  // Get all matches vs this club
  const allMatches = await db
    .select({ id: matchesTable.id, opponent: matchesTable.opponent, matchDate: matchesTable.matchDate })
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));

  // Find match IDs where this club appeared (via player_stats)
  const clubStats = await db
    .select({ matchId: playerStatsTable.matchId })
    .from(playerStatsTable)
    .where(and(
      inArray(playerStatsTable.matchId, allMatches.map(m => m.id)),
      eq(playerStatsTable.club, club),
    ));

  const clubMatchIds = new Set(clubStats.map(s => s.matchId));
  const clubMatchDateMap: Record<number, string | null> = {};
  for (const m of allMatches) {
    if (clubMatchIds.has(m.id)) clubMatchDateMap[m.id] = m.matchDate ?? null;
  }

  if (clubMatchIds.size === 0) {
    res.json(GetOpponentGoalBreakdownResponse.parse({ scored: [], conceded: [] }));
    return;
  }

  // Get Belconnen player roster from these matches (to distinguish our goals from theirs)
  const belStats = await db
    .select({ playerName: playerStatsTable.playerName })
    .from(playerStatsTable)
    .where(and(inArray(playerStatsTable.matchId, Array.from(clubMatchIds)), eq(playerStatsTable.club, FOCUS_CLUB)));
  const belconnenRoster = new Set(belStats.map(s => s.playerName));

  // Load all goals in these matches
  const goals = await db
    .select()
    .from(goalsTable)
    .where(and(
      eq(goalsTable.teamId, teamId),
      eq(goalsTable.seasonId, seasonId),
      inArray(goalsTable.matchId, Array.from(clubMatchIds)),
    ));

  const toDetail = (g: typeof goals[0]) => ({
    id:              g.id,
    minuteScored:    g.minuteScored ?? null,
    goalType:        g.goalType ?? null,
    assistType:      g.assistType ?? null,
    buildupLane:     g.buildupLane ?? null,
    howPenetrated:   g.howPenetrated ?? null,
    finishType:      g.finishType ?? null,
    firstTimeFinish: g.firstTimeFinish ?? null,
    scorer:          g.scorer ?? null,
    assist:          g.assist ?? null,
    matchDate:       clubMatchDateMap[g.matchId] ?? null,
  });

  // Scored vs conceded via the shared attribution rule (roster OR our team label).
  const scored   = goals.filter(g => isFocusGoal(g.scorer, g.scorerTeam, belconnenRoster)).map(toDetail);
  const conceded = goals.filter(g => !isFocusGoal(g.scorer, g.scorerTeam, belconnenRoster)).map(toDetail);

  res.json(GetOpponentGoalBreakdownResponse.parse({ scored, conceded }));
});

// ─── Goals by Opponent (per-player, per-opponent breakdown) ───────────────────

router.get("/analytics/goals-by-opponent", async (req, res): Promise<void> => {
  const query = GetGoalsByOpponentQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { teamId, seasonId, lastN } = query.data;

  // Load matches → optionally trim to last N by date → build matchId→opponent map
  let matches = await db
    .select({ id: matchesTable.id, opponent: matchesTable.opponent, matchDate: matchesTable.matchDate })
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));

  if (!matches.length) { res.json(GetGoalsByOpponentResponse.parse({ opponents: [], players: [] })); return; }

  if (lastN != null && lastN > 0) {
    // Sort descending by date (nulls last), take the N most recent
    matches = matches
      .slice()
      .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""))
      .slice(0, lastN);
  }

  const matchIds = matches.map(m => m.id);
  const matchOpponentMap: Record<number, string> = {};
  for (const m of matches) matchOpponentMap[m.id] = m.opponent;

  // Load ALL goals for this team/season — no scorerTeam filter.
  // Belconnen goals are identified by the scorer name existing in the Belconnen
  // player roster built below, which is the same approach used by the leaderboard
  // endpoint and works regardless of how scorerTeam is spelled in the data.
  const goals = await db
    .select({ scorer: goalsTable.scorer, matchId: goalsTable.matchId })
    .from(goalsTable)
    .where(and(
      eq(goalsTable.teamId, teamId),
      eq(goalsTable.seasonId, seasonId),
    ));

  // Player stats for focus-team players in these matches → minutes by (player, opponent)
  const stats = await db
    .select({ playerName: playerStatsTable.playerName, matchId: playerStatsTable.matchId, minsPlayed: playerStatsTable.minsPlayed })
    .from(playerStatsTable)
    .where(and(
      inArray(playerStatsTable.matchId, matchIds),
      eq(playerStatsTable.club, FOCUS_CLUB),
    ));

  // Aggregate minutes: player → opponent → total mins
  const minsByPlayerOpp: Record<string, Record<string, number>> = {};
  const totalMinsByPlayer: Record<string, number> = {};
  for (const s of stats) {
    const opp = matchOpponentMap[s.matchId];
    if (!opp) continue;
    if (!minsByPlayerOpp[s.playerName]) minsByPlayerOpp[s.playerName] = {};
    minsByPlayerOpp[s.playerName][opp] = (minsByPlayerOpp[s.playerName][opp] ?? 0) + (s.minsPlayed ?? 0);
    totalMinsByPlayer[s.playerName] = (totalMinsByPlayer[s.playerName] ?? 0) + (s.minsPlayed ?? 0);
  }

  // Build the set of known Belconnen player names for goal attribution filtering.
  // Only goals whose scorer name exists in the Belconnen player roster are counted —
  // this automatically excludes opponent scorers regardless of scorerTeam spelling.
  const belconnenRoster = new Set(Object.keys(minsByPlayerOpp));

  // Aggregate goals: player → opponent → count
  const goalsByPlayerOpp: Record<string, Record<string, number>> = {};
  for (const g of goals) {
    if (!g.scorer || g.matchId == null) continue;
    if (!belconnenRoster.has(g.scorer)) continue; // skip opponent or unrecognised scorers
    const opp = matchOpponentMap[g.matchId];
    if (!opp) continue;
    if (!goalsByPlayerOpp[g.scorer]) goalsByPlayerOpp[g.scorer] = {};
    goalsByPlayerOpp[g.scorer][opp] = (goalsByPlayerOpp[g.scorer][opp] ?? 0) + 1;
  }

  // Build response — only players with at least one goal
  const allOpponentsSet = new Set<string>();
  const players = Object.entries(goalsByPlayerOpp).map(([playerName, byOpp]) => {
    Object.keys(byOpp).forEach(o => allOpponentsSet.add(o));
    const totalGoals = Object.values(byOpp).reduce((s, v) => s + v, 0);
    const minsMap = minsByPlayerOpp[playerName] ?? {};
    return {
      playerName,
      totalMins: totalMinsByPlayer[playerName] ?? 0,
      totalGoals,
      byOpponent: Object.fromEntries(
        Object.entries(byOpp).map(([o, g]) => [o, { goals: g, minsPlayed: minsMap[o] ?? 0 }])
      ),
    };
  }).sort((a, b) => b.totalGoals - a.totalGoals);

  const opponents = Array.from(allOpponentsSet).sort();
  res.json(GetGoalsByOpponentResponse.parse({ opponents, players }));
});

// ─── Opponent Players by Opponent (club-scoped goals/assists/mins per opponent) ─
// Powers the Opponent Insights player charts: for the selected club, each player's
// goals + assists broken down by the opponent CLUB they came against, plus minutes.
// Built from the whole-league tables so it works for any club (or __ALL__).

router.get("/analytics/opponent-players-by-opponent", async (req, res): Promise<void> => {
  const query = GetOpponentPlayersByOpponentQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { seasonId, club, lastN } = query.data;
  const isAll = club === "__ALL__";

  // League matches for the season → match-id → { home, away, date }
  const matches = await db
    .select({ matchId: leagueMatchesTable.matchId, homeTeam: leagueMatchesTable.homeTeam, awayTeam: leagueMatchesTable.awayTeam, matchDate: leagueMatchesTable.matchDate })
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));

  if (!matches.length) { res.json(GetOpponentPlayersByOpponentResponse.parse({ opponents: [], players: [] })); return; }

  const matchInfo = new Map<string, { home: string | null; away: string | null; date: string | null }>();
  for (const m of matches) matchInfo.set(m.matchId, { home: m.homeTeam, away: m.awayTeam, date: m.matchDate ?? null });

  // Matches relevant to this view (club appears, or all matches for __ALL__)
  const relevant = isAll ? matches : matches.filter(m => m.homeTeam === club || m.awayTeam === club);

  // Optional "last N rounds" window (by most-recent match dates)
  let relevantIds: Set<string>;
  if (lastN != null && lastN > 0) {
    if (isAll) {
      const dates = Array.from(new Set(relevant.map(m => m.matchDate ?? "").filter(Boolean)))
        .sort((a, b) => b.localeCompare(a)).slice(0, lastN);
      const dateSet = new Set(dates);
      relevantIds = new Set(relevant.filter(m => dateSet.has(m.matchDate ?? "")).map(m => m.matchId));
    } else {
      relevantIds = new Set(
        relevant.slice().sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? "")).slice(0, lastN).map(m => m.matchId),
      );
    }
  } else {
    relevantIds = new Set(relevant.map(m => m.matchId));
  }

  if (relevantIds.size === 0) { res.json(GetOpponentPlayersByOpponentResponse.parse({ opponents: [], players: [] })); return; }
  const relevantList = Array.from(relevantIds);

  // opponent club a given owning club faced in a match
  const opponentOf = (matchId: string, ownClub: string | null): string | null => {
    const info = matchInfo.get(matchId);
    if (!info || !ownClub) return null;
    if (info.home === ownClub) return info.away;
    if (info.away === ownClub) return info.home;
    return null;
  };

  // Minutes: player → opponent → mins, and player → total mins (club's players only)
  const ps = await db
    .select({ playerName: leaguePlayerStatsTable.playerName, matchId: leaguePlayerStatsTable.matchId, minsPlayed: leaguePlayerStatsTable.minsPlayed, started: leaguePlayerStatsTable.started, appearance: leaguePlayerStatsTable.appearance, club: leaguePlayerStatsTable.club })
    .from(leaguePlayerStatsTable)
    .where(and(eq(leaguePlayerStatsTable.seasonId, seasonId), inArray(leaguePlayerStatsTable.matchId, relevantList)));

  const minsByPlayerOpp: Record<string, Record<string, number>> = {};
  const totalMinsByPlayer: Record<string, number> = {};
  const totalStartsByPlayer: Record<string, number> = {};
  const totalAppsByPlayer: Record<string, number> = {};
  // Full roster (everyone who featured), not just scorers — powers the Starts &
  // Appearances + Total Minutes charts, which must include non-scoring players.
  const roster = new Set<string>();
  for (const r of ps) {
    if (!r.playerName) continue;
    if (!isAll && r.club !== club) continue;
    const opp = opponentOf(r.matchId, r.club);
    if (!opp) continue;
    roster.add(r.playerName);
    (minsByPlayerOpp[r.playerName] ??= {})[opp] = (minsByPlayerOpp[r.playerName][opp] ?? 0) + (r.minsPlayed ?? 0);
    totalMinsByPlayer[r.playerName] = (totalMinsByPlayer[r.playerName] ?? 0) + (r.minsPlayed ?? 0);
    if (r.started) totalStartsByPlayer[r.playerName] = (totalStartsByPlayer[r.playerName] ?? 0) + 1;
    if (r.appearance) totalAppsByPlayer[r.playerName] = (totalAppsByPlayer[r.playerName] ?? 0) + 1;
  }

  // Goals + assists: player → opponent → count (attributed to the SCORING club's players)
  const goals = await db
    .select({ matchId: leagueGoalsTable.matchId, homeTeam: leagueGoalsTable.homeTeam, awayTeam: leagueGoalsTable.awayTeam, scorerTeam: leagueGoalsTable.scorerTeam, scorer: leagueGoalsTable.scorer, assist: leagueGoalsTable.assist })
    .from(leagueGoalsTable)
    .where(and(eq(leagueGoalsTable.seasonId, seasonId), inArray(leagueGoalsTable.matchId, relevantList)));

  const goalsByPlayerOpp: Record<string, Record<string, number>> = {};
  const assistsByPlayerOpp: Record<string, Record<string, number>> = {};
  for (const g of goals) {
    const scoring = g.scorerTeam;
    if (!scoring) continue;
    if (!isAll && scoring !== club) continue;
    const opp = scoring === g.homeTeam ? g.awayTeam : (scoring === g.awayTeam ? g.homeTeam : opponentOf(g.matchId, scoring));
    if (!opp) continue;
    // "OG" = own goal — credited to the team, not an individual player, so exclude it.
    if (g.scorer && g.scorer !== "OG") (goalsByPlayerOpp[g.scorer] ??= {})[opp] = (goalsByPlayerOpp[g.scorer][opp] ?? 0) + 1;
    if (g.assist && g.assist !== "OG") (assistsByPlayerOpp[g.assist] ??= {})[opp] = (assistsByPlayerOpp[g.assist][opp] ?? 0) + 1;
  }

  // Build per-player rows for everyone with a goal/assist OR who featured on the roster.
  // Roster-only players (non-scorers) carry starts/apps/minutes for the squad charts;
  // the stacked goal/assist charts filter them out client-side (metric total = 0).
  const contributors = new Set([...Object.keys(goalsByPlayerOpp), ...Object.keys(assistsByPlayerOpp), ...roster]);
  const allOpponentsSet = new Set<string>();
  const players = Array.from(contributors).map(playerName => {
    const g = goalsByPlayerOpp[playerName] ?? {};
    const a = assistsByPlayerOpp[playerName] ?? {};
    const mins = minsByPlayerOpp[playerName] ?? {};
    const opps = new Set([...Object.keys(g), ...Object.keys(a)]);
    const byOpponent: Record<string, { goals: number; assists: number; minsPlayed: number }> = {};
    for (const opp of opps) {
      allOpponentsSet.add(opp);
      byOpponent[opp] = { goals: g[opp] ?? 0, assists: a[opp] ?? 0, minsPlayed: mins[opp] ?? 0 };
    }
    const totalGoals = Object.values(g).reduce((s, v) => s + v, 0);
    const totalAssists = Object.values(a).reduce((s, v) => s + v, 0);
    return {
      playerName,
      totalMins: totalMinsByPlayer[playerName] ?? 0,
      totalGoals, totalAssists,
      totalStarts: totalStartsByPlayer[playerName] ?? 0,
      totalApps: totalAppsByPlayer[playerName] ?? 0,
      byOpponent,
    };
  }).sort((x, y) => (y.totalGoals + y.totalAssists) - (x.totalGoals + x.totalAssists));

  const opponents = Array.from(allOpponentsSet).sort();
  res.json(GetOpponentPlayersByOpponentResponse.parse({ opponents, players }));
});

// ─── Opponent Goal Combos (a selected club's assist→scorer partnerships) ───────

router.get("/analytics/opponent-goal-combos", async (req, res): Promise<void> => {
  const query = GetOpponentGoalCombosQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { seasonId, club, lastN } = query.data;
  const isAll = club === "__ALL__";

  const matches = await db
    .select({ matchId: leagueMatchesTable.matchId, homeTeam: leagueMatchesTable.homeTeam, awayTeam: leagueMatchesTable.awayTeam, matchDate: leagueMatchesTable.matchDate })
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));
  if (!matches.length) { res.json(GetOpponentGoalCombosResponse.parse({ combos: [], totalGoals: 0, assistedGoals: 0 })); return; }

  const relevant = isAll ? matches : matches.filter(m => m.homeTeam === club || m.awayTeam === club);
  // Optional "last N rounds" window. For a single club, N most-recent matches == N rounds.
  // League-wide (__ALL__) has multiple fixtures per round, so window by distinct dates.
  let relevantIds: Set<string>;
  if (lastN != null && lastN > 0) {
    if (isAll) {
      const dates = Array.from(new Set(relevant.map(m => m.matchDate ?? "").filter(Boolean)))
        .sort((a, b) => b.localeCompare(a)).slice(0, lastN);
      const dateSet = new Set(dates);
      relevantIds = new Set(relevant.filter(m => dateSet.has(m.matchDate ?? "")).map(m => m.matchId));
    } else {
      relevantIds = new Set(
        relevant.slice().sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? "")).slice(0, lastN).map(m => m.matchId),
      );
    }
  } else {
    relevantIds = new Set(relevant.map(m => m.matchId));
  }
  if (relevantIds.size === 0) { res.json(GetOpponentGoalCombosResponse.parse({ combos: [], totalGoals: 0, assistedGoals: 0 })); return; }
  const relevantList = Array.from(relevantIds);

  const goals = await db
    .select({ scorer: leagueGoalsTable.scorer, assist: leagueGoalsTable.assist, scorerTeam: leagueGoalsTable.scorerTeam })
    .from(leagueGoalsTable)
    .where(and(eq(leagueGoalsTable.seasonId, seasonId), inArray(leagueGoalsTable.matchId, relevantList)));

  // Only the selected club's OWN goals (their scorers/assisters), unless __ALL__.
  const clubGoals = isAll ? goals : goals.filter(g => g.scorerTeam === club);
  res.json(GetOpponentGoalCombosResponse.parse(buildCombos(clubGoals)));
});

// ─── Opponent Player Scoring DNA (radar) ───────────────────────────────────────
// Same radar as /analytics/player-dna, but for a selected club's players, computed
// from the whole-league tables: their goals AND minutes across ALL league games
// (league_player_stats covers every club), so per-90 spokes work here too. The
// "squad" used for scaling is the selected club's roster (or the whole league
// for __ALL__).
router.get("/analytics/opponent-player-dna", async (req, res): Promise<void> => {
  const query = GetOpponentPlayerDnaQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { seasonId, club, player, lastN } = query.data;
  const isAll = club === "__ALL__";

  const matches = await db
    .select({ matchId: leagueMatchesTable.matchId, homeTeam: leagueMatchesTable.homeTeam, awayTeam: leagueMatchesTable.awayTeam, matchDate: leagueMatchesTable.matchDate })
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));
  const relevant = isAll ? matches : matches.filter(m => m.homeTeam === club || m.awayTeam === club);

  // Optional "last N rounds" window. Single club: N most-recent matches == N rounds.
  // League-wide (__ALL__) has multiple fixtures per round, so window by distinct dates.
  let relevantIds: Set<string>;
  if (lastN != null && lastN > 0) {
    if (isAll) {
      const dates = Array.from(new Set(relevant.map(m => m.matchDate ?? "").filter(Boolean)))
        .sort((a, b) => b.localeCompare(a)).slice(0, lastN);
      const dateSet = new Set(dates);
      relevantIds = new Set(relevant.filter(m => dateSet.has(m.matchDate ?? "")).map(m => m.matchId));
    } else {
      relevantIds = new Set(
        relevant.slice().sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? "")).slice(0, lastN).map(m => m.matchId),
      );
    }
  } else {
    relevantIds = new Set(relevant.map(m => m.matchId));
  }
  if (relevantIds.size === 0) { res.json(GetOpponentPlayerDnaResponse.parse(emptyDnaResponse(player))); return; }
  const relevantList = Array.from(relevantIds);

  // Minutes + appearances from the league player stats; roster = the club's players
  // (club column carries the club name for every side in the league).
  const stats = await db
    .select({ playerName: leaguePlayerStatsTable.playerName, minsPlayed: leaguePlayerStatsTable.minsPlayed, appearance: leaguePlayerStatsTable.appearance, club: leaguePlayerStatsTable.club })
    .from(leaguePlayerStatsTable)
    .where(and(eq(leaguePlayerStatsTable.seasonId, seasonId), inArray(leaguePlayerStatsTable.matchId, relevantList)));
  const clubStats = isAll ? stats : stats.filter(s => s.club === club);

  const minsMap = new Map<string, number>();
  const appsMap = new Map<string, number>();
  for (const s of clubStats) {
    minsMap.set(s.playerName, (minsMap.get(s.playerName) ?? 0) + (s.minsPlayed ?? 0));
    if (s.appearance) appsMap.set(s.playerName, (appsMap.get(s.playerName) ?? 0) + 1);
  }
  const roster = new Set(clubStats.map(s => s.playerName));

  const goals = await db
    .select({
      scorer: leagueGoalsTable.scorer, assist: leagueGoalsTable.assist, scorerTeam: leagueGoalsTable.scorerTeam,
      homeTeam: leagueGoalsTable.homeTeam, awayTeam: leagueGoalsTable.awayTeam,
      finishType: leagueGoalsTable.finishType, firstTimeFinish: leagueGoalsTable.firstTimeFinish,
      goalX: leagueGoalsTable.goalX, goalY: leagueGoalsTable.goalY,
      matchId: leagueGoalsTable.matchId,
    })
    .from(leagueGoalsTable)
    .where(and(eq(leagueGoalsTable.seasonId, seasonId), inArray(leagueGoalsTable.matchId, relevantList)));

  // Only the selected club's OWN goals, unless __ALL__ (league-wide scaling).
  const clubGoals = isAll ? goals : goals.filter(g => g.scorerTeam === club);
  const dnaGoals: DnaGoalRow[] = clubGoals.map(g => ({
    scorer: g.scorer, assist: g.assist, finishType: g.finishType, firstTimeFinish: g.firstTimeFinish,
    goalX: g.goalX, goalY: g.goalY,
    // Favourite-opponent callout: the other side in that fixture.
    opponentLabel: g.scorerTeam === g.homeTeam ? g.awayTeam : g.homeTeam,
  }));
  res.json(GetOpponentPlayerDnaResponse.parse(computeDnaResponse({ player, roster, minsMap, appsMap, goals: dnaGoals })));
});

// ─── Coach Behaviour: first substitution (any club, whole-league data) ─────────
// Ported from the original Dash app's "Coach Behaviour" summary. Sub minute is
// inferred as 90 − minutes played for non-starters who appeared (same as the
// original). Per match: the earliest sub is "the first change"; game state is
// the scoreline strictly BEFORE that minute; impact is goals in the 15 minutes
// after it; result comes from league_matches scores relative to the club.
router.get("/analytics/opponent-first-sub", async (req, res): Promise<void> => {
  const query = GetOpponentFirstSubQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { seasonId, club } = query.data;

  const empty = { matchesTracked: 0, avgFirstSubMinute: null, subsPerMatch: null, preferredPlayer: null, preferredCount: 0, entries: [], byState: [] };
  // Game state & first-change logic are club-relative, so no __ALL__ view here.
  if (club === "__ALL__") { res.json(GetOpponentFirstSubResponse.parse(empty)); return; }

  const matches = await db
    .select()
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));
  const clubMatches = new Map(matches.filter(m => m.homeTeam === club || m.awayTeam === club).map(m => [m.matchId, m]));
  if (clubMatches.size === 0) { res.json(GetOpponentFirstSubResponse.parse(empty)); return; }
  const matchIds = Array.from(clubMatches.keys());

  const lps = await db
    .select({ matchId: leaguePlayerStatsTable.matchId, playerName: leaguePlayerStatsTable.playerName, minsPlayed: leaguePlayerStatsTable.minsPlayed, started: leaguePlayerStatsTable.started, appearance: leaguePlayerStatsTable.appearance })
    .from(leaguePlayerStatsTable)
    .where(and(eq(leaguePlayerStatsTable.seasonId, seasonId), eq(leaguePlayerStatsTable.club, club), inArray(leaguePlayerStatsTable.matchId, matchIds)));

  // Substitutes = appeared but did not start. Sub minute = 90 − minutes played.
  const subs = lps
    .filter(r => r.appearance && !r.started && r.minsPlayed != null)
    .map(r => ({ matchId: r.matchId, player: r.playerName, minute: 90 - (r.minsPlayed as number) }))
    .filter(s => s.minute >= 0 && s.minute <= 90);
  if (subs.length === 0) { res.json(GetOpponentFirstSubResponse.parse(empty)); return; }

  // First sub per match (earliest minute; ties broken by name for determinism).
  const firstByMatch = new Map<string, { player: string; minute: number }>();
  for (const s of subs.slice().sort((a, b) => a.minute - b.minute || a.player.localeCompare(b.player))) {
    if (!firstByMatch.has(s.matchId)) firstByMatch.set(s.matchId, { player: s.player, minute: s.minute });
  }

  const goals = await db
    .select({ matchId: leagueGoalsTable.matchId, minuteScored: leagueGoalsTable.minuteScored, scorerTeam: leagueGoalsTable.scorerTeam })
    .from(leagueGoalsTable)
    .where(and(eq(leagueGoalsTable.seasonId, seasonId), inArray(leagueGoalsTable.matchId, matchIds)));
  const goalsByMatch = new Map<string, { minute: number; forClub: boolean }[]>();
  for (const g of goals) {
    if (g.minuteScored == null) continue;
    const arr = goalsByMatch.get(g.matchId) ?? [];
    arr.push({ minute: g.minuteScored, forClub: g.scorerTeam === club });
    goalsByMatch.set(g.matchId, arr);
  }

  const entries = Array.from(firstByMatch.entries()).map(([matchId, fs]) => {
    const m = clubMatches.get(matchId)!;
    const isHome = m.homeTeam === club;
    const opponent = isHome ? m.awayTeam : m.homeTeam;
    const mg = goalsByMatch.get(matchId) ?? [];

    const before = mg.filter(g => g.minute < fs.minute);
    const gf = before.filter(g => g.forClub).length;
    const ga = before.length - gf;
    const gameState = gf > ga ? "Winning" : gf < ga ? "Losing" : "Drawing";

    const window = mg.filter(g => g.minute > fs.minute && g.minute <= fs.minute + 15);
    const goalsFor15 = window.filter(g => g.forClub).length;
    const goalsAgainst15 = window.length - goalsFor15;

    // Final result: prefer the recorded score; if it's missing, reconstruct the
    // scoreline from the goal records so null scores don't masquerade as draws.
    let ourGoals: number, theirGoals: number;
    if (m.homeGoals != null && m.awayGoals != null) {
      ourGoals = isHome ? m.homeGoals : m.awayGoals;
      theirGoals = isHome ? m.awayGoals : m.homeGoals;
    } else {
      ourGoals = mg.filter(g => g.forClub).length;
      theirGoals = mg.length - ourGoals;
    }
    const result = ourGoals > theirGoals ? "W" : ourGoals < theirGoals ? "L" : "D";

    return { matchId, opponent, matchDate: m.matchDate ?? null, minute: fs.minute, player: fs.player, gameState, result, goalsFor15, goalsAgainst15 };
  }).sort((a, b) => (a.matchDate ?? "").localeCompare(b.matchDate ?? ""));

  const avg = entries.reduce((s, e) => s + e.minute, 0) / entries.length;
  const subsPerMatch = subs.length / firstByMatch.size;

  // Preferred first substitute: most frequent first change (threshold applied client-side text; ≥3 = trusted).
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.player, (counts.get(e.player) ?? 0) + 1);
  const [prefPlayer, prefCount] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

  const byState = (["Winning", "Drawing", "Losing"] as const)
    .map(state => {
      const rows = entries.filter(e => e.gameState === state);
      if (!rows.length) return null;
      return {
        state,
        matches: rows.length,
        avgMinute: rows.reduce((s, e) => s + e.minute, 0) / rows.length,
        goalsFor: rows.reduce((s, e) => s + e.goalsFor15, 0),
        goalsAgainst: rows.reduce((s, e) => s + e.goalsAgainst15, 0),
        noGoal: rows.filter(e => e.goalsFor15 === 0 && e.goalsAgainst15 === 0).length,
        wins: rows.filter(e => e.result === "W").length,
        draws: rows.filter(e => e.result === "D").length,
        losses: rows.filter(e => e.result === "L").length,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s != null);

  res.json(GetOpponentFirstSubResponse.parse({
    matchesTracked: entries.length,
    avgFirstSubMinute: avg,
    subsPerMatch,
    preferredPlayer: prefPlayer,
    preferredCount: prefCount,
    entries,
    byState,
  }));
});

// ─── Opponent Profile (club-centric scouting across ALL their league games) ────

const INTERVAL_LABELS = ["1-15", "16-30", "31-45", "46-60", "61-75", "76-90", "90+"];
function intervalLabel(minute: number | null): string | null {
  if (minute == null) return null;
  if (minute > 90) return "90+";
  const idx = Math.floor((Math.max(minute, 1) - 1) / 15);
  return INTERVAL_LABELS[Math.min(idx, 5)];
}

// Per-player season aggregate. `club=null` = whole league (for the __ALL__ view).
// Minutes/starts/appearances come from league_player_stats; goals/assists from league_goals.
type LeaguePlayerRow = typeof leaguePlayerStatsTable.$inferSelect;
type LeagueGoalRow = typeof leagueGoalsTable.$inferSelect;
function buildOpponentPlayers(lps: LeaguePlayerRow[], goals: LeagueGoalRow[], club: string | null) {
  const agg: Record<string, { club: string | null; mins: number; starts: number; apps: number; goals: number; assists: number }> = {};
  const ensure = (name: string, c: string | null) => (agg[name] ??= { club: c, mins: 0, starts: 0, apps: 0, goals: 0, assists: 0 });
  for (const r of lps) {
    if (club && r.club !== club) continue;
    if (!r.playerName) continue;
    const e = ensure(r.playerName, r.club);
    e.mins += r.minsPlayed ?? 0;
    if (r.started) e.starts++;
    if (r.appearance) e.apps++;
  }
  for (const g of goals) {
    if (club && g.scorerTeam !== club) continue;
    if (g.scorer) ensure(g.scorer, g.scorerTeam).goals++;
    if (g.assist) ensure(g.assist, g.scorerTeam).assists++;
  }
  return Object.entries(agg)
    .map(([playerName, e]) => ({ playerName, club: e.club, minsPlayed: e.mins, starts: e.starts, appearances: e.apps, goals: e.goals, assists: e.assists }))
    .sort((a, b) => b.minsPlayed - a.minsPlayed);
}

// One player's game-by-game involvement across their club's whole league season.
// Every club fixture appears — even ones the player missed — so gaps are visible.
router.get("/analytics/player-timeline", async (req, res): Promise<void> => {
  const query = GetPlayerTimelineQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { seasonId, club, player } = query.data;

  const fixtures = (await db
    .select()
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId)))
    .filter(m => m.homeTeam === club || m.awayTeam === club)
    .sort((a, b) => (a.matchDate ?? "").localeCompare(b.matchDate ?? ""));

  const rows = fixtures.length === 0 ? [] : await db
    .select({ matchId: leaguePlayerStatsTable.matchId, minsPlayed: leaguePlayerStatsTable.minsPlayed, started: leaguePlayerStatsTable.started, appearance: leaguePlayerStatsTable.appearance })
    .from(leaguePlayerStatsTable)
    .where(and(
      eq(leaguePlayerStatsTable.seasonId, seasonId),
      eq(leaguePlayerStatsTable.club, club),
      eq(leaguePlayerStatsTable.playerName, player),
      inArray(leaguePlayerStatsTable.matchId, fixtures.map(f => f.matchId)),
    ));
  const byMatch = new Map(rows.map(r => [r.matchId, r]));

  res.json(GetPlayerTimelineResponse.parse({
    player,
    club,
    matches: fixtures.map(f => {
      const r = byMatch.get(f.matchId);
      const status = r?.started ? "start" : r?.appearance ? "bench" : "out";
      return {
        matchId: f.matchId,
        matchDate: f.matchDate ?? null,
        opponent: f.homeTeam === club ? f.awayTeam : f.homeTeam,
        status,
        minutes: r?.minsPlayed ?? 0,
      };
    }),
  }));
});

router.get("/analytics/opponent-profile", async (req, res): Promise<void> => {
  const query = GetOpponentProfileQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { seasonId, club } = query.data;

  const allMatches = await db
    .select()
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));

  const goals = await db
    .select()
    .from(leagueGoalsTable)
    .where(eq(leagueGoalsTable.seasonId, seasonId));

  const lps = await db
    .select()
    .from(leaguePlayerStatsTable)
    .where(eq(leaguePlayerStatsTable.seasonId, seasonId));

  // ── ALL (league-wide) view ──────────────────────────────────────────────
  // Sentinel club="__ALL__": aggregate every league goal, stacked by the club
  // that scored (scored*) and the club that conceded (conceded*). Record and
  // match-history are club-relative, so they are left empty for this view.
  if (club === "__ALL__") {
    const scoredIntAll: Record<string, Record<string, number>> = {};
    const concededIntAll: Record<string, Record<string, number>> = {};
    const scoredTypeAll: Record<string, Record<string, number>> = {};
    const concededTypeAll: Record<string, Record<string, number>> = {};
    const topScorersAll: Record<string, number> = {};
    const clubSet = new Set<string>();
    const bumpAll = (b: Record<string, Record<string, number>>, k: string, c: string) => {
      (b[k] ??= {})[c] = (b[k][c] ?? 0) + 1;
    };
    for (const g of goals) {
      if (!g.scorerTeam || !g.homeTeam || !g.awayTeam) continue;
      const scoring = g.scorerTeam;
      const conceding = g.scorerTeam === g.homeTeam ? g.awayTeam : g.homeTeam;
      clubSet.add(scoring); clubSet.add(conceding);
      const interval = intervalLabel(g.minuteScored);
      const type = g.goalType ?? "Unknown";
      if (interval) { bumpAll(scoredIntAll, interval, scoring); bumpAll(concededIntAll, interval, conceding); }
      bumpAll(scoredTypeAll, type, scoring);
      bumpAll(concededTypeAll, type, conceding);
      if (g.scorer) topScorersAll[g.scorer] = (topScorersAll[g.scorer] ?? 0) + 1;
    }
    const toIntAll = (data: Record<string, Record<string, number>>) =>
      INTERVAL_LABELS.filter(l => data[l]).map(label => ({
        label, total: Object.values(data[label]).reduce((s, v) => s + v, 0), byOpponent: data[label],
      }));
    const toTypeAll = (data: Record<string, Record<string, number>>) =>
      Object.entries(data)
        .map(([label, byOpponent]) => ({ label, total: Object.values(byOpponent).reduce((s, v) => s + v, 0), byOpponent }))
        .sort((a, b) => b.total - a.total);
    const scorersAll = Object.entries(topScorersAll)
      .map(([scorer, g]) => ({ scorer, goals: g }))
      .sort((a, b) => b.goals - a.goals);
    const totalGoals = goals.length;
    // Every league goal, from the SCORING club's perspective (side always "scored",
    // opponent = the scoring club) so the league-wide scored detail + pies stack by club.
    const allRawGoals = goals
      .filter(g => g.scorerTeam)
      .map(g => ({
        matchId: g.matchId,
        matchDate: g.matchDate ?? null,
        minuteScored: g.minuteScored ?? null,
        side: "scored",
        opponent: g.scorerTeam!,
        scorer: g.scorer ?? null,
        assist: g.assist ?? null,
        goalType: g.goalType ?? null,
        assistType: g.assistType ?? null,
        howPenetrated: g.howPenetrated ?? null,
        buildupLane: g.buildupLane ?? null,
        firstTimeFinish: g.firstTimeFinish ?? null,
        finishType: g.finishType ?? null,
        passString: g.passString ?? null,
        goalX: g.goalX ?? null,
        goalY: g.goalY ?? null,
      }));
    res.json(GetOpponentProfileResponse.parse({
      club: "__ALL__",
      opponents: Array.from(clubSet).sort(),
      record: { played: allMatches.length, won: 0, drawn: 0, lost: 0, goalsFor: totalGoals, goalsAgainst: totalGoals, goalDiff: 0, points: 0, position: null },
      matches: [],
      scoredByInterval: toIntAll(scoredIntAll),
      concededByInterval: toIntAll(concededIntAll),
      scoredByType: toTypeAll(scoredTypeAll),
      concededByType: toTypeAll(concededTypeAll),
      topScorers: scorersAll,
      goals: allRawGoals,
      players: buildOpponentPlayers(lps, goals, null),
      playersLast3: [], // club-relative window — meaningless league-wide
    }));
    return;
  }

  // ── Full-league standings (to derive this club's league position) ──
  type Row = { won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number };
  const standings: Record<string, Row> = {};
  const ensure = (n: string): Row => (standings[n] ??= { won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });
  for (const m of allMatches) {
    if (m.homeGoals == null || m.awayGoals == null) continue;
    const h = ensure(m.homeTeam), a = ensure(m.awayTeam);
    h.goalsFor += m.homeGoals; h.goalsAgainst += m.awayGoals;
    a.goalsFor += m.awayGoals; a.goalsAgainst += m.homeGoals;
    if (m.homeGoals > m.awayGoals) { h.won++; a.lost++; }
    else if (m.homeGoals < m.awayGoals) { a.won++; h.lost++; }
    else { h.drawn++; a.drawn++; }
  }
  const table = Object.entries(standings)
    .map(([name, s]) => ({ name, points: s.won * 3 + s.drawn, gd: s.goalsFor - s.goalsAgainst, gf: s.goalsFor }))
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
  const position = table.findIndex(t => t.name === club) + 1;

  // ── This club's fixtures ──
  const clubMatches = allMatches.filter(m => m.homeTeam === club || m.awayTeam === club);
  const getResult = (gf: number, ga: number): "W" | "D" | "L" => (gf > ga ? "W" : gf < ga ? "L" : "D");

  const matches = clubMatches
    .slice()
    .sort((a, b) => (a.matchDate ?? "").localeCompare(b.matchDate ?? ""))
    .map(m => {
      const isHome = m.homeTeam === club;
      const scored = (isHome ? m.homeGoals : m.awayGoals) ?? 0;
      const conceded = (isHome ? m.awayGoals : m.homeGoals) ?? 0;
      return {
        matchId: m.matchId,
        matchDate: m.matchDate ?? null,
        opponent: isHome ? m.awayTeam : m.homeTeam,
        homeAway: isHome ? "H" : "A",
        scored, conceded,
        result: getResult(scored, conceded),
      };
    });

  const record = {
    played: matches.length,
    won: matches.filter(m => m.result === "W").length,
    drawn: matches.filter(m => m.result === "D").length,
    lost: matches.filter(m => m.result === "L").length,
    goalsFor: matches.reduce((s, m) => s + m.scored, 0),
    goalsAgainst: matches.reduce((s, m) => s + m.conceded, 0),
    goalDiff: 0,
    points: 0,
    position: position > 0 ? position : null,
  };
  record.goalDiff = record.goalsFor - record.goalsAgainst;
  record.points = record.won * 3 + record.drawn;

  // ── Goals in this club's matches, split scored/conceded + stacked by opponent ──
  const opponentsSet = new Set<string>();
  const scoredInt: Record<string, Record<string, number>> = {};
  const concededInt: Record<string, Record<string, number>> = {};
  const scoredType: Record<string, Record<string, number>> = {};
  const concededType: Record<string, Record<string, number>> = {};
  const topScorers: Record<string, number> = {};

  const bump = (bucket: Record<string, Record<string, number>>, key: string, opp: string) => {
    (bucket[key] ??= {})[opp] = (bucket[key][opp] ?? 0) + 1;
  };

  for (const g of goals) {
    if (!g.homeTeam || !g.awayTeam) continue;
    if (g.homeTeam !== club && g.awayTeam !== club) continue;
    const opponent = g.homeTeam === club ? g.awayTeam : g.homeTeam;
    opponentsSet.add(opponent);
    const scoredByClub = g.scorerTeam === club;
    const interval = intervalLabel(g.minuteScored);
    const type = g.goalType ?? "Unknown";
    if (scoredByClub) {
      if (interval) bump(scoredInt, interval, opponent);
      bump(scoredType, type, opponent);
      if (g.scorer) topScorers[g.scorer] = (topScorers[g.scorer] ?? 0) + 1;
    } else {
      if (interval) bump(concededInt, interval, opponent);
      bump(concededType, type, opponent);
    }
  }

  const opponents = Array.from(opponentsSet).sort();

  const toIntervalBuckets = (data: Record<string, Record<string, number>>) =>
    INTERVAL_LABELS.filter(l => data[l]).map(label => {
      const byOpponent = data[label];
      return { label, total: Object.values(byOpponent).reduce((s, v) => s + v, 0), byOpponent };
    });

  const toTypeBuckets = (data: Record<string, Record<string, number>>) =>
    Object.entries(data)
      .map(([label, byOpponent]) => ({ label, total: Object.values(byOpponent).reduce((s, v) => s + v, 0), byOpponent }))
      .sort((a, b) => b.total - a.total);

  const scorers = Object.entries(topScorers)
    .map(([scorer, g]) => ({ scorer, goals: g }))
    .sort((a, b) => b.goals - a.goals);

  // ── Raw goals in this club's matches (club-relative side + opponent) ──
  const rawGoals = goals
    .filter(g => g.homeTeam && g.awayTeam && (g.homeTeam === club || g.awayTeam === club))
    .map(g => ({
      matchId: g.matchId,
      matchDate: g.matchDate ?? null,
      minuteScored: g.minuteScored ?? null,
      side: g.scorerTeam === club ? "scored" : "conceded",
      opponent: g.homeTeam === club ? g.awayTeam! : g.homeTeam!,
      scorer: g.scorer ?? null,
      assist: g.assist ?? null,
      goalType: g.goalType ?? null,
      assistType: g.assistType ?? null,
      howPenetrated: g.howPenetrated ?? null,
      buildupLane: g.buildupLane ?? null,
      firstTimeFinish: g.firstTimeFinish ?? null,
      finishType: g.finishType ?? null,
      passString: g.passString ?? null,
      goalX: g.goalX ?? null,
      goalY: g.goalY ?? null,
    }));

  res.json(GetOpponentProfileResponse.parse({
    club,
    opponents,
    record,
    matches,
    scoredByInterval: toIntervalBuckets(scoredInt),
    concededByInterval: toIntervalBuckets(concededInt),
    scoredByType: toTypeBuckets(scoredType),
    concededByType: toTypeBuckets(concededType),
    topScorers: scorers,
    goals: rawGoals,
    players: buildOpponentPlayers(lps, goals, club),
    playersLast3: (() => {
      // Same aggregate, restricted to the club's 3 most-recent fixtures.
      const last3 = new Set(
        clubMatches
          .slice()
          .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""))
          .slice(0, 3)
          .map(m => m.matchId),
      );
      return buildOpponentPlayers(
        lps.filter(r => last3.has(r.matchId)),
        goals.filter(g => last3.has(g.matchId)),
        club,
      );
    })(),
  }));
});

export default router;
