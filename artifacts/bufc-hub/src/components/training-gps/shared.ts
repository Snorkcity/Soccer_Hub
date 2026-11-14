import type { TrainingGpsRow, TrainingGpsSession } from "@workspace/api-client-react";
import {
  TRAINING_METRICS, TRAINING_PARTS, trainingPlayerKey, trainingPositionGroup, trainingTotal, trainingValue, trainingMean,
} from "@workspace/api-zod";

export type PartId = (typeof TRAINING_PARTS)[number]["id"];
export const PART_IDS = TRAINING_PARTS.map(p => p.id) as PartId[];
export const PART_COLORS: Record<string, string> = {
  warmup: "#61A9BD", passing: "#CED14E", technical: "#44986D", main: "#DD83C9", end: "#1F74AD",
};
export const C = { primary: "#61A9BD", secondary: "#CED14E", tertiary: "#DD83C9", muted: "#979797", mutedDark: "#3C7686", orange: "#E98E2E" };
export const OVERLAY_COLORS = ["#CED14E", "#DD83C9", "#E98E2E"];

export interface TrainingFilters {
  sessionId: string | null;
  metric: string;
  perMinute: boolean;
  part: PartId;
  playerKey: string | null;
  squad: string; // "all" | squad
  position: string; // "outfield" | group label
}

export const sessionKey = (s: TrainingGpsSession) => String(s.id ?? `${s.date}-${s.version}`);
export const metricDef = (id: string) => TRAINING_METRICS.find(m => m.id === id) ?? TRAINING_METRICS[0];
export const canRate = (metric: string) => metricDef(metric).rate;
export const usePM = (f: Pick<TrainingFilters, "metric" | "perMinute">) => f.perMinute && canRate(f.metric);
export const partRows = (s: TrainingGpsSession) => s.rows.filter(r => r.part !== "recording");

export function metricUnit(metric: string, perMinute: boolean): string {
  const m = metricDef(metric);
  return perMinute && m.rate ? `${m.unit}/min` : m.unit;
}
export function fmtNum(v: number | null | undefined, digits?: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const d = digits ?? (Math.abs(v) >= 100 ? 0 : 1);
  return v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}
/** Speed is always shown with both units. */
export function fmtMetric(metric: string, v: number | null | undefined, perMinute = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (metric === "speed") return `${v.toFixed(1)} km/h (${(v / 3.6).toFixed(2)} m/s)`;
  const pm = perMinute && canRate(metric);
  const digits = pm ? (v >= 100 ? 0 : v >= 10 ? 1 : 2) : metric === "maxAccel" || metric === "maxDecel" || metric === "load" ? 1 : undefined;
  return `${fmtNum(v, digits)} ${metricUnit(metric, pm)}`;
}
export const fmtMin = (sec: number | null | undefined) =>
  sec == null ? "—" : `${(sec / 60).toFixed(1)} min`;
export function fmtClock(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.round(((sec % 86400) + 86400) % 86400);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
}
export function fmtDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}

export interface PlayerInfo { key: string; name: string; squad: string | null; position: string | null; group: string }
export function sessionPlayers(sessions: readonly TrainingGpsSession[]): PlayerInfo[] {
  const map = new Map<string, PlayerInfo>();
  for (const s of sessions) for (const r of partRows(s)) {
    const key = trainingPlayerKey(r);
    if (!map.has(key)) map.set(key, { key, name: r.playerName, squad: r.squad, position: r.positionCode, group: trainingPositionGroup(r.positionCode) });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export const partIdFromLabel = (label: unknown): PartId | null =>
  (TRAINING_PARTS.find(p => p.label === label)?.id as PartId | undefined) ?? null;
export const isGk = (r: Pick<TrainingGpsRow, "positionCode">) => r.positionCode === "GK";

/** Position filter: GK always separated from outfield. */
export function matchesFilters(r: TrainingGpsRow, f: Pick<TrainingFilters, "squad" | "position">): boolean {
  if (f.squad !== "all" && (r.squad ?? "Unassigned") !== f.squad) return false;
  const g = trainingPositionGroup(r.positionCode);
  if (f.position === "outfield") return g !== "Goalkeepers" && g !== "Unassigned";
  return g === f.position;
}

export interface WholeValue { value: number | null; parts: number; partial: boolean; missingSplit: boolean }
export function playerWhole(s: TrainingGpsSession, key: string, metric: string, pm: boolean): WholeValue | null {
  const rows = partRows(s).filter(r => trainingPlayerKey(r) === key);
  if (!rows.length) return null;
  const parts = new Set(rows.map(r => r.part)).size;
  const value = trainingTotal(rows, metric, pm);
  const missingSplit = s.rows.some(r => trainingPlayerKey(r) === key && r.part === "recording") && parts < 5;
  return { value, parts, partial: parts < 5 || value == null, missingSplit };
}

/** Participant mean of each player's own value (never a pooled sum). */
export function groupMean(rows: readonly TrainingGpsRow[], metric: string, pm: boolean) {
  const vals = rows.map(r => trainingValue(r, metric, pm));
  return { mean: trainingMean(vals), n: vals.filter(v => v != null).length, rows: rows.length };
}
export function groupWholeMean(s: TrainingGpsSession, metric: string, pm: boolean, filter: (r: TrainingGpsRow) => boolean) {
  const keys = new Set(partRows(s).filter(filter).map(trainingPlayerKey));
  const vals = [...keys].map(k => playerWhole(s, k, metric, pm)).filter(w => w && !w.partial).map(w => w!.value);
  return { mean: trainingMean(vals), n: vals.filter(v => v != null).length, players: keys.size };
}
