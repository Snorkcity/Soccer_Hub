import type { TrainingGpsRow, TrainingGpsSession } from "./generated/types";

export const TRAINING_PARTS = [
  { id: "warmup", label: "Warm-up" },
  { id: "passing", label: "Passing activation" },
  { id: "technical", label: "Technical activation" },
  { id: "main", label: "Main part" },
  { id: "end", label: "End game" },
] as const;

export const TRAINING_METRICS = [
  { id: "distance", label: "Total distance", unit: "m", rate: true },
  { id: "distancePerMinute", label: "Distance per minute", unit: "m/min", rate: false },
  { id: "hsm", label: "High-speed metres (>18 km/h)", unit: "m", rate: true },
  { id: "vhsm", label: "Very-high-speed metres (>25 km/h)", unit: "m", rate: true },
  { id: "load", label: "Catapult Player Load", unit: "AU", rate: true },
  { id: "accels", label: "Accelerations >3 m/s²", unit: "events", rate: true },
  { id: "decels", label: "Decelerations >3 m/s²", unit: "events", rate: true },
  { id: "power", label: "Power Plays", unit: "events", rate: true },
  { id: "speed", label: "Maximum speed", unit: "km/h", rate: false },
  { id: "duration", label: "Recorded participation", unit: "min", rate: false },
  { id: "sprint", label: "Catapult sprint distance (source)", unit: "m", rate: true },
  { id: "accel01", label: "Accelerations 0–1 m/s²", unit: "events", rate: true },
  { id: "accel12", label: "Accelerations 1–2 m/s²", unit: "events", rate: true },
  { id: "accel23", label: "Accelerations 2–3 m/s²", unit: "events", rate: true },
  { id: "accel34", label: "Accelerations 3–4 m/s²", unit: "events", rate: true },
  { id: "accelOver4", label: "Accelerations >4 m/s²", unit: "events", rate: true },
  { id: "decel01", label: "Decelerations 0–1 m/s²", unit: "events", rate: true },
  { id: "decel12", label: "Decelerations 1–2 m/s²", unit: "events", rate: true },
  { id: "decel23", label: "Decelerations 2–3 m/s²", unit: "events", rate: true },
  { id: "decel34", label: "Decelerations 3–4 m/s²", unit: "events", rate: true },
  { id: "decelOver4", label: "Decelerations >4 m/s²", unit: "events", rate: true },
  { id: "maxAccel", label: "Peak acceleration", unit: "m/s²", rate: false },
  { id: "maxDecel", label: "Peak deceleration", unit: "m/s²", rate: false },
] as const;

const field: Record<string, string> = {
  distance: "distanceM", hsm: "hsmM", vhsm: "vhsmM", sprint: "sprintM",
  load: "playerLoad", power: "powerPlays",
};
export const trainingPartLabel = (part: string): string =>
  TRAINING_PARTS.find(p => p.id === part)?.label ?? "Full source recording";
export const trainingPlayerKey = (r: TrainingGpsRow): string =>
  r.rosterId != null ? `roster:${r.rosterId}` : `source:${r.sourceName}`;
export const trainingPositionGroup = (position: string | null): string => {
  if (!position) return "Unassigned";
  if (position === "GK") return "Goalkeepers";
  if (["CB", "FB", "D", "DEF"].includes(position)) return "Defenders";
  if (["CM", "DM", "AM", "6", "8", "10", "B2B"].includes(position)) return "Midfielders";
  if (["F", "FW", "9", "W", "Winger"].includes(position)) return "Forwards";
  return "Mixed / other";
};
const valid = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function trainingValue(r: TrainingGpsRow, metric: string, perMinute = false): number | null {
  if (metric === "distancePerMinute") return trainingValue(r, "distance", true);
  let v: number | null | undefined;
  if (metric === "duration") v = r.durationSeconds == null ? null : r.durationSeconds / 60;
  else if (metric === "speed") v = r.metrics.topSpeedMs == null ? null : r.metrics.topSpeedMs * 3.6;
  else if (metric === "accels" || metric === "decels") {
    const prefix = metric === "accels" ? "accel" : "decel";
    const a = r.metrics[`${prefix}34`], b = r.metrics[`${prefix}Over4`];
    v = valid(a) && valid(b) ? a + b : null;
  } else v = r.metrics[field[metric] ?? metric];
  if (!valid(v)) return null;
  if (perMinute && TRAINING_METRICS.find(m => m.id === metric)?.rate) {
    return valid(r.durationSeconds) && r.durationSeconds > 0 ? v / (r.durationSeconds / 60) : null;
  }
  return v;
}

/** Whole-session data never includes the untrimmed source recording. */
export function trainingTotal(rows: readonly TrainingGpsRow[], metric: string, perMinute = false): number | null {
  if (metric === "distancePerMinute") return trainingTotal(rows, "distance", true);
  const parts = rows.filter(r => r.part !== "recording");
  if (!parts.length) return null;
  const values = parts.map(r => trainingValue(r, metric));
  if (["speed", "maxAccel", "maxDecel"].includes(metric)) {
    const present = values.filter(valid);
    return present.length ? Math.max(...present) : null;
  }
  // A missing field is not a zero or a complete total.
  if (values.some(v => !valid(v))) return null;
  const sum = (values as number[]).reduce((a, b) => a + b, 0);
  if (perMinute && TRAINING_METRICS.find(m => m.id === metric)?.rate) {
    if (parts.some(r => !valid(r.durationSeconds) || r.durationSeconds! <= 0)) return null;
    return sum / (parts.reduce((a, r) => a + r.durationSeconds!, 0) / 60);
  }
  return sum;
}

export function trainingMean(values: readonly (number | null | undefined)[]): number | null {
  const present = values.filter(valid);
  return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

export function trainingTimetable(session: TrainingGpsSession) {
  return TRAINING_PARTS.flatMap(part => {
    const rows = session.rows.filter(r => r.part === part.id);
    if (!rows.length) return [];
    const starts = rows.map(r => r.startSeconds).filter(valid);
    const ends = rows.map(r => r.endSeconds).filter(valid);
    const durations = rows.map(r => r.durationSeconds).filter(valid);
    const startSeconds = starts.length ? Math.min(...starts) : null;
    const endSeconds = ends.length ? Math.max(...ends) : null;
    const marked = startSeconds != null && endSeconds != null ? endSeconds - startSeconds : null;
    const recorded = durations.length ? Math.max(...durations) : null;
    // Catapult's Excel clocks lose fractional precision. Prefer the full
    // recorded duration only when it agrees with the marked span to2seconds.
    const durationSeconds = marked == null ? recorded :
      recorded != null && Math.abs(recorded - marked) <= 2 ? recorded : marked;
    return [{ part: part.id, label: part.label, startSeconds, endSeconds,
      durationSeconds, playerCount: new Set(rows.map(trainingPlayerKey)).size }];
  });
}

export interface TrainingInsight { title: string; evidence: string; tone: "fact" | "watch"; weight: number }
export function trainingInsights(
  session: TrainingGpsSession, playerKey: string | null = null, history: readonly TrainingGpsSession[] = [],
): TrainingInsight[] {
  const rows = session.rows.filter(r => r.part !== "recording" && (!playerKey || trainingPlayerKey(r) === playerKey));
  const candidates: TrainingInsight[] = [];
  const topPart = (metric: string, rate: boolean, title: string, weight: number) => {
    const groups = TRAINING_PARTS.map(p => {
      const partRows = rows.filter(r => r.part === p.id);
      return { label: p.label, value: trainingMean(partRows.map(r => trainingValue(r, metric, rate))), n: partRows.length };
    }).filter(p => p.value != null);
    if (!groups.length) return;
    const highest = Math.max(...groups.map(p => p.value!));
    const top = groups.filter(p => Math.abs(p.value! - highest) < 1e-9);
    candidates.push({ title, weight, tone: "fact",
      evidence: `${top.map(p => p.label).join(" and ")}: ${highest.toFixed(1)} ${metric === "speed" ? "km/h" : rate ? "m/min" : "m"}${!playerKey ? ` per-player average; ${top[0].n} participants` : ""}.` });
  };
  topPart("distance", true, playerKey ? "Highest running intensity" : "Highest average running intensity", 90);
  topPart("speed", false, playerKey ? "Highest recorded speed" : "Highest average player maximum speed", 75);
  topPart("distance", false, playerKey ? "Most distance accumulated" : "Most distance per player", 60);
  const missing = TRAINING_PARTS.filter(p => !rows.some(r => r.part === p.id));
  if (missing.length) candidates.push({ title: "Incomplete part coverage", tone: "watch", weight: 110,
    evidence: `${missing.map(p => p.label).join(", ")} not recorded. The selected-part total is incomplete, not a zero for these parts.` });
  const incomplete = rows.filter(r => !valid(r.durationSeconds) || !valid(r.metrics.distanceM));
  if (incomplete.length) candidates.push({ title: "Some measurements are missing", tone: "watch", weight: 100,
    evidence: `${incomplete.length} part recordings lack duration or distance. Missing values are excluded, not replaced with zero.` });
  if (playerKey && history.length) {
    const prior = history.filter(s => s.date < session.date).flatMap(s => {
      const selected = s.rows.filter(r => trainingPlayerKey(r) === playerKey && r.part !== "recording");
      const v = trainingTotal(selected, "distance", true);
      return v == null || new Set(selected.map(r => r.part)).size !== 5 ? [] : [v];
    });
    const current = trainingTotal(rows, "distance", true), average = trainingMean(prior);
    if (prior.length >= 3 && current != null && average != null && average > 0 && current < average * .8) {
      candidates.push({ title: "Lower recorded intensity than recent sessions", tone: "watch", weight: 95,
        evidence: `${current.toFixed(1)} m/min versus ${average.toFixed(1)} across ${prior.length} earlier complete sessions. Practice content and participation may differ; this is not an effort grade.` });
    }
  }
  return candidates.sort((a, b) => b.weight - a.weight).slice(0, 4);
}
