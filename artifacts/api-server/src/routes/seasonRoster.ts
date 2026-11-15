import { Router, type Request, type Response } from "express";
import { and, asc, eq, or } from "drizzle-orm";
import { db, leaguesTable, seasonsTable, seasonRosterTable } from "@workspace/db";
import { GetSeasonRosterQueryParams, GetSeasonRosterResponse, SaveSeasonRosterPlayerBody, DeleteSeasonRosterPlayerBody } from "@workspace/api-zod";
import { getSessionUser, canSeeYear, hasModule } from "../middlewares/entryAuth";
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
  if (!user || !canSeeYear(user, leagueId, year)) {
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

async function writableCampaign(req: Request, res: Response, seasonId: number) {
  const [season] = await db.select().from(seasonsTable).where(eq(seasonsTable.id, seasonId));
  const user = await getSessionUser(req);
  if (!season || !user || !hasModule(user, season.leagueId, "data-entry", season.year)) {
    res.status(403).json({ error: "Data Entry access to this team and season is required." });
    return null;
  }
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, season.leagueId));
  const club = await focusClubForLeagueRequest(req, season.leagueId);
  if (!league || club !== (league.focusClub ?? "Belconnen")) {
    res.status(403).json({ error: "This squad belongs to the competition's focus club." });
    return null;
  }
  return season;
}

router.post("/entry/season-roster", async (req, res): Promise<void> => {
  const parsed = SaveSeasonRosterPlayerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide a name, valid position, squad and campaign." }); return; }
  const input = parsed.data;
  const season = await writableCampaign(req, res, input.seasonId);
  if (!season) return;
  const playerName = input.playerName.trim(), squad = input.squad.trim();
  if (!playerName || !squad) { res.status(400).json({ error: "Name and squad cannot be blank." }); return; }
  const rows = await db.select().from(seasonRosterTable).where(eq(seasonRosterTable.seasonId, season.id));
  const current = input.id == null ? null : rows.find(r => r.id === input.id);
  if (input.id != null && !current) { res.status(404).json({ error: "Player not found in this campaign." }); return; }
  const normalize = (s: string) => s.toLocaleLowerCase().replace(/\s/g, "");
  if (rows.some(r => r.id !== input.id && normalize(r.playerName) === normalize(playerName))) {
    res.status(409).json({ error: "That player name already exists in this campaign. Use a distinct name for different players." }); return;
  }
  try {
    const values = { playerName, squad, positionCode: input.positionCode };
    const [saved] = current
      ? await db.update(seasonRosterTable).set(values).where(and(eq(seasonRosterTable.id, current.id), eq(seasonRosterTable.seasonId, season.id))).returning()
      : await db.insert(seasonRosterTable).values({
          ...values, seasonId: season.id, gpsLeagueId: rows[0]?.gpsLeagueId ?? season.leagueId,
        }).returning();
    res.json({ id: saved.id });
  } catch (err) {
    if ((err as { code?: string; cause?: { code?: string } }).code === "23505" ||
        (err as { cause?: { code?: string } }).cause?.code === "23505") {
      res.status(409).json({ error: "That player name already exists in this campaign." }); return;
    }
    throw err;
  }
});

router.delete("/entry/season-roster", async (req, res): Promise<void> => {
  const parsed = DeleteSeasonRosterPlayerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose a valid player and campaign." }); return; }
  if (!await writableCampaign(req, res, parsed.data.seasonId)) return;
  const removed = await db.delete(seasonRosterTable).where(and(
    eq(seasonRosterTable.id, parsed.data.id), eq(seasonRosterTable.seasonId, parsed.data.seasonId),
  )).returning({ id: seasonRosterTable.id });
  if (!removed.length) { res.status(404).json({ error: "Player not found in this campaign." }); return; }
  res.sendStatus(204);
});

export default router;
