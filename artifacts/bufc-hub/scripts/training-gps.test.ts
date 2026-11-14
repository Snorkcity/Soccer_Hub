import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { trainingInsights } from "@workspace/api-zod";
import { isTrainingGpsText } from "../src/components/training-gps/detect";
import { coachPeriod, matchesFilters, relativeStandings, selectedPlayerValues, selectedPartLabel, sortStandings, trainingChartContext } from "../src/components/training-gps/shared";
import { parseTrainingCsv } from "../../api-server/src/lib/gpsTrainingCsv";
import { trainingCsvFixture } from "../../api-server/src/lib/gpsTrainingFixture";

test("quoted training CSV, BOM, trimmed tag and a one-part training export are detected", () => {
  assert.equal(isTrainingGpsText(trainingCsvFixture()), true);
  assert.equal(isTrainingGpsText('\uFEFF"Tags","Split Name"\r\n" training","warmup"'), true);
  assert.equal(isTrainingGpsText('"Split Name","Tags"\n"Technical activation","training"'), true);
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
test("optional private Catapult CSV is correctly detected", { skip: !existsSync(privateSample) }, () => {
  assert.equal(isTrainingGpsText(readFileSync(privateSample, "utf8")), true);
});
