import { eq, and } from "drizzle-orm";
import type { Request } from "express";
import { db, seasonsTable, leaguesTable, clubsTable } from "@workspace/db";
import { getSessionUser, leagueIdForSeason } from "../middlewares/entryAuth";

/** True when `club` is a real club of `leagueId` (cached — club lists are tiny and append-only). */
const clubCheckCache = new Map<string, boolean>();
async function isClubInLeague(leagueId: number, club: string): Promise<boolean> {
  const key = `${leagueId}:${club}`;
  const hit = clubCheckCache.get(key);
  if (hit !== undefined) return hit;
  const rows = await db.select({ id: clubsTable.id }).from(clubsTable)
    .where(and(eq(clubsTable.leagueId, leagueId), eq(clubsTable.name, club))).limit(1);
  const ok = rows.length > 0;
  if (ok) clubCheckCache.set(key, true); // only cache positives — a new club can appear later
  return ok;
}

// The "focus club" is the club whose players appear on Team/Player Insights tabs
// for a given season. It is a per-league setting (leagues.focus_club); all other
// clubs are opponents shown on the Opponent Insights tab.
const DEFAULT_FOCUS_CLUB = "Belconnen";

// season → league mapping never changes, so the resolved focus club is cached
// for the lifetime of the process.
const cache = new Map<number, string>();
const leagueCache = new Map<number, string>();

async function focusClubForLeague(leagueId: number): Promise<string> {
  const cached = leagueCache.get(leagueId);
  if (cached !== undefined) return cached;
  const [row] = await db
    .select({ focusClub: leaguesTable.focusClub })
    .from(leaguesTable)
    .where(eq(leaguesTable.id, leagueId))
    .limit(1);
  const focusClub = row?.focusClub ?? DEFAULT_FOCUS_CLUB;
  leagueCache.set(leagueId, focusClub);
  return focusClub;
}

/**
 * Resolve the focus club for a season by joining seasons → leagues and reading
 * leagues.focus_club. Falls back to "Belconnen" when the column is null or the
 * season/league is missing, so existing behaviour is preserved.
 */
export async function focusClubForSeason(seasonId: number): Promise<string> {
  const cached = cache.get(seasonId);
  if (cached !== undefined) return cached;

  const [row] = await db
    .select({ focusClub: leaguesTable.focusClub })
    .from(seasonsTable)
    .innerJoin(leaguesTable, eq(seasonsTable.leagueId, leaguesTable.id))
    .where(eq(seasonsTable.id, seasonId));

  const focusClub = row?.focusClub ?? DEFAULT_FOCUS_CLUB;
  cache.set(seasonId, focusClub);
  return focusClub;
}

/**
 * Resolve the focus club for a request that already has a validated league.
 * This is the ownership boundary for league-scoped private coaching rows.
 */
export async function focusClubForLeagueRequest(req: Request, leagueId: number): Promise<string> {
  const user = await getSessionUser(req);
  if (user) {
    if (user.isSuperadmin) {
      const override = req.header("x-focus-club")?.trim();
      if (override && (await isClubInLeague(leagueId, override))) return override;
    }
    const club = user.leagues.get(leagueId)?.club?.trim();
    if (club) return club;
  }
  return focusClubForLeague(leagueId);
}

/**
 * Resolve the focus club for THIS request: if the signed-in user has their own
 * club set for the season's league (user_league_access.club), that wins —
 * their Team/Player insights centre on their club. Otherwise fall back to the
 * league default (leagues.focus_club). Superadmins with no per-league row get
 * the league default.
 */
export async function focusClubForRequest(req: Request, seasonId: number): Promise<string> {
  const leagueId = await leagueIdForSeason(seasonId);
  if (leagueId !== null) return focusClubForLeagueRequest(req, leagueId);
  return focusClubForSeason(seasonId);
}
