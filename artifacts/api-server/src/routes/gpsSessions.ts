import { Router, type IRouter } from "express";
import { eq, and, sql, inArray, getTableColumns } from "drizzle-orm";
import {
  db, gpsSessionsTable, gpsPlayerAliasesTable,
  matchesTable, seasonsTable, leaguesTable,
} from "@workspace/db";

const n2s = (v: number | null | undefined): string | null => (v == null ? null : String(v));
import {
  ListGpsSessionsQueryParams,
  ListGpsSessionsResponse,
  CreateGpsSessionBody,
  CreateGpsSessionResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const parseNum = (v: string | null | undefined) => (v != null ? parseFloat(v) : null);

function mapRow(r: typeof gpsSessionsTable.$inferSelect) {
  return {
    ...r,
    minsPlayed: parseNum(r.minsPlayed),
    distanceKm: parseNum(r.distanceKm),
    sprintDistanceM: parseNum(r.sprintDistanceM),
    powerPlays: parseNum(r.powerPlays),
    energyKcal: parseNum(r.energyKcal),
    impacts: parseNum(r.impacts),
    hrLoad: parseNum(r.hrLoad),
    timeInRedZoneMin: parseNum(r.timeInRedZoneMin),
    playerLoad: parseNum(r.playerLoad),
    topSpeedMs: parseNum(r.topSpeedMs),
    distancePerMinMm: parseNum(r.distancePerMinMm),
    powerScoreWkg: parseNum(r.powerScoreWkg),
    workRatio: parseNum(r.workRatio),
    hrMaxBpm: parseNum(r.hrMaxBpm),
    maxDecelerationMss: parseNum(r.maxDecelerationMss),
    maxAccelerationMss: parseNum(r.maxAccelerationMss),
    distanceZone1Km: parseNum(r.distanceZone1Km),
    distanceZone2Km: parseNum(r.distanceZone2Km),
    distanceZone3Km: parseNum(r.distanceZone3Km),
    distanceZone4Km: parseNum(r.distanceZone4Km),
    distanceZone5Km: parseNum(r.distanceZone5Km),
    accelCount34: parseNum(r.accelCount34),
    accelCountOver4: parseNum(r.accelCountOver4),
    decelCount34: parseNum(r.decelCount34),
    decelCountOver4: parseNum(r.decelCountOver4),
  };
}

/** Squad label from the Catapult round suffix — mirrors the frontend convention. */
function squadOfRound(round: string | null | undefined): string {
  if (!round) return "1sts";
  if (/-(res|r)$/i.test(round)) return "Reserves";
  if (/-1[78]s$/i.test(round)) return "17s / 18s";
  return "1sts";
}

/**
 * Fixture opponents keyed by `${year}|${squad}|R#`.
 *
 * Most Catapult sessions only carry a raw round tag ("R7-1sts"), so the GPS
 * opponent column is usually empty. The football fixtures already know the
 * opponent for every round: matchId starts with the round code ("R7-MAJ-BEL"),
 * and squad comes from the fixture's league — the GPS league itself is the
 * 1sts, and a sibling league named "<name> Reserves" holds the Reserves.
 */
async function fixtureOpponentMap(leagueId: number): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const leagues = await db.select().from(leaguesTable);
  const mine = leagues.find(l => l.id === leagueId);
  if (!mine) return map;
  const reserves = leagues.find(
    l => l.id !== mine.id && l.name.trim().toLowerCase() === `${mine.name.trim().toLowerCase()} reserves`,
  );
  const squadOfLeague = new Map<number, string>([[mine.id, "1sts"]]);
  if (reserves) squadOfLeague.set(reserves.id, "Reserves");

  const seasons = await db.select().from(seasonsTable)
    .where(inArray(seasonsTable.leagueId, [...squadOfLeague.keys()]));
  if (!seasons.length) return map;
  const seasonInfo = new Map(seasons.map(s => [s.id, { year: s.year, squad: squadOfLeague.get(s.leagueId)! }]));

  const fixtures = await db.select().from(matchesTable)
    .where(inArray(matchesTable.seasonId, [...seasonInfo.keys()]));
  for (const m of fixtures) {
    const info = m.seasonId != null ? seasonInfo.get(m.seasonId) : undefined;
    if (!info || !m.opponent) continue;
    const rd = /^(R\d+)-/i.exec(m.matchId ?? "");
    if (!rd) continue;
    const key = `${info.year}|${info.squad}|${rd[1].toUpperCase()}`;
    if (!map.has(key)) map.set(key, m.opponent);
  }
  return map;
}

router.get("/gps-sessions", async (req, res): Promise<void> => {
  const query = ListGpsSessionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { leagueId, playerId, year, teamId, round, playerName, split } = query.data;
  if (!leagueId) {
    res.status(400).json({ error: "leagueId is required" });
    return;
  }

  // Duplicate GPS identities (U17-/U18- eras, nicknames) are merged on read:
  // rows keep their raw name in the DB, but the API serves — and filters by —
  // the canonical name from gps_player_aliases.
  const canonicalName = sql<string>`coalesce(${gpsPlayerAliasesTable.canonical}, ${gpsSessionsTable.playerName})`;

  const conditions = [eq(gpsSessionsTable.leagueId, leagueId)];
  if (playerId) conditions.push(eq(gpsSessionsTable.playerId, playerId));
  if (year) conditions.push(eq(gpsSessionsTable.year, year));
  if (teamId) conditions.push(eq(gpsSessionsTable.teamId, teamId));
  if (round) conditions.push(eq(gpsSessionsTable.round, round));
  if (playerName) conditions.push(eq(canonicalName, playerName));
  if (split) conditions.push(eq(gpsSessionsTable.splitName, split));

  const rows = await db
    .select({ ...getTableColumns(gpsSessionsTable), playerName: canonicalName })
    .from(gpsSessionsTable)
    .leftJoin(gpsPlayerAliasesTable, eq(gpsPlayerAliasesTable.alias, gpsSessionsTable.playerName))
    .where(and(...conditions))
    .orderBy(gpsSessionsTable.sessionDate);

  // Fill missing opponents from the football fixtures (round-number match).
  const needsOpponent = rows.some(r => !r.opponent && r.round);
  const fixtureOpps = needsOpponent ? await fixtureOpponentMap(leagueId) : new Map<string, string>();
  const withOpponent = rows.map(r => {
    if (r.opponent || !r.round || !r.year) return r;
    const rd = /^(R\d+)(?:$|-)/i.exec(r.round.trim());
    if (!rd) return r;
    const opp = fixtureOpps.get(`${r.year}|${squadOfRound(r.round)}|${rd[1].toUpperCase()}`);
    return opp ? { ...r, opponent: opp } : r;
  });

  res.json(ListGpsSessionsResponse.parse(withOpponent.map(mapRow)));
});

router.post("/gps-sessions", async (req, res): Promise<void> => {
  const parsed = CreateGpsSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  const [session] = await db.insert(gpsSessionsTable).values({
    ...d,
    minsPlayed: n2s(d.minsPlayed), distanceKm: n2s(d.distanceKm), sprintDistanceM: n2s(d.sprintDistanceM),
    powerPlays: n2s(d.powerPlays), energyKcal: n2s(d.energyKcal), impacts: n2s(d.impacts),
    hrLoad: n2s(d.hrLoad), timeInRedZoneMin: n2s(d.timeInRedZoneMin), playerLoad: n2s(d.playerLoad),
    topSpeedMs: n2s(d.topSpeedMs), distancePerMinMm: n2s(d.distancePerMinMm), powerScoreWkg: n2s(d.powerScoreWkg),
    workRatio: n2s(d.workRatio), hrMaxBpm: n2s(d.hrMaxBpm), maxDecelerationMss: n2s(d.maxDecelerationMss),
    maxAccelerationMss: n2s(d.maxAccelerationMss), distanceZone1Km: n2s(d.distanceZone1Km), distanceZone2Km: n2s(d.distanceZone2Km),
    distanceZone3Km: n2s(d.distanceZone3Km), distanceZone4Km: n2s(d.distanceZone4Km), distanceZone5Km: n2s(d.distanceZone5Km),
    accelCount34: n2s(d.accelCount34), accelCountOver4: n2s(d.accelCountOver4),
    decelCount34: n2s(d.decelCount34), decelCountOver4: n2s(d.decelCountOver4),
  }).returning();
  res.status(201).json(CreateGpsSessionResponse.parse(mapRow(session)));
});

export default router;
