import assert from "node:assert/strict";
import { test } from "node:test";
import { campaignYears, competitionsForYear, resolveCampaign } from "../src/contexts/competitionSeasons.ts";

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

const campaigns = seasons.filter(s => s.leagueId !== 44)
  .map((s, i) => ({ ...s, id: i + 100, isActive: s.year === "2026" }));

test("year choices include campaigns outside the currently selected competition", () => {
  assert.deepEqual(campaignYears(campaigns), ["2027", "2026"]);
  // NPLW has only 2026, but 2027 is still selectable.
  const next = resolveCampaign(campaigns, 33, "2027");
  assert.equal(next?.year, "2027");
  assert.equal(next?.leagueId, 11);
});
test("year changes preserve a competition that exists in that year", () => {
  assert.equal(resolveCampaign(campaigns, 22, "2027")?.leagueId, 22);
  assert.equal(resolveCampaign(campaigns, 22, "2026")?.leagueId, 22);
});
test("competition changes never pull the campaign back to its active older season", () => {
  assert.equal(resolveCampaign(campaigns, 22, "2027")?.year, "2027");
  assert.equal(resolveCampaign(campaigns, 11, "2027")?.year, "2027");
});
test("access changes and stale saved selections resolve to an accessible pair", () => {
  const limited = campaigns.filter(s => s.leagueId === 33);
  assert.equal(resolveCampaign(limited, 22, "2027")?.leagueId, 33);
  assert.equal(resolveCampaign(limited, 22, "2027")?.year, "2026");
  assert.equal(resolveCampaign([], 22, "2027"), null);
});
test("initial defaults honour the selected competition's active season", () => {
  assert.equal(resolveCampaign(campaigns, 11, null)?.year, "2026");
});
