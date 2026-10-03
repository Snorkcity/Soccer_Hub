/** Northern NSW uses Squadi, not the Football NSW or Capital Dribl feeds. */
export function isNorthernNswLeague(leagueName: string): boolean {
  return /\b(?:NNSW|Northern\s+(?:NSW|New\s+South\s+Wales))\b/i.test(leagueName);
}