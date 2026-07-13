import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, playerStatsTable, matchesTable, playersTable } from "@workspace/db";
import {
  ListPlayerStatsQueryParams,
  ListPlayerStatsResponse,
  CreatePlayerStatBody,
  CreatePlayerStatResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/player-stats", async (req, res): Promise<void> => {
  const query = ListPlayerStatsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { matchId, playerId, teamId, seasonId } = query.data;

  const conditions = [];
  if (matchId) conditions.push(eq(playerStatsTable.matchId, matchId));
  if (playerId) conditions.push(eq(playerStatsTable.playerId, playerId));

  // For teamId/seasonId we join through matches
  if (teamId || seasonId) {
    const matchConditions = [];
    if (teamId) matchConditions.push(eq(matchesTable.teamId, teamId));
    if (seasonId) matchConditions.push(eq(matchesTable.seasonId, seasonId));

    const matchIds = await db
      .select({ id: matchesTable.id })
      .from(matchesTable)
      .where(and(...matchConditions));

    const ids = matchIds.map(m => m.id);
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    // Filter by match IDs
    const rows = await db
      .select()
      .from(playerStatsTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(playerStatsTable.playerName);

    const filtered = rows.filter(r => ids.includes(r.matchId));
    res.json(ListPlayerStatsResponse.parse(filtered));
    return;
  }

  const rows = await db
    .select()
    .from(playerStatsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(playerStatsTable.playerName);

  res.json(ListPlayerStatsResponse.parse(rows));
});

router.post("/player-stats", async (req, res): Promise<void> => {
  const parsed = CreatePlayerStatBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, parsed.data.playerId));
  const playerName = player?.name ?? "Unknown";
  const [stat] = await db.insert(playerStatsTable).values({ ...parsed.data, playerName }).returning();
  res.status(201).json(CreatePlayerStatResponse.parse(stat));
});

export default router;
