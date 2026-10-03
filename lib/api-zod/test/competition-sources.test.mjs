import assert from "node:assert/strict";
import test from "node:test";
import { isNorthernNswLeague } from "../src/competitionSources.ts";

test("Northern NSW source detection handles both league-name orders and grades", () => {
  for (const name of [
    "NNSW NPLW", "nnsw nplw", "NPLW NNSW", "NNSW NPLW Reserve",
    "Northern NSW NPLW", "NPLW Northern NSW", "Northern New South Wales NPLW",
  ]) {
    assert.equal(isNorthernNswLeague(name), true, name);
  }
});

test("supported Dribl leagues are not classified as Northern NSW", () => {
  for (const name of [
    "", "ACT NPLW", "NPLW Reserve", "ACT NPLM", "ACT NPLB U14",
    "ACT NPLB U15", "ACT NPLB U16", "ACT NPLB U18",
    "NSW NPLW", "NPLW NSW", "NSW NPLW U23", "VIC NPLW", "TAS NPLM",
  ]) {
    assert.equal(isNorthernNswLeague(name), false, name);
  }
});