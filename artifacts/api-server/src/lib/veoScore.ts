export interface ResolvedVeoScore {
  goalsFor: number;
  goalsAgainst: number;
  veoGoalsFor: number;
  veoGoalsAgainst: number;
  source: "official" | "veo-events";
}

interface VeoScoreEvent {
  event_type?: string;
  team?: string;
}

export function countVeoEventGoals(rawEvents: unknown): {
  goalsFor: number;
  goalsAgainst: number;
} {
  let goalsFor = 0;
  let goalsAgainst = 0;
  const events = Array.isArray(rawEvents) ? (rawEvents as VeoScoreEvent[]) : [];
  for (const event of events) {
    if (event?.event_type !== "FootballGoal") continue;
    if (event.team === "Own") goalsFor++;
    else goalsAgainst++;
  }
  return { goalsFor, goalsAgainst };
}

function isOfficialGoalCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function resolveVeoScore(
  rawEvents: unknown,
  officialGoalsFor: unknown,
  officialGoalsAgainst: unknown,
): ResolvedVeoScore {
  const eventScore = countVeoEventGoals(rawEvents);
  const hasOfficialScore =
    isOfficialGoalCount(officialGoalsFor) &&
    isOfficialGoalCount(officialGoalsAgainst);

  return {
    goalsFor: hasOfficialScore ? officialGoalsFor : eventScore.goalsFor,
    goalsAgainst: hasOfficialScore ? officialGoalsAgainst : eventScore.goalsAgainst,
    veoGoalsFor: eventScore.goalsFor,
    veoGoalsAgainst: eventScore.goalsAgainst,
    source: hasOfficialScore ? "official" : "veo-events",
  };
}