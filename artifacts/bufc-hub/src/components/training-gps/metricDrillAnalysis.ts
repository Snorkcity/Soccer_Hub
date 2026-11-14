import type { TrainingGpsSession } from "@workspace/api-client-react";
import { trainingPlayerKey, trainingPositionGroup } from "@workspace/api-zod";
import {
  canRate, matchesFilters, partRows, playerMetricHistory, selectedPlayerValues, sessionKey, sortPlayerMetricHistory,
  type TrainingFilters,
} from "./shared";

export function metricDrillAnalysis(sessions: TrainingGpsSession[], f: TrainingFilters) {
  const current = sessions.find(s => sessionKey(s) === f.sessionId) ?? sessions.at(-1);
  const key = f.playerKey ?? "";
  const pm = f.perMinute && canRate(f.metric);
  const history = sortPlayerMetricHistory(playerMetricHistory(sessions, key, f.part, f.metric, pm));
  const valid = history.filter(x => x.value != null && !x.partial);
  const ownMean = valid.length ? valid.reduce((sum, x) => sum + x.value!, 0) / valid.length : null;
  const highest = valid.length ? Math.max(...valid.map(x => x.value!)) : null;
  const currentItem = history.find(x => x.key === (current && sessionKey(current))) ?? null;
  const me = current && partRows(current).find(r => trainingPlayerKey(r) === key)
    || sessions.flatMap(partRows).find(r => trainingPlayerKey(r) === key);
  const group = trainingPositionGroup(me?.positionCode ?? null);
  const position = group === "Goalkeepers" || group === "Unassigned" ? group
    : f.position === "outfield" || f.position === group ? f.position : "outfield";
  const squad = f.squad === "all" || f.squad === me?.squad ? f.squad : "all";
  const cohort = { squad, position };
  const values = (s: TrainingGpsSession) => selectedPlayerValues({
    ...s, rows: s.rows.filter(r => matchesFilters(r, cohort)),
  }, f.part, f.metric, pm).filter(x => x.value != null && !x.partial);
  const sessionValues = current ? values(current) : [];
  const sessionMe = sessionValues.find(x => x.key === key);
  const sessionRank = sessionMe ? { rank: 1 + sessionValues.filter(x => x.value! > sessionMe.value!).length, n: sessionValues.length } : null;
  const personalRank = currentItem?.value != null && !currentItem.partial
    ? { rank: 1 + valid.filter(x => x.value! > currentItem.value!).length, n: valid.length } : null;
  const seasonPlayers = new Map<string, { name: string; sum: number; n: number }>();
  for (const s of sessions) for (const v of values(s)) {
    const entry = seasonPlayers.get(v.key) ?? { name: v.name, sum: 0, n: 0 };
    entry.sum += v.value!; entry.n++;
    seasonPlayers.set(v.key, entry);
  }
  const seasonMeans = [...seasonPlayers].map(([playerKey, v]) => ({ key: playerKey, name: v.name, mean: v.sum / v.n, n: v.n }));
  const seasonMe = seasonMeans.find(x => x.key === key);
  const seasonRank = seasonMe ? {
    rank: 1 + seasonMeans.filter(x => x.mean > seasonMe.mean).length, n: seasonMeans.length, samples: seasonMe.n, mean: seasonMe.mean,
  } : null;
  return { current, history, currentItem, ownMean, highest, validCount: valid.length, personalRank, sessionRank, seasonRank, seasonMeans,
    cohortLabel: `${squad === "all" ? "All squads" : squad} · ${position === "outfield" ? "Outfield players" : position}`, pm };
}
