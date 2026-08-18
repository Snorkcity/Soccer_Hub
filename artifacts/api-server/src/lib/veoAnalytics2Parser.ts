// ── Analytics 2 parser — camera-derived Veo player metrics ───────────────────
// Parses the raw Analytics 2 bundle stored in veo_analytics2.raw into stable
// player metrics for the API response. Never touches GPS data.
//
// Design principles:
//  - Exact live stat-type keys from Veo cross-match API are mapped to stable
//    metric names. All others land in unknownMetrics (captaincy, POTM, etc.).
//  - Zero is a valid physical value — only null means "no data".
//  - Physical metrics: weighted average speed (by secondsPlayed); topSpeed is
//    max across drills; double-counting avoided: if an explicit "full/match"
//    summary drill exists use it alone; otherwise sum period drills.
//  - Player identity: known_name preferred; then "first_name last_name"; no
//    player_name field exists in the live API.
//  - Season aggregation groups by durable official Hub player ID when available,
//    then stable Veo player ID, then per-match-scoped
//    ("match:<veoMatchId>:jersey:<n>"). Jersey-only rows are NEVER merged
//    across matches unless they resolve to the same unique Hub player. Identity
//    enrichment happens PER MATCH PLAYER before aggregation.
//  - Unknown identity keys (no player_id, no jersey) use a deterministic
//    per-row index rather than Math.random().
import type { Analytics2Bundle, CrossMatchPlayerRow, PhysicalMetricRow, MesEventRow } from "./veo";

// ── Stable metrics returned for each player ───────────────────────────────────
export interface PlayerStableMetrics {
  // Appearance
  matches: number | null;
  starts: number | null;
  minutesPlayed: number | null;   // derived: Math.floor(secondsPlayed / 60)
  secondsPlayed: number | null;
  // Physical (camera-derived, from physical-metrics endpoint)
  distanceMetres: number | null;
  avgSpeedKmh: number | null;     // weighted avg by secondsPlayed across drills
  topSpeedKmh: number | null;     // max across drills
  sprints: number | null;
  hir: number | null;             // high-intensity runs
  // Event-based (from cross-match player summary)
  goals: number | null;
  assists: number | null;
  involvements: number | null;
  shots: number | null;
  attempts: number | null;
  conversion: number | null;      // percentage
  passes: number | null;
  passesSuccessful: number | null;
  passesUnsuccessful: number | null;
  passSuccess: number | null;     // percentage
  tackles: number | null;
  dribbles: number | null;
  interceptions: number | null;
  looseRecoveries: number | null;
  saves: number | null;
  corners: number | null;
  freeKicks: number | null;
  throwIns: number | null;
  fouls: number | null;
  penalties: number | null;
  goalKicks: number | null;
}

// ── Per-player identity ────────────────────────────────────────────────────────
export interface PlayerIdentityInfo {
  veoPlayerId: string | null;
  jerseyNumber: number | null;
  veoPlayerName: string | null;   // known_name ?? "first last"
  hubPlayerId: number | null;      // durable players.id; never derived from GPS
  hubPlayerName: string | null;   // resolved via league_player_stats
  identityStatus: "resolved" | "unresolved" | "ambiguous";
}

// ── MES event timeline entry ──────────────────────────────────────────────────
export interface EventTimelineEntry {
  eventType: string;
  videoTimeMs: number | null;
  periodId: number | null;
  periodTimeMs: number | null;
  outcome: string | null;
  x: number | null;
  z: number | null;
  jerseyNumber: string | null;
  isOwn: boolean;
}

// ── Source/coverage metadata ──────────────────────────────────────────────────
export interface SourceCoverage {
  hasCrossMatch: boolean;
  hasPhysicalMetrics: boolean;
  hasMesEvents: boolean;
  hasJerseyNumbers: boolean;
  fetchedAt: string | null;
}

// ── Full parsed player record ─────────────────────────────────────────────────
export interface ParsedPlayer {
  // identityKey before Hub enrichment (used internally; aggregation uses post-enrichment key).
  identityKey: string;
  identity: PlayerIdentityInfo;
  metrics: PlayerStableMetrics;
  unknownMetrics: Record<string, unknown>;
  eventTimeline: EventTimelineEntry[];
}

// ── Full parsed match bundle ──────────────────────────────────────────────────
export interface ParsedAnalytics2Match {
  players: ParsedPlayer[];
  coverage: SourceCoverage;
}

// ── Exact live stat-type keys from Veo cross-match API ────────────────────────
// Source: confirmed via live probe (Aug 2026). Keys are snake_case with _total
// suffix for counting stats; rates use _rate suffix. Unknown types (captaincy,
// POTM) are preserved in unknownMetrics unchanged.
const STAT_TYPE_MAP: Record<string, keyof PlayerStableMetrics> = {
  matches_total:                    "matches",
  starts_total:                     "starts",
  football_goal_total:              "goals",
  football_assist_total:            "assists",
  football_goal_involvement_total:  "involvements",
  football_shots_total:             "shots",
  football_attempts_total:          "attempts",
  football_conversion_rate:         "conversion",
  football_corner_total:            "corners",
  football_free_kick_total:         "freeKicks",
  football_goal_kick_total:         "goalKicks",
  football_throw_in_total:          "throwIns",
  football_foul_total:              "fouls",
  football_penalty_total:           "penalties",
  football_tackle_total:            "tackles",
  football_dribble_total:           "dribbles",
  football_interception_total:      "interceptions",
  football_loose_total:             "looseRecoveries",
  football_save_total:              "saves",
  football_passes_total:            "passes",
  football_passes_completed_total:  "passesSuccessful",
  football_passes_unsuccessful_total: "passesUnsuccessful",
  football_passes_success_rate:     "passSuccess",
  distance_total_meters:            "distanceMetres",
  sprints_total:                    "sprints",
  top_speed_kmh:                    "topSpeedKmh",
  average_speed_kmh:                "avgSpeedKmh",
  high_intensity_runs_total:        "hir",
  seconds_played_total:             "secondsPlayed",
};

// These stat types are intentionally left unmapped (go to unknownMetrics).
const INTENTIONALLY_UNKNOWN_STAT_TYPES = new Set([
  "captaincies_total",
  "player_of_the_match_total",
]);

// Known identity/metadata keys on the cross-match player row (not metrics).
// Live API uses first_name, last_name, known_name — no player_name field.
const KNOWN_PLAYER_META_KEYS = new Set([
  "player_id",
  "first_name",
  "last_name",
  "known_name",
  "jersey_number",
  "stats",
  "match_id",
  "team_id",
  "team",
]);

function emptyMetrics(): PlayerStableMetrics {
  return {
    matches: null, starts: null, minutesPlayed: null, secondsPlayed: null,
    distanceMetres: null, avgSpeedKmh: null, topSpeedKmh: null,
    sprints: null, hir: null,
    goals: null, assists: null, involvements: null,
    shots: null, attempts: null, conversion: null,
    passes: null, passesSuccessful: null, passesUnsuccessful: null, passSuccess: null,
    tackles: null, dribbles: null, interceptions: null, looseRecoveries: null,
    saves: null, corners: null, freeKicks: null, throwIns: null,
    fouls: null, penalties: null, goalKicks: null,
  };
}

// safeNum: null means "not present/invalid"; 0 is valid.
function safeNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeJerseyNumber(v: unknown): number | null {
  const jersey = safeNum(v);
  return jersey != null && Number.isInteger(jersey) && jersey >= 0 ? jersey : null;
}

function isOwnTeam(team: string | null | undefined): boolean {
  return team?.trim().toLowerCase() === "own";
}

// Build veoPlayerName from live API identity fields.
// known_name is preferred (Veo's display name); falls back to "first last".
function buildVeoPlayerName(row: CrossMatchPlayerRow): string | null {
  const known = typeof row.known_name === "string" ? row.known_name.trim() : null;
  if (known) return known;
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  const full = [first, last].filter(Boolean).join(" ");
  return full || null;
}

// ── Cross-match stats parser ──────────────────────────────────────────────────
function parseCrossMatchStats(
  stats: CrossMatchPlayerRow["stats"],
): { metrics: Partial<PlayerStableMetrics>; unknownMetrics: Record<string, unknown> } {
  const metrics: Partial<PlayerStableMetrics> = {};
  const unknownMetrics: Record<string, unknown> = {};
  if (!Array.isArray(stats)) return { metrics, unknownMetrics };

  for (const entry of stats) {
    if (!entry || typeof entry.type !== "string") continue;
    const mapped = STAT_TYPE_MAP[entry.type];
    if (mapped) {
      const val = safeNum(entry.value);
      // Allow zero — only skip if genuinely null/non-finite.
      if (val !== null && (metrics as Record<string, unknown>)[mapped] == null) {
        (metrics as Record<string, unknown>)[mapped] = val;
      }
    } else {
      // Preserve all unknown types including intentionally-unmapped ones.
      unknownMetrics[entry.type] = { value: entry.value, unit: entry.unit };
    }
  }

  // Derive minutesPlayed from secondsPlayed if present.
  if (metrics.secondsPlayed != null && metrics.minutesPlayed == null) {
    metrics.minutesPlayed = Math.floor(metrics.secondsPlayed / 60);
  }

  return { metrics, unknownMetrics };
}

// ── Physical-metrics aggregator ───────────────────────────────────────────────
// Rules:
//  - If any drill name matches /full|match/i, use ONLY that row (it's the
//    full-match summary). Avoids double-counting period rows.
//  - Otherwise, sum period rows ("1", "2", "1st half", "2nd half", etc.).
//  - Average speed is weighted by each drill's secondsPlayed.
//  - topSpeed is the max across all included rows.
//  - Zero values ARE valid (player played but covered 0 sprints, etc.).
//  - A row is "present" for a jersey if it appears at all; null fields within
//    it stay null, but numeric 0s are preserved.
function aggregatePhysicalMetrics(
  rows: PhysicalMetricRow[],
  jerseyNumber: number,
): { metrics: Partial<PlayerStableMetrics>; unknownMetrics: Record<string, unknown> } {
  const physMetrics: Partial<PlayerStableMetrics> = {};
  const unknownMetrics: Record<string, unknown> = {};

  // Filter to this jersey's rows.
  const myRows = rows.filter(
    (r) => r.jerseyNumber != null && Number(r.jerseyNumber) === jerseyNumber,
  );
  if (myRows.length === 0) return { metrics: physMetrics, unknownMetrics };

  // Prefer explicit full-match summary row(s). If found, use only those rows.
  const fullRows = myRows.filter((r) => /full|match/i.test(r.drill ?? ""));
  const summaryRows = fullRows.length > 0 ? fullRows : myRows;

  // Accumulate across summary rows.
  // distance and sprints/hir sum; speed uses weighted avg.
  let distance = 0;
  let totalSeconds = 0;
  let sprints = 0;
  let hsr = 0;
  let maxSpeed: number | null = null;
  // For weighted avg speed: sum of (speed * seconds).
  let weightedSpeedSum = 0;
  let weightedSpeedSecs = 0;

  let hasDistance = false;
  let hasSeconds = false;
  let hasSprints = false;
  let hasHsr = false;

  for (const r of summaryRows) {
    const d = safeNum(r.distance);
    if (d != null) {
      distance += d;
      hasDistance = true;
    }
    const s = safeNum(r.secondsPlayed);
    if (s != null) {
      totalSeconds += s;
      hasSeconds = true;
    }
    const sp = safeNum(r.sprints);
    if (sp != null) {
      sprints += sp;
      hasSprints = true;
    }
    const h = safeNum(r.hsr);
    if (h != null) {
      hsr += h;
      hasHsr = true;
    }

    // topSpeed: max across drills.
    const ms = safeNum(r.maxSpeed);
    if (ms != null) {
      if (maxSpeed === null || ms > maxSpeed) maxSpeed = ms;
    }

    // Weighted average speed by secondsPlayed for this drill.
    const as_ = safeNum(r.averageSpeed);
    if (as_ != null && s != null && s > 0) {
      weightedSpeedSum += as_ * s;
      weightedSpeedSecs += s;
    }

    // Capture unknown fields from first row.
    if (r === summaryRows[0]) {
      for (const [k, v] of Object.entries(r)) {
        if (!["id","matchId","teamId","jerseyNumber","drill","distance","secondsPlayed",
              "maxSpeed","averageSpeed","maxAccel","maxDecel","sprints","hsr"].includes(k)) {
          unknownMetrics[`phys.${k}`] = v;
        }
      }
    }
  }

  // Set each value only if that field appeared at least once. A genuine zero is
  // retained; an absent/null field remains null after the final emptyMetrics merge.
  if (hasDistance) physMetrics.distanceMetres = distance;
  if (hasSprints) physMetrics.sprints = sprints;
  if (hasHsr) physMetrics.hir = hsr;
  if (hasSeconds) {
    physMetrics.secondsPlayed = totalSeconds;
    physMetrics.minutesPlayed = Math.floor(totalSeconds / 60);
  }
  if (maxSpeed !== null) physMetrics.topSpeedKmh = maxSpeed;
  if (weightedSpeedSecs > 0) {
    physMetrics.avgSpeedKmh = weightedSpeedSum / weightedSpeedSecs;
  }

  return { metrics: physMetrics, unknownMetrics };
}

// ── MES event timeline ────────────────────────────────────────────────────────
function buildEventTimeline(
  events: MesEventRow[],
  jerseyNumber: number | null,
): EventTimelineEntry[] {
  if (jerseyNumber == null) return [];
  return events
    .filter((e) => {
      if (!e.playerJersey) return false;
      if (!isOwnTeam(e.team)) return false;
      // Normalise: "07" vs "7" — compare as numbers.
      return safeJerseyNumber(e.playerJersey) === jerseyNumber;
    })
    .map((e) => ({
      eventType: e.eventType ?? "unknown",
      videoTimeMs: safeNum(e.videoTimeMs),
      periodId: safeNum(e.periodId),
      periodTimeMs: safeNum(e.periodTimeMs),
      outcome: e.outcome ?? null,
      x: safeNum(e.x),
      z: safeNum(e.z),
      jerseyNumber: String(jerseyNumber),
      isOwn: isOwnTeam(e.team),
    }))
    .sort((a, b) => (a.videoTimeMs ?? 0) - (b.videoTimeMs ?? 0));
}

// ── Main bundle parser ────────────────────────────────────────────────────────
// Produces ParsedPlayer[] from the raw bundle. Identity is Veo-side only at
// this stage; Hub enrichment is applied by the route handler per match.
export function parseAnalytics2Bundle(
  bundle: Analytics2Bundle | null | undefined,
  fetchedAt: string | null,
): ParsedAnalytics2Match {
  const coverage: SourceCoverage = {
    hasCrossMatch: false,
    hasPhysicalMetrics: false,
    hasMesEvents: false,
    hasJerseyNumbers: false,
    fetchedAt,
  };

  if (!bundle) return { players: [], coverage };

  const crossItems: CrossMatchPlayerRow[] = Array.isArray(bundle.crossMatchPlayer?.items)
    ? (bundle.crossMatchPlayer!.items as CrossMatchPlayerRow[])
    : [];
  if (bundle.crossMatchPlayer !== undefined) coverage.hasCrossMatch = true;

  const physRows: PhysicalMetricRow[] = Array.isArray(bundle.physicalMetrics)
    ? (bundle.physicalMetrics as PhysicalMetricRow[])
    : [];
  if (bundle.physicalMetrics !== undefined) coverage.hasPhysicalMetrics = true;

  const mesEvents: MesEventRow[] = Array.isArray(bundle.matchEvents?.events)
    ? (bundle.matchEvents!.events as MesEventRow[])
    : [];
  if (bundle.matchEvents !== undefined) coverage.hasMesEvents = true;

  if (bundle.jerseyNumbers !== undefined) coverage.hasJerseyNumbers = true;

  // Cross-match is the richest identity source, but each Analytics 2 source is
  // independent. Seed additional unresolved jersey candidates from physical
  // rows and own-team MES events so useful partial data is never hidden.
  const candidates: Array<{ row: CrossMatchPlayerRow | null; jerseyNumber: number | null; fallbackIdx: number }> =
    crossItems.map((row, rowIdx) => ({
      row,
      jerseyNumber: safeJerseyNumber(row.jersey_number),
      fallbackIdx: rowIdx,
    }));
  const representedJerseys = new Set(
    candidates
      .map((candidate) => candidate.jerseyNumber)
      .filter((jersey): jersey is number => jersey != null),
  );
  const sourceJerseys = [
    ...physRows.map((row) => safeJerseyNumber(row.jerseyNumber)),
    ...mesEvents
      .filter((event) => isOwnTeam(event.team))
      .map((event) => safeJerseyNumber(event.playerJersey)),
  ];
  for (const jerseyNumber of sourceJerseys) {
    if (jerseyNumber == null || representedJerseys.has(jerseyNumber)) continue;
    representedJerseys.add(jerseyNumber);
    candidates.push({ row: null, jerseyNumber, fallbackIdx: candidates.length });
  }

  const players: ParsedPlayer[] = candidates.map(({ row, jerseyNumber, fallbackIdx }) => {
    const veoPlayerId = typeof row?.player_id === "string" && row.player_id ? row.player_id : null;
    const veoPlayerName = row ? buildVeoPlayerName(row) : null;

    // Within-match identity key: prefer stable player_id; else jersey number;
    // else deterministic positional index (no Math.random).
    const identityKey = veoPlayerId != null
      ? `player:${veoPlayerId}`
      : jerseyNumber != null
        ? `jersey:${jerseyNumber}`
        : `unknown:${fallbackIdx}`;

    // Parse stats from the cross-match player row.
    const { metrics: crossMetrics, unknownMetrics: crossUnknown } = parseCrossMatchStats(row?.stats);

    // Parse physical metrics for this jersey (zero-valid).
    const { metrics: physMetrics, unknownMetrics: physUnknown } = jerseyNumber != null
      ? aggregatePhysicalMetrics(physRows, jerseyNumber)
      : { metrics: {}, unknownMetrics: {} };

    // Merge: physical metrics are the base; cross-match stats win on overlap
    // (cross-match already aggregates across periods server-side for counting
    // stats and speed/distance when the recording has full-match data).
    const merged: PlayerStableMetrics = {
      ...emptyMetrics(),
      ...physMetrics,
      ...crossMetrics,
    };

    // Capture unknown top-level fields from the cross-match player row.
    const rowUnknown: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row ?? {})) {
      if (!KNOWN_PLAYER_META_KEYS.has(k)) rowUnknown[`cross.${k}`] = v;
    }

    const unknownMetrics = { ...physUnknown, ...crossUnknown, ...rowUnknown };

    const eventTimeline = buildEventTimeline(mesEvents, jerseyNumber);

    return {
      identityKey,
      identity: {
        veoPlayerId,
        jerseyNumber,
        veoPlayerName,
        hubPlayerId: null,
        hubPlayerName: null,
        identityStatus: "unresolved" as const,
      },
      metrics: merged,
      unknownMetrics,
      eventTimeline,
    };
  });

  return { players, coverage };
}

// ── Season aggregation ────────────────────────────────────────────────────────
// Receives players that have ALREADY been enriched with Hub identity per match.
// Grouping key (in priority order):
//   1. "hub:<playerId>"          — durable official players.id
//   2. "veo:<playerId>"          — stable Veo player ID
//   3. "match:<veoMatchId>:jersey:<n>" — per-match-scoped (unresolved/ambiguous)
//   4. "match:<veoMatchId>:idx:<n>"    — deterministic fallback for unknown jersey
// Jersey-only keys are NEVER merged across matches — each occurrence gets its
// own match-scoped entry unless it resolves to the same Hub player.
export interface SeasonPlayerRow {
  identityKey: string;
  identity: PlayerIdentityInfo;
  totals: PlayerStableMetrics;
  per90: Partial<Record<keyof PlayerStableMetrics, number | null>>;
  matchBreakdowns: Array<{
    veoMatchId: string;
    opponent: string | null;
    startsAt: string | null;
    title: string | null;
    metrics: PlayerStableMetrics;
    available: boolean;
    jerseyNumber: number | null;
  }>;
  matchCount: number;
}

const NUMERIC_METRIC_KEYS: Array<keyof PlayerStableMetrics> = [
  "matches","starts","minutesPlayed","secondsPlayed",
  "distanceMetres","avgSpeedKmh","topSpeedKmh","sprints","hir",
  "goals","assists","involvements","shots","attempts","conversion",
  "passes","passesSuccessful","passesUnsuccessful","passSuccess",
  "tackles","dribbles","interceptions","looseRecoveries","saves",
  "corners","freeKicks","throwIns","fouls","penalties","goalKicks",
];

// Keys where we take a weighted/simple average rather than sum.
// topSpeedKmh is max, not average — handled separately.
const AVG_KEYS = new Set<keyof PlayerStableMetrics>([
  "conversion", "passSuccess",
]);
// avgSpeedKmh: weighted by secondsPlayed — handled separately.
// topSpeedKmh: max — handled separately.

// Build the season-aggregation grouping key for a player, given that they have
// already been enriched with Hub identity for the specific match.
function seasonKey(
  player: ParsedPlayer & { identity: PlayerIdentityInfo },
  veoMatchId: string,
  rowIdx: number,
): string {
  if (player.identity.hubPlayerId != null) {
    return `hub:${player.identity.hubPlayerId}`;
  }
  if (player.identity.veoPlayerId) {
    return `veo:${player.identity.veoPlayerId}`;
  }
  // No durable ID: remain match-scoped even if a shirt resolved to a display
  // name. Display names are not unique across a season.
  if (player.identity.jerseyNumber != null) {
    return `match:${veoMatchId}:jersey:${player.identity.jerseyNumber}`;
  }
  return `match:${veoMatchId}:idx:${rowIdx}`;
}

export function aggregateSeason(
  matchRecords: Array<{
    veoMatchId: string;
    opponent: string | null;
    startsAt: string | null;
    title: string | null;
    // Players already enriched with Hub identity for this match.
    players: ParsedPlayer[];
    available: boolean;
  }>,
): SeasonPlayerRow[] {
  const byKey = new Map<string, {
    identity: PlayerIdentityInfo;
    matchData: Array<{
      veoMatchId: string;
      opponent: string | null;
      startsAt: string | null;
      title: string | null;
      metrics: PlayerStableMetrics;
      available: boolean;
      jerseyNumber: number | null;
    }>;
  }>();

  for (const match of matchRecords) {
    match.players.forEach((player, playerIdx) => {
      const key = seasonKey(player, match.veoMatchId, playerIdx);
      const breakdown = {
        veoMatchId: match.veoMatchId,
        opponent: match.opponent,
        startsAt: match.startsAt,
        title: match.title,
        metrics: player.metrics,
        available: match.available,
        jerseyNumber: player.identity.jerseyNumber,
      };
      const existing = byKey.get(key);
      if (existing) {
        existing.matchData.push(breakdown);
        // Prefer resolved identity, then any better-identified one.
        if (
          player.identity.identityStatus === "resolved" &&
          existing.identity.identityStatus !== "resolved"
        ) {
          existing.identity = player.identity;
        }
      } else {
        byKey.set(key, {
          identity: player.identity,
          matchData: [breakdown],
        });
      }
    });
  }

  const result: SeasonPlayerRow[] = [];

  for (const [identityKey, data] of byKey) {
    const totals = emptyMetrics();
    const avgAccum: Partial<Record<keyof PlayerStableMetrics, { sum: number; n: number }>> = {};
    // For weighted average speed.
    let weightedSpeedSum = 0;
    let weightedSpeedSecs = 0;
    // For topSpeedKmh (max).
    let maxTopSpeed: number | null = null;

    for (const m of data.matchData) {
      if (!m.available) continue;
      for (const k of NUMERIC_METRIC_KEYS) {
        const v = m.metrics[k];
        if (v == null) continue;

        if (k === "avgSpeedKmh") {
          // Weight by secondsPlayed for this match.
          const secs = m.metrics.secondsPlayed ?? 0;
          if (secs > 0) {
            weightedSpeedSum += v * secs;
            weightedSpeedSecs += secs;
          }
        } else if (k === "topSpeedKmh") {
          if (maxTopSpeed === null || v > maxTopSpeed) maxTopSpeed = v;
        } else if (AVG_KEYS.has(k)) {
          const acc = avgAccum[k] ?? { sum: 0, n: 0 };
          acc.sum += v;
          acc.n++;
          avgAccum[k] = acc;
        } else {
          // Sum all other numeric fields.
          const rec = totals as unknown as Record<string, number | null>;
          rec[k] = (rec[k] ?? 0) + v;
        }
      }
    }

    // Apply rate averages.
    for (const [k, acc] of Object.entries(avgAccum) as Array<[keyof PlayerStableMetrics, { sum: number; n: number }]>) {
      if (acc.n > 0) (totals as unknown as Record<string, number>)[k] = acc.sum / acc.n;
    }
    // Apply weighted average speed.
    if (weightedSpeedSecs > 0) totals.avgSpeedKmh = weightedSpeedSum / weightedSpeedSecs;
    // Apply max top speed.
    if (maxTopSpeed !== null) totals.topSpeedKmh = maxTopSpeed;

    // Per90: divide counting stats by (minutesPlayed / 90).
    const per90: Partial<Record<keyof PlayerStableMetrics, number | null>> = {};
    const mins = totals.minutesPlayed;
    if (mins != null && mins > 0) {
      const denom = mins / 90;
      const rec = totals as unknown as Record<string, number | null>;
      for (const k of NUMERIC_METRIC_KEYS) {
        if (AVG_KEYS.has(k) || k === "avgSpeedKmh" || k === "topSpeedKmh") continue;
        if (k === "minutesPlayed" || k === "secondsPlayed" || k === "matches" || k === "starts") continue;
        const v = rec[k];
        per90[k] = v != null ? Number((v / denom).toFixed(2)) : null;
      }
    }

    result.push({
      identityKey,
      identity: data.identity,
      totals,
      per90,
      matchBreakdowns: data.matchData,
      matchCount: data.matchData.filter((m) => m.available).length,
    });
  }

  return result.sort((a, b) => {
    const ga = a.totals.goals ?? 0, gb = b.totals.goals ?? 0;
    if (ga !== gb) return gb - ga;
    return (b.totals.minutesPlayed ?? 0) - (a.totals.minutesPlayed ?? 0);
  });
}
