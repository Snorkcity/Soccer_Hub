import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { leaguesTable } from "./leagues";

/** Saved team GPS match reports — the Monday-after physical review per squad+round. */
export const gpsMatchReportsTable = pgTable("gps_match_reports", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id),
  title: text("title").notNull(), // e.g. "GPS Match Report — R16 v Canberra Croatia"
  round: text("round"), // raw round code, e.g. R16 / R5-res
  opponent: text("opponent"),
  matchDate: text("match_date"),
  /** The full computed report model (team summary, player table, insights, trend). */
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
