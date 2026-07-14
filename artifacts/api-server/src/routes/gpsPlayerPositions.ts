import { Router, type IRouter } from "express";
import { db, gpsPlayerPositionsTable } from "@workspace/db";
import { SaveGpsPlayerPositionsBody } from "@workspace/api-zod";
import { eq, sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/gps-player-positions", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(gpsPlayerPositionsTable)
    .orderBy(gpsPlayerPositionsTable.playerName);
  res.json(rows);
});

/** Upsert positions; entries with a null position are removed. */
router.put("/gps-player-positions", async (req, res): Promise<void> => {
  const parsed = SaveGpsPlayerPositionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let saved = 0;
  let removed = 0;
  await db.transaction(async tx => {
    for (const entry of parsed.data) {
      const name = entry.playerName.trim();
      if (!name) continue;
      if (entry.position == null) {
        const del = await tx
          .delete(gpsPlayerPositionsTable)
          .where(eq(gpsPlayerPositionsTable.playerName, name))
          .returning();
        removed += del.length;
      } else {
        await tx
          .insert(gpsPlayerPositionsTable)
          .values({ playerName: name, position: entry.position })
          .onConflictDoUpdate({
            target: gpsPlayerPositionsTable.playerName,
            set: { position: sql`excluded.position` },
          });
        saved += 1;
      }
    }
  });
  res.json({ saved, removed });
});

export default router;
