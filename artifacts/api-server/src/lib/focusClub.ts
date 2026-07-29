import { eq } from "drizzle-orm";
import type { Request } from "express";
import { db, seasonsTable, leaguesTable } from "@workspace/db";
import { getSessionUser, leagueIdForSeason } from "../middlewares/entryAuth";

// The "focus club" is the club whose players appear on Team/Player Insights tabs
// for a given season. It is a per-league setting (leagues.focus_club); all other
// clubs are opponents shown on the Opponent Insights tab.
const DEFAULT_FOCUS_CLUB = "Belconnen";

// season → league mapping never changes, so the resolved focus club is cached
// for the lifetime of the process.
const cache = new Map<number, string>();

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
 * Resolve the focus club for THIS request: if the signed-in user has their own
 * club set for the season's league (user_league_access.club), that wins —
 * their Team/Player insights centre on their club. Otherwise fall back to the
 * league default (leagues.focus_club). Superadmins with no per-league row get
 * the league default.
 */
export async function focusClubForRequest(req: Request, seasonId: number): Promise<string> {
  const user = await getSessionUser(req);
  if (user) {
    const leagueId = await leagueIdForSeason(seasonId);
    if (leagueId !== null) {
      const club = user.leagues.get(leagueId)?.club;
      if (club) return club;
    }
  }
  return focusClubForSeason(seasonId);
}
