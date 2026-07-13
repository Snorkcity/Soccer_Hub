import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, playersTable } from "@workspace/db";
import {
  ListPlayersResponse,
  CreatePlayerBody,
  CreatePlayerResponse,
  GetPlayerParams,
  GetPlayerResponse,
  UpdatePlayerParams,
  UpdatePlayerBody,
  UpdatePlayerResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/players", async (req, res): Promise<void> => {
  const rows = await db.select().from(playersTable).orderBy(playersTable.name);
  res.json(ListPlayersResponse.parse(rows));
});

router.post("/players", async (req, res): Promise<void> => {
  const parsed = CreatePlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [player] = await db.insert(playersTable).values(parsed.data).returning();
  res.status(201).json(CreatePlayerResponse.parse(player));
});

router.get("/players/:id", async (req, res): Promise<void> => {
  const params = GetPlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [player] = await db.select().from(playersTable).where(eq(playersTable.id, params.data.id));
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json(GetPlayerResponse.parse(player));
});

router.patch("/players/:id", async (req, res): Promise<void> => {
  const params = UpdatePlayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePlayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [player] = await db.update(playersTable).set(parsed.data).where(eq(playersTable.id, params.data.id)).returning();
  if (!player) {
    res.status(404).json({ error: "Player not found" });
    return;
  }
  res.json(UpdatePlayerResponse.parse(player));
});

export default router;
