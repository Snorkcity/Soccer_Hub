import { pgTable, serial, text, integer, uniqueIndex } from "drizzle-orm/pg-core";

// Permanent full-name → display-name mapping learned during Dribl syncs.
// Exists so same-initial teammates keep STABLE display names across syncs:
// the first "A.Rakic" keeps the short form forever, a later arrival is pinned
// to "An.Rakic", and goals scored by either always land on the right player.
export const driblNameMapTable = pgTable(
  "dribl_name_map",
  {
    id: serial("id").primaryKey(),
    seasonId: integer("season_id").notNull(),
    club: text("club").notNull(),
    fullName: text("full_name").notNull(), // lower-cased full name from Dribl
    displayName: text("display_name").notNull(),
  },
  (t) => [
    uniqueIndex("dribl_name_map_unique").on(t.seasonId, t.club, t.fullName),
    // Two different players can never hold the same display name
    uniqueIndex("dribl_name_map_display_unique").on(t.seasonId, t.club, t.displayName),
  ],
);

export type DriblNameMapRow = typeof driblNameMapTable.$inferSelect;
