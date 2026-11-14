import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function migrateGpsTraining(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gps_training_sessions (
      id serial PRIMARY KEY,
      league_id integer NOT NULL REFERENCES leagues(id),
      club text NOT NULL,
      year text NOT NULL,
      session_date text NOT NULL,
      title text NOT NULL,
      source_filename text NOT NULL,
      source_hash text NOT NULL,
      version integer NOT NULL DEFAULT 1,
      planned_minutes double precision NOT NULL DEFAULT 90,
      scheduled_start_time text,
      allowances jsonb NOT NULL DEFAULT '[]'::jsonb,
      rows jsonb NOT NULL,
      warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS gps_training_session_scope_unique
    ON gps_training_sessions(league_id, club, year, session_date, title)
  `);
}
