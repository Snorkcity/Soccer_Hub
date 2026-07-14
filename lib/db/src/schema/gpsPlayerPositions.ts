import { pgTable, text } from "drizzle-orm/pg-core";

/** Playing position for each GPS-logged player (keyed by the exact name used in gps_sessions). */
export const gpsPlayerPositionsTable = pgTable("gps_player_positions", {
  playerName: text("player_name").primaryKey(),
  position: text("position").notNull(), // GK | Defender | Midfielder | Forward
});

export type GpsPlayerPositionRow = typeof gpsPlayerPositionsTable.$inferSelect;
