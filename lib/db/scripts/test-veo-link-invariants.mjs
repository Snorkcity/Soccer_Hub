import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const client = new pg.Client({ connectionString });
await client.connect();

try {
  await client.query("BEGIN");

  const league = await client.query(
    `SELECT id
     FROM leagues
     WHERE name IN ('ACT NPLM', 'ACT NPLM U23', 'ACT NPLB U18', 'ACT NPLB U16', 'ACT NPLB U15', 'ACT NPLB U14')
     ORDER BY name
     LIMIT 1`,
  );
  assert.equal(league.rowCount, 1, "expected one mapped male test league");
  const leagueId = league.rows[0].id;
  const targetMatchId = 1_000_000_000 + process.pid;

  const archive = await client.query(
    `INSERT INTO veo_matches (league_id, veo_match_id, match_id, removed_at)
     VALUES ($1, $2, $3, now()::text)
     RETURNING id`,
    [leagueId, `test-archive-${randomUUID()}`, targetMatchId],
  );
  const active = await client.query(
    `INSERT INTO veo_matches (league_id, veo_match_id, match_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [leagueId, `test-active-${randomUUID()}`, targetMatchId],
  );

  // Manual replacement clears only the active claimant. The archived row keeps
  // its historical link and cannot be used to displace the live recording.
  await client.query(
    `UPDATE veo_matches
     SET match_id = NULL
     WHERE league_id = $1 AND match_id = $2 AND removed_at IS NULL`,
    [leagueId, targetMatchId],
  );
  const afterDisplacement = await client.query(
    `SELECT id, match_id, removed_at
     FROM veo_matches
     WHERE id = ANY($1::int[])
     ORDER BY id`,
    [[archive.rows[0].id, active.rows[0].id]],
  );
  const archiveRow = afterDisplacement.rows.find((row) => row.id === archive.rows[0].id);
  const activeRow = afterDisplacement.rows.find((row) => row.id === active.rows[0].id);
  assert.equal(archiveRow.match_id, targetMatchId);
  assert.notEqual(archiveRow.removed_at, null);
  assert.equal(activeRow.match_id, null);

  await client.query("UPDATE veo_matches SET match_id = $1 WHERE id = $2", [
    targetMatchId,
    active.rows[0].id,
  ]);
  await client.query("SAVEPOINT before_restore_conflict");
  let restoreError = null;
  try {
    await client.query("UPDATE veo_matches SET removed_at = NULL WHERE id = $1", [
      archive.rows[0].id,
    ]);
  } catch (error) {
    restoreError = error;
  }
  assert.equal(
    restoreError?.code,
    "23505",
    "restoring an archived duplicate must preserve the active unique link",
  );
  await client.query("ROLLBACK TO SAVEPOINT before_restore_conflict");

  // A populated legacy JSON string must upgrade to an object, while arbitrary
  // legacy text remains a JSON string instead of failing the migration.
  await client.query(`
    CREATE TEMP TABLE veo_status_upgrade_test (
      id serial PRIMARY KEY,
      processing_status text
    ) ON COMMIT DROP
  `);
  await client.query(
    "INSERT INTO veo_status_upgrade_test (processing_status) VALUES ($1), ($2)",
    ['{"video":"completed","analytics":"processing"}', "legacy-status"],
  );
  await client.query(`
    ALTER TABLE veo_status_upgrade_test ADD COLUMN processing_status_jsonb_upgrade jsonb;
    DO $$
    DECLARE
      status_row record;
      parsed_status jsonb;
    BEGIN
      FOR status_row IN SELECT id, processing_status FROM veo_status_upgrade_test LOOP
        BEGIN
          parsed_status := status_row.processing_status::jsonb;
        EXCEPTION WHEN invalid_text_representation THEN
          parsed_status := to_jsonb(status_row.processing_status);
        END;
        UPDATE veo_status_upgrade_test
        SET processing_status_jsonb_upgrade = parsed_status
        WHERE id = status_row.id;
      END LOOP;
    END
    $$;
  `);
  const conversion = await client.query(
    "SELECT processing_status_jsonb_upgrade FROM veo_status_upgrade_test ORDER BY id",
  );
  assert.deepEqual(conversion.rows[0].processing_status_jsonb_upgrade, {
    video: "completed",
    analytics: "processing",
  });
  assert.equal(conversion.rows[1].processing_status_jsonb_upgrade, "legacy-status");

  await client.query("ROLLBACK");
  console.log("Veo active-link and migration invariant tests passed");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}