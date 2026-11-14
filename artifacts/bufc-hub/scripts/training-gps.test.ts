import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { trainingInsights, trainingPlayerKey, trainingTotal, trainingValue } from "@workspace/api-zod";
import { isTrainingGpsText } from "../src/components/training-gps/detect";
import { coachPeriod, DEFAULT_TRAINING_FILTERS, matchesFilters, metricDef, playerMetricHistory, relativeStandings, selectedPlayerValues, selectedPartLabel, sortPlayerMetricHistory, sortStandings, sortTeamMetricItems, STANDING_PARTS, teamMetricData, TRAINING_METRIC_GROUPS, TRAINING_REVIEW_METRICS, trainingChartContext } from "../src/components/training-gps/shared";
import { parseTrainingCsv } from "../../api-server/src/lib/gpsTrainingCsv";
import { trainingCsvFixture } from "../../api-server/src/lib/gpsTrainingFixture";
import { metricDrillAnalysis } from "../src/components/training-gps/metricDrillAnalysis";
import { seasonGrantModules, seasonGrantAllows } from "@workspace/api-zod";

test("quoted training CSV, BOM, trimmed tag and a one-part training export are detected", () => {
  assert.equal(isTrainingGpsText(trainingCsvFixture()), true);
  assert.equal(isTrainingGpsText('\uFEFF"Tags","Split Name"\r\n" training","warmup"'), true);
  assert.equal(isTrainingGpsText('"Split Name","Tags"\n"Technical activation","training"'), true);
});

test("focused metric compares session values and means, not attendance totals", () => {
  const base = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  const names = [...new Set(base.rows.map(r => r.sourceName))].slice(0, 3);
  const make = (id: number, distances: number[]) => ({ ...base, id, date: `2026-11-${String(id + 9).padStart(2, "0")}`,
    rows: base.rows.filter(r => names.includes(r.sourceName) && distances[names.indexOf(r.sourceName)] >= 0)
      .map(r => ({ ...r, positionCode: names.indexOf(r.sourceName) === 2 ? "GK" : "CM", squad: "1sts",
        metrics: { ...r.metrics, distanceM: distances[names.indexOf(r.sourceName)] } })) });
  const first = make(1, [100, 200, 10000]);
  const second = make(2, [100, -1, 10000]);
  const key = trainingPlayerKey(first.rows[0]);
  const f = { ...DEFAULT_TRAINING_FILTERS, sessionId: "2", playerKey: key, metric: "distance", part: "main" as const };
  const result = metricDrillAnalysis([second, first], f);
  assert.equal(result.ownMean, 100);
  assert.equal(result.highest, 100);
  assert.deepEqual(result.personalRank, { rank: 1, n: 2 }, "ties share rank");
  assert.deepEqual(result.sessionRank, { rank: 1, n: 1 });
  assert.deepEqual(result.seasonRank, { rank: 2, n: 2, samples: 2, mean: 100 });
  assert(!result.seasonMeans.some(x => x.name === names[2]), "GK must not rank against outfield players");
  assert.deepEqual(result.history.map(x => x.key), ["1", "2"]);
  const gk = metricDrillAnalysis([first, second], { ...f, playerKey: trainingPlayerKey(first.rows.find(r => r.positionCode === "GK")!) });
  assert.deepEqual(gk.sessionRank, { rank: 1, n: 1 });
  assert.match(gk.cohortLabel, /Goalkeepers/);
});

test("focused drill excludes incomplete and unknown totals from rankings", () => {
  const base = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  const key = trainingPlayerKey(base.rows[0]);
  const complete = { ...base, id: 1, rows: base.rows.map(r => ({ ...r, positionCode: "CM", squad: "1sts" })) };
  const partial = { ...complete, id: 2, date: "2026-11-12",
    rows: complete.rows.filter(r => !(trainingPlayerKey(r) === key && r.part === "main")) };
  const f = { ...DEFAULT_TRAINING_FILTERS, playerKey: key, sessionId: "2" };
  const result = metricDrillAnalysis([complete, partial], f);
  assert.equal(result.currentItem?.partial, true);
  assert.equal(result.validCount, 1);
  assert.equal(result.personalRank, null);
  assert.equal(result.sessionRank, null);
  assert.equal(result.seasonRank?.samples, 1);
  const missing = metricDrillAnalysis([partial], { ...f, part: "main" });
  assert.equal(missing.currentItem?.value, null);
  assert.equal(missing.ownMean, null);
  assert.equal(missing.seasonRank, null);
  const rate = metricDrillAnalysis([complete], { ...f, sessionId: "1", perMinute: true });
  assert.equal(rate.currentItem?.value, 5300 / (4061 / 60));
});

test("campaign permission maps distinguish years and never inherit future access", () => {
  const access = { "2026": ["season-stats"], "2027": ["gps", "data-entry"] };
  assert.deepEqual(seasonGrantModules(["gps"], null, "2028"), ["gps"], "legacy all-seasons stays compatible");
  assert.deepEqual(seasonGrantModules([], access, "2026"), ["season-stats"]);
  assert.deepEqual(seasonGrantModules([], access, "2027"), ["gps", "data-entry"]);
  assert.deepEqual(seasonGrantModules(["gps"], access, "2028"), [], "explicit maps never fall back to a broad modules array");
  assert.equal(seasonGrantAllows(access, "2028"), false);
  assert.equal(seasonGrantAllows({}, "2027"), false);
  assert.deepEqual(seasonGrantModules([], access), ["season-stats", "gps", "data-entry"]);
});
test("match exports with warm-up or other cuts remain match imports", () => {
  assert.equal(isTrainingGpsText('"Tags","Split Name"\n"game","warmup"\n"game","1st half"\n"game","2nd half"'), false);
  assert.equal(isTrainingGpsText('"Tags","Split Name"\n"game","Technical activation"'), false);
  assert.equal(isTrainingGpsText('"Split Name"\n"warmup"\n"1st half"\n"2nd half"\n"Main part"'), false);
  assert.equal(isTrainingGpsText('"Split Name"\n"warmup"\n"all"'), false);
  assert.equal(isTrainingGpsText('"Split Name"\n"Passing activation"'), true);
});
test("tab-separated training text and quoted titles with embedded commas are detected", () => {
  assert.equal(isTrainingGpsText('Session Title\tSplit Name\tTags\nExample\t1st third\t training'), true);
  assert.equal(isTrainingGpsText('"Session Title","Split Name","Tags"\n"Example, quoted","2nd third"," training"'), true);
});
test("Team insights and chart cohorts use the same squad/position scope", () => {
  const session = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  session.rows = session.rows.map(row => {
    const n = Number(row.sourceName.slice(1, 3));
    return { ...row, squad: n <= 10 ? "U23" : "1sts", positionCode: n === 1 ? "GK" : n <= 10 ? "CM" : "CB" };
  });
  for (const [filter, count] of [
    [{ squad: "all", position: "outfield" }, 19],
    [{ squad: "U23", position: "outfield" }, 9],
    [{ squad: "all", position: "Goalkeepers" }, 1],
    [{ squad: "1sts", position: "Defenders" }, 10],
  ] as const) {
    const rows = session.rows.filter(row => matchesFilters(row, filter));
    assert.equal(new Set(rows.map(row => row.sourceName)).size, count);
    const insights = trainingInsights({ ...session, rows });
    assert(insights.every(insight => insight.evidence.includes(`${count} participants`)));
  }
  assert.equal(matchesFilters({ ...session.rows[0], squad: null, positionCode: null }, { squad: "all", position: "outfield" }), false);
  assert.equal(matchesFilters({ ...session.rows[0], squad: null, positionCode: null }, { squad: "all", position: "Unassigned" }), true);
});
const privateSample = process.env.TRAINING_GPS_CSV ?? "attached_assets/20261109-T-N_1794634643570.csv";
test("full session returns one combined value per player and excludes uncut recordings", () => {
  const session = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  const values = selectedPlayerValues(session, "full", "distance", false);
  assert.equal(selectedPartLabel("full"), "Full session");
  assert.equal(values.length, 20);
  assert.equal(values[0].value, 5300);
  assert.equal(values[0].duration, 4061);
  assert.equal(values[0].partial, false);
  assert.equal(selectedPlayerValues(session, "full", "distance", true)[0].value, 5300 / (4061 / 60));
  assert.equal(selectedPlayerValues(session, "full", "speed", false)[0].value, 9 * 3.6);
  assert.equal(selectedPlayerValues(session, "main", "distance", false)[0].value, 1800);
  const missing = { ...session, rows: session.rows.filter(r => !(r.playerName === values[0].name && r.part === "main")) };
  const partial = selectedPlayerValues(missing, "full", "distance", false)[0];
  assert.equal(partial.value, 3500);
  assert.equal(partial.partial, true);
  const unknown = { ...session, rows: session.rows.map(r => r.playerName === values[0].name && r.part === "main" ? { ...r, metrics: { ...r.metrics, distanceM: null } } : r) };
  assert.equal(selectedPlayerValues(unknown, "full", "distance", false)[0].value, null);
});
test("Coach full-session duration counts marked parts once and rejects incomplete timetables", () => {
  const session = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  const full = coachPeriod(session, "full");
  assert.equal(full.durationSeconds, 4160); // Not P01's 4061 or 20 players' summed time.
  assert.equal(full.players, 20);
  assert.equal(full.planMin, session.plannedMinutes);
  assert.equal(full.planMax, null);
  assert.equal(coachPeriod(session, "main").durationSeconds, 1197);
  const incomplete = { ...session, rows: session.rows.filter(r => r.part !== "main") };
  assert.equal(coachPeriod(incomplete, "full").durationSeconds, null);
  const unknown = { ...session, rows: session.rows.map(r => r.part === "main" ? { ...r, durationSeconds: null, startSeconds: null, endSeconds: null } : r) };
  assert.equal(coachPeriod(unknown, "full").durationSeconds, null);
});
test("Relative standings sort every part both ways, preserve ties, and keep missing values last", () => {
  const session = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  const first = session.rows[0].playerName;
  const last = session.rows[session.rows.length - 1].playerName;
  const rows = session.rows.filter(r => r.part !== "recording");
  const standings = relativeStandings(rows, "distance", false);
  for (const col of ["warmup", "passing", "technical", "main", "end"] as const) {
    assert.equal(sortStandings(standings, col, false)[0].name, last);
    assert.equal(sortStandings(standings, col, true)[0].name, first);
  }
  assert.equal(sortStandings(standings, "name", false)[0].name, first);
  assert.equal(sortStandings(standings, "name", true)[0].name, last);
  const tied = rows.map(r => r.part === "main" && r.playerName === first
    ? { ...r, metrics: { ...r.metrics, distanceM: 1990 } } : r);
  const tiedStandings = relativeStandings(tied, "distance", false);
  assert.equal(tiedStandings.find(r => r.name === first)?.cells[3]?.rank, 1);
  assert.equal(tiedStandings.find(r => r.name === last)?.cells[3]?.rank, 1);
  const missing = relativeStandings(rows.filter(r => r.part !== "main" || r.playerName !== first), "distance", false);
  assert.equal(missing.find(r => r.name === first)?.cells[3], null);
  assert.equal(missing.find(r => r.name === last)?.cells[3]?.n, 19);
  for (const descending of [false, true]) assert.equal(sortStandings(missing, "main", descending).at(-1)?.name, first);
  // Shorter participation moves P01 from 20th on total distance to 3rd on m/min.
  assert.equal(relativeStandings(rows, "distance", true).find(r => r.name === first)?.cells[0]?.rank, 3);
});
test("Chart context names the selected period, metric and rate units", () => {
  const session = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  const filters = { sessionId: null, metric: "distance", perMinute: true, part: "technical" as const, playerKey: null, squad: "all", position: "outfield" };
  assert.match(trainingChartContext(filters, session), /Selected: Technical activation/);
  assert.match(trainingChartContext(filters, session), /m\/min/);
  assert.match(trainingChartContext({ ...filters, part: "full" }, session), /Selected: Full session/);
});
test("Relative standings include sortable full-session totals and omit incomplete totals", () => {
  const session = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  const first = session.rows[0].playerName;
  const last = session.rows.at(-1)!.playerName;
  const fullIndex = STANDING_PARTS.findIndex(p => p.id === "full");
  assert.equal(fullIndex, 5);
  const standings = relativeStandings(session.rows, "distance", false);
  assert.equal(standings.length, 20); // Uncut rows do not add participants.
  assert(standings.every(s => s.cells.length === 6));
  assert.deepEqual(standings.find(s => s.name === first)?.cells[fullIndex], { rank: 20, n: 20 });
  assert.equal(sortStandings(standings, "full", false)[0].name, last);
  assert.equal(sortStandings(standings, "full", true)[0].name, first);
  assert(relativeStandings(session.rows, "speed", false).every(s => s.cells[fullIndex]?.rank === 1));
  const missing = relativeStandings(session.rows.filter(r => !(r.playerName === first && r.part === "main")), "distance", false);
  assert.equal(missing.find(s => s.name === first)?.cells[fullIndex], null);
  assert.equal(missing.find(s => s.name === last)?.cells[fullIndex]?.n, 19);
  for (const descending of [false, true]) assert.equal(sortStandings(missing, "full", descending).at(-1)?.name, first);
});
test("Team chart metrics use their own rate setting, apply filters and exclude partial totals from references", () => {
  const session = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  const first = session.rows[0].playerName;
  const last = session.rows.at(-1)!.playerName;
  session.rows = session.rows.map(r => ({ ...r, positionCode: r.playerName === last ? "GK" : "CB", squad: "1sts" }));
  const f = { sessionId: null, metric: "speed", perMinute: true, part: "full" as const, playerKey: null, squad: "all", position: "outfield" };
  const distance = teamMetricData(session, f, "distance");
  assert.equal(distance.items.length, 19);
  assert.equal(distance.n, 19);
  assert.equal(distance.pm, true); // Global selected metric is a peak, but this distance chart still uses rates.
  assert.equal(distance.items[0].value, 5300 / (4061 / 60));
  assert.equal(distance.total, null); // Never add individual rates.
  const speed = teamMetricData(session, f, "speed");
  assert.equal(speed.pm, false);
  assert.equal(speed.total, null); // Never sum peaks.
  assert(Math.abs(speed.mean! - 9 * 3.6) < 1e-9);
  const totals = teamMetricData(session, { ...f, perMinute: false }, "distance");
  assert.equal(totals.total, 19 * 5300 + 50 * (18 * 19 / 2));
  assert.equal(totals.mean, totals.total! / 19);
  const partial = { ...session, rows: session.rows.filter(r => !(r.playerName === first && r.part === "main")) };
  const chart = teamMetricData(partial, { ...f, perMinute: false }, "distance");
  assert.equal(chart.items[0].partial, true);
  assert.equal(chart.items[0].value, 3500);
  assert.equal(chart.n, 18);
  assert.equal(chart.total, totals.total! - 5300);
  const goalkeeper = teamMetricData(session, { ...f, position: "Goalkeepers" }, "distance");
  assert.equal(goalkeeper.items.length, 1);
  assert.equal(goalkeeper.items[0].name, last);
  const noPlayers = teamMetricData(session, { ...f, squad: "U23" }, "distance");
  assert.equal(noPlayers.mean, null);
  assert.equal(noPlayers.total, null);
  assert.equal(noPlayers.n, 0);
});
test("Training defaults to Full session; chart sorting keeps missing last, handles zero and does not mutate input", () => {
  assert.equal(DEFAULT_TRAINING_FILTERS.part, "full");
  assert.equal(DEFAULT_TRAINING_FILTERS.perMinute, false);
  const values = [
    { name: "C.Player", value: null },
    { name: "B.Player", value: 10 },
    { name: "A.Player", value: 10 },
    { name: "D.Player", value: 0 },
    { name: "E.Player", value: 30 },
  ];
  assert.deepEqual(sortTeamMetricItems(values, "highest").map(p => p.name), ["E.Player", "A.Player", "B.Player", "D.Player", "C.Player"]);
  assert.deepEqual(sortTeamMetricItems(values, "lowest").map(p => p.name), ["D.Player", "A.Player", "B.Player", "E.Player", "C.Player"]);
  assert.deepEqual(sortTeamMetricItems(values, "name").map(p => p.name), ["A.Player", "B.Player", "C.Player", "D.Player", "E.Player"]);
  assert.equal(values[0].name, "C.Player");
  assert.equal(values[4].name, "E.Player");
});
test("Independent chart rate choices recalculate their own values without changing the session filters", () => {
  const session = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  session.rows = session.rows.map(r => ({ ...r, positionCode: "CB", squad: "1sts" }));
  const filters = { ...DEFAULT_TRAINING_FILTERS };
  const distanceTotals = teamMetricData(session, { ...filters, perMinute: false }, "distance");
  const distanceRate = teamMetricData(session, { ...filters, perMinute: true }, "distance");
  const powerTotals = teamMetricData(session, { ...filters, perMinute: false }, "power");
  const powerRate = teamMetricData(session, { ...filters, perMinute: true }, "power");
  assert.equal(distanceTotals.items[0].value, 5300);
  assert.equal(distanceRate.items[0].value, 5300 / (4061 / 60));
  assert.equal(distanceRate.total, null);
  assert.equal(powerTotals.items[0].value, 15);
  assert.equal(powerRate.items[0].value, 15 / (4061 / 60));
  assert.equal(powerRate.total, null);
  assert.equal(filters.perMinute, false);
  assert.deepEqual(teamMetricData(session, filters, "distance"), distanceTotals);
});
test("optional private Catapult CSV is correctly detected", { skip: !existsSync(privateSample) }, () => {
  assert.equal(isTrainingGpsText(readFileSync(privateSample, "utf8")), true);
});

test("Player and Team share the curated charts, with just two acceleration charts", () => {
  const ids = TRAINING_METRIC_GROUPS.flatMap(g => g.metrics);
  assert.equal(TRAINING_METRIC_GROUPS.length, 3);
  assert.equal(ids.length, new Set(ids).size);
  assert.deepEqual(ids, ["distance", "distancePerMinute", "load", "power", "duration", "hsm", "vhsm", "speed", "accels", "decels"]);
  assert.deepEqual(TRAINING_METRIC_GROUPS.find(g => g.id === "accel")?.metrics, ["accels", "decels"]);
  assert.deepEqual(TRAINING_REVIEW_METRICS.map(m => m.id), ids);
  assert.equal(metricDef("load").label, "Player Load");
  assert(!TRAINING_REVIEW_METRICS.some(m => m.label.includes("Catapult")));
  const session = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  assert.equal(selectedPlayerValues(session, "full", "hsm", false)[0].value,
    selectedPlayerValues(session, "full", "sprint", false)[0].value,
    "Removed source sprint chart was duplicating HSM; source measurements stay available");
});

test("Player metric history uses personal full-session totals, own durations, selected parts and peaks", () => {
  const session = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  const key = trainingPlayerKey(session.rows[0]);
  assert.equal(playerMetricHistory([session], key, "full", "distance", false)[0].value, 5300);
  assert.equal(playerMetricHistory([session], key, "full", "distance", true)[0].value, 5300 / (4061 / 60));
  assert.equal(playerMetricHistory([session], key, "full", "distance", true)[0].duration, 4061);
  assert.equal(playerMetricHistory([session], key, "main", "distance", false)[0].value, 1800);
  assert.equal(playerMetricHistory([session], key, "main", "distance", true)[0].value, 1800 / (1197 / 60));
  assert.equal(playerMetricHistory([session], key, "full", "speed", true)[0].value, 9 * 3.6);
  assert.equal(playerMetricHistory([session], key, "full", "duration", true)[0].value, 4061 / 60);
  assert.equal(playerMetricHistory([session], key, "full", "distance", false)[0].parts, 5);
  assert.equal(playerMetricHistory([session], key, "full", "distance", false)[0].partial, false);
  assert.deepEqual(playerMetricHistory([session], "source:untracked", "full", "distance", false), []);
  assert.deepEqual(playerMetricHistory([], key, "full", "distance", false), []);
});

test("Distance per minute is explicit throughout review and uses personal duration-weighted rates", () => {
  const session = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  const key = trainingPlayerKey(session.rows[0]);
  const rows = session.rows.filter(r => trainingPlayerKey(r) === key);
  const part = rows.find(r => r.part === "main")!;
  assert.equal(metricDef("distancePerMinute").unit, "m/min");
  assert.equal(metricDef("distancePerMinute").rate, false, "An existing rate cannot be divided by minutes again");
  assert.equal(trainingValue(part, "distancePerMinute"), 1800 / (1197 / 60));
  assert.equal(trainingValue(part, "distancePerMinute", true), trainingValue(part, "distancePerMinute"));
  assert.equal(trainingTotal(rows, "distancePerMinute"), 5300 / (4061 / 60));
  assert.equal(trainingTotal(rows, "distancePerMinute", true), trainingTotal(rows, "distancePerMinute"));
  assert.notEqual(trainingTotal(rows, "distancePerMinute"),
    rows.filter(r => r.part !== "recording").reduce((sum, r) => sum + trainingValue(r, "distancePerMinute")!, 0) / 5);
  for (const durationSeconds of [null, 0, -1]) {
    assert.equal(trainingValue({ ...part, durationSeconds }, "distancePerMinute"), null);
    assert.equal(trainingTotal([{ ...part, durationSeconds }], "distancePerMinute"), null);
  }
  assert.equal(trainingValue({ ...part, metrics: { ...part.metrics, distanceM: null } }, "distancePerMinute"), null);
  assert.equal(trainingValue({ ...part, metrics: { ...part.metrics, distanceM: 0 } }, "distancePerMinute"), 0);
  assert.deepEqual(selectedPlayerValues(session, "full", "distancePerMinute", false),
    selectedPlayerValues(session, "full", "distance", true));
  assert.deepEqual(relativeStandings(session.rows, "distancePerMinute", false), relativeStandings(session.rows, "distance", true));
  assert.deepEqual(playerMetricHistory([session], key, "full", "distancePerMinute", false),
    playerMetricHistory([session], key, "full", "distance", true));
  const f = { ...DEFAULT_TRAINING_FILTERS, metric: "distancePerMinute", playerKey: key };
  const chart = teamMetricData(session, f, f.metric);
  assert.equal(chart.total, null, "Do not sum player rates into a squad total");
  assert.deepEqual(chart.items, teamMetricData(session, { ...f, metric: "distance", perMinute: true }, "distance").items);
  const drill = metricDrillAnalysis([session], f);
  const priorDrill = metricDrillAnalysis([session], { ...f, metric: "distance", perMinute: true });
  assert.equal(drill.ownMean, priorDrill.ownMean);
  assert.deepEqual(drill.sessionRank, priorDrill.sessionRank);
  assert.deepEqual(drill.seasonRank, priorDrill.seasonRank);
  assert.match(trainingChartContext(f, session), /Distance per minute \(m\/min\)/);
});

test("Player history distinguishes zero, missing parts, unknown measurements and untracked sessions", () => {
  const session = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
  const key = trainingPlayerKey(session.rows[0]);
  const missing = { ...session, rows: session.rows.filter(r => !(trainingPlayerKey(r) === key && r.part === "main")) };
  const partial = playerMetricHistory([missing], key, "full", "distance", false)[0];
  assert.equal(partial.value, 3500);
  assert.equal(partial.parts, 4);
  assert.equal(partial.partial, true);
  const absentPart = playerMetricHistory([missing], key, "main", "distance", false)[0];
  assert.equal(absentPart.value, null);
  assert.equal(absentPart.duration, null);
  const zero = { ...session, rows: session.rows.map(r => trainingPlayerKey(r) === key
    ? { ...r, metrics: { ...r.metrics, distanceM: 0 } } : r) };
  assert.equal(playerMetricHistory([zero], key, "full", "distance", false)[0].value, 0);
  const unknown = { ...session, rows: session.rows.map(r => trainingPlayerKey(r) === key && r.part === "main"
    ? { ...r, metrics: { ...r.metrics, distanceM: null } } : r) };
  assert.equal(playerMetricHistory([unknown], key, "full", "distance", false)[0].value, null);
  const recordingOnly = { ...session, rows: session.rows.filter(r => trainingPlayerKey(r) !== key || r.part === "recording") };
  assert.deepEqual(playerMetricHistory([recordingOnly], key, "full", "distance", false), []);
});

test("Player chart date order puts newest at the right; numeric sorts keep missing last and ties chronological", () => {
  const values = [
    { key: "missing", date: "2026-11-10", version: 1, value: null },
    { key: "newest", date: "2027-01-10", version: 1, value: 10 },
    { key: "earlier-version", date: "2026-11-09", version: 1, value: 10 },
    { key: "zero", date: "2026-11-12", version: 1, value: 0 },
    { key: "later-version", date: "2026-11-09", version: 2, value: 10 },
    { key: "highest", date: "2026-11-08", version: 1, value: 30 },
  ];
  assert.deepEqual(sortPlayerMetricHistory(values).map(x => x.key),
    ["highest", "earlier-version", "later-version", "missing", "zero", "newest"]);
  assert.deepEqual(sortPlayerMetricHistory(values, "highest").map(x => x.key),
    ["highest", "earlier-version", "later-version", "newest", "zero", "missing"]);
  assert.deepEqual(sortPlayerMetricHistory(values, "lowest").map(x => x.key),
    ["zero", "earlier-version", "later-version", "newest", "highest", "missing"]);
  assert.equal(values[0].key, "missing");
  assert.equal(values[5].key, "highest");
});
