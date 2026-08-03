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
  UpdateLeagueBody,
  UpdateLeagueResponse,
} from "@workspace/api-zod";
import { pgErrorCode } from "../lib/pgError";
import { getSessionUser, canSeeLeague } from "../middlewares/entryAuth";

const router: IRouter = Router();

router.get("/leagues", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  const rows = await db.select().from(leaguesTable).orderBy(leaguesTable.name);
  const visible = user ? rows.filter((l) => canSeeLeague(user, l.id)) : [];
  res.json(ListLeaguesResponse.parse(visible));
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

// League settings (today: the GPS feed). Superadmin only — pointing a league's
// GPS reads at another league crosses league-privacy lines, so it is a
// deliberate, platform-level configuration, not an everyday admin action.
router.patch("/leagues/:id", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
  if (!user?.isSuperadmin) {
    res.status(403).json({ error: "Only a superadmin can change league settings" });
    return;
  }
  const id = Number(req.params.id);
  const parsed = UpdateLeagueBody.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid league id" : parsed.error.message });
    return;
  }
  const patch: Partial<typeof leaguesTable.$inferInsert> = {};
  if ("gpsSourceLeagueId" in parsed.data) {
    const src = parsed.data.gpsSourceLeagueId ?? null;
    if (src === id) {
      res.status(400).json({ error: "A league cannot feed GPS data from itself" });
      return;
    }
    patch.gpsSourceLeagueId = src;
    // A feed without a squad would leak the source league's whole GPS dataset —
    // default to Reserves, the only feed in use today.
    patch.gpsSourceSquad = src == null ? null : (parsed.data.gpsSourceSquad ?? "Reserves");
  } else if ("gpsSourceSquad" in parsed.data) {
    patch.gpsSourceSquad = parsed.data.gpsSourceSquad ?? null;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }
  const [league] = await db.update(leaguesTable).set(patch).where(eq(leaguesTable.id, id)).returning();
  if (!league) {
    res.status(404).json({ error: "League not found" });
    return;
  }
  res.json(UpdateLeagueResponse.parse(league));
});

router.get("/seasons", async (req, res): Promise<void> => {
  const user = await getSessionUser(req);
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
    // Only active seasons are offered in the app; historical seasons (2024/2025)
    // live in the legacy app until their data is brought across (per coach).
    .where(eq(seasonsTable.isActive, true))
    .orderBy(asc(seasonsTable.leagueId), desc(seasonsTable.year));
  const visible = user ? rows.filter((s) => canSeeLeague(user, s.leagueId)) : [];
  res.json(ListSeasonsResponse.parse(visible));
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
