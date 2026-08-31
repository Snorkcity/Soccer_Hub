export type GpsMatchSplit = "game" | "1st.half" | "2nd.half" | "extra-time";

/** Canonical match splits accepted from Catapult exports. */
export function canonicalGpsMatchSplit(value: string | null | undefined): GpsMatchSplit | null {
  const split = (value ?? "game").trim().toLowerCase();
  if (split === "" || split === "all" || split === "game") return "game";
  if (split === "1st.half") return "1st.half";
  if (split === "2nd.half") return "2nd.half";
  if (split === "extra-time" || split === "extra.time" || split === "extra time") return "extra-time";
  return null;
}

export interface GpsPeriodValues {
  game: number | null;
  firstHalf: number | null;
  secondHalf: number | null;
  extraTime: number | null;
}

export interface GpsPeriodSummary {
  regulation: number | null;
  extraTime: number | null;
  match: number | null;
}

/**
 * Whole-game rows are authoritative. Period rows still expose regulation and
 * extra-time detail, and provide the best fallback when a whole-game row is
 * absent.
 */
export function summarizeGpsPeriodValues(
  values: GpsPeriodValues,
  additive: boolean,
): GpsPeriodSummary {
  const combine = (parts: Array<number | null>): number | null => {
    const present = parts.filter((value): value is number => value != null);
    if (present.length === 0) return null;
    return additive
      ? present.reduce((sum, value) => sum + value, 0)
      : Math.max(...present);
  };
  const regulation = combine([values.firstHalf, values.secondHalf]);
  const extraTime = values.extraTime;
  return {
    regulation,
    extraTime,
    match: values.game ?? combine([values.firstHalf, values.secondHalf, values.extraTime]),
  };
}
