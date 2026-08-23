import assert from "node:assert/strict";
import test from "node:test";
import {
  goalIntervalIndex,
  matchTimelineTicks,
  matchTimingForLeague,
  veoEventMatchMinute,
  veoPeriodDurationsMinutes,
} from "../src/nplb.ts";

const gradeCases = [
  {
    league: "ACT NPLB U14",
    regulationMinutes: 70,
    halfMinutes: 35,
    labels: ["0-17", "18-35", "36-53", "54-70"],
    boundaries: [[17, 0], [18, 1], [35, 1], [36, 2], [53, 2], [54, 3], [70, 3], [71, 3]],
  },
  {
    league: "ACT NPLB U15",
    regulationMinutes: 80,
    halfMinutes: 40,
    labels: ["0-20", "21-40", "41-60", "61-80"],
    boundaries: [[20, 0], [21, 1], [40, 1], [41, 2], [60, 2], [61, 3], [80, 3], [81, 3]],
  },
];

for (const grade of gradeCases) {
  test(`${grade.league} uses its exact regulation intervals`, () => {
    const timing = matchTimingForLeague(grade.league);
    assert.equal(timing.regulationMinutes, grade.regulationMinutes);
    assert.equal(timing.halfMinutes, grade.halfMinutes);
    assert.deepEqual(timing.goalIntervals.map((interval) => interval.label), grade.labels);
    assert.equal(goalIntervalIndex(null, timing), null);
    assert.equal(goalIntervalIndex(undefined, timing), null);
    assert.equal(goalIntervalIndex(Number.NaN, timing), null);
    for (const [minute, expectedIndex] of grade.boundaries) {
      assert.equal(goalIntervalIndex(minute, timing), expectedIndex, `minute ${minute}`);
    }
    assert.equal(matchTimelineTicks(timing).at(-1), grade.regulationMinutes);
  });

  test(`${grade.league} Veo periods use grade fallback and clamp stoppage`, () => {
    const timing = matchTimingForLeague(grade.league);
    const fallbackPeriods = veoPeriodDurationsMinutes([{}, {}], timing);
    assert.deepEqual(fallbackPeriods, [grade.halfMinutes, grade.halfMinutes]);
    assert.equal(
      veoEventMatchMinute({ period_id: 2, period_time_ms: 3 * 60_000 }, fallbackPeriods, timing),
      grade.halfMinutes + 3,
    );
    assert.equal(
      veoEventMatchMinute(
        { period_id: 2, period_time_ms: (grade.halfMinutes + 5) * 60_000 },
        fallbackPeriods,
        timing,
      ),
      grade.regulationMinutes,
    );
  });
}

test("U16, U18, U23 and First Grade remain 90 minutes", () => {
  for (const league of ["ACT NPLB U16", "ACT NPLB U18", "ACT NPLM U23", "ACT NPLM First Grade"]) {
    assert.equal(matchTimingForLeague(league).regulationMinutes, 90, league);
  }
});

test("real Veo period duration wins over the grade fallback", () => {
  const timing = matchTimingForLeague("ACT NPLB U14");
  const periods = veoPeriodDurationsMinutes(
    [{ duration: 36 * 60 }, { duration: 37 * 60 }],
    timing,
  );
  assert.equal(
    veoEventMatchMinute({ period_id: 2, period_time_ms: 60_000 }, periods, timing),
    37,
  );
});