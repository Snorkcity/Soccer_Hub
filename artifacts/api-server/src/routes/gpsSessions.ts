import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, gpsSessionsTable } from "@workspace/db";

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
  };
}

router.get("/gps-sessions", async (req, res): Promise<void> => {
  const query = ListGpsSessionsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { playerId, year, teamId, round } = query.data;

  const conditions = [];
  if (playerId) conditions.push(eq(gpsSessionsTable.playerId, playerId));
  if (year) conditions.push(eq(gpsSessionsTable.year, year));
  if (teamId) conditions.push(eq(gpsSessionsTable.teamId, teamId));
  if (round) conditions.push(eq(gpsSessionsTable.round, round));

  const rows = await db
    .select()
    .from(gpsSessionsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(gpsSessionsTable.sessionDate);

  res.json(ListGpsSessionsResponse.parse(rows.map(mapRow)));
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
  }).returning();
  res.status(201).json(CreateGpsSessionResponse.parse(mapRow(session)));
});

export default router;
