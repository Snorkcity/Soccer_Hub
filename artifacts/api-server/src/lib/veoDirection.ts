export type VeoOwnSide = "left" | "right";
export type VeoDirectionOverrides = Record<string, VeoOwnSide>;

export type VeoDirectionReviewStatus =
  | "confirmed"
  | "consistent"
  | "looks_reversed"
  | "uncertain"
  | "no_evidence";

export interface VeoDirectionReview {
  periodId: number;
  rawSide: VeoOwnSide | null;
  overrideSide: VeoOwnSide | null;
  effectiveSide: VeoOwnSide;
  suggestedSide: VeoOwnSide | null;
  status: VeoDirectionReviewStatus;
  confidence: number;
  evidenceCount: number;
}

interface PeriodLike {
  own_side?: unknown;
}

interface DirectionEvent {
  event_type?: unknown;
  team?: unknown;
  period_id?: unknown;
  x?: unknown;
}

const EVENT_WEIGHTS: Record<string, number> = {
  FootballGoal: 3,
  FootballPenaltyKick: 2,
  FootballShot: 1,
};

function ownSide(value: unknown): VeoOwnSide | null {
  return value === "left" || value === "right" ? value : null;
}

export function normaliseVeoDirectionOverrides(value: unknown): VeoDirectionOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: VeoDirectionOverrides = {};
  for (const [periodId, side] of Object.entries(value)) {
    if (/^[1-9]\d*$/.test(periodId) && (side === "left" || side === "right")) {
      result[periodId] = side;
    }
  }
  return result;
}

export function effectiveVeoOwnSide(
  periods: unknown,
  overrides: unknown,
  periodId: number,
): VeoOwnSide {
  const periodRows = Array.isArray(periods) ? (periods as PeriodLike[]) : [];
  const saved = normaliseVeoDirectionOverrides(overrides)[String(periodId)];
  return saved ?? ownSide(periodRows[periodId - 1]?.own_side) ?? "right";
}

/**
 * Return a copy of Veo's periods with own_side resolved through the Hub's
 * persisted override. The raw periods stored in the database are never changed.
 */
export function effectiveVeoPeriods(periods: unknown, overrides: unknown): unknown[] {
  if (!Array.isArray(periods)) return [];
  return periods.map((period, index) => {
    const row = period && typeof period === "object" && !Array.isArray(period)
      ? (period as Record<string, unknown>)
      : {};
    return {
      ...row,
      own_side: effectiveVeoOwnSide(periods, overrides, index + 1),
    };
  });
}

/**
 * Located shots provide a conservative direction suggestion:
 * - our shots should finish at the opposite end from own_side;
 * - opponent shots should finish at the own_side end.
 *
 * Suggestions are review-only. Sparse, central, or conflicting evidence never
 * produces a proposed side, and a coach-confirmed override always wins.
 */
export function reviewVeoDirections(
  events: unknown,
  periods: unknown,
  overrides: unknown,
): VeoDirectionReview[] {
  const periodRows = Array.isArray(periods) ? (periods as PeriodLike[]) : [];
  const eventRows = Array.isArray(events) ? (events as DirectionEvent[]) : [];
  const saved = normaliseVeoDirectionOverrides(overrides);
  const largestEventPeriod = eventRows.reduce((max, event) => {
    const id = Number(event.period_id);
    return Number.isInteger(id) && id > max ? id : max;
  }, 0);
  const periodCount = Math.max(periodRows.length, largestEventPeriod);

  return Array.from({ length: periodCount }, (_, index) => {
    const periodId = index + 1;
    const rawSide = ownSide(periodRows[index]?.own_side);
    const overrideSide = saved[String(periodId)] ?? null;
    const effectiveSide = overrideSide ?? rawSide ?? "right";
    let leftScore = 0;
    let rightScore = 0;
    let evidenceCount = 0;

    for (const event of eventRows) {
      if (Number(event.period_id) !== periodId) continue;
      const eventType = typeof event.event_type === "string" ? event.event_type : "";
      const baseWeight = EVENT_WEIGHTS[eventType];
      if (!baseWeight) continue;
      if (typeof event.x !== "number") continue;
      const x = event.x;
      if (!Number.isFinite(x) || x < 0 || x > 1) continue;
      const locationStrength = Math.abs(x - 0.5) * 2;
      if (locationStrength < 0.25) continue;

      const shotEndsRight = x > 0.5;
      const isOwn = event.team === "Own";
      // If we shoot right, our goal/own_side is left. If they shoot right,
      // our goal/own_side is right.
      const indicatedSide: VeoOwnSide = isOwn
        ? (shotEndsRight ? "left" : "right")
        : (shotEndsRight ? "right" : "left");
      const score = baseWeight * locationStrength;
      if (indicatedSide === "left") leftScore += score;
      else rightScore += score;
      evidenceCount++;
    }

    const totalScore = leftScore + rightScore;
    const confidence = totalScore > 0
      ? Number((Math.max(leftScore, rightScore) / totalScore).toFixed(3))
      : 0;
    const strongEnough = evidenceCount >= 3 && totalScore >= 2 && confidence >= 0.75;
    const suggestedSide: VeoOwnSide | null = strongEnough
      ? (leftScore >= rightScore ? "left" : "right")
      : null;
    const status: VeoDirectionReviewStatus = overrideSide
      ? "confirmed"
      : suggestedSide
        ? (suggestedSide === effectiveSide ? "consistent" : "looks_reversed")
        : evidenceCount === 0
          ? "no_evidence"
          : "uncertain";

    return {
      periodId,
      rawSide,
      overrideSide,
      effectiveSide,
      suggestedSide,
      status,
      confidence,
      evidenceCount,
    };
  });
}