import { Router } from "express";
import { and, asc, eq, or } from "drizzle-orm";
import { db, leaguesTable, seasonsTable, seasonRosterTable } from "@workspace/db";
import { GetSeasonRosterQueryParams, GetSeasonRosterResponse } from "@workspace/api-zod";
import { getSessionUser, canSeeLeague } from "../middlewares/entryAuth";
import { focusClubForLeagueRequest } from "../lib/focusClub";

const router = Router();

router.get("/season-roster", async (req, res): Promise<void> => {
  const parsed = GetSeasonRosterQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid competition and four-digit season." });
    return;
  }
  const { leagueId, year } = parsed.data;
  const user = await getSessionUser(req);
  if (!user || !canSeeLeague(user, leagueId)) {
    res.status(403).json({ error: "No access to this competition." });
    return;
  }
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, leagueId));
  if (!league) {
    res.status(404).json({ error: "Competition not found." });
    return;
  }
  // These seeded rosters belong to the focus club, not every club with a
  // grant in this competition. GPS sharing is explicit on each roster row.
  const club = await focusClubForLeagueRequest(req, leagueId);
  if (club !== (league.focusClub ?? "Belconnen")) {
    res.json([]);
    return;
  }
  const rows = await db.select({
    id: seasonRosterTable.id, seasonId: seasonsTable.id,
    leagueId: leaguesTable.id, leagueName: leaguesTable.name,
    year: seasonsTable.year, gpsLeagueId: seasonRosterTable.gpsLeagueId,
    playerName: seasonRosterTable.playerName, squad: seasonRosterTable.squad,
    positionCode: seasonRosterTable.positionCode,
  }).from(seasonRosterTable)
    .innerJoin(seasonsTable, eq(seasonsTable.id, seasonRosterTable.seasonId))
    .innerJoin(leaguesTable, eq(leaguesTable.id, seasonsTable.leagueId))
    .where(and(eq(seasonsTable.year, year), or(
      eq(seasonsTable.leagueId, leagueId),
      eq(seasonRosterTable.gpsLeagueId, leagueId),
    )))
    .orderBy(asc(seasonRosterTable.squad), asc(seasonRosterTable.id));
  const nameCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.playerName.toLocaleLowerCase().replace(/\s/g, "");
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  res.json(GetSeasonRosterResponse.parse(rows.map(row => ({
    ...row,
    ambiguousName: (nameCounts.get(row.playerName.toLocaleLowerCase().replace(/\s/g, "")) ?? 0) > 1,
  }))));
});

export default router;
