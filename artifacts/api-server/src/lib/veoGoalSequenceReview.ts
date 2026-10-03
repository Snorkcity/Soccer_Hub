import type { VeoGoalSequence } from "./veoGoalSequences";

export const REVIEW_DIMENSIONS = ["scorer", "finalPasser", "sequenceLength", "zone"] as const;
export type ReviewDimension = (typeof REVIEW_DIMENSIONS)[number];
export type ReviewDecision = "correct" | "incorrect" | "unclear";

export function parseHubGoalId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : null;
}

export function isValidGoalKey(goalKey: unknown, goals: VeoGoalSequence[]): boolean {
  return typeof goalKey === "string" && goals.some((goal) => goal.goalKey === goalKey);
}

export function goalSequenceKey(veoMatchId: string, goal: VeoGoalSequence, index: number): string {
  return `${veoMatchId}:${goal.periodId ?? "x"}:${goal.goalPeriodTimeMs ?? goal.goalTimeMs ?? "x"}:${index}`;
}

export function mergeReviewDecisions(
  existing: Record<string, ReviewDecision> | null | undefined,
  incoming: Record<string, ReviewDecision>,
): Record<string, ReviewDecision> {
  return { ...(existing ?? {}), ...incoming };
}

export function reviewAccuracy(decisions: Array<ReviewDecision | undefined>) {
  const reviewed = decisions.filter((value): value is ReviewDecision => value != null);
  const usable = reviewed.filter((value) => value !== "unclear");
  const correct = usable.filter((value) => value === "correct").length;
  return {
    reviewed: reviewed.length,
    correct,
    incorrect: usable.length - correct,
    unclear: reviewed.length - usable.length,
    accuracy: usable.length > 0 ? correct / usable.length : null,
  };
}