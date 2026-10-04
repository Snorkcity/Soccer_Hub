import assert from "node:assert/strict";
import { test } from "node:test";
import {
  developmentGames, developmentSummary, developmentMetrics, developmentProfile, developmentSquad,
  type DevelopmentRawRow, type DevelopmentContext,
} from "@workspace/api-zod";

const raw = (patch: Partial<DevelopmentRawRow> = {}): DevelopmentRawRow => ({
  playerName: "Test", year: "2027", round: "R1-u23", sessionDate: "01/04/2027",
  opponent: "Opponent", tags: "game", splitName: "game", minsPlayed: "60",
  distanceKm: "6", sprintDistanceM: "600", distanceZone5Km: "0.06", topSpeedMs: "8",
  accelCount34: 10, accelCountOver4: 2, decelCount34: 20, decelCountOver4: 3, ...patch,
});
const games = (n: number) => developmentGames(Array.from({ length: n }, (_, i) =>
  raw({ round: `R${i + 1}-u23`, sprintDistanceM: (i + 1) * 100, distanceKm: n - i })), "DM", []);

test("whole match beats split sums; metres, counts and rates match Catapult definitions", () => {
  const [g] = developmentGames([raw(), raw({ splitName: "1st.half", distanceKm: 20 }), raw({ splitName: "Extra-time", distanceKm: 9 })], "DM", []);
  assert.equal(g!.values.td, 6000); assert.equal(g!.values.hsp, 600); assert.equal(g!.values.vhs, 60);
  assert.equal(g!.values.dpm, 100); assert.equal(g!.values.hspPct, 10); assert.equal(g!.values.hspMin, 10);
  assert.equal(g!.values.vhsMin, 1); assert.equal(g!.values.speed, 28.8);
  assert.equal(g!.values.accel, 12); assert.equal(g!.values.decel, 23); assert.equal(g!.qualifies, true);
});
test("missing whole-game values fall back to periods including extra time", () => {
  const [g] = developmentGames([
    raw({ splitName: "all", distanceKm: null, minsPlayed: null }),
    raw({ splitName: "1st.half", distanceKm: 2, minsPlayed: 40 }),
    raw({ splitName: "2nd.half", distanceKm: 3, minsPlayed: 40 }),
    raw({ splitName: "Extra-time", distanceKm: 1, minsPlayed: 10 }),
  ], "CB", []);
  assert.equal(g!.values.td, 6000); assert.equal(g!.mins, 90);
});
test("lone half stays visible and does not become a qualifying 90-minute match", () => {
  const [g] = developmentGames([raw({ splitName: "1st.half", minsPlayed: 45 })], "CB", []);
  assert.equal(g!.mins, 45); assert.equal(g!.qualifies, false);
});
test("official >=60 min gate preserves short/unknown/other/non-comparable appearances", () => {
  const contexts: DevelopmentContext[] = [
    { playerName: "Test", year: "2027", round: "R3-u23", role: "mixed", matchType: "other", comparable: true },
    { playerName: "Test", year: "2027", round: "R4-u23", role: "CB", matchType: "official", comparable: false },
  ];
  const gs = developmentGames([raw({ minsPlayed: 59.99 }), raw({ round: "Friendly" }), raw({ round: "R3-u23" }), raw({ round: "R4-u23" })], "CB", contexts);
  assert.equal(gs.length, 4); assert.equal(gs.filter(g => g.qualifies).length, 0);
});
test("mixed role can contribute personally but stays explicitly mixed", () => {
  const [g] = developmentGames([raw()], "DM", [{ playerName: "Test", year: "2027", round: "R1-u23", role: "mixed", matchType: "official", comparable: true }]);
  assert.equal(g!.qualifies, true); assert.equal(g!.roleSource, "mixed");
});
test("recorded historical role is not changed when the usual role changes", () => {
  const [g] = developmentGames([raw()], "AM", [{ playerName: "Test", year: "2027", round: "R1-u23", role: "FB", matchType: "official", comparable: true }]);
  assert.equal(g!.role, "FB"); assert.equal(g!.roleSource, "recorded");
});
test("Gref sample stages use top-three for 3-4 and top-five at >=5", () => {
  for (const n of [0, 1, 2]) { const r = developmentSummary(games(n), "hsp"); assert.equal(r.gref.value, null); assert.equal(r.gref.status, "insufficient"); }
  const three = developmentSummary(games(3), "hsp"); assert.equal(three.gref.value, 200); assert.equal(three.gref.status, "provisional");
  assert.equal(developmentSummary(games(4), "hsp").gref.value, 300);
  const six = developmentSummary(games(6), "hsp"); assert.equal(six.gref.value, 400); assert.equal(six.gref.status, "established"); assert.equal(six.gref.matches.length, 5);
});
test("references use independent best matches per metric", () => {
  const gs = games(6);
  assert.notDeepEqual(developmentSummary(gs, "td").gref.matches.map(g => g.key), developmentSummary(gs, "hsp").gref.matches.map(g => g.key));
});
test("missing or invalid metrics reduce only that metric's sample; zeros are not missing", () => {
  const gs = developmentGames([raw({ round: "R1", sprintDistanceM: null }), raw({ round: "R2", sprintDistanceM: -5 }),
    raw({ round: "R3", sprintDistanceM: 0 }), raw({ round: "R4", sprintDistanceM: "NaN" })], "DM", []);
  assert.equal(developmentSummary(gs, "td").sample, 4); assert.equal(developmentSummary(gs, "hsp").sample, 1);
  assert.equal(developmentSummary(gs, "hsp").average, 0);
});
test("counts require both bands and zero minutes never produce infinite rates", () => {
  const [g] = developmentGames([raw({ accelCountOver4: null, minsPlayed: 0 })], "CB", []);
  assert.equal(g!.values.accel, null); assert.equal(g!.values.hspMin, null); assert.equal(g!.values.dpm, null);
});
test("duplicate rows and unsupported splits don't inflate appearances", () => {
  assert.equal(developmentGames([raw(), raw(), raw({ splitName: "warm up" }), raw({ tags: "training" })], "DM", []).length, 1);
});
test("current season, previous season and retained-history references remain separate", () => {
  const gs = developmentGames([raw({ year: "2026", sprintDistanceM: 100 }), raw(), raw({ round: "R2-u23" }), raw({ round: "R3-u23" })], "AM", []);
  const p = developmentProfile("Test", "2027", "AM", gs, [], []);
  assert.equal(p.seasons.length, 2); assert.equal(p.history.find(m => m.id === "hsp")!.sample, 4);
  assert.equal(p.seasons.find(s => s.year === "2027")!.metrics.find(m => m.id === "hsp")!.sample, 3);
  assert.match(p.warnings.join(" "), /distinct football role|6's physical emphasis/);
});
test("AM and DM share physical emphasis without collapsing the football role", () => {
  assert.deepEqual(developmentMetrics("AM").filter(m => m.primary).map(m => m.id), developmentMetrics("DM").filter(m => m.primary).map(m => m.id));
  assert.equal(developmentMetrics("GK").some(m => m.primary), false);
});
test("U23 has its own squad, alongside legacy women squads", () => {
  for (const code of ["R1-u23", "R1-u23s", "R1-23s"]) assert.equal(developmentSquad(code), "U23");
  assert.equal(developmentSquad("R2-r"), "Reserves"); assert.equal(developmentSquad("R1-18s"), "17s / 18s");
});