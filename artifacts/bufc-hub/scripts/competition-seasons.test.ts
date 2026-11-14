import assert from "node:assert/strict";
import { test } from "node:test";
import { competitionsForYear } from "../src/contexts/competitionSeasons.ts";

const leagues = [
  { id: 11, name: "ACT NPLM" },
  { id: 22, name: "ACT NPLM U23" },
  { id: 33, name: "ACT NPLW" },
];
const seasons = [
  { leagueId: 11, year: "2026" },
  { leagueId: 22, year: "2026" },
  { leagueId: 33, year: "2026" },
  // A campaign need not have any matches or be marked active.
  { leagueId: 11, year: "2027" },
  { leagueId: 22, year: "2027" },
  { leagueId: 44, year: "2027" },
];

test("2027 only includes authorised competitions created for 2027", () => {
  assert.deepEqual(competitionsForYear(leagues, seasons, "2027"), leagues.slice(0, 2));
});
test("previous years retain their own competitions", () => {
  assert.deepEqual(competitionsForYear(leagues, seasons, "2026"), leagues);
});
test("missing or loading years never fall back to all competitions", () => {
  assert.deepEqual(competitionsForYear(leagues, seasons, undefined), []);
  assert.deepEqual(competitionsForYear(leagues, seasons, "2028"), []);
});
test("duplicate campaigns do not duplicate a competition or mutate access options", () => {
  assert.deepEqual(competitionsForYear(leagues, [...seasons, seasons[3]], "2027"), leagues.slice(0, 2));
  assert.equal(leagues.length, 3);
});
