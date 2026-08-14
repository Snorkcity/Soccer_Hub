// ── Veo stats sync ──────────────────────────────────────────────────────────
// Pulls a squad's match data from Veo's internal API into veo_matches, and
// serves it back to the Veo Insights tab. Sync is incremental + batch-capped so
// a single HTTP request stays responsive: metadata for every recording is
// upserted, then heavy per-match payloads (events/stats/periods/roster) are
// fetched only for matches that don't have them yet, up to `batch` per call.
// The client loops until { remaining } hits 0. See routes/dribl.ts for the
// sibling pattern and .agents/memory/veo-integration.md for the API map.
import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, veoMatchesTable, leaguesTable } from "@workspace/db";
import {
  defaultVeoCreds,
  listRecordings,
  getMatchDetail,
  getEvents,
  getStats,
  getPeriods,
  getRoster,
  type VeoCredentials,
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

// POST /entry/veo-sync  { leagueId, batch? }
// Rides the /entry prefix → data-entry module + leagueId access check.
router.post("/entry/veo-sync", async (req, res) => {
  const leagueId = Number(req.body?.leagueId);
  const batch = Number.isFinite(Number(req.body?.batch)) ? Number(req.body?.batch) : DEFAULT_BATCH;
  if (!Number.isFinite(leagueId)) return res.status(400).json({ error: "leagueId required" });

  const mapping = await leagueVeoMapping(leagueId);
  if (!mapping) return res.status(400).json({ error: "This league has no Veo team mapping." });

  const creds: VeoCredentials | null = defaultVeoCreds();
  if (!creds) return res.status(503).json({ error: "Veo credentials are not configured on the server." });

  const nowIso = new Date().toISOString();

  let recordings;
  try {
    recordings = await listRecordings(creds, mapping.veoClubSlug, mapping.veoTeamSlug);
  } catch (e) {
    logger.error({ err: e, leagueId }, "veo: listRecordings failed");
    return res.status(502).json({ error: "Could not reach Veo. Try again shortly." });
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
        opponent: rec.title ? rec.title.replace(/^.*\bvs\.?\s*/i, "").trim() || null : null,
        startsAt: rec.start ?? null,
        syncedAt: nowIso,
      })
      .onConflictDoUpdate({
        target: [veoMatchesTable.leagueId, veoMatchesTable.veoMatchId],
        set: {
          title: rec.title ?? null,
          startsAt: rec.start ?? null,
          veoTeamSlug: mapping.veoTeamSlug,
        },
      });
  }

  // Which synced matches still need their heavy payloads?
  const pending = await db
    .select({ veoMatchId: veoMatchesTable.veoMatchId })
    .from(veoMatchesTable)
    .where(and(eq(veoMatchesTable.leagueId, leagueId), sql`${veoMatchesTable.events} IS NULL`));

  const toFetch = pending.slice(0, batch);
  let fetched = 0;
  let failed = 0;

  await mapPool(toFetch, 4, async ({ veoMatchId }) => {
    try {
      // Events are the core payload: if that request fails we persist NOTHING,
      // so the match stays events-IS-NULL and is retried on the next sync.
      // The side payloads may fail soft (older matches lack some of them).
      const [detail, events, stats, periods, roster] = await Promise.all([
        getMatchDetail(creds, veoMatchId).catch(() => null),
        getEvents(creds, veoMatchId),
        getStats(creds, veoMatchId).catch(() => ({})),
        getPeriods(creds, veoMatchId).catch(() => [] as unknown[]),
        getRoster(creds, veoMatchId).catch(() => ({})),
      ]);
      await db
        .update(veoMatchesTable)
        .set({
          opponent: detail?.opponent_team_name ?? undefined,
          title: detail?.title ?? undefined,
          hasAnalytics: detail?.has_analytics_enabled ?? false,
          hasEvents: detail?.has_events_enabled ?? false,
          hasTracking: detail?.has_tracking_data ?? false,
          hasMomentum: detail?.has_momentum_data ?? false,
          events,
          stats,
          periods,
          roster,
          syncedAt: nowIso,
        })
        .where(and(eq(veoMatchesTable.leagueId, leagueId), eq(veoMatchesTable.veoMatchId, veoMatchId)));
      fetched++;
    } catch (e) {
      failed++;
      logger.warn({ err: e, veoMatchId }, "veo: match payload fetch failed; will retry next sync");
    }
  });

  const remaining = Math.max(0, pending.length - fetched);
  return res.json({
    league: mapping.name,
    totalMatches: recordings.length,
    fetched,
    remaining,
    // Only "done" when nothing is left AND nothing failed this pass — failed
    // matches stay pending and should be retried, not silently dropped.
    done: remaining === 0 && failed === 0,
  });
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
    })
    .from(veoMatchesTable)
    .where(eq(veoMatchesTable.leagueId, leagueId))
    .orderBy(sql`${veoMatchesTable.startsAt} DESC NULLS LAST`);
  return res.json({ matches: rows });
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
    .where(and(eq(veoMatchesTable.id, id), eq(veoMatchesTable.leagueId, leagueId)))
    .limit(1);
  if (rows.length === 0) return res.status(404).json({ error: "Not found" });
  return res.json(rows[0]);
});

export default router;
