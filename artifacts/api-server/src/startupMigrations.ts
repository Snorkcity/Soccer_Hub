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

  logger.info("Startup migrations applied");
}
