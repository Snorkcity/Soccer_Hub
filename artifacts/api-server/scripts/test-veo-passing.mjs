import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = join(tmpdir(), `veo-passing-${process.pid}.mjs`);

try {
  await build({
    entryPoints: ["src/lib/veoPassing.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const { countSuccessfulFrontThirdPasses } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

  const values = Array.from({ length: 18 }, (_, index) => index + 1);
  assert.equal(
    countSuccessfulFrontThirdPasses({ type: "18_zone_system", values }),
    values.slice(12).reduce((sum, value) => sum + value, 0),
  );
  assert.equal(countSuccessfulFrontThirdPasses({ type: "other", values }), null);
  assert.equal(countSuccessfulFrontThirdPasses({ type: "18_zone_system", values: values.slice(0, 17) }), null);
  assert.equal(countSuccessfulFrontThirdPasses(undefined), null);
  assert.equal(
    countSuccessfulFrontThirdPasses({
      type: "18_zone_system",
      values: [...Array(12).fill(99), 2, 3, 4, 5, 6, 7],
    }),
    27,
  );

  console.log("Veo front-third passing tests passed");
} finally {
  await unlink(output).catch(() => undefined);
}