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

  // Per-league focus club (2026-07): the club whose players fill the Team/Player
  // Insights tabs. Backfill the known leagues; new leagues can be set later.
  await db.execute(sql`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS focus_club text`);
  await db.execute(sql`UPDATE leagues SET focus_club = 'Belconnen' WHERE name = 'ACT NPLW' AND focus_club IS NULL`);
  // Reserves league renamed + plain club names (2026-07, per coach): league is
  // "ACT NPLW Reserves", season label matches firsts convention, focus club is
  // the display name "Belconnen".
  await db.execute(sql`UPDATE leagues SET name = 'ACT NPLW Reserves', focus_club = 'Belconnen' WHERE name = 'ACT NPLW Reserve'`);
  await db.execute(sql`UPDATE leagues SET focus_club = 'Belconnen' WHERE name = 'ACT NPLW Reserves' AND (focus_club IS NULL OR focus_club = 'BelReserves')`);
  await db.execute(sql`UPDATE seasons SET label = '2026 Season' WHERE label = 'ACT NPLW Reserve 2026'`);
  // Men's league renamed too (per coach): "ACT NPLM · 2026 Season"
  await db.execute(sql`UPDATE leagues SET name = 'ACT NPLM' WHERE name = 'ACT NPL Men'`);
  await db.execute(sql`UPDATE seasons SET label = '2026 Season' WHERE label = 'ACT NPL Men 2026'`);

  // Club names are unique per league (same club name can exist in two leagues)
  await db.execute(sql`ALTER TABLE clubs DROP CONSTRAINT IF EXISTS clubs_name_unique`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS clubs_league_name_unique ON clubs (league_id, name)`);

  // At most one active season per league, enforced by the database
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS seasons_one_active_per_league ON seasons (league_id) WHERE is_active`);

  // ── User accounts (2026-07): real logins replace the shared club password ──
  await runUserAccountsMigration();

  // Per-league module tick-boxes (2026-07): user_league_access.modules lists the
  // pages a user may use in that league. Backfill from the legacy role: admins
  // get everything, viewers everything except data entry.
  await db.execute(sql`ALTER TABLE user_league_access ADD COLUMN IF NOT EXISTS modules jsonb NOT NULL DEFAULT '[]'::jsonb`);
  await db.execute(sql`UPDATE user_league_access SET modules = '["season-stats","gps","testing","match-prep","reflections","data-entry"]'::jsonb WHERE modules = '[]'::jsonb AND role = 'admin'`);
  await db.execute(sql`UPDATE user_league_access SET modules = '["season-stats","gps","testing","match-prep","reflections"]'::jsonb WHERE modules = '[]'::jsonb AND role = 'viewer'`);

  // Per-user club (2026-07): a person's own club within a league — Team/Player
  // insights centre on it. NULL falls back to the league's focus_club.
  await db.execute(sql`ALTER TABLE user_league_access ADD COLUMN IF NOT EXISTS club text`);

  // Shared-login alert cooldown (2026-07): when a "possible shared login"
  // email was last sent about this account.
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS shared_alert_at timestamp`);
  // Shared-login acknowledgement (2026-07): superadmin marked the account as
  // "expected to look shared" — suppresses alert emails and softens the badge.
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS shared_ok boolean NOT NULL DEFAULT false`);


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
      ('U18-Emily','Emily.E'),('U18-Emily Evans','Emily.E'),
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

  // Player report emails (2026-08) — one address per canonical GPS player,
  // used to bulk-email personalised GPS reports. Admin-only reads at the API.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gps_player_emails (
      player_name text PRIMARY KEY,
      email text NOT NULL
    )
  `);

  // Team GPS match reports (2026-08) — saved Monday-after physical reviews,
  // plus the per-squad coach email list they get sent to.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gps_match_reports (
      id serial PRIMARY KEY,
      league_id integer NOT NULL REFERENCES leagues(id),
      title text NOT NULL,
      round text,
      opponent text,
      match_date text,
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  // Football match reports (2026-08) — saved analyst single-game reviews,
  // same shape as gps_match_reports but for the football (results) data.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS match_reports (
      id serial PRIMARY KEY,
      league_id integer NOT NULL REFERENCES leagues(id),
      title text NOT NULL,
      round text,
      opponent text,
      match_date text,
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS gps_coach_emails (
      id serial PRIMARY KEY,
      league_id integer NOT NULL REFERENCES leagues(id),
      squad text NOT NULL,
      name text,
      email text NOT NULL
    )
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

  // ── League-private coaching data (2026-07, per coach): Match Prep, Reflections,
  // GPS and Testing rows belong to ONE league; everything saved before this
  // migration was NPLW firsts data.
  for (const table of ["match_prep_reports", "journal_cycles", "journal_entries", "gps_sessions", "athletic_tests"]) {
    await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS league_id integer REFERENCES leagues(id)`));
    await db.execute(sql.raw(`UPDATE ${table} SET league_id = (SELECT id FROM leagues WHERE name = 'ACT NPLW') WHERE league_id IS NULL`));
    await db.execute(sql.raw(`ALTER TABLE ${table} ALTER COLUMN league_id SET NOT NULL`));
  }
  // Cycle entries always inherit their cycle's league
  await db.execute(sql`
    UPDATE journal_entries e SET league_id = c.league_id
    FROM journal_cycles c
    WHERE e.cycle_id = c.id AND e.league_id <> c.league_id
  `);

  // ── Dribl name map (2026-07): permanent full-name → display-name mapping so
  // same-initial teammates keep stable display names across syncs.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS dribl_name_map (
      id serial PRIMARY KEY,
      season_id integer NOT NULL,
      club text NOT NULL,
      full_name text NOT NULL,
      display_name text NOT NULL
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS dribl_name_map_unique ON dribl_name_map (season_id, club, full_name)`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS dribl_name_map_display_unique ON dribl_name_map (season_id, club, display_name)`);

  // ── Dribl no-lineup markers (2026-07): remember games where Dribl never
  // published a team sheet so weekly re-syncs stop re-fetching them forever.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS dribl_no_lineup (
      id serial PRIMARY KEY,
      season_id integer NOT NULL,
      match_id text NOT NULL,
      club text NOT NULL,
      checked_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS dribl_no_lineup_unique ON dribl_no_lineup (season_id, match_id, club)`);

  // ── Paid add-ons become tick boxes (2026-07): Session Planner (+ Library)
  // and Coach Assistant were open to every signed-in user — grant them once to
  // every existing league access row so nobody loses anything, then the coach
  // unticks whoever shouldn't have them. One-shot: later unticks must stick.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS seed_markers (
      key text PRIMARY KEY,
      applied_at timestamp NOT NULL DEFAULT now()
    )
  `);
  const addonMarker = await db.execute(sql`SELECT 1 FROM seed_markers WHERE key = 'addon-modules-grant-v1'`);
  if (addonMarker.rows.length === 0) {
    await db.execute(sql`
      UPDATE user_league_access
      SET modules = (
        SELECT jsonb_agg(DISTINCT m)
        FROM jsonb_array_elements(modules || '["session-planner", "assistant"]'::jsonb) AS m
      )
      WHERE NOT (modules @> '["session-planner"]'::jsonb AND modules @> '["assistant"]'::jsonb)
    `);
    await db.execute(sql`INSERT INTO seed_markers (key) VALUES ('addon-modules-grant-v1') ON CONFLICT DO NOTHING`);
  }

  // ── ACT NPLM 2026 (2026-07, per coach) ─────────────────────────────────────
  // Men's league starting fresh. Player naming convention differs from NPLW:
  // "S.Smith" (first-initial + surname) instead of surname-only — recorded per
  // league in leagues.name_format and used by the screenshot reader.
  await db.execute(sql`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS name_format text`);
  // Coach standard (2026-07): "S.Smith" everywhere going forward. Only the two
  // NPLW leagues keep surname-only, matching their already-entered 2026 data.
  await db.execute(sql`UPDATE leagues SET name_format = 'surname' WHERE name IN ('ACT NPLW', 'ACT NPLW Reserves') AND name_format IS NULL`);
  await db.execute(sql`
    INSERT INTO leagues (name, region, focus_club, name_format)
    VALUES ('ACT NPLM', 'ACT', 'Belconnen', 'initial-surname')
    ON CONFLICT (name) DO UPDATE SET name_format = EXCLUDED.name_format WHERE leagues.name_format IS NULL
  `);
  await db.execute(sql`
    INSERT INTO seasons (year, label, is_active, league_id)
    -- Active only when the league has no active season yet, so the partial
    -- unique index seasons_one_active_per_league can never abort boot.
    SELECT '2026', '2026 Season',
           NOT EXISTS (SELECT 1 FROM seasons a WHERE a.league_id = l.id AND a.is_active),
           l.id
    FROM leagues l
    WHERE l.name = 'ACT NPLM'
      AND NOT EXISTS (SELECT 1 FROM seasons s WHERE s.league_id = l.id AND s.year = '2026')
  `);

  // ── Reserves GPS feed (2026-08, per coach): the NPLW GPS uploads already
  // contain the reserves squad's rows ("R7-res"). Instead of double entry, a
  // league can point at a source league + squad and read those rows at request
  // time — no rows are copied. One-shot seed so a later manual unset sticks.
  await db.execute(sql`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS gps_source_league_id integer REFERENCES leagues(id)`);
  await db.execute(sql`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS gps_source_squad text`);
  const gpsFeedMarker = await db.execute(sql`SELECT 1 FROM seed_markers WHERE key = 'gps-feed-reserves-v1'`);
  if (gpsFeedMarker.rows.length === 0) {
    await db.execute(sql`
      UPDATE leagues SET
        gps_source_league_id = (SELECT id FROM leagues WHERE name = 'ACT NPLW'),
        gps_source_squad = 'Reserves'
      WHERE name = 'ACT NPLW Reserves' AND gps_source_league_id IS NULL
    `);
    await db.execute(sql`INSERT INTO seed_markers (key) VALUES ('gps-feed-reserves-v1') ON CONFLICT DO NOTHING`);
  }

  // ── Goal-coding vocabulary (2026-08): the Goals-tab dropdown lists become
  // editable in League Setup. Global (one house standard across leagues); one
  // row per field, ordered string[] in jsonb. Seed from the coach's Aug 2026
  // spreadsheet vocab; ON CONFLICT keeps any later edits.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS goal_vocab (
      field text PRIMARY KEY,
      options jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    INSERT INTO goal_vocab (field, options) VALUES
      ('goalTypes', '["R-FT-DT","R-FT-AT","R-MT-DT","R-MT-AT","R-BT-DT","R-BT-AT","SP-P","SP-C","SP-T","SP-F"]'::jsonb),
      ('assistTypes', '["Inswinger","Outswinger","Buildup","Cross","Cutback","Through ball","Pass","Error","Shot","Counter"]'::jsonb),
      ('howPenetrated', '["Through","Around","Over"]'::jsonb),
      ('buildupLanes', '["Left","Centre","Right"]'::jsonb),
      ('finishTypes', '["Right Foot","Left Foot","Head"]'::jsonb)
    ON CONFLICT (field) DO NOTHING
  `);

  // ── Goal "Source" field (2026-08): how the attack started (Buildup/Counter/
  // Press) moves out of assist type into its own column + vocab list. Old goals
  // coded with those assist types are re-filed into source (idempotent).
  await db.execute(sql`ALTER TABLE goals ADD COLUMN IF NOT EXISTS source text`);
  await db.execute(sql`ALTER TABLE league_goals ADD COLUMN IF NOT EXISTS source text`);
  await db.execute(sql`
    INSERT INTO goal_vocab (field, options) VALUES
      ('sources', '["Buildup","Counter","Press","Direct"]'::jsonb)
    ON CONFLICT (field) DO NOTHING
  `);
  await db.execute(sql`
    UPDATE goal_vocab SET options = (options - 'Buildup') - 'Counter', updated_at = now()
    WHERE field = 'assistTypes' AND (options ? 'Buildup' OR options ? 'Counter')
  `);
  await db.execute(sql`
    UPDATE goals SET source = assist_type, assist_type = NULL
    WHERE assist_type IN ('Buildup', 'Counter', 'Press') AND source IS NULL
  `);
  await db.execute(sql`
    UPDATE league_goals SET source = assist_type, assist_type = NULL
    WHERE assist_type IN ('Buildup', 'Counter', 'Press') AND source IS NULL
  `);

  await syncPracticeLibrary();
  await syncRounds();
  await syncPlayerSheets();
  await syncJournalEntries();
  await backfillSavedNames();

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
 * One-shot player-sheet top-up: adds club sheets from the rounds snapshot to
 * fixtures that already exist but have NO rows yet for that match+club (e.g.
 * the Belconnen sheet for R15-BEL-CRO added after rounds-sync-v1 shipped).
 * Never touches a match+club that already has any rows. Marker-gated.
 */
const PLAYER_SHEETS_SYNC_VERSION = "player-sheets-sync-v2";

async function syncPlayerSheets(): Promise<void> {
  const marker = await db.execute(
    sql`SELECT 1 FROM seed_markers WHERE key = ${PLAYER_SHEETS_SYNC_VERSION}`,
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
    logger.warn({ candidates }, "rounds-sync.json not found — skipping player-sheets sync");
    return;
  }
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as {
    playerStats: Array<{
      matchId: string; playerName: string; minsPlayed: number | null; position: string | null;
      discipline: string | null; started: boolean; appearance: boolean; club: string; year: string | null;
    }>;
  };

  const anchor = await db.execute(sql`
    SELECT m.season_id, m.team_id
    FROM matches m
    JOIN seasons s ON s.id = m.season_id
    WHERE m.match_id = 'R13-BEL-MAJ' AND s.year = '2026'
  `);
  if (anchor.rows.length !== 1) {
    logger.warn({ found: anchor.rows.length }, "player-sheets sync: no unique 2026 anchor — skipping (will retry next boot)");
    return;
  }
  const seasonId = Number(anchor.rows[0].season_id);
  const teamId = Number(anchor.rows[0].team_id);

  // Group snapshot rows by match+club
  const sheets = new Map<string, typeof snap.playerStats>();
  for (const p of snap.playerStats) {
    const key = `${p.matchId}\u0000${p.club}`;
    const arr = sheets.get(key) ?? [];
    arr.push(p);
    sheets.set(key, arr);
  }

  let added = 0;
  for (const [key, rows] of sheets) {
    const [matchId, club] = key.split("\u0000");
    const fixture = await db.execute(
      sql`SELECT home_team, away_team FROM league_matches WHERE match_id = ${matchId} AND season_id = ${seasonId}`,
    );
    if (fixture.rows.length !== 1) continue; // fixture not in this DB — nothing to top up
    const existing = await db.execute(sql`
      SELECT 1 FROM league_player_stats
      WHERE match_id = ${matchId} AND season_id = ${seasonId} AND country = ${club} LIMIT 1
    `);
    if (existing.rows.length > 0) continue; // sheet already present — leave untouched

    const isBelconnenGame =
      fixture.rows[0].home_team === "Belconnen" || fixture.rows[0].away_team === "Belconnen";

    await db.transaction(async (tx) => {
      let belMatchId: number | null = null;
      if (isBelconnenGame) {
        const bel = await tx.execute(sql`
          SELECT id FROM matches WHERE match_id = ${matchId} AND season_id = ${seasonId} AND team_id = ${teamId}
        `);
        belMatchId = bel.rows.length === 1 ? Number(bel.rows[0].id) : null;
      }
      for (const p of rows) {
        await tx.execute(sql`
          INSERT INTO league_player_stats (match_id, player_name, mins_played, position, discipline, started, appearance, country, year, season_id)
          VALUES (${matchId}, ${p.playerName}, ${p.minsPlayed}, ${p.position}, ${p.discipline}, ${p.started}, ${p.appearance}, ${p.club}, ${p.year}, ${seasonId})
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
    added++;
  }

  await db.execute(sql`INSERT INTO seed_markers (key) VALUES (${PLAYER_SHEETS_SYNC_VERSION}) ON CONFLICT DO NOTHING`);
  logger.info({ sheetsAdded: added }, "Player-sheets sync complete");
}

/**
 * One-shot journal carry-over: copies standalone reflections written in dev
 * (2026-07) into prod. Add-only: an entry is skipped when one with the same
 * kind + entry_date + title already exists, so anything entered in prod is
 * never duplicated or touched. Snapshot: lib/db/src/data/journal-sync.json.
 */
const JOURNAL_SYNC_VERSION = "journal-sync-v1";

async function syncJournalEntries(): Promise<void> {
  const marker = await db.execute(
    sql`SELECT 1 FROM seed_markers WHERE key = ${JOURNAL_SYNC_VERSION}`,
  );
  if (marker.rows.length > 0) return;

  const fs = await import("node:fs");
  const path = await import("node:path");
  const candidates = [
    path.resolve(process.cwd(), "lib/db/src/data/journal-sync.json"),
    path.resolve(process.cwd(), "../../lib/db/src/data/journal-sync.json"),
  ];
  const file = candidates.find((c) => fs.existsSync(c));
  if (!file) {
    logger.warn({ candidates }, "journal-sync.json not found — skipping journal sync");
    return;
  }
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as {
    entries: Array<{
      kind: string; title: string | null; entry_date: string | null; source: string | null;
      content: unknown; created_at: string; updated_at: string;
    }>;
  };

  let added = 0;
  for (const e of snap.entries) {
    const dup = await db.execute(sql`
      SELECT 1 FROM journal_entries
      WHERE cycle_id IS NULL
        AND kind = ${e.kind}
        AND entry_date IS NOT DISTINCT FROM ${e.entry_date}
        AND title IS NOT DISTINCT FROM ${e.title}
      LIMIT 1
    `);
    if (dup.rows.length > 0) continue;
    await db.execute(sql`
      INSERT INTO journal_entries (league_id, kind, title, entry_date, source, content, created_at, updated_at)
      VALUES ((SELECT id FROM leagues WHERE name = 'ACT NPLW'), ${e.kind}, ${e.title}, ${e.entry_date}, ${e.source}, ${JSON.stringify(e.content)}::jsonb,
        ${e.created_at}::timestamp, ${e.updated_at}::timestamp)
    `);
    added++;
  }

  await db.execute(sql`INSERT INTO seed_markers (key) VALUES (${JOURNAL_SYNC_VERSION}) ON CONFLICT DO NOTHING`);
  logger.info({ added, total: snap.entries.length }, "Journal sync complete");
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

/**
 * One-shot rename (2026-07): brings pre-standard saved reflections and Week
 * Ahead briefings in line with the agreed saved-name style
 * ("Type — R# v Opponent / weekday" + structured round/matchDate).
 * Titles/metadata only — content and saved timestamps are never touched, and
 * coach-typed custom titles are left alone (only NULL/empty titles or
 * machine-generated legacy patterns like "R15-Croatia" / underscore names
 * are rewritten).
 */
const SAVED_NAMES_VERSION = "saved-names-backfill-v1";

async function backfillSavedNames(): Promise<void> {
  const marker = await db.execute(
    sql`SELECT 1 FROM seed_markers WHERE key = ${SAVED_NAMES_VERSION}`,
  );
  if (marker.rows.length > 0) return;

  // ── Standalone training reflections: "Training Reflection — <weekday>" ──
  const training = await db.execute(sql`
    UPDATE journal_entries
    SET title = 'Training Reflection — ' || trim(to_char(to_date(entry_date, 'DD.MM.YYYY'), 'Day'))
    WHERE cycle_id IS NULL
      AND kind = 'session_reflection'
      AND entry_date ~ '^\\d{2}\\.\\d{2}\\.\\d{4}$'
      AND (title IS NULL OR title = '' OR title LIKE '%\\_%' ESCAPE '\\' OR title ~ '^R\\d+')
  `);

  // ── Standalone match reflections: "Match Reflection — R# v Opponent" ──
  // Primary source: the matches list, joined on the entry date.
  const matchRefl = await db.execute(sql`
    UPDATE journal_entries je
    SET title = 'Match Reflection — ' || upper(split_part(m.match_id, '-', 1)) || ' v ' || m.opponent
    FROM matches m
    WHERE je.cycle_id IS NULL
      AND je.kind = 'match_reflection'
      AND je.entry_date ~ '^\\d{2}\\.\\d{2}\\.\\d{4}$'
      AND m.match_date = to_char(to_date(je.entry_date, 'DD.MM.YYYY'), 'YYYY/MM/DD')
      AND m.match_id ~ '^R\\d+'
      AND (je.title IS NULL OR je.title = '' OR je.title LIKE '%\\_%' ESCAPE '\\' OR je.title ~ '^R\\d+-')
  `);
  // Fallback for entries with no matching fixture: parse the legacy
  // "R15-Croatia" style title itself.
  const matchReflFallback = await db.execute(sql`
    UPDATE journal_entries
    SET title = 'Match Reflection — ' || substring(title from '^R\\d+') || ' v ' || regexp_replace(title, '^R\\d+-', '')
    WHERE cycle_id IS NULL
      AND kind = 'match_reflection'
      AND title ~ '^R\\d+-\\S'
  `);

  // ── Legacy Week Ahead briefings: add structured round + matchDate ──
  // The saved list only renders the new "Week Ahead — R# v Opponent · date"
  // row when data.round/matchDate exist; look them up for old rows.
  const mondays = await db.execute(sql`
    SELECT id, data FROM match_prep_reports
    WHERE kind = 'monday'
      AND (data->>'round') IS NULL
      AND (data->>'matchDate') IS NULL
  `);
  const fixtures = await db.execute(sql`
    SELECT match_id, match_date, opponent FROM matches WHERE match_id ~ '^R\\d+'
  `);
  const fridayRefs = await db.execute(sql`
    SELECT data->>'opponent' AS opponent, data->>'round' AS round, data->>'matchDate' AS match_date
    FROM match_prep_reports
    WHERE kind = 'friday' AND (data->>'round') IS NOT NULL AND (data->>'matchDate') IS NOT NULL
  `);

  const parseAnyDate = (raw: string | null | undefined): Date | null => {
    if (!raw) return null;
    const iso = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(raw.trim());
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const t = Date.parse(raw.replace(/^[A-Za-z]+,?\s+/, "")); // strip weekday prefix
    return Number.isNaN(t) ? null : new Date(t);
  };
  const toIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dayDiff = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86_400_000);

  let briefsUpdated = 0;
  for (const row of mondays.rows as Array<{ id: number; data: Record<string, unknown> }>) {
    const data = row.data ?? {};
    const opponent = typeof data.opponent === "string" ? data.opponent : null;
    const monday = parseAnyDate(typeof data.weekOf === "string" ? data.weekOf : null);
    if (!opponent || !monday) continue;

    // Candidate games vs that opponent: real fixtures first, then rounds
    // recorded on saved Friday match-prep reports (covers games not yet in
    // the results table). Prefer the game inside the covered fortnight, then
    // the nearest one within 14 days either side.
    const candidates: Array<{ round: string; date: Date }> = [];
    for (const f of fixtures.rows as Array<{ match_id: string; match_date: string; opponent: string }>) {
      const d = parseAnyDate(f.match_date);
      if (d && f.opponent === opponent) candidates.push({ round: f.match_id.split("-")[0].toUpperCase(), date: d });
    }
    for (const f of fridayRefs.rows as Array<{ opponent: string | null; round: string | null; match_date: string | null }>) {
      const d = parseAnyDate(f.match_date);
      if (d && f.round && f.opponent === opponent) candidates.push({ round: f.round.toUpperCase(), date: d });
    }
    const best = candidates
      .map((c) => ({ ...c, diff: dayDiff(c.date, monday) }))
      .filter((c) => Math.abs(c.diff) <= 14)
      .sort((a, b) => {
        const aAhead = a.diff >= 0 ? 0 : 1; // games in the week(s) ahead win
        const bAhead = b.diff >= 0 ? 0 : 1;
        return aAhead - bAhead || Math.abs(a.diff) - Math.abs(b.diff);
      })[0];
    if (!best) continue;

    await db.execute(sql`
      UPDATE match_prep_reports
      SET data = data || ${JSON.stringify({ round: best.round, matchDate: toIso(best.date) })}::jsonb
      WHERE id = ${row.id}
    `);
    briefsUpdated++;
  }

  await db.execute(sql`INSERT INTO seed_markers (key) VALUES (${SAVED_NAMES_VERSION}) ON CONFLICT DO NOTHING`);
  logger.info(
    {
      trainingRenamed: training.rowCount,
      matchRenamed: matchRefl.rowCount,
      matchFallback: matchReflFallback.rowCount,
      briefsUpdated,
    },
    "Saved-name backfill complete",
  );
}

// ── User accounts ─────────────────────────────────────────────────────────────
// Creates the users + per-league access tables, then bootstraps the first
// superadmin from ADMIN_PASSWORD so the owner is never locked out. Runs only
// when the users table is empty, so it never overwrites real accounts.
async function runUserAccountsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id serial PRIMARY KEY,
      email text NOT NULL,
      name text NOT NULL,
      password_hash text NOT NULL,
      is_superadmin boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_league_access (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      league_id integer NOT NULL REFERENCES leagues(id),
      role text NOT NULL
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS user_league_access_unique ON user_league_access (user_id, league_id)`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash text NOT NULL,
      expires_at timestamp NOT NULL,
      used_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_hash_unique ON password_reset_tokens (token_hash)`);

  // Shirt numbers on match sheets (2026-08): captured from Dribl line-ups and
  // screenshot extraction so the Goals tab can look a player up by number in
  // leagues where the analyst doesn't know the names.
  await db.execute(sql`ALTER TABLE league_player_stats ADD COLUMN IF NOT EXISTS shirt_number text`);

  // Last-login tracking (2026-07): stamped on every successful login.
  await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamp`);

  // Per-account activity log (2026-07): one row per user+device per hour at
  // most, used to spot logins that look shared. Pruned after 90 days.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_activity (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      device_hash text NOT NULL,
      user_agent text NOT NULL,
      ip text NOT NULL,
      seen_at timestamp NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS user_activity_user_seen_idx ON user_activity (user_id, seen_at)`);

  // Per-IP geolocation cache (2026-07): "Canberra" beats a raw IP in the
  // Users-page activity list. One row per IP; NULL label = lookup failed.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ip_geo (
      ip text PRIMARY KEY,
      label text,
      looked_up_at timestamp NOT NULL DEFAULT now()
    )
  `);

  // ── Veo stats sync (2026-08) ──────────────────────────────────────────────
  // Maps each league to a Veo club + team slug and stores synced matches (raw
  // events/stats/periods/roster as jsonb). See .agents/memory/veo-integration.md.
  await db.execute(sql`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS veo_club_slug text`);
  await db.execute(sql`ALTER TABLE leagues ADD COLUMN IF NOT EXISTS veo_team_slug text`);
  await db.execute(sql`
    UPDATE leagues SET veo_club_slug = 'scott-conlon', veo_team_slug = '2024-nplw-firsts'
    WHERE name = 'ACT NPLW' AND veo_team_slug IS NULL
  `);
  await db.execute(sql`
    UPDATE leagues SET veo_club_slug = 'scott-conlon', veo_team_slug = '2024-nplw-reserves'
    WHERE name = 'ACT NPLW Reserves' AND veo_team_slug IS NULL
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS veo_matches (
      id serial PRIMARY KEY,
      league_id integer NOT NULL REFERENCES leagues(id),
      veo_match_id text NOT NULL,
      veo_team_slug text,
      title text,
      opponent text,
      starts_at text,
      has_analytics boolean NOT NULL DEFAULT false,
      has_events boolean NOT NULL DEFAULT false,
      has_tracking boolean NOT NULL DEFAULT false,
      has_momentum boolean NOT NULL DEFAULT false,
      events jsonb,
      stats jsonb,
      periods jsonb,
      roster jsonb,
      match_id integer,
      synced_at text
    )
  `);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS veo_matches_league_match_idx ON veo_matches (league_id, veo_match_id)`);
  // Grant the "veo" module to everyone who already has "gps" (same clubs that
  // record on Veo), once. Nav + read gating use this module.
  const veoModuleMarker = await db.execute(sql`SELECT 1 FROM seed_markers WHERE key = 'veo-module-grant-v1'`);
  if (veoModuleMarker.rows.length === 0) {
    await db.execute(sql`
      UPDATE user_league_access
      SET modules = (
        SELECT jsonb_agg(DISTINCT m)
        FROM jsonb_array_elements(modules || '["veo"]'::jsonb) AS m
      )
      WHERE modules @> '["gps"]'::jsonb AND NOT (modules @> '["veo"]'::jsonb)
    `);
    await db.execute(sql`INSERT INTO seed_markers (key) VALUES ('veo-module-grant-v1') ON CONFLICT DO NOTHING`);
  }

  const existing = await db.execute(sql`SELECT 1 FROM users LIMIT 1`);
  if (existing.rows.length > 0) return;
  const initialPassword = process.env.ADMIN_PASSWORD;
  if (!initialPassword) {
    logger.warn("No users exist and ADMIN_PASSWORD is not set — cannot bootstrap the first superadmin");
    return;
  }
  const { hashPassword } = await import("./lib/passwords");
  await db.execute(sql`
    INSERT INTO users (email, name, password_hash, is_superadmin)
    VALUES ('scott@gameinsights.com.au', 'Scott', ${hashPassword(initialPassword)}, true)
    ON CONFLICT (email) DO NOTHING
  `);
  logger.info("Bootstrapped first superadmin account (scott@gameinsights.com.au) using ADMIN_PASSWORD");
}
