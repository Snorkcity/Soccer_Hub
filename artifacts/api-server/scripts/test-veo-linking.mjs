import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = join(tmpdir(), `veo-linking-${process.pid}.mjs`);

try {
  await build({
    entryPoints: ["src/lib/veoLinking.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const {
    hubCalendarDate,
    planExactDateAutoLinks,
    sydneyCalendarDate,
  } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

  const recording = (values = {}) => ({
    id: 1,
    opponent: null,
    title: null,
    startsAt: "2026-07-11T23:30:00.000Z",
    matchId: null,
    ...values,
  });
  const fixture = (values = {}) => ({
    id: 101,
    matchDate: "2026/07/12",
    opponent: "Canberra Olympic",
    ...values,
  });

  assert.equal(sydneyCalendarDate("2026-07-11T23:30:00.000Z"), "2026-07-12");
  assert.equal(hubCalendarDate("2026/7/2"), "2026-07-02");
  assert.equal(sydneyCalendarDate("not-a-date"), null);
  assert.equal(hubCalendarDate(null), null);

  // Both Australian daylight-saving boundaries retain the correct local day.
  assert.equal(sydneyCalendarDate("2026-04-04T15:30:00.000Z"), "2026-04-05");
  assert.equal(sydneyCalendarDate("2026-10-03T16:30:00.000Z"), "2026-10-04");

  // Exact date is primary: a single same-day fixture links despite a bad title.
  assert.deepEqual(
    planExactDateAutoLinks(
      [recording({ title: "training clip no reliable opponent" })],
      [fixture()],
    ),
    { links: [{ veoId: 1, matchId: 101 }], ambiguous: 0, unmatched: 0 },
  );

  // An adjacent-day fixture must not link, even if the opponent/title matches.
  assert.deepEqual(
    planExactDateAutoLinks(
      [recording({ opponent: "Canberra Olympic", title: "Canberra Olympic" })],
      [fixture({ matchDate: "2026/07/13" })],
    ),
    { links: [], ambiguous: 0, unmatched: 1 },
  );

  // Recorded opponent settles a genuine same-day tie.
  assert.deepEqual(
    planExactDateAutoLinks(
      [recording({ opponent: "Gungahlin United", title: "unreliable title" })],
      [
        fixture(),
        fixture({ id: 102, opponent: "Gungahlin United" }),
      ],
    ),
    { links: [{ veoId: 1, matchId: 102 }], ambiguous: 0, unmatched: 0 },
  );

  // A normalised title is only a fallback tie-breaker.
  assert.deepEqual(
    planExactDateAutoLinks(
      [recording({ title: "Round 9 - BUFC v Canberra Olympic FC" })],
      [
        fixture(),
        fixture({ id: 102, opponent: "Gungahlin United" }),
      ],
    ),
    { links: [{ veoId: 1, matchId: 101 }], ambiguous: 0, unmatched: 0 },
  );

  // Same-day ties without one decisive metadata match remain manual work.
  assert.deepEqual(
    planExactDateAutoLinks(
      [recording({ title: "Saturday match" })],
      [fixture(), fixture({ id: 102, opponent: "Gungahlin United" })],
    ),
    { links: [], ambiguous: 1, unmatched: 0 },
  );

  // Missing or malformed recording dates remain unlinked.
  assert.deepEqual(
    planExactDateAutoLinks(
      [
        recording({ id: 1, startsAt: null }),
        recording({ id: 2, startsAt: "not-a-date" }),
      ],
      [fixture()],
    ),
    { links: [], ambiguous: 0, unmatched: 2 },
  );

  // Duplicate recordings can never claim the same fixture twice.
  assert.deepEqual(
    planExactDateAutoLinks(
      [recording({ id: 1 }), recording({ id: 2 })],
      [fixture()],
    ),
    {
      links: [{ veoId: 1, matchId: 101 }],
      ambiguous: 0,
      unmatched: 1,
    },
  );

  // Existing/manual links are preserved and reserve their Hub fixture.
  assert.deepEqual(
    planExactDateAutoLinks(
      [
        recording({ id: 1, matchId: 101 }),
        recording({ id: 2 }),
      ],
      [fixture()],
    ),
    { links: [], ambiguous: 0, unmatched: 1 },
  );

  console.log("Veo exact-date linking tests passed");
} finally {
  await unlink(output).catch(() => undefined);
}