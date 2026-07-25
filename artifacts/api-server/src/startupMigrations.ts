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

  // Session builder (2026-07, slice 2): sessions assembled from the library
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id serial PRIMARY KEY,
      title text NOT NULL DEFAULT '',
      session_date text,
      team text,
      session_number text,
      theme text,
      cycle_code text,
      location text,
      time_slot text,
      comments text,
      squad_text text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS session_practices (
      id serial PRIMARY KEY,
      session_id integer NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      part text NOT NULL,
      practice_id integer REFERENCES practices(id) ON DELETE SET NULL,
      rules text,
      tasks text,
      progressions text,
      coaching_points text,
      players text,
      size text,
      timing text,
      scoring text,
      intensity text,
      updated_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT session_practices_session_part_uq UNIQUE (session_id, part)
    )
  `);

  // Practice wording variations imported from old finished session plans (2026-07)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS practice_variations (
      id serial PRIMARY KEY,
      practice_id integer NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
      source_file text NOT NULL,
      session_date date,
      part text NOT NULL,
      rules text,
      tasks text,
      progressions text,
      coaching_points text,
      players text,
      size text,
      timing text,
      scoring text,
      intensity text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);

  // Reflection journal (2026-07): cycles + entries (cycle blocks & standalone reflections)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS journal_cycles (
      id serial PRIMARY KEY,
      title text NOT NULL,
      weeks_count integer NOT NULL DEFAULT 6,
      start_date text,
      notes text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id serial PRIMARY KEY,
      cycle_id integer REFERENCES journal_cycles(id) ON DELETE CASCADE,
      week_no integer,
      kind text NOT NULL,
      title text,
      entry_date text,
      source text NOT NULL DEFAULT 'manual',
      content jsonb NOT NULL DEFAULT '{}',
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_cycle_week_kind_uq
      ON journal_entries (cycle_id, week_no, kind)
      WHERE cycle_id IS NOT NULL
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS match_prep_reports (
      id serial PRIMARY KEY,
      kind text NOT NULL,
      title text NOT NULL,
      opponent text,
      match_date text,
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  // ── Coach Assistant curriculum knowledge base (2026-07) ──
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS curriculum_chunks (
      id text PRIMARY KEY,
      doc_title text NOT NULL,
      doc_type text NOT NULL,
      age_group text NOT NULL,
      heading text NOT NULL,
      heading_path text NOT NULL,
      content text NOT NULL,
      sort_order integer NOT NULL DEFAULT 0,
      embedding jsonb,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  // Practice embeddings for AI session generation (2026-07)
  await db.execute(sql`ALTER TABLE practices ADD COLUMN IF NOT EXISTS embedding jsonb`);
  await db.execute(sql`ALTER TABLE practices ADD COLUMN IF NOT EXISTS review_crop jsonb`);
  await db.execute(sql`ALTER TABLE practices ADD COLUMN IF NOT EXISTS review_part text`);
  await db.execute(sql`ALTER TABLE practices ADD COLUMN IF NOT EXISTS review_tags jsonb`);
  await db.execute(sql`ALTER TABLE practices ADD COLUMN IF NOT EXISTS reviewed_at timestamp`);

  await syncPracticeLibrary();
  await syncRounds();

  logger.info("Startup migrations applied");
}

/**
 * One-shot match-data sync: carries rounds entered in dev across to prod
 * (2026-07: rounds 14 & 15). Gated by a marker so it runs once per snapshot
 * version; skips any fixture whose match_id already exists this season, so
 * re-runs and already-entered data are never touched. Mirrors the Data Entry
 * dual-write rules: league tables always, legacy Belconnen tables when
 * Belconnen plays. Snapshot: lib/db/src/data/rounds-sync.json.
 */
const ROUNDS_SYNC_VERSION = "rounds-sync-v1-r14-r15";

async function syncRounds(): Promise<void> {
  const marker = await db.execute(
    sql`SELECT 1 FROM seed_markers WHERE key = ${ROUNDS_SYNC_VERSION}`,
  );
  if (marker.rows.length > 0) return;

  const fs = await import("node:fs");
  const path = await import("node:path");
  const candidates = [
    path.resolve(process.cwd(), "lib/db/src/data/rounds-sync.json"),
    path.resolve(process.cwd(), "../../lib/db/src/data/rounds-sync.json"),
  ];
  const file = candidates.find((c) => fs.existsSync(c));
  if (!file) {
    logger.warn({ candidates }, "rounds-sync.json not found — skipping rounds sync");
    return;
  }

  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as {
    leagueMatches: Array<{
      matchId: string; matchDate: string | null; homeTeam: string; awayTeam: string;
      homeGoals: number; awayGoals: number; halfScore: string | null;
    }>;
    belconnenExtras: Record<string, {
      venue: string | null; formation: string | null; oppFormation: string | null;
      conditions: string | null; possession: string | null; shots: number | null;
      passes: number | null; oppShots: number | null; oppPasses: number | null;
    }>;
    goals: Array<{
      matchId: string; scorerTeam: string; minuteScored: number | null; scorer: string | null;
      assist: string | null; goalType: string | null; assistType: string | null;
      howPenetrated: string | null; buildupLane: string | null; firstTimeFinish: boolean | null;
      finishType: string | null; passString: string | null; goalX: string | null; goalY: string | null;
    }>;
    playerStats: Array<{
      matchId: string; playerName: string; minsPlayed: number | null; position: string | null;
      discipline: string | null; started: boolean; appearance: boolean; club: string; year: string | null;
    }>;
  };

  // Anchor season/team on an existing fixture rather than hardcoded IDs
  // (IDs differ between the dev and prod databases).
  const anchor = await db.execute(sql`
    SELECT m.season_id, m.team_id
    FROM matches m
    JOIN seasons s ON s.id = m.season_id
    WHERE m.match_id = 'R13-BEL-MAJ' AND s.year = '2026'
  `);
  if (anchor.rows.length !== 1) {
    logger.warn(
      { found: anchor.rows.length },
      "rounds sync: expected exactly one 2026 anchor fixture R13-BEL-MAJ — skipping (will retry next boot)",
    );
    return;
  }
  const seasonId = Number(anchor.rows[0].season_id);
  const teamId = Number(anchor.rows[0].team_id);
  logger.info({ seasonId, teamId }, "rounds sync: resolved 2026 season/team anchor");
  const FOCUS = "Belconnen";

  let inserted = 0;
  for (const m of snap.leagueMatches) {
    const exists = await db.execute(
      sql`SELECT 1 FROM league_matches WHERE match_id = ${m.matchId} AND season_id = ${seasonId}`,
    );
    if (exists.rows.length > 0) continue; // already entered — leave untouched

    const fullScore = `${m.homeGoals}-${m.awayGoals}`;
    const isHome = m.homeTeam === FOCUS;
    const isAway = m.awayTeam === FOCUS;
    const goals = snap.goals.filter((g) => g.matchId === m.matchId);
    const players = snap.playerStats.filter((p) => p.matchId === m.matchId);

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        INSERT INTO league_matches (match_id, match_date, home_team, away_team, full_score, half_score, home_goals, away_goals, season_id)
        VALUES (${m.matchId}, ${m.matchDate}, ${m.homeTeam}, ${m.awayTeam}, ${fullScore}, ${m.halfScore}, ${m.homeGoals}, ${m.awayGoals}, ${seasonId})
      `);

      let belMatchId: number | null = null;
      if (isHome || isAway) {
        const x = snap.belconnenExtras[m.matchId] ?? {
          venue: null, formation: null, oppFormation: null, conditions: null,
          possession: null, shots: null, passes: null, oppShots: null, oppPasses: null,
        };
        const scored = isHome ? m.homeGoals : m.awayGoals;
        const conceded = isHome ? m.awayGoals : m.homeGoals;
        const res = await tx.execute(sql`
          INSERT INTO matches (match_id, match_date, venue, opponent, half_score, full_score, goals_scored, goals_conceded,
            clean_sheet, formation, opp_formation, conditions, possession, shots, passes, opp_shots, opp_passes, team_id, season_id)
          VALUES (${m.matchId}, ${m.matchDate}, ${x.venue}, ${isHome ? m.awayTeam : m.homeTeam}, ${m.halfScore}, ${fullScore},
            ${scored}, ${conceded}, ${conceded === 0}, ${x.formation}, ${x.oppFormation}, ${x.conditions}, ${x.possession},
            ${x.shots}, ${x.passes}, ${x.oppShots}, ${x.oppPasses}, ${teamId}, ${seasonId})
          RETURNING id
        `);
        belMatchId = Number(res.rows[0].id);
      }

      for (const g of goals) {
        await tx.execute(sql`
          INSERT INTO league_goals (match_id, match_date, home_team, away_team, scorer_team, minute_scored, scorer, assist,
            goal_type, assist_type, how_penetrated, buildup_lane, first_time_finish, finish_type, pass_string, goal_x, goal_y, season_id)
          VALUES (${m.matchId}, ${m.matchDate}, ${m.homeTeam}, ${m.awayTeam}, ${g.scorerTeam}, ${g.minuteScored}, ${g.scorer}, ${g.assist},
            ${g.goalType}, ${g.assistType}, ${g.howPenetrated}, ${g.buildupLane}, ${g.firstTimeFinish}, ${g.finishType}, ${g.passString},
            ${g.goalX}, ${g.goalY}, ${seasonId})
        `);
        if (belMatchId != null) {
          await tx.execute(sql`
            INSERT INTO goals (match_id, match_date, home_team, away_team, scorer_team, minute_scored, scorer, assist,
              goal_type, assist_type, how_penetrated, buildup_lane, first_time_finish, finish_type, pass_string, goal_x, goal_y, team_id, season_id)
            VALUES (${belMatchId}, ${m.matchDate}, ${m.homeTeam}, ${m.awayTeam}, ${g.scorerTeam}, ${g.minuteScored}, ${g.scorer}, ${g.assist},
              ${g.goalType}, ${g.assistType}, ${g.howPenetrated}, ${g.buildupLane}, ${g.firstTimeFinish}, ${g.finishType}, ${g.passString},
              ${g.goalX}, ${g.goalY}, ${teamId}, ${seasonId})
          `);
        }
      }

      for (const p of players) {
        await tx.execute(sql`
          INSERT INTO league_player_stats (match_id, player_name, mins_played, position, discipline, started, appearance, country, year, season_id)
          VALUES (${m.matchId}, ${p.playerName}, ${p.minsPlayed}, ${p.position}, ${p.discipline}, ${p.started}, ${p.appearance}, ${p.club}, ${p.year}, ${seasonId})
        `);
        if (belMatchId != null) {
          const found = await tx.execute(
            sql`SELECT id FROM players WHERE name = ${p.playerName} AND country = ${p.club} LIMIT 1`,
          );
          let playerId: number;
          if (found.rows.length > 0) {
            playerId = Number(found.rows[0].id);
          } else {
            const created = await tx.execute(sql`
              INSERT INTO players (name, position, country) VALUES (${p.playerName}, ${p.position}, ${p.club}) RETURNING id
            `);
            playerId = Number(created.rows[0].id);
          }
          await tx.execute(sql`
            INSERT INTO player_stats (match_id, player_id, player_name, mins_played, position, discipline, started, appearance, country, year)
            VALUES (${belMatchId}, ${playerId}, ${p.playerName}, ${p.minsPlayed}, ${p.position}, ${p.discipline}, ${p.started}, ${p.appearance}, ${p.club}, ${p.year})
          `);
        }
      }
    });
    inserted++;
  }

  await db.execute(sql`INSERT INTO seed_markers (key) VALUES (${ROUNDS_SYNC_VERSION}) ON CONFLICT DO NOTHING`);
  logger.info({ inserted, total: snap.leagueMatches.length }, "Rounds sync complete");
}

/**
 * One-shot data sync: loads the practice-library snapshot (all practices,
 * incl. the ones created from imported old plans, plus all past write-up
 * variations) into the database. Gated by a marker so it runs exactly once
 * per snapshot version; bump SYNC_VERSION after regenerating the snapshot.
 *
 * Regenerate the snapshot from the dev DB (see .agents/memory/plan-import.md):
 * it lives at lib/db/src/data/library-sync.json.
 */
const SYNC_VERSION = "library-sync-v1";

async function syncPracticeLibrary(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS seed_markers (
      key text PRIMARY KEY,
      applied_at timestamp NOT NULL DEFAULT now()
    )
  `);
  const marker = await db.execute(
    sql`SELECT 1 FROM seed_markers WHERE key = ${SYNC_VERSION}`,
  );
  if (marker.rows.length > 0) return;

  const fs = await import("node:fs");
  const path = await import("node:path");
  const candidates = [
    path.resolve(process.cwd(), "lib/db/src/data/library-sync.json"),
    path.resolve(process.cwd(), "../../lib/db/src/data/library-sync.json"),
  ];
  const file = candidates.find((c) => fs.existsSync(c));
  if (!file) {
    logger.warn({ candidates }, "library-sync.json not found — skipping practice-library sync");
    return;
  }

  logger.info({ file }, "Syncing practice library from snapshot...");
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as {
    practices: Array<{
      ordinal: number;
      kind: string;
      chapter: string | null;
      sectionCode: string | null;
      sectionName: string | null;
      title: string | null;
      paras: unknown;
      diagram: unknown;
      sourceFile: string | null;
    }>;
    variations: Array<{
      practiceOrdinal: number;
      sourceFile: string;
      sessionDate: string | null;
      part: string;
      rules: string | null;
      tasks: string | null;
      progressions: string | null;
      coachingPoints: string | null;
      players: string | null;
      size: string | null;
      timing: string | null;
      scoring: string | null;
      intensity: string | null;
    }>;
  };

  // Upsert practices by ordinal; content updates but coach-set needs_review is
  // preserved. Batched via jsonb_to_recordset — row-at-a-time was too slow and
  // blew the deploy health check (the server only listens after migrations).
  const PRACTICE_BATCH = 50;
  for (let i = 0; i < snap.practices.length; i += PRACTICE_BATCH) {
    const chunk = snap.practices.slice(i, i + PRACTICE_BATCH);
    await db.execute(sql`
      INSERT INTO practices (ordinal, kind, chapter, section_code, section_name, title, paras, diagram, source_file)
      SELECT r.ordinal, r.kind, r.chapter, r."sectionCode", r."sectionName", r.title, r.paras, r.diagram, r."sourceFile"
      FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS r(
        ordinal integer, kind text, chapter text, "sectionCode" text, "sectionName" text,
        title text, paras jsonb, diagram jsonb, "sourceFile" text)
      ON CONFLICT (ordinal) DO UPDATE SET
        kind = EXCLUDED.kind,
        chapter = EXCLUDED.chapter,
        section_code = EXCLUDED.section_code,
        section_name = EXCLUDED.section_name,
        title = EXCLUDED.title,
        paras = EXCLUDED.paras,
        diagram = EXCLUDED.diagram,
        source_file = EXCLUDED.source_file,
        updated_at = now()
    `);
  }

  // Variations: full replace (snapshot is the source of truth for imports).
  await db.execute(sql`DELETE FROM practice_variations`);
  const VARIATION_BATCH = 200;
  for (let i = 0; i < snap.variations.length; i += VARIATION_BATCH) {
    const chunk = snap.variations.slice(i, i + VARIATION_BATCH);
    await db.execute(sql`
      INSERT INTO practice_variations
        (practice_id, source_file, session_date, part, rules, tasks, progressions,
         coaching_points, players, size, timing, scoring, intensity)
      SELECT p.id, r."sourceFile", r."sessionDate"::date, r.part, r.rules, r.tasks, r.progressions,
             r."coachingPoints", r.players, r.size, r.timing, r.scoring, r.intensity
      FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS r(
        "practiceOrdinal" integer, "sourceFile" text, "sessionDate" text, part text,
        rules text, tasks text, progressions text, "coachingPoints" text,
        players text, size text, timing text, scoring text, intensity text)
      JOIN practices p ON p.ordinal = r."practiceOrdinal"
    `);
  }

  await db.execute(sql`INSERT INTO seed_markers (key) VALUES (${SYNC_VERSION}) ON CONFLICT DO NOTHING`);
  logger.info(
    { practices: snap.practices.length, variations: snap.variations.length },
    "Practice library sync complete",
  );
}
