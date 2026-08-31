import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = join(tmpdir(), `nplb-borrowing-${process.pid}.mjs`);

try {
  await build({
    entryPoints: ["src/lib/nplb2026.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    plugins: [{
      name: "stub-database",
      setup(build) {
        build.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: "@workspace/db",
          namespace: "stub-database",
        }));
        build.onLoad({ filter: /.*/, namespace: "stub-database" }, () => ({
          contents: "export const db = {}; export const leaguesTable = {}; export const seasonsTable = {};",
          loader: "js",
        }));
      },
    }],
  });

  const {
    compareNplbPlayerRows,
    nplbBorrowDirection,
    nplbHomeGrade,
    nplbPlayerIdentityKey,
  } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

  const evidence = [
    { driblUserId: "player-1", borrowed: false, leagueName: "ACT NPLB U14", seasonYear: "2025" },
    { driblUserId: "player-1", borrowed: false, leagueName: "ACT NPLB U15", seasonYear: "2026" },
  ];
  assert.equal(nplbHomeGrade("player-1", evidence, "2026"), 15);
  assert.equal(
    nplbBorrowDirection(16, "player-1", evidence, "2026"),
    "up",
    "a prior-year registration cannot contradict or replace the selected-year home grade",
  );

  assert.notEqual(
    nplbPlayerIdentityKey("J.Smith", "dribl-a"),
    nplbPlayerIdentityKey("J.Smith", "dribl-b"),
    "same-name players with different stable Dribl identities remain distinct",
  );
  assert.equal(nplbPlayerIdentityKey(" J.SMITH ", null), "name:j.smith");

  assert.equal(nplbBorrowDirection(16, null, evidence, "2026"), "unknown");
  assert.equal(
    nplbBorrowDirection(16, "player-2", [
      { driblUserId: "player-2", borrowed: false, leagueName: "ACT NPLB U14", seasonYear: "2026" },
      { driblUserId: "player-2", borrowed: false, leagueName: "ACT NPLB U15", seasonYear: "2026" },
    ], "2026"),
    "unknown",
    "contradictory selected-year home grades stay unknown",
  );
  assert.equal(
    nplbBorrowDirection(16, "player-3", [
      { driblUserId: "player-3", borrowed: false, leagueName: "ACT NPLB U16", seasonYear: "2026" },
    ], "2026"),
    "unknown",
    "a same-grade borrowed flag never enters up/down totals",
  );

  const tied = [
    { playerName: "J.Smith", identityKey: "id:z", totalGoals: 1, totalAssists: 1 },
    { playerName: "J.Smith", identityKey: "id:a", totalGoals: 1, totalAssists: 1 },
  ].sort(compareNplbPlayerRows);
  assert.deepEqual(tied.map(row => row.identityKey), ["id:a", "id:z"]);

  console.log("NPLB borrowing tests passed");
} finally {
  await unlink(output).catch(() => undefined);
}