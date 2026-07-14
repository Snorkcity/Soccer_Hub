import { pgTable, serial, text, integer, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const gpsSessionsTable = pgTable("gps_sessions", {
  id: serial("id").primaryKey(),
  sessionDate: text("session_date"),
  sessionTitle: text("session_title"),
  playerName: text("player_name").notNull(),
  playerId: integer("player_id"),
  teamId: integer("team_id").notNull(),
  year: text("year").notNull(),
  round: text("round"),
  opponent: text("opponent"),
  splitName: text("split_name"),
  tags: text("tags"),
  minsPlayed: numeric("mins_played", { precision: 8, scale: 2 }),
  distanceKm: numeric("distance_km", { precision: 8, scale: 3 }),
  sprintDistanceM: numeric("sprint_distance_m", { precision: 8, scale: 2 }),
  powerPlays: numeric("power_plays", { precision: 8, scale: 2 }),
  energyKcal: numeric("energy_kcal", { precision: 8, scale: 2 }),
  impacts: numeric("impacts", { precision: 8, scale: 2 }),
  hrLoad: numeric("hr_load", { precision: 8, scale: 2 }),
  timeInRedZoneMin: numeric("time_in_red_zone_min", { precision: 8, scale: 2 }),
  playerLoad: numeric("player_load", { precision: 8, scale: 2 }),
  topSpeedMs: numeric("top_speed_ms", { precision: 6, scale: 3 }),
  distancePerMinMm: numeric("distance_per_min_mm", { precision: 8, scale: 2 }),
  powerScoreWkg: numeric("power_score_wkg", { precision: 8, scale: 3 }),
  workRatio: numeric("work_ratio", { precision: 8, scale: 4 }),
  hrMaxBpm: numeric("hr_max_bpm", { precision: 6, scale: 2 }),
  maxDecelerationMss: numeric("max_deceleration_mss", { precision: 6, scale: 3 }),
  maxAccelerationMss: numeric("max_acceleration_mss", { precision: 6, scale: 3 }),
  distanceZone1Km: numeric("distance_zone1_km", { precision: 8, scale: 3 }),
  distanceZone2Km: numeric("distance_zone2_km", { precision: 8, scale: 3 }),
  distanceZone3Km: numeric("distance_zone3_km", { precision: 8, scale: 3 }),
  distanceZone4Km: numeric("distance_zone4_km", { precision: 8, scale: 3 }),
  distanceZone5Km: numeric("distance_zone5_km", { precision: 8, scale: 3 }),
  accelCount34: numeric("accel_count_3_4", { precision: 8, scale: 2 }),
  accelCountOver4: numeric("accel_count_over_4", { precision: 8, scale: 2 }),
  decelCount34: numeric("decel_count_3_4", { precision: 8, scale: 2 }),
  decelCountOver4: numeric("decel_count_over_4", { precision: 8, scale: 2 }),
});

export const insertGpsSessionSchema = createInsertSchema(gpsSessionsTable).omit({ id: true });
export type InsertGpsSession = z.infer<typeof insertGpsSessionSchema>;
export type GpsSession = typeof gpsSessionsTable.$inferSelect;
