import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = join(tmpdir(), `veo-score-${process.pid}.mjs`);

try {
  await build({
    entryPoints: ["src/lib/veoScore.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const { countVeoEventGoals, resolveVeoScore } = await import(
    `${pathToFileURL(output).href}?v=${Date.now()}`
  );

  const reversedEventScore = [
    { event_type: "FootballGoal", team: "Own" },
    { event_type: "FootballGoal", team: "Own" },
    { event_type: "FootballGoal", team: "Own" },
    { event_type: "FootballGoal", team: "Opponent" },
    { event_type: "FootballShot", team: "Opponent" },
  ];

  assert.deepEqual(countVeoEventGoals(reversedEventScore), {
    goalsFor: 3,
    goalsAgainst: 1,
  });
  assert.deepEqual(resolveVeoScore(reversedEventScore, 1, 3), {
    goalsFor: 1,
    goalsAgainst: 3,
    veoGoalsFor: 3,
    veoGoalsAgainst: 1,
    source: "official",
  });
  assert.deepEqual(resolveVeoScore(reversedEventScore, null, null), {
    goalsFor: 3,
    goalsAgainst: 1,
    veoGoalsFor: 3,
    veoGoalsAgainst: 1,
    source: "veo-events",
  });
  assert.equal(resolveVeoScore(reversedEventScore, 1, null).source, "veo-events");
  assert.equal(resolveVeoScore([], 0, 0).source, "official");

  console.log("Veo score precedence tests passed");
} finally {
  await unlink(output).catch(() => {});
}