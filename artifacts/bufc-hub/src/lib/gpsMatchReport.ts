/**
 * Team GPS Match Report — the "Monday after" physical review.
 *
 * Pure compute: takes every game-tagged GPS row for the year plus a squad +
 * round, and produces a serialisable report model (saved as-is to
 * gps_match_reports.data, rendered on-screen and as the PPTX deck).
 *
 * Contextualisation rules (the whole point):
 *  - Volume numbers (km, high-speed metres) are only judged against a player's
 *    own baseline as PER-MINUTE RATES, so a 20-minute cameo is judged on
 *    intensity, never raw kilometres.
 *  - A player's baseline = their own other matches this season (same squad),
 *    only matches with BASELINE_MIN_MINS+ minutes, expressed as rates.
 *  - Season bests for volume metrics only count from FULL_GAME_MINS+ minutes;
 *    top speed counts from any minutes.
 *  - Flags need MIN_FLAG_MINS+ minutes; short stints get a "judged on rate
 *    only" note instead of volume commentary.
 */
import type { GpsSession } from "@workspace/api-client-react";

// ── Tunables ─────────────────────────────────────────────────────────────────
const BASELINE_MIN_MINS = 45; // a match must be this long to shape a baseline
const FULL_GAME_MINS = 60;    // volume season-bests need a proper shift
const MIN_FLAG_MINS = 30;     // above/below-normal flags need this many mins
const UP_PCT = 10;            // ≥ +10% on own rate = above normal
const DOWN_PCT = 12;          // ≤ −12% on own rate = under normal
const RADAR_HSM_PCT = 10;     // HSM ≥ 10% of total distance = "on the radar"
const TREND_GAMES = 5;        // trend page window
const REGRESS_RECENT = 3;     // regression check: last 3 games vs the rest
const REGRESS_PCT = 8;        // recent rate ≥ 8% under earlier = sliding

// ── Model (serialisable — stored in gps_match_reports.data) ─────────────────
export interface TeamStatLine {
  id: string; label: string; unit: string; decimals: number;
  value: number | null; seasonAvg: number | null; deltaPct: number | null;
}
export interface HalfLine {
  id: string; label: string; unit: string; decimals: number;
  h1: number | null; h2: number | null; changePct: number | null;
  /** Season context (optional — absent in reports saved before it existed):
   * the squad's usual 2nd-half change plus the best/worst game this season. */
  seasonChangePct?: number | null;
  bestChange?: { pct: number; round: string } | null;
  worstChange?: { pct: number; round: string } | null;
}
export interface PlayerLine {
  name: string;
  position: string | null;
  mins: number | null;
  km: number | null;
  dpm: number | null;
  hsm: number | null;
  vhs: number | null;
  topSpeed: number | null; // km/h
  hsmPctOfDist: number | null;
  baselineGames: number;
  /** % vs own baseline rate — null when no baseline or no minutes */
  dpmDelta: number | null;
  hsmDelta: number | null;
  vhsDelta: number | null;
  shortMins: boolean; // under MIN_FLAG_MINS — judged on rate only
}
export type InsightKind = "best" | "up" | "radar" | "position" | "down" | "trend" | "note";
export interface InsightLine { kind: InsightKind; player: string | null; text: string; }
/** Group insight lines by player (first-appearance order) so multiple
 *  highlights for one player read as one block instead of scattered lines.
 *  Player-less lines each get their own group. */
export function groupInsights(items: InsightLine[]): { player: string | null; lines: InsightLine[] }[] {
  const groups: { player: string | null; lines: InsightLine[] }[] = [];
  const byPlayer = new Map<string, { player: string | null; lines: InsightLine[] }>();
  for (const it of items) {
    if (it.player == null) { groups.push({ player: null, lines: [it] }); continue; }
    let g = byPlayer.get(it.player);
    if (!g) { g = { player: it.player, lines: [] }; byPlayer.set(it.player, g); groups.push(g); }
    g.lines.push(it);
  }
  return groups;
}
export interface TrendGroupLine {
  label: "GK" | "Def" | "Mid" | "For";
  players: number;
  km: number | null;      // total distance for the group
  dpm: number | null;     // avg intensity (m/min) for the group
}
export interface TrendPoint {
  round: string; opponent: string | null; dateLabel: string | null;
  players: number; kmTotal: number | null; dpmAvg: number | null; hsmPerMinAvg: number | null;
  groups: TrendGroupLine[]; // per coaching line (GK/Def/Mid/For), for the hover
}
export interface GpsMatchReportModel {
  version: 1;
  squad: string; round: string; opponent: string | null; dateLabel: string | null;
  year: string; teamLabel: string; generatedOn: string;
  team: TeamStatLine[];
  halves: HalfLine[];
  players: PlayerLine[];
  standouts: InsightLine[];
  watch: InsightLine[];
  trend: TrendPoint[];
}

// ── Internals ────────────────────────────────────────────────────────────────
interface Bundle {
  round: string; date: number | null; opponent: string | null; dateLabel: string | null;
  game?: GpsSession; h1?: GpsSession; h2?: GpsSession;
}

function parseDate(d: string | null | undefined): number | null {
  if (!d) return null;
  const [dd, mm, yyyy] = d.split("/").map(Number);
  if (!dd || !mm || !yyyy) return null;
  return new Date(yyyy, mm - 1, dd).getTime();
}

function squadOf(round: string | null | undefined): string {
  if (!round) return "1sts";
  if (/-(res|r)$/i.test(round)) return "Reserves";
  if (/-1[78]s$/i.test(round)) return "17s / 18s";
  return "1sts";
}

type Num = number | null;
const val = {
  km: (r: GpsSession): Num => r.distanceKm ?? null,
  hsm: (r: GpsSession): Num => r.sprintDistanceM ?? null,
  vhs: (r: GpsSession): Num => (r.distanceZone5Km == null ? null : r.distanceZone5Km * 1000),
  top: (r: GpsSession): Num => (r.topSpeedMs == null ? null : r.topSpeedMs * 3.6),
  dpm: (r: GpsSession): Num => r.distancePerMinMm ?? null,
  load: (r: GpsSession): Num => r.playerLoad ?? null,
};

function total(b: Bundle, f: (r: GpsSession) => Num, additive: boolean): Num {
  const g = b.game ? f(b.game) : null;
  if (g != null) return g;
  const v1 = b.h1 ? f(b.h1) : null;
  const v2 = b.h2 ? f(b.h2) : null;
  if (v1 == null && v2 == null) return null;
  return additive ? (v1 ?? 0) + (v2 ?? 0) : Math.max(v1 ?? -Infinity, v2 ?? -Infinity);
}
const mins = (b: Bundle): Num =>
  b.game?.minsPlayed ?? (b.h1?.minsPlayed != null || b.h2?.minsPlayed != null
    ? (b.h1?.minsPlayed ?? 0) + (b.h2?.minsPlayed ?? 0) : null);

const avg = (xs: number[]): Num => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pctDelta = (v: Num, base: Num): Num =>
  v != null && base != null && base > 0 ? ((v / base) - 1) * 100 : null;

/** Loose position → coaching group, from the free-text gps_player_positions values. */
export function posGroupOf(position: string | null | undefined): "GK" | "Fullback" | "CB" | "Midfielder" | "Forward" | null {
  if (!position) return null;
  const p = position.toLowerCase();
  if (/keeper|gk/.test(p)) return "GK";
  if (/full\s*back|fullback|wing\s*back|\bfb\b|\b[lr]b\b/.test(p)) return "Fullback";
  if (/centre\s*back|center\s*back|\bcb\b|central def/.test(p)) return "CB";
  if (/forward|striker|winger|\bst\b|attack/.test(p)) return "Forward";
  if (/mid/.test(p)) return "Midfielder";
  if (/defend|back/.test(p)) return "CB";
  return null;
}

const fmt = (v: Num, d: number) => (v == null ? "—" : v.toFixed(d));

// ── Builder ──────────────────────────────────────────────────────────────────
export interface BuildInput {
  rows: GpsSession[];              // ALL rows for the year (any split, any squad)
  squad: string;                   // "1sts" | "Reserves" | "17s / 18s"
  round: string;                   // the match round code
  year: string;
  teamLabel: string;               // e.g. "Belconnen United FC — 1sts"
  positions: Map<string, string>;  // canonical name → position text
  generatedOn: string;
}

export function buildGpsMatchReport(input: BuildInput): GpsMatchReportModel | null {
  const { rows, squad, round, year, teamLabel, positions, generatedOn } = input;

  // Player-round bundles for this squad's game rows only.
  const gameRows = rows.filter(r => r.tags === "game" && r.round && squadOf(r.round) === squad && r.playerName);
  const byKey = new Map<string, Bundle>();
  for (const r of gameRows) {
    const key = `${r.playerName}|${r.round}`;
    let b = byKey.get(key);
    if (!b) {
      b = { round: r.round!, date: parseDate(r.sessionDate), opponent: r.opponent ?? null, dateLabel: r.sessionDate ?? null };
      byKey.set(key, b);
    }
    if (r.splitName === "game") b.game = r;
    else if (r.splitName === "1st.half") b.h1 = r;
    else if (r.splitName === "2nd.half") b.h2 = r;
  }

  const byPlayer = new Map<string, Bundle[]>();
  for (const [key, b] of byKey) {
    const name = key.slice(0, key.indexOf("|"));
    byPlayer.set(name, [...(byPlayer.get(name) ?? []), b]);
  }
  for (const list of byPlayer.values()) list.sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity));

  const matchBundles: Array<{ name: string; b: Bundle }> = [];
  for (const [name, list] of byPlayer) {
    const b = list.find(x => x.round === round);
    if (b) matchBundles.push({ name, b });
  }
  if (!matchBundles.length) return null;

  const opponent = matchBundles.map(x => x.b.opponent).find(o => o) ?? null;
  const dateLabel = matchBundles.map(x => x.b.dateLabel).find(d => d) ?? null;

  // ── Per-player lines + baselines ──────────────────────────────────────────
  interface Baseline {
    games: number; dpm: Num; hsmPerMin: Num; vhsPerMin: Num;
    bestTop: Num; bestKm: Num; bestHsm: Num; bestDpm: Num;
    recentDpm: Num; earlierDpm: Num; // regression check (rates, incl. this match)
  }
  const baselineOf = new Map<string, Baseline>();
  for (const [name, list] of byPlayer) {
    const others = list.filter(x => x.round !== round);
    const solid = others.filter(x => (mins(x) ?? 0) >= BASELINE_MIN_MINS);
    const rate = (x: Bundle, f: (r: GpsSession) => Num, additive: boolean): Num => {
      const m = mins(x); const v = total(x, f, additive);
      return m && v != null ? v / m : null;
    };
    const collect = (f: (x: Bundle) => Num) => solid.map(f).filter((v): v is number => v != null);
    const full = others.filter(x => (mins(x) ?? 0) >= FULL_GAME_MINS);
    const best = (xs: Bundle[], f: (x: Bundle) => Num) => {
      const vs = xs.map(f).filter((v): v is number => v != null);
      return vs.length ? Math.max(...vs) : null;
    };
    // Regression: rates across ALL this player's games incl. this one, by date.
    const rated = list
      .map(x => ({ date: x.date, dpm: rate(x, val.km, true) == null ? null : rate(x, val.km, true)! * 1000 }))
      .filter(x => x.dpm != null) as Array<{ date: number | null; dpm: number }>;
    const recent = rated.slice(-REGRESS_RECENT).map(x => x.dpm);
    const earlier = rated.slice(0, Math.max(0, rated.length - REGRESS_RECENT)).map(x => x.dpm);
    baselineOf.set(name, {
      games: solid.length,
      dpm: avg(collect(x => x.game?.distancePerMinMm ?? (rate(x, val.km, true) == null ? null : rate(x, val.km, true)! * 1000))),
      hsmPerMin: avg(collect(x => rate(x, val.hsm, true))),
      vhsPerMin: avg(collect(x => rate(x, val.vhs, true))),
      bestTop: best(others, x => total(x, val.top, false)),
      bestKm: best(full, x => total(x, val.km, true)),
      bestHsm: best(full, x => total(x, val.hsm, true)),
      bestDpm: best(full, x => x.game?.distancePerMinMm ?? (rate(x, val.km, true) == null ? null : rate(x, val.km, true)! * 1000)),
      recentDpm: avg(recent),
      earlierDpm: avg(earlier),
    });
  }

  const players: PlayerLine[] = matchBundles.map(({ name, b }) => {
    const m = mins(b);
    const km = total(b, val.km, true);
    const hsm = total(b, val.hsm, true);
    const vhs = total(b, val.vhs, true);
    const top = total(b, val.top, false);
    const dpm = b.game?.distancePerMinMm ?? (m && km != null ? (km * 1000) / m : null);
    const base = baselineOf.get(name)!;
    const hsmRate = m && hsm != null ? hsm / m : null;
    const vhsRate = m && vhs != null ? vhs / m : null;
    return {
      name,
      position: positions.get(name) ?? null,
      mins: m, km, dpm, hsm, vhs, topSpeed: top,
      hsmPctOfDist: km && hsm != null && km > 0 ? (hsm / (km * 1000)) * 100 : null,
      baselineGames: base.games,
      dpmDelta: base.games ? pctDelta(dpm, base.dpm) : null,
      hsmDelta: base.games ? pctDelta(hsmRate, base.hsmPerMin) : null,
      vhsDelta: base.games ? pctDelta(vhsRate, base.vhsPerMin) : null,
      shortMins: (m ?? 0) < MIN_FLAG_MINS,
    };
  }).sort((a, b) => (b.mins ?? 0) - (a.mins ?? 0) || a.name.localeCompare(b.name));

  // ── Team summary vs season average ───────────────────────────────────────
  const roundsAll = [...new Set(gameRows.map(r => r.round!))];
  const teamGame = (rd: string) => {
    const bs = [...byKey.entries()].filter(([k]) => k.endsWith(`|${rd}`)).map(([, b]) => b);
    const sum = (f: (r: GpsSession) => Num, additive: boolean): Num => {
      const vs = bs.map(x => total(x, f, additive)).filter((v): v is number => v != null);
      return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
    };
    // Same fallback as the player lines: derive m/min from distance + minutes
    // when a bundle only has half rows (no game-row DPM).
    const dpmVals = bs.map(x => {
      const direct = x.game?.distancePerMinMm ?? null;
      if (direct != null) return direct;
      const m = mins(x); const km = total(x, val.km, true);
      return m && km != null ? (km * 1000) / m : null;
    }).filter((v): v is number => v != null);
    const tops = bs.map(x => total(x, val.top, false)).filter((v): v is number => v != null);
    return {
      players: bs.length,
      km: sum(val.km, true),
      hsm: sum(val.hsm, true),
      vhs: sum(val.vhs, true),
      load: sum(val.load, true),
      dpmAvg: avg(dpmVals),
      topMax: tops.length ? Math.max(...tops) : null,
      minsTotal: (() => { const vs = bs.map(mins).filter((v): v is number => v != null); return vs.length ? vs.reduce((a, b) => a + b, 0) : null; })(),
    };
  };
  const thisGame = teamGame(round);
  const otherGames = roundsAll.filter(r => r !== round).map(teamGame);
  const seasonAvgOf = (f: (g: ReturnType<typeof teamGame>) => Num): Num =>
    avg(otherGames.map(f).filter((v): v is number => v != null));

  const teamLine = (id: string, label: string, unit: string, decimals: number,
    f: (g: ReturnType<typeof teamGame>) => Num): TeamStatLine => {
    const value = f(thisGame);
    const seasonAvg = seasonAvgOf(f);
    return { id, label, unit, decimals, value, seasonAvg, deltaPct: pctDelta(value, seasonAvg) };
  };
  const team: TeamStatLine[] = [
    teamLine("km", "Total distance", "km", 1, g => g.km),
    teamLine("dpm", "Average intensity", "m/min", 0, g => g.dpmAvg),
    teamLine("hsm", "High-speed metres", "m", 0, g => g.hsm),
    teamLine("vhs", "Very high-speed metres", "m", 0, g => g.vhs),
    teamLine("top", "Fastest player", "km/h", 1, g => g.topMax),
    teamLine("load", "Player load", "", 0, g => g.load),
  ];

  // ── Halves ────────────────────────────────────────────────────────────────
  const bothHalves = matchBundles.filter(({ b }) => b.h1 && b.h2).map(({ b }) => b);
  const halfSum = (side: "h1" | "h2", f: (r: GpsSession) => Num): Num => {
    const vs = bothHalves.map(b => (b[side] ? f(b[side]!) : null)).filter((v): v is number => v != null);
    return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
  };
  // Best/worst labels read "R7 v Croatia" — round number plus opponent —
  // rather than the raw Catapult round tag like "R7-1sts".
  const roundOpp = new Map<string, string | null>();
  for (const b of byKey.values()) {
    if (!roundOpp.get(b.round)) roundOpp.set(b.round, b.opponent);
  }
  const roundLabel = (rd: string) => {
    const short = rd.replace(/-[^-]+$/, "");
    const opp = roundOpp.get(rd);
    return opp ? `${short} v ${opp}` : short;
  };

  // Season context: the same 1st→2nd-half change computed for every OTHER
  // round this season (only bundles with both halves count, same as above).
  const halfChangeForRound = (rd: string, f: (r: GpsSession) => Num): Num => {
    const bs = [...byKey.entries()]
      .filter(([k]) => k.endsWith(`|${rd}`))
      .map(([, b]) => b)
      .filter(b => b.h1 && b.h2);
    if (!bs.length) return null;
    const sumSide = (side: "h1" | "h2") => {
      const vs = bs.map(b => f(b[side]!)).filter((v): v is number => v != null);
      return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
    };
    return pctDelta(sumSide("h2"), sumSide("h1"));
  };
  const halfLine = (id: string, label: string, unit: string, decimals: number, f: (r: GpsSession) => Num): HalfLine => {
    const h1 = halfSum("h1", f); const h2 = halfSum("h2", f);
    const others = roundsAll
      .filter(r => r !== round)
      .map(rd => ({ rd, pct: halfChangeForRound(rd, f) }))
      .filter((x): x is { rd: string; pct: number } => x.pct != null);
    const bestX = others.length ? others.reduce((p, x) => (x.pct > p.pct ? x : p)) : null;
    const worstX = others.length ? others.reduce((p, x) => (x.pct < p.pct ? x : p)) : null;
    return {
      id, label, unit, decimals, h1, h2, changePct: pctDelta(h2, h1),
      seasonChangePct: avg(others.map(x => x.pct)),
      bestChange: bestX ? { pct: bestX.pct, round: roundLabel(bestX.rd) } : null,
      worstChange: worstX ? { pct: worstX.pct, round: roundLabel(worstX.rd) } : null,
    };
  };
  const halves: HalfLine[] = bothHalves.length
    ? [
        halfLine("km", "Distance", "km", 1, val.km),
        halfLine("hsm", "High-speed metres", "m", 0, val.hsm),
        halfLine("vhs", "Very high-speed metres", "m", 0, val.vhs),
        halfLine("load", "Player load", "", 0, val.load),
      ]
    : [];

  // ── Insights ──────────────────────────────────────────────────────────────
  const standouts: InsightLine[] = [];
  const watch: InsightLine[] = [];
  const push = (arr: InsightLine[], kind: InsightKind, player: string | null, text: string) =>
    arr.push({ kind, player, text });

  for (const p of players) {
    const base = baselineOf.get(p.name)!;
    const m = p.mins ?? 0;
    const group = posGroupOf(p.position);
    const posBit = group && group !== "GK" ? ` — exactly what you want from a ${group.toLowerCase()}` : "";

    // Season bests
    if (p.topSpeed != null && base.bestTop != null && p.topSpeed > base.bestTop)
      push(standouts, "best", p.name, `Season-best top speed: ${fmt(p.topSpeed, 1)} km/h (previous best ${fmt(base.bestTop, 1)})${group === "CB" ? " — a centre-back hitting a season top speed is worth noting" : ""}.`);
    if (m >= FULL_GAME_MINS && p.km != null && base.bestKm != null && p.km > base.bestKm)
      push(standouts, "best", p.name, `Most ground covered this season: ${fmt(p.km, 2)} km (previous best ${fmt(base.bestKm, 2)})${group === "Fullback" ? posBit : ""}.`);
    if (m >= FULL_GAME_MINS && p.hsm != null && base.bestHsm != null && p.hsm > base.bestHsm)
      push(standouts, "best", p.name, `Season-high high-speed metres: ${fmt(p.hsm, 0)} m (previous best ${fmt(base.bestHsm, 0)})${group === "Forward" || group === "CB" ? posBit : ""}.`);
    if (m >= FULL_GAME_MINS && p.dpm != null && base.bestDpm != null && p.dpm > base.bestDpm)
      push(standouts, "best", p.name, `Best metres-per-minute of the season: ${fmt(p.dpm, 0)} m/min (previous best ${fmt(base.bestDpm, 0)}).`);

    // Above own normal (rates)
    if (m >= MIN_FLAG_MINS && base.games >= 2) {
      if (p.dpmDelta != null && p.dpmDelta >= UP_PCT)
        push(standouts, "up", p.name, `Ran ${fmt(p.dpmDelta, 0)}% above their normal intensity (${fmt(p.dpm, 0)} vs a usual ${fmt(base.dpm, 0)} m/min)${group === "Fullback" ? posBit : ""}.`);
      if (p.hsmDelta != null && p.hsmDelta >= UP_PCT && p.hsm != null)
        push(standouts, "up", p.name, `High-speed running ${fmt(p.hsmDelta, 0)}% above their own average rate (${fmt(p.hsm, 0)} m in ${fmt(p.mins, 0)} mins)${group === "Forward" ? posBit : ""}.`);
    }

    // Vidmar radar
    if (m >= MIN_FLAG_MINS && p.hsmPctOfDist != null && p.hsmPctOfDist >= RADAR_HSM_PCT)
      push(standouts, "radar", p.name, `${fmt(p.hsmPctOfDist, 1)}% of their total distance was at high speed — the ${RADAR_HSM_PCT}%+ zone that marks out genuine athletic capability.`);

    // Under normal
    if (m >= MIN_FLAG_MINS && base.games >= 2 && p.dpmDelta != null && p.dpmDelta <= -DOWN_PCT)
      push(watch, "down", p.name, `Intensity ${fmt(Math.abs(p.dpmDelta), 0)}% under their normal (${fmt(p.dpm, 0)} vs a usual ${fmt(base.dpm, 0)} m/min) — could be tactical role, could be fatigue; worth a conversation.`);
    if (m < MIN_FLAG_MINS && m > 0) {
      // A short stint with the rate UP is a positive, not a worry — it belongs
      // in the standouts. Only downs/unknowns go on the watch list.
      if (p.dpmDelta != null && p.dpmDelta >= UP_PCT)
        push(standouts, "up", p.name, `Made ${fmt(p.mins, 0)} minutes count — ran ${fmt(p.dpmDelta, 0)}% above their normal intensity off the bench.`);
      else
        push(watch, "note", p.name, `Only ${fmt(p.mins, 0)} minutes — judged on per-minute rate, not volume${p.dpmDelta != null ? ` (intensity ${p.dpmDelta >= 0 ? "up" : "down"} ${fmt(Math.abs(p.dpmDelta), 0)}% on their normal)` : ""}.`);
    }

    // Month-long slide
    if (base.recentDpm != null && base.earlierDpm != null && base.earlierDpm > 0) {
      const slide = ((base.recentDpm / base.earlierDpm) - 1) * 100;
      if (slide <= -REGRESS_PCT)
        push(watch, "trend", p.name, `Running intensity has slipped ${fmt(Math.abs(slide), 0)}% across the last ${REGRESS_RECENT} games vs earlier in the season — one to monitor over the next fortnight.`);
    }
  }

  // ── Trend (last TREND_GAMES rounds incl. this one) ───────────────────────
  const roundDates = new Map<string, { date: number | null; opponent: string | null; dateLabel: string | null }>();
  for (const b of byKey.values()) {
    if (!roundDates.has(b.round)) roundDates.set(b.round, { date: b.date, opponent: b.opponent, dateLabel: b.dateLabel });
  }
  const orderedRounds = [...roundDates.entries()]
    .sort((a, b) => (a[1].date ?? -Infinity) - (b[1].date ?? -Infinity))
    .map(([r]) => r);
  const upto = orderedRounds.indexOf(round);
  const trendRounds = (upto >= 0 ? orderedRounds.slice(0, upto + 1) : orderedRounds).slice(-TREND_GAMES);
  // Per-position-group distance + intensity for a round (drives the trend hover).
  const bucketOf = (name: string): TrendGroupLine["label"] | null => {
    const g = posGroupOf(positions.get(name));
    if (g === "GK") return "GK";
    if (g === "Fullback" || g === "CB") return "Def";
    if (g === "Midfielder") return "Mid";
    if (g === "Forward") return "For";
    return null;
  };
  const groupsOf = (rd: string): TrendGroupLine[] => {
    const perBucket = new Map<TrendGroupLine["label"], { kms: number[]; dpms: number[]; n: number }>();
    for (const [key, b] of byKey.entries()) {
      if (!key.endsWith(`|${rd}`)) continue;
      const bucket = bucketOf(key.slice(0, key.lastIndexOf("|")));
      if (!bucket) continue;
      let acc = perBucket.get(bucket);
      if (!acc) { acc = { kms: [], dpms: [], n: 0 }; perBucket.set(bucket, acc); }
      acc.n++;
      const km = total(b, val.km, true);
      if (km != null) acc.kms.push(km);
      const direct = b.game?.distancePerMinMm ?? null;
      const m = mins(b);
      const dpm = direct ?? (m && km != null ? (km * 1000) / m : null);
      if (dpm != null) acc.dpms.push(dpm);
    }
    return (["GK", "Def", "Mid", "For"] as const)
      .filter(l => perBucket.has(l))
      .map(l => {
        const acc = perBucket.get(l)!;
        return {
          label: l, players: acc.n,
          km: acc.kms.length ? acc.kms.reduce((a, b) => a + b, 0) : null,
          dpm: avg(acc.dpms),
        };
      });
  };
  const trend: TrendPoint[] = trendRounds.map(rd => {
    const g = teamGame(rd);
    const info = roundDates.get(rd)!;
    return {
      round: rd, opponent: info.opponent, dateLabel: info.dateLabel,
      players: g.players, kmTotal: g.km, dpmAvg: g.dpmAvg,
      hsmPerMinAvg: g.hsm != null && g.minsTotal ? g.hsm / g.minsTotal : null,
      groups: groupsOf(rd),
    };
  });

  return {
    version: 1,
    squad, round, opponent, dateLabel, year, teamLabel, generatedOn,
    team, halves, players, standouts, watch, trend,
  };
}
