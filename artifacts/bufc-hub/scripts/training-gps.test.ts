import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { trainingInsights } from "@workspace/api-zod";
import { isTrainingGpsText } from "../src/components/training-gps/detect";
import { matchesFilters } from "../src/components/training-gps/shared";
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
test("optional private Catapult CSV is correctly detected", { skip: !existsSync(privateSample) }, () => {
  assert.equal(isTrainingGpsText(readFileSync(privateSample, "utf8")), true);
});
