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

  // GPS identity merging (2026-07): duplicate GPS names (U17-/U18- eras, nicknames)
  // map to one canonical player. Raw gps_sessions rows stay untouched — the API
  // canonicalises player names on read. Mapping confirmed by the coach.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gps_player_aliases (
      alias text PRIMARY KEY,
      canonical text NOT NULL
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS player_identity_links (
      canonical text PRIMARY KEY,
      season_stats_name text NOT NULL
    )
  `);
  await db.execute(sql`
    INSERT INTO gps_player_aliases (alias, canonical) VALUES
      ('U17-Abbey','Abbey'),('U18-Abbey','Abbey'),
      ('U17-Arna','Arna'),('U18-Arna','Arna'),
      ('U17-Danijela','Danijela'),('Dani','Danijela'),
      ('U17-EDEN','Eden'),('Eden Rodda','Eden'),
      ('U17-Elfin','Elfin'),
      ('U17-Isla','Isla'),
      ('U17-Kristy','Kristy'),('U18-Kristy','Kristy'),
      ('U17-Lily','Lily'),('U18-Lily','Lily'),
      ('U17-Olive','Olive'),('U18-Olive','Olive'),
      ('U17-Sage','Sage'),
      ('U17-Sam','Sam'),
      ('U17-Sarah','Sarah'),
      ('Sienna','Siena'),('U17-Sienna','Siena'),
      ('U18-Talia','Talia'),
      ('U17-Tali','Tali'),
      ('U18-Tahli','Tahli'),
      ('U18-Emily','Emily.E'),
      ('Emily','Emily.H'),
      ('Matilde','Mati'),
      ('Izzy S','Issy.S'),
      ('Alyssa','DC'),
      ('Caitlin Koch','Caitlin')
    ON CONFLICT (alias) DO NOTHING
  `);
  await db.execute(sql`
    INSERT INTO player_identity_links (canonical, season_stats_name) VALUES
      ('Danijela','Dani'),
      ('Sam','Sammy'),
      ('Emily.H','Emily')
    ON CONFLICT (canonical) DO NOTHING
  `);
  // Re-key any positions saved under a raw alias onto the canonical name
  await db.execute(sql`
    INSERT INTO gps_player_positions (player_name, position)
    SELECT a.canonical, min(p.position)
    FROM gps_player_positions p
    JOIN gps_player_aliases a ON a.alias = p.player_name
    GROUP BY a.canonical
    ON CONFLICT (player_name) DO NOTHING
  `);
  await db.execute(sql`
    DELETE FROM gps_player_positions p
    USING gps_player_aliases a
    WHERE a.alias = p.player_name
  `);

  // Session-practice library (2026-07) — slides extracted from the coach's
  // master PowerPoint; content is loaded by lib/db/src/seedPractices.ts
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS practices (
      id serial PRIMARY KEY,
      ordinal integer NOT NULL UNIQUE,
      kind text NOT NULL,
      chapter text,
      section_code text,
      section_name text,
      title text,
      paras jsonb NOT NULL DEFAULT '[]'::jsonb,
      diagram jsonb NOT NULL,
      needs_review boolean NOT NULL DEFAULT false,
      source_file text,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  logger.info("Startup migrations applied");
}
