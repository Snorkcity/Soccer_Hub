export const ACT_NPLB_LEAGUE_NAMES = [
  "ACT NPLB U14",
  "ACT NPLB U15",
  "ACT NPLB U16",
  "ACT NPLB U18",
] as const;

export type ActNplbLeagueName = (typeof ACT_NPLB_LEAGUE_NAMES)[number];

export function isActNplbLeague(name: string | null | undefined): name is ActNplbLeagueName {
  return ACT_NPLB_LEAGUE_NAMES.includes(name as ActNplbLeagueName);
}

export function actNplbGrade(name: string | null | undefined): number | null {
  if (!isActNplbLeague(name)) return null;
  return Number(name.slice(-2));
}

export interface GoalInterval {
  label: string;
  start: number;
  end: number;
}

export interface MatchTimingPolicy {
  regulationMinutes: number;
  halfMinutes: number;
  goalIntervals: readonly GoalInterval[];
}

const STANDARD_INTERVALS: readonly GoalInterval[] = [
  { label: "0-15", start: 0, end: 15 },
  { label: "16-30", start: 16, end: 30 },
  { label: "31-45", start: 31, end: 45 },
  { label: "46-60", start: 46, end: 60 },
  { label: "61-75", start: 61, end: 75 },
  { label: "76-90", start: 76, end: 90 },
];

const TIMING_BY_GRADE: Record<number, MatchTimingPolicy> = {
  14: {
    regulationMinutes: 70,
    halfMinutes: 35,
    goalIntervals: [
      { label: "0-17", start: 0, end: 17 },
      { label: "18-35", start: 18, end: 35 },
      { label: "36-53", start: 36, end: 53 },
      { label: "54-70", start: 54, end: 70 },
    ],
  },
  15: {
    regulationMinutes: 80,
    halfMinutes: 40,
    goalIntervals: [
      { label: "0-20", start: 0, end: 20 },
      { label: "21-40", start: 21, end: 40 },
      { label: "41-60", start: 41, end: 60 },
      { label: "61-80", start: 61, end: 80 },
    ],
  },
  16: { regulationMinutes: 90, halfMinutes: 45, goalIntervals: STANDARD_INTERVALS },
  18: { regulationMinutes: 90, halfMinutes: 45, goalIntervals: STANDARD_INTERVALS },
};

const STANDARD_TIMING: MatchTimingPolicy = {
  regulationMinutes: 90,
  halfMinutes: 45,
  goalIntervals: STANDARD_INTERVALS,
};

/**
 * Exact NPLB grade timing. All other leagues, including U23 and senior grades,
 * retain the standard 90-minute policy.
 */
export function matchTimingForLeague(leagueName: string | null | undefined): MatchTimingPolicy {
  const grade = actNplbGrade(leagueName);
  return grade ? TIMING_BY_GRADE[grade] : STANDARD_TIMING;
}

/**
 * Returns null for an unknown/invalid minute. Stoppage-time values are folded
 * into the final regulation interval rather than creating a separate bucket.
 */
export function goalIntervalIndex(
  minute: number | null | undefined,
  timing: MatchTimingPolicy,
): number | null {
  if (minute == null || !Number.isFinite(minute) || minute < 0) return null;
  const wholeMinute = Math.min(Math.floor(minute), timing.regulationMinutes);
  const index = timing.goalIntervals.findIndex(
    (interval) => wholeMinute >= interval.start && wholeMinute <= interval.end,
  );
  return index >= 0 ? index : timing.goalIntervals.length - 1;
}

export function clampMatchMinute(minute: number, timing: MatchTimingPolicy): number {
  if (!Number.isFinite(minute)) return 0;
  return Math.min(timing.regulationMinutes, Math.max(0, minute));
}

/** Fifteen-minute chart ticks plus the exact regulation endpoint. */
export function matchTimelineTicks(timing: MatchTimingPolicy): number[] {
  const ticks: number[] = [];
  for (let minute = 0; minute <= timing.regulationMinutes; minute += 15) ticks.push(minute);
  if (ticks[ticks.length - 1] !== timing.regulationMinutes) ticks.push(timing.regulationMinutes);
  return ticks;
}

/**
 * Veo supplies period durations in seconds. Keep real durations when present;
 * a missing duration falls back to this grade's half length, not always 45.
 */
export function veoPeriodDurationsMinutes(
  periods: unknown,
  timing: MatchTimingPolicy,
): number[] {
  if (!Array.isArray(periods)) return [];
  return (periods as { duration?: number }[]).map((period) => {
    const seconds = Number(period?.duration);
    return Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : timing.halfMinutes;
  });
}

/** Convert a Veo period-relative timestamp to the regulation match clock. */
export function veoEventMatchMinute(
  event: { period_id?: number | null; period_time_ms?: number | null },
  periodDurationsMinutes: readonly number[],
  timing: MatchTimingPolicy,
): number {
  const periodId = Math.max(1, Math.floor(Number(event.period_id) || 1));
  const priorPeriods = periodId - 1;
  const knownPeriods = Math.min(periodDurationsMinutes.length, priorPeriods);
  const knownOffset = periodDurationsMinutes
    .slice(0, knownPeriods)
    .reduce((sum, duration) => sum + duration, 0);
  const offset = knownOffset + (priorPeriods - knownPeriods) * timing.halfMinutes;
  const periodMinute = Math.max(0, (Number(event.period_time_ms) || 0) / 60000);
  return clampMatchMinute(offset + periodMinute, timing);
}