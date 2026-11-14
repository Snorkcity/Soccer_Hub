/** Navigation only: never replace the complete list of authorised leagues. */
export function competitionsForYear<T extends { id: number }>(
  leagues: T[],
  seasons: { leagueId: number; year: string }[],
  year: string | undefined,
): T[] {
  if (!year) return [];
  const available = new Set(seasons.filter(s => s.year === year).map(s => s.leagueId));
  return leagues.filter(l => available.has(l.id));
}

/** Resolve both selections together so queries never receive a mismatched pair. */
export function resolveCampaign<T extends { leagueId: number; year: string; isActive: boolean }>(
  seasons: T[],
  preferredLeagueId: number | null,
  preferredYear: string | null,
): T | null {
  const years = campaignYears(seasons);
  if (!years.length) return null;
  const previousLeague = seasons.filter(s => s.leagueId === preferredLeagueId);
  const year = preferredYear && years.includes(preferredYear)
    ? preferredYear
    : (previousLeague.find(s => s.isActive) ?? previousLeague[0])?.year
      ?? seasons.find(s => s.isActive)?.year ?? years[0];
  const inYear = seasons.filter(s => s.year === year);
  return inYear.find(s => s.leagueId === preferredLeagueId) ?? inYear[0] ?? null;
}

export function campaignYears(seasons: { year: string }[]): string[] {
  return [...new Set(seasons.map(s => s.year))]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}
