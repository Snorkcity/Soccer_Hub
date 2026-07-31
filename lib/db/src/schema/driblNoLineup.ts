import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// Games where Dribl never published a team sheet for a club. Without this a
// weekly re-sync can't tell "no sheet exists" from "not fetched yet", so it
// re-fetches match detail + line-ups for every old sheet-less game each time.
// A row here means "we checked and Dribl had no players for this match+club" —
// skip it on future syncs. Cleared automatically when a re-check (on demand)
// finds a sheet, or when player rows arrive some other way.
export const driblNoLineupTable = pgTable(
  "dribl_no_lineup",
  {
    id: serial("id").primaryKey(),
    seasonId: integer("season_id").notNull(),
    matchId: text("match_id").notNull(), // local match ID (e.g. R4-BEL-CCF)
    club: text("club").notNull(),        // local club name
    checkedAt: timestamp("checked_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dribl_no_lineup_unique").on(t.seasonId, t.matchId, t.club)],
);

export type DriblNoLineupRow = typeof driblNoLineupTable.$inferSelect;
