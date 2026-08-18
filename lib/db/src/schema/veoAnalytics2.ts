import { pgTable, serial, text, integer, jsonb, uniqueIndex, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { leaguesTable } from "./leagues";

// Analytics 2 is Veo's camera-derived player metric system (physical metrics,
// expanded match events, jersey tracking). It is strictly camera-derived and
// must NEVER touch GPS tables or routes. One row per league + Veo match UUID.
//
// Raw payloads are stored verbatim so future Veo beta fields survive without a
// schema change. The payload hash lets the sync detect stale/changed data
// without re-parsing. Transient failures never overwrite a good raw bundle —
// only a fresh, successful fetch replaces it.
//
// status:
//   complete   — full bundle successfully fetched and stored
//   partial    — at least one source succeeded; some sources failed transiently
//   pending    — not yet attempted or waiting for Veo pipeline
//   unavailable — Veo returned a terminal non-retryable error (e.g. 404)
//   error      — fetch attempted but failed with a non-terminal error; retry
export const veoAnalytics2Table = pgTable(
  "veo_analytics2",
  {
    id: serial("id").primaryKey(),
    leagueId: integer("league_id").notNull().references(() => leaguesTable.id),
    // Veo's match identifier (uuid) — same as veo_matches.veo_match_id.
    veoMatchId: text("veo_match_id").notNull(),
    // The Veo team UUID used in the cross-match POST. Nullable because it is
    // resolved from listTeams at sync time; null means it has never been fetched.
    teamId: text("team_id"),
    // Fetch lifecycle status.
    status: text("status").notNull().default("pending"),
    // The Analytics 2 source version used to build this bundle (e.g. "1"). Lets
    // the sync detect version-stale rows that should be re-fetched.
    sourceVersion: text("source_version"),
    // Raw bundle: all source payloads combined exactly as returned by Veo, stored
    // as a single JSONB object keyed by source name. Preserves beta fields.
    //   {
    //     crossMatchPlayer: <POST /analysis/stats/ response>,
    //     physicalMetrics:  <GET /mes/v2/{matchId}/physical-metrics response>,
    //     matchEvents:      <GET /mes/v2/{matchId}/match-events response>,
    //     jerseyNumbers:    <GET /mes/v2/{matchId}/player-tracking/jersey-numbers response>,
    //   }
    // Any key may be absent when its fetch failed — partial bundles are stored
    // rather than discarded so the good data is not lost.
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    // Source names that returned a terminal response (currently 404/no periods).
    // A partial row is retryable only while a missing source is not in this list.
    terminalSources: jsonb("terminal_sources").$type<string[]>().notNull().default([]),
    // SHA-256 hex digest of JSON.stringify(raw) — lets consumers detect
    // unchanged bundles without re-parsing, and lets the sync skip no-op updates.
    payloadHash: text("payload_hash"),
    // When Veo was last queried for this row's match (even on failure).
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    // When a successful fetch last wrote to `raw` (null if never successful).
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    // Last error message, reset to null on a successful fetch.
    lastError: text("last_error"),
  },
  (t) => ({
    byLeagueMatch: uniqueIndex("veo_analytics2_league_match_idx").on(t.leagueId, t.veoMatchId),
  }),
);

export const insertVeoAnalytics2Schema = createInsertSchema(veoAnalytics2Table).omit({ id: true });
export type InsertVeoAnalytics2 = z.infer<typeof insertVeoAnalytics2Schema>;
export type VeoAnalytics2 = typeof veoAnalytics2Table.$inferSelect;
