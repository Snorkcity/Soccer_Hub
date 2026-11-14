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
