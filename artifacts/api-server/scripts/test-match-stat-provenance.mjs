import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = join(tmpdir(), `match-stat-provenance-${process.pid}.mjs`);

try {
  await build({
    entryPoints: ["src/lib/matchStatisticProvenance.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });

  const {
    matchStatisticKeys,
    manualMatchStatisticSourceUpdates,
    normaliseMatchStatisticSource,
    shouldBackfillMatchStatistic,
    veoMatchStatisticUpdates,
  } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

  const fresh = {
    possession: "54.2",
    shots: 12,
    oppShots: 7,
    passes: 321,
    oppPasses: 278,
  };
  const blank = Object.fromEntries(
    matchStatisticKeys.flatMap((key) => [
      [key, null],
      [`${key}Source`, "unknown"],
    ]),
  );
  assert.deepEqual(
    veoMatchStatisticUpdates(blank, fresh),
    {
      possession: "54.2",
      possessionSource: "veo",
      shots: 12,
      shotsSource: "veo",
      oppShots: 7,
      oppShotsSource: "veo",
      passes: 321,
      passesSource: "veo",
      oppPasses: 278,
      oppPassesSource: "veo",
    },
    "routine Veo sync fills every missing statistic",
  );

  const existing = Object.fromEntries(
    matchStatisticKeys.flatMap((key) => [
      [key, 1],
      [`${key}Source`, "unknown"],
    ]),
  );
  assert.deepEqual(
    veoMatchStatisticUpdates(existing, fresh),
    {},
    "routine Veo sync only fills missing values",
  );

  for (const key of matchStatisticKeys) {
    const mixed = {
      ...existing,
      ...Object.fromEntries(
        matchStatisticKeys.map((candidate) => [
          `${candidate}Source`,
          candidate === key
            ? "official"
            : candidate === "possession" || candidate === "passes"
              ? "veo"
              : "unknown",
        ]),
      ),
    };
    const updates = veoMatchStatisticUpdates(mixed, fresh, true);
    assert.equal(
      updates[key],
      undefined,
      `${key}: re-fetch protects official value`,
    );
    assert.equal(
      updates[`${key}Source`],
      undefined,
      `${key}: re-fetch protects official provenance`,
    );
    for (const candidate of matchStatisticKeys.filter(
      (candidate) => candidate !== key,
    )) {
      assert.equal(
        updates[candidate],
        fresh[candidate],
        `${key}: ${candidate} still refreshes`,
      );
      assert.equal(
        updates[`${candidate}Source`],
        "veo",
        `${key}: ${candidate} records Veo provenance`,
      );
    }
  }

  assert.deepEqual(
    manualMatchStatisticSourceUpdates({ shots: 9, passes: 260 }),
    { shotsSource: "official", passesSource: "official" },
    "manual partial update must not relabel untouched Veo statistics",
  );
  assert.deepEqual(
    manualMatchStatisticSourceUpdates({ possession: null, oppShots: 3 }),
    { possessionSource: "unknown", oppShotsSource: "official" },
    "clearing a manual value returns it to unknown provenance",
  );

  for (const invalid of [null, undefined, "", "manual", "OFFICIAL", 12]) {
    assert.equal(
      normaliseMatchStatisticSource(invalid),
      "unknown",
      `normalise ${String(invalid)}`,
    );
    assert.equal(
      shouldBackfillMatchStatistic(11, invalid, 42, true),
      true,
      `invalid ${String(invalid)} behaves as legacy unknown during a re-fetch`,
    );
  }
  assert.equal(normaliseMatchStatisticSource("official"), "official");
  assert.equal(normaliseMatchStatisticSource("veo"), "veo");

  console.log("Match-stat provenance tests passed");
} finally {
  await unlink(output).catch(() => undefined);
}
