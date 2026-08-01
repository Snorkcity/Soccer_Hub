import { integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { leaguesTable } from "./leagues";

/** Coach email list for the weekly GPS match report, per league + squad. */
export const gpsCoachEmailsTable = pgTable("gps_coach_emails", {
  id: serial("id").primaryKey(),
  leagueId: integer("league_id").notNull().references(() => leaguesTable.id),
  squad: text("squad").notNull(), // "1sts" | "Reserves" | "17s / 18s"
  name: text("name"), // optional label, e.g. "Assistant coach"
  email: text("email").notNull(),
});
