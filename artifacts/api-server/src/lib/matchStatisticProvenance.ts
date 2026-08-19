export const matchStatisticKeys = [
  "possession",
  "shots",
  "oppShots",
  "passes",
  "oppPasses",
] as const;

export type MatchStatisticKey = (typeof matchStatisticKeys)[number];
export type MatchStatisticSource = "official" | "veo" | "unknown";
export type MatchStatisticSourceKey = `${MatchStatisticKey}Source`;
export type MatchStatisticValues = {
  possession: string | null;
  shots: number | null;
  oppShots: number | null;
  passes: number | null;
  oppPasses: number | null;
};
export type MatchStatisticSnapshot = MatchStatisticValues &
  Record<MatchStatisticSourceKey, unknown>;
export type MatchStatisticUpdates = Partial<
  MatchStatisticValues & Record<MatchStatisticSourceKey, MatchStatisticSource>
>;

const validSources = new Set<MatchStatisticSource>([
  "official",
  "veo",
  "unknown",
]);

export function normaliseMatchStatisticSource(
  value: unknown,
): MatchStatisticSource {
  return typeof value === "string" &&
    validSources.has(value as MatchStatisticSource)
    ? (value as MatchStatisticSource)
    : "unknown";
}

export function shouldBackfillMatchStatistic(
  currentValue: unknown,
  currentSource: unknown,
  freshValue: unknown,
  overwrite = false,
): boolean {
  if (
    freshValue == null ||
    normaliseMatchStatisticSource(currentSource) === "official"
  )
    return false;
  return overwrite || currentValue == null;
}

export function veoMatchStatisticUpdates(
  current: MatchStatisticSnapshot,
  fresh: MatchStatisticValues,
  overwrite = false,
): MatchStatisticUpdates {
  const updates: Record<string, unknown> = {};
  for (const key of matchStatisticKeys) {
    const sourceKey: MatchStatisticSourceKey = `${key}Source`;
    if (
      !shouldBackfillMatchStatistic(
        current[key],
        current[sourceKey],
        fresh[key],
        overwrite,
      )
    )
      continue;
    updates[key] = fresh[key];
    updates[sourceKey] = "veo";
  }
  return updates as MatchStatisticUpdates;
}

/**
 * Only supplied fields become official after a coach saves the manual editor.
 * This deliberately leaves the provenance of omitted Veo fields unchanged.
 */
export function manualMatchStatisticSourceUpdates(
  body: Record<string, unknown>,
): Partial<Record<MatchStatisticSourceKey, MatchStatisticSource>> {
  const updates: Partial<
    Record<MatchStatisticSourceKey, MatchStatisticSource>
  > = {};
  for (const key of matchStatisticKeys) {
    if (!Object.hasOwn(body, key)) continue;
    updates[`${key}Source`] = body[key] == null ? "unknown" : "official";
  }
  return updates;
}
