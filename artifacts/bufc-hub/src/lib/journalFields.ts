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
  /** How the voice interviewer asks this field out loud. Falls back to label. */
  question?: string;
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
      {
        id: "phaseCode",
        label: "Periodisation code",
        hint: "e.g. 03-01-B2 (cycle-session-phase). Belco U16+ Dutch rhythm (Verheijen-inspired): big → medium → small game fortnights, phases B1–B4, M1–M4, S1–S4. The field is the fitness.",
        short: true,
        question: "What's the periodisation code for this week?",
      },
      { id: "trainingOutcomes", label: "Training Outcomes", question: "What training outcomes are you after this week?" },
      { id: "prepRecovery", label: "Preparation & Recovery Outcomes", question: "What's the plan for preparation and recovery this week?" },
      { id: "ipp", label: "Individual Performance Plan", question: "Which individual performance plans are you focusing on this week?" },
      { id: "toDoOnField", label: "To Do — On Field", question: "What's on your to-do list on the field this week?" },
      { id: "toDoOffField", label: "To Do — Off Field", question: "And off the field — what needs doing this week?" },
      { id: "healthyHabits", label: "Healthy Habits — what habits are we looking to develop?", question: "What healthy habits are we looking to develop?" },
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
      {
        id: "periodisationReflection",
        label: "Periodisation — is the cycle tracking as planned?",
        question: "Is the periodisation cycle tracking as planned?",
        hint: "Where are we in the phase (B/M/S fortnight)? Did load and game-size rhythm match the plan — and is principle transfer becoming automatic (end-of-block review)?",
      },
    ],
  },
  game_preview: {
    kind: "game_preview",
    title: "Game Preview",
    blurb: "Opposition analysis before the game.",
    fields: [
      { id: "opposition", label: "Opposition", short: true, question: "Who are we playing?" },
      { id: "kickOff", label: "Kick Off Time", short: true, question: "What time is kick off?" },
      { id: "venue", label: "Venue", short: true, question: "Where's the game being played?" },
      { id: "strengths", label: "Opposition Strengths", question: "What are the opposition's strengths?" },
      { id: "weaknesses", label: "Opposition Weaknesses", question: "Where are they weak?" },
      { id: "inPossession", label: "Opposition In Possession", question: "What do they look like in possession?" },
      { id: "outOfPossession", label: "Opposition Out of Possession", question: "And out of possession — how do they set up without the ball?" },
      { id: "individuals", label: "Key Individuals", question: "Which of their individuals do we need to watch?" },
    ],
  },
  game_tactics: {
    kind: "game_tactics",
    title: "Game Tactics",
    blurb: "Our plan for the game, including set plays.",
    fields: [
      { id: "inPossession", label: "In Possession", question: "What's our plan in possession?" },
      { id: "outOfPossession", label: "Out of Possession", question: "How do we want to play out of possession?" },
      { id: "transitions", label: "Transitions", question: "What's the plan in transitions, both ways?" },
      { id: "individuals", label: "Individuals", question: "Any individual jobs or match-ups for our players?" },
      { id: "setPieces", label: "Set Pieces", question: "What's the plan for set pieces?" },
    ],
  },
  game_analysis: {
    kind: "game_analysis",
    title: "Game Analysis & Reflections",
    blurb: "Review of the game after it's played.",
    fields: [
      { id: "teamStrengths", label: "Team Strengths", question: "What did the team do well in the game?" },
      { id: "teamImprovements", label: "Team Areas of Improvement", question: "Where does the team need to improve?" },
      { id: "individualStrengths", label: "Individual Strengths", question: "Which individuals stood out, and why?" },
      { id: "individualImprovements", label: "Individual Areas of Improvement", question: "Which individuals have things to work on?" },
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
      { id: "result", label: "Result & scoreline", short: true, question: "What was the result and scoreline?" },
      { id: "teamStrengths", label: "Team strengths on the day", question: "What were the team's strengths on the day?" },
      { id: "improvements", label: "Areas to improve", question: "What do we need to improve?" },
      { id: "individuals", label: "Individual performances", question: "How did individuals perform?" },
      { id: "keyMoments", label: "Key moments & decisions", question: "What were the key moments and decisions?" },
      { id: "takeaways", label: "Main takeaways for the week ahead", question: "What are the main takeaways for the week ahead?" },
    ],
  },
};

/** How many of a kind's fields have content. */
export function filledCount(kind: JournalKind, content: Record<string, string> | undefined): number {
  if (!content) return 0;
  return KIND_DEFS[kind].fields.filter((f) => (content[f.id] ?? "").trim().length > 0).length;
}
