import assert from "node:assert/strict";
import test from "node:test";
import { canonicalGpsSplit, gpsPeriodMinutes, gpsPeriodTotal } from "../src/gps.ts";

test("canonicalises confirmed Catapult split labels only", () => {
  assert.equal(canonicalGpsSplit("all"), "game");
  assert.equal(canonicalGpsSplit("  Extra-Time "), "extra-time");
  assert.equal(canonicalGpsSplit("third"), null);
  assert.equal(canonicalGpsSplit(null), null);
});

test("unknown nonblank split is rejected rather than retained for storage", () => {
  const raw = "Third half";
  assert.equal(canonicalGpsSplit(raw), null);
  assert.notEqual(raw.trim(), "");
});

test("GPS totals keep game authoritative and fall back through ET", () => {
  const gameAndPeriods = { game: { v: 120, mins: 120 }, h1: { v: 50, mins: 45 }, h2: { v: 50, mins: 45 }, et: { v: 20, mins: 30 } };
  assert.equal(gpsPeriodTotal(gameAndPeriods, x => x.v, true), 120);
  assert.equal(gpsPeriodMinutes(gameAndPeriods, x => x.mins), 120);

  const periodsOnly = { h1: { v: 50, mins: 45 }, h2: { v: 50, mins: 45 }, et: { v: 20, mins: 30 } };
  assert.equal(gpsPeriodTotal(periodsOnly, x => x.v, true), 120);
  assert.equal(gpsPeriodTotal(periodsOnly, x => x.v, false), 50);
  assert.equal(gpsPeriodMinutes(periodsOnly, x => x.mins), 120);
});