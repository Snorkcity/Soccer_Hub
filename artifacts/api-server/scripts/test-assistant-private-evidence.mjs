import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the Assistant private-evidence integration test");
}

const output = join(tmpdir(), `assistant-private-evidence-${process.pid}.cjs`);
const require = createRequire(import.meta.url);
let pool;
const insertedIds = [];

try {
  await build({
    stdin: {
      contents: `
        export {
          previousDecksVsOpponentText,
          mondayBriefTextForOpponent,
        } from "./src/routes/journalInterview.ts";
        export { pool } from "@workspace/db";
      `,
      resolveDir: process.cwd(),
      sourcefile: "assistant-private-evidence-entry.ts",
      loader: "ts",
    },
    outfile: output,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
  });

  const {
    previousDecksVsOpponentText,
    mondayBriefTextForOpponent,
    pool: importedPool,
  } = require(output);
  pool = importedPool;

  const leagueResult = await pool.query("SELECT id FROM leagues ORDER BY id LIMIT 1");
  assert.equal(leagueResult.rowCount, 1, "the test database needs one league");
  const leagueId = Number(leagueResult.rows[0].id);
  const tag = `assistant-private-${process.pid}-${Date.now()}`;
  const opponent = `Privacy Opponent ${tag}`;
  const clubA = `Privacy Club A ${tag}`;
  const clubB = `Privacy Club B ${tag}`;

  const rows = [
    {
      club: clubA,
      kind: "friday",
      title: `A Friday ${tag}`,
      data: { commentsTrends: `ONLY_A_FRIDAY_${tag}` },
    },
    {
      club: clubB,
      kind: "friday",
      title: `B Friday ${tag}`,
      data: { commentsTrends: `ONLY_B_FRIDAY_${tag}` },
    },
    {
      club: clubA,
      kind: "monday",
      title: `A Monday ${tag}`,
      data: { pointers: [`ONLY_A_MONDAY_${tag}`] },
    },
    {
      club: clubB,
      kind: "monday",
      title: `B Monday ${tag}`,
      data: { pointers: [`ONLY_B_MONDAY_${tag}`] },
    },
  ];

  for (const row of rows) {
    const inserted = await pool.query(
      `INSERT INTO match_prep_reports
        (league_id, club, kind, title, opponent, match_date, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING id`,
      [
        leagueId,
        row.club,
        row.kind,
        row.title,
        opponent,
        "2020-01-01",
        JSON.stringify(row.data),
      ],
    );
    insertedIds.push(Number(inserted.rows[0].id));
  }

  const [fridayA, fridayB, mondayA, mondayB] = await Promise.all([
    previousDecksVsOpponentText(leagueId, opponent, clubA),
    previousDecksVsOpponentText(leagueId, opponent, clubB),
    mondayBriefTextForOpponent(leagueId, opponent, clubA),
    mondayBriefTextForOpponent(leagueId, opponent, clubB),
  ]);

  assert.match(fridayA ?? "", new RegExp(`ONLY_A_FRIDAY_${tag}`));
  assert.doesNotMatch(fridayA ?? "", new RegExp(`ONLY_B_FRIDAY_${tag}`));
  assert.match(fridayB ?? "", new RegExp(`ONLY_B_FRIDAY_${tag}`));
  assert.doesNotMatch(fridayB ?? "", new RegExp(`ONLY_A_FRIDAY_${tag}`));
  assert.match(mondayA ?? "", new RegExp(`ONLY_A_MONDAY_${tag}`));
  assert.doesNotMatch(mondayA ?? "", new RegExp(`ONLY_B_MONDAY_${tag}`));
  assert.match(mondayB ?? "", new RegExp(`ONLY_B_MONDAY_${tag}`));
  assert.doesNotMatch(mondayB ?? "", new RegExp(`ONLY_A_MONDAY_${tag}`));

  console.log("Assistant private-evidence integration test passed");
} finally {
  if (pool && insertedIds.length > 0) {
    await pool.query("DELETE FROM match_prep_reports WHERE id = ANY($1::int[])", [insertedIds]);
  }
  await pool?.end().catch(() => {});
  await unlink(output).catch(() => {});
}