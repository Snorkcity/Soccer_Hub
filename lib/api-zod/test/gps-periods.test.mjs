import assert from "node:assert/strict";
import test from "node:test";
import { canonicalGpsMatchSplit, summarizeGpsPeriodValues } from "../src/gpsPeriods.ts";

test("recognises Catapult match and extra-time split labels", () => {
  assert.equal(canonicalGpsMatchSplit("all"), "game");
  assert.equal(canonicalGpsMatchSplit("1st.half"), "1st.half");
  assert.equal(canonicalGpsMatchSplit("2nd.half"), "2nd.half");
  assert.equal(canonicalGpsMatchSplit("Extra-time"), "extra-time");
  assert.equal(canonicalGpsMatchSplit("extra time"), "extra-time");
});

test("rejects unknown and training period labels", () => {
  assert.equal(canonicalGpsMatchSplit("1st.third"), null);
  assert.equal(canonicalGpsMatchSplit("warm-up"), null);
});

test("whole-game totals remain authoritative while periods stay visible", () => {
  assert.deepEqual(
    summarizeGpsPeriodValues(
      { game: 12, firstHalf: 5, secondHalf: 5, extraTime: 3 },
      true,
    ),
    { regulation: 10, extraTime: 3, match: 12 },
  );
});

test("regulation plus extra time provides a 120-minute fallback without a game row", () => {
  assert.deepEqual(
    summarizeGpsPeriodValues(
      { game: null, firstHalf: 5, secondHalf: 6, extraTime: 2 },
      true,
    ),
    { regulation: 11, extraTime: 2, match: 13 },
  );
  assert.deepEqual(
    summarizeGpsPeriodValues(
      { game: null, firstHalf: 8, secondHalf: 9, extraTime: 7 },
      false,
    ),
    { regulation: 9, extraTime: 7, match: 9 },
  );
});