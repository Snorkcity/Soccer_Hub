/** Null is the legacy all-seasons grant; a map is explicit, per-campaign access. */
export type SeasonModuleAccess = Record<string, string[]> | null;

export function seasonGrantModules(modules: readonly string[], seasons: SeasonModuleAccess | undefined, year?: string): string[] {
  if (seasons == null) return [...modules];
  if (year != null) return [...(seasons[year] ?? [])];
  return [...new Set(Object.values(seasons).flat())];
}

export function seasonGrantAllows(seasons: SeasonModuleAccess | undefined, year: string): boolean {
  return seasons == null || (seasons[year]?.length ?? 0) > 0;
}
