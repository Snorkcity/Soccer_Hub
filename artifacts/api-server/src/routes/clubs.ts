import { Router, type IRouter } from "express";
import { db, clubsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/clubs", async (_req, res): Promise<void> => {
  const clubs = await db.select().from(clubsTable).orderBy(clubsTable.name);
  res.json(clubs);
});

export default router;
