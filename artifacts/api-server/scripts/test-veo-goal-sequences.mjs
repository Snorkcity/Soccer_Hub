import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = join(tmpdir(), `veo-goal-sequences-${process.pid}.mjs`);
try {
  await build({ entryPoints: ["src/lib/veoGoalSequences.ts"], outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const { reconstructVeoGoalSequences, aggregateVeoGoalSequences, zoneForX } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
  const pass = (time, jersey, x, receiver, dx) => ({
    eventType: "FootballPass", videoTimeMs: time, periodId: 1, periodTimeMs: time,
    team: "Own", playerJersey: jersey, x, z: 0.4, outcome: "1",
    attributes: { receiver_jersey: receiver, receiver_timestamp_ms: time + 500, receiver_x: dx, receiver_z: 0.4 },
  });
  const events = [
    pass(10_000, "8", 0.8, "9", 0.6),
    { eventType: "FootballPass", videoTimeMs: 12_000, periodId: 1, team: "Opponent", playerJersey: "4", outcome: "1" },
    pass(20_000, "6", 0.7, "8", 0.45),
    { eventType: "FootballPass", videoTimeMs: 21_000, periodId: 1, team: "Own", playerJersey: "6", outcome: "0" },
    pass(30_000, "10", 0.65, "9", 0.25),
    { eventType: "FootballShot", videoTimeMs: 31_000, periodId: 1, periodTimeMs: 31_000, team: "Own", playerJersey: "9", outcome: "1", x: 0.2, z: 0.5 },
    { eventType: "FootballGoal", videoTimeMs: 31_100, periodId: 1, periodTimeMs: 31_100, team: "Own", playerJersey: null },
  ];
  const result = reconstructVeoGoalSequences(events);
  assert.equal(result.available, true);
  assert.equal(result.goals.length, 1);
  assert.equal(result.goals[0].scorerJersey, "9");
  assert.equal(result.goals[0].goalPeriodTimeMs, 31_100);
  assert.equal(result.goals[0].completedPassCount, 1);
  assert.equal(result.goals[0].passes[0].receiverJersey, "9");
  assert.equal(result.goals[0].sequenceStartZone, "middle");
  assert.equal(result.goals[0].lastActionOpponent?.jersey, "4");
  assert.notEqual(result.goals[0].lastActionOwn?.eventType, "FootballShot");
  assert.match(result.goals[0].reasons.join(" "), /unsuccessful|interrupted|possession/i);
  assert.equal(zoneForX(0.2), "attacking");
  assert.equal(zoneForX(0.5), "middle");
  assert.equal(zoneForX(0.9), "defensive");
  const aggregate = aggregateVeoGoalSequences(result.goals);
  assert.deepEqual(aggregate.passCount, { "1": 1 });
  assert.equal(aggregate.finalPassOriginZone.middle, 1);
  assert.equal("finalActionOriginZone" in aggregate, false);
  assert.equal(reconstructVeoGoalSequences(events, "partial").available, false);
  const broken = reconstructVeoGoalSequences([
    pass(10_000, "8", 0.8, "9", 0.4),
    { eventType: "FootballTackle", videoTimeMs: 10_500, periodId: 1, team: "Opponent", playerJersey: "5", outcome: "1" },
    { eventType: "FootballShot", videoTimeMs: 11_000, periodId: 1, team: "Own", playerJersey: "9", outcome: "1" },
    { eventType: "FootballGoal", videoTimeMs: 11_100, periodId: 1, team: "Own" },
  ]);
  assert.equal(broken.goals[0].completedPassCount, 0);
  assert.match(broken.goals[0].reasons.join(" "), /Opponent controlled possession/);

  const direct = reconstructVeoGoalSequences([
    { eventType: "FootballPenaltyKick", videoTimeMs: 1_000, periodId: 1, team: "Own", playerJersey: "7", outcome: "1" },
    { eventType: "FootballShot", videoTimeMs: 1_100, periodId: 1, team: "Own", playerJersey: "7", outcome: "1" },
    { eventType: "FootballGoal", videoTimeMs: 1_200, periodId: 1, team: "Own" },
  ]);
  assert.equal(direct.goals[0].completedPassCount, 0);
  assert.equal(direct.goals[0].scoringShot.direct, true);
  const openPlay = reconstructVeoGoalSequences([
    { eventType: "FootballShot", videoTimeMs: 1_100, periodId: 1, periodTimeMs: 1_100, team: "Own", playerJersey: "7", outcome: "1" },
    { eventType: "FootballGoal", videoTimeMs: 1_200, periodId: 1, periodTimeMs: 1_200, team: "Own" },
  ]);
  assert.equal(openPlay.goals[0].scoringShot.direct, false);
  assert.match(openPlay.goals[0].reasons.join(" "), /unassisted or unknown/);
  assert.equal(reconstructVeoGoalSequences(null).available, false);
  console.log("Veo goal sequence tests passed");
} finally {
  await unlink(output).catch(() => {});
}