import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "csv-parse/sync";
import { parseTrainingCsv } from "./gpsTrainingCsv";
import { trainingCsvFixture } from "./gpsTrainingFixture";
import {
  trainingTotal, trainingTimetable, trainingMean, trainingValue, trainingInsights,
} from "@workspace/api-zod";

const csv = trainingCsvFixture();
const scope = { leagueId: 1, year: "2027", sourceFilename: "training.csv" };
const parsed = () => parseTrainingCsv(csv, scope);
const mutate = (change: (rows: string[][]) => void) => {
  const rows = parse(csv) as string[][];
  change(rows);
  return rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
};

test("120 synthetic rows,20 players, five parts; November2026 stays in2027 campaign", () => {
  const { session } = parsed();
  assert.equal(session.rows.length, 120);
  assert.equal(new Set(session.rows.map(r => r.playerName)).size, 20);
  assert.equal(session.rows.filter(r => r.part !== "recording").length, 100);
  assert.equal(session.date, "2026-11-09");
  assert.equal(session.year, "2027");
});
test("coaching timetable is69:20; one short player does not shorten warm-up", () => {
  const { session } = parsed();
  const parts = trainingTimetable(session);
  assert.deepEqual(parts.map(p => p.durationSeconds), [322, 799, 1063, 1197, 779]);
  assert.equal(parts.reduce((sum, p) => sum + p.durationSeconds!, 0), 4160);
  assert.equal(90 * 60 - 4160, 1240);
  assert(session.rows.some(r => r.part === "warmup" && r.durationSeconds === 223));
});
test("only selected parts contribute to totals, rates and recorded highs", () => {
  const { session } = parsed();
  const names = [...new Set(session.rows.map(r => r.playerName))];
  const means = trainingMean(names.map(name => trainingTotal(session.rows.filter(r => r.playerName === name), "distance")))!;
  assert(Math.abs(means - 5775) < .01);
  const rows = session.rows.filter(r => r.playerName === names[0]);
  const before = trainingTotal(rows, "distance");
  const altered = rows.map(r => r.part === "recording" ? { ...r, metrics: { ...r.metrics, distanceM: 1e12, topSpeedMs: 1000 } } : r);
  assert.equal(trainingTotal(altered, "distance"), before);
  assert.equal(trainingTotal(altered, "speed"), trainingTotal(rows, "speed"));
  const minutes = trainingTotal(rows, "duration")!;
  assert.equal(trainingTotal(rows, "distance", true), before! / minutes);
});
test("session rates are recalculated, not unweighted part-rate averages", () => {
  const rows = parsed().session.rows.filter(r => r.part !== "recording");
  const person = rows.filter(r => r.playerName === rows[0].playerName);
  const rate = trainingTotal(person, "distance", true)!;
  const average = trainingMean(person.map(r => trainingValue(r, "distance", true)))!;
  assert(Math.abs(rate - average) > 1);
});
test("missing measurements are not zeros or apparently complete totals", () => {
  const r = parsed().session.rows.find(r => r.part === "warmup")!;
  const missing = { ...r, metrics: { ...r.metrics, distanceM: null } };
  assert.equal(trainingValue(missing, "distance"), null);
  assert.equal(trainingTotal([r, missing], "distance"), null);
  assert.equal(trainingValue({ ...r, durationSeconds: null }, "distance", true), null);
});
test("acceleration count preserves >3 bands; rates and speed units are correct", () => {
  const r = parsed().session.rows.find(r => r.part === "technical")!;
  assert.equal(trainingValue(r, "accels"), r.metrics.accel34! + r.metrics.accelOver4!);
  assert.equal(trainingValue(r, "speed"), r.metrics.topSpeedMs! * 3.6);
  assert.equal(trainingValue(r, "accels", true), trainingValue(r, "accels")! / (r.durationSeconds! / 60));
  assert.equal(r.metrics.hsmM, r.metrics.sprintM);
  assert.equal(r.metrics.vhsmM, r.metrics.speedZone5M);
});
test("no guessed player merge: explicit mapping retains source spelling and stable roster ID", () => {
  const source = parsed().session.rows[0].playerName;
  const roster = [{ id: 500, playerName: "Confirmed identity", squad: "U23", positionCode: "GK" }];
  const output = parseTrainingCsv(csv, scope, roster, [{ sourceName: source, rosterId: 500 }]);
  const mapped = output.session.rows.filter(r => r.sourceName === source);
  assert.equal(mapped.length, 6);
  assert(mapped.every(r => r.playerName === "Confirmed identity" && r.rosterId === 500 && r.positionCode === "GK"));
  assert.equal(output.unmatchedNames.length, 19);
  assert.throws(() => parseTrainingCsv(csv, scope, roster, [{ sourceName: source, rosterId: 999 }]), /not in this campaign/);
});
test("same-initial collisions remain ambiguous unless explicitly mapped", () => {
  const source = parsed().session.rows[0].sourceName;
  const roster = [1, 2].map(id => ({ id, playerName: source, squad: String(id), positionCode: "GK" }));
  const output = parseTrainingCsv(csv, scope, roster);
  assert(output.ambiguousNames.includes(source));
  assert(output.session.rows.filter(r => r.sourceName === source).every(r => r.rosterId === null));
});
test("duplicate source rows, overlapping cuts and unknown parts are rejected", () => {
  assert.throws(() => parseTrainingCsv(mutate(rows => rows.push(rows[1])), scope), /Duplicate player\/part/);
  assert.throws(() => parseTrainingCsv(mutate(rows => {
    const split = rows[0].indexOf("Split Name"), start = rows[0].indexOf("Split Start Time");
    const r = rows.find(r => r[split] === "1st third")!;
    r[start] = "18:01:00";
  }), scope), /overlap/);
  assert.throws(() => parseTrainingCsv(mutate(rows => { rows[1][3] = "mystery"; }), scope), /Unsupported training part/);
});
test("mixed sessions, mismatched tags and malformed numbers are rejected", () => {
  assert.throws(() => parseTrainingCsv(mutate(rows => { rows[1][1] = "Another session"; }), scope), /one training session/);
  assert.throws(() => parseTrainingCsv(mutate(rows => { rows[1][4] = "game"; }), scope), /not tagged as training/);
  assert.throws(() => parseTrainingCsv(mutate(rows => { rows[1][8] = "not a number"; }), scope), /Invalid numeric/);
});
test("heart-rate issues disclosed; no fake historical claims from one session", () => {
  const { session } = parsed();
  assert(session.warnings.some(w => w.includes("Heart-rate")));
  const insights = trainingInsights(session);
  assert(insights.every(i => !i.evidence.includes("earlier complete sessions")));
  assert(insights.some(i => i.evidence.includes("End game")));
});

test("missed parts are excluded with a warning; real short participation is retained", () => {
  const input = mutate(rows => {
    const headers = rows[0];
    const duration = headers.indexOf("Duration");
    // Late player: source metrics may still contain small sensor artefacts.
    rows[2][duration] = "0";
    // Early finish: keep a genuine 18-second part but not the final placeholder.
    rows[11][duration] = "18";
    rows[12][duration] = "0";
  });
  const { session } = parseTrainingCsv(input, scope);
  const first = session.rows.filter(r => r.playerName === "P01.Sample");
  const second = session.rows.filter(r => r.playerName === "P02.Sample");
  assert.equal(session.rows.length, 118);
  assert(!first.some(r => r.part === "warmup"));
  assert(!second.some(r => r.part === "end"));
  assert.equal(second.find(r => r.part === "main")?.durationSeconds, 18);
  assert.equal(trainingTotal(first, "duration"), (799 + 1063 + 1197 + 779) / 60);
  assert.equal(trainingTotal(first, "distance"),
    trainingTotal(parsed().session.rows.filter(r => r.playerName === "P01.Sample" && r.part !== "warmup"), "distance"));
  assert.equal(trainingTotal(first, "distance", true),
    trainingTotal(first, "distance")! / trainingTotal(first, "duration")!);
  assert(session.warnings.some(w => w.includes("P01.Sample") && w.includes("0 seconds")));
  assert(session.warnings.some(w => w.includes("partial")));
  assert(trainingInsights(session).every(i => !i.evidence.includes("NaN")));
  assert.equal(trainingTimetable(session)[0].playerCount, 19);
  assert.equal(trainingTimetable(session)[0].durationSeconds, 322);
});

test("zero-only players do not block others, but an entirely zero session is rejected", () => {
  const { session } = parseTrainingCsv(mutate(rows => {
    const duration = rows[0].indexOf("Duration");
    rows.slice(2, 7).forEach(row => { row[duration] = "0"; });
  }), scope);
  assert.equal(trainingTotal(session.rows.filter(r => r.playerName === "P01.Sample"), "distance"), null);
  assert.equal(session.rows.filter(r => r.part === "warmup").length, 19);
  assert.throws(() => parseTrainingCsv(mutate(rows => {
    const duration = rows[0].indexOf("Duration");
    rows.slice(1).forEach(row => { row[duration] = "0"; });
  }), scope), /No recorded participation/);
});

test("negative, excessive, malformed and duplicate zero-duration rows still fail validation", () => {
  for (const value of ["-1", "43201", "bad"]) {
    assert.throws(() => parseTrainingCsv(mutate(rows => {
      rows[2][rows[0].indexOf("Duration")] = value;
    }), scope), /Invalid recorded participation|Invalid numeric/);
  }
  assert.throws(() => parseTrainingCsv(mutate(rows => {
    rows[2][rows[0].indexOf("Duration")] = "0";
    rows.push([...rows[2]]);
  }), scope), /Duplicate player\/part/);
  assert.throws(() => parseTrainingCsv(mutate(rows => {
    rows[2][rows[0].indexOf("Duration")] = "0";
    rows[2][rows[0].indexOf("Distance (km)")] = "invalid";
  }), scope), /Invalid numeric/);
});

const privateSample = process.env.TRAINING_GPS_CSV ?? "attached_assets/20261109-T-N_1794634643570.csv";
test("optional private sample parses without bundling player measurements in the repository", { skip: !existsSync(privateSample) }, () => {
  const { session } = parseTrainingCsv(readFileSync(privateSample, "utf8"), scope);
  assert.equal(session.rows.length, 120);
  assert.equal(new Set(session.rows.map(row => row.sourceName)).size, 20);
  assert.equal(trainingTimetable(session).reduce((n, part) => n + (part.durationSeconds ?? 0), 0), 4160);
});
