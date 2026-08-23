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