import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const output = join(tmpdir(), `assistant-coaching-${process.pid}.mjs`);

try {
  await build({
    entryPoints: ["src/lib/assistantConversation.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });

  const {
    ASSISTANT_FULL_SESSION_PERFORMANCE_TARGETS,
    assessAssistantFullSessionPerformance,
    assistantPageInstruction,
    assistantTurnInstruction,
    assistantTurnLimits,
    detectAssistantTurnMode,
    recentResultLines,
    resolveAssistantOpponent,
    shouldLoadAssistantCoachingEvidence,
  } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);

  const opponents = [
    "Canberra Croatia",
    "Canberra Olympic",
    "Gungahlin United",
  ];
  assert.equal(
    resolveAssistantOpponent("What sessions could I do against Croatia?", opponents),
    "Canberra Croatia",
    "a unique short club name resolves to the recorded league opponent",
  );
  assert.equal(
    resolveAssistantOpponent("How should we prepare for Canberra Olympic?", opponents),
    "Canberra Olympic",
    "a full recorded club name resolves before aliases",
  );
  assert.equal(
    resolveAssistantOpponent("What should we do against United?", ["Belconnen United", "Gungahlin United"]),
    null,
    "an ambiguous short name is not guessed",
  );
  assert.equal(
    resolveAssistantOpponent(
      "Compare Canberra Croatia and Canberra Olympic",
      opponents,
    ),
    null,
    "two full opponent names require clarification rather than picking the longest",
  );
  assert.equal(
    resolveAssistantOpponent(
      "Compare Croatia and Gungahlin",
      opponents,
    ),
    null,
    "two distinct short opponent names require clarification",
  );
  assert.equal(
    resolveAssistantOpponent("What should we work on?", opponents, "Canberra Croatia"),
    "Canberra Croatia",
    "an exact selected Hub match is the strongest opponent signal",
  );

  assert.equal(
    detectAssistantTurnMode("What sessions could I do against Croatia?", false),
    "recommendation",
    "broad opponent-session questions start with a recommendation",
  );
  assert.equal(
    detectAssistantTurnMode(
      "Based on our results and their form and my recent reflections, what should we work on?",
      false,
    ),
    "recommendation",
    "evidence-led coaching questions stay conversational",
  );
  assert.equal(
    detectAssistantTurnMode(
      "What was the score, and give us a way to win next week?",
      false,
    ),
    "recommendation",
    "hybrid outcome-and-strategy wording is classified as a coaching recommendation",
  );
  assert.equal(
    detectAssistantTurnMode(
      "What was the score show us how we win next week",
      false,
    ),
    "recommendation",
    "unpunctuated hybrid strategy wording is classified as a coaching recommendation",
  );
  assert.equal(
    detectAssistantTurnMode("Build me a full training session for that theme", false),
    "full-session",
    "an explicit build request unlocks full session detail",
  );
  assert.equal(
    detectAssistantTurnMode(
      "Yes please",
      false,
      "Would you like me to turn that into the full session?",
    ),
    "full-session",
    "an affirmative follow-up to the offer unlocks full session detail",
  );
  assert.equal(
    detectAssistantTurnMode(
      "Build it",
      false,
      "Would you like me to turn that into the full session?",
    ),
    "full-session",
    "an explicit build follow-up to the offer unlocks full session detail",
  );
  assert.equal(
    detectAssistantTurnMode(
      "Show it",
      false,
      "Would you like me to turn that into the full session?",
    ),
    "full-session",
    "an explicit show follow-up to the offer unlocks full session detail",
  );
  assert.equal(
    detectAssistantTurnMode(
      "Build it around beach football",
      false,
      "Would you like me to turn that into the full session?",
    ),
    "general",
    "a modified build request is not treated as a narrow continuation",
  );
  assert.equal(
    detectAssistantTurnMode("Give me U13 Cycle 2, week 1, session 1", true),
    "exact-session",
    "an exact curriculum reference keeps the existing complete-session path",
  );
  assert.equal(
    detectAssistantTurnMode("Build a match plan for Canberra Croatia", false),
    "match-plan",
    "match-plan requests use the dedicated analyst response mode",
  );
  assert.equal(
    detectAssistantTurnMode("Write a half-time team talk", false),
    "half-time-talk",
    "half-time requests use the live-state-safe response mode",
  );
  assert.equal(
    detectAssistantTurnMode("Pick a pre-match warm-up against Croatia", false),
    "pre-match-warm-up",
    "pre-match warm-up requests retrieve an approved practice rather than a full session",
  );
  assert.equal(
    shouldLoadAssistantCoachingEvidence(
      "exact-session",
      "Give me U13 Cycle 2, week 1, session 1",
    ),
    false,
    "exact curriculum navigation does not send unrelated private league evidence",
  );
  assert.equal(
    shouldLoadAssistantCoachingEvidence(
      "general",
      "Explain Drive-Draw-Play in simple terms",
    ),
    false,
    "general framework explanations do not send private league evidence",
  );
  assert.equal(
    shouldLoadAssistantCoachingEvidence(
      "general",
      "What did my reflections say about the last match?",
    ),
    true,
    "an explicit evidence question can access the permission-scoped context",
  );
  assert.equal(
    shouldLoadAssistantCoachingEvidence("match-plan", "Build a match plan for Croatia"),
    true,
    "match plans load permission-scoped team evidence",
  );
  assert.equal(
    shouldLoadAssistantCoachingEvidence("half-time-talk", "Write a half-time talk"),
    true,
    "half-time talks load selected-match evidence when it is available",
  );

  assert.deepEqual(
    assistantTurnLimits("full-session"),
    { contextCharBudget: 24_000, contextChunkLimit: 6, maxCompletionTokens: 6_000 },
    "a confirmed expansion uses the focused retrieval and completion limits",
  );
  assert.deepEqual(
    assistantTurnLimits("exact-session"),
    { contextCharBudget: 60_000, contextChunkLimit: 14, maxCompletionTokens: 8_192 },
    "the exact curriculum-session path keeps its original limits",
  );
  assert.deepEqual(
    ASSISTANT_FULL_SESSION_PERFORMANCE_TARGETS,
    { retrievalMs: 6_000, firstTokenMs: 8_000, totalMs: 25_000 },
    "a confirmed expansion has explicit retrieval, first-token, and end-to-end targets",
  );
  assert.deepEqual(
    assessAssistantFullSessionPerformance({
      retrievalMs: 6_000,
      firstTokenMs: 8_000,
      totalMs: 25_000,
    }),
    { retrieval: true, firstToken: true, total: true, all: true },
    "the performance boundary remains acceptable",
  );
  assert.deepEqual(
    assessAssistantFullSessionPerformance({
      retrievalMs: 6_001,
      firstTokenMs: 8_001,
      totalMs: 25_001,
    }),
    { retrieval: false, firstToken: false, total: false, all: false },
    "a regression beyond any performance target is reported",
  );

  const recommendationInstruction = assistantTurnInstruction(
    "recommendation",
    "Canberra Croatia",
  );
  assert.match(recommendationInstruction, /under about 180 words/);
  assert.match(recommendationInstruction, /without dimensions, player numbers, full rules/);
  assert.match(recommendationInstruction, /Why now/);

  const fullSessionInstruction = assistantTurnInstruction("full-session", null);
  assert.match(
    fullSessionInstruction,
    /literal section headings "Warm-Up", "1st Part", "2nd Part", and "3rd Part"/,
    "confirmed expansions keep all four runnable session sections explicit",
  );
  assert.doesNotMatch(
    assistantTurnInstruction("exact-session", null),
    /literal section headings/,
    "exact curriculum sessions keep their source-faithful 3–4-part path",
  );
  assert.match(
    assistantTurnInstruction("half-time-talk", "Canberra Croatia"),
    /What's the score, and what are you seeing\?/,
    "a half-time talk asks one focused live-state question when facts are missing",
  );
  assert.match(
    assistantTurnInstruction("pre-match-warm-up", "Canberra Croatia"),
    /Use exactly ONE canonical Coach Pack match-day warm-up/,
    "the warm-up mode uses the supplied age-group Coach Pack routine",
  );
  assert.match(
    assistantTurnInstruction("pre-match-warm-up", "Canberra Croatia"),
    /Which age group is this for\?/,
    "the warm-up mode asks for the age group instead of guessing",
  );
  assert.equal(
    detectAssistantTurnMode(
      "U13 against Canberra Croatia",
      false,
      "Which age group is this for?",
    ),
    "pre-match-warm-up",
    "an age-group clarification reply stays in protected Coach Pack warm-up mode",
  );
  assert.match(
    assistantTurnInstruction("match-plan", "Canberra Croatia"),
    /Separate Official Hub\/Dribl facts, coach-authored intent, Veo estimates/,
    "match plans preserve evidence provenance",
  );

  const pageInstruction = assistantPageInstruction("veo-match-players");
  assert.match(
    pageInstruction,
    /Veo Insights — Match, Players view/,
    "the assistant is oriented to the active Hub subview",
  );
  assert.match(
    pageInstruction,
    /cite values only when they are present in the verified Hub\/Veo context/,
    "page awareness cannot turn a screen label into invented data",
  );

  const form = recentResultLines([
    {
      matchDate: "2026/08/16",
      homeTeam: "Belconnen",
      awayTeam: "Canberra Croatia",
      homeGoals: 2,
      awayGoals: 1,
    },
    {
      matchDate: "2026/08/09",
      homeTeam: "Canberra Olympic",
      awayTeam: "Belconnen",
      homeGoals: 2,
      awayGoals: 2,
    },
    {
      matchDate: "2026/08/02",
      homeTeam: "Belconnen",
      awayTeam: "Gungahlin United",
      homeGoals: null,
      awayGoals: null,
    },
  ], "Belconnen");
  assert.deepEqual(form, [
    "2026/08/16 — W 2–1 v Canberra Croatia (home)",
    "2026/08/09 — D 2–2 v Canberra Olympic (away)",
  ], "only played official results appear, newest first");

  const [
    assistantRoute,
    contextBuilder,
    clientContext,
    matchReportPage,
    veoPage,
    veoPlayers,
    migrations,
    journalRoute,
    matchPrepRoute,
    matchReportsRoute,
  ] = await Promise.all([
    readFile("src/routes/assistant.ts", "utf8"),
    readFile("src/routes/journalInterview.ts", "utf8"),
    readFile("../bufc-hub/src/contexts/AssistantContext.tsx", "utf8"),
    readFile("../bufc-hub/src/components/MatchReportTab.tsx", "utf8"),
    readFile("../bufc-hub/src/pages/VeoInsights.tsx", "utf8"),
    readFile("../bufc-hub/src/components/veo/VeoMatchPlayers.tsx", "utf8"),
    readFile("src/startupMigrations.ts", "utf8"),
    readFile("src/routes/journal.ts", "utf8"),
    readFile("src/routes/matchPrepReports.ts", "utf8"),
    readFile("src/routes/matchReports.ts", "utf8"),
  ]);
  assert.match(
    assistantRoute,
    /includeReflections = hasModule\(user, ctx\.leagueId, "reflections"\)/,
    "reflection evidence remains gated by the league's Reflection Journal permission",
  );
  assert.match(
    assistantRoute,
    /includeMatchPrep = hasModule\(user, ctx\.leagueId, "match-prep"\)/,
    "saved prep evidence is gated by Match Prep access",
  );
  assert.match(
    assistantRoute,
    /includeVeo = hasModule\(user, ctx\.leagueId, "veo"\)/,
    "Veo evidence is gated by Veo access",
  );
  assert.match(
    assistantRoute,
    /\(ctx\.veoId != null \|\| ctx\.matchRowId != null\) && !includeMatchReports/,
    "selected-match squad evidence is rejected without Season Stats access",
  );
  assert.match(
    assistantRoute,
    /focusClub = await focusClubForLeagueRequest\(req, ctx\.leagueId\)/,
    "the Assistant resolves the signed-in request's club on the server",
  );
  assert.match(
    assistantRoute,
    /findCoachPackPreMatchWarmUps\([\s\S]*chunk\.docType === "coach_pack"[\s\S]*Pre-Match Warm-Up[\s\S]*Game Day Guidance/,
    "pre-match warm-ups retrieve only the canonical age-group Coach Pack routine",
  );
  assert.match(
    assistantRoute,
    /ages\.length !== 1[\s\S]*Which age group is this for\?/,
    "ambiguous warm-up requests ask for an age group instead of choosing a routine",
  );
  assert.match(
    contextBuilder,
    /focusClubForLeagueRequest\(req, leagueId\)[\s\S]*previousDecksVsOpponentText\(leagueId, opponent, focusClub\)[\s\S]*mondayBriefTextForOpponent\(leagueId, opponent, focusClub\)/,
    "pre-match talk resolves the authenticated club and passes it to every saved-prep lookup",
  );
  assert.match(
    contextBuilder,
    /eq\(matchPrepReportsTable\.club, club\)[\s\S]*eq\(matchPrepReportsTable\.kind, "friday"\)[\s\S]*eq\(matchPrepReportsTable\.club, club\)[\s\S]*eq\(matchPrepReportsTable\.kind, "monday"\)/,
    "Friday decks and Monday briefs are both filtered by exact club ownership",
  );
  assert.match(
    contextBuilder,
    /hasModule\(user, leagueId, "veo"\)[\s\S]*focusClub\.toLowerCase\(\) === defaultClub\.toLowerCase\(\)[\s\S]*leagueId != null && focusClub && includeVeo/,
    "pre-match talk includes legacy Veo evidence only for the authorised league focus club",
  );
  assert.match(
    contextBuilder,
    /week-ahead-brief[\s\S]*focusClubForLeagueRequest\(req, leagueId\)[\s\S]*buildWeekAheadServerEvidence\(\{[\s\S]*focusClub,[\s\S]*includeVeo/,
    "Week Ahead resolves the authenticated club before building its server evidence",
  );
  assert.match(
    contextBuilder,
    /buildWeekAheadServerEvidence[\s\S]*previousDeckText\(input\.leagueId, undefined, input\.focusClub\)[\s\S]*previousDeckText\(input\.leagueId, input\.opponent, input\.focusClub\)/,
    "Week Ahead's current and opponent deck lookups require exact club ownership",
  );
  assert.match(
    contextBuilder,
    /clubOwnsLegacyVeo\(leagueId, focusClub\)[\s\S]*clubOwnsLegacyVeo\(leagueId, focusClub\)/,
    "both legacy Veo helpers enforce the owning focus club internally",
  );
  assert.match(
    contextBuilder,
    /focusClubForLeagueRequest\(input\.request, input\.leagueId\)/,
    "the persistent coaching-context builder resolves its club from the authenticated request",
  );
  assert.match(
    assistantRoute,
    /includeVeo = includeVeo && legacyMatchContextOwned/,
    "the persistent Assistant excludes legacy Veo evidence for other clubs in the same league",
  );
  assert.match(
    assistantRoute,
    /ctx && shouldLoadCoachingEvidence\s*\?\s*buildAssistantCoachingContext/,
    "private coaching evidence is not loaded for unrelated curriculum turns",
  );
  assert.match(
    assistantRoute,
    /Promise\.all\(\[[\s\S]*buildMatchContextBlock/,
    "selected-match context loads alongside retrieval rather than serially after it",
  );
  assert.match(
    assistantRoute,
    /assistant: full-session expansion timing/,
    "full-session expansions emit retrieval, first-token, and stream timing",
  );
  assert.match(
    assistantRoute,
    /Content preservation rule \(critical\):[\s\S]*retain ALL its detail/,
    "focused expansion limits cannot weaken the selected-practice detail rule",
  );
  assert.match(
    assistantRoute,
    /An exact curriculum reference[\s\S]*should be delivered in full/,
    "the exact curriculum-session path remains explicitly complete",
  );
  assert.match(
    contextBuilder,
    /eq\(seasonsTable\.leagueId, input\.leagueId\)/,
    "a selected season is verified against the selected league",
  );
  assert.match(
    contextBuilder,
    /eq\(journalEntriesTable\.club, club\)/,
    "reflection evidence is filtered to the resolved club",
  );
  assert.match(
    contextBuilder,
    /eq\(matchPrepReportsTable\.club, club\)/,
    "saved prep evidence is filtered to the resolved club",
  );
  assert.match(
    contextBuilder,
    /eq\(matchReportsTable\.club, club\)/,
    "saved match reports are filtered to the resolved club",
  );
  assert.match(
    contextBuilder,
    /Recent player involvement \(Official Hub\/Dribl recorded appearances/,
    "the evidence pack includes permission-gated recent player involvement",
  );
  assert.match(
    contextBuilder,
    /coach-authored interpretation — not official facts or curriculum/,
    "reflection provenance stays explicit",
  );
  assert.match(
    contextBuilder,
    /Camera-derived Veo estimates — not official facts/,
    "Veo provenance stays explicit",
  );
  assert.match(
    contextBuilder,
    /blocks\.join\("\\n\\n"\)\.slice\(0, 2200\)/,
    "raw reflection evidence has a strict compact cap",
  );
  assert.match(
    contextBuilder,
    /sections\.join\("\\n\\n"\)\.slice\(0, 12000\)/,
    "the full coaching evidence pack has a strict cap",
  );
  assert.match(
    clientContext,
    /const leagueContextId = activeMatchContext\?\.leagueId \?\? effectiveSelectorLeagueId/,
    "the client sends active league context without requiring a selected match",
  );
  assert.match(
    clientContext,
    /page: pageContext/,
    "the bottom Assistant sends the active Hub page with every league-scoped question",
  );
  assert.match(
    clientContext,
    /\{ seasonId: activeSeason\.id \}/,
    "the client carries the active season when no match is explicitly selected",
  );
  assert.match(
    clientContext,
    /getDefaultHeaders\(\)/,
    "the streaming Assistant request carries the validated superadmin focus-club header",
  );
  assert.match(
    migrations,
    /ALTER TABLE journal_cycles ADD COLUMN IF NOT EXISTS club text[\s\S]*ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS club text[\s\S]*ALTER TABLE match_prep_reports ADD COLUMN IF NOT EXISTS club text[\s\S]*ALTER TABLE match_reports ADD COLUMN IF NOT EXISTS club text/,
    "private coaching tables receive an explicit club ownership field",
  );
  assert.ok(
    migrations.indexOf("CREATE TABLE IF NOT EXISTS journal_cycles")
      < migrations.indexOf("ALTER TABLE journal_cycles ADD COLUMN IF NOT EXISTS club text"),
    "club ownership migration runs after the journal tables exist on an empty database",
  );
  assert.match(
    `${journalRoute}\n${matchPrepRoute}\n${matchReportsRoute}`,
    /focusClubForLeagueRequest/,
    "private coaching writes stamp ownership from the authenticated server request",
  );
  assert.match(
    journalRoute,
    /eq\(journalCyclesTable\.club, club\)/,
    "cycle journal lists are scoped to the resolved club",
  );
  assert.match(
    journalRoute,
    /club: cycle\.club/,
    "cycle entries inherit the cycle's server-resolved club ownership",
  );
  assert.doesNotMatch(
    `${matchReportPage}\n${veoPage}\n${veoPlayers}`,
    /Ask Assistant/,
    "inline Ask Assistant buttons stay removed from report and Veo screens",
  );

  console.log("Assistant coach-first regression tests passed");
} finally {
  await unlink(output).catch(() => undefined);
}