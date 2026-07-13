import { Router, type IRouter } from "express";
import { db, seasonsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import {
  ListSeasonsResponse,
  CreateSeasonBody,
  CreateSeasonResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/seasons", async (_req, res): Promise<void> => {
  const rows = await db.select().from(seasonsTable).orderBy(desc(seasonsTable.year));
  res.json(ListSeasonsResponse.parse(rows));
});

router.post("/seasons", async (req, res): Promise<void> => {
  const parsed = CreateSeasonBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [season] = await db.insert(seasonsTable).values(parsed.data).returning();
  res.status(201).json(CreateSeasonResponse.parse(season));
});

export default router;
