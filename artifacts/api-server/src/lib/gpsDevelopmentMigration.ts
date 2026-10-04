import { db, gpsDevelopmentReferencesTable } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function migrateGpsDevelopment(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gps_development_feedback (
      id serial PRIMARY KEY, league_id integer NOT NULL REFERENCES leagues(id),
      club text NOT NULL, player_name text NOT NULL, year text NOT NULL,
      note text NOT NULL, focus text NOT NULL, review_date text,
      snapshot jsonb NOT NULL, created_by integer,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS gps_development_feedback_scope ON gps_development_feedback (league_id,club,player_name)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gps_development_context (
      id serial PRIMARY KEY, league_id integer NOT NULL REFERENCES leagues(id),
      club text NOT NULL, player_name text NOT NULL, year text NOT NULL, round text NOT NULL,
      role text, match_type text NOT NULL, comparable boolean NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS gps_development_context_unique ON gps_development_context (league_id,club,player_name,year,round)`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS gps_development_references (id text PRIMARY KEY,population text NOT NULL,data jsonb NOT NULL)`);
  // Transcribed from the coach's supplied methodology, not activated targets.
  // These pooled adult-male TD values do not assert identical match exposure.
  const refs = [
    ["CB", 9598], ["FB", 10457], ["DM", 11012], ["B2B", 11012], ["AM", 11012],
    ["Winger", 10894], ["9", 10068],
  ] as const;
  for (const [role, value] of refs) {
    const id = `adult-male-pooled-td-${role}`;
    await db.insert(gpsDevelopmentReferencesTable).values({ id, population: "adult-male", data: {
      id, source: "Playing position scoping review (2024)", url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC11561100/",
      publicationYear: 2024, population: "Highly trained to world-class adult male players",
      role, metric: "td", value, threshold: "Total distance; speed-zone thresholds varied across studies",
      referenceType: "Pooled review — not Gref", comparability: "contextual only",
      sampleNote: "Review of 178 studies; pooled position groups, not a BUFC population",
      device: "Mixed tracking methods across included studies",
      confidenceNote: "Transcribed from the coach-supplied methodology. Context only, not a selection target or a like-for-like 60-minute comparison. Central-midfield grouping is shared by 6, 8 and 10.",
    } }).onConflictDoNothing();
  }
}