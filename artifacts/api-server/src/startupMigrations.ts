import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./lib/logger";

/**
 * Idempotent schema upgrades that run on every boot, so deploying new code
 * automatically brings the production database up to date. Every statement
 * must be safe to re-run (IF NOT EXISTS / conditional backfills only).
 */
export async function runStartupMigrations(): Promise<void> {
  // ── League layer (2026-07): leagues table + league_id on seasons/clubs ──
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS leagues (
      id serial PRIMARY KEY,
      name text NOT NULL UNIQUE,
      region text
    )
  `);
  await db.execute(sql`
    INSERT INTO leagues (name, region) VALUES ('ACT NPLW', 'ACT')
    ON CONFLICT (name) DO NOTHING
  `);
  await db.execute(sql`ALTER TABLE seasons ADD COLUMN IF NOT EXISTS league_id integer REFERENCES leagues(id)`);
  await db.execute(sql`
    UPDATE seasons SET league_id = (SELECT id FROM leagues WHERE name = 'ACT NPLW')
    WHERE league_id IS NULL
  `);
  await db.execute(sql`ALTER TABLE seasons ALTER COLUMN league_id SET NOT NULL`);
  await db.execute(sql`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS league_id integer REFERENCES leagues(id)`);
  await db.execute(sql`
    UPDATE clubs SET league_id = (SELECT id FROM leagues WHERE name = 'ACT NPLW')
    WHERE league_id IS NULL
  `);
  await db.execute(sql`ALTER TABLE clubs ALTER COLUMN league_id SET NOT NULL`);

  // Club names are unique per league (same club name can exist in two leagues)
  await db.execute(sql`ALTER TABLE clubs DROP CONSTRAINT IF EXISTS clubs_name_unique`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS clubs_league_name_unique ON clubs (league_id, name)`);

  // At most one active season per league, enforced by the database
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS seasons_one_active_per_league ON seasons (league_id) WHERE is_active`);

  // Half-time score tracked league-wide (2026-07); backfill Belconnen games from the legacy matches table
  await db.execute(sql`ALTER TABLE league_matches ADD COLUMN IF NOT EXISTS half_score text`);
  await db.execute(sql`
    UPDATE league_matches lm SET half_score = m.half_score
    FROM matches m
    WHERE lm.match_id = m.match_id AND lm.half_score IS NULL AND m.half_score IS NOT NULL
  `);

  // Teams are referred to by their in-league club name (2026-07 rename)
  await db.execute(sql`UPDATE teams SET name = 'Belconnen' WHERE name = 'BUFC NPLW 1sts'`);

  // Accel/decel zone counts (>3 m/s²) added 2026-07; backfilled from GPS CSVs via lib/db backfill script
  await db.execute(sql`ALTER TABLE gps_sessions ADD COLUMN IF NOT EXISTS accel_count_3_4 numeric(8,2)`);
  await db.execute(sql`ALTER TABLE gps_sessions ADD COLUMN IF NOT EXISTS accel_count_over_4 numeric(8,2)`);
  await db.execute(sql`ALTER TABLE gps_sessions ADD COLUMN IF NOT EXISTS decel_count_3_4 numeric(8,2)`);
  await db.execute(sql`ALTER TABLE gps_sessions ADD COLUMN IF NOT EXISTS decel_count_over_4 numeric(8,2)`);

  // Player positions for GPS players (2026-07) — drives position-specific averages in reports
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gps_player_positions (
      player_name text PRIMARY KEY,
      position text NOT NULL
    )
  `);

  logger.info("Startup migrations applied");
}
