import { Router, type IRouter } from "express";
import { eq, and, sql, inArray, desc, ne, isNotNull } from "drizzle-orm";
import { db, matchesTable, goalsTable, playerStatsTable, gpsSessionsTable, gpsPlayerAliasesTable, gpsPlayerPositionsTable, teamsTable, seasonsTable, leagueMatchesTable, leagueGoalsTable, leaguePlayerStatsTable } from "@workspace/db";
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
  GetOpponentOnfieldImpactQueryParams,
  GetOpponentOnfieldImpactResponse,
  GetSubImpactQueryParams,
  GetSubImpactResponse,
  GetOpponentProfileQueryParams,
  GetOpponentMatchReportQueryParams,
  GetPlayerTimelineQueryParams,
  GetPlayerTimelineResponse,
  GetOpponentProfileResponse,
  GetOpponentPlayersByOpponentQueryParams,
  GetPlayerImpactQueryParams,
  GetPlayerImpactResponse,
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
  GetMatchReportQueryParams,
  GetMatchReportResponse,
  GetClutchGoalsQueryParams,
  GetClutchGoalsResponse,
  GetUnitBreakdownQueryParams,
  GetUnitBreakdownResponse,
  unitForPosition,
  asUnit,
  GetOpponentClutchGoalsQueryParams,
  GetOpponentClutchGoalsResponse,
} from "@workspace/api-zod";
import { focusClubForRequest } from "../lib/focusClub";
import { buildDnaStory, dnaCatOfType, dnaCatLabel } from "../lib/goalDnaStory";

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
  focusClub: string,
): boolean => (!!scorer && roster.has(scorer)) || scorerTeam === focusClub;

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
  const focusClub = await focusClubForRequest(req, seasonId);

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
  const goals = await db
    .select()
    .from(goalsTable)
    .where(and(eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId)));

  const focusGoals = goals.filter(g => g.scorerTeam === focusClub);
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
  const focusClub = await focusClubForRequest(req, seasonId);

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
      eq(playerStatsTable.club, focusClub),
    ));

  // Goals for scorer/assist tallying — filter by matchIds so lastN applies to goals too
  const goalConditions = [eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId), inArray(goalsTable.matchId, matchIds)];
  const goals = await db.select().from(goalsTable).where(and(...goalConditions));

  // Minute-window on-field GD (same model as the Opponent Insights impact chart):
  // classify each goal as ours/theirs via the roster (never trust scorerTeam
  // spelling alone), group per match, and work out each match's effective length.
  const seasonRoster = new Set(stats.map(s => s.playerName));
  const goalsByMatch = new Map<number, Array<{ ours: boolean; minute: number | null }>>();
  const matchLen = new Map<number, number>();
  for (const g of goals) {
    (goalsByMatch.get(g.matchId) ?? goalsByMatch.set(g.matchId, []).get(g.matchId)!)
      .push({ ours: isFocusGoal(g.scorer, g.scorerTeam, seasonRoster, focusClub), minute: g.minuteScored });
    if (g.minuteScored != null) matchLen.set(g.matchId, Math.max(matchLen.get(g.matchId) ?? 90, g.minuteScored));
  }
  for (const s of stats) {
    if (s.minsPlayed != null) matchLen.set(s.matchId, Math.max(matchLen.get(s.matchId) ?? 90, s.minsPlayed));
  }

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
      // Minute-window attribution: starter on [0, M]; sub on [L-M, L].
      // (A sub later subbed off again is assumed to play through to full time.)
      const L = matchLen.get(s.matchId) ?? 90;
      const mins = s.minsPlayed ?? 0;
      const winStart = s.started ? 0 : Math.max(0, L - mins);
      const winEnd = s.started ? mins : L;
      for (const g of goalsByMatch.get(s.matchId) ?? []) {
        const on = g.minute == null || mins <= 0 ? mins > 0 : g.minute >= winStart && g.minute <= winEnd;
        if (!on) continue;
        if (g.ours) e.goalsFor++; else e.goalsConceded++;
      }
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
  const focusClub = await focusClubForRequest(req, seasonId);

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

  // Form: last 5 league results per club, most recent first
  type FormEntry = { round: string; result: "W" | "D" | "L"; opponent: string; score: string };
  const formByClub: Record<string, FormEntry[]> = {};
  const played = matches
    .filter(m => /^R\d/.test(m.matchId) && m.homeGoals != null && m.awayGoals != null)
    .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""));
  for (const m of played) {
    const round = m.matchId.split("-")[0];
    const hg = m.homeGoals!, ag = m.awayGoals!;
    const add = (club: string, opp: string, gf: number, ga: number) => {
      const arr = (formByClub[club] ??= []);
      if (arr.length >= 5) return;
      arr.push({ round, result: gf > ga ? "W" : gf < ga ? "L" : "D", opponent: opp, score: `${gf}–${ga}` });
    };
    add(m.homeTeam, m.awayTeam, hg, ag);
    add(m.awayTeam, m.homeTeam, ag, hg);
  }

  const ladder = Object.entries(standings).map(([teamName, s]) => ({
    form: formByClub[teamName] ?? [],
    teamName,
    played: s.played,
    won: s.won,
    drawn: s.drawn,
    lost: s.lost,
    goalsFor: s.goalsFor,
    goalsAgainst: s.goalsAgainst,
    goalDiff: s.goalsFor - s.goalsAgainst,
    points: s.won * 3 + s.drawn,
    isFocusTeam: teamName === focusClub,
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
  const focusClub = await focusClubForRequest(req, seasonId);

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
      .where(and(inArray(playerStatsTable.matchId, seasonMatchIds), eq(playerStatsTable.club, focusClub)));
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
    const scored = inInterval.filter(g => isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub)).length;
    const conceded = inInterval.filter(g => !isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub)).length;
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
  const focusClub = await focusClubForRequest(req, seasonId);

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
    .where(and(inArray(playerStatsTable.matchId, matchIds), eq(playerStatsTable.club, focusClub)));
  const roster = new Set(stats.map(s => s.playerName));

  // Filter goals to the (possibly windowed) matchIds so lastN applies to goals too.
  const goals = await db
    .select()
    .from(goalsTable)
    .where(and(eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId), inArray(goalsTable.matchId, matchIds)));

  // Scored vs conceded via the shared attribution rule (roster OR our team label).
  const isOurs = (g: typeof goals[number]) => isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub);
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
  const focusClub = await focusClubForRequest(req, seasonId);

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
    .where(and(inArray(playerStatsTable.matchId, matchIds), eq(playerStatsTable.club, focusClub)));
  const roster = new Set(stats.map(s => s.playerName));

  const goals = await db
    .select({ scorer: goalsTable.scorer, assist: goalsTable.assist, scorerTeam: goalsTable.scorerTeam })
    .from(goalsTable)
    .where(and(eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId), inArray(goalsTable.matchId, matchIds)));

  const ourGoals = goals.filter(g => isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub));
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
  const focusClub = await focusClubForRequest(req, seasonId);

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
    .where(and(inArray(playerStatsTable.matchId, matchIds), eq(playerStatsTable.club, focusClub)));

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
  const ourGoals = goals.filter(g => isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub));

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
  const focusClub = await focusClubForRequest(req, seasonId);

  // Primary source: the league-wide match tables — every club that has played
  // this season, regardless of whether team sheets (player stats) were entered.
  const leagueRows = await db
    .select({ home: leagueMatchesTable.homeTeam, away: leagueMatchesTable.awayTeam })
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));
  const clubSet = new Set<string>();
  for (const r of leagueRows) {
    if (r.home && r.home !== focusClub) clubSet.add(r.home);
    if (r.away && r.away !== focusClub) clubSet.add(r.away);
  }

  // Fallback for seasons with no league-table data: clubs seen in team sheets.
  if (clubSet.size === 0) {
    const matches = await db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));
    const matchIds = matches.map(m => m.id);
    if (matchIds.length > 0) {
      const rows = await db
        .selectDistinct({ club: playerStatsTable.club })
        .from(playerStatsTable)
        .where(and(
          inArray(playerStatsTable.matchId, matchIds),
          ne(playerStatsTable.club, focusClub),
          isNotNull(playerStatsTable.club),
        ));
      for (const r of rows) if (r.club) clubSet.add(r.club);
    }
  }

  res.json(GetOpponentClubsResponse.parse([...clubSet].sort()));
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
  const focusClub = await focusClubForRequest(req, seasonId);

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

  // Player stats for focus-team players — builds roster + per-match minutes
  const stats = await db
    .select({ playerName: playerStatsTable.playerName, matchId: playerStatsTable.matchId, minsPlayed: playerStatsTable.minsPlayed })
    .from(playerStatsTable)
    .where(and(inArray(playerStatsTable.matchId, matchIds), eq(playerStatsTable.club, focusClub)));

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
  const focusClub = await focusClubForRequest(req, seasonId);

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
    .where(and(inArray(playerStatsTable.matchId, Array.from(clubMatchIds)), eq(playerStatsTable.club, focusClub)));
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
  const scored   = goals.filter(g => isFocusGoal(g.scorer, g.scorerTeam, belconnenRoster, focusClub)).map(toDetail);
  const conceded = goals.filter(g => !isFocusGoal(g.scorer, g.scorerTeam, belconnenRoster, focusClub)).map(toDetail);

  res.json(GetOpponentGoalBreakdownResponse.parse({ scored, conceded }));
});

// ─── Goals by Opponent (per-player, per-opponent breakdown) ───────────────────

router.get("/analytics/goals-by-opponent", async (req, res): Promise<void> => {
  const query = GetGoalsByOpponentQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { teamId, seasonId, lastN } = query.data;
  const focusClub = await focusClubForRequest(req, seasonId);

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
      eq(playerStatsTable.club, focusClub),
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

// ─── Player Impact (team record when player starts vs doesn't start) ──────────
// Scouting chart: for each player of a club (or every club league-wide), the
// team's win rate + points-per-game in games they started vs games they didn't.
// "Didn't start" splits bench (came on / unused) from out (not in the squad).

router.get("/analytics/player-impact", async (req, res): Promise<void> => {
  const query = GetPlayerImpactQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { seasonId, club, lastN, sort } = query.data;
  const isAll = club === "__ALL__";

  const matches = await db
    .select({ matchId: leagueMatchesTable.matchId, homeTeam: leagueMatchesTable.homeTeam, awayTeam: leagueMatchesTable.awayTeam, matchDate: leagueMatchesTable.matchDate, homeGoals: leagueMatchesTable.homeGoals, awayGoals: leagueMatchesTable.awayGoals })
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));
  if (!matches.length) { res.json(GetPlayerImpactResponse.parse({ totalMatches: 0, players: [] })); return; }

  const relevant = isAll ? matches : matches.filter(m => m.homeTeam === club || m.awayTeam === club);
  let windowed = relevant;
  if (lastN != null && lastN > 0) {
    if (isAll) {
      const dates = Array.from(new Set(relevant.map(m => m.matchDate ?? "").filter(Boolean)))
        .sort((a, b) => b.localeCompare(a)).slice(0, lastN);
      const dateSet = new Set(dates);
      windowed = relevant.filter(m => dateSet.has(m.matchDate ?? ""));
    } else {
      windowed = relevant.slice().sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? "")).slice(0, lastN);
    }
  }
  const windowedIds = windowed.map(m => m.matchId);
  if (windowedIds.length === 0) { res.json(GetPlayerImpactResponse.parse({ totalMatches: 0, players: [] })); return; }

  const ps = await db
    .select({ playerName: leaguePlayerStatsTable.playerName, matchId: leaguePlayerStatsTable.matchId, started: leaguePlayerStatsTable.started, appearance: leaguePlayerStatsTable.appearance, club: leaguePlayerStatsTable.club })
    .from(leaguePlayerStatsTable)
    .where(and(eq(leaguePlayerStatsTable.seasonId, seasonId), inArray(leaguePlayerStatsTable.matchId, windowedIds)));

  const roundOf = (matchId: string): number | null => {
    const m = /^R(\d+)/i.exec(matchId);
    return m ? parseInt(m[1], 10) : null;
  };

  // Per club: the games they played (with result from their perspective) and
  // per player: role in each of those games (start / bench / out).
  type ClubGame = { matchId: string; round: number | null; opponent: string | null; result: "W" | "D" | "L"; date: string };
  const gamesByClub = new Map<string, ClubGame[]>();
  for (const m of windowed) {
    if (m.homeGoals == null || m.awayGoals == null) continue;
    const sides: Array<{ own: string; opp: string; gf: number; ga: number }> = [
      { own: m.homeTeam, opp: m.awayTeam, gf: m.homeGoals, ga: m.awayGoals },
      { own: m.awayTeam, opp: m.homeTeam, gf: m.awayGoals, ga: m.homeGoals },
    ];
    for (const s of sides) {
      if (!isAll && s.own !== club) continue;
      const list = gamesByClub.get(s.own) ?? [];
      list.push({
        matchId: m.matchId, round: roundOf(m.matchId), opponent: s.opp,
        result: s.gf > s.ga ? "W" : s.gf < s.ga ? "L" : "D", date: m.matchDate ?? "",
      });
      gamesByClub.set(s.own, list);
    }
  }

  // player role per match: club → player → matchId → "start" | "bench"
  const roleByClubPlayer = new Map<string, Map<string, Map<string, "start" | "bench">>>();
  for (const r of ps) {
    if (!r.playerName || !r.club) continue;
    if (!isAll && r.club !== club) continue;
    if (!r.started && !r.appearance) {
      // listed but never used — still "bench" (in the squad, didn't start)
    }
    const byPlayer = roleByClubPlayer.get(r.club) ?? new Map<string, Map<string, "start" | "bench">>();
    const byMatch = byPlayer.get(r.playerName) ?? new Map<string, "start" | "bench">();
    byMatch.set(r.matchId, r.started ? "start" : "bench");
    byPlayer.set(r.playerName, byMatch);
    roleByClubPlayer.set(r.club, byPlayer);
  }

  type Side = { matches: number; wins: number; draws: number; losses: number; winPct: number | null; ppg: number | null; bench: number; out: number; games: Array<{ matchId: string; round: number | null; opponent: string | null; result: string; role: string }> };
  const emptySide = (): Side => ({ matches: 0, wins: 0, draws: 0, losses: 0, winPct: null, ppg: null, bench: 0, out: 0, games: [] });
  const finish = (s: Side): void => {
    if (s.matches > 0) {
      s.winPct = Math.round((s.wins / s.matches) * 1000) / 10;
      s.ppg = Math.round(((s.wins * 3 + s.draws) / s.matches) * 100) / 100;
    }
  };

  const players: Array<{ playerName: string; club: string; started: Side; notStarted: Side; diff: number | null }> = [];
  for (const [clubName, byPlayer] of roleByClubPlayer) {
    const clubGames = (gamesByClub.get(clubName) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    for (const [playerName, byMatch] of byPlayer) {
      const started = emptySide();
      const notStarted = emptySide();
      for (const g of clubGames) {
        const role = byMatch.get(g.matchId) ?? "out";
        const side = role === "start" ? started : notStarted;
        side.matches += 1;
        if (g.result === "W") side.wins += 1;
        else if (g.result === "D") side.draws += 1;
        else side.losses += 1;
        if (role === "bench") side.bench += 1;
        if (role === "out") side.out += 1;
        side.games.push({ matchId: g.matchId, round: g.round, opponent: g.opponent, result: g.result, role });
      }
      finish(started);
      finish(notStarted);
      if (started.matches === 0) continue; // never started — not meaningful here
      const diff = started.winPct != null && notStarted.winPct != null
        ? Math.round((started.winPct - notStarted.winPct) * 10) / 10
        : null;
      players.push({ playerName, club: clubName, started, notStarted, diff });
    }
  }

  // sort=gap: biggest started-vs-not swing first (players with no comparison last);
  // default: best "when starting" record first. More starts break ties (steadier sample).
  if (sort === "gap") {
    players.sort((a, b) =>
      (b.diff ?? Number.NEGATIVE_INFINITY) - (a.diff ?? Number.NEGATIVE_INFINITY)
      || (b.started.winPct ?? 0) - (a.started.winPct ?? 0)
      || b.started.matches - a.started.matches);
  } else {
    players.sort((a, b) => (b.started.winPct ?? 0) - (a.started.winPct ?? 0) || b.started.matches - a.started.matches);
  }
  // League-wide: return everyone — the client filters out hidden clubs first,
  // THEN takes its top 30, so hiding a club backfills the list instead of thinning it.
  res.json(GetPlayerImpactResponse.parse({ totalMatches: windowedIds.length, players }));
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
  // Player → set of clubs they were seen for. Same-name players at different
  // clubs already collapse into one row (name-keyed aggregation, pre-existing);
  // if that happens, show no club rather than a wrong one.
  const clubsByPlayer: Record<string, Set<string>> = {};
  for (const r of ps) {
    if (!r.playerName) continue;
    if (!isAll && r.club !== club) continue;
    const opp = opponentOf(r.matchId, r.club);
    if (!opp) continue;
    roster.add(r.playerName);
    if (r.club) (clubsByPlayer[r.playerName] ??= new Set()).add(r.club);
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
    if (g.scorer && g.scorer !== "OG") {
      (goalsByPlayerOpp[g.scorer] ??= {})[opp] = (goalsByPlayerOpp[g.scorer][opp] ?? 0) + 1;
      (clubsByPlayer[g.scorer] ??= new Set()).add(scoring);
    }
    if (g.assist && g.assist !== "OG") {
      (assistsByPlayerOpp[g.assist] ??= {})[opp] = (assistsByPlayerOpp[g.assist][opp] ?? 0) + 1;
      (clubsByPlayer[g.assist] ??= new Set()).add(scoring);
    }
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
      club: clubsByPlayer[playerName]?.size === 1 ? [...clubsByPlayer[playerName]][0] : null,
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

// ─── Unit breakdown (stats by GK / Defence / Midfield / Attack) ────────────────
//
// Groups our players' minutes/apps/starts/goals/assists by unit. The unit for a
// stat row prefers the per-game position code recorded on that row (a player may
// play a different role in any one game) and falls back to the season-long
// assigned GPS position when no game-day code was recorded.

router.get("/analytics/unit-breakdown", async (req, res): Promise<void> => {
  const query = GetUnitBreakdownQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { teamId, seasonId, lastN } = query.data;
  const focusClub = await focusClubForRequest(req, seasonId);

  let matches = await db
    .select({ id: matchesTable.id, matchDate: matchesTable.matchDate })
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
    res.json(GetUnitBreakdownResponse.parse({ units: [], gameDayRows: 0, assignedRows: 0, unknownRows: 0 }));
    return;
  }

  const stats = await db
    .select()
    .from(playerStatsTable)
    .where(and(
      inArray(playerStatsTable.matchId, matchIds),
      eq(playerStatsTable.club, focusClub),
    ));

  // Assigned GPS positions (already stored as unit names). Stats rows can use
  // short names ("Ailish") while GPS names are fuller — match on a whole word,
  // same rule the Data Entry screen uses.
  const assigned = await db.select().from(gpsPlayerPositionsTable);
  const norm = (s: string) => s.toLowerCase().trim();
  const assignedUnitFor = (statName: string) => {
    const target = norm(statName);
    if (!target) return null;
    const hit = assigned.find(a => {
      const full = norm(a.playerName);
      return full === target || full.split(/[^a-z']+/).includes(target);
    });
    return asUnit(hit?.position ?? null);
  };

  type UnitKey = "GK" | "Defender" | "Midfielder" | "Forward" | "Unassigned";
  let gameDayRows = 0, assignedRows = 0, unknownRows = 0;
  const unitOfRow = (row: { playerName: string; position: string | null }): UnitKey => {
    const gameDay = unitForPosition(row.position);
    if (gameDay) { gameDayRows++; return gameDay; }
    const fallback = assignedUnitFor(row.playerName);
    if (fallback) { assignedRows++; return fallback; }
    unknownRows++;
    return "Unassigned";
  };

  type Line = { playerName: string; minutes: number; appearances: number; starts: number; goals: number; assists: number };
  const units = new Map<UnitKey, Map<string, Line>>();
  const line = (unit: UnitKey, playerName: string): Line => {
    const bucket = units.get(unit) ?? units.set(unit, new Map()).get(unit)!;
    return bucket.get(playerName)
      ?? bucket.set(playerName, { playerName, minutes: 0, appearances: 0, starts: 0, goals: 0, assists: 0 }).get(playerName)!;
  };

  // Per (match, playerName) remember the unit played that day — goals/assists in
  // that match are then credited to the unit the player actually occupied.
  const unitInMatch = new Map<string, UnitKey>();
  for (const s of stats) {
    const unit = unitOfRow(s);
    unitInMatch.set(`${s.matchId}\u0000${s.playerName}`, unit);
    const l = line(unit, s.playerName);
    l.minutes += s.minsPlayed ?? 0;
    if (s.appearance) l.appearances++;
    if (s.started) l.starts++;
  }

  const roster = new Set(stats.map(s => s.playerName));
  const goals = await db
    .select()
    .from(goalsTable)
    .where(and(eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId), inArray(goalsTable.matchId, matchIds)));
  const creditUnit = (matchId: number, name: string): UnitKey | null =>
    unitInMatch.get(`${matchId}\u0000${name}`) ?? assignedUnitFor(name);
  for (const g of goals) {
    if (!isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub)) continue;
    if (g.scorer && g.scorer !== "OG" && roster.has(g.scorer)) {
      const u = creditUnit(g.matchId, g.scorer);
      if (u) line(u, g.scorer).goals++;
    }
    if (g.assist && g.assist !== "OG" && roster.has(g.assist)) {
      const u = creditUnit(g.matchId, g.assist);
      if (u) line(u, g.assist).assists++;
    }
  }

  const ORDER: UnitKey[] = ["GK", "Defender", "Midfielder", "Forward", "Unassigned"];
  const out = ORDER
    .filter(u => units.has(u))
    .map(u => {
      const players = Array.from(units.get(u)!.values())
        .sort((a, b) => b.minutes - a.minutes || a.playerName.localeCompare(b.playerName));
      return {
        unit: u,
        minutes: players.reduce((acc, p) => acc + p.minutes, 0),
        appearances: players.reduce((acc, p) => acc + p.appearances, 0),
        starts: players.reduce((acc, p) => acc + p.starts, 0),
        goals: players.reduce((acc, p) => acc + p.goals, 0),
        assists: players.reduce((acc, p) => acc + p.assists, 0),
        players,
      };
    });

  res.json(GetUnitBreakdownResponse.parse({ units: out, gameDayRows, assignedRows, unknownRows }));
});

// ─── Substitute impact (team goals for/against while a sub was on) ─────────────
//
// Same minute-window model as opponent-onfield-impact, but restricted to
// SUBSTITUTE appearances (appearance && !started): a sub who played M minutes
// in a match of effective length L is on for [L-M, L]. Team goals in that
// window count for (gf) / against (ga) regardless of who scored them.

router.get("/analytics/sub-impact", async (req, res): Promise<void> => {
  const query = GetSubImpactQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { seasonId, club, lastN } = query.data;
  const isAll = club === "__ALL__";

  const matches = await db
    .select({
      matchId: leagueMatchesTable.matchId,
      homeTeam: leagueMatchesTable.homeTeam,
      awayTeam: leagueMatchesTable.awayTeam,
      matchDate: leagueMatchesTable.matchDate,
    })
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));
  if (!matches.length) { res.json(GetSubImpactResponse.parse({ players: [] })); return; }

  const matchInfo = new Map<string, typeof matches[number]>();
  for (const m of matches) matchInfo.set(m.matchId, m);
  const relevant = isAll ? matches : matches.filter(m => m.homeTeam === club || m.awayTeam === club);

  // "Last N rounds" window — same convention as the other analytics endpoints.
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
  if (relevantIds.size === 0) { res.json(GetSubImpactResponse.parse({ players: [] })); return; }

  const relevantList = Array.from(relevantIds);
  const [ps, goalRows] = await Promise.all([
    db.select({
        playerName: leaguePlayerStatsTable.playerName,
        matchId: leaguePlayerStatsTable.matchId,
        minsPlayed: leaguePlayerStatsTable.minsPlayed,
        started: leaguePlayerStatsTable.started,
        appearance: leaguePlayerStatsTable.appearance,
        club: leaguePlayerStatsTable.club,
      })
      .from(leaguePlayerStatsTable)
      .where(and(eq(leaguePlayerStatsTable.seasonId, seasonId), inArray(leaguePlayerStatsTable.matchId, relevantList))),
    db.select({
        matchId: leagueGoalsTable.matchId,
        scorerTeam: leagueGoalsTable.scorerTeam,
        minuteScored: leagueGoalsTable.minuteScored,
      })
      .from(leagueGoalsTable)
      .where(and(eq(leagueGoalsTable.seasonId, seasonId), inArray(leagueGoalsTable.matchId, relevantList))),
  ]);

  // Goals per match + effective match length (stoppage time raises it past 90).
  const goalsByMatch = new Map<string, Array<{ team: string; minute: number | null }>>();
  const matchLen = new Map<string, number>();
  for (const g of goalRows) {
    if (!g.scorerTeam) continue;
    (goalsByMatch.get(g.matchId) ?? goalsByMatch.set(g.matchId, []).get(g.matchId)!)
      .push({ team: g.scorerTeam, minute: g.minuteScored });
    if (g.minuteScored != null) matchLen.set(g.matchId, Math.max(matchLen.get(g.matchId) ?? 90, g.minuteScored));
  }
  for (const r of ps) {
    if (r.minsPlayed != null) matchLen.set(r.matchId, Math.max(matchLen.get(r.matchId) ?? 90, r.minsPlayed));
  }

  const byPlayer = new Map<string, { playerName: string; club: string; subApps: number; mins: number; gf: number; ga: number }>();
  for (const r of ps) {
    if (!r.playerName || !r.club) continue;
    if (!r.appearance || r.started) continue; // substitute appearances only
    if (!isAll && r.club !== club) continue;
    if (!matchInfo.has(r.matchId)) continue;

    const L = matchLen.get(r.matchId) ?? 90;
    const mins = r.minsPlayed ?? 0;
    const winStart = Math.max(0, L - mins);

    let gf = 0, ga = 0;
    for (const g of goalsByMatch.get(r.matchId) ?? []) {
      const on = g.minute == null || mins <= 0 ? mins > 0 : g.minute >= winStart && g.minute <= L;
      if (!on) continue;
      if (g.team === r.club) gf += 1; else ga += 1;
    }

    const key = `${r.playerName}|${r.club}`;
    const row = byPlayer.get(key) ?? { playerName: r.playerName, club: r.club, subApps: 0, mins: 0, gf: 0, ga: 0 };
    row.subApps += 1;
    row.mins += mins;
    row.gf += gf;
    row.ga += ga;
    byPlayer.set(key, row);
  }

  const players = Array.from(byPlayer.values())
    .map(p => ({ ...p, net: p.gf - p.ga }))
    .sort((a, b) => b.net - a.net || b.gf - a.gf);
  res.json(GetSubImpactResponse.parse({ players }));
});

// ─── Opponent On-Field Impact (team GD while a player was on the pitch) ────────
//
// Minute-window attribution: league_goals carries the minute of every goal and
// league_player_stats carries started + minsPlayed, so a player is only credited
// with goals scored while they were actually on the field:
//   - starter who played M mins  → on for minutes [0, M]
//   - sub who played M mins      → on for minutes [L-M, L] (L = match length)
// Known approximation: a sub who is later subbed off again is assumed to play
// through to full time (only total minutes are recorded). Broken down per
// opponent so the client can exclude selected opponents and recompute.

router.get("/analytics/opponent-onfield-impact", async (req, res): Promise<void> => {
  const query = GetOpponentOnfieldImpactQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { seasonId, club, lastN } = query.data;
  const isAll = club === "__ALL__";

  const matches = await db
    .select({
      matchId: leagueMatchesTable.matchId,
      homeTeam: leagueMatchesTable.homeTeam,
      awayTeam: leagueMatchesTable.awayTeam,
      matchDate: leagueMatchesTable.matchDate,
      homeGoals: leagueMatchesTable.homeGoals,
      awayGoals: leagueMatchesTable.awayGoals,
    })
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));
  if (!matches.length) { res.json(GetOpponentOnfieldImpactResponse.parse({ opponents: [], players: [] })); return; }

  const matchInfo = new Map<string, typeof matches[number]>();
  for (const m of matches) matchInfo.set(m.matchId, m);

  const relevant = isAll ? matches : matches.filter(m => m.homeTeam === club || m.awayTeam === club);

  // "Last N rounds" window — same convention as the other opponent endpoints.
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
  if (relevantIds.size === 0) { res.json(GetOpponentOnfieldImpactResponse.parse({ opponents: [], players: [] })); return; }

  const relevantList = Array.from(relevantIds);
  const [ps, goalRows] = await Promise.all([
    db.select({
        playerName: leaguePlayerStatsTable.playerName,
        matchId: leaguePlayerStatsTable.matchId,
        minsPlayed: leaguePlayerStatsTable.minsPlayed,
        started: leaguePlayerStatsTable.started,
        appearance: leaguePlayerStatsTable.appearance,
        club: leaguePlayerStatsTable.club,
      })
      .from(leaguePlayerStatsTable)
      .where(and(eq(leaguePlayerStatsTable.seasonId, seasonId), inArray(leaguePlayerStatsTable.matchId, relevantList))),
    db.select({
        matchId: leagueGoalsTable.matchId,
        scorerTeam: leagueGoalsTable.scorerTeam,
        minuteScored: leagueGoalsTable.minuteScored,
      })
      .from(leagueGoalsTable)
      .where(and(eq(leagueGoalsTable.seasonId, seasonId), inArray(leagueGoalsTable.matchId, relevantList))),
  ]);

  // Goals grouped per match, and each match's effective length (covers stoppage-time
  // minutes if either the goal minute or someone's recorded minutes exceed 90).
  const goalsByMatch = new Map<string, Array<{ team: string; minute: number | null }>>();
  const matchLen = new Map<string, number>();
  for (const g of goalRows) {
    if (!g.scorerTeam) continue;
    (goalsByMatch.get(g.matchId) ?? goalsByMatch.set(g.matchId, []).get(g.matchId)!)
      .push({ team: g.scorerTeam, minute: g.minuteScored });
    if (g.minuteScored != null) matchLen.set(g.matchId, Math.max(matchLen.get(g.matchId) ?? 90, g.minuteScored));
  }
  for (const r of ps) {
    if (r.minsPlayed != null) matchLen.set(r.matchId, Math.max(matchLen.get(r.matchId) ?? 90, r.minsPlayed));
  }

  // (player|club) → opponent → { gf, ga, mins, apps }
  type Entry = { gf: number; ga: number; mins: number; apps: number };
  const byPlayer = new Map<string, { playerName: string; club: string; byOpponent: Record<string, Entry> }>();
  const allOpponents = new Set<string>();

  for (const r of ps) {
    if (!r.playerName || !r.club) continue;
    if (!r.appearance) continue; // bench without coming on — no on-field impact
    if (!isAll && r.club !== club) continue;
    const info = matchInfo.get(r.matchId);
    if (!info) continue;
    const opp = info.homeTeam === r.club ? info.awayTeam : info.awayTeam === r.club ? info.homeTeam : null;
    if (!opp) continue;
    allOpponents.add(opp);

    // On-field window for this appearance.
    const L = matchLen.get(r.matchId) ?? 90;
    const mins = r.minsPlayed ?? 0;
    const winStart = r.started ? 0 : Math.max(0, L - mins);
    const winEnd = r.started ? mins : L;

    let gf = 0, ga = 0;
    for (const g of goalsByMatch.get(r.matchId) ?? []) {
      // Goals with no recorded minute (shouldn't happen) count for everyone who played.
      const on = g.minute == null || mins <= 0 ? mins > 0 : g.minute >= winStart && g.minute <= winEnd;
      if (!on) continue;
      if (g.team === r.club) gf += 1; else ga += 1;
    }

    const key = `${r.playerName}|${r.club}`;
    const row = byPlayer.get(key) ?? { playerName: r.playerName, club: r.club, byOpponent: {} };
    const e = (row.byOpponent[opp] ??= { gf: 0, ga: 0, mins: 0, apps: 0 });
    e.gf += gf;
    e.ga += ga;
    e.mins += mins;
    e.apps += 1;
    byPlayer.set(key, row);
  }

  const players = Array.from(byPlayer.values()).sort((x, y) => {
    const gd = (p: typeof x) => Object.values(p.byOpponent).reduce((s, e) => s + e.gf - e.ga, 0);
    return gd(y) - gd(x);
  });

  res.json(GetOpponentOnfieldImpactResponse.parse({ opponents: Array.from(allOpponents).sort(), players }));
});

// ─── Clutch goals (big goals in close matches) ─────────────────────────────────
//
// A "close match" finished level or was decided by one goal. Replay its goals in
// minute order and classify each one:
//   equaliser — levelled the score
//   drawSaver — the FINAL equaliser of a drawn match (upgrade from equaliser)
//   goAhead   — took the team from level to in front
//   winner    — the LAST go-ahead goal by the side that won by one (upgrade)
// Own goals are team goals, not player goals — they move the score during the
// replay but are never credited to a player.
type ClutchCat = "winner" | "drawSaver" | "equaliser" | "goAhead";
type ClutchGoalIn = { teamA: boolean; scorer: string | null; minute: number | null; ord: number };

// finalA/finalB are the OFFICIAL recorded scoreline — goal-event rows can be
// incomplete (seed gaps), so the drawSaver/winner upgrades trust the official
// result, and are only applied when the replay agrees with it.
function classifyClutchGoals(goals: ClutchGoalIn[], finalA: number, finalB: number): Map<number, ClutchCat> {
  const sorted = goals.slice().sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0) || a.ord - b.ord);
  const cats = new Map<number, ClutchCat>();
  let a = 0, b = 0;
  let lastEqualiser: number | null = null;
  let lastGoAheadA: number | null = null, lastGoAheadB: number | null = null;
  for (const g of sorted) {
    const wasLevel = a === b;
    if (g.teamA) a++; else b++;
    if (a === b) { cats.set(g.ord, "equaliser"); lastEqualiser = g.ord; }
    else if (wasLevel) {
      cats.set(g.ord, "goAhead");
      if (g.teamA) lastGoAheadA = g.ord; else lastGoAheadB = g.ord;
    }
  }
  const replayMatchesOfficial = a === finalA && b === finalB;
  if (!replayMatchesOfficial) return cats; // incomplete goal rows — keep in-game categories only
  if (finalA === finalB && lastEqualiser != null) cats.set(lastEqualiser, "drawSaver");
  if (finalA === finalB + 1 && lastGoAheadA != null) cats.set(lastGoAheadA, "winner");
  if (finalB === finalA + 1 && lastGoAheadB != null) cats.set(lastGoAheadB, "winner");
  return cats;
}

type ClutchAcc = Map<string, {
  playerName: string; club: string;
  winners: number; drawSavers: number; equalisers: number; goAheads: number;
  goals: Array<{ category: ClutchCat; opponent: string; minute: number | null; result: string }>;
}>;

const CLUTCH_FIELD: Record<ClutchCat, "winners" | "drawSavers" | "equalisers" | "goAheads"> = {
  winner: "winners", drawSaver: "drawSavers", equaliser: "equalisers", goAhead: "goAheads",
};

function creditClutch(
  acc: ClutchAcc, playerName: string, club: string, cat: ClutchCat,
  opponent: string, minute: number | null, result: string,
) {
  const key = `${playerName}|${club}`;
  const row = acc.get(key) ?? { playerName, club, winners: 0, drawSavers: 0, equalisers: 0, goAheads: 0, goals: [] };
  row[CLUTCH_FIELD[cat]] += 1;
  row.goals.push({ category: cat, opponent, minute, result });
  acc.set(key, row);
}

function clutchPlayers(acc: ClutchAcc) {
  return Array.from(acc.values())
    .map(p => ({ ...p, total: p.winners + p.drawSavers + p.equalisers + p.goAheads }))
    .sort((x, y) => y.winners - x.winners || y.drawSavers - x.drawSavers || y.total - x.total);
}

// Focus-team version: Belconnen matches, roster-based ours/theirs classification.
router.get("/analytics/clutch-goals", async (req, res): Promise<void> => {
  const query = GetClutchGoalsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { teamId, seasonId, lastN } = query.data;
  const focusClub = await focusClubForRequest(req, seasonId);

  let matches = await db
    .select({ id: matchesTable.id, opponent: matchesTable.opponent, matchDate: matchesTable.matchDate, goalsScored: matchesTable.goalsScored, goalsConceded: matchesTable.goalsConceded })
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));
  if (lastN != null && lastN > 0) {
    matches = matches.slice().sort((x, y) => (y.matchDate ?? "").localeCompare(x.matchDate ?? "")).slice(0, lastN);
  }
  const close = matches.filter(m => m.goalsScored != null && m.goalsConceded != null && Math.abs(m.goalsScored - m.goalsConceded) <= 1);
  if (!close.length) { res.json(GetClutchGoalsResponse.parse({ closeMatches: 0, players: [] })); return; }
  const closeById = new Map(close.map(m => [m.id, m]));

  const [goals, stats] = await Promise.all([
    db.select({ matchId: goalsTable.matchId, scorer: goalsTable.scorer, scorerTeam: goalsTable.scorerTeam, minuteScored: goalsTable.minuteScored, id: goalsTable.id })
      .from(goalsTable)
      .where(and(eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId), inArray(goalsTable.matchId, close.map(m => m.id)))),
    db.select({ playerName: playerStatsTable.playerName })
      .from(playerStatsTable)
      .where(and(inArray(playerStatsTable.matchId, close.map(m => m.id)), eq(playerStatsTable.club, focusClub))),
  ]);
  const roster = new Set(stats.map(s => s.playerName));

  const byMatch = new Map<number, Array<typeof goals[number]>>();
  for (const g of goals) (byMatch.get(g.matchId) ?? byMatch.set(g.matchId, []).get(g.matchId)!).push(g);

  const acc: ClutchAcc = new Map();
  for (const [matchId, mGoals] of byMatch) {
    const m = closeById.get(matchId);
    if (!m) continue;
    const input: ClutchGoalIn[] = mGoals.map(g => ({
      teamA: isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub), scorer: g.scorer, minute: g.minuteScored, ord: g.id,
    }));
    const gs = m.goalsScored ?? 0, gc = m.goalsConceded ?? 0;
    const cats = classifyClutchGoals(input, gs, gc);
    const result = `${gs > gc ? "W" : gs < gc ? "L" : "D"} ${gs}-${gc} v ${m.opponent ?? "?"}`;
    for (const g of input) {
      const cat = cats.get(g.ord);
      if (!cat || !g.teamA || !g.scorer || g.scorer === "OG" || !roster.has(g.scorer)) continue;
      creditClutch(acc, g.scorer, focusClub, cat, m.opponent ?? "?", g.minute, result);
    }
  }
  res.json(GetClutchGoalsResponse.parse({ closeMatches: close.length, players: clutchPlayers(acc) }));
});

// League version: any club or __ALL__, computed from the whole-league tables.
router.get("/analytics/opponent-clutch-goals", async (req, res): Promise<void> => {
  const query = GetOpponentClutchGoalsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { seasonId, club, lastN } = query.data;
  const isAll = club === "__ALL__";

  const matches = await db
    .select({ matchId: leagueMatchesTable.matchId, homeTeam: leagueMatchesTable.homeTeam, awayTeam: leagueMatchesTable.awayTeam, matchDate: leagueMatchesTable.matchDate, homeGoals: leagueMatchesTable.homeGoals, awayGoals: leagueMatchesTable.awayGoals })
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));

  const relevant = isAll ? matches : matches.filter(m => m.homeTeam === club || m.awayTeam === club);
  let windowed = relevant;
  if (lastN != null && lastN > 0) {
    if (isAll) {
      const dates = Array.from(new Set(relevant.map(m => m.matchDate ?? "").filter(Boolean)))
        .sort((x, y) => y.localeCompare(x)).slice(0, lastN);
      const dateSet = new Set(dates);
      windowed = relevant.filter(m => dateSet.has(m.matchDate ?? ""));
    } else {
      windowed = relevant.slice().sort((x, y) => (y.matchDate ?? "").localeCompare(x.matchDate ?? "")).slice(0, lastN);
    }
  }
  const close = windowed.filter(m => m.homeGoals != null && m.awayGoals != null && Math.abs(m.homeGoals - m.awayGoals) <= 1);
  if (!close.length) { res.json(GetOpponentClutchGoalsResponse.parse({ closeMatches: 0, players: [] })); return; }
  const closeById = new Map(close.map(m => [m.matchId, m]));

  const goals = await db
    .select({ matchId: leagueGoalsTable.matchId, scorer: leagueGoalsTable.scorer, scorerTeam: leagueGoalsTable.scorerTeam, minuteScored: leagueGoalsTable.minuteScored, id: leagueGoalsTable.id })
    .from(leagueGoalsTable)
    .where(and(eq(leagueGoalsTable.seasonId, seasonId), inArray(leagueGoalsTable.matchId, close.map(m => m.matchId))));

  const byMatch = new Map<string, Array<typeof goals[number]>>();
  for (const g of goals) (byMatch.get(g.matchId) ?? byMatch.set(g.matchId, []).get(g.matchId)!).push(g);

  const acc: ClutchAcc = new Map();
  for (const [matchId, mGoals] of byMatch) {
    const m = closeById.get(matchId);
    if (!m || !m.homeTeam || !m.awayTeam) continue;
    const input = mGoals
      .filter(g => g.scorerTeam === m.homeTeam || g.scorerTeam === m.awayTeam)
      .map(g => ({ teamA: g.scorerTeam === m.homeTeam, scorer: g.scorer, minute: g.minuteScored, ord: g.id, scorerTeam: g.scorerTeam! }));
    const cats = classifyClutchGoals(input, m.homeGoals ?? 0, m.awayGoals ?? 0);
    for (const g of input) {
      const cat = cats.get(g.ord);
      if (!cat || !g.scorer || g.scorer === "OG") continue;
      if (!isAll && g.scorerTeam !== club) continue;
      const opponent = g.teamA ? m.awayTeam : m.homeTeam;
      const gf = g.teamA ? (m.homeGoals ?? 0) : (m.awayGoals ?? 0);
      const ga = g.teamA ? (m.awayGoals ?? 0) : (m.homeGoals ?? 0);
      const result = `${gf > ga ? "W" : gf < ga ? "L" : "D"} ${gf}-${ga} v ${opponent}`;
      creditClutch(acc, g.scorer, g.scorerTeam, cat, opponent, g.minute, result);
    }
  }
  res.json(GetOpponentClutchGoalsResponse.parse({ closeMatches: close.length, players: clutchPlayers(acc) }));
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

// ─── Match Report (coach-style single-match insights with season context) ─────

router.get("/analytics/match-report", async (req, res): Promise<void> => {
  const query = GetMatchReportQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { teamId, seasonId, matchRowId } = query.data;
  const focusClub = await focusClubForRequest(req, seasonId);

  const allMatches = await db
    .select()
    .from(matchesTable)
    .where(and(eq(matchesTable.teamId, teamId), eq(matchesTable.seasonId, seasonId)));
  const match = allMatches.find(m => m.id === matchRowId);
  if (!match) {
    res.status(404).json({ error: "Match not found" });
    return;
  }
  // Chronological order; everything "before" is season-to-date at kickoff.
  // Same-day fixtures tie-break by row id so the ordering is deterministic.
  const ordered = allMatches
    .slice()
    .sort((a, b) => (a.matchDate ?? "").localeCompare(b.matchDate ?? "") || a.id - b.id);
  const idx = ordered.findIndex(m => m.id === matchRowId);
  const upTo = ordered.slice(0, idx + 1);

  type MatchRow = typeof allMatches[number];
  const resultOf = (m: MatchRow): "W" | "D" | "L" | null =>
    m.goalsScored == null || m.goalsConceded == null ? null
      : m.goalsScored > m.goalsConceded ? "W" : m.goalsScored < m.goalsConceded ? "L" : "D";
  const result = resultOf(match);
  const roundShort = match.matchId.split("-")[0];
  const matchLabel = `${roundShort} v ${match.opponent}`;

  // ── Tiles: this match vs season average, with a season rank ──────────────
  const num = (v: string | number | null | undefined): number | null =>
    v == null ? null : typeof v === "number" ? v : Number.isFinite(Number(v)) ? Number(v) : null;
  const tile = (
    id: string, label: string, unit: string, decimals: number,
    f: (m: MatchRow) => number | null, higherIsBetter: boolean,
  ) => {
    const value = f(match);
    const others = ordered.filter(m => m.id !== matchRowId).map(f).filter((v): v is number => v != null);
    const seasonAvg = others.length ? others.reduce((a, b) => a + b, 0) / others.length : null;
    const deltaPct = value != null && seasonAvg ? ((value - seasonAvg) / Math.abs(seasonAvg)) * 100 : null;
    const all = ordered.map(f).filter((v): v is number => v != null);
    const rank = value == null ? null
      : 1 + all.filter(v => (higherIsBetter ? v > value : v < value)).length;
    // Average across the OTHER meetings with this opponent this season.
    const oppVals = ordered
      .filter(m => m.id !== matchRowId && m.opponent === match.opponent)
      .map(f).filter((v): v is number => v != null);
    const oppAvg = oppVals.length ? oppVals.reduce((a, b) => a + b, 0) / oppVals.length : null;
    return { id, label, value, unit, decimals, seasonAvg, deltaPct, rank: value == null ? null : rank, outOf: value == null ? null : all.length, higherIsBetter, oppAvg, oppGames: oppVals.length ? oppVals.length : null };
  };
  const tiles = [
    tile("goalsFor", "Goals scored", "", 0, m => m.goalsScored, true),
    tile("goalsAgainst", "Goals conceded", "", 0, m => m.goalsConceded, false),
    tile("possession", "Possession", "%", 0, m => num(m.possession), true),
    tile("shots", "Shots", "", 0, m => m.shots, true),
    tile("oppShots", "Shots against", "", 0, m => m.oppShots, false),
    tile("passes", "Passes", "", 0, m => m.passes, true),
  ].filter(t => t.value != null);

  // ── Goals in this match, with roster attribution + season milestones ─────
  const seasonGoals = await db
    .select()
    .from(goalsTable)
    .where(and(eq(goalsTable.teamId, teamId), eq(goalsTable.seasonId, seasonId)));
  const stats = await db
    .select()
    .from(playerStatsTable)
    .where(and(inArray(playerStatsTable.matchId, allMatches.map(m => m.id)), eq(playerStatsTable.club, focusClub)));
  const roster = new Set(stats.map(s => s.playerName));

  const matchIdsUpTo = new Set(upTo.map(m => m.id));
  const ourGoalsUpTo = seasonGoals.filter(g => matchIdsUpTo.has(g.matchId) && isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub));
  const tallyBy = (pick: (g: typeof seasonGoals[number]) => string | null) => {
    const t = new Map<string, number>();
    for (const g of ourGoalsUpTo) {
      const name = pick(g)?.trim();
      if (!name || name === "OG") continue;
      t.set(name, (t.get(name) ?? 0) + 1);
    }
    return t;
  };
  const goalTally = tallyBy(g => g.scorer);
  const assistTally = tallyBy(g => g.assist);
  const teamTopGoals = Math.max(0, ...goalTally.values());

  // League-wide top scorers — season to date, all clubs, own goals excluded.
  // The date cutoff is deliberately <= this match's date: league context reads
  // as "after this round", so same-day fixtures across the league are included.
  const leagueGoalRows = await db
    .select({ scorer: leagueGoalsTable.scorer, scorerTeam: leagueGoalsTable.scorerTeam, matchDate: leagueGoalsTable.matchDate })
    .from(leagueGoalsTable)
    .where(eq(leagueGoalsTable.seasonId, seasonId));
  const cutoff = match.matchDate ?? "9999";
  const leagueTally = new Map<string, { club: string | null; count: number }>();
  for (const g of leagueGoalRows) {
    const name = g.scorer?.trim();
    if (!name || name === "OG") continue;
    if ((g.matchDate ?? "") > cutoff) continue;
    const e = leagueTally.get(name) ?? { club: g.scorerTeam ?? null, count: 0 };
    e.count++;
    leagueTally.set(name, e);
  }
  const leagueMax = Math.max(0, ...[...leagueTally.values()].map(e => e.count));
  const leagueRankOf = (name: string): number | null => {
    const mine = leagueTally.get(name)?.count;
    if (!mine) return null;
    return 1 + [...leagueTally.values()].filter(e => e.count > mine).length;
  };

  const matchGoals = seasonGoals
    .filter(g => g.matchId === match.id)
    .sort((a, b) => (a.minuteScored ?? 999) - (b.minuteScored ?? 999));
  const goals = matchGoals.map(g => {
    const ours = isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub);
    let note: string | null = null;
    if (ours && g.scorer && g.scorer !== "OG") {
      const season = goalTally.get(g.scorer.trim()) ?? 0;
      const inThisGame = matchGoals.filter(x => x.scorer?.trim() === g.scorer!.trim() && isFocusGoal(x.scorer, x.scorerTeam, roster, focusClub)).length;
      const bits: string[] = [];
      if (inThisGame >= 3) bits.push("hat-trick");
      else if (inThisGame === 2) bits.push("brace");
      bits.push(`${season} for the season`);
      const lr = leagueRankOf(g.scorer.trim());
      if (lr === 1) bits.push("leads the league");
      else if (lr != null && lr <= 5) bits.push(`top ${lr} in the league`);
      else if (season === teamTopGoals && teamTopGoals > 1) bits.push("our top scorer");
      note = bits.join(" · ");
    }
    // Conceded rows show the opponent scorer when recorded, otherwise the club name.
    const concededBy = g.scorer && g.scorer !== "OG" ? g.scorer : g.scorerTeam ?? null;
    // Human Goal DNA label for the timeline, e.g. "middle-third regain · before they reset".
    const rawType = g.goalType?.trim().toUpperCase() ?? "";
    const cat = dnaCatOfType(g.goalType);
    let typeLabel: string | null = null;
    if (cat) {
      typeLabel = dnaCatLabel(cat);
      if (cat === "setPiece" && rawType === "SP-P") typeLabel = "set piece (penalty)";
      else if (cat !== "setPiece" && rawType.endsWith("-DT")) typeLabel += " · before they reset";
      else if (cat !== "setPiece" && rawType.endsWith("-AT")) typeLabel += " · vs a set defence";
    }
    return { minute: g.minuteScored, scorer: ours ? g.scorer : concededBy, assist: ours ? g.assist : null, ours, note, typeLabel };
  });

  // ── Form strip (last 5 up to & incl. this match) + ladder position ────────
  const form = upTo.slice(-5).map(m => ({
    result: resultOf(m) ?? "?",
    opponent: m.opponent,
    score: m.goalsScored != null && m.goalsConceded != null ? `${m.goalsScored}–${m.goalsConceded}` : "—",
    isThisMatch: m.id === matchRowId,
  }));
  const leagueMatches = await db
    .select()
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));
  const standings = new Map<string, { pts: number; gd: number; gf: number }>();
  for (const m of leagueMatches) {
    if (!/^R\d/.test(m.matchId) || m.homeGoals == null || m.awayGoals == null) continue;
    if ((m.matchDate ?? "") > cutoff) continue;
    const upd = (club: string, gf: number, ga: number) => {
      const e = standings.get(club) ?? { pts: 0, gd: 0, gf: 0 };
      e.pts += gf > ga ? 3 : gf === ga ? 1 : 0;
      e.gd += gf - ga; e.gf += gf;
      standings.set(club, e);
    };
    upd(m.homeTeam, m.homeGoals, m.awayGoals);
    upd(m.awayTeam, m.awayGoals, m.homeGoals);
  }
  const table = [...standings.entries()].sort((a, b) => b[1].pts - a[1].pts || b[1].gd - a[1].gd || b[1].gf - a[1].gf);
  const posIdx = table.findIndex(([club]) => club === focusClub);
  const ladderPos = posIdx >= 0 ? posIdx + 1 : null;
  const ladderPoints = posIdx >= 0 ? table[posIdx][1].pts : null;
  const teamsInLeague = table.length ? table.length : null;

  // ── Insights — the "EPL analyst" one-liners ───────────────────────────────
  const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
  const insights: Array<{ tone: "good" | "watch" | "info"; text: string }> = [];

  // Result + streaks
  const resultsUpTo = upTo.map(resultOf);
  let streak = 0;
  const last = resultsUpTo[resultsUpTo.length - 1];
  for (let i = resultsUpTo.length - 1; i >= 0 && resultsUpTo[i] === last; i--) streak++;
  if (result === "W" && streak >= 2) insights.push({ tone: "good", text: `That's ${streak} wins on the trot.` });
  else if (result === "L" && streak >= 2) insights.push({ tone: "watch", text: `${streak} losses in a row — one to arrest.` });
  let unbeaten = 0;
  for (let i = resultsUpTo.length - 1; i >= 0 && resultsUpTo[i] !== null && resultsUpTo[i] !== "L"; i--) unbeaten++;
  if (result !== "L" && unbeaten >= 3 && unbeaten > streak) insights.push({ tone: "good", text: `Unbeaten in ${unbeaten}.` });

  // Half-time story
  const parseScore = (s: string | null): [number, number] | null => {
    const m2 = s?.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
    return m2 ? [Number(m2[1]), Number(m2[2])] : null;
  };
  // half_score/full_score are stored home–away, not us–them. Work out which
  // side is ours by matching full_score against goalsScored/Conceded, then
  // apply the same orientation to the half-time score. Ambiguous → skip.
  const fs = parseScore(match.fullScore);
  const flip =
    fs && match.goalsScored != null && match.goalsConceded != null
      ? fs[0] === match.goalsScored && fs[1] === match.goalsConceded ? false
        : fs[0] === match.goalsConceded && fs[1] === match.goalsScored ? true
        : null
      : null;
  const htRaw = parseScore(match.halfScore);
  const ht = htRaw && flip != null ? (flip ? [htRaw[1], htRaw[0]] as [number, number] : htRaw) : null;
  if (ht && result) {
    const [h1, h2] = ht;
    const htResult = h1 > h2 ? "W" : h1 < h2 ? "L" : "D";
    if (htResult === "L" && result === "W") insights.push({ tone: "good", text: `Came from ${h1}–${h2} down at the break to win — a proper second-half response.` });
    else if (htResult === "L" && result === "D") insights.push({ tone: "good", text: `Behind at half-time, level at full-time — good character shown after the break.` });
    else if (htResult === "W" && result === "L") insights.push({ tone: "watch", text: `Led ${h1}–${h2} at half-time and lost — the second half got away from us.` });
    else if (htResult === "W" && result === "W" && (match.goalsScored ?? 0) - h1 >= 2) insights.push({ tone: "good", text: `Kicked on after the break — ${(match.goalsScored ?? 0) - h1} second-half goals.` });
  }

  // Clean sheets — streak + who kept it
  if (match.cleanSheet) {
    let cs = 0;
    for (let i = upTo.length - 1; i >= 0 && upTo[i].cleanSheet; i--) cs++;
    const backline = stats
      .filter(s => s.matchId === match.id && s.started && s.position && /^(GK|CB|LB|RB|LWB|RWB|DM)$/i.test(s.position))
      .map(s => s.playerName);
    const who = backline.length ? ` ${backline.join(", ")} held the fort.` : "";
    insights.push({
      tone: "good",
      text: cs >= 2 ? `Clean sheet — that's ${cs} shut-outs in a row.${who}` : `Clean sheet.${who}`,
    });
  }
  const totalCs = upTo.filter(m => m.cleanSheet).length;
  if (!match.cleanSheet && (match.goalsConceded ?? 0) >= 3) {
    insights.push({ tone: "watch", text: `${match.goalsConceded} conceded — only ${totalCs} clean sheet${totalCs === 1 ? "" : "s"} so far this season.` });
  }

  // Shots against — best defensive shift of the season?
  const oa = tiles.find(t => t.id === "oppShots");
  if (oa && oa.rank === 1 && (oa.outOf ?? 0) >= 3) insights.push({ tone: "good", text: `Fewest shots faced all season (${oa.value}).` });
  const poss = tiles.find(t => t.id === "possession");
  if (poss && poss.rank === 1 && (poss.outOf ?? 0) >= 3) insights.push({ tone: "good", text: `Best possession share of the season (${poss.value}%).` });
  else if (poss && poss.rank === poss.outOf && (poss.outOf ?? 0) >= 3) insights.push({ tone: "info", text: `Lowest possession of the season (${poss.value}%) — worth pairing with the result before judging it.` });

  // Assist milestone — did anyone move top of our assist charts today?
  const teamTopAssists = Math.max(0, ...assistTally.values());
  const todaysAssisters = new Set(matchGoals.map(g => g.assist?.trim()).filter((a): a is string => !!a && a !== "OG"));
  for (const a of todaysAssisters) {
    if ((assistTally.get(a) ?? 0) === teamTopAssists && teamTopAssists >= 2) {
      insights.push({ tone: "good", text: `${a} now has ${teamTopAssists} assists — top of our charts.` });
      break;
    }
  }

  // Late drama
  const winner = [...matchGoals].reverse().find(g => isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub));
  if (result === "W" && winner?.minuteScored != null && winner.minuteScored >= 85 && (match.goalsScored ?? 0) - (match.goalsConceded ?? 0) === 1) {
    insights.push({ tone: "good", text: `Winner in the ${ord(winner.minuteScored)} minute — late, late show from ${winner.scorer}.` });
  }

  // League scorer headline (independent of who scored today)
  const ourLeagueLeader = [...leagueTally.entries()]
    .filter(([, e]) => e.club === focusClub)
    .sort((a, b) => b[1].count - a[1].count)[0];
  if (ourLeagueLeader && ourLeagueLeader[1].count === leagueMax && leagueMax >= 3) {
    insights.push({ tone: "info", text: `${ourLeagueLeader[0]} sits top of the league scoring charts on ${leagueMax}.` });
  }

  if (ladderPos != null) {
    insights.push({ tone: "info", text: `${ord(ladderPos)} of ${teamsInLeague} after this round on ${ladderPoints} points.` });
  }

  // ── Ball work: passes-per-shot vs season usual ────────────────────────────
  if (match.passes != null && match.shots != null && match.shots > 0) {
    const pps = match.passes / match.shots;
    const others = ordered.filter(m => m.id !== matchRowId && m.passes != null && m.shots != null && m.shots > 0);
    if (others.length >= 3) {
      const avg = others.reduce((a, m) => a + m.passes! / m.shots!, 0) / others.length;
      const diff = ((pps - avg) / avg) * 100;
      if (diff <= -20) insights.push({ tone: "good", text: `A shot every ${pps.toFixed(0)} passes — much more direct than our season usual (one every ${avg.toFixed(0)}).` });
      else if (diff >= 25) insights.push({ tone: "info", text: `${pps.toFixed(0)} passes per shot — a lot of ball without cutting through (season usual is ${avg.toFixed(0)}).` });
    }
    if (match.possession != null) {
      const possN = num(match.possession);
      if (possN != null && possN < 45 && result === "W") insights.push({ tone: "info", text: `Won it with just ${possN}% of the ball — clinical on the counter.` });
    }
  }

  // ── Goal DNA: goals-by-type story, scored AND conceded ───────────────────
  // The coach's core analysis framework. Every goal carries a type:
  //   SP-* (set pieces) or R-{FT|MT|BT}-{DT|AT} = regain third × transition
  //   timing (During Transition = struck before the defence reset,
  //   After Transition = the defence was set and still got broken down).
  // Season mix benchmarks (share of typed goals): SP 27%, MT regains 48–50%,
  // FT ~12%, BT ~12%. Clear deviation = strength to exploit / weakness to
  // mitigate, depending on which side of the ball it's on.
  type DnaCatId = "setPiece" | "frontThird" | "middleThird" | "backThird";
  const dnaCatOf = (t: string | null | undefined): DnaCatId | null => {
    const s = t?.trim().toUpperCase();
    if (!s) return null;
    if (s.startsWith("SP")) return "setPiece";
    if (s.startsWith("R-FT")) return "frontThird";
    if (s.startsWith("R-MT")) return "middleThird";
    if (s.startsWith("R-BT")) return "backThird";
    return null;
  };
  const DNA_BENCH: Record<DnaCatId, { lo: number; hi: number; label: string }> = {
    setPiece:    { lo: 23, hi: 31, label: "27%" },
    middleThird: { lo: 44, hi: 54, label: "48–50%" },
    frontThird:  { lo: 8,  hi: 16, label: "~12%" },
    backThird:   { lo: 8,  hi: 16, label: "~12%" },
  };
  const DNA_LABELS: Record<DnaCatId, string> = {
    setPiece: "Set pieces", frontThird: "Front-third regains",
    middleThird: "Middle-third regains", backThird: "Back-third regains",
  };
  const dnaSide = (goalsForSide: typeof seasonGoals, matchGoalsForSide: typeof seasonGoals, ours: boolean) => {
    const typed = goalsForSide.map(g => ({ cat: dnaCatOf(g.goalType), at: (g.goalType ?? "").toUpperCase().endsWith("-AT") })).filter(x => x.cat != null);
    const totalTyped = typed.length;
    const categories = (Object.keys(DNA_LABELS) as DnaCatId[]).map(id => {
      const inCat = typed.filter(x => x.cat === id);
      const at = id === "setPiece" ? 0 : inCat.filter(x => x.at).length;
      return {
        id, label: DNA_LABELS[id], count: inCat.length,
        dt: id === "setPiece" ? 0 : inCat.length - at, at,
        pct: totalTyped ? (inCat.length / totalTyped) * 100 : null,
        benchmarkLabel: DNA_BENCH[id].label,
        verdict: totalTyped >= 12 && inCat.length + totalTyped > 0
          ? ((inCat.length / totalTyped) * 100 > DNA_BENCH[id].hi ? "high" as const
            : (inCat.length / totalTyped) * 100 < DNA_BENCH[id].lo ? "low" as const : null)
          : null,
      };
    });

    // Selective lines for THIS match — not a listing of every goal. We only
    // call out something worth remembering: a goal that fits the side's
    // signature pattern (its biggest / over-benchmark season category), or a
    // genuine rarity (first or second of the season from that category).
    const matchCats = new Map<DnaCatId, number>();
    for (const g of matchGoalsForSide) {
      const c = dnaCatOf(g.goalType);
      if (c) matchCats.set(c, (matchCats.get(c) ?? 0) + 1);
    }
    const flavour = (id: DnaCatId): string => {
      if (ours) {
        if (id === "setPiece") return "the rehearsed stuff paying off";
        if (id === "frontThird") return "winning it high — teams keep coughing it up against our press";
        if (id === "middleThird") return "regain in the middle and go";
        return "playing right through teams from deep";
      }
      if (id === "setPiece") return "set-piece organisation keeps costing us";
      if (id === "frontThird") return "losing it playing out and getting punished";
      if (id === "middleThird") return "not getting set quickly enough at the turnover";
      return "teams playing through our whole block from deep";
    };
    const matchLines: string[] = [];
    if (totalTyped >= 12) {
      // Signature = the biggest season category (prefer one flagged "high").
      const sig = categories.slice().sort((a, b) =>
        (b.verdict === "high" ? 1000 : 0) + b.count - ((a.verdict === "high" ? 1000 : 0) + a.count))[0];
      const nToday = sig ? matchCats.get(sig.id) ?? 0 : 0;
      if (sig && nToday > 0 && sig.pct != null && sig.pct >= 25) {
        matchLines.push(ours
          ? `${nToday > 1 ? `${nToday} more` : "Another one"} from ${sig.label.toLowerCase()} — our signature. ${sig.count} of our ${totalTyped} this season have come that way: ${flavour(sig.id)}.`
          : `Conceded from ${sig.label.toLowerCase()} again — that's ${sig.count} of the ${totalTyped} we've let in this season: ${flavour(sig.id)}. The pattern to break.`);
      }
    }
    // Rarity — first or second of the whole season from that category.
    for (const [id, n] of matchCats) {
      const seasonCount = categories.find(c => c.id === id)?.count ?? 0;
      if (n > 0 && seasonCount > 0 && seasonCount <= 2 && totalTyped >= 12 && matchLines.length < 2) {
        matchLines.push(ours
          ? `Only our ${seasonCount === 1 ? "first" : "second"} goal all season from ${DNA_LABELS[id].toLowerCase()} — one to remember.`
          : `${seasonCount === 1 ? "First" : "Only second"} goal we've conceded all season from ${DNA_LABELS[id].toLowerCase()} — unusual, worth a look on the tape.`);
      }
    }
    return { totalTyped, categories, matchLines: matchLines.slice(0, 2) };
  };
  const goalsUpToAll = seasonGoals.filter(g => matchIdsUpTo.has(g.matchId));
  const concededUpTo = goalsUpToAll.filter(g => !isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub));
  const matchOurGoals = matchGoals.filter(g => isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub));
  const matchConcededGoals = matchGoals.filter(g => !isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub));
  const dnaScored = dnaSide(ourGoalsUpTo, matchOurGoals, true);
  const dnaConceded = dnaSide(concededUpTo, matchConcededGoals, false);
  const dnaComments: string[] = [];
  for (const c of dnaScored.categories) {
    if (c.verdict === "high") dnaComments.push(`${c.label} are ${c.pct!.toFixed(0)}% of our goals (benchmark ${c.benchmarkLabel}) — a real strength, keep exploiting it.`);
    else if (c.verdict === "low") dnaComments.push(`Only ${c.pct!.toFixed(0)}% of our goals come from ${c.label.toLowerCase()} (benchmark ${c.benchmarkLabel}) — an avenue we're not using enough.`);
  }
  for (const c of dnaConceded.categories) {
    if (c.verdict === "high") dnaComments.push(`${c.pct!.toFixed(0)}% of goals conceded come from ${c.label.toLowerCase()} (benchmark ${c.benchmarkLabel}) — a weakness to mitigate.`);
    else if (c.verdict === "low") dnaComments.push(`We concede just ${c.pct!.toFixed(0)}% from ${c.label.toLowerCase()} (benchmark ${c.benchmarkLabel}) — holding up well there.`);
  }
  const dnaStory = buildDnaStory({
    scored: matchOurGoals.map(g => ({ minute: g.minuteScored, scorer: g.scorer, goalType: g.goalType })),
    conceded: matchConcededGoals.map(g => ({ minute: g.minuteScored, scorer: g.scorer, goalType: g.goalType })),
    catsScored: dnaScored.categories, catsConceded: dnaConceded.categories,
    totalTypedScored: dnaScored.totalTyped, totalTypedConceded: dnaConceded.totalTyped,
    voice: "team",
  });
  // ── Insights from today's goals: partnerships, form runs, head-to-head DNA ─
  const pairIns: { n: number; text: string }[] = [];
  const streakIns: string[] = [];
  const h2hIns: string[] = [];
  // Assist→scorer duos that keep combining (count both directions).
  const seenPairs = new Set<string>();
  for (const g of matchOurGoals) {
    const scorer = g.scorer?.trim();
    const assist = g.assist?.trim();
    if (!scorer || !assist || scorer === "OG" || assist === "OG" || assist === scorer) continue;
    const key = [assist, scorer].sort().join("|");
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    const together = ourGoalsUpTo.filter(x =>
      (x.scorer?.trim() === scorer && x.assist?.trim() === assist) ||
      (x.scorer?.trim() === assist && x.assist?.trim() === scorer)).length;
    if (together >= 3) {
      pairIns.push({ n: together, text: `${assist} → ${scorer} again — that partnership has now combined for ${together} of our goals this season.` });
    }
  }
  // Scoring streaks — scored today AND in each of the previous games.
  const matchesBefore = upTo.slice(0, -1);
  const scorersToday = [...new Set(matchOurGoals.map(g => g.scorer?.trim()).filter((s): s is string => !!s && s !== "OG"))];
  for (const name of scorersToday) {
    let streak = 1;
    for (let i = matchesBefore.length - 1; i >= 0; i--) {
      const mid = matchesBefore[i].id;
      const scoredIn = seasonGoals.some(g =>
        g.matchId === mid && g.scorer?.trim() === name && isFocusGoal(g.scorer, g.scorerTeam, roster, focusClub));
      if (scoredIn) streak++;
      else break;
    }
    if (streak >= 3) streakIns.push(`${name} has now scored in ${streak} straight games — a proper run of form.`);
  }
  // Head-to-head: how goals (both ways) have usually come against THIS opponent.
  const earlierMeetingIds = new Set(ordered.slice(0, idx).filter(m => m.opponent === match.opponent).map(m => m.id));
  if (earlierMeetingIds.size > 0) {
    const prevCats = new Map<ReturnType<typeof dnaCatOfType> & string, number>();
    let prevTyped = 0;
    for (const g of seasonGoals.filter(g => earlierMeetingIds.has(g.matchId))) {
      const c = dnaCatOfType(g.goalType);
      if (c) { prevTyped++; prevCats.set(c, (prevCats.get(c) ?? 0) + 1); }
    }
    if (prevTyped >= 3) {
      const [topCat, topN] = [...prevCats.entries()].sort((a, b) => b[1] - a[1])[0];
      const todayCats = new Map<ReturnType<typeof dnaCatOfType> & string, number>();
      for (const g of matchGoals) {
        const c = dnaCatOfType(g.goalType);
        if (c) todayCats.set(c, (todayCats.get(c) ?? 0) + 1);
      }
      const todayTop = [...todayCats.entries()].sort((a, b) => b[1] - a[1])[0];
      let line = `Meetings with ${match.opponent} this season have mostly been decided by ${dnaCatLabel(topCat)}s (${topN} of ${prevTyped} goals either way).`;
      if (todayTop) {
        line += todayTop[0] === topCat
          ? ` Today followed the script — ${dnaCatLabel(todayTop[0])}s again.`
          : ` Today broke the pattern: ${dnaCatLabel(todayTop[0])}s did the damage.`;
      }
      h2hIns.push(line);
    }
  }
  // Mix the insight kinds — best partnership + best streak + head-to-head first,
  // then backfill with remaining partnerships/streaks up to 3.
  const sortedPairs = pairIns.sort((a, b) => b.n - a.n).map(p => p.text);
  const dayInsights = [sortedPairs[0], streakIns[0], h2hIns[0], ...sortedPairs.slice(1), ...streakIns.slice(1)]
    .filter((s): s is string => !!s)
    .slice(0, 3);

  // ── Insight badges: up to 4 headline squares for the Goal DNA card ───────
  // Candidate angles are weighted so the most striking one per kind shows,
  // and the mix varies game to game (goal type, timing, scorer, assists,
  // defence). Each badge: big value line + a season/vs-them context sub-line.
  const insightBadges: Array<{ label: string; value: string; sub: string | null }> = [];
  {
    const cands: Array<{ kind: string; w: number; label: string; value: string; sub: string | null }> = [];
    // Goal type — today's dominant scored category vs its season share.
    {
      const todayCats = new Map<string, number>();
      for (const g of matchOurGoals) {
        const c = dnaCatOfType(g.goalType);
        if (c) todayCats.set(c, (todayCats.get(c) ?? 0) + 1);
      }
      const typedToday = [...todayCats.values()].reduce((a, b) => a + b, 0);
      const top = [...todayCats.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && typedToday > 0) {
        const seasonCat = dnaScored.categories.find(c => c.id === top[0]);
        const todayShare = (top[1] / typedToday) * 100;
        const divergence = seasonCat?.pct != null ? Math.abs(todayShare - seasonCat.pct) : 0;
        cands.push({
          kind: "type", w: 25 + divergence * 0.6,
          label: "Goal type",
          value: (() => {
            const l = top[1] > 1 ? `${dnaCatLabel(top[0] as never)}s ×${top[1]}` : dnaCatLabel(top[0] as never);
            return l.charAt(0).toUpperCase() + l.slice(1);
          })(),
          sub: seasonCat?.pct != null ? `${seasonCat.pct.toFixed(0)}% of our season goals` : null,
        });
      }
    }
    // Timing — when today's goals came, vs the season's habit.
    {
      const mins = matchOurGoals.map(g => g.minuteScored).filter((m): m is number => m != null);
      const seasonMins = ourGoalsUpTo.map(g => g.minuteScored).filter((m): m is number => m != null);
      const secondHalfPct = seasonMins.length
        ? (seasonMins.filter(m => m > 45).length / seasonMins.length) * 100 : null;
      if (mins.length >= 2) {
        const allSecond = mins.every(m => m > 45);
        const allFirst = mins.every(m => m <= 45);
        const allLate = mins.every(m => m >= 70);
        const allEarly = mins.every(m => m <= 25);
        const sub = secondHalfPct != null ? `season: ${secondHalfPct.toFixed(0)}% of our goals come after the break` : null;
        if (allLate) cands.push({ kind: "timing", w: 45, label: "When they came", value: `All ${mins.length} after the 70th`, sub });
        else if (allEarly) cands.push({ kind: "timing", w: 45, label: "When they came", value: `All ${mins.length} inside 25 minutes`, sub });
        else if (allSecond) cands.push({ kind: "timing", w: 35, label: "When they came", value: "All after half-time", sub });
        else if (allFirst) cands.push({ kind: "timing", w: 35, label: "When they came", value: "All before the break", sub });
        else cands.push({ kind: "timing", w: 15, label: "When they came", value: "Spread across the game", sub });
      }
    }
    // Scorer — brace/hat-trick today, or a season milestone for today's scorer.
    {
      const todayTally = new Map<string, number>();
      for (const g of matchOurGoals) {
        const s = g.scorer?.trim();
        if (s && s !== "OG") todayTally.set(s, (todayTally.get(s) ?? 0) + 1);
      }
      const top = [...todayTally.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) {
        const [name, n] = top;
        const season = goalTally.get(name) ?? n;
        const isNew = season === n;
        const isLeader = season === teamTopGoals && teamTopGoals >= 3;
        cands.push({
          kind: "scorer",
          w: n >= 3 ? 70 : n === 2 ? 50 : isNew ? 40 : isLeader ? 35 : 20,
          label: "Goals",
          value: n >= 3 ? `${name} — hat-trick` : n === 2 ? `${name} ×2` : name,
          sub: isNew ? `first goal${n > 1 ? "s" : ""} of the season`
            : isLeader ? `${season} this season — top of our charts`
            : `${season} this season`,
        });
      }
    }
    // Assists — a first-of-the-season assister, or the charts leader adding more.
    {
      const todayAssists = new Map<string, number>();
      for (const g of matchOurGoals) {
        const a = g.assist?.trim();
        if (a && a !== "OG") todayAssists.set(a, (todayAssists.get(a) ?? 0) + 1);
      }
      const teamTopAssistsN = Math.max(0, ...assistTally.values());
      let best: { w: number; value: string; sub: string | null } | null = null;
      for (const [name, n] of todayAssists) {
        const season = assistTally.get(name) ?? n;
        const isNew = season === n;
        const isLeader = season === teamTopAssistsN && teamTopAssistsN >= 3;
        const cand = isNew
          ? { w: 40, value: name, sub: `first assist${n > 1 ? "s" : ""} of the season` }
          : isLeader
            ? { w: 38, value: `${name} — assist #${season}`, sub: "top of our charts" }
            : { w: 18 + n * 5, value: n > 1 ? `${name} ×${n}` : name, sub: `${season} this season` };
        if (!best || cand.w > best.w) best = cand;
      }
      if (best) cands.push({ kind: "assist", w: best.w, label: "Assists", value: best.value, sub: best.sub });
    }
    // Defence — clean sheet with the shut-out count and who kept it.
    if (match.cleanSheet) {
      let csRun = 0;
      for (let i = upTo.length - 1; i >= 0 && upTo[i].cleanSheet; i--) csRun++;
      const backline = stats
        .filter(s => s.matchId === match.id && s.started && s.position && /^(GK|CB|LB|RB|LWB|RWB|DM)$/i.test(s.position))
        .map(s => s.playerName);
      cands.push({
        kind: "defence", w: csRun >= 2 ? 55 : 42,
        label: "Defence",
        value: csRun >= 2 ? `Clean sheet — ${csRun} straight` : `Clean sheet #${totalCs}`,
        sub: backline.length ? backline.slice(0, 4).join(", ") : `${totalCs} shut-out${totalCs === 1 ? "" : "s"} this season`,
      });
    }
    const byKind = new Map<string, typeof cands[number]>();
    for (const c of cands) {
      const cur = byKind.get(c.kind);
      if (!cur || c.w > cur.w) byKind.set(c.kind, c);
    }
    insightBadges.push(...[...byKind.values()].sort((a, b) => b.w - a.w).slice(0, 4)
      .map(({ label, value, sub }) => ({ label, value, sub })));
  }

  const goalDna = dnaScored.totalTyped + dnaConceded.totalTyped > 0
    ? { scored: dnaScored, conceded: dnaConceded, comments: dnaComments,
        matchGoals: dnaStory.matchGoals, tacticalRead: dnaStory.tacticalRead,
        dayInsights, insightBadges }
    : null;

  // ── Ball use: possession vs possession-effectiveness quadrant ────────────
  // X = possession share; Y = shots per 100 passes (how often the ball work
  // turns into a shot). Quadrant lines sit at the season averages, so
  // "control" (top-right) means above-average possession that ALSO cuts
  // through — the philosophy target, rewarding shots within reasonable
  // passing moves rather than pure directness.
  let ballUse: {
    possession: number;
    passesPerShot: number;
    shotsPer100Passes: number;
    passes: number;
    seasonAvgPasses: number | null;
    seasonAvgPossession: number | null;
    seasonAvgShotsPer100: number | null;
    quadrant: "control" | "sterile" | "direct" | "chasing" | null;
    points: Array<{ label: string; possession: number; shotsPer100Passes: number; result: string | null; isThisMatch: boolean }>;
    comments: string[];
  } | null = null;
  {
    const possN = num(match.possession);
    if (possN != null && match.passes != null && match.shots != null && match.shots > 0 && match.passes > 0) {
      const pps = match.passes / match.shots;
      const sp100 = (match.shots / match.passes) * 100;
      const usable = ordered.filter(m => {
        const p = num(m.possession);
        return p != null && m.passes != null && m.shots != null && m.passes > 0;
      });
      const points = usable.map(m => ({
        label: `${m.matchId.split("-")[0]} v ${m.opponent}`,
        possession: num(m.possession)!,
        shotsPer100Passes: (m.shots! / m.passes!) * 100,
        result: resultOf(m),
        isThisMatch: m.id === matchRowId,
      }));
      const others = usable.filter(m => m.id !== matchRowId);
      const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
      const seasonAvgPossession = avg(others.map(m => num(m.possession)!));
      const seasonAvgShotsPer100 = avg(others.map(m => (m.shots! / m.passes!) * 100));
      const quadrant =
        seasonAvgPossession == null || seasonAvgShotsPer100 == null ? null
          : possN >= seasonAvgPossession && sp100 >= seasonAvgShotsPer100 ? "control" as const
          : possN >= seasonAvgPossession ? "sterile" as const
          : sp100 >= seasonAvgShotsPer100 ? "direct" as const
          : "chasing" as const;

      const comments: string[] = [];
      const ppsOthers = others.filter(m => m.shots! > 0);
      const ppsAvg = ppsOthers.length ? ppsOthers.reduce((a, m) => a + m.passes! / m.shots!, 0) / ppsOthers.length : null;
      if (ppsAvg != null) {
        const diff = ((pps - ppsAvg) / ppsAvg) * 100;
        const cmp = diff <= -20 ? "much more direct than" : diff <= -8 ? "sharper than" : diff >= 25 ? "a lot more patient than" : diff >= 8 ? "more patient than" : "right on";
        comments.push(`A shot every ${pps.toFixed(0)} passes — ${cmp} our season usual (one every ${ppsAvg.toFixed(0)}).`);
      } else {
        comments.push(`A shot every ${pps.toFixed(0)} passes.`);
      }
      if (quadrant === "control") comments.push(`The philosophy game: kept the ball (${possN}%) AND cut through with it.`);
      else if (quadrant === "sterile") comments.push(`Plenty of ball (${possN}%) but it didn't turn into shots often enough — sterile possession.`);
      else if (quadrant === "direct") comments.push(`Less of the ball (${possN}%) but efficient with it — got our shots away quickly when we had it.`);
      else if (quadrant === "chasing") comments.push(`Below our usual on both counts — less ball (${possN}%) and fewer shots from it.`);
      if (possN < 45 && result === "W") comments.push(`Won it with just ${possN}% possession — clinical on the counter.`);

      // ── Passing insight: several candidate angles, weighted; the heaviest
      // (most striking) one is shown, so the sentence varies game to game.
      const passesN = match.passes;
      const passGames = ordered.filter(m => m.passes != null && m.passes > 0);
      const passOthers = passGames.filter(m => m.id !== matchRowId);
      const seasonAvgPasses = passOthers.length
        ? passOthers.reduce((a, m) => a + m.passes!, 0) / passOthers.length : null;
      {
        const cands: Array<{ w: number; text: string }> = [];
        // Season high / low pass count (needs a few games of context).
        if (passOthers.length >= 4) {
          const maxOther = Math.max(...passOthers.map(m => m.passes!));
          const minOther = Math.min(...passOthers.map(m => m.passes!));
          if (passesN > maxOther) cands.push({ w: 60, text: `${passesN} passes — our biggest passing game of the season (previous best ${maxOther}).` });
          else if (passesN < minOther) cands.push({ w: 45, text: `${passesN} passes — our lowest passing game of the season. Worth asking why the ball wouldn't stick.` });
        }
        // Run of above-average passing games ending today.
        if (seasonAvgPasses != null && passGames.length >= 4) {
          const chron = passGames; // already chronological (ordered)
          const myPos = chron.findIndex(m => m.id === matchRowId);
          let run = 0;
          for (let i = myPos; i >= 0; i--) {
            if (chron[i].passes! > seasonAvgPasses) run++;
            else break;
          }
          if (run >= 3) cands.push({ w: 30 + run * 8, text: `That's ${run} straight games above our season passing average (${seasonAvgPasses.toFixed(0)}) — the passing game is trending up.` });
        }
        // Versus this opponent: earlier meetings this season.
        const prevOppPasses = ordered.slice(0, idx)
          .filter(m => m.opponent === match.opponent && m.passes != null && m.passes > 0)
          .map(m => m.passes!);
        if (prevOppPasses.length > 0) {
          const oppAvg = prevOppPasses.reduce((a, b) => a + b, 0) / prevOppPasses.length;
          const diff = ((passesN - oppAvg) / oppAvg) * 100;
          if (Math.abs(diff) >= 10) {
            cands.push({
              w: Math.min(55, Math.abs(diff) * 1.5),
              text: diff > 0
                ? `${passesN} passes against ${match.opponent} — well up on the ${oppAvg.toFixed(0)} we've averaged against them this season.`
                : `${passesN} passes against ${match.opponent} — down on the ${oppAvg.toFixed(0)} we've averaged against them this season.`,
            });
          }
        }
        // Fallback: plain season-average comparison, weighted by how far off it was.
        if (seasonAvgPasses != null && passOthers.length >= 2) {
          const diff = ((passesN - seasonAvgPasses) / seasonAvgPasses) * 100;
          const cmp = diff >= 12 ? "well above" : diff >= 5 ? "above" : diff <= -12 ? "well below" : diff <= -5 ? "below" : "right on";
          cands.push({ w: Math.min(40, Math.abs(diff)), text: `${passesN} passes — ${cmp} our season average of ${seasonAvgPasses.toFixed(0)}.` });
        }
        const best = cands.sort((a, b) => b.w - a.w)[0];
        if (best) comments.push(best.text);
      }

      ballUse = { possession: possN, passesPerShot: pps, shotsPer100Passes: sp100, passes: passesN, seasonAvgPasses, seasonAvgPossession, seasonAvgShotsPer100, quadrant, points, comments };
    }
  }

  // ── Previous meetings with this opponent this season ─────────────────────
  const earlier = ordered.slice(0, idx).filter(m => m.opponent === match.opponent);
  // Listed most-recent first for the report card.
  const previousMeetings = earlier.slice().reverse().map(m => ({
    matchLabel: `${m.matchId.split("-")[0]} v ${m.opponent}`,
    matchDate: m.matchDate,
    score: m.goalsScored != null && m.goalsConceded != null ? `${m.goalsScored}–${m.goalsConceded}` : "—",
    result: resultOf(m),
  }));
  if (earlier.length) {
    const w = earlier.filter(m => resultOf(m) === "W").length;
    const l = earlier.filter(m => resultOf(m) === "L").length;
    const d = earlier.filter(m => resultOf(m) === "D").length;
    const meetingNo = earlier.length + 1;
    const parts = [
      w ? `${w} win${w === 1 ? "" : "s"}` : null,
      d ? `${d} draw${d === 1 ? "" : "s"}` : null,
      l ? `${l} loss${l === 1 ? "" : "es"}` : null,
    ].filter(Boolean).join(", ");
    const summary =
      l === 0 && w === earlier.length ? `we'd won ${earlier.length === 1 ? `the first one ${earlier[0].goalsScored}–${earlier[0].goalsConceded}` : `all ${earlier.length} before today`}`
      : w === 0 && l === earlier.length ? `they'd ${earlier.length === 1 ? `beaten us ${earlier[0].goalsConceded}–${earlier[0].goalsScored}` : `won all ${earlier.length} earlier meetings`}`
      : l === 0 ? `unbeaten in the earlier games (${parts})`
      : w === 0 ? `still waiting on a win against them (${parts})`
      : `honours were shared coming in (${parts})`;
    insights.push({ tone: "info", text: `${ord(meetingNo)} meeting with ${match.opponent} this season — ${summary}.` });
  }

  // ── GPS numbers for this round, if a Catapult upload exists ──────────────
  // GPS rows are keyed by round tag + squad suffix (e.g. "R14-1sts") and by
  // season YEAR (text), not seasonId. Only game-total rows (split "game").
  let gps: {
    totalDistanceKm: number | null;
    defendersMPerMin: number | null;
    midfieldersMPerMin: number | null;
    forwardsHighSpeedM: number | null;
    playerCount: number;
    seasonAvgTotalDistanceKm: number | null;
    seasonAvgDefendersMPerMin: number | null;
    seasonAvgMidfieldersMPerMin: number | null;
    seasonAvgForwardsHighSpeedM: number | null;
    gamesInAvg: number | null;
    players: Array<{
      name: string;
      position: string | null;
      mins: number | null;
      distanceKm: number | null;
      mPerMin: number | null;
      sprintDistanceM: number | null;
    }>;
  } | null = null;
  const [seasonRow] = await db.select().from(seasonsTable).where(eq(seasonsTable.id, seasonId));
  if (seasonRow) {
    const gpsRowsQuery = db
      .select({
        name: sql<string>`coalesce(${gpsPlayerAliasesTable.canonical}, ${gpsSessionsTable.playerName})`,
        round: gpsSessionsTable.round,
        distanceKm: gpsSessionsTable.distanceKm,
        minsPlayed: gpsSessionsTable.minsPlayed,
        sprintDistanceM: gpsSessionsTable.sprintDistanceM,
      })
      .from(gpsSessionsTable)
      .leftJoin(gpsPlayerAliasesTable, eq(gpsPlayerAliasesTable.alias, gpsSessionsTable.playerName))
      // Scoped by team + season year + round. NOT by league_id: historical GPS
      // uploads carry the original league stamp (1) while newer seasons live
      // under their own league ids, so a league filter silently drops rows.
      .where(and(
        eq(gpsSessionsTable.teamId, teamId),
        eq(gpsSessionsTable.year, seasonRow.year),
        eq(gpsSessionsTable.splitName, "game"),
      ));
    // 1sts rounds only: bare "R7" or "R14-1sts" — reserves/juniors carry other
    // suffixes. Normalise the suffix away so both spellings pool per round.
    const allRows = (await gpsRowsQuery).filter(r => /^R\d+(-1sts)?$/i.test(r.round ?? ""));
    const roundKey = (r: string) => r.replace(/-1sts$/i, "").toUpperCase();
    const gpsRows = allRows.filter(r => roundKey(r.round!) === roundShort.toUpperCase());
    if (gpsRows.length) {
      const positions = await db.select().from(gpsPlayerPositionsTable);
      const posOf = new Map(positions.map(p => [p.playerName, p.position]));
      type GpsRow = typeof allRows[number];
      const sum = (rows: GpsRow[], f: (r: GpsRow) => number | null) =>
        rows.reduce((a, r) => a + (f(r) ?? 0), 0);
      const mPerMin = (rows: GpsRow[]) => {
        const mins = sum(rows, r => num(r.minsPlayed));
        return mins > 0 ? (sum(rows, r => num(r.distanceKm)) * 1000) / mins : null;
      };
      const bucket = (rows: GpsRow[], want: string) => rows.filter(r => posOf.get(r.name) === want);
      const metricsOf = (rows: GpsRow[]) => ({
        total: sum(rows, r => num(r.distanceKm)) || null,
        def: mPerMin(bucket(rows, "Defender")),
        mid: mPerMin(bucket(rows, "Midfielder")),
        fwd: bucket(rows, "Forward").length ? sum(bucket(rows, "Forward"), r => num(r.sprintDistanceM)) : null,
      });
      // Season averages: per-round metrics across the OTHER rounds this year.
      const byRound = new Map<string, GpsRow[]>();
      for (const r of allRows) {
        const k = roundKey(r.round!);
        if (k === roundShort.toUpperCase()) continue;
        byRound.set(k, [...(byRound.get(k) ?? []), r]);
      }
      const otherMetrics = [...byRound.values()].map(metricsOf);
      const avgOf = (pick: (m: ReturnType<typeof metricsOf>) => number | null) => {
        const vals = otherMetrics.map(pick).filter((v): v is number => v != null);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      };
      const players = gpsRows
        .map(r => {
          const mins = num(r.minsPlayed);
          const distKm = num(r.distanceKm);
          return {
            name: r.name,
            position: posOf.get(r.name) ?? null,
            mins,
            distanceKm: distKm,
            mPerMin: mins && mins > 0 && distKm != null ? (distKm * 1000) / mins : null,
            sprintDistanceM: num(r.sprintDistanceM),
          };
        })
        .sort((a, b) => (b.mins ?? 0) - (a.mins ?? 0));
      const thisRound = metricsOf(gpsRows);
      gps = {
        totalDistanceKm: thisRound.total,
        defendersMPerMin: thisRound.def,
        midfieldersMPerMin: thisRound.mid,
        forwardsHighSpeedM: thisRound.fwd,
        playerCount: gpsRows.length,
        seasonAvgTotalDistanceKm: avgOf(m => m.total),
        seasonAvgDefendersMPerMin: avgOf(m => m.def),
        seasonAvgMidfieldersMPerMin: avgOf(m => m.mid),
        seasonAvgForwardsHighSpeedM: avgOf(m => m.fwd),
        gamesInAvg: otherMetrics.length || null,
        players,
      };
      if (gps.totalDistanceKm != null && gps.totalDistanceKm >= 1) {
        insights.push({ tone: "info", text: `The team covered ${gps.totalDistanceKm.toFixed(1)} km in this one.` });
      }
    }
  }

  res.json(GetMatchReportResponse.parse({
    header: {
      matchLabel, opponent: match.opponent, matchDate: match.matchDate, venue: match.venue,
      result, halfScore: match.halfScore, fullScore: match.fullScore,
      goalsScored: match.goalsScored, goalsConceded: match.goalsConceded,
      formation: match.formation, oppFormation: match.oppFormation, cleanSheet: match.cleanSheet,
    },
    tiles, goals, insights, form, ladderPos, ladderPoints, teamsInLeague,
    gps, previousMeetings, ballUse, goalDna,
  }));
});

// ── Opponent match report — scouting view of ANY league club's game ─────────
// Built entirely from the league tables (league_matches + league_goals), so it
// works for every club: no GPS, no possession/shots — a slimmed version of the
// team match report, in a scouting voice ("they", strengths to watch /
// weaknesses to exploit). Reuses the MatchReportResponse shape: tiles [],
// gps/ballUse null.
router.get("/analytics/opponent-match-report", async (req, res): Promise<void> => {
  const query = GetOpponentMatchReportQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const { seasonId, club, matchId } = query.data;

  const allLeagueMatches = await db
    .select()
    .from(leagueMatchesTable)
    .where(eq(leagueMatchesTable.seasonId, seasonId));
  const clubMatches = allLeagueMatches
    .filter(m => (m.homeTeam === club || m.awayTeam === club) && /^R\d/.test(m.matchId))
    .sort((a, b) => (a.matchDate ?? "").localeCompare(b.matchDate ?? "") || a.matchId.localeCompare(b.matchId));
  const match = clubMatches.find(m => m.matchId === matchId);
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  const idx = clubMatches.findIndex(m => m.matchId === matchId);
  const upTo = clubMatches.slice(0, idx + 1);

  type LM = typeof allLeagueMatches[number];
  const isHome = (m: LM) => m.homeTeam === club;
  const scoredOf = (m: LM) => (isHome(m) ? m.homeGoals : m.awayGoals);
  const concededOf = (m: LM) => (isHome(m) ? m.awayGoals : m.homeGoals);
  const oppOf = (m: LM) => (isHome(m) ? m.awayTeam : m.homeTeam);
  const resultOf = (m: LM): "W" | "D" | "L" | null => {
    const s = scoredOf(m), c = concededOf(m);
    return s == null || c == null ? null : s > c ? "W" : s < c ? "L" : "D";
  };
  const result = resultOf(match);
  const roundShort = match.matchId.split("-")[0];
  const opponent = oppOf(match);
  const matchLabel = `${roundShort} v ${opponent}`;
  const scored = scoredOf(match), conceded = concededOf(match);

  // Half-time score oriented to the club (stored home–away).
  const parseScore = (s: string | null): [number, number] | null => {
    const m2 = s?.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
    return m2 ? [Number(m2[1]), Number(m2[2])] : null;
  };
  const htRaw = parseScore(match.halfScore);
  const ht = htRaw ? (isHome(match) ? htRaw : [htRaw[1], htRaw[0]] as [number, number]) : null;

  // ── Goals in this match (ours = credited to the club) ────────────────────
  const seasonGoals = await db
    .select()
    .from(leagueGoalsTable)
    .where(eq(leagueGoalsTable.seasonId, seasonId));
  const matchGoals = seasonGoals
    .filter(g => g.matchId === match.matchId)
    .sort((a, b) => (a.minuteScored ?? 999) - (b.minuteScored ?? 999));

  const upToIds = new Set(upTo.map(m => m.matchId));
  const clubGoalsUpTo = seasonGoals.filter(g => upToIds.has(g.matchId) && g.scorerTeam === club);
  const clubConcededUpTo = seasonGoals.filter(g =>
    upToIds.has(g.matchId) && g.scorerTeam !== club && (g.homeTeam === club || g.awayTeam === club));

  const tally = new Map<string, number>();
  for (const g of clubGoalsUpTo) {
    const n = g.scorer?.trim();
    if (n && n !== "OG") tally.set(n, (tally.get(n) ?? 0) + 1);
  }
  const goals = matchGoals.map(g => {
    const ours = g.scorerTeam === club;
    let note: string | null = null;
    if (ours && g.scorer && g.scorer !== "OG") {
      const season = tally.get(g.scorer.trim()) ?? 0;
      const inGame = matchGoals.filter(x => x.scorerTeam === club && x.scorer?.trim() === g.scorer!.trim()).length;
      const bits: string[] = [];
      if (inGame >= 3) bits.push("hat-trick");
      else if (inGame === 2) bits.push("brace");
      bits.push(`${season} for the season`);
      note = bits.join(" · ");
    }
    return {
      minute: g.minuteScored,
      scorer: g.scorer && g.scorer !== "OG" ? g.scorer : g.scorerTeam ?? null,
      assist: ours ? g.assist : null,
      ours, note,
    };
  });

  // ── Form + ladder as of this date ─────────────────────────────────────────
  const form = upTo.slice(-5).map(m => ({
    result: resultOf(m) ?? "?",
    opponent: oppOf(m),
    score: scoredOf(m) != null && concededOf(m) != null ? `${scoredOf(m)}–${concededOf(m)}` : "—",
    isThisMatch: m.matchId === matchId,
  }));
  const cutoff = match.matchDate ?? "9999";
  const standings = new Map<string, { pts: number; gd: number; gf: number }>();
  for (const m of allLeagueMatches) {
    if (!/^R\d/.test(m.matchId) || m.homeGoals == null || m.awayGoals == null) continue;
    if ((m.matchDate ?? "") > cutoff) continue;
    const upd = (c: string, gf: number, ga: number) => {
      const e = standings.get(c) ?? { pts: 0, gd: 0, gf: 0 };
      e.pts += gf > ga ? 3 : gf === ga ? 1 : 0;
      e.gd += gf - ga; e.gf += gf;
      standings.set(c, e);
    };
    upd(m.homeTeam, m.homeGoals, m.awayGoals);
    upd(m.awayTeam, m.awayGoals, m.homeGoals);
  }
  const table = [...standings.entries()].sort((a, b) => b[1].pts - a[1].pts || b[1].gd - a[1].gd || b[1].gf - a[1].gf);
  const posIdx = table.findIndex(([c]) => c === club);
  const ladderPos = posIdx >= 0 ? posIdx + 1 : null;
  const ladderPoints = posIdx >= 0 ? table[posIdx][1].pts : null;
  const teamsInLeague = table.length || null;

  // ── Insights — scouting voice ─────────────────────────────────────────────
  const ord2 = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
  const insights: Array<{ tone: "good" | "watch" | "info"; text: string }> = [];
  const resultsUpTo = upTo.map(resultOf);
  let streak = 0;
  const last = resultsUpTo[resultsUpTo.length - 1];
  for (let i = resultsUpTo.length - 1; i >= 0 && resultsUpTo[i] === last; i--) streak++;
  if (result === "W" && streak >= 2) insights.push({ tone: "watch", text: `That's ${streak} wins on the trot for them — arriving in form.` });
  else if (result === "L" && streak >= 2) insights.push({ tone: "good", text: `${streak} losses in a row — confidence will be low.` });
  let unbeaten = 0;
  for (let i = resultsUpTo.length - 1; i >= 0 && resultsUpTo[i] !== null && resultsUpTo[i] !== "L"; i--) unbeaten++;
  if (result !== "L" && unbeaten >= 3 && unbeaten > streak) insights.push({ tone: "watch", text: `Unbeaten in ${unbeaten}.` });

  if (ht && result) {
    const [h1, h2] = ht;
    const htResult = h1 > h2 ? "W" : h1 < h2 ? "L" : "D";
    if (htResult === "L" && result === "W") insights.push({ tone: "watch", text: `Came from ${h1}–${h2} down at the break to win — they don't go away.` });
    else if (htResult === "W" && result === "L") insights.push({ tone: "good", text: `Led ${h1}–${h2} at half-time and lost — they can be got at after the break.` });
    else if (htResult === "W" && result === "W" && (scored ?? 0) - h1 >= 2) insights.push({ tone: "watch", text: `Kicked on after the break — ${(scored ?? 0) - h1} second-half goals.` });
  }
  if (conceded === 0 && scored != null) {
    let cs = 0;
    for (let i = upTo.length - 1; i >= 0 && concededOf(upTo[i]) === 0; i--) cs++;
    if (cs >= 2) insights.push({ tone: "watch", text: `Clean sheet — ${cs} shut-outs in a row now. Breaking them down first is the job.` });
  }
  // Their top scorer season-to-date.
  const topScorer = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topScorer && topScorer[1] >= 3) {
    insights.push({ tone: "info", text: `${topScorer[0]} leads their scoring on ${topScorer[1]} — the main threat to shut down.` });
  }
  if (ladderPos != null) {
    insights.push({ tone: "info", text: `${ord2(ladderPos)} of ${teamsInLeague} after this round on ${ladderPoints} points.` });
  }

  // ── Previous meetings of this pairing this season ─────────────────────────
  const earlier = clubMatches.slice(0, idx).filter(m => oppOf(m) === opponent);
  const previousMeetings = earlier.slice().reverse().map(m => ({
    matchLabel: `${m.matchId.split("-")[0]} v ${oppOf(m)}`,
    matchDate: m.matchDate,
    score: scoredOf(m) != null && concededOf(m) != null ? `${scoredOf(m)}–${concededOf(m)}` : "—",
    result: resultOf(m),
  }));

  // ── Goal DNA — scouting voice ─────────────────────────────────────────────
  type DnaCatId = "setPiece" | "frontThird" | "middleThird" | "backThird";
  const catOf = (t: string | null | undefined): DnaCatId | null => {
    const s = t?.trim().toUpperCase();
    if (!s) return null;
    if (s.startsWith("SP")) return "setPiece";
    if (s.startsWith("R-FT")) return "frontThird";
    if (s.startsWith("R-MT")) return "middleThird";
    if (s.startsWith("R-BT")) return "backThird";
    return null;
  };
  const BENCH: Record<DnaCatId, { lo: number; hi: number; label: string }> = {
    setPiece: { lo: 23, hi: 31, label: "27%" },
    middleThird: { lo: 44, hi: 54, label: "48–50%" },
    frontThird: { lo: 8, hi: 16, label: "~12%" },
    backThird: { lo: 8, hi: 16, label: "~12%" },
  };
  const LABELS: Record<DnaCatId, string> = {
    setPiece: "Set pieces", frontThird: "Front-third regains",
    middleThird: "Middle-third regains", backThird: "Back-third regains",
  };
  const dnaSideOf = (rows: typeof seasonGoals, matchRows: typeof seasonGoals, isScoredSide: boolean) => {
    const typed = rows.map(g => ({ cat: catOf(g.goalType), at: (g.goalType ?? "").toUpperCase().endsWith("-AT") })).filter(x => x.cat != null);
    const totalTyped = typed.length;
    const categories = (Object.keys(LABELS) as DnaCatId[]).map(id => {
      const inCat = typed.filter(x => x.cat === id);
      const at = id === "setPiece" ? 0 : inCat.filter(x => x.at).length;
      const pct = totalTyped ? (inCat.length / totalTyped) * 100 : null;
      return {
        id, label: LABELS[id], count: inCat.length, dt: id === "setPiece" ? 0 : inCat.length - at, at,
        pct, benchmarkLabel: BENCH[id].label,
        verdict: totalTyped >= 12 && pct != null ? (pct > BENCH[id].hi ? "high" as const : pct < BENCH[id].lo ? "low" as const : null) : null,
      };
    });
    const matchCats = new Map<DnaCatId, number>();
    for (const g of matchRows) {
      const c = catOf(g.goalType);
      if (c) matchCats.set(c, (matchCats.get(c) ?? 0) + 1);
    }
    const matchLines: string[] = [];
    if (totalTyped >= 12) {
      const sig = categories.slice().sort((a, b) =>
        (b.verdict === "high" ? 1000 : 0) + b.count - ((a.verdict === "high" ? 1000 : 0) + a.count))[0];
      const nToday = sig ? matchCats.get(sig.id) ?? 0 : 0;
      if (sig && nToday > 0 && sig.pct != null && sig.pct >= 25) {
        matchLines.push(isScoredSide
          ? `${nToday > 1 ? `${nToday} more` : "Another one"} from ${sig.label.toLowerCase()} — their signature. ${sig.count} of their ${totalTyped} this season have come that way; plan for it.`
          : `They conceded from ${sig.label.toLowerCase()} again — ${sig.count} of the ${totalTyped} they've let in this season. That's the door to knock on.`);
      }
    }
    return { totalTyped, categories, matchLines: matchLines.slice(0, 2) };
  };
  const matchClubGoals = matchGoals.filter(g => g.scorerTeam === club);
  const matchOppGoals = matchGoals.filter(g => g.scorerTeam !== club);
  const dnaScored = dnaSideOf(clubGoalsUpTo, matchClubGoals, true);
  const dnaConceded = dnaSideOf(clubConcededUpTo, matchOppGoals, false);
  const dnaComments: string[] = [];
  for (const c of dnaScored.categories) {
    if (c.verdict === "high") dnaComments.push(`${c.label} are ${c.pct!.toFixed(0)}% of their goals (benchmark ${c.benchmarkLabel}) — their go-to weapon; plan against it.`);
    else if (c.verdict === "low") dnaComments.push(`Only ${c.pct!.toFixed(0)}% of their goals come from ${c.label.toLowerCase()} (benchmark ${c.benchmarkLabel}) — not a threat they use much.`);
  }
  for (const c of dnaConceded.categories) {
    if (c.verdict === "high") dnaComments.push(`${c.pct!.toFixed(0)}% of what they concede comes from ${c.label.toLowerCase()} (benchmark ${c.benchmarkLabel}) — a weakness to exploit.`);
    else if (c.verdict === "low") dnaComments.push(`They concede just ${c.pct!.toFixed(0)}% from ${c.label.toLowerCase()} (benchmark ${c.benchmarkLabel}) — hard to hurt them that way.`);
  }
  const dnaStory = buildDnaStory({
    scored: matchClubGoals.map(g => ({ minute: g.minuteScored, scorer: g.scorer, goalType: g.goalType })),
    conceded: matchOppGoals.map(g => ({ minute: g.minuteScored, scorer: g.scorer, goalType: g.goalType })),
    catsScored: dnaScored.categories, catsConceded: dnaConceded.categories,
    totalTypedScored: dnaScored.totalTyped, totalTypedConceded: dnaConceded.totalTyped,
    voice: "scout",
  });
  // ── "What to watch" — scout insights across four sources ─────────────────
  // Coach-requested mix: assist→scorer partnerships, a player in form
  // (scoring streaks), a goal type they've been scoring LATELY (recent-form
  // DNA vs season mix), and league-wide on-field impact ("when she starts
  // they win"). Threats read amber-ish in text; their conceding trends read
  // as openings. Mirrors the team report's dayInsights pattern.
  const pairIns: { n: number; text: string }[] = [];
  const streakIns: string[] = [];
  const trendIns: string[] = [];
  const impactIns: string[] = [];

  // 1. Partnerships that keep combining (both directions), season-to-date.
  {
    const pairCounts = new Map<string, { assist: string; scorer: string; n: number }>();
    for (const g of clubGoalsUpTo) {
      const scorer = g.scorer?.trim(), assist = g.assist?.trim();
      if (!scorer || !assist || scorer === "OG" || assist === "OG" || scorer === assist) continue;
      const key = `${assist}\u0000${scorer}`;
      const e = pairCounts.get(key);
      if (e) e.n++; else pairCounts.set(key, { assist, scorer, n: 1 });
    }
    for (const p of [...pairCounts.values()].sort((a, b) => b.n - a.n)) {
      if (p.n >= 3) pairIns.push({ n: p.n, text: `${p.assist} → ${p.scorer} is their supply line — that partnership has produced ${p.n} of their goals this season. Cut the service and you cut the threat.` });
    }
  }

  // 2. A player in form — scored in consecutive club games ending at this one.
  {
    const scorersToday = [...new Set(matchClubGoals.map(g => g.scorer?.trim()).filter((s): s is string => !!s && s !== "OG"))];
    const before = upTo.slice(0, -1);
    for (const name of scorersToday) {
      let run = 1;
      for (let i = before.length - 1; i >= 0; i--) {
        const scoredIn = seasonGoals.some(g => g.matchId === before[i].matchId && g.scorerTeam === club && g.scorer?.trim() === name);
        if (scoredIn) run++; else break;
      }
      if (run >= 3) streakIns.push(`${name} has scored in ${run} straight games — the form player, and the first name on the scouting board.`);
    }
    // Fallback: a hot recent scorer even without a game-by-game streak.
    if (streakIns.length === 0) {
      const recentIds = new Set(upTo.slice(-3).map(m => m.matchId));
      const recentTally = new Map<string, number>();
      for (const g of clubGoalsUpTo) {
        const n = g.scorer?.trim();
        if (n && n !== "OG" && recentIds.has(g.matchId)) recentTally.set(n, (recentTally.get(n) ?? 0) + 1);
      }
      const hot = [...recentTally.entries()].sort((a, b) => b[1] - a[1])[0];
      if (hot && hot[1] >= 3) streakIns.push(`${hot[0]} has ${hot[1]} goals in their last 3 games — in form right now.`);
    }
  }

  // 3. Recent-form goal-type trend — last 4 club games vs their season DNA.
  {
    const recentIds = new Set(upTo.slice(-4).map(m => m.matchId));
    const trendSide = (rows: typeof seasonGoals, isScoredSide: boolean) => {
      const seasonTyped = rows.map(g => dnaCatOfType(g.goalType)).filter((c): c is NonNullable<ReturnType<typeof dnaCatOfType>> => c != null);
      const recentTyped = rows.filter(g => recentIds.has(g.matchId)).map(g => dnaCatOfType(g.goalType)).filter((c): c is NonNullable<ReturnType<typeof dnaCatOfType>> => c != null);
      if (recentTyped.length < 3 || seasonTyped.length < 8) return;
      const count = (arr: typeof seasonTyped, id: string) => arr.filter(c => c === id).length;
      for (const id of ["setPiece", "frontThird", "middleThird", "backThird"] as const) {
        const rn = count(recentTyped, id), sn = count(seasonTyped, id);
        const rPct = (rn / recentTyped.length) * 100, sPct = (sn / seasonTyped.length) * 100;
        if (rn >= 2 && rPct >= 40 && rPct - sPct >= 15) {
          trendIns.push(isScoredSide
            ? `Lately it's ${dnaCatLabel(id)} goals — ${rn} of their last ${recentTyped.length} typed goals (season mix is ${sPct.toFixed(0)}%). That's the in-form weapon to plan for.`
            : `They've been leaking from ${dnaCatLabel(id)}s lately — ${rn} of the last ${recentTyped.length} they've conceded (season mix ${sPct.toFixed(0)}%). That's the door that's open right now.`);
          break; // one trend line per side is enough
        }
      }
    };
    trendSide(clubGoalsUpTo, true);
    trendSide(clubConcededUpTo, false);
  }

  // 4. League-wide on-field impact — minute-window GD across ALL clubs up to
  // this round; a club player high (or climbing) in those rankings is a threat.
  {
    const leagueIdsUpTo = allLeagueMatches
      .filter(m => /^R\d/.test(m.matchId) && (m.matchDate ?? "") <= cutoff && m.homeGoals != null && m.awayGoals != null)
      .map(m => m.matchId);
    if (leagueIdsUpTo.length) {
      const lps = await db
        .select({
          playerName: leaguePlayerStatsTable.playerName,
          matchId: leaguePlayerStatsTable.matchId,
          minsPlayed: leaguePlayerStatsTable.minsPlayed,
          started: leaguePlayerStatsTable.started,
          appearance: leaguePlayerStatsTable.appearance,
          club: leaguePlayerStatsTable.club,
        })
        .from(leaguePlayerStatsTable)
        .where(and(eq(leaguePlayerStatsTable.seasonId, seasonId), inArray(leaguePlayerStatsTable.matchId, leagueIdsUpTo)));
      const idsUpToSet = new Set(leagueIdsUpTo);
      const goalsByMatch = new Map<string, Array<{ team: string | null; minute: number | null }>>();
      const matchLen = new Map<string, number>();
      for (const g of seasonGoals) {
        if (!idsUpToSet.has(g.matchId)) continue;
        (goalsByMatch.get(g.matchId) ?? goalsByMatch.set(g.matchId, []).get(g.matchId)!)
          .push({ team: g.scorerTeam, minute: g.minuteScored });
        if (g.minuteScored != null) matchLen.set(g.matchId, Math.max(matchLen.get(g.matchId) ?? 90, g.minuteScored));
      }
      for (const r of lps) if (r.minsPlayed != null) matchLen.set(r.matchId, Math.max(matchLen.get(r.matchId) ?? 90, r.minsPlayed));

      const recentIds = new Set(upTo.slice(-3).map(m => m.matchId));
      type Imp = { playerName: string; club: string; gd: number; apps: number; recentGd: number; recentApps: number };
      const impMap = new Map<string, Imp>();
      for (const r of lps) {
        if (!r.playerName || !r.club || !r.appearance) continue;
        const L = matchLen.get(r.matchId) ?? 90;
        const mins = r.minsPlayed ?? 0;
        const winStart = r.started ? 0 : Math.max(0, L - mins);
        const winEnd = r.started ? mins : L;
        let gf = 0, ga = 0;
        for (const g of goalsByMatch.get(r.matchId) ?? []) {
          const on = g.minute == null || mins <= 0 ? mins > 0 : g.minute >= winStart && g.minute <= winEnd;
          if (!on) continue;
          if (g.team === r.club) gf++; else ga++;
        }
        const key = `${r.playerName}|${r.club}`;
        const e = impMap.get(key) ?? { playerName: r.playerName, club: r.club, gd: 0, apps: 0, recentGd: 0, recentApps: 0 };
        e.gd += gf - ga; e.apps++;
        if (recentIds.has(r.matchId)) { e.recentGd += gf - ga; e.recentApps++; }
        impMap.set(key, e);
      }
      const ranked = [...impMap.values()].filter(p => p.apps >= 3).sort((a, b) => b.gd - a.gd);
      const ord3 = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;
      const clubTop = ranked.map((p, i) => ({ ...p, rank: i + 1 })).filter(p => p.club === club);
      const star = clubTop.find(p => p.rank <= 5 && p.gd > 0);
      if (star) {
        impactIns.push(`When ${star.playerName} plays, they win — the team is +${star.gd} with her on the pitch, the ${ord3(star.rank)}-best on-field impact in the whole league.`);
      } else {
        const climber = clubTop.filter(p => p.recentApps >= 2 && p.recentGd >= 3).sort((a, b) => b.recentGd - a.recentGd)[0];
        if (climber) impactIns.push(`${climber.playerName}'s influence is climbing — +${climber.recentGd} with her on the pitch across their last ${climber.recentApps} games. One to track.`);
      }
    }
  }

  // Mix the sources — best of each kind first, then backfill, capped at 3.
  const sortedPairs = pairIns.sort((a, b) => b.n - a.n).map(p => p.text);
  const watchInsights = [sortedPairs[0], streakIns[0], trendIns[0], impactIns[0], trendIns[1], ...sortedPairs.slice(1), ...streakIns.slice(1)]
    .filter((s): s is string => !!s)
    .slice(0, 3);

  const goalDna = dnaScored.totalTyped + dnaConceded.totalTyped > 0 || watchInsights.length > 0
    ? { scored: dnaScored, conceded: dnaConceded, comments: dnaComments,
        matchGoals: dnaStory.matchGoals, tacticalRead: dnaStory.tacticalRead,
        dayInsights: watchInsights }
    : null;

  res.json(GetMatchReportResponse.parse({
    header: {
      matchLabel, opponent, matchDate: match.matchDate, venue: null,
      result,
      halfScore: ht ? `${ht[0]}–${ht[1]}` : null, // oriented to the club, like the score
      fullScore: match.fullScore,
      goalsScored: scored, goalsConceded: conceded,
      formation: null, oppFormation: null, cleanSheet: conceded === 0 && scored != null,
    },
    tiles: [], goals, insights, form, ladderPos, ladderPoints, teamsInLeague,
    gps: null, previousMeetings, ballUse: null, goalDna,
  }));
});

export default router;
