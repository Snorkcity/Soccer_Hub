import { pgTable, serial, text, integer, boolean, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

// A single Veo-recorded match synced into the Hub. The raw per-match payloads
// (events, stats, periods, roster) are stored verbatim as jsonb — the events
// feed is the source of truth from which we compute every aggregate, momentum /
// field-tilt series and shot map, so we keep it whole rather than shredding it
// into rows. League-scoped (carries league_id) per the league-private-data rule.
//
// See .agents/memory/veo-integration.md for the Veo API map these fields mirror.
export const veoMatchesTable = pgTable(
  "veo_matches",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id").notNull().references(() => leaguesTable.id),
    // Veo's match identifier (uuid). Stable key we upsert on, per league.
    veoMatchId: text("veo_match_id").notNull(),
    veoTeamSlug: text("veo_team_slug"),
    title: text("title"),
    opponent: text("opponent"),
    // ISO datetime string of kick-off (Veo recording `start`).
    startsAt: text("starts_at"),
    // Veo recording pipeline state retained verbatim for sync audits. Veo has
    // returned both strings and structured objects from this field.
    processingStatus: jsonb("processing_status").$type<unknown>(),
    hasAnalytics: boolean("has_analytics").default(false).notNull(),
    hasEvents: boolean("has_events").default(false).notNull(),
    hasTracking: boolean("has_tracking").default(false).notNull(),
    hasMomentum: boolean("has_momentum").default(false).notNull(),
    // Raw payloads exactly as returned by the Veo API.
    events: jsonb("events").$type<unknown[]>(),
    stats: jsonb("stats").$type<Record<string, unknown>>(),
    periods: jsonb("periods").$type<unknown[]>(),
    // Hub-confirmed own_side values keyed by 1-based period number. Kept
    // separately so Veo re-fetches can replace raw periods without erasing the
    // coach's correction or compromising the raw payload for audit.
    directionOverrides: jsonb("direction_overrides").$type<Record<string, "left" | "right">>(),
    roster: jsonb("roster").$type<Record<string, unknown>>(),
    // Pass/possession analytics from Veo's RAS service (pass strings, pass
    // locations, possession thirds + 18-zone grid, per period). Stored as the
    // whole VeoPassDetails result incl. {available:false} markers so the sync
    // knows it already checked a match that lacks the data.
    passDetails: jsonb("pass_details").$type<Record<string, unknown>>(),
    // Link to our own matches.id once reconciled by round / opponent / date.
    matchId: integer("match_id"),
    syncedAt: text("synced_at"),
    // Soft delete: set when the coach removes a game from the Hub. The row and
    // its payloads are kept (Veo eventually drops old recordings from the
    // portal, so once synced the Hub is the archive) but every read endpoint
    // skips removed rows. Sync never clears this — restore is manual.
    removedAt: text("removed_at"),
  },
  (t) => ({
    byLeagueMatch: uniqueIndex("veo_matches_league_match_idx").on(t.leagueId, t.veoMatchId),
    oneRecordingPerHubMatch: uniqueIndex("veo_matches_league_hub_match_idx")
      .on(t.leagueId, t.matchId)
      .where(sql`${t.matchId} IS NOT NULL AND ${t.removedAt} IS NULL`),
  }),
);

export const insertVeoMatchSchema = createInsertSchema(veoMatchesTable).omit({ id: true });
export type InsertVeoMatch = z.infer<typeof insertVeoMatchSchema>;
export type VeoMatch = typeof veoMatchesTable.$inferSelect;
