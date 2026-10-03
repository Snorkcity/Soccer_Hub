// Exercise the actual route's pure mapper without importing its DB/server.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";
import { isNorthernNswLeague } from "../../../lib/api-zod/src/competitionSources.ts";

const route = readFileSync(new URL("../src/routes/dribl.ts", import.meta.url), "utf8");
const functionStart = route.indexOf("export function driblLeagueFor(");
const functionEnd = route.indexOf("\n// Cloudflare", functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart);
const mappingSource = route.slice(functionStart, functionEnd).replace("export function", "function");
const gradesSource = readFileSync(new URL("../src/lib/nplb2026.ts", import.meta.url), "utf8");
const grades = gradesSource.match(/export const NPLB_2026_LEAGUES = (\[[\s\S]*?\]) as const;/);
assert.ok(grades);
const { code } = transformSync(
  `const NPLB_2026_LEAGUES = ${grades[1]};\n${mappingSource}`,
  { loader: "ts", format: "cjs" },
);
const driblLeagueFor = new Function("isNorthernNswLeague", `${code}\nreturn driblLeagueFor;`)(isNorthernNswLeague);

test("Northern NSW never falls back to NSW or ACT Dribl", () => {
  for (const name of [
    "NNSW NPLW", "NPLW NNSW", "Northern NSW NPLW",
    "NPLW Northern NSW", "Northern New South Wales NPLW",
    "NNSW NPLW Reserve", "NNSW NPLM", "NNSW NPLW U23",
  ]) {
    assert.equal(driblLeagueFor(name), null, name);
  }
});

test("existing Dribl federation and grade mappings stay unchanged", () => {
  for (const [name, tenant, league] of [
    ["ACT NPLW", "capital", "NPLW 1st Grade"],
    ["ACT NPLW Reserve", "capital", "NPLW Reserve Grade"],
    ["ACT NPLM", "capital", "NPLM 1st Grade"],
    ["ACT NPLM U23", "capital", "NPLM U23"],
    ["ACT NPLB U14", "capital", "NPLB U14"],
    ["ACT NPLB U15", "capital", "NPLB U15"],
    ["ACT NPLB U16", "capital", "NPLB U16"],
    ["ACT NPLB U18", "capital", "NPLB U18"],
    ["NSW NPLW", "fdprod", "First Grade"],
    ["NPLW NSW", "fdprod", "First Grade"],
    ["NSW NPLW U23", "fdprod", "U23"],
    ["NPLW U23 NSW", "fdprod", "U23"],
    ["VIC NPLW", "fv", "NPL VIC Women"],
    ["TAS NPLM", "footballtasmania", "McDonald's National Premier League"],
  ]) {
    const mapped = driblLeagueFor(name);
    assert.equal(mapped?.tenant, tenant, name);
    assert.equal(mapped?.league, league, name);
  }
  assert.equal(driblLeagueFor("Unknown competition"), null);
});