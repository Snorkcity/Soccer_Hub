import { Router, type IRouter } from "express";
import { db, seasonsTable, leaguesTable } from "@workspace/db";
import { asc, desc, eq } from "drizzle-orm";
import {
  ListSeasonsResponse,
  CreateSeasonBody,
  CreateSeasonResponse,
  ListLeaguesResponse,
  CreateLeagueBody,
  CreateLeagueResponse,
} from "@workspace/api-zod";
import { pgErrorCode } from "../lib/pgError";

const router: IRouter = Router();

router.get("/leagues", async (_req, res): Promise<void> => {
  const rows = await db.select().from(leaguesTable).orderBy(leaguesTable.name);
  res.json(ListLeaguesResponse.parse(rows));
});

router.post("/leagues", async (req, res): Promise<void> => {
  const parsed = CreateLeagueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [league] = await db.insert(leaguesTable).values(parsed.data).returning();
    res.status(201).json(CreateLeagueResponse.parse(league));
  } catch (e) {
    if (pgErrorCode(e) === "23505") {
      res.status(409).json({ error: "A league with that name already exists" });
      return;
    }
    throw e;
  }
});

router.get("/seasons", async (_req, res): Promise<void> => {
  // Ordered by league id first so the original league's seasons lead the list —
  // frontends that default to "first active season" resolve deterministically.
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
    .orderBy(asc(seasonsTable.leagueId), desc(seasonsTable.year));
  res.json(ListSeasonsResponse.parse(rows));
});

router.post("/seasons", async (req, res): Promise<void> => {
  const parsed = CreateSeasonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const season = await db.transaction(async (tx) => {
      // "Active" is per-league: activating a season deactivates that league's others
      if (parsed.data.isActive) {
        await tx.update(seasonsTable).set({ isActive: false }).where(eq(seasonsTable.leagueId, parsed.data.leagueId));
      }
      const [row] = await tx.insert(seasonsTable).values(parsed.data).returning();
      return row;
    });
    const [league] = await db.select().from(leaguesTable).where(eq(leaguesTable.id, season.leagueId));
    res.status(201).json(CreateSeasonResponse.parse({ ...season, leagueName: league?.name ?? "" }));
  } catch (e) {
    if (pgErrorCode(e) === "23503") {
      res.status(400).json({ error: "That league does not exist" });
      return;
    }
    throw e;
  }
});

export default router;
