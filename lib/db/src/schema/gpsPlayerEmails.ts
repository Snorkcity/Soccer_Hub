import { pgTable, text } from "drizzle-orm/pg-core";

// Email address per CANONICAL GPS player name (same keying as
// gps_player_positions after the alias rekey). Global identity table — no
// league scoping, matching positions/aliases. These are mostly minors'
// addresses: the API restricts reads to admins.
export const gpsPlayerEmailsTable = pgTable("gps_player_emails", {
  playerName: text("player_name").primaryKey(),
  email: text("email").notNull(),
});
