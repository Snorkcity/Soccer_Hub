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