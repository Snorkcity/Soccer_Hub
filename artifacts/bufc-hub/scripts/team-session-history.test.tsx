import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamSessionHistory } from "../src/components/training-gps/TeamSessionHistory";
import { DEFAULT_TRAINING_FILTERS, TRAINING_REVIEW_METRICS } from "../src/components/training-gps/shared";
import { parseTrainingCsv } from "../../api-server/src/lib/gpsTrainingCsv";
import { trainingCsvFixture } from "../../api-server/src/lib/gpsTrainingFixture";

const base = parseTrainingCsv(trainingCsvFixture(), { leagueId: 1, year: "2027" }).session;
const template = base.rows[0];
const make = (id: number, date: string, distance: number) => ({
  ...base, id, date, title: `Session ${id}`,
  rows: (["warmup", "passing", "technical", "main", "end"] as const).flatMap(part => [
    { ...template, part, playerName: "A", sourceName: "A", positionCode: "CM", durationSeconds: 600, metrics: { ...template.metrics, distanceM: distance } },
    { ...template, part, playerName: "Keeper", sourceName: "Keeper", positionCode: "GK", durationSeconds: 600, metrics: { ...template.metrics, distanceM: 99999 } },
  ]),
});
const first = make(1, "2026-11-09", 1000);
const last = make(2, "2026-11-16", 500);
const render = (sessions = [last, first], metric = "distance", part = "full") => renderToStaticMarkup(
  <TeamSessionHistory sessions={sessions} session={last} filters={{ ...DEFAULT_TRAINING_FILTERS, metric, part: part as "full" }} onPick={() => {}} />,
);
const totals = render();
assert.match(totals, /50\.0% below/);
assert.match(totals, /5,000 m/);
assert.match(totals, /2,500 m/);
assert.match(totals, /1 contributing player/);
assert.ok(totals.indexOf("Session 1") < totals.indexOf("Session 2"), "dates are chronological even if input is reversed");
assert.match(totals, /select-history-metric/);
assert.match(totals, /select-history-part/);
assert.match(render(undefined, "distancePerMinute"), /50\.0 m\/min/);
assert.match(render(undefined, "distance", "main"), /500 m/);
assert.match(render([], "distance"), /No qualifying values/);
const zero = { ...first, rows: first.rows.map(r => ({ ...r, metrics: { ...r.metrics, distanceM: 0 } })) };
assert.doesNotMatch(render([zero]), /Infinity|NaN/);
assert.match(render([zero]), /0 m/);
const missing = { ...last, rows: last.rows.filter(r => r.part !== "main") };
assert.match(render([missing]), /No qualifying values/);
for (const metric of TRAINING_REVIEW_METRICS) {
  assert.doesNotMatch(render(undefined, metric.id), /NaN|Infinity/);
}
console.log("Passed historical comparison rendering: metric/part choices, totals, rates, position scope, missing/zero values, chronology and summary arithmetic.");
