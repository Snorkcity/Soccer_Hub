import { boolean, pgTable, serial, text, integer, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A competition, e.g. "ACT NPLW", "NSW NPL", "VIC NPL". Seasons (and clubs)
// belong to a league, so the same platform can track many competitions.
export const leaguesTable = pgTable("leagues", {
  id:        serial("id").primaryKey(),
  name:      text("name").notNull().unique(),
  region:    text("region"),
  // The "focus club" whose players appear on Team/Player Insights tabs for
  // seasons in this league; all other clubs are opponents. Null falls back to
  // "Belconnen" in code (see lib/focusClub.ts).
  focusClub: text("focus_club"),
  // How the AI screenshot reader names players for this league:
  // null/"surname" = surname only ("Bloggs"); "initial-surname" = "S.Smith".
  nameFormat: text("name_format"),
  // GPS feed (2026-08): this league has no GPS uploads of its own — it reads
  // the source league's gps_sessions rows, filtered to one squad (parsed from
  // the round suffix, e.g. "R7-res" → "Reserves"). Read-only share: fixes and
  // re-uploads happen in the source league and flow through automatically.
  gpsSourceLeagueId: integer("gps_source_league_id").references((): AnyPgColumn => leaguesTable.id),
  gpsSourceSquad:    text("gps_source_squad"),
  // Veo stats sync (2026-08): which Veo club + team this league maps to. The
  // club slug + team slug drive the recordings listing
  // (/clubs/{club}/recordings/?filter=own&team={team}). Null = no Veo sync for
  // this league. See .agents/memory/veo-integration.md.
  veoClubSlug:  text("veo_club_slug"),
  veoTeamSlug:  text("veo_team_slug"),
  // Explicit subscription entitlement for the separate Veo RAS possession /
  // passing feed. False means the league's plan cannot produce these charts;
  // it must not be treated as a temporary per-match processing delay.
  veoAnalyticsEnabled: boolean("veo_analytics_enabled").notNull().default(true),
});

export const insertLeagueSchema = createInsertSchema(leaguesTable).omit({ id: true });
export type InsertLeague = z.infer<typeof insertLeagueSchema>;
export type League = typeof leaguesTable.$inferSelect;
