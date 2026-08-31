/** Canonical Catapult match split names accepted by the GPS import. */
export type GpsSplit = "game" | "1st.half" | "2nd.half" | "extra-time";

/** Returns null for an unsupported or blank label. */
export function canonicalGpsSplit(value: string | null | undefined): GpsSplit | null {
  const split = value?.trim().toLowerCase();
  if (split === "all" || split === "game") return "game";
  if (split === "1st.half") return "1st.half";
  if (split === "2nd.half") return "2nd.half";
  if (split === "extra-time") return "extra-time";
  return null;
}

export interface GpsPeriods<T> {
  game?: T;
  h1?: T;
  h2?: T;
  et?: T;
}

/**
 * A whole-game Catapult value is authoritative. Without it, volumes add every
 * available period (including ET), while rates/maxima use the period maximum.
 */
export function gpsPeriodTotal<T>(
  periods: GpsPeriods<T>,
  value: (period: T) => number | null | undefined,
  additive: boolean,
): number | null {
  const game = periods.game ? value(periods.game) : null;
  if (game != null) return game;
  const values = [periods.h1, periods.h2, periods.et]
    .map(period => period ? value(period) : null)
    .filter((v): v is number => v != null);
  if (!values.length) return null;
  return additive ? values.reduce((sum, v) => sum + v, 0) : Math.max(...values);
}

export function gpsPeriodMinutes<T>(periods: GpsPeriods<T>, value: (period: T) => number | null | undefined): number | null {
  return gpsPeriodTotal(periods, value, true);
}