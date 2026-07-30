import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, clubsTable } from "@workspace/db";
import { CreateClubBody, CreateClubResponse, UpdateClubBody, UpdateClubResponse } from "@workspace/api-zod";
import { pgErrorCode } from "../lib/pgError";
import { mayTouchLeagueRow } from "../middlewares/entryAuth";

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

// ID-addressed update carries no leagueId for the central middleware to scope,
// so re-check against the row's own league before writing.
router.patch("/clubs/:clubId", async (req, res): Promise<void> => {
  const clubId = Number(req.params.clubId);
  if (!Number.isInteger(clubId)) {
    res.status(400).json({ error: "Invalid club id" });
    return;
  }
  const parsed = UpdateClubBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;

  const [club] = await db.select().from(clubsTable).where(eq(clubsTable.id, clubId));
  if (!club) {
    res.status(404).json({ error: "That club does not exist" });
    return;
  }
  if (!(await mayTouchLeagueRow(req, club.leagueId, "data-entry"))) {
    res.status(403).json({ error: "You don't have data entry access for this league" });
    return;
  }

  const patch: Partial<{ primaryColor: string; logoUrl: string | null }> = {};
  if (b.primaryColor !== undefined && b.primaryColor !== null) {
    const hex = b.primaryColor.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) {
      res.status(400).json({ error: "Colour must be a 6-digit hex code like #005baa" });
      return;
    }
    patch.primaryColor = hex;
  }
  if (b.logoUrl !== undefined) {
    const url = b.logoUrl?.trim() || null;
    if (url && !/^https?:\/\//.test(url)) {
      res.status(400).json({ error: "Logo URL must start with http:// or https://" });
      return;
    }
    patch.logoUrl = url;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Nothing to update — give a colour or a logo URL" });
    return;
  }

  const [updated] = await db.update(clubsTable).set(patch).where(eq(clubsTable.id, clubId)).returning();
  res.json(UpdateClubResponse.parse(updated));
});

export default router;
