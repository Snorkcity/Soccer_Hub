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
  ListGpsOpponentMismatchesQueryParams,
  ListGpsOpponentMismatchesResponse,
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
 * GPS feed (read-only share): a league with gps_source_league_id set has no
 * GPS uploads of its own — reads pull the SOURCE league's rows, filtered to
 * one squad (parsed from the round suffix). The requesting user only needs
 * access to the requesting league: the central middleware checks the leagueId
 * on the request as usual, and this deliberate, squad-scoped read is the only
 * way source-league data crosses over. Writes stay blocked (see POST below and
 * /entry/gps-sessions), so fixes/re-uploads happen in the source league only.
 */
async function gpsFeedFor(leagueId: number): Promise<{ sourceLeagueId: number; squad: string } | null> {
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId)).limit(1);
  if (!league?.gpsSourceLeagueId || !league.gpsSourceSquad) return null;
  return { sourceLeagueId: league.gpsSourceLeagueId, squad: league.gpsSourceSquad };
}

/**
 * Fixture opponents for a FEED league, keyed by `${year}|R#`: the feed
 * league's own fixtures (imported separately), matched by round number only —
 * opponent names may differ word-for-word between the GPS upload and the
 * fixture import, so the round code is the reliable join.
 */
async function ownFixtureOpponentMap(leagueId: number): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const seasons = await db.select().from(seasonsTable).where(eq(seasonsTable.leagueId, leagueId));
  if (!seasons.length) return map;
  const yearOfSeason = new Map(seasons.map(s => [s.id, s.year]));
  const fixtures = await db.select().from(matchesTable)
    .where(inArray(matchesTable.seasonId, [...yearOfSeason.keys()]));
  for (const m of fixtures) {
    const year = m.seasonId != null ? yearOfSeason.get(m.seasonId) : undefined;
    if (!year || !m.opponent) continue;
    const rd = /^(R\d+)-/i.exec(m.matchId ?? "");
    if (!rd) continue;
    const key = `${year}|${rd[1].toUpperCase()}`;
    if (!map.has(key)) map.set(key, m.opponent);
  }
  return map;
}

const norm = (s: string) => s.trim().toLowerCase();
/** Loose opponent agreement: "Croatia" vs "Canberra Croatia FC" counts as the same club. */
const agrees = (a: string, b: string) => {
  const na = norm(a), nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
};

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
  const { leagueId, playerId, year, teamId, round, playerName, split, squad } = query.data;
  if (!leagueId) {
    res.status(400).json({ error: "leagueId is required" });
    return;
  }

  // Duplicate GPS identities (U17-/U18- eras, nicknames) are merged on read:
  // rows keep their raw name in the DB, but the API serves — and filters by —
  // the canonical name from gps_player_aliases.
  const canonicalName = sql<string>`coalesce(${gpsPlayerAliasesTable.canonical}, ${gpsSessionsTable.playerName})`;

  // Feed league: read the source league's rows (squad-filtered below).
  const feed = await gpsFeedFor(leagueId);
  const readLeagueId = feed ? feed.sourceLeagueId : leagueId;

  const conditions = [eq(gpsSessionsTable.leagueId, readLeagueId)];
  if (playerId) conditions.push(eq(gpsSessionsTable.playerId, playerId));
  if (year) conditions.push(eq(gpsSessionsTable.year, year));
  if (teamId) conditions.push(eq(gpsSessionsTable.teamId, teamId));
  if (round) conditions.push(eq(gpsSessionsTable.round, round));
  if (playerName) conditions.push(eq(canonicalName, playerName));
  if (split) conditions.push(eq(gpsSessionsTable.splitName, split));

  const allRows = await db
    .select({ ...getTableColumns(gpsSessionsTable), playerName: canonicalName })
    .from(gpsSessionsTable)
    .leftJoin(gpsPlayerAliasesTable, eq(gpsPlayerAliasesTable.alias, gpsSessionsTable.playerName))
    .where(and(...conditions))
    .orderBy(gpsSessionsTable.sessionDate);

  // Feed: only the configured squad's rows cross the league boundary — unless
  // the caller explicitly asks for the 1sts (e.g. a reserves player report
  // showing 1st-grade averages). ONLY "1sts" may be requested as an override:
  // the source league IS the 1sts, so this widens nothing beyond the top
  // grade; any other squad label is ignored to keep the configured boundary.
  const wantSquad = feed ? (squad === "1sts" ? "1sts" : feed.squad) : null;
  const overrideSquad = feed != null && wantSquad !== feed.squad;
  const rows = wantSquad ? allRows.filter(r => squadOfRound(r.round) === wantSquad) : allRows;

  let withOpponent;
  if (feed && overrideSquad) {
    // 1sts override rows belong to the SOURCE league's competition — pair them
    // with the source league's own fixtures, not the feed league's.
    const fixtureOpps = await fixtureOpponentMap(feed.sourceLeagueId);
    withOpponent = rows.map(r => {
      if (r.opponent || !r.round || !r.year) return r;
      const rd = /^(R\d+)(?:$|-)/i.exec(r.round.trim());
      if (!rd) return r;
      const opp = fixtureOpps.get(`${r.year}|1sts|${rd[1].toUpperCase()}`);
      return opp ? { ...r, opponent: opp } : r;
    });
  } else if (feed) {
    // Pair shared rounds with the FEED league's own fixtures by round number.
    // A carried GPS opponent that loosely agrees is replaced by the fixture's
    // spelling; a disagreement keeps the carried name (the mismatch endpoint
    // flags it). No fixture at all ALWAYS clears the opponent — even a carried
    // one, since it came from another competition's upload and can't be
    // trusted here — so the app shows a visible "couldn't match" state rather
    // than silently misattributing the game.
    const fixtureOpps = await ownFixtureOpponentMap(leagueId);
    withOpponent = rows.map(r => {
      if (!r.round || !r.year) return { ...r, opponent: null };
      const rd = /^(R\d+)(?:$|-)/i.exec(r.round.trim());
      if (!rd) return { ...r, opponent: null };
      const fixtureOpp = fixtureOpps.get(`${r.year}|${rd[1].toUpperCase()}`);
      if (!fixtureOpp) return { ...r, opponent: null };
      if (!r.opponent || agrees(r.opponent, fixtureOpp)) return { ...r, opponent: fixtureOpp };
      return r;
    });
  } else {
    // Fill missing opponents from the football fixtures (round-number match).
    const needsOpponent = rows.some(r => !r.opponent && r.round);
    const fixtureOpps = needsOpponent ? await fixtureOpponentMap(leagueId) : new Map<string, string>();
    withOpponent = rows.map(r => {
      if (r.opponent || !r.round || !r.year) return r;
      const rd = /^(R\d+)(?:$|-)/i.exec(r.round.trim());
      if (!rd) return r;
      const opp = fixtureOpps.get(`${r.year}|${squadOfRound(r.round)}|${rd[1].toUpperCase()}`);
      return opp ? { ...r, opponent: opp } : r;
    });
  }

  res.json(ListGpsSessionsResponse.parse(withOpponent.map(mapRow)));
});

/**
 * Rounds where the Catapult-carried opponent disagrees with the football
 * fixture for the same year/squad/round. A GPS row's own opponent always wins
 * in the charts, so when it's wrong nobody is told — this surfaces the clash.
 * Loose comparison: "Croatia" vs "Canberra Croatia FC" counts as agreement.
 */
router.get("/gps-opponent-mismatches", async (req, res): Promise<void> => {
  const query = ListGpsOpponentMismatchesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { leagueId, year } = query.data;
  if (!leagueId) {
    res.status(400).json({ error: "leagueId is required" });
    return;
  }

  const feed = await gpsFeedFor(leagueId);
  const conditions = [eq(gpsSessionsTable.leagueId, feed ? feed.sourceLeagueId : leagueId)];
  if (year) conditions.push(eq(gpsSessionsTable.year, year));
  const allRows = await db
    .selectDistinct({ year: gpsSessionsTable.year, round: gpsSessionsTable.round, opponent: gpsSessionsTable.opponent })
    .from(gpsSessionsTable)
    .where(and(...conditions));
  const rows = feed ? allRows.filter(r => squadOfRound(r.round) === feed.squad) : allRows;

  const carried = rows.filter(r => r.opponent?.trim() && r.round?.trim());
  if (!carried.length) {
    res.json(ListGpsOpponentMismatchesResponse.parse([]));
    return;
  }

  // Feed league: compare against the feed league's OWN fixtures (round-number
  // keyed) — the source league's fixture list is a different competition.
  const ownOpps = feed ? await ownFixtureOpponentMap(leagueId) : null;
  const fixtureOpps = feed ? new Map<string, string>() : await fixtureOpponentMap(leagueId);

  const seen = new Set<string>();
  const out: { year: string; round: string; squad: string; gpsOpponent: string; fixtureOpponent: string }[] = [];
  for (const r of carried) {
    const round = r.round!.trim();
    const gpsOpponent = r.opponent!.trim();
    const rd = /^(R\d+)(?:$|-)/i.exec(round);
    if (!rd) continue;
    const squad = squadOfRound(round);
    const fixtureOpponent = ownOpps
      ? ownOpps.get(`${r.year}|${rd[1].toUpperCase()}`)
      : fixtureOpps.get(`${r.year}|${squad}|${rd[1].toUpperCase()}`);
    if (!fixtureOpponent || agrees(gpsOpponent, fixtureOpponent)) continue;
    const key = `${r.year}|${round}|${norm(gpsOpponent)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ year: r.year, round, squad, gpsOpponent, fixtureOpponent });
  }
  out.sort((a, b) => a.year.localeCompare(b.year) || a.round.localeCompare(b.round, undefined, { numeric: true }));
  res.json(ListGpsOpponentMismatchesResponse.parse(out));
});

router.post("/gps-sessions", async (req, res): Promise<void> => {
  const parsed = CreateGpsSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  // Feed leagues have no GPS rows of their own — the share must stay read-only.
  if (await gpsFeedFor(d.leagueId)) {
    res.status(400).json({ error: "This league's GPS data is fed from another league — upload GPS data there instead" });
    return;
  }
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
