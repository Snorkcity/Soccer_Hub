/**
 * Reflection journal field definitions — mirror of the A-diploma "Reality
 * Based Journal" template blocks. Field ids are the keys stored in
 * journal_entries.content (jsonb) — do not rename without a data migration.
 */

export type JournalCycleKind =
  | "weekly_planner"
  | "weekly_review"
  | "game_preview"
  | "game_tactics"
  | "game_analysis";

export type JournalStandaloneKind = "session_reflection" | "match_reflection";
export type JournalKind = JournalCycleKind | JournalStandaloneKind;

export interface JournalField {
  id: string;
  label: string;
  hint?: string;
  short?: boolean; // one-line input instead of textarea
}

export interface JournalKindDef {
  kind: JournalKind;
  title: string;
  blurb: string;
  fields: JournalField[];
}

export const CYCLE_KIND_ORDER: JournalCycleKind[] = [
  "weekly_planner",
  "weekly_review",
  "game_preview",
  "game_tactics",
  "game_analysis",
];

export const KIND_DEFS: Record<JournalKind, JournalKindDef> = {
  weekly_planner: {
    kind: "weekly_planner",
    title: "Weekly Planner",
    blurb: "What this week is trying to achieve, on and off the field.",
    fields: [
      { id: "trainingOutcomes", label: "Training Outcomes" },
      { id: "prepRecovery", label: "Preparation & Recovery Outcomes" },
      { id: "ipp", label: "Individual Performance Plan" },
      { id: "toDoOnField", label: "To Do — On Field" },
      { id: "toDoOffField", label: "To Do — Off Field" },
      { id: "healthyHabits", label: "Healthy Habits — what habits are we looking to develop?" },
    ],
  },
  weekly_review: {
    kind: "weekly_review",
    title: "Weekly Review & Reflection",
    blurb: "The five course reflection questions for the week.",
    fields: [
      { id: "teamAchieved", label: "What did the team achieve this week?" },
      { id: "missedOpportunity", label: "Did I miss an opportunity to get better this week?" },
      { id: "mostProud", label: "What am I most proud of this week and why?" },
      { id: "feelings", label: "What feelings/emotions did I experience this week? When and why?" },
      { id: "doBetter", label: "What can I do better next week?" },
    ],
  },
  game_preview: {
    kind: "game_preview",
    title: "Game Preview",
    blurb: "Opposition analysis before the game.",
    fields: [
      { id: "opposition", label: "Opposition", short: true },
      { id: "kickOff", label: "Kick Off Time", short: true },
      { id: "venue", label: "Venue", short: true },
      { id: "strengths", label: "Opposition Strengths" },
      { id: "weaknesses", label: "Opposition Weaknesses" },
      { id: "inPossession", label: "Opposition In Possession" },
      { id: "outOfPossession", label: "Opposition Out of Possession" },
      { id: "individuals", label: "Key Individuals" },
    ],
  },
  game_tactics: {
    kind: "game_tactics",
    title: "Game Tactics",
    blurb: "Our plan for the game, including set plays.",
    fields: [
      { id: "inPossession", label: "In Possession" },
      { id: "outOfPossession", label: "Out of Possession" },
      { id: "transitions", label: "Transitions" },
      { id: "individuals", label: "Individuals" },
      { id: "setPieces", label: "Set Pieces" },
    ],
  },
  game_analysis: {
    kind: "game_analysis",
    title: "Game Analysis & Reflections",
    blurb: "Review of the game after it's played.",
    fields: [
      { id: "teamStrengths", label: "Team Strengths" },
      { id: "teamImprovements", label: "Team Areas of Improvement" },
      { id: "individualStrengths", label: "Individual Strengths" },
      { id: "individualImprovements", label: "Individual Areas of Improvement" },
      { id: "wentWell", label: "What went well this week?" },
      { id: "canImprove", label: "What can be improved this week?" },
    ],
  },
  session_reflection: {
    kind: "session_reflection",
    title: "Training Reflection",
    blurb: "Quick reflection after a training session.",
    fields: [
      { id: "wentWell", label: "What went well?" },
      { id: "challenges", label: "What was challenging?" },
      { id: "learnings", label: "What did I learn about the players or myself?" },
      { id: "nextTime", label: "What will I do differently next session?" },
    ],
  },
  match_reflection: {
    kind: "match_reflection",
    title: "Match Reflection",
    blurb: "Quick reflection after a game.",
    fields: [
      { id: "result", label: "Result & scoreline", short: true },
      { id: "teamStrengths", label: "Team strengths on the day" },
      { id: "improvements", label: "Areas to improve" },
      { id: "individuals", label: "Individual performances" },
      { id: "keyMoments", label: "Key moments & decisions" },
      { id: "takeaways", label: "Main takeaways for the week ahead" },
    ],
  },
};

/** How many of a kind's fields have content. */
export function filledCount(kind: JournalKind, content: Record<string, string> | undefined): number {
  if (!content) return 0;
  return KIND_DEFS[kind].fields.filter((f) => (content[f.id] ?? "").trim().length > 0).length;
}
