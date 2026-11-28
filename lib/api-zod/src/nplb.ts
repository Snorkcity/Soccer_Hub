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

/** Fifteen-minute chart ticks plus the exact supplied match endpoint. */
export function matchTimelineTicks(
  timing: MatchTimingPolicy,
  matchMinutes = timing.regulationMinutes,
  interval = 15,
): number[] {
  const endpoint = Number.isFinite(matchMinutes) && matchMinutes > 0
    ? matchMinutes : timing.regulationMinutes;
  const ticks: number[] = [];
  const step = Number.isFinite(interval) && interval > 0 ? interval : 15;
  for (let minute = 0; minute <= endpoint; minute += step) ticks.push(minute);
  if (ticks[ticks.length - 1] !== endpoint) ticks.push(endpoint);
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
  return (periods as { duration?: number; timeframe?: [number, number] }[]).map((period, index) => {
    const seconds = Number(period?.duration);
    if (Number.isFinite(seconds) && seconds > 0) return seconds / 60;
    const start = Number(period?.timeframe?.[0]);
    const end = Number(period?.timeframe?.[1]);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) return (end - start) / 60;
    // Regulation periods follow the selected grade. Football extra-time
    // periods are 15 minutes when Veo omits both duration and timeframe.
    return index < 2 ? timing.halfMinutes : 15;
  });
}

/**
 * Three-period friendlies use actual playing time, excluding both breaks.
 * Ordinary two-period matches and four-period knockout clocks stay unchanged.
 */
export function veoMatchDurationMinutes(
  periodDurationsMinutes: readonly number[],
  timing: MatchTimingPolicy,
): number {
  if (periodDurationsMinutes.length === 3) {
    // Sum in Veo's native seconds to avoid exposing a 79.85000000000001 clock.
    return periodDurationsMinutes.reduce((total, minutes) => total + Math.max(0, minutes) * 60, 0) / 60;
  }
  if (periodDurationsMinutes.length < 4) return timing.regulationMinutes;
  return timing.regulationMinutes + 30;
}

/** Labels describe the recorded format; thirds must never be called halves. */
export function veoPeriodLabel(periodIndex: number, periodCount: number): string {
  if (periodCount === 3) return ["1st third", "2nd third", "3rd third"][periodIndex] ?? `Period ${periodIndex + 1}`;
  return periodIndex === 0 ? "1st half" : periodIndex === 1 ? "2nd half" : `Period ${periodIndex + 1}`;
}

export function formatVeoDuration(minutes: number): string {
  const seconds = Math.max(0, Math.round(minutes * 60));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatVeoTimelineTick(minutes: number): string {
  return Number.isInteger(minutes) ? `${minutes}'` : formatVeoDuration(minutes);
}

/** A three-third match has two breaks, not an invented half-time. */
export function veoPeriodBreaks(
  durations: readonly number[],
  timing: MatchTimingPolicy,
): { minute: number; label: string }[] {
  return durations.length === 3
    ? [1, 2].map(index => ({ minute: veoPeriodStartMinute(index, durations, timing), label: `Break ${index}` }))
    : [{ minute: veoPeriodStartMinute(1, durations, timing), label: "HT" }];
}

/**
 * Start minute for a zero-based Veo period. Four-period recordings use the
 * competition clock, not the (often stoppage-inflated) video durations.
 */
export function veoPeriodStartMinute(
  periodIndex: number,
  periodDurationsMinutes: readonly number[],
  timing: MatchTimingPolicy,
): number {
  const index = Math.max(0, Math.floor(periodIndex));
  if (periodDurationsMinutes.length >= 4) {
    if (index === 0) return 0;
    if (index === 1) return timing.halfMinutes;
    if (index === 2) return timing.regulationMinutes;
    return timing.regulationMinutes + 15;
  }
  const knownPeriods = Math.min(periodDurationsMinutes.length, index);
  const knownOffset = periodDurationsMinutes
    .slice(0, knownPeriods)
    .reduce((sum, duration) => sum + duration, 0);
  return knownOffset + (index - knownPeriods) * timing.halfMinutes;
}

/** End minute for a zero-based Veo period on the match clock. */
export function veoPeriodEndMinute(
  periodIndex: number,
  periodDurationsMinutes: readonly number[],
  timing: MatchTimingPolicy,
): number {
  const index = Math.max(0, Math.floor(periodIndex));
  if (periodDurationsMinutes.length === 3 && index === 2) {
    return veoMatchDurationMinutes(periodDurationsMinutes, timing);
  }
  if (periodDurationsMinutes.length >= 4) {
    return veoPeriodStartMinute(index, periodDurationsMinutes, timing)
      + (index < 2 ? timing.halfMinutes : 15);
  }
  return veoPeriodStartMinute(index, periodDurationsMinutes, timing)
    + (periodDurationsMinutes[index] ?? timing.halfMinutes);
}

/** Convert a Veo period-relative timestamp to the full match clock. */
export function veoEventMatchMinute(
  event: { period_id?: number | null; period_time_ms?: number | null },
  periodDurationsMinutes: readonly number[],
  timing: MatchTimingPolicy,
): number {
  const periodId = Math.max(1, Math.floor(Number(event.period_id) || 1));
  const offset = veoPeriodStartMinute(periodId - 1, periodDurationsMinutes, timing);
  const rawPeriodMinute = Math.max(0, (Number(event.period_time_ms) || 0) / 60000);
  const periodMinute = periodDurationsMinutes.length >= 4
    ? Math.min(rawPeriodMinute, periodId <= 2 ? timing.halfMinutes : 15)
    : rawPeriodMinute;
  return Math.min(
    veoMatchDurationMinutes(periodDurationsMinutes, timing),
    Math.max(0, offset + periodMinute),
  );
}