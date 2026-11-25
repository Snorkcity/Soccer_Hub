import assert from "node:assert/strict";
import { test } from "node:test";
import { trainingGameRows, trainingGameRound, isTrainingGameRound } from "../src/gpsTrainingGame";
import { developmentGames } from "../src/gpsDevelopment";

const half = {
  playerName: "Test.Player", splitName: "1st.half", minsPlayed: 10,
  distanceKm: 1.3, distancePerMinMm: 999, topSpeedMs: 8,
  accelCount34: 7, accelCountOver4: 2, playerLoad: 42,
};
test("training-game totals copy every trimmed value, not the recording, and recalculate m/min", () => {
  const source = [half, { ...half, splitName: "all", minsPlayed: 90, distanceKm: 9, topSpeedMs: 10, accelCount34: 99 }];
  const result = trainingGameRows(source);
  assert.deepEqual(result.map(r => r.splitName), ["game", "1st.half"]);
  for (const row of result) {
    assert.equal(row.minsPlayed, 10);
    assert.equal(row.distanceKm, 1.3);
    assert.equal(row.distancePerMinMm, 130);
    assert.equal(row.topSpeedMs, 8);
    assert.equal(row.accelCount34, 7);
    assert.equal(row.playerLoad, 42);
  }
  assert.equal(source[0].distancePerMinMm, 999, "input is not mutated");
  assert.equal(result.some(r => r.splitName === "2nd.half"), false);
});
test("each player retains their own playing time; no source total is required", () => {
  const result = trainingGameRows([half, { ...half, playerName: "Other.Player", minsPlayed: 40 }]);
  assert.equal(result.length, 4);
  assert.equal(result[2].minsPlayed, 40);
  assert.equal(result[2].distancePerMinMm, 32.5);
});
test("missing, duplicate, zero-time and unexpected periods fail before replacement", () => {
  for (const rows of [
    [], [{ ...half, splitName: "all" }], [half, half],
    [{ ...half, minsPlayed: 0 }], [{ ...half, minsPlayed: null }],
    [half, { ...half, splitName: "2nd.half" }],
    [half, { ...half, playerName: "Missing.Half", splitName: "all" }],
  ]) assert.throws(() => trainingGameRows(rows));
});
test("missing distance stays missing; recorded zero distance stays zero", () => {
  assert.equal(trainingGameRows([{ ...half, distanceKm: null, distancePerMinMm: null }])[0].distancePerMinMm, null);
  assert.equal(trainingGameRows([{ ...half, distanceKm: 0 }])[0].distancePerMinMm, 0);
});
test("training round remains non-official even with an official context override", () => {
  const round = trainingGameRound("2026-11-23", "1sts");
  assert.equal(round, "TG20261123-1sts");
  assert.ok(isTrainingGameRound(round));
  assert.equal(isTrainingGameRound("R1-1sts"), false);
  const rows = trainingGameRows([{ ...half, minsPlayed: 70 }]).map(r => ({
    ...r, year: "2027", round, sessionDate: "23/11/2026", opponent: "Training game", tags: "game",
  }));
  const [game] = developmentGames(rows, "CM", [{
    playerName: half.playerName, year: "2027", round, role: "CM",
    matchType: "official", comparable: true,
  }]);
  assert.equal(game.matchType, "other");
  assert.equal(game.qualifies, false);
});
