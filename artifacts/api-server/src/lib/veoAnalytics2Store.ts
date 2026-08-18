import type { Analytics2Bundle, Analytics2FetchResult, Analytics2SourceError } from "./veo";

export const ANALYTICS2_SOURCE_KEYS = [
  "crossMatchPlayer",
  "physicalMetrics",
  "matchEvents",
  "jerseyNumbers",
] as const satisfies ReadonlyArray<keyof Analytics2Bundle>;

export function mergeAnalytics2Bundles(
  existing: Record<string, unknown> | null | undefined,
  incoming: Analytics2Bundle,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    ...(incoming as Record<string, unknown>),
  };
}

export function analytics2StatusFromBundle(
  raw: Record<string, unknown> | Analytics2Bundle | null | undefined,
  terminalSources: ReadonlyArray<string> | null | undefined,
  fallback: Analytics2FetchResult["status"],
): Analytics2FetchResult["status"] {
  const sourceCount = ANALYTICS2_SOURCE_KEYS.filter((key) => raw?.[key] !== undefined).length;
  const terminal = new Set(terminalSources ?? []);
  const missingRetryable = ANALYTICS2_SOURCE_KEYS.some(
    (key) => raw?.[key] === undefined && !terminal.has(key),
  );
  if (!missingRetryable) {
    if (sourceCount === ANALYTICS2_SOURCE_KEYS.length) return "complete";
    return sourceCount > 0 ? "partial" : "unavailable";
  }
  if (sourceCount > 0) return "partial";
  return fallback;
}

export function mergeAnalytics2TerminalSources(
  existing: ReadonlyArray<string> | null | undefined,
  incoming: Analytics2Bundle,
  sourceErrors: ReadonlyArray<Analytics2SourceError>,
): string[] {
  const terminal = new Set(
    (existing ?? []).filter((source) =>
      ANALYTICS2_SOURCE_KEYS.includes(source as keyof Analytics2Bundle),
    ),
  );
  for (const source of ANALYTICS2_SOURCE_KEYS) {
    if (incoming[source] !== undefined) terminal.delete(source);
  }
  for (const sourceError of sourceErrors) {
    if (sourceError.terminal) terminal.add(sourceError.source);
  }
  return ANALYTICS2_SOURCE_KEYS.filter((source) => terminal.has(source));
}

export function analytics2NeedsWork(
  raw: Record<string, unknown> | Analytics2Bundle | null | undefined,
  terminalSources: ReadonlyArray<string> | null | undefined,
): boolean {
  const terminal = new Set(terminalSources ?? []);
  return ANALYTICS2_SOURCE_KEYS.some(
    (source) => raw?.[source] === undefined && !terminal.has(source),
  );
}

export function canonicalShirtNumber(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  return String(Number(text));
}