import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = join(tmpdir(), `veo-direction-${process.pid}.mjs`);

try {
  await build({
    entryPoints: ["src/lib/veoDirection.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const {
    effectiveVeoOwnSide,
    effectiveVeoPeriods,
    normaliseVeoDirectionOverrides,
    reviewVeoDirections,
  } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

  const periods = [
    { own_side: "left", timeframe: [0, 2_700_000] },
    { own_side: "right", timeframe: [2_700_000, 5_400_000] },
  ];
  const events = [
    { event_type: "FootballShot", team: "Own", period_id: 1, x: 0.88 },
    { event_type: "FootballGoal", team: "Own", period_id: 1, x: 0.93 },
    { event_type: "FootballShot", team: "Opponent", period_id: 1, x: 0.12 },
    { event_type: "FootballShot", team: "Opponent", period_id: 1, x: 0.08 },
  ];

  const correct = reviewVeoDirections(events, periods, {});
  assert.equal(correct[0].suggestedSide, "left");
  assert.equal(correct[0].status, "consistent");

  const reversed = reviewVeoDirections(events, [{ ...periods[0], own_side: "right" }], {});
  assert.equal(reversed[0].suggestedSide, "left");
  assert.equal(reversed[0].status, "looks_reversed");

  const sparse = reviewVeoDirections(
    [{ event_type: "FootballShot", team: "Own", period_id: 1, x: 0.9 }],
    periods.slice(0, 1),
    {},
  );
  assert.equal(sparse[0].suggestedSide, null);
  assert.equal(sparse[0].status, "uncertain");

  const mixed = reviewVeoDirections(
    [
      { event_type: "FootballShot", team: "Own", period_id: 1, x: 0.9 },
      { event_type: "FootballShot", team: "Own", period_id: 1, x: 0.1 },
      { event_type: "FootballShot", team: "Opponent", period_id: 1, x: 0.9 },
      { event_type: "FootballShot", team: "Opponent", period_id: 1, x: 0.1 },
    ],
    periods.slice(0, 1),
    {},
  );
  assert.equal(mixed[0].suggestedSide, null);
  assert.equal(mixed[0].status, "uncertain");

  const invalid = reviewVeoDirections(
    [
      { event_type: "FootballShot", team: "Own", period_id: 1, x: null },
      { event_type: "FootballShot", team: "Own", period_id: 1, x: 2 },
      { event_type: "FootballShot", team: "Own", period_id: 1, x: 0.51 },
    ],
    periods.slice(0, 1),
    {},
  );
  assert.equal(invalid[0].status, "no_evidence");

  // Manual confirmation wins over raw Veo and over any coordinate suggestion.
  const confirmed = reviewVeoDirections(events, [{ own_side: "right" }], { 1: "left" });
  assert.equal(confirmed[0].effectiveSide, "left");
  assert.equal(confirmed[0].overrideSide, "left");
  assert.equal(confirmed[0].status, "confirmed");
  assert.equal(effectiveVeoOwnSide([{ own_side: "right" }], { 1: "left" }, 1), "left");

  // Applying an effective view never mutates Veo's raw periods.
  const raw = [{ own_side: "right", duration: 2_700_000 }];
  const effective = effectiveVeoPeriods(raw, { 1: "left" });
  assert.equal(raw[0].own_side, "right");
  assert.equal(effective[0].own_side, "left");

  // Invalid override entries are discarded instead of silently taking effect.
  assert.deepEqual(
    normaliseVeoDirectionOverrides({ 1: "left", 2: "up", 0: "right", x: "left" }),
    { 1: "left" },
  );

  // Official/Dribl scores are intentionally not inputs to direction review.
  // A Veo feed missing a goal therefore cannot change this suggestion.
  const withoutMissedGoal = events.filter((event) => event.event_type !== "FootballGoal");
  assert.equal(reviewVeoDirections(withoutMissedGoal, periods, {})[0].suggestedSide, "left");

  console.log("Veo direction tests passed");
} finally {
  await unlink(output).catch(() => undefined);
}