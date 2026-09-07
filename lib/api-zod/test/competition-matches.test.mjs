import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyDriblCompetitionStage,
  fixtureCode,
  isRegularSeasonMatchId,
  regularSeasonRound,
} from "../src/competitionMatches.ts";

test("classifies Dribl numbered rounds without accepting round zero", () => {
  assert.deepEqual(classifyDriblCompetitionStage("Round 20"), {
    kind: "round",
    code: "R20",
    label: "Round 20",
    round: 20,
    countsTowardLadder: true,
  });
  assert.equal(isRegularSeasonMatchId("R20-BEL-CCR"), true);
  assert.equal(regularSeasonRound("R20-BEL-CCR"), 20);
  assert.equal(isRegularSeasonMatchId("R0-BEL-CCR"), false);
});

test("classifies the live Dribl finals-series labels as non-round fixtures", () => {
  assert.deepEqual(classifyDriblCompetitionStage("Finals 1#1"), {
    kind: "finals",
    code: "FW1G1",
    label: "Finals Week 1 · Game 1",
    round: null,
    countsTowardLadder: false,
  });
  assert.deepEqual(classifyDriblCompetitionStage("Finals 1#2"), {
    kind: "finals",
    code: "FW1G2",
    label: "Finals Week 1 · Game 2",
    round: null,
    countsTowardLadder: false,
  });
  assert.equal(fixtureCode("FW1G1-BEL-CCR"), "FW1G1");
  assert.equal(isRegularSeasonMatchId("FW1G1-BEL-CCR"), false);
});

test("prefers verified native finals codes while preserving existing IDs", () => {
  const published = [
    { value: "finals_1", title: "Finals Round 1" },
    { value: "finals_2", title: "Finals Round 2" },
    { value: "finals_3", title: "Finals Round 3" },
  ];
  assert.deepEqual(classifyDriblCompetitionStage("F1#1", "Finals 1#1", published), {
    kind: "finals",
    code: "FW1G1",
    label: "Finals Week 1 · Game 1",
    round: null,
    countsTowardLadder: false,
  });
  assert.equal(classifyDriblCompetitionStage("F1#2", "Finals 1#2", published).code, "FW1G2");
  assert.equal(classifyDriblCompetitionStage("F1#3", "Finals 1#3", published).code, "FW1G3");
  assert.equal(classifyDriblCompetitionStage("F1#4", "Finals 1#4", published).code, "FW1G4");
  assert.deepEqual(classifyDriblCompetitionStage("F2#4", "Finals 2#4", published), {
    kind: "finals",
    code: "FW2G4",
    label: "Finals Week 2 · Game 4",
    round: null,
    countsTowardLadder: false,
  });
  assert.equal(classifyDriblCompetitionStage("F3#5", "Finals 3#5", published).code, "FW3G5");
  assert.equal(classifyDriblCompetitionStage("F4#6", "Finals 4#6", [
    ...published,
    { value: "finals_4", title: "Finals Round 4" },
  ]).code, "FW4G6");
  assert.equal(classifyDriblCompetitionStage("R20", "Round 20").code, "R20");
});

test("blocks unfamiliar native finals codes instead of guessing from display wording", () => {
  assert.equal(classifyDriblCompetitionStage("F4#6", "Finals 4#6", [
    { value: "finals_3", title: "Finals Round 3" },
  ]).kind, "unknown");
  assert.equal(classifyDriblCompetitionStage("F4#6", "Finals 3#6", [
    { value: "finals_4", title: "Finals Round 4" },
  ]).kind, "unknown");
  assert.equal(classifyDriblCompetitionStage("F4#6", "Finals 4#5", [
    { value: "finals_4", title: "Finals Round 4" },
  ]).kind, "unknown");
  assert.equal(classifyDriblCompetitionStage("Finals 1#1", "Round 11", [
    { value: "finals_1", title: "Finals Round 1" },
  ]).kind, "unknown");
  assert.equal(classifyDriblCompetitionStage("R20", "Finals 1#1").kind, "unknown");
  assert.equal(classifyDriblCompetitionStage("championship_1", "Grand Final").kind, "unknown");
});

test("falls back to full_round only when the native fixture round is absent", () => {
  assert.equal(classifyDriblCompetitionStage("", "Finals 1#1").code, "FW1G1");
  assert.equal(classifyDriblCompetitionStage(undefined, "Round 20").code, "R20");
});

test("recognises named finals and keeps unfamiliar labels blocked", () => {
  assert.equal(classifyDriblCompetitionStage("Semi Final").code, "SF1");
  assert.equal(classifyDriblCompetitionStage("Preliminary Final").code, "PF1");
  assert.equal(classifyDriblCompetitionStage("Grand Final").code, "GF1");
  assert.equal(classifyDriblCompetitionStage("Round 1 Finals").kind, "unknown");
  assert.equal(classifyDriblCompetitionStage("Final Round 1").kind, "unknown");
  assert.deepEqual(classifyDriblCompetitionStage("Championship decider"), {
    kind: "unknown",
    code: null,
    label: "Championship decider",
    round: null,
    countsTowardLadder: false,
  });
});

test("finals-series game codes cannot collide with each other", () => {
  const first = classifyDriblCompetitionStage("Finals 1#1");
  const second = classifyDriblCompetitionStage("Finals 1#2");
  assert.notEqual(`${first.code}-BEL-CCR`, `${second.code}-BEL-CCR`);
});

test("strict regular-season filtering keeps finals out of table inputs", () => {
  const fixtures = [
    { matchId: "R20-BEL-CCR", homeGoals: 2, awayGoals: 0 },
    { matchId: "FW1G1-BEL-CCR", homeGoals: 1, awayGoals: 1 },
    { matchId: "R0-BEL-CCR", homeGoals: 9, awayGoals: 0 },
  ];
  const ladderGoals = fixtures
    .filter((fixture) => isRegularSeasonMatchId(fixture.matchId))
    .reduce((sum, fixture) => sum + fixture.homeGoals, 0);
  assert.equal(ladderGoals, 2);
});