import { canonicalGpsMatchSplit } from "./gpsPeriods";
import { gpsPeriodMinutes, gpsPeriodTotal } from "./gps";
import type {
  GpsDevelopmentGame, GpsDevelopmentMetric, GpsDevelopmentMetricSummary, GpsDevelopmentProfile,
  GpsDevelopmentPeer, GpsDevelopmentExternal,
} from "./generated/types";

export const GPS_DEVELOPMENT_VERSION = "BUFC match evidence 1.0 — HSP >18 km/h";
export const DEVELOPMENT_ROLES = ["CB", "FB", "DM", "B2B", "AM", "Winger", "9", "GK"] as const;
const primary: Record<string, string[]> = {
  CB: ["accel", "decel"], FB: ["td", "hsp", "dpm"],
  DM: ["dpm", "td", "accel", "decel"], B2B: ["dpm", "td", "accel", "decel"],
  AM: ["dpm", "td", "accel", "decel"], Winger: ["hsp", "vhs", "accel"],
  "9": ["accel", "vhs"], GK: [],
};
const definitions = [
  { id: "td", title: "Total distance", unit: "m", decimals: 0 },
  { id: "dpm", title: "Distance per minute", unit: "m/min", decimals: 1 },
  { id: "hsp", title: "High-speed metres (>18 km/h)", unit: "m", decimals: 0 },
  { id: "hspPct", title: "High-speed share", unit: "%", decimals: 1 },
  { id: "hspMin", title: "High-speed metres per minute", unit: "m/min", decimals: 1 },
  { id: "vhs", title: "Very-high-speed metres (>25 km/h)", unit: "m", decimals: 0 },
  { id: "vhsMin", title: "Very-high-speed metres per minute", unit: "m/min", decimals: 1 },
  { id: "speed", title: "Maximum speed", unit: "km/h", decimals: 1 },
  { id: "accel", title: "Accelerations >3 m/s²", unit: "events", decimals: 0 },
  { id: "decel", title: "Decelerations >3 m/s²", unit: "events", decimals: 0 },
];
export function developmentMetrics(role: string | null): GpsDevelopmentMetric[] {
  const priority = primary[role ?? ""] ?? [];
  return definitions.map(m => ({ ...m, primary: priority.includes(m.id) }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

export interface DevelopmentRawRow {
  playerName: string; year: string; round: string | null; sessionDate: string | null;
  opponent: string | null; splitName: string | null; tags: string | null;
  minsPlayed: unknown; distanceKm: unknown; sprintDistanceM: unknown; distanceZone5Km: unknown;
  topSpeedMs: unknown; accelCount34: unknown; accelCountOver4: unknown; decelCount34: unknown; decelCountOver4: unknown;
}
export interface DevelopmentContext {
  playerName: string; year: string; round: string; role: string | null;
  matchType: "official" | "other" | "unknown"; comparable: boolean;
}
export const developmentGameKey = (year: string, round: string) => `${year}|${round}`;
export function developmentSquad(round: string | null): string {
  if (/-(u?23s?|res|r)$/i.test(round ?? "")) return /23/i.test(round ?? "") ? "U23" : "Reserves";
  if (/-1[78]s$/i.test(round ?? "")) return "17s / 18s";
  return "1sts";
}
const number = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
export function developmentDate(date: string | null): number {
  if (!date) return 0;
  const parts = date.split(/[/-]/).map(Number);
  const [d, m, y] = parts[0]! > 1900 ? [parts[2], parts[1], parts[0]] : parts;
  if (!d || !m || !y) return 0;
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d ? t.getTime() : 0;
}

/** One appearance, not one exported split. Whole-game values always win. */
export function developmentGames(rows: DevelopmentRawRow[], defaultRole: string | null, contexts: DevelopmentContext[]): GpsDevelopmentGame[] {
  const bundles = new Map<string, { game?: DevelopmentRawRow; h1?: DevelopmentRawRow; h2?: DevelopmentRawRow; et?: DevelopmentRawRow }>();
  for (const row of rows) {
    if (!row.round || row.playerName === "Unknown") continue;
    const split = canonicalGpsMatchSplit(row.splitName);
    if (!split || (row.tags && row.tags !== "game")) continue;
    const key = developmentGameKey(row.year, row.round);
    const b = bundles.get(key) ?? {};
    const field = split === "game" ? "game" : split === "1st.half" ? "h1" : split === "2nd.half" ? "h2" : "et";
    // Duplicate imports do not create additional appearances.
    b[field] = row; bundles.set(key, b);
  }
  const contextMap = new Map(contexts.map(c => [developmentGameKey(c.year, c.round), c]));
  const out: GpsDevelopmentGame[] = [];
  for (const [key, b] of bundles) {
    const row = b.game ?? b.h1 ?? b.h2 ?? b.et!;
    const context = contextMap.get(key);
    const total = (field: keyof DevelopmentRawRow, scale = 1, additive = true) =>
      gpsPeriodTotal(b, r => { const n = number(r[field]); return n === null ? null : n * scale; }, additive);
    const mins = gpsPeriodMinutes(b, r => number(r.minsPlayed));
    const td = total("distanceKm", 1000);
    const hsp = total("sprintDistanceM");
    const vhs = total("distanceZone5Km", 1000);
    const rate = (v: number | null) => v !== null && mins !== null && mins > 0 ? v / mins : null;
    const count = (a: keyof DevelopmentRawRow, z: keyof DevelopmentRawRow) => gpsPeriodTotal(b, r => {
      const x = number(r[a]), y = number(r[z]);
      return x !== null && y !== null ? x + y : null;
    }, true);
    // Round-coded competition appearances are the pragmatic initial default;
    // coach context can explicitly classify friendlies or uncertain records.
    const matchType = context?.matchType ?? (/^(R\d+|GF|SF|PF|QF|FC)/i.test(row.round!) ? "official" : "unknown");
    const role = context ? context.role : defaultRole;
    const comparable = context?.comparable ?? true;
    const values = {
      td, dpm: rate(td), hsp, hspPct: hsp !== null && td !== null && td > 0 ? hsp / td * 100 : null,
      hspMin: rate(hsp), vhs, vhsMin: rate(vhs), speed: total("topSpeedMs", 3.6, false),
      accel: count("accelCount34", "accelCountOver4"), decel: count("decelCount34", "decelCountOver4"),
    };
    out.push({
      key, year: row.year, round: row.round!, date: row.sessionDate, opponent: row.opponent,
      squad: developmentSquad(row.round), mins, role,
      roleSource: role === "mixed" ? "mixed" : role === null ? "unknown" : context ? "recorded" : "default",
      matchType, comparable,
      qualifies: matchType === "official" && comparable && mins !== null && mins >= 60 && mins <= 150,
      values,
    });
  }
  return out.sort((a, b) => developmentDate(a.date) - developmentDate(b.date) || a.key.localeCompare(b.key));
}

export function developmentSummary(games: GpsDevelopmentGame[], id: string): GpsDevelopmentMetricSummary {
  const all = games.filter(g => g.comparable && g.values[id] != null);
  const qualified = all.filter(g => g.qualifies);
  const n = qualified.length;
  const top = [...qualified].sort((a, b) => b.values[id]! - a.values[id]! || a.key.localeCompare(b.key)).slice(0, n >= 5 ? 5 : 3);
  const avg = (gs: GpsDevelopmentGame[]) => gs.length ? gs.reduce((sum, g) => sum + g.values[id]!, 0) / gs.length : null;
  return {
    id, average: avg(qualified), sample: n,
    best: all.length ? Math.max(...all.map(g => g.values[id]!)) : null,
    gref: {
      value: n >= 3 ? avg(top) : null, status: n >= 5 ? "established" : n >= 3 ? "provisional" : "insufficient", sample: n,
      matches: n >= 3 ? top.map(g => ({ key: g.key, round: g.round, year: g.year, date: g.date, value: g.values[id]! })) : [],
    },
  };
}

export function developmentProfile(playerName: string, year: string, role: string | null,
  games: GpsDevelopmentGame[], peers: GpsDevelopmentPeer[], external: GpsDevelopmentExternal[]): GpsDevelopmentProfile {
  const metrics = developmentMetrics(role);
  const seasons = [...new Set(games.map(g => g.year))].sort().map(y => {
    const appearances = games.filter(g => g.year === y);
    return { year: y, appearances: appearances.length, qualifying: appearances.filter(g => g.qualifies).length,
      metrics: metrics.map(m => developmentSummary(appearances, m.id)) };
  });
  const selected = games.filter(g => g.year === year);
  const latest = selected.at(-1);
  const previous = seasons.filter(s => s.year < year).at(-1);
  const season = seasons.find(s => s.year === year);
  const summary: string[] = [
    `${season?.qualifying ?? 0} of ${selected.length} appearances meet the 60-minute, official-match and comparable-data rule this season.`,
  ];
  if (previous && season) {
    for (const m of metrics.filter(m => m.primary).slice(0, 3)) {
      const current = season.metrics.find(v => v.id === m.id)?.average;
      const prior = previous.metrics.find(v => v.id === m.id)?.average;
      if (current != null && prior != null && prior > 0) {
        const change = (current / prior - 1) * 100;
        summary.push(`${m.title}: qualifying-match average is ${Math.abs(change).toFixed(0)}% ${change >= 0 ? "higher" : "lower"} than ${previous.year}. This is recorded output, not a fitness or football-performance grade.`);
      }
    }
  }
  if (latest && !latest.qualifies) summary.push("The latest appearance remains visible but does not contribute to Gref or qualifying-match averages.");
  const warnings = [
    "Physical evidence supports development conversations; it does not determine football performance or selection. Formal readiness labels are not activated.",
    "References use actual match exposure, not projected per-90 totals. Absolute outputs can change with minutes, role, opposition and game context.",
    "Retained history assumes the same Catapult definitions (HSP >18 km/h; VHS >25 km/h). Exclude an appearance if its measurements are not comparable.",
    "Round-coded competition appearances are initially treated as official; confirm or correct match context where necessary.",
  ];
  if (games.some(g => g.roleSource === "default")) warnings.push("Unrecorded match roles use the player's current usual role. These are explicitly inferred, not historical role confirmations.");
  if (!role || !primary[role]?.length) warnings.push("No outfield physical profile is defined for this role. Personal evidence is available without positional readiness claims.");
  if (role === "AM") warnings.push("The 10 uses the 6's physical emphasis, while remaining a distinct football role.");
  return { playerName, year, role, squad: latest?.squad ?? games.at(-1)?.squad ?? "1sts",
    methodologyVersion: GPS_DEVELOPMENT_VERSION, metrics, games, seasons,
    history: metrics.map(m => developmentSummary(games, m.id)), peers, external, summary, warnings };
}