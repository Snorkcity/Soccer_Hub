// ── Veo stats sync ──────────────────────────────────────────────────────────
// Pulls a squad's match data from Veo's internal API into veo_matches, and
// serves it back to the Veo Insights tab. Sync is incremental + batch-capped so
// a single HTTP request stays responsive: metadata for every recording is
// upserted, then heavy per-match payloads (events/stats/periods/roster) are
// fetched only for matches that don't have them yet, up to `batch` per call.
// The client loops until { remaining } hits 0. See routes/dribl.ts for the
// sibling pattern and .agents/memory/veo-integration.md for the API map.
import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, veoMatchesTable, leaguesTable, matchesTable, seasonsTable } from "@workspace/db";
import {
  defaultVeoCreds,
  listRecordings,
  getMatchDetail,
  getEvents,
  getStats,
  getPeriods,
  getRoster,
  getPassDetails,
  opponentFromVeoTitle,
  normalizeVeoClub,
  type VeoCredentials,
  type VeoPassDetails,
  type VeoPassDetailPeriod,
} from "../lib/veo";
import { logger } from "../lib/logger";
import { getSessionUser, canSeeLeague } from "../middlewares/entryAuth";

const router: IRouter = Router();

const DEFAULT_BATCH = 20;

interface LeagueVeo {
  id: number;
  name: string;
  veoClubSlug: string;
  veoTeamSlug: string;
}

async function leagueVeoMapping(leagueId: number): Promise<LeagueVeo | null> {
  const rows = await db
    .select({
      id: leaguesTable.id,
      name: leaguesTable.name,
      veoClubSlug: leaguesTable.veoClubSlug,
      veoTeamSlug: leaguesTable.veoTeamSlug,
    })
    .from(leaguesTable)
    .where(eq(leaguesTable.id, leagueId))
    .limit(1);
  const r = rows[0];
  if (!r || !r.veoClubSlug || !r.veoTeamSlug) return null;
  return { id: r.id, name: r.name, veoClubSlug: r.veoClubSlug, veoTeamSlug: r.veoTeamSlug };
}

// Small concurrency helper so we don't fire 80 requests at once.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// One sync pass for a league: upsert recording metadata, fetch heavy payloads
// for up to `batch` unfetched matches, then backfill pass/possession analytics.
// Shared by the /entry/veo-sync route and the CLI runner (scripts/veo-sync-cli).
type VeoSyncError = { error: string; status: number };
type VeoSyncResult = {
  league: string;
  totalMatches: number;
  fetched: number;
  remaining: number;
  analyticsPending: number;
  done: boolean;
};

export async function syncVeoLeagueOnce(leagueId: number, batch = DEFAULT_BATCH): Promise<VeoSyncError | VeoSyncResult> {
  const mapping = await leagueVeoMapping(leagueId);
  if (!mapping) return { error: "This league has no Veo team mapping.", status: 400 };

  const creds: VeoCredentials | null = defaultVeoCreds();
  if (!creds) return { error: "Veo credentials are not configured on the server.", status: 503 };

  const nowIso = new Date().toISOString();

  let recordings;
  try {
    recordings = await listRecordings(creds, mapping.veoClubSlug, mapping.veoTeamSlug);
  } catch (e) {
    logger.error({ err: e, leagueId }, "veo: listRecordings failed");
    return { error: "Could not reach Veo. Try again shortly.", status: 502 };
  }

  // Upsert metadata for every recording (cheap; keeps the match list complete).
  for (const rec of recordings) {
    if (!rec.identifier) continue;
    await db
      .insert(veoMatchesTable)
      .values({
        leagueId,
        veoMatchId: rec.identifier,
        veoTeamSlug: mapping.veoTeamSlug,
        title: rec.title ?? null,
        opponent: opponentFromVeoTitle(rec.title),
        startsAt: rec.start ?? null,
        syncedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: [veoMatchesTable.leagueId, veoMatchesTable.veoMatchId],
        set: {
          title: rec.title ?? null,
          // Re-derive on every sync so renaming a recording in Veo fixes its
          // opponent here too (the coach renames to date-round-squad-club).
          opponent: opponentFromVeoTitle(rec.title),
          startsAt: rec.start ?? null,
          veoTeamSlug: mapping.veoTeamSlug,
        },
      });
  }

  // NO auto-prune: Veo drops old recordings from the portal over time, so a
  // recording vanishing from the list must NOT delete our synced copy — once
  // synced, the Hub is the archive. Misfiled games are removed manually via
  // /entry/veo-remove (soft delete; sync never resurrects removed rows because
  // the upsert doesn't touch removed_at).

  // Which synced matches still need their heavy payloads?
  const pending = await db
    .select({ veoMatchId: veoMatchesTable.veoMatchId })
    .from(veoMatchesTable)
    .where(and(eq(veoMatchesTable.leagueId, leagueId), sql`${veoMatchesTable.events} IS NULL`, sql`${veoMatchesTable.removedAt} IS NULL`));

  const toFetch = pending.slice(0, batch);
  let fetched = 0;
  let failed = 0;

  await mapPool(toFetch, 4, async ({ veoMatchId }) => {
    try {
      // Events are the core payload: if that request fails we persist NOTHING,
      // so the match stays events-IS-NULL and is retried on the next sync.
      // The side payloads may fail soft (older matches lack some of them).
      const [detail, events, stats, periods, roster, passDetails] = await Promise.all([
        getMatchDetail(creds, veoMatchId).catch(() => null),
        getEvents(creds, veoMatchId),
        getStats(creds, veoMatchId).catch(() => ({})),
        getPeriods(creds, veoMatchId).catch(() => [] as unknown[]),
        getRoster(creds, veoMatchId).catch(() => ({})),
        // Network hiccups return null (→ retried by the backfill pass below);
        // a definitive "no analytics for this match" is stored as available:false.
        getPassDetails(creds, veoMatchId).catch(() => null),
      ]);
      await db
        .update(veoMatchesTable)
        .set({
          opponent: normalizeVeoClub(detail?.opponent_team_name) ?? undefined,
          title: detail?.title ?? undefined,
          hasAnalytics: detail?.has_analytics_enabled ?? false,
          hasEvents: detail?.has_events_enabled ?? false,
          hasTracking: detail?.has_tracking_data ?? false,
          hasMomentum: detail?.has_momentum_data ?? false,
          events,
          stats,
          periods,
          roster,
          ...(passDetails ? { passDetails: passDetails as unknown as Record<string, unknown> } : {}),
          syncedAt: nowIso,
        })
        .where(and(eq(veoMatchesTable.leagueId, leagueId), eq(veoMatchesTable.veoMatchId, veoMatchId)));
      fetched++;
    } catch (e) {
      failed++;
      logger.warn({ err: e, veoMatchId }, "veo: match payload fetch failed; will retry next sync");
    }
  });

  // Backfill pass/possession analytics for matches synced before the RAS
  // service was discovered (pass_details never checked) AND matches whose RAS
  // pipeline was still running last time (available:false + pending:true) —
  // Veo's analytics finish hours after upload, so these must be re-checked on
  // every manual sync until they resolve either way.
  const passPending = await db
    .select({ veoMatchId: veoMatchesTable.veoMatchId })
    .from(veoMatchesTable)
    .where(
      and(
        eq(veoMatchesTable.leagueId, leagueId),
        sql`${veoMatchesTable.events} IS NOT NULL`,
        // COALESCE: rows written before the pending flag existed count as pending.
        // Third branch: rows synced before 5-min heat windows existed — refetch
        // so the time-scrubbing possession heat map works on old matches too.
        sql`(${veoMatchesTable.passDetails} IS NULL OR (${veoMatchesTable.passDetails}->>'available' = 'false' AND COALESCE(${veoMatchesTable.passDetails}->>'pending', 'true') = 'true') OR (${veoMatchesTable.passDetails}->>'available' = 'true' AND NOT jsonb_exists(${veoMatchesTable.passDetails}, 'heatWindows')))`,
        sql`${veoMatchesTable.removedAt} IS NULL`,
      ),
    );
  let passFetched = 0;
  await mapPool(passPending.slice(0, batch), 4, async ({ veoMatchId }) => {
    try {
      const pd = await getPassDetails(creds, veoMatchId);
      await db
        .update(veoMatchesTable)
        .set({ passDetails: pd as unknown as Record<string, unknown> })
        .where(and(eq(veoMatchesTable.leagueId, leagueId), eq(veoMatchesTable.veoMatchId, veoMatchId)));
      passFetched++;
    } catch (e) {
      logger.warn({ err: e, veoMatchId }, "veo: pass-details fetch failed; will retry next sync");
    }
  });

  // Count matches whose RAS analytics pipeline is still running after this
  // backfill pass (available:false + pending:true). These need a re-sync later.
  const stillPendingRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(veoMatchesTable)
    .where(
      and(
        eq(veoMatchesTable.leagueId, leagueId),
        sql`${veoMatchesTable.events} IS NOT NULL`,
        sql`(${veoMatchesTable.passDetails} IS NULL OR (${veoMatchesTable.passDetails}->>'available' = 'false' AND COALESCE(${veoMatchesTable.passDetails}->>'pending', 'true') = 'true'))`,
        sql`${veoMatchesTable.removedAt} IS NULL`,
      ),
    );
  const analyticsPending = Number(stillPendingRows[0]?.count ?? 0);

  // `remaining` and `done` track only the core events-payload queue (events IS
  // NULL). Analytics backfill (RAS pipeline) is decoupled: it may stay pending
  // across many syncs while Veo processes the recording server-side. The client
  // loops until `done`, then shows the `analyticsPending` advisory separately.
  const remaining = Math.max(0, pending.length - fetched);
  return {
    league: mapping.name,
    totalMatches: recordings.length,
    fetched,
    remaining,
    analyticsPending,
    // Only "done" when the core events queue is empty AND nothing failed this
    // pass — failed matches stay pending and should be retried, not dropped.
    done: remaining === 0 && failed === 0,
  };
}

// POST /entry/veo-sync  { leagueId, batch? }
// Rides the /entry prefix → data-entry module + leagueId access check.
router.post("/entry/veo-sync", async (req, res) => {
  const leagueId = Number(req.body?.leagueId);
  const batch = Number.isFinite(Number(req.body?.batch)) ? Number(req.body?.batch) : DEFAULT_BATCH;
  if (!Number.isFinite(leagueId)) return res.status(400).json({ error: "leagueId required" });
  try {
    const result = await syncVeoLeagueOnce(leagueId, batch);
    if ("error" in result) return res.status(result.status).json({ error: result.error });
    return res.json(result);
  } catch (e) {
    // Surface the real failure (Veo login, recordings list, network) to the
    // client instead of a generic 500 — the coach sees it in the sync status.
    logger.error({ err: e, leagueId }, "veo: sync failed");
    const msg = e instanceof Error ? e.message : "unknown error";
    return res.status(502).json({ error: msg });
  }
});

// GET /veo/leagues — which of the USER'S leagues have a Veo mapping.
router.get("/veo/leagues", async (req, res) => {
  const user = await getSessionUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  const rows = await db
    .select({
      id: leaguesTable.id,
      name: leaguesTable.name,
      veoTeamSlug: leaguesTable.veoTeamSlug,
    })
    .from(leaguesTable)
    .where(sql`${leaguesTable.veoTeamSlug} IS NOT NULL`);
  return res.json({ leagues: rows.filter((r) => canSeeLeague(user, r.id)) });
});

// GET /veo/matches?leagueId= — synced match list (metadata only, no events).
router.get("/veo/matches", async (req, res) => {
  const leagueId = Number(req.query.leagueId);
  if (!Number.isFinite(leagueId)) return res.status(400).json({ error: "leagueId required" });
  const rows = await db
    .select({
      id: veoMatchesTable.id,
      veoMatchId: veoMatchesTable.veoMatchId,
      title: veoMatchesTable.title,
      opponent: veoMatchesTable.opponent,
      startsAt: veoMatchesTable.startsAt,
      hasAnalytics: veoMatchesTable.hasAnalytics,
      hasEvents: veoMatchesTable.hasEvents,
      hasTracking: veoMatchesTable.hasTracking,
      hasMomentum: veoMatchesTable.hasMomentum,
      synced: sql<boolean>`${veoMatchesTable.events} IS NOT NULL`,
      syncedAt: veoMatchesTable.syncedAt,
      matchCode: matchesTable.matchId,
      hubOpponent: matchesTable.opponent,
      // True when events are present but the RAS pass-analytics pipeline hasn't
      // resolved yet — the coach should sync again later to pick up the data.
      pendingAnalytics: sql<boolean>`(${veoMatchesTable.events} IS NOT NULL AND (${veoMatchesTable.passDetails} IS NULL OR (${veoMatchesTable.passDetails}->>'available' = 'false' AND COALESCE(${veoMatchesTable.passDetails}->>'pending', 'true') = 'true')))`,
    })
    .from(veoMatchesTable)
    .leftJoin(matchesTable, eq(veoMatchesTable.matchId, matchesTable.id))
    .where(and(eq(veoMatchesTable.leagueId, leagueId), sql`${veoMatchesTable.removedAt} IS NULL`))
    .orderBy(sql`${veoMatchesTable.startsAt} DESC NULLS LAST`);
  return res.json({ matches: rows });
});

// GET /veo/season?leagueId= — per-match event counts (for/against by event
// type) across every synced match, oldest first. Aggregating server-side means
// the Season view is one request instead of one per match; the client applies
// its own momentum weights to these counts.
router.get("/veo/season", async (req, res) => {
  const leagueId = Number(req.query.leagueId);
  if (!Number.isFinite(leagueId)) return res.status(400).json({ error: "leagueId required" });
  const rows = await db
    .select({
      id: veoMatchesTable.id,
      veoMatchId: veoMatchesTable.veoMatchId,
      title: veoMatchesTable.title,
      opponent: veoMatchesTable.opponent,
      startsAt: veoMatchesTable.startsAt,
      events: veoMatchesTable.events,
      matchCode: matchesTable.matchId,
      hubOpponent: matchesTable.opponent,
    })
    .from(veoMatchesTable)
    .leftJoin(matchesTable, eq(veoMatchesTable.matchId, matchesTable.id))
    .where(and(eq(veoMatchesTable.leagueId, leagueId), sql`${veoMatchesTable.events} IS NOT NULL`, sql`${veoMatchesTable.removedAt} IS NULL`))
    .orderBy(sql`${veoMatchesTable.startsAt} ASC NULLS LAST`);
  const matches = rows.map((r) => {
    const countsFor: Record<string, number> = {};
    const countsAgainst: Record<string, number> = {};
    const events = Array.isArray(r.events) ? (r.events as { event_type?: string; team?: string }[]) : [];
    for (const e of events) {
      if (!e?.event_type) continue;
      const bucket = e.team === "Own" ? countsFor : countsAgainst;
      bucket[e.event_type] = (bucket[e.event_type] ?? 0) + 1;
    }
    return {
      id: r.id,
      veoMatchId: r.veoMatchId,
      title: r.title,
      opponent: r.opponent,
      startsAt: r.startsAt,
      matchCode: r.matchCode ?? null,
      hubOpponent: r.hubOpponent ?? null,
      countsFor,
      countsAgainst,
    };
  });
  return res.json({ matches });
});

// GET /veo/season-shots?leagueId= — every shot/goal event across the season's
// synced matches, with match minute (period-duration-aware) and pitch coords
// normalised per period's own_side so we always attack right, them left.
router.get("/veo/season-shots", async (req, res) => {
  const leagueId = Number(req.query.leagueId);
  if (!Number.isFinite(leagueId)) return res.status(400).json({ error: "leagueId required" });
  const rows = await db
    .select({
      id: veoMatchesTable.id,
      veoMatchId: veoMatchesTable.veoMatchId,
      title: veoMatchesTable.title,
      opponent: veoMatchesTable.opponent,
      startsAt: veoMatchesTable.startsAt,
      events: veoMatchesTable.events,
      periods: veoMatchesTable.periods,
      matchCode: matchesTable.matchId,
      hubOpponent: matchesTable.opponent,
    })
    .from(veoMatchesTable)
    .leftJoin(matchesTable, eq(veoMatchesTable.matchId, matchesTable.id))
    .where(and(eq(veoMatchesTable.leagueId, leagueId), sql`${veoMatchesTable.events} IS NOT NULL`, sql`${veoMatchesTable.removedAt} IS NULL`))
    .orderBy(sql`${veoMatchesTable.startsAt} ASC NULLS LAST`);
  const matches = rows.map((r) => {
    const events = Array.isArray(r.events)
      ? (r.events as {
          event_type?: string;
          team?: string;
          period_id?: number;
          period_time_ms?: number;
          x?: number | null;
          z?: number | null;
        }[])
      : [];
    const periods = Array.isArray(r.periods)
      ? (r.periods as { duration?: number; own_side?: string }[])
      : [];
    // Cumulative period offsets in minutes (real durations, 45-min fallback).
    const offsets: number[] = [0];
    for (const p of periods) {
      const durMin = Number(p?.duration) > 0 ? Number(p.duration) / 60 : 45;
      offsets.push(offsets[offsets.length - 1] + durMin);
    }
    const shots: { x: number | null; y: number | null; minute: number; goal: boolean; us: boolean }[] = [];
    for (const e of events) {
      if (e?.event_type !== "FootballShot" && e?.event_type !== "FootballGoal") continue;
      const pid = Number(e.period_id) || 1;
      const off = offsets[pid - 1] ?? (pid - 1) * 45;
      const minute = off + (Number(e.period_time_ms) || 0) / 60000;
      // own_side = the end our GOAL is at; rotate the whole pitch 180° for
      // periods where our goal is on the right so we always attack right.
      // (Season-scale data confirms this orientation: our shots cluster at
      // the goal we attack, so flipping on "right" puts them on the right.)
      const flip = (periods[pid - 1]?.own_side ?? "right") !== "left";
      const hasXY = e.x != null && e.z != null;
      shots.push({
        x: hasXY ? (flip ? 1 - Number(e.x) : Number(e.x)) : null,
        y: hasXY ? (flip ? 1 - Number(e.z) : Number(e.z)) : null,
        minute,
        goal: e.event_type === "FootballGoal",
        us: e.team === "Own",
      });
    }
    return {
      id: r.id,
      veoMatchId: r.veoMatchId,
      title: r.title,
      opponent: r.opponent,
      startsAt: r.startsAt,
      matchCode: r.matchCode ?? null,
      hubOpponent: r.hubOpponent ?? null,
      shots,
    };
  });
  return res.json({ matches });
});

// ── Passing & possession (RAS analytics) ────────────────────────────────────
// L/R in the RAS payload are PITCH SIDES; each period's own_side tells which
// side is ours ("L" when own_side === "left"). This mirrors Veo's own client
// code — do not "fix" it to team keys.
interface ThirdCounts {
  defensive: number;
  middle: number;
  attacking: number;
}

function emptyThirds(): ThirdCounts {
  return { defensive: 0, middle: 0, attacking: 0 };
}

export function summarisePassDetails(passDetails: unknown, periods: unknown) {
  const pd = passDetails as VeoPassDetails | null | undefined;
  if (!pd || pd.available !== true || !Array.isArray(pd.items)) return null;
  const periodRows = Array.isArray(periods)
    ? (periods as { timeframe?: [number, number]; own_side?: string }[])
    : [];
  const sideFor = (item: VeoPassDetailPeriod): { own: "L" | "R"; opp: "L" | "R" } | null => {
    const p = periodRows.find((r) => r.timeframe?.[0] === item.start && r.timeframe?.[1] === item.end);
    if (!p?.own_side) return null;
    return p.own_side === "left" ? { own: "L", opp: "R" } : { own: "R", opp: "L" };
  };

  let possessionSecUs = 0, possessionSecThem = 0;
  let passesUs = 0, passesThem = 0;
  let possessionWonUs = 0, possessionWonThem = 0;
  const stringsUs = new Map<number, number>();
  const stringsThem = new Map<number, number>();
  const thirdsUs = emptyThirds();
  const thirdsThem = emptyThirds();
  // Pass LENGTHS: the RAS passLocations x/y are pass vectors (not pitch
  // positions — see the heat-map notes), so each point's distance from
  // (0.5, 0.5) is that pass's length in Veo's normalised units. Useful as a
  // relative style read (long-ball vs short-passing sides), not as metres.
  const lensUs: number[] = [];
  const lensThem: number[] = [];
  let any = false;

  for (const item of pd.items) {
    const side = sideFor(item);
    if (!side) continue;
    any = true;
    const s = item.stats ?? {};
    possessionSecUs += Number(s.PossessionSeconds?.[side.own] ?? 0);
    possessionSecThem += Number(s.PossessionSeconds?.[side.opp] ?? 0);
    passesUs += Number(s.PassesCompleted?.[side.own] ?? 0);
    passesThem += Number(s.PassesCompleted?.[side.opp] ?? 0);
    possessionWonUs += Number(s.PossessionWon?.[side.own] ?? 0);
    possessionWonThem += Number(s.PossessionWon?.[side.opp] ?? 0);
    for (const [team, map] of [[side.own, stringsUs], [side.opp, stringsThem]] as const) {
      for (const entry of item.passStrings?.[team] ?? []) {
        const len = Number(entry?.[0]);
        const count = Number(entry?.[1]);
        if (Number.isFinite(len) && Number.isFinite(count)) map.set(len, (map.get(len) ?? 0) + count);
      }
    }
    for (const [team, tgt] of [[side.own, thirdsUs], [side.opp, thirdsThem]] as const) {
      const loc = item.possessionLocations?.[team];
      if (!loc) continue;
      tgt.defensive += Number(loc.defensive ?? 0);
      tgt.middle += Number(loc.middle ?? 0);
      tgt.attacking += Number(loc.attacking ?? 0);
    }
    for (const [team, arr] of [[side.own, lensUs], [side.opp, lensThem]] as const) {
      for (const pt of item.passLocations?.[team] ?? []) {
        const dx = Number(pt?.x), dy = Number(pt?.y);
        if (Number.isFinite(dx) && Number.isFinite(dy)) arr.push(Math.hypot(dx - 0.5, dy - 0.5));
      }
    }
  }
  if (!any) return null;

  const toSorted = (m: Map<number, number>) =>
    Array.from(m.entries()).sort((a, b) => a[0] - b[0]).map(([len, count]) => ({ len, count }));

  return {
    possessionSecUs, possessionSecThem,
    passesUs, passesThem,
    possessionWonUs, possessionWonThem,
    passStringsUs: toSorted(stringsUs),
    passStringsThem: toSorted(stringsThem),
    thirdsUs, thirdsThem,
    passLenUs: lenStats(lensUs),
    passLenThem: lenStats(lensThem),
  };
}

// Long pass = vector length > 0.25 in Veo's normalised units (league p75-ish).
const LONG_PASS_LEN = 0.25;
function lenStats(arr: number[]) {
  if (arr.length === 0) return null;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const long = arr.filter((v) => v > LONG_PASS_LEN).length;
  return {
    n: arr.length,
    mean: Number(mean.toFixed(4)),
    longPct: Number(((long / arr.length) * 100).toFixed(1)),
  };
}

// GET /veo/season-passing?leagueId= — per-match possession/passing summaries
// (oldest first) for every synced match whose RAS analytics are available.
router.get("/veo/season-passing", async (req, res) => {
  const leagueId = Number(req.query.leagueId);
  if (!Number.isFinite(leagueId)) return res.status(400).json({ error: "leagueId required" });
  const rows = await db
    .select({
      id: veoMatchesTable.id,
      veoMatchId: veoMatchesTable.veoMatchId,
      title: veoMatchesTable.title,
      opponent: veoMatchesTable.opponent,
      startsAt: veoMatchesTable.startsAt,
      periods: veoMatchesTable.periods,
      passDetails: veoMatchesTable.passDetails,
      matchCode: matchesTable.matchId,
      hubOpponent: matchesTable.opponent,
    })
    .from(veoMatchesTable)
    .leftJoin(matchesTable, eq(veoMatchesTable.matchId, matchesTable.id))
    .where(and(eq(veoMatchesTable.leagueId, leagueId), sql`${veoMatchesTable.passDetails} IS NOT NULL`, sql`${veoMatchesTable.removedAt} IS NULL`))
    .orderBy(sql`${veoMatchesTable.startsAt} ASC NULLS LAST`);
  const matches = rows.flatMap((r) => {
    const summary = summarisePassDetails(r.passDetails, r.periods);
    if (!summary) return [];
    return [{
      id: r.id,
      veoMatchId: r.veoMatchId,
      title: r.title,
      opponent: r.opponent,
      startsAt: r.startsAt,
      matchCode: r.matchCode,
      ...summary,
    }];
  });
  return res.json({ matches });
});

// GET /veo/match?id=&leagueId= — one match with its raw events/stats/periods.
router.get("/veo/match", async (req, res) => {
  const leagueId = Number(req.query.leagueId);
  const id = Number(req.query.id);
  if (!Number.isFinite(leagueId) || !Number.isFinite(id))
    return res.status(400).json({ error: "leagueId and id required" });
  const rows = await db
    .select()
    .from(veoMatchesTable)
    .where(and(eq(veoMatchesTable.id, id), eq(veoMatchesTable.leagueId, leagueId), sql`${veoMatchesTable.removedAt} IS NULL`))
    .limit(1);
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  return res.json(rows[0]);
});

// ── Veo ↔ Hub match linking ─────────────────────────────────────────────────
// veo_matches.match_id points at our own matches.id once reconciled. Auto-link
// pairs by kickoff date (±1 day) + opponent name; messy Veo titles get fixed
// via the manual link endpoint. The report-stats endpoint then serves shots +
// momentum for a Hub match so the Match Report can show video stats.

// All Hub matches belonging to a league (via its seasons), newest first.
async function hubMatchesForLeague(leagueId: number) {
  const seasonRows = await db
    .select({ id: seasonsTable.id })
    .from(seasonsTable)
    .where(eq(seasonsTable.leagueId, leagueId));
  const seasonIds = seasonRows.map((s) => s.id);
  if (seasonIds.length === 0) return [];
  return db
    .select({
      id: matchesTable.id,
      matchId: matchesTable.matchId,
      matchDate: matchesTable.matchDate,
      opponent: matchesTable.opponent,
      teamId: matchesTable.teamId,
      seasonId: matchesTable.seasonId,
    })
    .from(matchesTable)
    .where(inArray(matchesTable.seasonId, seasonIds))
    .orderBy(sql`${matchesTable.matchDate} DESC NULLS LAST`);
}

// "2026/07/26" | "2026-07-26" → ms at local noon (AEST) so timezone wobble on
// either side can't shift the calendar day.
function hubDateMs(matchDate: string | null): number | null {
  if (!matchDate) return null;
  const m = matchDate.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T12:00:00+10:00`);
  return Number.isFinite(t) ? t : null;
}

const DAY_MS = 86_400_000;

function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

// Loose opponent-name match: exact after normalisation, or one contains the
// other (min 4 chars so "fc"/"utd" fragments don't false-positive).
function opponentsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.includes(na)) return true;
  if (nb.length >= 4 && na.includes(nb)) return true;
  return false;
}

// GET /veo/links?leagueId= — link state per Veo match + Hub matches to pick from.
router.get("/veo/links", async (req, res) => {
  const leagueId = Number(req.query.leagueId);
  if (!Number.isFinite(leagueId)) return res.status(400).json({ error: "leagueId required" });
  const [rows, hubMatches] = await Promise.all([
    db
      .select({
        id: veoMatchesTable.id,
        veoMatchId: veoMatchesTable.veoMatchId,
        title: veoMatchesTable.title,
        opponent: veoMatchesTable.opponent,
        startsAt: veoMatchesTable.startsAt,
        matchId: veoMatchesTable.matchId,
        synced: sql<boolean>`${veoMatchesTable.events} IS NOT NULL`,
        // Manage list shows removed games too, so they can be restored.
        removed: sql<boolean>`${veoMatchesTable.removedAt} IS NOT NULL`,
        // True when events are present but RAS pass analytics are still processing.
        pendingAnalytics: sql<boolean>`(${veoMatchesTable.events} IS NOT NULL AND (${veoMatchesTable.passDetails} IS NULL OR (${veoMatchesTable.passDetails}->>'available' = 'false' AND COALESCE(${veoMatchesTable.passDetails}->>'pending', 'true') = 'true')))`,
        // Events JSON so we can count Veo goals for the mismatch check.
        events: veoMatchesTable.events,
        // Hub result (null when not linked or result not entered).
        hubGoalsScored: matchesTable.goalsScored,
        hubGoalsConceded: matchesTable.goalsConceded,
      })
      .from(veoMatchesTable)
      .leftJoin(matchesTable, eq(veoMatchesTable.matchId, matchesTable.id))
      .where(eq(veoMatchesTable.leagueId, leagueId))
      .orderBy(sql`${veoMatchesTable.startsAt} DESC NULLS LAST`),
    hubMatchesForLeague(leagueId),
  ]);

  // Compute score-mismatch for linked, synced rows only.
  const links = rows.map((r) => {
    let scoreMismatch: { veoFor: number; veoAgainst: number; hubFor: number; hubAgainst: number } | null = null;
    const hubFor = r.hubGoalsScored;
    const hubAgainst = r.hubGoalsConceded;
    if (r.matchId != null && hubFor != null && hubAgainst != null && Array.isArray(r.events)) {
      const events = r.events as { event_type?: string; team?: string }[];
      let veoFor = 0;
      let veoAgainst = 0;
      for (const e of events) {
        if (e?.event_type !== "FootballGoal") continue;
        // team === "Own" means a goal credited to our team in Veo.
        if (e.team === "Own") veoFor++; else veoAgainst++;
      }
      if (veoFor !== hubFor || veoAgainst !== hubAgainst) {
        scoreMismatch = { veoFor, veoAgainst, hubFor, hubAgainst };
      }
    }
    // Strip heavy events payload before sending to client.
    const { events: _events, hubGoalsScored: _hs, hubGoalsConceded: _hc, ...rest } = r;
    return { ...rest, scoreMismatch };
  });

  return res.json({ links, hubMatches });
});

// Auto-link pass for a league: fill match_id where it's confidently derivable;
// never overwrites an existing link (manual fixes stay put). Shared by the
// /entry/veo-auto-link route and the CLI runner.
export async function autoLinkVeoLeague(leagueId: number) {
  const [veoRows, hubMatches] = await Promise.all([
    db
      .select({
        id: veoMatchesTable.id,
        opponent: veoMatchesTable.opponent,
        title: veoMatchesTable.title,
        startsAt: veoMatchesTable.startsAt,
        matchId: veoMatchesTable.matchId,
      })
      .from(veoMatchesTable)
      .where(and(eq(veoMatchesTable.leagueId, leagueId), sql`${veoMatchesTable.removedAt} IS NULL`)),
    hubMatchesForLeague(leagueId),
  ]);

  // Hub matches already claimed by a Veo recording can't be auto-claimed again.
  const taken = new Set(veoRows.map((v) => v.matchId).filter((x): x is number => x != null));

  let linked = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const v of veoRows) {
    if (v.matchId != null) continue; // already linked — leave alone
    const kickoff = v.startsAt ? Date.parse(v.startsAt) : NaN;
    if (!Number.isFinite(kickoff)) {
      unmatched++;
      continue;
    }
    const candidates = hubMatches.filter((h) => {
      if (taken.has(h.id)) return false;
      const hm = hubDateMs(h.matchDate);
      return hm != null && Math.abs(hm - kickoff) <= 1.5 * DAY_MS; // ±1 day + kickoff-time slack
    });
    let pick: (typeof candidates)[number] | null = null;
    if (candidates.length === 1) {
      pick = candidates[0];
    } else if (candidates.length > 1) {
      // Same weekend, multiple squads: only link when the opponent name settles it.
      const byOpp = candidates.filter(
        (h) => opponentsMatch(v.opponent, h.opponent) || opponentsMatch(v.title, h.opponent),
      );
      if (byOpp.length === 1) pick = byOpp[0];
      else {
        ambiguous++;
        continue;
      }
    } else {
      unmatched++;
      continue;
    }
    await db.update(veoMatchesTable).set({ matchId: pick.id }).where(eq(veoMatchesTable.id, v.id));
    taken.add(pick.id);
    linked++;
  }

  logger.info({ leagueId, linked, ambiguous, unmatched }, "veo: auto-link pass");
  return { linked, ambiguous, unmatched };
}

// POST /entry/veo-auto-link { leagueId }
router.post("/entry/veo-auto-link", async (req, res) => {
  const leagueId = Number(req.body?.leagueId);
  if (!Number.isFinite(leagueId)) return res.status(400).json({ error: "leagueId required" });
  return res.json(await autoLinkVeoLeague(leagueId));
});

// POST /entry/veo-link { leagueId, veoId, matchId|null } — manual set/clear.
router.post("/entry/veo-link", async (req, res) => {
  const leagueId = Number(req.body?.leagueId);
  const veoId = Number(req.body?.veoId);
  const rawMatchId = req.body?.matchId;
  const matchId = rawMatchId == null ? null : Number(rawMatchId);
  if (!Number.isFinite(leagueId) || !Number.isFinite(veoId))
    return res.status(400).json({ error: "leagueId and veoId required" });
  if (matchId != null && !Number.isFinite(matchId))
    return res.status(400).json({ error: "matchId must be a number or null" });

  const veoRow = await db
    .select({ id: veoMatchesTable.id })
    .from(veoMatchesTable)
    .where(and(eq(veoMatchesTable.id, veoId), eq(veoMatchesTable.leagueId, leagueId)))
    .limit(1);
  if (veoRow.length === 0) return res.status(404).json({ error: "Veo match not found in this league" });

  if (matchId != null) {
    // The Hub match must belong to one of this league's seasons.
    const ok = await db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .innerJoin(seasonsTable, eq(matchesTable.seasonId, seasonsTable.id))
      .where(and(eq(matchesTable.id, matchId), eq(seasonsTable.leagueId, leagueId)))
      .limit(1);
    if (ok.length === 0) return res.status(400).json({ error: "That match doesn't belong to this league" });
    // One Veo recording per Hub match: steal the link if another row held it.
    await db
      .update(veoMatchesTable)
      .set({ matchId: null })
      .where(and(eq(veoMatchesTable.leagueId, leagueId), eq(veoMatchesTable.matchId, matchId)));
  }

  await db.update(veoMatchesTable).set({ matchId }).where(eq(veoMatchesTable.id, veoId));
  return res.json({ ok: true });
});

// POST /entry/veo-refetch { leagueId, veoId } — clears the heavy payloads for one
// already-synced game and immediately re-downloads them from Veo. Useful when
// the coach fixes something on the Veo side after the initial sync (e.g. wrong
// team directions). The row's matchId link and removedAt are preserved.
router.post("/entry/veo-refetch", async (req, res) => {
  const leagueId = Number(req.body?.leagueId);
  const veoId = Number(req.body?.veoId);
  if (!Number.isFinite(leagueId) || !Number.isFinite(veoId))
    return res.status(400).json({ error: "leagueId and veoId required" });

  // Verify the row exists in this league and grab its veoMatchId.
  const existing = await db
    .select({ veoMatchId: veoMatchesTable.veoMatchId })
    .from(veoMatchesTable)
    .where(and(eq(veoMatchesTable.id, veoId), eq(veoMatchesTable.leagueId, leagueId)))
    .limit(1);
  if (existing.length === 0) return res.status(404).json({ error: "Veo match not found in this league" });
  const { veoMatchId } = existing[0];

  const mapping = await leagueVeoMapping(leagueId);
  if (!mapping) return res.status(400).json({ error: "This league has no Veo team mapping." });

  const creds: VeoCredentials | null = defaultVeoCreds();
  if (!creds) return res.status(503).json({ error: "Veo credentials are not configured on the server." });

  // Clear the payload columns so this row looks unfetched.
  await db
    .update(veoMatchesTable)
    .set({ events: null, stats: null, periods: null, roster: null, passDetails: null })
    .where(and(eq(veoMatchesTable.id, veoId), eq(veoMatchesTable.leagueId, leagueId)));

  // Re-fetch the heavy payload for just this match (mirrors the sync loop).
  const nowIso = new Date().toISOString();
  try {
    const [detail, events, stats, periods, roster, passDetails] = await Promise.all([
      getMatchDetail(creds, veoMatchId).catch(() => null),
      getEvents(creds, veoMatchId),
      getStats(creds, veoMatchId).catch(() => ({})),
      getPeriods(creds, veoMatchId).catch(() => [] as unknown[]),
      getRoster(creds, veoMatchId).catch(() => ({})),
      getPassDetails(creds, veoMatchId).catch(() => null),
    ]);
    await db
      .update(veoMatchesTable)
      .set({
        opponent: normalizeVeoClub(detail?.opponent_team_name) ?? undefined,
        title: detail?.title ?? undefined,
        hasAnalytics: detail?.has_analytics_enabled ?? false,
        hasEvents: detail?.has_events_enabled ?? false,
        hasTracking: detail?.has_tracking_data ?? false,
        hasMomentum: detail?.has_momentum_data ?? false,
        events,
        stats,
        periods,
        roster,
        ...(passDetails ? { passDetails: passDetails as unknown as Record<string, unknown> } : {}),
        syncedAt: nowIso,
      })
      .where(and(eq(veoMatchesTable.id, veoId), eq(veoMatchesTable.leagueId, leagueId)));
    return res.json({ ok: true });
  } catch (e) {
    logger.error({ err: e, veoMatchId }, "veo: refetch payload failed");
    return res.status(502).json({ error: "Could not re-fetch from Veo. The stats have been cleared — press Sync to retry." });
  }
});

// POST /entry/veo-remove { leagueId, veoId, removed } — soft-delete / restore a
// synced game. Removed games keep their payloads (the Hub is the archive once
// Veo drops old recordings) but vanish from every chart, list and report until
// restored. Rides the /entry prefix → data-entry module + league access check.
router.post("/entry/veo-remove", async (req, res) => {
  const leagueId = Number(req.body?.leagueId);
  const veoId = Number(req.body?.veoId);
  const removed = req.body?.removed;
  if (!Number.isFinite(leagueId) || !Number.isFinite(veoId))
    return res.status(400).json({ error: "leagueId and veoId required" });
  if (typeof removed !== "boolean") return res.status(400).json({ error: "removed must be true or false" });

  const updated = await db
    .update(veoMatchesTable)
    .set({ removedAt: removed ? new Date().toISOString() : null })
    .where(and(eq(veoMatchesTable.id, veoId), eq(veoMatchesTable.leagueId, leagueId)))
    .returning({ id: veoMatchesTable.id });
  if (updated.length === 0) return res.status(404).json({ error: "Veo match not found in this league" });
  return res.json({ ok: true });
});

// ── Report stats (shots + momentum) for a linked Hub match ──────────────────
// Mirrors the client-side maths on the Veo Insights tab (see VeoInsights.tsx):
// same event weights, same 5-minute bins, same shot definition.
const MOMENTUM_WEIGHT: Record<string, number> = {
  FootballGoal: 6,
  FootballPenaltyKick: 5,
  FootballShot: 3,
  FootballCornerKick: 2,
  FootballFreeKick: 1,
  FootballThrowIn: 0.3,
};
const BIN_MIN = 5;

interface VeoEventLite {
  event_type?: string;
  team?: string;
  period_id?: number;
  period_time_ms?: number;
}

// ── Match intelligence for the Football Match Report ────────────────────────
// SIEM-style layering, in coach language: correlated key findings on top,
// a unified moment timeline underneath, and a field-tilt line for drill-down.
// All sentences follow the Goal Analysis house style: hedged, plain, and
// concerns ("watch") always compete with positives for the top slots.
interface Finding { kind: string; tone: "good" | "watch" | "info"; weight: number; text: string }

function computeMatchIntel(
  events: unknown[],
  periods: unknown,
  passDetails: unknown,
  opp: string,
) {
  const evts = (Array.isArray(events) ? events : []) as (VeoEventLite & { x?: number; z?: number })[];
  const isOwn = (e: VeoEventLite) => e.team === "Own";
  const periodRows = Array.isArray(periods)
    ? (periods as { timeframe?: [number, number]; own_side?: string; duration?: number }[]) : [];
  const durMin = periodRows.map((p) => (Number(p?.duration) > 0 ? Number(p.duration) / 60 : 45));
  const offsets: number[] = [0];
  for (let i = 0; i < durMin.length; i++) offsets.push(offsets[i] + durMin[i]);
  const minuteOf = (e: VeoEventLite) => {
    const pid = Number(e.period_id) || 1;
    const off = offsets[pid - 1] ?? (pid - 1) * 45;
    return off + (Number(e.period_time_ms) || 0) / 60000;
  };
  const halfAt = durMin.length > 0 ? durMin[0] : 45;
  const playedMin = durMin.reduce((a, b) => a + b, 0);

  // Unified moment timeline (goals, shots, corners) on the match clock.
  const timeline = evts
    .filter((e) => e.event_type === "FootballGoal" || e.event_type === "FootballShot" || e.event_type === "FootballCornerKick")
    .map((e) => ({
      min: Number(minuteOf(e).toFixed(2)),
      type: e.event_type === "FootballGoal" ? "goal" as const : e.event_type === "FootballShot" ? "shot" as const : "corner" as const,
      us: isOwn(e),
    }))
    .sort((a, b) => a.min - b.min);

  // Weighted threat events for tilt/shares.
  const wEvts = evts
    .map((e) => ({ min: minuteOf(e), w: MOMENTUM_WEIGHT[e.event_type ?? ""] ?? 0, own: isOwn(e) }))
    .filter((e) => e.w > 0);
  const maxEventMin = wEvts.length ? Math.max(...wEvts.map((e) => e.min)) : 0;
  const maxMin = periodRows.length > 0 ? Math.max(playedMin, maxEventMin) : Math.max(90, maxEventMin);

  // Per-half territory from RAS possession-by-thirds when available.
  const halfTilt: { from: number; to: number; tilt: number }[] = [];
  let possSecUs = 0, possSecThem = 0;
  const pd = passDetails as { available?: boolean; items?: Array<{
    start: number; end: number;
    possessionLocations?: Record<string, { defensive?: number; middle?: number; attacking?: number }>;
  }> } | null | undefined;
  if (pd?.available === true && Array.isArray(pd.items)) {
    for (const item of pd.items) {
      const idx = periodRows.findIndex((p) => p.timeframe?.[0] === item.start && p.timeframe?.[1] === item.end);
      if (idx < 0) continue;
      const ownSide = periodRows[idx]?.own_side ?? "right";
      const ownLR = ownSide === "left" ? "L" : "R";
      const oppLR = ownSide === "left" ? "R" : "L";
      const sum = (t?: { defensive?: number; middle?: number; attacking?: number }) =>
        (Number(t?.defensive) || 0) + (Number(t?.middle) || 0) + (Number(t?.attacking) || 0);
      possSecUs += sum(item.possessionLocations?.[ownLR]);
      possSecThem += sum(item.possessionLocations?.[oppLR]);
      const usFin = Number(item.possessionLocations?.[ownLR]?.attacking) || 0;
      const themFin = Number(item.possessionLocations?.[oppLR]?.attacking) || 0;
      if (usFin + themFin === 0) continue;
      const from = durMin.slice(0, idx).reduce((a, b) => a + b, 0);
      halfTilt.push({ from, to: from + durMin[idx], tilt: (usFin / (usFin + themFin)) * 100 });
    }
  }
  // NOTE: possessionLocations values are NOT reliable seconds (raw sums come
  // out several times longer than the match) — only the RATIO is trustworthy.
  // Express the split as minutes of actual played time for readability.
  const possession = possSecUs + possSecThem > 0
    ? (() => {
        const shareUs = possSecUs / (possSecUs + possSecThem);
        const base = playedMin > 0 ? playedMin : 90;
        return {
          usPct: Number((shareUs * 100).toFixed(1)),
          usMin: Number((base * shareUs).toFixed(1)),
          themMin: Number((base * (1 - shareUs)).toFixed(1)),
        };
      })()
    : null;

  // Rolling field-tilt line (15-min window centred every 5 minutes, tilt−50).
  const HALF_WINDOW = 7.5;
  const tilt: { min: number; tiltDiff: number | null; passDiff: number | null }[] = [];
  if (wEvts.length > 0) {
    for (let t = 0; t <= Math.ceil(maxMin / 5) * 5; t += 5) {
      let us = 0, them = 0;
      for (const e of wEvts) {
        if (e.min < t - HALF_WINDOW || e.min >= t + HALF_WINDOW) continue;
        if (e.own) us += e.w; else them += e.w;
      }
      const tot = us + them;
      const seg = halfTilt.find((h, i) => t >= h.from && (i === halfTilt.length - 1 ? t <= h.to : t < h.to));
      tilt.push({
        min: t,
        tiltDiff: tot > 0 ? Number(((us / tot) * 100 - 50).toFixed(1)) : null,
        passDiff: seg ? Number((seg.tilt - 50).toFixed(1)) : null,
      });
    }
  }

  // Shares for findings.
  const share = (from: number, to: number) => {
    let us = 0, them = 0;
    for (const e of wEvts) if (e.min >= from && e.min < to) (e.own ? us += e.w : them += e.w);
    const tot = us + them;
    return tot > 0 ? (us / tot) * 100 : null;
  };
  const count = (type: string, own: boolean) =>
    evts.filter((e) => e.event_type === type && isOwn(e) === own).length;
  const shotsUs = count("FootballShot", true) + count("FootballGoal", true);
  const shotsThem = count("FootballShot", false) + count("FootballGoal", false);
  const cornersUs = count("FootballCornerKick", true);
  const cornersThem = count("FootballCornerKick", false);
  const goalsList = evts
    .filter((e) => e.event_type === "FootballGoal")
    .map((e) => ({ min: minuteOf(e), us: isOwn(e) }))
    .sort((a, b) => a.min - b.min);

  // Radar shares (drill-down spokes).
  const radar: { metric: string; us: number; them: number; rawUs: string; rawThem: string }[] = [];
  const addRadar = (metric: string, u: number, t: number, fmtU: string, fmtT: string) => {
    if (u + t <= 0) return;
    radar.push({
      metric,
      us: Number(((u / (u + t)) * 100).toFixed(1)),
      them: Number(((t / (u + t)) * 100).toFixed(1)),
      rawUs: fmtU, rawThem: fmtT,
    });
  };
  addRadar("Shots", shotsUs, shotsThem, String(shotsUs), String(shotsThem));
  addRadar("Corners", cornersUs, cornersThem, String(cornersUs), String(cornersThem));
  let wUs = 0, wThem = 0;
  for (const e of wEvts) (e.own ? wUs += e.w : wThem += e.w);
  addRadar("Field tilt", wUs, wThem,
    `${wUs + wThem > 0 ? Math.round((wUs / (wUs + wThem)) * 100) : 50}%`,
    `${wUs + wThem > 0 ? Math.round((wThem / (wUs + wThem)) * 100) : 50}%`);
  if (possession) addRadar("Possession", possSecUs, possSecThem, `${possession.usMin.toFixed(1)} min`, `${possession.themMin.toFixed(1)} min`);

  // ── Key findings: weighted candidate pool, concerns always in the mix ─────
  const findings: Finding[] = [];
  const pct = (n: number) => `${Math.round(n)}%`;

  // Shot dominance / deficit.
  if (shotsUs + shotsThem >= 8) {
    const s = (shotsUs / (shotsUs + shotsThem)) * 100;
    if (s >= 65) findings.push({ kind: "shots", tone: "good", weight: 3, text: `We had ${shotsUs} of the ${shotsUs + shotsThem} shots (${pct(s)}) — the video suggests we controlled the chance creation.` });
    else if (s <= 35) findings.push({ kind: "shots", tone: "watch", weight: 4, text: `${opp} out-shot us ${shotsThem}–${shotsUs} — worth checking on the video how their chances kept building.` });
  }

  // Goals with / against the run of play (15 min before the goal).
  for (const g of goalsList) {
    const before = share(Math.max(0, g.min - 15), g.min);
    if (before == null) continue;
    const m = Math.floor(g.min);
    if (!g.us && before >= 62) {
      findings.push({ kind: `run-${m}`, tone: "watch", weight: 5, text: `Their goal around ${m}' came against the run of play — we'd created most of the threat in the quarter-hour before it. Worth a look at what changed in that moment.` });
    } else if (g.us && before <= 38) {
      findings.push({ kind: `run-${m}`, tone: "info", weight: 3, text: `Our goal around ${m}' came somewhat against the run of play — a reminder the scoreline and the performance can tell different stories.` });
    }
  }

  // Half-to-half swing.
  const h1 = share(0, halfAt), h2 = share(halfAt, maxMin + 0.001);
  if (h1 != null && h2 != null) {
    const diff = h2 - h1;
    if (diff <= -20) findings.push({ kind: "halves", tone: "watch", weight: 4, text: `Our share of the threat dropped from ${pct(h1)} before the break to ${pct(h2)} after — the second half is worth a review.` });
    else if (diff >= 20) findings.push({ kind: "halves", tone: "good", weight: 3, text: `Our share of the threat rose from ${pct(h1)} to ${pct(h2)} after the break — whatever changed at half-time looks to have worked.` });
  }

  // Start and finish of the game.
  const first15 = share(0, 15);
  if (first15 != null) {
    if (first15 >= 70) findings.push({ kind: "start", tone: "good", weight: 2, text: `Fast start — roughly ${pct(first15)} of the early threat was ours in the first 15 minutes.` });
    else if (first15 <= 30) findings.push({ kind: "start", tone: "watch", weight: 3, text: `Slow start — ${opp} had most of the threat in the first 15 minutes; worth checking how we settled.` });
  }
  const lastFrom = Math.max(0, maxMin - 15);
  const last15 = share(lastFrom, maxMin + 0.001);
  if (last15 != null) {
    if (last15 >= 70) findings.push({ kind: "finish", tone: "good", weight: 2, text: `We finished on top — most of the late threat (${pct(last15)}) was ours in the closing 15 minutes.` });
    else if (last15 <= 30) findings.push({ kind: "finish", tone: "watch", weight: 3, text: `${opp} finished the stronger — most of the late threat was theirs; game management in the closing stages is worth a look.` });
  }

  // Shot bursts (3+ shots by one side inside 10 minutes) that didn't pay.
  const burst = (own: boolean) => {
    const mins = timeline.filter((t) => t.type !== "corner" && t.us === own).map((t) => t.min);
    for (let i = 0; i + 2 < mins.length; i++) {
      const a = mins[i], b = mins[i + 2];
      if (b - a <= 10) {
        const goalIn = goalsList.some((g) => g.us === own && g.min >= a && g.min <= b + 2);
        if (!goalIn) return { from: Math.floor(a), to: Math.ceil(b), n: mins.filter((m) => m >= a && m <= b).length };
      }
    }
    return null;
  };
  const ourBurst = burst(true);
  if (ourBurst) findings.push({ kind: "burst-us", tone: "info", weight: 2, text: `${ourBurst.n} shots between ${ourBurst.from}'–${ourBurst.to}' without a goal — a spell of real pressure that didn't pay; the final pass and set-piece detail from that period may be worth a look.` });
  const theirBurst = burst(false);
  if (theirBurst) findings.push({ kind: "burst-them", tone: "watch", weight: 4, text: `${opp} had ${theirBurst.n} shots between ${theirBurst.from}'–${theirBurst.to}' — we rode out a dangerous spell; checking how it started could be useful.` });

  // Possession without penetration (needs RAS possession).
  if (possession && shotsUs + shotsThem >= 8) {
    const shotShare = (shotsUs / (shotsUs + shotsThem)) * 100;
    if (possession.usPct >= 58 && shotShare <= 45) {
      findings.push({ kind: "poss", tone: "watch", weight: 4, text: `Plenty of ball (${pct(possession.usPct)} possession) but fewer of the shots (${pct(shotShare)}) — this looks like possession without penetration; the final third is worth a review.` });
    } else if (possession.usPct <= 42 && shotShare >= 55) {
      findings.push({ kind: "poss", tone: "good", weight: 3, text: `Less of the ball (${pct(possession.usPct)}) but more of the shots (${pct(shotShare)}) — the video suggests we were efficient with our possession.` });
    }
  }

  // Corner pressure.
  if (cornersThem >= 7 && cornersThem >= cornersUs * 2) {
    findings.push({ kind: "corners", tone: "watch", weight: 3, text: `${opp} won ${cornersThem} corners to our ${cornersUs} — sustained territory against us; the defending of the deliveries is worth checking.` });
  } else if (cornersUs >= 7 && cornersUs >= cornersThem * 2) {
    findings.push({ kind: "corners", tone: "info", weight: 2, text: `${cornersUs} corners to their ${cornersThem} — plenty of set-piece territory; whether the deliveries found our targets is worth a look.` });
  }

  // Dedupe by kind (already unique), sort: weight desc, concerns win ties.
  findings.sort((a, b) => b.weight - a.weight || (a.tone === "watch" ? -1 : 1) - (b.tone === "watch" ? -1 : 1));
  const top = findings.slice(0, 5).map(({ tone, text }) => ({ tone, text }));

  return {
    findings: top,
    timeline,
    tilt,
    tiltHalfAt: tilt.length > 0 ? halfAt : null,
    tiltMaxMin: tilt.length > 0 ? tilt[tilt.length - 1].min : null,
    radar,
    possession,
  };
}

function computeReportStats(events: unknown[], periods: unknown) {
  const evts = (Array.isArray(events) ? events : []) as VeoEventLite[];
  const isOwn = (e: VeoEventLite) => e.team === "Own";

  let shotsUs = 0;
  let shotsThem = 0;
  for (const e of evts)
    if (e.event_type === "FootballShot" || e.event_type === "FootballGoal") (isOwn(e) ? shotsUs++ : shotsThem++);

  // Minute-of-match using real period durations when Veo provides them.
  const durMin: number[] = Array.isArray(periods)
    ? (periods as { duration?: number }[]).map((p) => (Number(p?.duration) > 0 ? Number(p.duration) / 60 : 45))
    : [];
  const offsets: number[] = [0];
  for (let i = 0; i < durMin.length; i++) offsets.push(offsets[i] + durMin[i]);
  const minuteOf = (e: VeoEventLite) => {
    const pid = Number(e.period_id) || 1;
    const off = offsets[pid - 1] ?? (pid - 1) * 45;
    return off + (Number(e.period_time_ms) || 0) / 60000;
  };

  const maxMin = Math.max(90, ...evts.map(minuteOf));
  const bins = Math.ceil(maxMin / BIN_MIN);
  const momentum = Array.from({ length: bins }, (_, i) => ({ min: i * BIN_MIN, us: 0, them: 0 }));
  for (const e of evts) {
    const w = MOMENTUM_WEIGHT[e.event_type ?? ""];
    if (!w) continue;
    const idx = Math.min(bins - 1, Math.floor(minuteOf(e) / BIN_MIN));
    if (idx < 0) continue;
    if (isOwn(e)) momentum[idx].us += w;
    else momentum[idx].them -= w;
  }

  return { shots: { us: shotsUs, them: shotsThem }, momentum };
}

// GET /veo/report-stats?leagueId=&matchRowId= — { linked:false } when no link.
router.get("/veo/report-stats", async (req, res) => {
  const leagueId = Number(req.query.leagueId);
  const matchRowId = Number(req.query.matchRowId);
  if (!Number.isFinite(leagueId) || !Number.isFinite(matchRowId))
    return res.status(400).json({ error: "leagueId and matchRowId required" });

  const rows = await db
    .select({
      id: veoMatchesTable.id,
      startsAt: veoMatchesTable.startsAt,
      events: veoMatchesTable.events,
      periods: veoMatchesTable.periods,
      passDetails: veoMatchesTable.passDetails,
      opponent: matchesTable.opponent,
    })
    .from(veoMatchesTable)
    .leftJoin(matchesTable, eq(veoMatchesTable.matchId, matchesTable.id))
    .where(and(eq(veoMatchesTable.leagueId, leagueId), eq(veoMatchesTable.matchId, matchRowId), sql`${veoMatchesTable.removedAt} IS NULL`))
    .limit(1);
  const row = rows[0];
  if (!row || !Array.isArray(row.events) || row.events.length === 0) return res.json({ linked: false });

  const { shots, momentum } = computeReportStats(row.events, row.periods);
  const intel = computeMatchIntel(row.events, row.periods, row.passDetails, row.opponent ?? "the opposition");
  return res.json({ linked: true, veoId: row.id, startsAt: row.startsAt, shots, momentum, ...intel });
});

export default router;
