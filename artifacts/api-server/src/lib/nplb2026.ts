import { and, eq } from "drizzle-orm";
import { db, leaguesTable, seasonsTable } from "@workspace/db";
import { actNplbGrade } from "@workspace/api-zod";

export const NPLB_2026_LEAGUES = [
  { localName: "ACT NPLB U14", driblLeague: "NPLB U14" },
  { localName: "ACT NPLB U15", driblLeague: "NPLB U15" },
  { localName: "ACT NPLB U16", driblLeague: "NPLB U16" },
  { localName: "ACT NPLB U18", driblLeague: "NPLB U18" },
] as const;

export const NPLB_2026_YEAR = "2026";
export const NPLB_2026_SEASON_LABEL = "2026 Season";

export type NplbBorrowDirection = "up" | "down" | "unknown";
export type NplbBorrowingEvidence = {
  driblUserId: string | null;
  borrowed: boolean;
  leagueName: string;
  seasonYear: string;
};

export function nplbPlayerIdentityKey(
  playerName: string,
  driblUserId: string | null | undefined,
): string {
  const stableId = driblUserId?.trim();
  return stableId
    ? `id:${stableId}`
    : `name:${playerName.trim().toLowerCase()}`;
}

export function compareNplbPlayerRows(
  a: { totalGoals: number; totalAssists: number; playerName: string; identityKey?: string },
  b: { totalGoals: number; totalAssists: number; playerName: string; identityKey?: string },
): number {
  return (b.totalGoals + b.totalAssists) - (a.totalGoals + a.totalAssists) ||
    a.playerName.localeCompare(b.playerName) ||
    (a.identityKey ?? "").localeCompare(b.identityKey ?? "");
}

export function nplbGrade(leagueName: string | null | undefined): number | null {
  return actNplbGrade(leagueName);
}

export function nplbBorrowDirection(
  currentGrade: number | null,
  driblUserId: string | null | undefined,
  evidence: NplbBorrowingEvidence[],
  seasonYear: string,
): NplbBorrowDirection {
  const homeGrade = nplbHomeGrade(driblUserId, evidence, seasonYear);
  if (currentGrade == null || homeGrade == null) return "unknown";
  if (homeGrade < currentGrade) return "up";
  if (homeGrade > currentGrade) return "down";
  return "unknown";
}

export function nplbHomeGrade(
  driblUserId: string | null | undefined,
  evidence: NplbBorrowingEvidence[],
  seasonYear: string,
): number | null {
  if (!driblUserId) return null;
  const homeGrades = new Set(
    evidence
      .filter(row =>
        row.seasonYear === seasonYear &&
        row.driblUserId === driblUserId &&
        !row.borrowed
      )
      .map(row => nplbGrade(row.leagueName))
      .filter((grade): grade is number => grade != null),
  );
  if (homeGrades.size !== 1) return null;
  const [homeGrade] = homeGrades;
  return homeGrade;
}

/**
 * Name-keyed setup shared by startup migration and the controlled club-import
 * script. Existing database IDs are deliberately never copied between
 * environments.
 */
export async function ensureNplb2026Structure(): Promise<void> {
  for (const spec of NPLB_2026_LEAGUES) {
    // Seed the agreed defaults once. A later operator change to focus club,
    // region, or player naming must survive every restart and setup rerun.
    await db
      .insert(leaguesTable)
      .values({
        name: spec.localName,
        region: "ACT",
        focusClub: "Belconnen",
        nameFormat: "initial-surname",
      })
      .onConflictDoNothing();

    const [league] = await db
      .select()
      .from(leaguesTable)
      .where(eq(leaguesTable.name, spec.localName))
      .limit(1);
    if (!league) throw new Error(`Could not create or resolve ${spec.localName}`);

    const [activeBeforeInsert] = await db
      .select({ id: seasonsTable.id })
      .from(seasonsTable)
      .where(and(
        eq(seasonsTable.leagueId, league.id),
        eq(seasonsTable.isActive, true),
      ))
      .limit(1);

    // The database's unique (league_id, year) index makes concurrent startup
    // and setup runs converge on one season row. Only the agreed label is
    // refreshed; a future active season is never displaced.
    const [season] = await db
      .insert(seasonsTable)
      .values({
        leagueId: league.id,
        year: NPLB_2026_YEAR,
        label: NPLB_2026_SEASON_LABEL,
        isActive: !activeBeforeInsert,
      })
      .onConflictDoUpdate({
        target: [seasonsTable.leagueId, seasonsTable.year],
        set: { label: NPLB_2026_SEASON_LABEL },
      })
      .returning();

    const [activeAfterInsert] = await db
      .select({ id: seasonsTable.id })
      .from(seasonsTable)
      .where(and(
        eq(seasonsTable.leagueId, league.id),
        eq(seasonsTable.isActive, true),
      ))
      .limit(1);
    if (!activeAfterInsert) {
      await db
        .update(seasonsTable)
        .set({ isActive: true })
        .where(eq(seasonsTable.id, season.id));
    }
  }
}