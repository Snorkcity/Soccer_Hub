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
    assistantTurnInstruction,
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
    detectAssistantTurnMode("Give me U13 Cycle 2, week 1, session 1", true),
    "exact-session",
    "an exact curriculum reference keeps the existing complete-session path",
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

  const recommendationInstruction = assistantTurnInstruction(
    "recommendation",
    "Canberra Croatia",
  );
  assert.match(recommendationInstruction, /under about 180 words/);
  assert.match(recommendationInstruction, /without dimensions, player numbers, full rules/);
  assert.match(recommendationInstruction, /Why now/);

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

  const [assistantRoute, contextBuilder, clientContext] = await Promise.all([
    readFile("src/routes/assistant.ts", "utf8"),
    readFile("src/routes/journalInterview.ts", "utf8"),
    readFile("../bufc-hub/src/contexts/AssistantContext.tsx", "utf8"),
  ]);
  assert.match(
    assistantRoute,
    /includeReflections = hasModule\(user, ctx\.leagueId, "reflections"\)/,
    "reflection evidence remains gated by the league's Reflection Journal permission",
  );
  assert.match(
    assistantRoute,
    /ctx && shouldLoadCoachingEvidence\s*\?\s*buildAssistantCoachingContext/,
    "private coaching evidence is not loaded for unrelated curriculum turns",
  );
  assert.match(
    contextBuilder,
    /eq\(seasonsTable\.leagueId, input\.leagueId\)/,
    "a selected season is verified against the selected league",
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
    /const leagueContextId = matchContext\?\.leagueId \?\? effectiveSelectorLeagueId/,
    "the client sends active league context without requiring a selected match",
  );

  console.log("Assistant coach-first regression tests passed");
} finally {
  await unlink(output).catch(() => undefined);
}