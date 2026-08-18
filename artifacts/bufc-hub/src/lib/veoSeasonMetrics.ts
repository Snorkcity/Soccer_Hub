import type {
  VeoPlayerStableMetrics,
  VeoSeasonPlayerRow,
} from "@workspace/api-client-react";

const NUMERIC_METRIC_KEYS: Array<keyof VeoPlayerStableMetrics> = [
  "matches", "starts", "minutesPlayed", "secondsPlayed",
  "distanceMetres", "avgSpeedKmh", "topSpeedKmh", "sprints", "hir",
  "goals", "assists", "involvements", "shots", "attempts", "conversion",
  "passes", "passesSuccessful", "passesUnsuccessful", "passSuccess",
  "tackles", "dribbles", "interceptions", "looseRecoveries", "saves",
  "corners", "freeKicks", "throwIns", "fouls", "penalties", "goalKicks",
];
const AVERAGE_METRIC_KEYS = new Set<keyof VeoPlayerStableMetrics>(["conversion", "passSuccess"]);

function emptyMetrics(): VeoPlayerStableMetrics {
  return {
    matches: null, starts: null, minutesPlayed: null, secondsPlayed: null,
    distanceMetres: null, avgSpeedKmh: null, topSpeedKmh: null,
    sprints: null, hir: null, goals: null, assists: null, involvements: null,
    shots: null, attempts: null, conversion: null, passes: null,
    passesSuccessful: null, passesUnsuccessful: null, passSuccess: null,
    tackles: null, dribbles: null, interceptions: null, looseRecoveries: null,
    saves: null, corners: null, freeKicks: null, throwIns: null, fouls: null,
    penalties: null, goalKicks: null,
  };
}

export function aggregateScopedPlayer(
  row: VeoSeasonPlayerRow,
  matchBreakdowns: VeoSeasonPlayerRow["matchBreakdowns"],
): VeoSeasonPlayerRow {
  const totals = emptyMetrics();
  const averages = new Map<keyof VeoPlayerStableMetrics, { sum: number; count: number }>();
  let weightedSpeed = 0;
  let weightedSeconds = 0;
  let topSpeed: number | null = null;

  for (const match of matchBreakdowns) {
    if (!match.available) continue;
    for (const key of NUMERIC_METRIC_KEYS) {
      const value = match.metrics[key];
      if (value == null) continue;
      if (key === "avgSpeedKmh") {
        const seconds = match.metrics.secondsPlayed ?? 0;
        if (seconds > 0) {
          weightedSpeed += value * seconds;
          weightedSeconds += seconds;
        }
      } else if (key === "topSpeedKmh") {
        topSpeed = topSpeed == null ? value : Math.max(topSpeed, value);
      } else if (AVERAGE_METRIC_KEYS.has(key)) {
        const aggregate = averages.get(key) ?? { sum: 0, count: 0 };
        aggregate.sum += value;
        aggregate.count++;
        averages.set(key, aggregate);
      } else {
        totals[key] = (totals[key] ?? 0) + value;
      }
    }
  }

  for (const [key, aggregate] of averages) {
    if (aggregate.count > 0) totals[key] = aggregate.sum / aggregate.count;
  }
  if (weightedSeconds > 0) totals.avgSpeedKmh = weightedSpeed / weightedSeconds;
  if (topSpeed != null) totals.topSpeedKmh = topSpeed;

  const per90: VeoSeasonPlayerRow["per90"] = {};
  const minutes = totals.minutesPlayed;
  if (minutes != null && minutes > 0) {
    const denominator = minutes / 90;
    for (const key of NUMERIC_METRIC_KEYS) {
      if (
        AVERAGE_METRIC_KEYS.has(key) ||
        key === "avgSpeedKmh" ||
        key === "topSpeedKmh" ||
        key === "minutesPlayed" ||
        key === "secondsPlayed" ||
        key === "matches" ||
        key === "starts"
      ) continue;
      const value = totals[key];
      per90[key] = value != null ? Number((value / denominator).toFixed(2)) : null;
    }
  }

  return {
    ...row,
    totals,
    per90,
    matchBreakdowns,
    matchCount: matchBreakdowns.filter((match) => match.available).length,
  };
}

export function scopeSeasonPlayers(
  players: VeoSeasonPlayerRow[],
  filters: { opponent: string; fromDate: string; toDate: string },
): VeoSeasonPlayerRow[] {
  const { opponent, fromDate, toDate } = filters;
  if (opponent === "all" && !fromDate && !toDate) return players;

  return players.flatMap((row) => {
    const scopedMatches = row.matchBreakdowns.filter((match) => {
      if (opponent !== "all" && match.opponent !== opponent) return false;
      if (fromDate || toDate) {
        if (!match.startsAt) return false;
        const day = match.startsAt.slice(0, 10);
        if (fromDate && day < fromDate) return false;
        if (toDate && day > toDate) return false;
      }
      return true;
    });
    return scopedMatches.length > 0 ? [aggregateScopedPlayer(row, scopedMatches)] : [];
  });
}