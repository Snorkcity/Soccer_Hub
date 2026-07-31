import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, clubsTable } from "@workspace/db";
import {
  CreateClubBody, CreateClubResponse, UpdateClubBody, UpdateClubResponse,
  CopyClubsFromLeagueBody, CopyClubsFromLeagueResponse,
} from "@workspace/api-zod";
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

// Copy every club (name, colour, logo) from a source league into the target
// league. Upsert on (league_id, name): existing clubs get their colour/logo
// refreshed, nothing is ever deleted. Target-league write access is enforced
// by the central middleware (leagueId in the body + /clubs write module).
router.post("/clubs/copy", async (req, res): Promise<void> => {
  const parsed = CopyClubsFromLeagueBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { leagueId, sourceLeagueId } = parsed.data;
  if (leagueId === sourceLeagueId) {
    res.status(400).json({ error: "Pick a different league to copy from" });
    return;
  }

  const source = await db.select().from(clubsTable).where(eq(clubsTable.leagueId, sourceLeagueId));
  if (source.length === 0) {
    res.status(400).json({ error: "That league has no clubs to copy" });
    return;
  }

  const existing = await db
    .select({ name: clubsTable.name })
    .from(clubsTable)
    .where(eq(clubsTable.leagueId, leagueId));
  const existingNames = new Set(existing.map((c) => c.name));

  try {
    await db
      .insert(clubsTable)
      .values(source.map((c) => ({
        leagueId,
        name: c.name,
        primaryColor: c.primaryColor,
        logoUrl: c.logoUrl,
      })))
      .onConflictDoUpdate({
        target: [clubsTable.leagueId, clubsTable.name],
        set: {
          primaryColor: sql`excluded.primary_color`,
          logoUrl: sql`excluded.logo_url`,
        },
      });
  } catch (e) {
    if (pgErrorCode(e) === "23503") {
      res.status(400).json({ error: "That league does not exist" });
      return;
    }
    throw e;
  }

  const updated = source.filter((c) => existingNames.has(c.name)).length;
  res.json(CopyClubsFromLeagueResponse.parse({ added: source.length - updated, updated }));
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
