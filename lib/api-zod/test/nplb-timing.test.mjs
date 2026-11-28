import assert from "node:assert/strict";
import test from "node:test";
import {
  goalIntervalIndex,
  matchTimelineTicks,
  matchTimingForLeague,
  veoEventMatchMinute,
  veoMatchDurationMinutes,
  veoPeriodEndMinute,
  veoPeriodStartMinute,
  veoPeriodDurationsMinutes,
  veoPeriodBreaks,
  veoPeriodLabel,
  formatVeoDuration,
  formatVeoTimelineTick,
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

test("four Veo periods extend the match clock through extra time", () => {
  const timing = matchTimingForLeague("ACT NPLM First Grade");
  const periods = veoPeriodDurationsMinutes(
    [{ duration: 45 * 60 }, { duration: 45 * 60 }, { duration: 15 * 60 }, { duration: 15 * 60 }],
    timing,
  );
  assert.equal(veoMatchDurationMinutes(periods, timing), 120);
  assert.equal(veoEventMatchMinute({ period_id: 3, period_time_ms: 60_000 }, periods, timing), 91);
  assert.equal(veoEventMatchMinute({ period_id: 4, period_time_ms: 14 * 60_000 }, periods, timing), 119);
  assert.equal(veoEventMatchMinute({ period_id: 4, period_time_ms: 20 * 60_000 }, periods, timing), 120);
  assert.deepEqual(matchTimelineTicks(timing, 120), [0, 15, 30, 45, 60, 75, 90, 105, 120]);
});

test("extra time uses the canonical competition clock despite video overruns", () => {
  const timing = matchTimingForLeague("ACT NPLM First Grade");
  const periods = veoPeriodDurationsMinutes(
    [{ duration: 47 * 60 }, { duration: 48 * 60 }, { duration: 15 * 60 }, { duration: 15 * 60 }],
    timing,
  );
  assert.equal(veoMatchDurationMinutes(periods, timing), 120);
  assert.deepEqual([0, 1, 2, 3].map((i) => veoPeriodStartMinute(i, periods, timing)), [0, 45, 90, 105]);
  assert.deepEqual([0, 1, 2, 3].map((i) => veoPeriodEndMinute(i, periods, timing)), [45, 90, 105, 120]);
  assert.equal(veoEventMatchMinute({ period_id: 3, period_time_ms: 60_000 }, periods, timing), 91);
  assert.equal(veoEventMatchMinute({ period_id: 2, period_time_ms: 48 * 60_000 }, periods, timing), 90);
  assert.equal(veoEventMatchMinute({ period_id: 4, period_time_ms: 16 * 60_000 }, periods, timing), 120);
  assert.equal(veoMatchDurationMinutes([45, 45, 13, 13], timing), 120);
});

test("two-period matches retain regulation despite video overruns", () => {
  for (const league of ["ACT NPLM First Grade", "ACT NPLB U14", "ACT NPLB U15"]) {
    const timing = matchTimingForLeague(league);
    const periods = veoPeriodDurationsMinutes(
      [{ duration: (timing.halfMinutes + 3) * 60 }, { duration: (timing.halfMinutes + 4) * 60 }],
      timing,
    );
    assert.equal(veoMatchDurationMinutes(periods, timing), timing.regulationMinutes);
    assert.equal(
      veoEventMatchMinute({ period_id: 2, period_time_ms: (timing.halfMinutes + 10) * 60_000 }, periods, timing),
      timing.regulationMinutes,
    );
  }
});

test("three thirds retain all actual playing time and exclude recording breaks", () => {
  const timing = matchTimingForLeague("ACT NPLM");
  const durations = veoPeriodDurationsMinutes([
    { duration: 1800, timeframe: [14, 1814] },
    { duration: 1826, timeframe: [2342, 4168] },
    { duration: 1165, timeframe: [4601, 5766] },
  ], timing);
  assert.equal(veoMatchDurationMinutes(durations, timing), 79.85);
  assert.equal(formatVeoDuration(veoMatchDurationMinutes(durations, timing)), "79:51");
  assert.deepEqual(durations.map(formatVeoDuration), ["30:00", "30:26", "19:25"]);
  assert.equal(formatVeoDuration(veoEventMatchMinute({ period_id: 3, period_time_ms: 60_000 }, durations, timing)), "61:26");
  assert.equal(veoEventMatchMinute({ period_id: 3, period_time_ms: 1165_000 }, durations, timing), 79.85);
  assert.equal(veoPeriodEndMinute(2, durations, timing), 79.85);
  assert.deepEqual(veoPeriodBreaks(durations, timing).map(b => ({ clock: formatVeoDuration(b.minute), label: b.label })), [
    { clock: "30:00", label: "Break 1" }, { clock: "60:26", label: "Break 2" },
  ]);
  assert.deepEqual([0, 1, 2].map(i => veoPeriodLabel(i, 3)), ["1st third", "2nd third", "3rd third"]);
  assert.deepEqual(matchTimelineTicks(timing, 79.85), [0, 15, 30, 45, 60, 75, 79.85]);
  assert.equal(matchTimelineTicks(timing, 79.85, 5).at(-1), 79.85);
  assert.equal(formatVeoTimelineTick(79.85), "79:51");
  assert.equal(formatVeoTimelineTick(45), "45'");
});

test("three long thirds are not clipped at 90 or converted to extra time", () => {
  const timing = matchTimingForLeague("ACT NPLM");
  const durations = [35, 35, 35];
  assert.equal(veoMatchDurationMinutes(durations, timing), 105);
  assert.equal(veoEventMatchMinute({ period_id: 3, period_time_ms: 34 * 60_000 }, durations, timing), 104);
  assert.deepEqual(veoPeriodBreaks([45, 45], timing), [{ minute: 45, label: "HT" }]);
  assert.deepEqual([0, 1].map(i => veoPeriodLabel(i, 2)), ["1st half", "2nd half"]);
});

test("missing four-period durations use regulation and extra-time defaults", () => {
  const timing = matchTimingForLeague("ACT NPLM First Grade");
  const periods = veoPeriodDurationsMinutes([{}, {}, {}, {}], timing);
  assert.deepEqual(periods, [45, 45, 15, 15]);
  assert.equal(veoMatchDurationMinutes(periods, timing), 120);
  const standard = matchTimingForLeague("ACT NPLW");
  assert.deepEqual(
    veoPeriodDurationsMinutes([
      {}, {},
      { timeframe: [5_400, 6_300] },
      {},
    ], standard),
    [45, 45, 15, 15],
  );
  assert.equal(
    veoMatchDurationMinutes(veoPeriodDurationsMinutes([{}, {}, {}, {}], standard), standard),
    120,
  );

  const nplb = matchTimingForLeague("ACT NPLB U14");
  const nplbPeriods = veoPeriodDurationsMinutes([{}, {}, {}, {}], nplb);
  assert.deepEqual(nplbPeriods, [35, 35, 15, 15]);
  assert.equal(veoMatchDurationMinutes(nplbPeriods, nplb), 100);
});