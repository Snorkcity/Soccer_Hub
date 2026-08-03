// Shared position → unit mapping, used by both the API server (unit-breakdown
// analytics) and the web app (Data Entry position pickers, unit charts).
//
// Position codes are the per-game codes stored on league_player_stats.position;
// units match the four buckets the GPS Positions tab assigns season-long.

export const POSITION_CODES = [
  "GK", "LB", "RB", "CB", "LWB", "RWB",
  "DM", "CM", "AM", "LM", "RM",
  "LW", "RW", "ST", "F",
] as const;

export type PositionCode = (typeof POSITION_CODES)[number];

export const UNITS = ["GK", "Defender", "Midfielder", "Forward"] as const;
export type Unit = (typeof UNITS)[number];

export const POSITION_UNITS: Record<PositionCode, Unit> = {
  GK: "GK",
  LB: "Defender", RB: "Defender", CB: "Defender", LWB: "Defender", RWB: "Defender",
  DM: "Midfielder", CM: "Midfielder", AM: "Midfielder", LM: "Midfielder", RM: "Midfielder",
  LW: "Forward", RW: "Forward", ST: "Forward", F: "Forward",
};

/** Unit for a per-game position code; null when the code is unknown/free-text. */
export const unitForPosition = (pos: string | null | undefined): Unit | null => {
  if (!pos) return null;
  const key = pos.trim().toUpperCase() as PositionCode;
  return POSITION_UNITS[key] ?? null;
};

/** Assigned GPS positions are already stored as unit names — validate them. */
export const asUnit = (value: string | null | undefined): Unit | null =>
  value != null && (UNITS as readonly string[]).includes(value) ? (value as Unit) : null;
