import { Router, type IRouter } from "express";
import { db, clubsTable } from "@workspace/db";
import { CreateClubBody, CreateClubResponse } from "@workspace/api-zod";
import { pgErrorCode } from "../lib/pgError";

const router: IRouter = Router();

router.get("/clubs", async (_req, res): Promise<void> => {
  const clubs = await db.select().from(clubsTable).orderBy(clubsTable.name);
  res.json(clubs);
});

router.post("/clubs", async (req, res): Promise<void> => {
  const parsed = CreateClubBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const [club] = await db.insert(clubsTable).values(parsed.data).returning();
    res.status(201).json(CreateClubResponse.parse(club));
  } catch (e) {
    const code = pgErrorCode(e);
    if (code === "23505") {
      res.status(409).json({ error: "That club already exists in this league" });
      return;
    }
    if (code === "23503") {
      res.status(400).json({ error: "That league does not exist" });
      return;
    }
    throw e;
  }
});

export default router;
