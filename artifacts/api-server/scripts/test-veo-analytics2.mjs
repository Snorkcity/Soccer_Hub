import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = join(tmpdir(), `veo-analytics2-store-${process.pid}.mjs`);
const seasonOutput = join(tmpdir(), `veo-season-metrics-${process.pid}.mjs`);
const parserOutput = join(tmpdir(), `veo-analytics2-parser-${process.pid}.mjs`);

try {
  await build({
    entryPoints: ["src/lib/veoAnalytics2Store.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });

  const {
    analytics2StatusFromBundle,
    analytics2NeedsWork,
    canonicalShirtNumber,
    mergeAnalytics2Bundles,
    mergeAnalytics2TerminalSources,
  } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

  const prior = {
    crossMatchPlayer: { items: [{ jersey_number: 7 }] },
    physicalMetrics: [{ jerseyNumber: 7, distance: 4500 }],
    matchEvents: { events: [{ playerJersey: "07" }] },
    jerseyNumbers: { left: [7] },
  };
  const retry = {
    matchEvents: { events: [{ playerJersey: "07" }, { playerJersey: "8" }] },
  };
  const merged = mergeAnalytics2Bundles(prior, retry);

  assert.deepEqual(merged.crossMatchPlayer, prior.crossMatchPlayer);
  assert.deepEqual(merged.physicalMetrics, prior.physicalMetrics);
  assert.deepEqual(merged.jerseyNumbers, prior.jerseyNumbers);
  assert.deepEqual(merged.matchEvents, retry.matchEvents);
  assert.equal(analytics2StatusFromBundle(merged, [], "partial"), "complete");

  const mixedBundle = { physicalMetrics: prior.physicalMetrics };
  const mixedErrors = [
    { source: "crossMatchPlayer", error: "HTTP 404", terminal: true },
    { source: "matchEvents", error: "HTTP 404", terminal: true },
    { source: "jerseyNumbers", error: "no periods available", terminal: true },
  ];
  const terminalSources = mergeAnalytics2TerminalSources([], mixedBundle, mixedErrors);
  assert.deepEqual(terminalSources, ["crossMatchPlayer", "matchEvents", "jerseyNumbers"]);
  assert.equal(analytics2NeedsWork(mixedBundle, terminalSources), false);
  assert.equal(analytics2StatusFromBundle(mixedBundle, terminalSources, "partial"), "partial");

  const transientSources = mergeAnalytics2TerminalSources([], mixedBundle, [
    { source: "matchEvents", error: "HTTP 503", terminal: false },
  ]);
  assert.equal(analytics2NeedsWork(mixedBundle, transientSources), true);

  assert.equal(canonicalShirtNumber("07"), "7");
  assert.equal(canonicalShirtNumber(7), "7");
  assert.equal(canonicalShirtNumber(" 007 "), "7");
  assert.equal(canonicalShirtNumber("7A"), null);
  assert.equal(canonicalShirtNumber(""), null);

  await build({
    entryPoints: ["../bufc-hub/src/lib/veoSeasonMetrics.ts"],
    outfile: seasonOutput,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const { scopeSeasonPlayers } = await import(`${pathToFileURL(seasonOutput).href}?v=${Date.now()}`);
  const metrics = (values) => ({
    matches: 1, starts: 1, minutesPlayed: null, secondsPlayed: null,
    distanceMetres: null, avgSpeedKmh: null, topSpeedKmh: null,
    sprints: null, hir: null, goals: null, assists: null, involvements: null,
    shots: null, attempts: null, conversion: null, passes: null,
    passesSuccessful: null, passesUnsuccessful: null, passSuccess: null,
    tackles: null, dribbles: null, interceptions: null, looseRecoveries: null,
    saves: null, corners: null, freeKicks: null, throwIns: null, fouls: null,
    penalties: null, goalKicks: null, ...values,
  });
  const seasonRow = {
    identityKey: "veo:test-player",
    identity: {
      veoPlayerId: "test-player", jerseyNumber: 7, veoPlayerName: "Test Player",
      hubPlayerName: null, identityStatus: "unresolved",
    },
    totals: metrics({ matches: 2, minutesPlayed: 90, secondsPlayed: 5400, distanceMetres: 9000, goals: 3 }),
    per90: { distanceMetres: 9000, goals: 3 },
    matchCount: 2,
    matchBreakdowns: [
      {
        veoMatchId: "one", opponent: "Opponent A", startsAt: "2026-05-01T02:00:00.000Z",
        title: "Round 1", available: true, jerseyNumber: 7,
        metrics: metrics({ minutesPlayed: 60, secondsPlayed: 3600, distanceMetres: 6000, goals: 1, avgSpeedKmh: 10, topSpeedKmh: 20 }),
      },
      {
        veoMatchId: "two", opponent: "Opponent B", startsAt: "2026-05-08T02:00:00.000Z",
        title: "Round 2", available: true, jerseyNumber: 7,
        metrics: metrics({ minutesPlayed: 30, secondsPlayed: 1800, distanceMetres: 3000, goals: 2, avgSpeedKmh: 8, topSpeedKmh: 18 }),
      },
    ],
  };

  const opponentScope = scopeSeasonPlayers(
    [seasonRow],
    { opponent: "Opponent A", fromDate: "", toDate: "" },
  )[0];
  assert.equal(opponentScope.matchCount, 1);
  assert.equal(opponentScope.totals.minutesPlayed, 60);
  assert.equal(opponentScope.totals.distanceMetres, 6000);
  assert.equal(opponentScope.totals.goals, 1);
  assert.equal(opponentScope.per90.goals, 1.5);
  assert.equal(opponentScope.matchBreakdowns.length, 1);

  const dateScope = scopeSeasonPlayers(
    [seasonRow],
    { opponent: "all", fromDate: "2026-05-08", toDate: "2026-05-08" },
  )[0];
  assert.equal(dateScope.matchCount, 1);
  assert.equal(dateScope.totals.minutesPlayed, 30);
  assert.equal(dateScope.totals.distanceMetres, 3000);
  assert.equal(dateScope.totals.goals, 2);
  assert.equal(dateScope.per90.goals, 6);
  assert.equal(dateScope.matchBreakdowns[0].opponent, "Opponent B");

  await build({
    entryPoints: ["src/lib/veoAnalytics2Parser.ts"],
    outfile: parserOutput,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const { aggregateSeason, parseAnalytics2Bundle } = await import(`${pathToFileURL(parserOutput).href}?v=${Date.now()}`);
  const partialParsed = parseAnalytics2Bundle({
    physicalMetrics: [
      {
        jerseyNumber: 7, drill: "full match", distance: null, secondsPlayed: 0,
        sprints: null, hsr: null, maxSpeed: 0, averageSpeed: 0,
      },
      {
        jerseyNumber: 8, drill: "full match", distance: 0, secondsPlayed: 0,
        sprints: 0, hsr: 0, maxSpeed: 0, averageSpeed: 0,
      },
    ],
    matchEvents: {
      events: [
        { team: "Own", playerJersey: "07", eventType: "shot", videoTimeMs: 1000 },
        { team: "Own", playerJersey: "10", eventType: "pass", videoTimeMs: 2000 },
        { team: "Opp", playerJersey: "9", eventType: "shot", videoTimeMs: 3000 },
      ],
    },
    jerseyNumbers: null,
  }, "2026-08-19T00:00:00.000Z");

  assert.equal(partialParsed.coverage.hasCrossMatch, false);
  assert.equal(partialParsed.coverage.hasPhysicalMetrics, true);
  assert.equal(partialParsed.coverage.hasMesEvents, true);
  assert.equal(partialParsed.coverage.hasJerseyNumbers, true);
  assert.deepEqual(
    partialParsed.players.map((player) => player.identity.jerseyNumber).sort((a, b) => a - b),
    [7, 8, 10],
  );
  const jersey7 = partialParsed.players.find((player) => player.identity.jerseyNumber === 7);
  assert.equal(jersey7.metrics.distanceMetres, null);
  assert.equal(jersey7.metrics.sprints, null);
  assert.equal(jersey7.metrics.hir, null);
  assert.equal(jersey7.metrics.secondsPlayed, 0);
  assert.equal(jersey7.metrics.minutesPlayed, 0);
  assert.equal(jersey7.metrics.topSpeedKmh, 0);
  assert.equal(jersey7.eventTimeline.length, 1);
  const jersey8 = partialParsed.players.find((player) => player.identity.jerseyNumber === 8);
  assert.equal(jersey8.metrics.distanceMetres, 0);
  assert.equal(jersey8.metrics.sprints, 0);
  assert.equal(jersey8.metrics.hir, 0);
  const jersey10 = partialParsed.players.find((player) => player.identity.jerseyNumber === 10);
  assert.equal(jersey10.eventTimeline.length, 1);
  assert.equal(partialParsed.players.some((player) => player.identity.jerseyNumber === 9), false);

  const parsedPlayer = (hubPlayerId, jerseyNumber, distanceMetres) => ({
    identityKey: `jersey:${jerseyNumber}`,
    identity: {
      veoPlayerId: null,
      jerseyNumber,
      veoPlayerName: null,
      hubPlayerId,
      hubPlayerName: "Same Name",
      identityStatus: "resolved",
    },
    metrics: metrics({ distanceMetres }),
    unknownMetrics: {},
    eventTimeline: [],
  });
  const sameNameRows = aggregateSeason([
    {
      veoMatchId: "same-name-one", opponent: "Opponent A", startsAt: null, title: null,
      available: true, players: [parsedPlayer(101, 7, 1000)],
    },
    {
      veoMatchId: "same-name-two", opponent: "Opponent B", startsAt: null, title: null,
      available: true, players: [parsedPlayer(202, 8, 2000)],
    },
  ]);
  assert.equal(sameNameRows.length, 2);
  assert.deepEqual(sameNameRows.map((row) => row.identityKey).sort(), ["hub:101", "hub:202"]);

  const noDurableIdRows = aggregateSeason([
    {
      veoMatchId: "no-id-one", opponent: "Opponent A", startsAt: null, title: null,
      available: true, players: [parsedPlayer(null, 7, 1000)],
    },
    {
      veoMatchId: "no-id-two", opponent: "Opponent B", startsAt: null, title: null,
      available: true, players: [parsedPlayer(null, 7, 2000)],
    },
  ]);
  assert.equal(noDurableIdRows.length, 2);
  assert.deepEqual(
    noDurableIdRows.map((row) => row.identityKey).sort(),
    ["match:no-id-one:jersey:7", "match:no-id-two:jersey:7"],
  );

  console.log("Veo Analytics 2 storage, parser, identity, and season-filter tests passed");
} finally {
  await unlink(output).catch(() => undefined);
  await unlink(seasonOutput).catch(() => undefined);
  await unlink(parserOutput).catch(() => undefined);
}