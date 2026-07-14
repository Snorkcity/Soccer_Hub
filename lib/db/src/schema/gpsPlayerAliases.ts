import { pgTable, text } from "drizzle-orm/pg-core";

/**
 * Merges duplicate GPS identities: raw names as they appear in GPS exports
 * (e.g. "U17-Eden", "Eden Rodda") map to one canonical player name ("Eden").
 * Raw gps_sessions rows are never rewritten — the API canonicalises on read,
 * so future imports with old names keep pooling correctly.
 */
export const gpsPlayerAliasesTable = pgTable("gps_player_aliases", {
  alias: text("alias").primaryKey(),
  canonical: text("canonical").notNull(),
});

export type GpsPlayerAlias = typeof gpsPlayerAliasesTable.$inferSelect;

/**
 * Links a canonical GPS identity to her name in the season-stats data
 * (player_stats.player_name) when the two differ, e.g. Sam ↔ Sammy.
 * Names that match exactly need no row here.
 */
export const playerIdentityLinksTable = pgTable("player_identity_links", {
  canonical: text("canonical").primaryKey(),
  seasonStatsName: text("season_stats_name").notNull(),
});

export type PlayerIdentityLink = typeof playerIdentityLinksTable.$inferSelect;
