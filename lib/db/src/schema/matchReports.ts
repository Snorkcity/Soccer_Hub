import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { leaguesTable } from "./leagues";
import { matchesTable } from "./matches";

/** Saved football match reports — the analyst's single-game review, frozen as saved. */
export const matchReportsTable = pgTable("match_reports", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id),
  /** Server-resolved owning club. Never accepted from the client. */
  club: text("club"),
  /** Exact Hub match identity. Older saved rows may be null until re-saved. */
  matchRowId: integer("match_row_id").references(() => matchesTable.id),
  title: text("title").notNull(), // e.g. "Match Report — R16 v Canberra Croatia"
  round: text("round"), // short round code, e.g. R16
  opponent: text("opponent"),
  matchDate: text("match_date"),
  /** The full computed report payload (header, tiles, goals, insights, form). */
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
