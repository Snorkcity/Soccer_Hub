import { Router, type IRouter } from "express";
import { db, seasonsTable, leaguesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  ListSeasonsResponse,
  CreateSeasonBody,
  CreateSeasonResponse,
  ListLeaguesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/leagues", async (_req, res): Promise<void> => {
  const rows = await db.select().from(leaguesTable).orderBy(leaguesTable.name);
  res.json(ListLeaguesResponse.parse(rows));
});

router.get("/seasons", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: seasonsTable.id,
      leagueId: seasonsTable.leagueId,
      leagueName: leaguesTable.name,
      year: seasonsTable.year,
      label: seasonsTable.label,
      isActive: seasonsTable.isActive,
    })
    .from(seasonsTable)
    .innerJoin(leaguesTable, eq(leaguesTable.id, seasonsTable.leagueId))
    .orderBy(desc(seasonsTable.year));
  res.json(ListSeasonsResponse.parse(rows));
});

router.post("/seasons", async (req, res): Promise<void> => {
  const parsed = CreateSeasonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [season] = await db.insert(seasonsTable).values(parsed.data).returning();
  const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, season.leagueId));
  res.status(201).json(CreateSeasonResponse.parse({ ...season, leagueName: league?.name ?? "" }));
});

export default router;
