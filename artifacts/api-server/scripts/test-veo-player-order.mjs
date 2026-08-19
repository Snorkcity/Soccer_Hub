import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = join(tmpdir(), `veo-player-order-${process.pid}.mjs`);

try {
  await build({
    entryPoints: ["../bufc-hub/src/lib/veoPlayerOrdering.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });

  const { compareVeoPlayerTeamSide } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
  const rows = [
    { id: "unassigned-high", team: { side: "unassigned" }, minutes: 90, goals: 8 },
    { id: "opponent-low", team: { side: "opponent" }, minutes: 10, goals: 1 },
    { id: "own-low", team: { side: "own" }, minutes: 20, goals: 2 },
    { id: "opponent-high", team: { side: "opponent" }, minutes: 80, goals: 9 },
    { id: "own-high", team: { side: "own" }, minutes: 70, goals: 7 },
  ];

  const byMinutes = [...rows].sort(
    (a, b) => compareVeoPlayerTeamSide(a, b) || b.minutes - a.minutes,
  );
  assert.deepEqual(
    byMinutes.map((row) => row.id),
    ["own-high", "own-low", "opponent-high", "opponent-low", "unassigned-high"],
  );

  const byGoals = [...rows].sort(
    (a, b) => compareVeoPlayerTeamSide(a, b) || b.goals - a.goals,
  );
  assert.deepEqual(
    byGoals.map((row) => row.id),
    ["own-high", "own-low", "opponent-high", "opponent-low", "unassigned-high"],
  );

  console.log("Veo player team grouping regression passed");
} finally {
  await unlink(output).catch(() => {});
}