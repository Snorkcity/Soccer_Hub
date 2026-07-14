import React, { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  useListTeams,
  useListSeasons,
  useGetSeasonSummary,
  useGetLeagueLadder,
  useGetGoalBreakdown,
  useGetPlayerLeaderboard,
  useGetOpponentClubs,
  useGetGoalsByOpponent,
  useGetAssistsByOpponent,
  useGetOpponentProfile,
  useGetOpponentPlayersByOpponent,
  useGetGoalCombos,
  useGetOpponentGoalCombos,
  useGetOpponentPlayerDna,
  useGetOpponentFirstSub,
  useGetPlayerDna,
  useGetPlayerTimeline,
  getGetPlayerTimelineQueryKey,
  useGetClubs,
  useListMatches,
  getListMatchesQueryKey,
  getGetSeasonSummaryQueryKey,
  getGetLeagueLadderQueryKey,
  getGetGoalBreakdownQueryKey,
  getGetPlayerLeaderboardQueryKey,
  getGetOpponentClubsQueryKey,
  getGetGoalsByOpponentQueryKey,
  getGetAssistsByOpponentQueryKey,
  getGetOpponentProfileQueryKey,
  getGetOpponentPlayersByOpponentQueryKey,
  getGetGoalCombosQueryKey,
  getGetOpponentGoalCombosQueryKey,
  getGetOpponentPlayerDnaQueryKey,
  getGetOpponentFirstSubQueryKey,
  getGetPlayerDnaQueryKey,
  getGetClubsQueryKey,
  type ScoredGoalRecord,
  type PlayerDnaResponse,
  type FirstSubResponse,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell, ReferenceLine, PieChart, Pie,
  ScatterChart, Scatter, ReferenceArea, LabelList,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  LineChart, Line,
} from "recharts";
import { Info, ArrowLeft } from "lucide-react";
import { Tooltip as RadixTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ─── Position helpers ─────────────────────────────────────────────────────────
const DEFENSIVE_POSITIONS = ["GK", "CB", "RCB", "LCB", "RB", "LB", "RWB", "LWB", "SW", "DF", "CD"];

function isDefensive(pos: string | null | undefined) {
  if (!pos) return false;
  const up = pos.toUpperCase();
  return DEFENSIVE_POSITIONS.some(dp => up === dp || up.includes(dp));
}

type PosGroup = "GK" | "DEF" | "MID" | "FWD";
function positionGroup(pos: string | null | undefined): PosGroup {
  if (!pos) return "MID";
  const up = pos.toUpperCase().trim();
  if (up === "GK" || up === "G") return "GK";
  if (/^(LCB|RCB|CB|CD|LB|RB|LWB|RWB|SW|DF|FB|BK)$/.test(up)) return "DEF";
  if (/^(ST|CF|LW|RW|SS|WF|FW|LF|RF|W)$/.test(up)) return "FWD";
  if (up.includes("GK")) return "GK";
  if (up.startsWith("ST") || up.startsWith("CF") || up.includes("WING")) return "FWD";
  if (up.includes("CB") || up.includes("LB") || up.includes("RB") || up.startsWith("DF")) return "DEF";
  return "MID";
}

// ─── Minutes-per-Goal stacked chart types ─────────────────────────────────────
interface MpgEntry {
  name: string;
  fullName: string;
  totalMins: number;
  filteredGoals: number;
  filteredMins: number;
  byOpponent: Record<string, { goals: number; minsPlayed: number }>;
  [opp: string]: unknown;
}

// ─── Goal Contributions stacked chart types ────────────────────────────────────
interface ContribEntry {
  name: string; fullName: string; totalMins: number;
  filteredGoals: number; filteredAssists: number; filteredContribs: number; filteredMins: number;
  byOpponent: Record<string, { goals: number; assists: number; minsPlayed: number }>;
  [opp: string]: unknown;
}

// ─── Assists stacked chart types ───────────────────────────────────────────────
interface AssistEntry {
  name: string; fullName: string; totalMins: number;
  filteredAssists: number; filteredMins: number;
  byOpponent: Record<string, { assists: number; minsPlayed: number }>;
  [opp: string]: unknown;
}

// ─── Goal type colour palette (matches the 10 types found in the data) ────────
const GOAL_TYPE_COLORS: Record<string, string> = {
  "R-MT-AT":  "hsl(var(--chart-1))",         // blue
  "R-MT-DT":  "#60a5fa",                     // sky blue
  "R-FT-AT":  "hsl(var(--chart-3))",         // green
  "R-FT-DT":  "#86efac",                     // light green
  "R-BT-AT":  "hsl(var(--chart-5))",         // purple
  "R-BT-DT":  "#c4b5fd",                     // light purple
  "SP-C":     "hsl(var(--chart-2))",         // amber – corners
  "SP-F":     "#fcd34d",                     // yellow – free kicks
  "SP-P":     "hsl(var(--chart-4))",         // red – penalties
  "SP-T":     "#f97316",                     // orange – throw-ins
  "Unknown":  "#6b7280",
};

const GOAL_INTERVALS = [
  { label: "0-15",  start: 0,  end: 15 },
  { label: "16-30", start: 16, end: 30 },
  { label: "31-45", start: 31, end: 45 },
  { label: "46-60", start: 46, end: 60 },
  { label: "61-75", start: 61, end: 75 },
  { label: "76-90", start: 76, end: 90 },
];

// ─── On-Field Impact (plus/minus) chart types ─────────────────────────────────
interface EffEntry {
  name: string; fullName: string; position: string | null; posGroup: PosGroup;
  value: number;       // selected metric: gd (total) or gdPer90
  goalsFor: number;    // team goals scored while player on pitch
  goalsAgainst: number; // team goals conceded while player on pitch
  gd: number;          // goalsFor - goalsAgainst
  gdPer90: number;     // gd per 90 mins
  minsPlayed: number; appearances: number; starts: number;
  rank: number; total: number;
}

// ─── Colour palette (CSS vars) ────────────────────────────────────────────────
const C1 = "hsl(var(--chart-1))"; // blue
const C2 = "hsl(var(--chart-2))"; // amber
const C3 = "hsl(var(--chart-3))"; // green
const C4 = "hsl(var(--chart-4))"; // red
const C5 = "hsl(var(--chart-5))"; // purple

// Preferred x-axis order for goal-type codes (matched by suffix, so the "R-" open-play
// prefix and set-piece codes both sort correctly). Unknown codes fall to the end.
const TYPE_ORDER = ["FT-DT", "FT-AT", "MT-DT", "MT-AT", "BT-DT", "BT-AT", "SP-T", "SP-F", "SP-P", "SP-C"];
function typeRank(code: string): number {
  const i = TYPE_ORDER.findIndex(s => code.endsWith(s));
  return i < 0 ? TYPE_ORDER.length : i;
}

// Goal Detail by Type — dimension dropdown → accessor on a scored-goal record
type GoalDetailDim = "assist" | "buildup" | "finish" | "penetration" | "firsttime";
const DIM_GETTER: Record<GoalDetailDim, (g: ScoredGoalRecord) => string | null | undefined> = {
  assist:      g => g.assistType,
  buildup:     g => g.buildupLane,
  finish:      g => g.finishType,
  penetration: g => g.howPenetrated,
  firsttime:   g => g.firstTimeFinish == null ? null : (g.firstTimeFinish ? "First-time" : "Not first-time"),
};

// ─── Goal-Type pie charts (GS – Pie) ─────────────────────────────────────────
// Per-segment colours, tuned to roughly match the reference dashboard.
const REGAIN_COLORS: Record<string, string> = {
  "MT-AT": "#f59e0b", "MT-DT": "#06b6d4", "FT-AT": "#10b981",
  "FT-DT": "#a855f7", "BT-AT": "#3b82f6", "BT-DT": "#ef4444",
};
const SETPIECE_COLORS: Record<string, string> = {
  "SP-C": "#6366f1", "SP-F": "#f97316", "SP-P": "#22c55e", "SP-T": "#eab308",
};
const PIE_FALLBACK = "#94a3b8";

// Friendly names for the hover tooltip.
const SETPIECE_NAMES: Record<string, string> = {
  "SP-C": "Corners", "SP-F": "Free Kicks", "SP-P": "Penalties", "SP-T": "Throw-ins",
};
const THIRD_NAMES: Record<string, string> = { FT: "Final Third", MT: "Middle Third", BT: "Back Third" };
const TRANS_NAMES: Record<string, string> = { AT: "After Transition", DT: "During Transition" };

// Human-readable expansion of a (prefix-stripped) goal-type code.
function goalTypeFriendly(code: string): string | null {
  if (SETPIECE_NAMES[code]) return SETPIECE_NAMES[code];
  const [third, trans] = code.split("-");
  const t = THIRD_NAMES[third], x = TRANS_NAMES[trans];
  if (t && x) return `${t} · ${x}`;
  if (t) return t;
  return null;
}

interface PieSegment { code: string; value: number }

// Bucket a set of goals into one pie's segments. kind picks open-play regains
// (codes without an SP prefix, "R-" stripped for display) vs set pieces (SP-*).
function buildPieSegments(goals: ScoredGoalRecord[], kind: "regain" | "setpiece"): PieSegment[] {
  const counts: Record<string, number> = {};
  for (const g of goals) {
    const t = g.goalType?.trim();
    if (!t) continue;
    const isSP = t.toUpperCase().startsWith("SP");
    if (kind === "setpiece" && !isSP) continue;
    if (kind === "regain" && isSP) continue;
    const display = kind === "regain" ? t.replace(/^R-/i, "") : t.toUpperCase();
    counts[display] = (counts[display] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([code, value]) => ({ code, value }))
    .sort((a, b) => b.value - a.value);
}

const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");

// Rich per-segment tooltip: count, share of ALL goals, and the group's share.
// Regain pies group by third (front/middle/back); set-piece pies group as one.
function GoalTypePieTooltip({ active, payload, grandTotal, segments, groupMode }: {
  active?: boolean;
  payload?: Array<{ payload: PieSegment }>;
  grandTotal: number;
  segments: PieSegment[];
  groupMode: "third" | "setpiece";
}) {
  if (!active || !payload?.length) return null;
  const seg = payload[0].payload;
  const friendly = goalTypeFriendly(seg.code);
  let groupName: string;
  let groupTotal: number;
  if (groupMode === "third") {
    const third = seg.code.split("-")[0];
    groupName = THIRD_NAMES[third] ?? third;
    groupTotal = segments.filter(s => s.code.split("-")[0] === third).reduce((a, b) => a + b.value, 0);
  } else {
    groupName = "Set pieces";
    groupTotal = segments.reduce((a, b) => a + b.value, 0);
  }
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[200px] space-y-1">
      <div className="font-semibold text-sm">Type: {seg.code}{friendly ? ` – ${friendly}` : ""}</div>
      <div>Goals: <span className="font-medium">{seg.value}</span></div>
      <div className="text-muted-foreground">Total goals: {grandTotal}</div>
      <div className="text-muted-foreground">Percent of total: {pct(seg.value, grandTotal)}</div>
      <div className="border-t pt-1 mt-1 text-muted-foreground">
        Group: {groupName} ({pct(groupTotal, grandTotal)} of total)
      </div>
    </div>
  );
}

// One donut. grandTotal = all goals in this scored/conceded set (incl. untyped),
// so percentages match the reference dashboard.
function GoalTypePie({ title, segments, colorMap, grandTotal, groupMode }: {
  title: string;
  segments: PieSegment[];
  colorMap: Record<string, string>;
  grandTotal: number;
  groupMode: "third" | "setpiece";
}) {
  // On-arc label shows share of ALL goals (matches the reference dashboard), e.g. "SP-C 19.1%".
  const renderLabel = (p: { cx: number; cy: number; midAngle: number; outerRadius: number; code: string; value: number }) => {
    const RAD = Math.PI / 180;
    const r = p.outerRadius + 16;
    const x = p.cx + r * Math.cos(-p.midAngle * RAD);
    const y = p.cy + r * Math.sin(-p.midAngle * RAD);
    return (
      <text x={x} y={y} fill="hsl(var(--muted-foreground))" fontSize={11}
        textAnchor={x > p.cx ? "start" : "end"} dominantBaseline="central">
        {`${p.code} ${pct(p.value, grandTotal)}`}
      </text>
    );
  };
  return (
    <ChartCard title={title} tall>
      {segments.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No goals recorded</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="code"
              innerRadius="50%"
              outerRadius="70%"
              paddingAngle={2}
              stroke="hsl(var(--card))"
              strokeWidth={2}
              label={renderLabel}
              labelLine={{ stroke: "hsl(var(--border))" }}
            >
              {segments.map(d => <Cell key={d.code} fill={colorMap[d.code] ?? PIE_FALLBACK} />)}
            </Pie>
            <Tooltip content={<GoalTypePieTooltip grandTotal={grandTotal} segments={segments} groupMode={groupMode} />} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

// Shared pill button used to toggle the Last-3-games window on the team charts.
function Last3Toggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
      )}
    >
      Last 3 rounds
    </button>
  );
}

// ─── Team Insights: pure data helpers ────────────────────────────────────────
type StackRow = Record<string, string | number>;

// Unique opponent clubs present in a set of goal records (the "who scored" side for
// conceded records, the "who we played" side for scored records).
function oppsOf(records: ScoredGoalRecord[]): string[] {
  return Array.from(new Set(records.map(g => g.opponent).filter((o): o is string => !!o))).sort();
}

// Bucket goal records into rows keyed by `label`, one numeric column per opponent.
function stackRowsBy(
  goals: ScoredGoalRecord[],
  opponents: string[],
  bucketOf: (g: ScoredGoalRecord) => string,
): StackRow[] {
  const byBucket: Record<string, StackRow> = {};
  for (const g of goals) {
    const b = bucketOf(g);
    if (!byBucket[b]) { byBucket[b] = { label: b }; for (const o of opponents) byBucket[b][o] = 0; }
    if (g.opponent) byBucket[b][g.opponent] = (byBucket[b][g.opponent] as number) + 1;
  }
  return Object.values(byBucket).sort((a, b) =>
    opponents.reduce((s, o) => s + (b[o] as number), 0) -
    opponents.reduce((s, o) => s + (a[o] as number), 0));
}

function intervalStackRows(goals: ScoredGoalRecord[], opponents: string[]): StackRow[] {
  if (goals.length === 0 || opponents.length === 0) return [];
  return GOAL_INTERVALS.map(({ label, start, end }) => {
    const row: StackRow = { label };
    for (const o of opponents) row[o] = 0;
    for (const g of goals) {
      const m = g.minuteScored ?? 0;
      if (g.opponent && m >= start && m <= end) row[g.opponent] = (row[g.opponent] as number) + 1;
    }
    return row;
  });
}

function goalTypeStackRows(goals: ScoredGoalRecord[], opponents: string[]): StackRow[] {
  return stackRowsBy(goals, opponents, g => g.goalType?.trim() || "Unknown")
    .sort((a, b) => typeRank(a.label as string) - typeRank(b.label as string));
}

function detailStackRows(goals: ScoredGoalRecord[], opponents: string[], dim: GoalDetailDim): StackRow[] {
  return stackRowsBy(goals, opponents, g => (DIM_GETTER[dim](g)?.trim()) || "Unknown");
}

// Colour for a raw goal-type code (open-play regain codes may carry an "R-" prefix).
function colorForGoalType(code: string): string {
  const up = code.toUpperCase();
  if (up.startsWith("SP")) return SETPIECE_COLORS[up] ?? PIE_FALLBACK;
  const stripped = up.replace(/^R-/, "");
  return REGAIN_COLORS[stripped] ?? PIE_FALLBACK;
}

// ── Pass-string analysis ──────────────────────────────────────────────────────
const PASS_ORDER = ["0", "1", "2", "3", "4", "5", "6+", "Set play / n.a."];
function passBucket(s: string | null | undefined): string {
  if (s == null || String(s).trim() === "") return "Set play / n.a.";
  const n = parseInt(String(s), 10);
  if (Number.isNaN(n)) return "Set play / n.a.";
  return n >= 6 ? "6+" : String(n);
}
// x-axis = pass-string length, stacked segments = goal type. Answers "how many passes
// preceded each kind of goal?".
function passStringData(goals: ScoredGoalRecord[]): { rows: StackRow[]; keys: string[] } {
  const typeSet = new Set<string>();
  const byBucket: Record<string, StackRow> = {};
  for (const g of goals) {
    const b = passBucket(g.passString);
    const t = g.goalType?.trim() || "Unknown";
    typeSet.add(t);
    byBucket[b] ??= { label: b };
    byBucket[b][t] = ((byBucket[b][t] as number) ?? 0) + 1;
  }
  const keys = Array.from(typeSet).sort((a, b) => typeRank(a) - typeRank(b));
  const rows = PASS_ORDER.filter(b => byBucket[b]).map(b => {
    const row = byBucket[b];
    for (const k of keys) if (row[k] == null) row[k] = 0;
    return row;
  });
  return { rows, keys };
}

// ── Per-match timelines (scored + conceded merged, sorted by minute) ─────────
interface TimelineEvent { minute: number; side: "for" | "against"; opponent: string | null }
function buildTimelines(scored: ScoredGoalRecord[], conceded: ScoredGoalRecord[]): Record<number, TimelineEvent[]> {
  const byMatch: Record<number, TimelineEvent[]> = {};
  const add = (g: ScoredGoalRecord, side: "for" | "against") => {
    if (g.matchId == null) return;
    (byMatch[g.matchId] ??= []).push({ minute: g.minuteScored ?? 0, side, opponent: g.opponent ?? null });
  };
  for (const g of scored) add(g, "for");
  for (const g of conceded) add(g, "against");
  for (const k of Object.keys(byMatch)) byMatch[Number(k)].sort((a, b) => a.minute - b.minute);
  return byMatch;
}

// First goal event strictly after event i whose minute falls within `window` mins.
function responseWithin(events: TimelineEvent[], i: number, window: number): "for" | "against" | null {
  for (let j = i + 1; j < events.length; j++) {
    if (events[j].minute <= events[i].minute + window) return events[j].side;
    return null;
  }
  return null;
}

// Colours for the 5-minute-response charts (fixed label keys, not opponent clubs).
const RESPONSE_COLORS = (k: string): string =>
  k === "We scored" ? "#10b981" : k === "We conceded" ? "#ef4444" : "#94a3b8";

// Two rows: after we score / after we concede → {scored again, conceded, no goal} within 5 mins.
function responseData(timelines: Record<number, TimelineEvent[]>): StackRow[] {
  const after = { for: { s: 0, c: 0, n: 0 }, against: { s: 0, c: 0, n: 0 } };
  for (const events of Object.values(timelines)) {
    for (let i = 0; i < events.length; i++) {
      const resp = responseWithin(events, i, 5);
      const b = after[events[i].side];
      if (resp === "for") b.s++; else if (resp === "against") b.c++; else b.n++;
    }
  }
  return [
    { label: "After we score", "We scored": after.for.s, "We conceded": after.for.c, "No goal": after.for.n },
    { label: "After we concede", "We scored": after.against.s, "We conceded": after.against.c, "No goal": after.against.n },
  ];
}

// Quick-fire "swings" (a goal followed by another within 5 mins), split into the same
// four situation+response buckets used by the merged After-Goals chart, then stacked by
// the opponent club in that match (mirrors the visual language of the previous chart).
const RESPONSE_SIT_BUCKETS = [
  "AS - Scored",
  "AS - Conceded",
  "AC - Scored",
  "AC - Conceded",
] as const;
// Abbreviated x-axis labels stay compact; the hover tooltip spells the full meaning out.
const RESPONSE_SIT_LABELS: Record<string, string> = {
  "AS - Scored": "After we score → Scored",
  "AS - Conceded": "After we score → Conceded",
  "AC - Scored": "After we concede → Scored",
  "AC - Conceded": "After we concede → Conceded",
};
function responseSituationByOpponent(
  timelines: Record<number, TimelineEvent[]>,
): { rows: StackRow[]; opponents: string[] } {
  const opps = new Set<string>();
  const counts: Record<string, Record<string, number>> = {};
  for (const b of RESPONSE_SIT_BUCKETS) counts[b] = {};
  let total = 0;
  for (const events of Object.values(timelines)) {
    for (let i = 0; i < events.length; i++) {
      const resp = responseWithin(events, i, 5);
      if (!resp) continue;
      const situation = events[i].side === "for" ? "AS" : "AC";
      const response = resp === "for" ? "Scored" : "Conceded";
      const bucket = `${situation} - ${response}`;
      const opp = events[i].opponent ?? "Unknown";
      opps.add(opp);
      counts[bucket][opp] = (counts[bucket][opp] ?? 0) + 1;
      total++;
    }
  }
  if (total === 0) return { rows: [], opponents: [] };
  const opponents = Array.from(opps).sort();
  const rows: StackRow[] = RESPONSE_SIT_BUCKETS.map(b => {
    const row: StackRow = { label: b };
    for (const o of opponents) row[o] = counts[b][o] ?? 0;
    return row;
  });
  return { rows, opponents };
}

// ── Generic keyed-stack tooltip + chart (used by pass-string & 5-min charts) ──
function GenericStackTooltip({ active, payload, label, showPct }: {
  active?: boolean; label?: string; showPct?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
}) {
  if (!active || !payload?.length) return null;
  const items = payload.filter(p => (p.value ?? 0) > 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (!items.length) return null;
  const total = items.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[180px] space-y-2">
      <div className="font-semibold text-sm">{label}</div>
      <div className="border-t pt-2 space-y-1">
        {items.map(p => (
          <div key={p.name} className="flex justify-between gap-6">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span>
              {p.value}
              {showPct && total > 0 && (
                <span className="text-muted-foreground"> ({Math.round(((p.value ?? 0) / total) * 100)}%)</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t pt-2 flex justify-between gap-6 font-semibold">
        <span className="text-muted-foreground">Total</span>
        <span>{total}</span>
      </div>
    </div>
  );
}

function StackBars({ rows, keys, colorFn, angled, showPct }: {
  rows: StackRow[]; keys: string[]; colorFn: (k: string) => string; angled?: boolean; showPct?: boolean;
}) {
  if (rows.length === 0) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data recorded</div>;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 10, right: 10, left: -20, bottom: angled ? 40 : 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" {...AXIS_STYLE} {...(angled ? { angle: -35, textAnchor: "end", interval: 0 } : {})} />
        <YAxis {...AXIS_STYLE} allowDecimals={false} />
        <Tooltip content={<GenericStackTooltip showPct={showPct} />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
        {keys.map(k => <Bar key={k} dataKey={k} name={k} stackId="s" fill={colorFn(k)} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

function KeyLegend({ keys, colorFn }: { keys: string[]; colorFn: (k: string) => string }) {
  if (!keys.length) return null;
  return (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px]">
      {keys.map(k => (
        <span key={k} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorFn(k) }} />
          {k}
        </span>
      ))}
    </div>
  );
}

// ── Goal Location Map (pitch scatter of scored vs conceded goals) ────────────
// Vertical attacking-third pitch. Coordinate contract: goalX is 0–100 across the
// full pitch width; goalY is in yards from the goal line (0 = on the line), so a
// goal at y=18 sits exactly on the 18-yard-box line. Width mapped to yards
// (100 units ≈ 80 yd, 0.8 yd/unit) so the pitch is drawn to true proportions.
interface LocPt { g: ScoredGoalRecord; side: "for" | "against" }
function GoalLocationMap({ scored, conceded }: { scored: ScoredGoalRecord[]; conceded: ScoredGoalRecord[] }) {
  const [club, setClub] = useState("__all");
  const [gtype, setGtype] = useState("__all");
  const [scorer, setScorer] = useState("__all");
  const [showFor, setShowFor] = useState(true);
  const [showAgainst, setShowAgainst] = useState(true);
  const [hover, setHover] = useState<LocPt | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const all = useMemo<LocPt[]>(() => [
    ...scored.map(g => ({ g, side: "for" as const })),
    ...conceded.map(g => ({ g, side: "against" as const })),
  ].filter(p => p.g.goalX != null && p.g.goalY != null), [scored, conceded]);

  const clubOpts = useMemo(
    () => Array.from(new Set(all.map(p => p.g.opponent).filter((o): o is string => !!o))).sort(),
    [all],
  );
  const typeOpts = useMemo(
    () => Array.from(new Set(all.map(p => p.g.goalType).filter((t): t is string => !!t))).sort(
      (a, b) => typeRank(a) - typeRank(b),
    ),
    [all],
  );
  const scorerOpts = useMemo(
    () => Array.from(new Set(
      all.filter(p => p.side === "for").map(p => p.g.scorer).filter((s): s is string => !!s),
    )).sort(),
    [all],
  );

  const pts = all.filter(p =>
    (club === "__all" || p.g.opponent === club) &&
    (gtype === "__all" || p.g.goalType === gtype) &&
    (scorer === "__all" || p.g.scorer === scorer),
  );
  const nScored = pts.filter(p => p.side === "for").length;
  const nConceded = pts.length - nScored;

  const fx = (gx: number) => gx * 0.8;   // 0–100 → 0–80 yd (width)
  const fy = (gy: number) => gy;          // yards from goal line

  const onMove = (e: React.MouseEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setPos({ x: e.clientX - r.left, y: e.clientY - r.top });
  };

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Select value={club} onValueChange={setClub}>
          <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All clubs</SelectItem>
            {clubOpts.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={gtype} onValueChange={setGtype}>
          <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All goals</SelectItem>
            {typeOpts.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={scorer} onValueChange={setScorer}>
          <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All scorers</SelectItem>
            {scorerOpts.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Legend (click to toggle) */}
      <div className="flex justify-center gap-5 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={() => setShowFor(v => !v)}
          className="flex items-center gap-1.5 transition-opacity hover:opacity-100"
          style={{ opacity: showFor ? 1 : 0.4 }}
        >
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#3b82f6" }} />
          <span style={{ textDecoration: showFor ? "none" : "line-through" }}>Goals Scored ({nScored})</span>
        </button>
        <button
          type="button"
          onClick={() => setShowAgainst(v => !v)}
          className="flex items-center gap-1.5 transition-opacity hover:opacity-100"
          style={{ opacity: showAgainst ? 1 : 0.4 }}
        >
          <span style={{ color: "#ef4444", fontWeight: 700 }}>✕</span>
          <span style={{ textDecoration: showAgainst ? "none" : "line-through" }}>Goals Conceded ({nConceded})</span>
        </button>
      </div>

      {/* Pitch (vertical, attacking goal at top) */}
      <div ref={wrapRef} className="relative w-full mx-auto rounded-md overflow-hidden bg-[#0B1B2B]" style={{ aspectRatio: "88 / 40", maxWidth: 720 }}>
        <svg viewBox="-4 -4 88 40" className="w-full h-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {(() => { const L = "rgba(255,255,255,0.45)"; const W = 0.35; return (
            <g fill="none" stroke={L} strokeWidth={W} strokeLinejoin="round" strokeLinecap="round">
              {/* goal line (single line along the by-line) + touchlines */}
              <line x1="0" y1="0" x2="80" y2="0" />
              <line x1="0" y1="0" x2="0" y2="40" />
              <line x1="80" y1="0" x2="80" y2="40" />
              {/* goal (above the line) */}
              <rect x="36" y="-2" width="8" height="2" />
              {/* penalty area (open at the by-line so it overlaps the goal line cleanly) */}
              <path d="M 18 0 L 18 18 L 62 18 L 62 0" />
              {/* six-yard box (open at the by-line) */}
              <path d="M 30 0 L 30 6 L 50 6 L 50 0" />
              {/* penalty spot (y=12) */}
              <circle cx="40" cy="12" r="0.35" fill={L} stroke="none" />
              {/* penalty arc (D) — bulges out past the box */}
              <path d="M 32 18 A 10 10 0 0 0 48 18" />
            </g>
          ); })()}

          {/* points */}
          {pts.filter(p => p.side === "for" ? showFor : showAgainst).map((p, i) => {
            const cx = fx(p.g.goalX as number);
            const cy = fy(p.g.goalY as number);
            const active = hover === p;
            return p.side === "for" ? (
              <circle
                key={`f-${p.g.id}-${i}`} cx={cx} cy={cy} r={active ? 1.1 : 0.68}
                fill="#3b82f6" fillOpacity={0.9} stroke={active ? "#fff" : "none"} strokeWidth={0.25}
                onMouseEnter={() => setHover(p)} style={{ cursor: "pointer" }}
              />
            ) : (
              <g key={`a-${p.g.id}-${i}`} transform={`translate(${cx} ${cy})`}
                 onMouseEnter={() => setHover(p)} style={{ cursor: "pointer" }}
                 stroke="#ef4444" strokeWidth={active ? 0.5 : 0.36} strokeLinecap="round">
                <line x1={-0.6} y1={-0.6} x2={0.6} y2={0.6} />
                <line x1={-0.6} y1={0.6} x2={0.6} y2={-0.6} />
              </g>
            );
          })}
        </svg>

        {/* Rich hover tooltip */}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-white/10 bg-[#12314a] px-3 py-2 text-[11px] leading-relaxed shadow-lg"
            style={{
              left: Math.min(pos.x + 12, (wrapRef.current?.clientWidth ?? 0) - 150),
              top: Math.min(pos.y + 12, (wrapRef.current?.clientHeight ?? 0) - 96),
            }}
          >
            <div className="font-semibold" style={{ color: hover.side === "for" ? "#60a5fa" : "#f87171" }}>
              {hover.side === "for" ? "Goal Scored" : "Goal Conceded"}
            </div>
            <div>Vs: {hover.g.opponent ?? "—"}</div>
            <div>Scorer: {hover.g.scorer ?? "—"}</div>
            <div>Assist: {hover.g.assist ?? "—"}</div>
            <div>Goal Type: {hover.g.goalType ?? "—"}</div>
            <div>Finish: {hover.g.finishType ?? "—"}</div>
            <div>Minute: {hover.g.minuteScored != null ? `${hover.g.minuteScored}'` : "—"}</div>
            <div>First-time: {hover.g.firstTimeFinish == null ? "—" : hover.g.firstTimeFinish ? "Yes" : "No"}</div>
          </div>
        )}
      </div>
    </div>
  );
}


// Mini pitch diagram with the poacher zone shaded — shown in the DNA tooltip for
// the Poacher % spoke. The zone is post-to-post wide (8 yds) and 10 yds deep:
// close, central finishes only. Drawn in yards, goal at top.
function PoacherZoneDiagram({ className }: { className?: string }) {
  const L = "rgba(255,255,255,0.45)";
  return (
    <svg viewBox="-2 -3.5 84 33" className={className} aria-label="Poacher zone diagram">
      <rect x="-2" y="-3.5" width="84" height="33" rx="2" fill="#0B1B2B" />
      <g fill="none" stroke={L} strokeWidth={0.5}>
        <line x1="0" y1="0" x2="80" y2="0" />
        <rect x="36" y="-2" width="8" height="2" />
        <path d="M 18 0 L 18 18 L 62 18 L 62 0" />
        <path d="M 30 0 L 30 6 L 50 6 L 50 0" />
      </g>
      {/* poacher zone: post-to-post (36–44 yd across) out to 10 yds from the goal line */}
      <rect x="36" y="0" width="8" height="10" fill="#22c55e" fillOpacity={0.28} stroke="#22c55e" strokeWidth={0.6} strokeDasharray="2 1.5" />
    </svg>
  );
}


// ── First Goal Value Index ────────────────────────────────────────────────────
interface FgSplit { w: number; d: number; l: number; n: number }
// One row per match: which side scored first, the final result, opponent + match code.
interface FgMatch { matchId: number; code: string; opponent: string; side: "for" | "against"; result: "W" | "D" | "L" }

// Fixed x-axis buckets: SF = Scored First, CF = Conceded First; W/D/L = final result.
const FG_BUCKETS = ["SF - W", "SF - D", "SF - L", "CF - W", "CF - D", "CF - L"] as const;
// Abbreviated x-axis stays compact; the hover spells it out.
const FG_LABELS: Record<string, string> = {
  "SF - W": "Scored first → Win",
  "SF - D": "Scored first → Draw",
  "SF - L": "Scored first → Loss",
  "CF - W": "Conceded first → Win",
  "CF - D": "Conceded first → Draw",
  "CF - L": "Conceded first → Loss",
};

// Build the per-match list from goal timelines + a matchId→metadata lookup.
// Result comes from the authoritative recorded score (meta.result); we only fall
// back to goal-count derivation if the score wasn't recorded. First-goal side is
// the earliest goal event (roster-based attribution, same as the rest of the app).
function firstGoalMatches(
  timelines: Record<number, TimelineEvent[]>,
  meta: Record<number, { code: string; opponent: string; result: FgMatch["result"] | null }>,
): FgMatch[] {
  const out: FgMatch[] = [];
  for (const [idStr, events] of Object.entries(timelines)) {
    if (!events.length) continue;
    const id = Number(idStr);
    let result = meta[id]?.result ?? null;
    if (!result) {
      const gf = events.filter(e => e.side === "for").length;
      const ga = events.filter(e => e.side === "against").length;
      result = gf > ga ? "W" : gf < ga ? "L" : "D";
    }
    out.push({
      matchId: id,
      code: meta[id]?.code ?? `#${id}`,
      opponent: meta[id]?.opponent ?? "Unknown",
      side: events[0].side,
      result,
    });
  }
  return out;
}

function fgSummary(matches: FgMatch[]): { scoredFirst: FgSplit; concededFirst: FgSplit } {
  const mk = (side: "for" | "against"): FgSplit => {
    const ms = matches.filter(m => m.side === side);
    return {
      w: ms.filter(m => m.result === "W").length,
      d: ms.filter(m => m.result === "D").length,
      l: ms.filter(m => m.result === "L").length,
      n: ms.length,
    };
  };
  return { scoredFirst: mk("for"), concededFirst: mk("against") };
}
const ppg = (s: FgSplit) => (s.n ? ((s.w * 3 + s.d) / s.n).toFixed(2) : "—");

// Stacked-by-opponent rows for the 6 fixed buckets, plus the raw matches per bucket
// (so the hover can list the actual match codes behind each bar).
function firstGoalStackData(matches: FgMatch[]): {
  rows: StackRow[]; opponents: string[]; matchesByBucket: Record<string, FgMatch[]>;
} {
  const opps = new Set<string>();
  const counts: Record<string, Record<string, number>> = {};
  const matchesByBucket: Record<string, FgMatch[]> = {};
  for (const b of FG_BUCKETS) { counts[b] = {}; matchesByBucket[b] = []; }
  for (const m of matches) {
    const bucket = `${m.side === "for" ? "SF" : "CF"} - ${m.result}`;
    opps.add(m.opponent);
    counts[bucket][m.opponent] = (counts[bucket][m.opponent] ?? 0) + 1;
    matchesByBucket[bucket].push(m);
  }
  const opponents = Array.from(opps).sort();
  const rows: StackRow[] = FG_BUCKETS.map(b => {
    const row: StackRow = { label: b };
    for (const o of opponents) row[o] = counts[b][o] ?? 0;
    return row;
  });
  return { rows, opponents, matchesByBucket };
}

// Rich hover: scenario context (SF/CF total, this result, %), per-opponent counts,
// and the actual match codes behind the hovered bar — respecting hidden clubs.
function FirstGoalStackTooltip({ active, label, matchesByBucket, hidden, colorMap }: {
  active?: boolean;
  label?: string;
  matchesByBucket: Record<string, FgMatch[]>;
  hidden: Set<string>;
  colorMap: Record<string, string>;
}) {
  if (!active || !label) return null;
  const vis = (m: FgMatch) => !hidden.has(m.opponent);
  const scenario = label.slice(0, 2); // "SF" | "CF"
  const resultMatches = (matchesByBucket[label] ?? []).filter(vis);
  const scenarioMatches = FG_BUCKETS
    .filter(b => b.startsWith(scenario))
    .flatMap(b => (matchesByBucket[b] ?? []).filter(vis));
  if (!scenarioMatches.length) return null;
  const pct = scenarioMatches.length ? Math.round((resultMatches.length / scenarioMatches.length) * 1000) / 10 : 0;
  const scenarioName = scenario === "SF" ? "scored first" : "conceded first";

  // Per-opponent counts within this bucket.
  const byOpp: Record<string, number> = {};
  for (const m of resultMatches) byOpp[m.opponent] = (byOpp[m.opponent] ?? 0) + 1;
  const oppRows = Object.entries(byOpp).sort((a, b) => b[1] - a[1]);

  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[220px] max-w-[300px] space-y-2">
      <div className="font-semibold text-sm">{FG_LABELS[label] ?? label}</div>
      <div className="border-t pt-2 space-y-0.5 text-muted-foreground">
        <div>Total matches {scenarioName}: <span className="text-foreground font-medium">{scenarioMatches.length}</span></div>
        <div>Matches in this result: <span className="text-foreground font-medium">{resultMatches.length}</span></div>
        <div>% of this scenario: <span className="text-foreground font-medium">{pct}%</span></div>
      </div>
      {oppRows.length > 0 && (
        <div className="border-t pt-2 space-y-1">
          {oppRows.map(([opp, n]) => (
            <div key={opp} className="flex justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorMap[opp] ?? "#888888" }} />
                vs {opp}
              </span>
              <span>{n}</span>
            </div>
          ))}
        </div>
      )}
      {resultMatches.length > 0 && (
        <div className="border-t pt-2 text-muted-foreground leading-relaxed">
          {resultMatches.map(m => m.code).join(", ")}
        </div>
      )}
    </div>
  );
}

function FirstGoalIndex({ matches, colorMap, hidden, onToggle }: {
  matches: FgMatch[];
  colorMap: Record<string, string>;
  hidden: Set<string>;
  onToggle: (opp: string) => void;
}) {
  const { scoredFirst, concededFirst } = fgSummary(matches);
  const { rows, opponents, matchesByBucket } = firstGoalStackData(matches);
  const Block = ({ title, s, accent }: { title: string; s: FgSplit; accent: string }) => (
    <div className="flex-1 rounded-lg border p-3 space-y-1">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="text-2xl font-bold" style={{ color: accent }}>{ppg(s)}<span className="text-sm font-normal text-muted-foreground"> pts/game</span></div>
      <div className="text-xs text-muted-foreground">{s.n} match{s.n === 1 ? "" : "es"} · {s.w}W {s.d}D {s.l}L</div>
    </div>
  );
  return (
    <div className="flex flex-col h-full gap-3">
      {/* Summary cards stay at the top */}
      <div className="flex gap-3 shrink-0">
        <Block title="When we score first" s={scoredFirst} accent="#10b981" />
        <Block title="When we concede first" s={concededFirst} accent="#ef4444" />
      </div>
      {/* Context-rich stacked bar chart */}
      <div className="flex-1 min-h-0">
        {matches.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No matches recorded</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" {...AXIS_STYLE} interval={0} />
              <YAxis {...AXIS_STYLE} allowDecimals={false} label={{ value: "Matches", angle: -90, position: "insideLeft", style: { fill: "hsl(var(--muted-foreground))", fontSize: 11 } }} />
              <Tooltip
                content={<FirstGoalStackTooltip matchesByBucket={matchesByBucket} hidden={hidden} colorMap={colorMap} />}
                cursor={{ fill: "hsl(var(--muted)/0.3)" }}
              />
              {opponents.map(opp => (
                <Bar key={opp} dataKey={opp} name={opp} stackId="s" fill={colorMap[opp] ?? "#888888"} hide={hidden.has(opp)} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      {/* Opponent legend (click to filter) */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] shrink-0">
        {opponents.map(opp => {
          const off = hidden.has(opp);
          return (
            <button key={opp} type="button" onClick={() => onToggle(opp)} className="flex items-center gap-1.5" aria-pressed={!off} style={{ cursor: "pointer" }}>
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorMap[opp] ?? "#888888", opacity: off ? 0.3 : 1 }} />
              <span style={{ color: off ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))", textDecoration: off ? "line-through" : "none" }}>{opp}</span>
            </button>
          );
        })}
      </div>
      <div className="text-center text-[11px] text-muted-foreground shrink-0">SF = Scored First, CF = Conceded First</div>
    </div>
  );
}

// ── Philosophy Alignment: Quadrant ───────────────────────────────────────────
// x = Possession % (axis 20–80, midline 50 — right side = more of the ball, our
// preferred style). y = "Quadrant Points", a control-and-dominance composite:
//   4·GoalsScored + Shots + Passes/10 − 4·GoalsConceded − OppShots − OppPasses/10
// computed here from the raw match columns (authoritative, keeps decimals).
interface QuadPoint {
  code: string;
  opponent: string;
  fullScore: string;
  x: number;          // possession %
  y: number;          // quadrant points
  gs: number | null;
  gc: number | null;
  shots: number | null;
  passes: number | null;
  oppShots: number | null;
  oppPasses: number | null;
}

function quadrantY(m: {
  goalsScored?: number | null; goalsConceded?: number | null;
  shots?: number | null; passes?: number | null;
  oppShots?: number | null; oppPasses?: number | null;
}): number {
  const gs = m.goalsScored ?? 0, gc = m.goalsConceded ?? 0;
  const sh = m.shots ?? 0, pa = m.passes ?? 0;
  const os = m.oppShots ?? 0, op = m.oppPasses ?? 0;
  return gs * 4 + sh + pa / 10 - gc * 4 - os - op / 10;
}

const QUAD_LABELS = {
  tr: "Our Way, Rewarded",
  tl: "Backs to the Wall",
  br: "Ball, No Bite",
  bl: "Outplayed",
} as const;

function QuadrantTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: QuadPoint }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="rounded-md border bg-card/95 backdrop-blur px-3 py-2 text-xs shadow-lg space-y-0.5 min-w-[190px]">
      <div className="font-semibold text-sm mb-1">{d.code}</div>
      <Row label="Opponent" value={d.opponent} />
      <Row label="Full Score" value={d.fullScore || "—"} />
      <Row label="Possession" value={`${d.x}%`} />
      <Row label="Quadrant Points" value={Math.round(d.y)} />
      <Row label="Shots" value={d.shots ?? "—"} />
      <Row label="Passes" value={d.passes ?? "—"} />
      <Row label="Opp Passes" value={d.oppPasses ?? "—"} />
      <Row label="Opp Shots" value={d.oppShots ?? "—"} />
    </div>
  );
}

function PhilosophyQuadrant({ points, colorMap }: { points: QuadPoint[]; colorMap: Record<string, string> }) {
  if (points.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No match data recorded</div>;
  }

  // y-axis range: floor pinned at -50 so the bottom quadrants always have room
  // (and future under-target teams have somewhere to sit); extends lower only if
  // the data ever drops past -50. Top padded around the data.
  const ys = points.map(p => p.y);
  const rawMin = Math.min(0, ...ys), rawMax = Math.max(0, ...ys);
  const pad = Math.max(10, (rawMax - rawMin) * 0.08);
  const yMin = Math.min(-80, Math.floor((rawMin - pad) / 10) * 10);
  const yMax = Math.ceil((rawMax + pad) / 10) * 10;

  // group points by opponent club so the legend lists clubs
  const byClub = new Map<string, QuadPoint[]>();
  for (const p of points) {
    if (!byClub.has(p.opponent)) byClub.set(p.opponent, []);
    byClub.get(p.opponent)!.push(p);
  }
  const clubs = Array.from(byClub.keys()).sort();

  const areaLabel = { fontSize: 11, fill: "hsl(var(--muted-foreground))", fontWeight: 600 } as const;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 16, right: 24, bottom: 40, left: 8 }}>
        {/* faint quadrant backgrounds + corner labels */}
        <ReferenceArea x1={50} x2={80} y1={0} y2={yMax} fill="hsl(var(--chart-2))" fillOpacity={0.06}
          label={{ value: QUAD_LABELS.tr, position: "insideTopRight", ...areaLabel }} />
        <ReferenceArea x1={20} x2={50} y1={0} y2={yMax} fill="hsl(var(--chart-1))" fillOpacity={0.04}
          label={{ value: QUAD_LABELS.tl, position: "insideTopLeft", ...areaLabel }} />
        <ReferenceArea x1={50} x2={80} y1={yMin} y2={0} fill="hsl(var(--chart-4))" fillOpacity={0.04}
          label={{ value: QUAD_LABELS.br, position: "insideBottomRight", ...areaLabel }} />
        <ReferenceArea x1={20} x2={50} y1={yMin} y2={0} fill="hsl(var(--destructive))" fillOpacity={0.05}
          label={{ value: QUAD_LABELS.bl, position: "insideBottomLeft", ...areaLabel }} />

        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
        <XAxis
          type="number" dataKey="x" domain={[20, 80]} ticks={[20, 30, 40, 50, 60, 70, 80]}
          tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`}
          label={{ value: "Possession %", position: "insideBottom", offset: -14, fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
        />
        <YAxis
          type="number" dataKey="y" domain={[yMin, yMax]} tick={{ fontSize: 11 }}
          label={{ value: "Control & dominance (Quadrant Points)", angle: -90, position: "insideLeft", style: { textAnchor: "middle", fontSize: 12, fill: "hsl(var(--muted-foreground))" } }}
        />
        <ReferenceLine x={50} stroke="hsl(var(--foreground))" strokeOpacity={0.35} strokeDasharray="4 4" />
        <ReferenceLine y={0} stroke="hsl(var(--foreground))" strokeOpacity={0.35} strokeDasharray="4 4" />
        <Tooltip content={<QuadrantTooltip />} cursor={{ strokeDasharray: "3 3" }} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 18 }} />
        {clubs.map(club => (
          <Scatter key={club} name={club} data={byClub.get(club)} fill={colorMap[club] ?? "#888888"} />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

const POS_COLOR: Record<PosGroup, string> = { GK: C5, DEF: C2, MID: C1, FWD: C3 };
const POS_BADGE_BG: Record<PosGroup, string> = {
  GK:  "bg-[hsl(var(--chart-5)/0.2)] text-[hsl(var(--chart-5))]",
  DEF: "bg-[hsl(var(--chart-2)/0.2)] text-[hsl(var(--chart-2))]",
  MID: "bg-[hsl(var(--chart-1)/0.2)] text-[hsl(var(--chart-1))]",
  FWD: "bg-[hsl(var(--chart-3)/0.2)] text-[hsl(var(--chart-3))]",
};

// ─── Shared chart tooltip style ───────────────────────────────────────────────
const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))", fontSize: 12 },
  itemStyle: { color: "hsl(var(--foreground))" },
  cursor: { fill: "hsl(var(--muted)/0.3)" },
};

const AXIS_STYLE = {
  tick: { fill: "hsl(var(--muted-foreground))", fontSize: 11 },
  tickLine: false as const,
  axisLine: false as const,
};

// Short-name helper: returns first name, falling back to "First L." if a
// duplicate first name exists within the provided squad list.
function makeShortName(name: string, allNames: string[]): string {
  const first = name.split(" ")[0];
  const dupes = allNames.filter(n => n.split(" ")[0] === first);
  if (dupes.length > 1) {
    const parts = name.split(" ");
    const last = parts[parts.length - 1];
    return `${first} ${last[0]}.`;
  }
  return first;
}

// Build a name → shortName lookup from a leaderboard array
function buildShortNames(players: Array<{ playerName: string }>): Record<string, string> {
  const allNames = players.map(p => p.playerName);
  const map: Record<string, string> = {};
  for (const p of players) map[p.playerName] = makeShortName(p.playerName, allNames);
  return map;
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function SeasonStats() {
  const { data: teams } = useListTeams();
  const { data: seasons } = useListSeasons();

  const [selectedTeamId, setSelectedTeamId] = useState<number | "">("");
  const [selectedSeasonId, setSelectedSeasonId] = useState<number | "">("");
  const [effMetric, setEffMetric] = useState<"per90" | "total">("per90");
  const [effMinMins, setEffMinMins] = useState<0 | 90 | 150 | 180>(150);
  const [selectedClub, setSelectedClub] = useState<string>("");
  const [hiddenOpponents, setHiddenOpponents] = useState<Set<string>>(new Set());
  const [mpgSort, setMpgSort] = useState<"goals" | "mpg">("goals");
  const [mpgLastN, setMpgLastN] = useState(false);
  const [startsSort, setStartsSort] = useState<"appearances" | "starts">("appearances");
  const [tlPlayer, setTlPlayer] = useState<string | null>(null); // player-tab timeline drill-down
  const [goalDetailDim, setGoalDetailDim] = useState<GoalDetailDim>("assist");
  const [concededDim, setConcededDim] = useState<GoalDetailDim>("assist");
  const [hiddenTeamClubs, setHiddenTeamClubs] = useState<Set<string>>(new Set());
  const [hiddenConcededClubs, setHiddenConcededClubs] = useState<Set<string>>(new Set());
  const [hiddenResponseClubs, setHiddenResponseClubs] = useState<Set<string>>(new Set());
  const [hiddenFgClubs, setHiddenFgClubs] = useState<Set<string>>(new Set());
  const [l3FgIndex, setL3FgIndex] = useState(false);
  const [pieOpponent, setPieOpponent] = useState<string>("");
  const [pieOppConceded, setPieOppConceded] = useState<string>("");
  // Per-chart "Last 3 rounds" toggles (isolated — each only affects its own chart).
  const [l3ScInt, setL3ScInt]   = useState(false); // scored: by interval
  const [l3ScType, setL3ScType] = useState(false); // scored: by type
  const [l3ScDet, setL3ScDet]   = useState(false); // scored: goal detail
  const [l3Pass, setL3Pass]     = useState(false); // pass-string
  const [l3CcInt, setL3CcInt]   = useState(false); // conceded: by interval
  const [l3CcType, setL3CcType] = useState(false); // conceded: by type
  const [l3CcDet, setL3CcDet]   = useState(false); // conceded: goal detail
  // Goal Contributions stacked-by-club state
  const [hiddenContribOpponents, setHiddenContribOpponents] = useState<Set<string>>(new Set());
  const [contribSort, setContribSort] = useState<"total" | "mpg">("total");
  const [gcLastN, setGcLastN] = useState(false);
  // Mins per Assist stacked-by-club state
  const [hiddenAssistOpponents, setHiddenAssistOpponents] = useState<Set<string>>(new Set());
  const [mpaSort, setMpaSort] = useState<"total" | "mpg">("total");
  const [mpaLastN, setMpaLastN] = useState(false);
  // Opponent Insights state
  const [hiddenProfileOpponents, setHiddenProfileOpponents] = useState<Set<string>>(new Set());
  const [profileScDetDim, setProfileScDetDim] = useState<GoalDetailDim>("assist");
  const [profileGcDetDim, setProfileGcDetDim] = useState<GoalDetailDim>("assist");
  const [l3ProfScInt, setL3ProfScInt] = useState(false);   // opponent: scored by interval
  const [l3ProfScType, setL3ProfScType] = useState(false); // opponent: scored by type
  const [l3ProfGcInt, setL3ProfGcInt] = useState(false);   // opponent: conceded by interval
  const [l3ProfGcType, setL3ProfGcType] = useState(false); // opponent: conceded by type
  const [scPieOpp, setScPieOpp] = useState("__all");       // scored pies: opponent filter
  const [gcPieOpp, setGcPieOpp] = useState("__all");       // conceded pies: opponent filter
  // Opponent Insights — per-player Goals/Assists/Contributions stacked-by-opponent charts
  const [hiddenOppGoalOpp, setHiddenOppGoalOpp]       = useState<Set<string>>(new Set());
  const [hiddenOppAssistOpp, setHiddenOppAssistOpp]   = useState<Set<string>>(new Set());
  const [hiddenOppContribOpp, setHiddenOppContribOpp] = useState<Set<string>>(new Set());
  const [oppGoalSort, setOppGoalSort]       = useState<"total" | "mpg">("total");
  const [oppAssistSort, setOppAssistSort]   = useState<"total" | "mpg">("total");
  const [oppContribSort, setOppContribSort] = useState<"total" | "mpg">("total");
  const [oppGoalL3, setOppGoalL3]       = useState(false);
  const [oppAssistL3, setOppAssistL3]   = useState(false);
  const [oppContribL3, setOppContribL3] = useState(false);
  const [oppStartsL3, setOppStartsL3]   = useState(false); // squad: starts & appearances
  const [oppMinsL3, setOppMinsL3]       = useState(false); // squad: total minutes
  const [comboLastN, setComboLastN]       = useState(false); // team: combo threat
  const [oppComboLastN, setOppComboLastN] = useState(false); // opponent: combo threat
  const [dnaPlayer, setDnaPlayer]         = useState("");    // team: scoring-DNA focus player
  const [dnaLastN, setDnaLastN]           = useState(false); // team: scoring-DNA window
  const [oppDnaLastN, setOppDnaLastN]     = useState(false); // opponent: scoring-DNA window
  const [oppDnaPlayer, setOppDnaPlayer]   = useState("");    // opponent: scoring-DNA focus player
  const [oppView, setOppView]             = useState<"team" | "player">("team"); // opponent: Team / Players sub-view

  React.useEffect(() => {
    if (teams?.length && selectedTeamId === "") {
      const analytics = teams.find(t => t.analyticsEnabled && t.gender === "female") ?? teams[0];
      setSelectedTeamId(analytics.id);
    }
    if (seasons?.length && selectedSeasonId === "") {
      const active = seasons.find(s => s.isActive);
      setSelectedSeasonId(active ? active.id : seasons[0].id);
    }
  }, [teams, seasons, selectedTeamId, selectedSeasonId]);

  const tId = selectedTeamId as number;
  const sId = selectedSeasonId as number;
  // Leave any player timeline drill-down when the team/season context changes
  useEffect(() => { setTlPlayer(null); }, [tId, sId]);
  const isReady = !!tId && !!sId;

  const analyticsParams = { teamId: tId, seasonId: sId };
  const { data: summary }     = useGetSeasonSummary(analyticsParams,       { query: { enabled: isReady, queryKey: getGetSeasonSummaryQueryKey(analyticsParams) } });
  const { data: ladder }      = useGetLeagueLadder(analyticsParams,        { query: { enabled: isReady, queryKey: getGetLeagueLadderQueryKey(analyticsParams) } });
  // Two goal-breakdown sources: full season and last-3-rounds. Each chart chooses its
  // own source via its isolated toggle (see `pick` below).
  const { data: goalBreakdownFull } = useGetGoalBreakdown(analyticsParams,   { query: { enabled: isReady, queryKey: getGetGoalBreakdownQueryKey(analyticsParams) } });
  const gbL3Params = { ...analyticsParams, lastN: 3 };
  const { data: goalBreakdownL3 } = useGetGoalBreakdown(gbL3Params,          { query: { enabled: isReady, queryKey: getGetGoalBreakdownQueryKey(gbL3Params) } });
  const { data: leaderboard } = useGetPlayerLeaderboard(analyticsParams,   { query: { enabled: isReady, queryKey: getGetPlayerLeaderboardQueryKey(analyticsParams) } });

  // ── Combo threat (our assist→scorer partnerships): full season + last-3-rounds ─
  const { data: goalCombosFull } = useGetGoalCombos(analyticsParams, { query: { enabled: isReady, queryKey: getGetGoalCombosQueryKey(analyticsParams) } });
  const goalCombosL3Params = { ...analyticsParams, lastN: 3 };
  const { data: goalCombosL3 } = useGetGoalCombos(goalCombosL3Params, { query: { enabled: isReady, queryKey: getGetGoalCombosQueryKey(goalCombosL3Params) } });

  // ── Scoring DNA (radar) for the selected focus-team player: full season + last-3 ─
  const dnaParams = { teamId: tId, seasonId: sId, player: dnaPlayer };
  const dnaEnabled = isReady && !!dnaPlayer;
  const { data: dnaFull } = useGetPlayerDna(dnaParams, { query: { enabled: dnaEnabled, queryKey: getGetPlayerDnaQueryKey(dnaParams) } });
  const dnaL3Params = { ...dnaParams, lastN: 3 };
  const { data: dnaL3 } = useGetPlayerDna(dnaL3Params, { query: { enabled: dnaEnabled, queryKey: getGetPlayerDnaQueryKey(dnaL3Params) } });

  // ── Opponent clubs ────────────────────────────────────────────────────────
  const { data: oppClubs, isLoading: oppClubsLoading } = useGetOpponentClubs(analyticsParams, { query: { enabled: isReady, queryKey: getGetOpponentClubsQueryKey(analyticsParams) } });
  // Auto-select first club on load; reset if current selection is no longer in the list (team/season switch)
  useEffect(() => {
    if (!oppClubs) return;
    // Valid selections include the league-wide sentinel and our own club, on top of the opponents.
    const valid = ["__ALL__", "Belconnen", ...oppClubs];
    if (!valid.includes(selectedClub)) {
      // Prefer the first opponent club; fall back to the league-wide view so the tab
      // is always usable even when no opponent clubs are returned.
      setSelectedClub(oppClubs[0] ?? "__ALL__");
    }
  }, [oppClubs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Club-centric scouting profile: the selected club's data across ALL their league games
  const profileParams = { teamId: tId, seasonId: sId, club: selectedClub };
  const { data: profile } = useGetOpponentProfile(profileParams, {
    query: { enabled: isReady && !!selectedClub, queryKey: getGetOpponentProfileQueryKey(profileParams) },
  });
  const isAll = selectedClub === "__ALL__";

  // Coach behaviour: first-substitution patterns for the selected club.
  // Game state & "first change" are club-relative, so there is no __ALL__ view.
  const firstSubParams = { teamId: tId, seasonId: sId, club: selectedClub };
  const { data: firstSub } = useGetOpponentFirstSub(firstSubParams, {
    query: { enabled: isReady && !!selectedClub && !isAll, queryKey: getGetOpponentFirstSubQueryKey(firstSubParams) },
  });

  // Per-player goals/assists/mins for the selected club, broken down by opponent faced.
  // Two sources (full season + last-3-rounds); each chart picks via its own L3 toggle.
  const oppPlayersParams = { teamId: tId, seasonId: sId, club: selectedClub };
  const { data: oppPlayersFull } = useGetOpponentPlayersByOpponent(oppPlayersParams, {
    query: { enabled: isReady && !!selectedClub, queryKey: getGetOpponentPlayersByOpponentQueryKey(oppPlayersParams) },
  });
  const oppPlayersL3Params = { teamId: tId, seasonId: sId, club: selectedClub, lastN: 3 };
  const { data: oppPlayersL3 } = useGetOpponentPlayersByOpponent(oppPlayersL3Params, {
    query: { enabled: isReady && !!selectedClub, queryKey: getGetOpponentPlayersByOpponentQueryKey(oppPlayersL3Params) },
  });

  // Combo threat for the selected club: their assist→scorer partnerships (full + L3)
  const oppCombosParams = { teamId: tId, seasonId: sId, club: selectedClub };
  const { data: oppCombosFull } = useGetOpponentGoalCombos(oppCombosParams, {
    query: { enabled: isReady && !!selectedClub, queryKey: getGetOpponentGoalCombosQueryKey(oppCombosParams) },
  });
  const oppCombosL3Params = { teamId: tId, seasonId: sId, club: selectedClub, lastN: 3 };
  const { data: oppCombosL3 } = useGetOpponentGoalCombos(oppCombosL3Params, {
    query: { enabled: isReady && !!selectedClub, queryKey: getGetOpponentGoalCombosQueryKey(oppCombosL3Params) },
  });

  // Scoring DNA for a selected player of the selected club (league tables; full + L3)
  const oppDnaParams = { teamId: tId, seasonId: sId, club: selectedClub, player: oppDnaPlayer };
  const oppDnaEnabled = isReady && !!selectedClub && !!oppDnaPlayer;
  const { data: oppDnaFull } = useGetOpponentPlayerDna(oppDnaParams, {
    query: { enabled: oppDnaEnabled, queryKey: getGetOpponentPlayerDnaQueryKey(oppDnaParams) },
  });
  const oppDnaL3Params = { ...oppDnaParams, lastN: 3 };
  const { data: oppDnaL3 } = useGetOpponentPlayerDna(oppDnaL3Params, {
    query: { enabled: oppDnaEnabled, queryKey: getGetOpponentPlayerDnaQueryKey(oppDnaL3Params) },
  });
  // Dropdown list for the opponent DNA — the club's players ranked by G+A.
  const oppDnaPlayers = useMemo(() => {
    const ps = oppPlayersFull?.players ?? [];
    return ps.slice()
      .sort((a, b) => (b.totalGoals + b.totalAssists) - (a.totalGoals + a.totalAssists) || a.playerName.localeCompare(b.playerName))
      .map(p => p.playerName);
  }, [oppPlayersFull]);
  // Default to the club's top contributor; reset when the club (and thus list) changes.
  useEffect(() => {
    if (!oppDnaPlayers.includes(oppDnaPlayer)) setOppDnaPlayer(oppDnaPlayers[0] ?? "");
  }, [oppDnaPlayers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Clubs (brand colours) ─────────────────────────────────────────────────
  const { data: clubs } = useGetClubs({ query: { queryKey: getGetClubsQueryKey() } });

  // ── Mins per Goal stacked chart (existing) ────────────────────────────────
  const goalsByOppParams = { ...analyticsParams, ...(mpgLastN ? { lastN: 4 } : {}) };
  const { data: goalsByOpp } = useGetGoalsByOpponent(goalsByOppParams, {
    query: { enabled: isReady, queryKey: getGetGoalsByOpponentQueryKey(goalsByOppParams) },
  });

  // ── Goal Contributions stacked chart (new) ─────────────────────────────────
  const goalsByOppGcParams = { ...analyticsParams, ...(gcLastN ? { lastN: 4 } : {}) };
  const { data: goalsByOppGc } = useGetGoalsByOpponent(goalsByOppGcParams, {
    query: { enabled: isReady, queryKey: getGetGoalsByOpponentQueryKey(goalsByOppGcParams) },
  });
  const assistsGcParams = { ...analyticsParams, ...(gcLastN ? { lastN: 4 } : {}) };
  const { data: assistsForGc } = useGetAssistsByOpponent(assistsGcParams, {
    query: { enabled: isReady, queryKey: getGetAssistsByOpponentQueryKey(assistsGcParams) },
  });

  // ── Mins per Assist stacked chart (new) ────────────────────────────────────
  const assistsMpaParams = { ...analyticsParams, ...(mpaLastN ? { lastN: 4 } : {}) };
  const { data: assistsForMpa } = useGetAssistsByOpponent(assistsMpaParams, {
    query: { enabled: isReady, queryKey: getGetAssistsByOpponentQueryKey(assistsMpaParams) },
  });

  // colour map: club name → hex colour
  const clubColorMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const c of clubs ?? []) map[c.name] = c.primaryColor;
    return map;
  }, [clubs]);

  // ── Philosophy Alignment quadrant: one point per match (possession vs points) ─
  const { data: matchList } = useListMatches(analyticsParams, {
    query: { enabled: isReady, queryKey: getListMatchesQueryKey(analyticsParams) },
  });
  const quadPoints = useMemo<QuadPoint[]>(() => {
    return (matchList ?? [])
      // Require every input to the Quadrant Points formula (plus possession for x).
      // A partially-recorded match must be dropped, not imputed to zeros — otherwise
      // missing stats would silently shift its y-value into the wrong quadrant.
      .filter(m =>
        m.possession != null && m.goalsScored != null && m.goalsConceded != null &&
        m.shots != null && m.passes != null && m.oppShots != null && m.oppPasses != null)
      .map(m => ({
        code: m.matchId,
        opponent: m.opponent,
        fullScore: m.fullScore ?? "",
        x: m.possession as number,
        y: quadrantY(m),
        gs: m.goalsScored ?? null,
        gc: m.goalsConceded ?? null,
        shots: m.shots ?? null,
        passes: m.passes ?? null,
        oppShots: m.oppShots ?? null,
        oppPasses: m.oppPasses ?? null,
      }));
  }, [matchList]);

  // ── Short-name lookup (deduplicates first names within the squad) ─────────
  const sn = useMemo(() => leaderboard ? buildShortNames(leaderboard) : {}, [leaderboard]);

  // Default the scoring-DNA focus to the top scorer; reset if the current pick is no
  // longer in the squad (team/season switch). Leaderboard is pre-sorted by goals desc.
  useEffect(() => {
    if (!leaderboard?.length) return;
    const names = leaderboard.map(p => p.playerName);
    if (!names.includes(dnaPlayer)) setDnaPlayer(names[0]);
  }, [leaderboard]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle helpers ────────────────────────────────────────────────────────
  const toggleContribOpponent = (opp: string) => setHiddenContribOpponents(prev => {
    const next = new Set(prev); if (next.has(opp)) next.delete(opp); else next.add(opp); return next;
  });
  const toggleAssistOpponent = (opp: string) => setHiddenAssistOpponents(prev => {
    const next = new Set(prev); if (next.has(opp)) next.delete(opp); else next.add(opp); return next;
  });
  // Opponent Insights player-chart legend toggles
  const mkOppToggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (opp: string) =>
    setter(prev => { const next = new Set(prev); if (next.has(opp)) next.delete(opp); else next.add(opp); return next; });
  const toggleOppGoalOpp    = mkOppToggle(setHiddenOppGoalOpp);
  const toggleOppAssistOpp  = mkOppToggle(setHiddenOppAssistOpp);
  const toggleOppContribOpp = mkOppToggle(setHiddenOppContribOpp);

  // ── All opponents for Goal Contributions chart ────────────────────────────
  const allContribOpponents = useMemo(() => {
    const s = new Set<string>([...(goalsByOppGc?.opponents ?? []), ...(assistsForGc?.opponents ?? [])]);
    return Array.from(s).sort();
  }, [goalsByOppGc, assistsForGc]);

  const allAssistOpponents = useMemo(() => assistsForMpa?.opponents ?? [], [assistsForMpa]);

  // ── Goal Contributions stacked chart data ──────────────────────────────────
  const contribChartData = useMemo((): ContribEntry[] => {
    const playerNames = new Set<string>([
      ...(goalsByOppGc?.players ?? []).map(p => p.playerName),
      ...(assistsForGc?.players ?? []).map(p => p.playerName),
    ]);
    if (!playerNames.size) return [];
    return Array.from(playerNames).map(playerName => {
      const gp = goalsByOppGc?.players.find(p => p.playerName === playerName);
      const ap = assistsForGc?.players.find(p => p.playerName === playerName);
      const byOpponent: Record<string, { goals: number; assists: number; minsPlayed: number }> = {};
      for (const opp of allContribOpponents) {
        const g = gp?.byOpponent[opp]?.goals ?? 0;
        const a = ap?.byOpponent[opp]?.assists ?? 0;
        const m = gp?.byOpponent[opp]?.minsPlayed ?? ap?.byOpponent[opp]?.minsPlayed ?? 0;
        if (g + a > 0) byOpponent[opp] = { goals: g, assists: a, minsPlayed: m };
      }
      const visibleEntries = Object.entries(byOpponent).filter(([o]) => !hiddenContribOpponents.has(o));
      const filteredGoals   = visibleEntries.reduce((s, [, v]) => s + v.goals, 0);
      const filteredAssists = visibleEntries.reduce((s, [, v]) => s + v.assists, 0);
      const filteredContribs = filteredGoals + filteredAssists;
      const filteredMins    = visibleEntries.reduce((s, [, v]) => s + v.minsPlayed, 0);
      const totalMins = gp?.totalMins ?? ap?.totalMins ?? 0;
      const row: ContribEntry = {
        name: sn[playerName] ?? playerName, fullName: playerName,
        totalMins, filteredGoals, filteredAssists, filteredContribs, filteredMins, byOpponent,
      };
      for (const opp of allContribOpponents) {
        const e = byOpponent[opp];
        (row as Record<string, unknown>)[opp] = e ? e.goals + e.assists : 0;
      }
      return row;
    })
    .filter(p => p.filteredContribs > 0)
    .sort((a, b) => {
      if (contribSort === "mpg") {
        const mA = a.filteredContribs > 0 ? a.totalMins / a.filteredContribs : Infinity;
        const mB = b.filteredContribs > 0 ? b.totalMins / b.filteredContribs : Infinity;
        return mA - mB;
      }
      return b.filteredContribs - a.filteredContribs;
    });
  }, [goalsByOppGc, assistsForGc, hiddenContribOpponents, sn, contribSort, allContribOpponents]);

  // ── Mins per Assist stacked chart data ────────────────────────────────────
  const assistsChartData = useMemo((): AssistEntry[] => {
    if (!assistsForMpa?.players.length) return [];
    return assistsForMpa.players
      .map(p => {
        const visibleEntries = Object.entries(p.byOpponent).filter(([o]) => !hiddenAssistOpponents.has(o));
        const filteredAssists = visibleEntries.reduce((s, [, v]) => s + v.assists, 0);
        const filteredMins    = visibleEntries.reduce((s, [, v]) => s + v.minsPlayed, 0);
        const row: AssistEntry = {
          name: sn[p.playerName] ?? p.playerName, fullName: p.playerName,
          totalMins: p.totalMins, filteredAssists, filteredMins, byOpponent: p.byOpponent,
        };
        for (const [opp, data] of Object.entries(p.byOpponent)) {
          (row as Record<string, unknown>)[opp] = data.assists;
        }
        return row;
      })
      .filter(p => p.filteredAssists > 0)
      .sort((a, b) => {
        if (mpaSort === "mpg") {
          const mA = a.filteredAssists > 0 ? a.totalMins / a.filteredAssists : Infinity;
          const mB = b.filteredAssists > 0 ? b.totalMins / b.filteredAssists : Infinity;
          return mA - mB;
        }
        return b.filteredAssists - a.filteredAssists;
      });
  }, [assistsForMpa, hiddenAssistOpponents, sn, mpaSort]);

  // ── Goals-by-opponent stacked chart data (reacts to legend toggles) ────────
  const toggleOpponent = (opp: string) => {
    setHiddenOpponents(prev => {
      const next = new Set(prev);
      if (next.has(opp)) next.delete(opp); else next.add(opp);
      return next;
    });
  };

  const allOpponents = useMemo(() => goalsByOpp?.opponents ?? [], [goalsByOpp]);

  const goalsByOppChartData = useMemo((): MpgEntry[] => {
    if (!goalsByOpp?.players.length) return [];
    return goalsByOpp.players
      .map(p => {
        const visibleEntries = Object.entries(p.byOpponent).filter(([o]) => !hiddenOpponents.has(o));
        const filteredGoals = visibleEntries.reduce((s, [, v]) => s + v.goals, 0);
        const filteredMins  = visibleEntries.reduce((s, v) => s + v[1].minsPlayed, 0);
        const row: MpgEntry = {
          name: sn[p.playerName] ?? p.playerName,
          fullName: p.playerName,
          totalMins: p.totalMins,
          filteredGoals,
          filteredMins,
          byOpponent: p.byOpponent,
        };
        // Per-opponent goal counts as dynamic keys for Recharts stacked bars
        for (const [opp, data] of Object.entries(p.byOpponent)) {
          (row as Record<string, unknown>)[opp] = data.goals;
        }
        return row;
      })
      .filter(p => p.filteredGoals > 0)
      .sort((a, b) => {
        if (mpgSort === "mpg") {
          // Use total season minutes so the result matches the main leaderboard chart
          const mpgA = a.filteredGoals > 0 ? a.totalMins / a.filteredGoals : Infinity;
          const mpgB = b.filteredGoals > 0 ? b.totalMins / b.filteredGoals : Infinity;
          return mpgA - mpgB; // ascending — most efficient scorer on the left
        }
        return b.filteredGoals - a.filteredGoals; // descending — most goals first
      });
  }, [goalsByOpp, hiddenOpponents, sn, mpgSort]);

  const effectivenessData = useMemo((): EffEntry[] => {
    if (!leaderboard) return [];
    const entries = leaderboard
      .filter(p => p.minsPlayed >= effMinMins && p.appearances > 0)
      .map(p => {
        const gd     = (p.goalsFor ?? 0) - p.goalsConceded;
        const gdPer90 = p.minsPlayed > 0 ? +(gd / (p.minsPlayed / 90)).toFixed(2) : 0;
        const value   = effMetric === "per90" ? gdPer90 : gd;
        return {
          name: sn[p.playerName] ?? p.playerName,
          fullName: p.playerName,
          position: p.position ?? null,
          posGroup: positionGroup(p.position),
          value,
          goalsFor:     p.goalsFor ?? 0,
          goalsAgainst: p.goalsConceded,
          gd,
          gdPer90,
          minsPlayed:  p.minsPlayed,
          appearances: p.appearances,
          starts:      p.starts,
          rank: 0, total: 0,
        };
      })
      .sort((a, b) => b.value - a.value);
    return entries.map((e, i) => ({ ...e, rank: i + 1, total: entries.length }));
  }, [leaderboard, sn, effMetric, effMinMins]);

  const startsData = useMemo(() =>
    leaderboard
      ?.slice().sort((a, b) => startsSort === "starts" ? b.starts - a.starts : b.appearances - a.appearances)
      .map(p => ({
        name: sn[p.playerName] ?? p.playerName,
        fullName: p.playerName,
        starts: p.starts,
        bench: p.appearances - p.starts,
        appearances: p.appearances,
        minsPlayed: p.minsPlayed,
        yellowCards: p.yellowCards,
        redCards: p.redCards,
      })) ?? [],
    [leaderboard, sn, startsSort]);

  const minutesData = useMemo(() =>
    leaderboard
      ?.slice().sort((a, b) => b.minsPlayed - a.minsPlayed)
      .map(p => ({
        name: sn[p.playerName] ?? p.playerName,
        fullName: p.playerName,
        value: p.minsPlayed,
        appearances: p.appearances,
        avgPerApp: p.appearances > 0 ? Math.round(p.minsPlayed / p.appearances) : 0,
      })) ?? [],
    [leaderboard, sn]);

  const avgMins = useMemo(() => {
    if (!leaderboard?.length) return 0;
    return Math.round(leaderboard.reduce((s, p) => s + p.minsPlayed, 0) / leaderboard.length);
  }, [leaderboard]);

  const defensiveData = useMemo(() =>
    leaderboard
      ?.filter(p => isDefensive(p.position) && p.minsPerGoalConceded != null)
      .sort((a, b) => (b.minsPerGoalConceded ?? 0) - (a.minsPerGoalConceded ?? 0))
      .map(p => ({ name: sn[p.playerName] ?? p.playerName, value: p.minsPerGoalConceded, pos: p.position })) ?? [],
    [leaderboard, sn]);

  // ── Team goal breakdowns ─────────────────────────────────────────────────────
  // Each chart has its OWN Last-3-rounds toggle: it picks the full-season source or
  // the last-3 source independently, so toggling one chart never affects the others.
  const pick = (l3: boolean) => (l3 ? goalBreakdownL3 : goalBreakdownFull);

  const toggleTeamClub = (opp: string) =>
    setHiddenTeamClubs(prev => {
      const next = new Set(prev);
      if (next.has(opp)) next.delete(opp); else next.add(opp);
      return next;
    });
  const toggleConcededClub = (opp: string) =>
    setHiddenConcededClubs(prev => {
      const next = new Set(prev);
      if (next.has(opp)) next.delete(opp); else next.add(opp);
      return next;
    });
  const toggleResponseClub = (opp: string) =>
    setHiddenResponseClubs(prev => {
      const next = new Set(prev);
      if (next.has(opp)) next.delete(opp); else next.add(opp);
      return next;
    });
  const toggleFgClub = (opp: string) =>
    setHiddenFgClubs(prev => {
      const next = new Set(prev);
      if (next.has(opp)) next.delete(opp); else next.add(opp);
      return next;
    });

  // Per-match goal timelines (scored + conceded merged, ordered by minute) power the
  // 5-minute-response and first-goal-index analytics. Always full season.
  const timelines = useMemo(
    () => buildTimelines(goalBreakdownFull?.goals ?? [], goalBreakdownFull?.conceded ?? []),
    [goalBreakdownFull]);
  const responseByOpp = useMemo(() => responseSituationByOpponent(timelines), [timelines]);

  // First Goal Value Index: per-match list built from the chosen source (full or last-3),
  // enriched with each match's code (e.g. "R1-WAN-BEL") and opponent club.
  const fgMatches = useMemo(() => {
    const src = l3FgIndex ? goalBreakdownL3 : goalBreakdownFull;
    if (!src) return [];
    const tl = buildTimelines(src.goals ?? [], src.conceded ?? []);
    const meta: Record<number, { code: string; opponent: string; result: "W" | "D" | "L" | null }> = {};
    for (const g of [...(src.goals ?? []), ...(src.conceded ?? [])]) {
      if (g.matchId == null || meta[g.matchId]) continue;
      const r = g.matchResult === "W" || g.matchResult === "D" || g.matchResult === "L" ? g.matchResult : null;
      meta[g.matchId] = { code: g.matchCode ?? `#${g.matchId}`, opponent: g.opponent ?? "Unknown", result: r };
    }
    return firstGoalMatches(tl, meta);
  }, [l3FgIndex, goalBreakdownL3, goalBreakdownFull]);

  // ── Goal-type pies (full season; scored and conceded each have their own opponent filter) ──
  const pieScored = useMemo(() => {
    const g = goalBreakdownFull?.goals ?? [];
    return pieOpponent ? g.filter(x => x.opponent === pieOpponent) : g;
  }, [goalBreakdownFull, pieOpponent]);
  const pieConceded = useMemo(() => {
    const g = goalBreakdownFull?.conceded ?? [];
    return pieOppConceded ? g.filter(x => x.opponent === pieOppConceded) : g;
  }, [goalBreakdownFull, pieOppConceded]);

  // ── Team Insights: per-chart derived data ───────────────────────────────────
  // Each chart reads from the source its own isolated toggle selects.
  // Scored charts (stacked by the opponent we scored against):
  const scIntSrc = pick(l3ScInt);
  const teamScIntOpps = scIntSrc?.opponents ?? [];
  const teamScIntData = intervalStackRows(scIntSrc?.goals ?? [], teamScIntOpps);

  const scTypeSrc = pick(l3ScType);
  const teamScTypeOpps = scTypeSrc?.opponents ?? [];
  const teamScTypeData = goalTypeStackRows(scTypeSrc?.goals ?? [], teamScTypeOpps);

  const scDetSrc = pick(l3ScDet);
  const teamScDetOpps = scDetSrc?.opponents ?? [];
  // Drop goals with a blank value for the selected dimension (blank is sometimes intentional) — no "Unknown" column.
  const teamScDetGoals = (scDetSrc?.goals ?? []).filter(g => !!DIM_GETTER[goalDetailDim](g)?.trim());
  const teamScDetData = detailStackRows(teamScDetGoals, teamScDetOpps, goalDetailDim);

  // Pass-string (open play + set pieces), stacked by goal type:
  const passSrc = pick(l3Pass);
  const passStr = passStringData(passSrc?.goals ?? []);

  // Conceded charts (stacked by the opponent who scored against us):
  const ccIntSrc = pick(l3CcInt);
  const ccIntConceded = ccIntSrc?.conceded ?? [];
  const teamCcIntOpps = oppsOf(ccIntConceded);
  const teamCcIntData = intervalStackRows(ccIntConceded, teamCcIntOpps);

  const ccTypeSrc = pick(l3CcType);
  // Blank goal types are sometimes intentional in data entry — leave them out of this chart.
  const ccTypeConceded = (ccTypeSrc?.conceded ?? []).filter(g => !!g.goalType?.trim());
  const teamCcTypeOpps = oppsOf(ccTypeConceded);
  const teamCcTypeData = goalTypeStackRows(ccTypeConceded, teamCcTypeOpps);

  const ccDetSrc = pick(l3CcDet);
  // Drop goals with a blank value for the selected dimension (blank is sometimes intentional) — no "Unknown" column.
  const ccDetConceded = (ccDetSrc?.conceded ?? []).filter(g => !!DIM_GETTER[concededDim](g)?.trim());
  const teamCcDetOpps = oppsOf(ccDetConceded);
  const teamCcDetData = detailStackRows(ccDetConceded, teamCcDetOpps, concededDim);

  // ── Opponent Insights (club-centric profile) derived data ───────────────────
  const profileOpponents = useMemo(() => profile?.opponents ?? [], [profile]);

  const toBucketRows = (buckets: { label: string; byOpponent: Record<string, number> }[] | undefined) =>
    (buckets ?? []).map(b => ({ label: b.label, ...b.byOpponent }));

  const rawProfileGoals = useMemo(() => (profile?.goals ?? []) as RawProfileGoal[], [profile]);

  // Scored charts are computed client-side from the raw goals so each can offer an
  // independent "Last 3 rounds" window (the 3 most recent match dates).
  const scoredIntervalData = useMemo(
    () => intervalStackRows(mapProfileGoals(lastNRoundsGoals(rawProfileGoals, "scored", l3ProfScInt ? 3 : undefined), "scored"), profileOpponents),
    [rawProfileGoals, profileOpponents, l3ProfScInt],
  );
  const concededIntervalData = useMemo(
    () => intervalStackRows(mapProfileGoals(lastNRoundsGoals(rawProfileGoals, "conceded", l3ProfGcInt ? 3 : undefined), "conceded"), profileOpponents),
    [rawProfileGoals, profileOpponents, l3ProfGcInt],
  );
  // Order the scored-by-type chart like the Team tab (FT → MT → BT → SP via typeRank);
  // drop the "Unknown"/no-type bucket entirely.
  const scoredTypeData = useMemo(
    () => goalTypeStackRows(mapProfileGoals(lastNRoundsGoals(rawProfileGoals, "scored", l3ProfScType ? 3 : undefined), "scored"), profileOpponents)
      .filter(r => r.label !== "Unknown"),
    [rawProfileGoals, profileOpponents, l3ProfScType],
  );
  // Order the conceded-by-type chart like the scored one (FT → MT → BT → SP); drop "Unknown".
  const concededTypeData = useMemo(
    () => goalTypeStackRows(mapProfileGoals(lastNRoundsGoals(rawProfileGoals, "conceded", l3ProfGcType ? 3 : undefined), "conceded"), profileOpponents)
      .filter(r => r.label !== "Unknown"),
    [rawProfileGoals, profileOpponents, l3ProfGcType],
  );

  const toggleProfileOpponent = (opp: string) => setHiddenProfileOpponents(prev => {
    const next = new Set(prev);
    next.has(opp) ? next.delete(opp) : next.add(opp);
    return next;
  });

  // Raw per-goal records for the selected club, split by side and mapped to the
  // ScoredGoalRecord shape the Team-tab transforms/components already consume.
  const profileScored   = useMemo(() => mapProfileGoals(profile?.goals as RawProfileGoal[] | undefined, "scored"),   [profile]);
  const profileConceded = useMemo(() => mapProfileGoals(profile?.goals as RawProfileGoal[] | undefined, "conceded"), [profile]);

  // Pie charts can be narrowed to a single opponent. Reset the filter whenever the
  // club changes so a stale opponent selection never carries over.
  useEffect(() => {
    setScPieOpp("__all"); setGcPieOpp("__all");
    setHiddenOppGoalOpp(new Set()); setHiddenOppAssistOpp(new Set()); setHiddenOppContribOpp(new Set());
  }, [selectedClub]);
  const profileScoredPie = useMemo(
    () => (scPieOpp !== "__all" && profileOpponents.includes(scPieOpp) ? profileScored.filter(g => g.opponent === scPieOpp) : profileScored),
    [profileScored, profileOpponents, scPieOpp],
  );
  const profileConcededPie = useMemo(
    () => (gcPieOpp !== "__all" && profileOpponents.includes(gcPieOpp) ? profileConceded.filter(g => g.opponent === gcPieOpp) : profileConceded),
    [profileConceded, profileOpponents, gcPieOpp],
  );

  // Goal-detail-by-type (drop blank dim values, mirroring the Team tab).
  const profileScDetGoals = useMemo(() => profileScored.filter(g => !!DIM_GETTER[profileScDetDim](g)?.trim()), [profileScored, profileScDetDim]);
  const profileScDetData  = useMemo(() => detailStackRows(profileScDetGoals, profileOpponents, profileScDetDim), [profileScDetGoals, profileOpponents, profileScDetDim]);
  const profileGcDetGoals = useMemo(() => profileConceded.filter(g => !!DIM_GETTER[profileGcDetDim](g)?.trim()), [profileConceded, profileGcDetDim]);
  const profileGcDetData  = useMemo(() => detailStackRows(profileGcDetGoals, profileOpponents, profileGcDetDim), [profileGcDetGoals, profileOpponents, profileGcDetDim]);

  // Per-match timelines (+ metadata) power the 5-minute-response and first-goal charts.
  const { profileTimelines, profileMeta } = useMemo(
    () => buildProfileTimelines(profile?.goals as RawProfileGoal[] | undefined, profile?.matches as RawProfileMatch[] | undefined),
    [profile]);
  const profileResponseByOpp = useMemo(() => responseSituationByOpponent(profileTimelines), [profileTimelines]);
  const profileFgMatches     = useMemo(() => firstGoalMatches(profileTimelines, profileMeta), [profileTimelines, profileMeta]);

  // Player metrics: per-90 rates for Belconnen + the league-wide view; totals only
  // for an individual opponent (rates off a scouted club can mislead).

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* ── Header + selectors ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Season Stats</h1>
        <div className="flex flex-col sm:flex-row gap-2">
          {teams && (
            <Select value={selectedTeamId.toString()} onValueChange={v => setSelectedTeamId(Number(v))}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Select Team" /></SelectTrigger>
              <SelectContent>{teams.filter(t => t.analyticsEnabled).map(t => <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {seasons && (
            <Select value={selectedSeasonId.toString()} onValueChange={v => setSelectedSeasonId(Number(v))}>
              <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select Season" /></SelectTrigger>
              <SelectContent>{seasons.map(s => <SelectItem key={s.id} value={s.id.toString()}>{s.leagueName} · {s.label}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* ── Season summary stat cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Matches"       value={summary?.matchesPlayed ?? "-"} />
        <StatCard title="Win Rate"      value={summary?.winRate ? `${Math.round(summary.winRate * 100)}%` : "-"} />
        <StatCard title="Goals For"     value={summary?.goalsScored ?? "-"}   subtitle={`${summary?.avgGoalsScored?.toFixed(1) ?? "-"} per match`} />
        <StatCard title="Goals Against" value={summary?.goalsConceded ?? "-"} subtitle={`${summary?.avgGoalsConceded?.toFixed(1) ?? "-"} per match`} />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="team" className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="team">Team Insights</TabsTrigger>
          <TabsTrigger value="player">Player Insights</TabsTrigger>
          <TabsTrigger value="opponent">Opponent Insights</TabsTrigger>
        </TabsList>

        {/* ════════════════ TEAM INSIGHTS ════════════════ */}
        <TabsContent value="team" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* League Ladder */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>League Ladder</CardTitle>
                <CardDescription>Current standings</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">#</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead className="text-right">P</TableHead>
                      <TableHead className="text-right">W</TableHead>
                      <TableHead className="text-right">D</TableHead>
                      <TableHead className="text-right">L</TableHead>
                      <TableHead className="text-right">GD</TableHead>
                      <TableHead className="text-right font-bold">PTS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ladder?.map((entry, idx) => (
                      <TableRow key={entry.teamName} className={entry.isFocusTeam ? "bg-primary/10 hover:bg-primary/20" : ""}>
                        <TableCell className="font-medium">{idx + 1}</TableCell>
                        <TableCell className={entry.isFocusTeam ? "font-bold text-primary" : ""}>{entry.teamName}</TableCell>
                        <TableCell className="text-right">{entry.played}</TableCell>
                        <TableCell className="text-right">{entry.won}</TableCell>
                        <TableCell className="text-right">{entry.drawn}</TableCell>
                        <TableCell className="text-right">{entry.lost}</TableCell>
                        <TableCell className="text-right">{entry.goalDiff > 0 ? `+${entry.goalDiff}` : entry.goalDiff}</TableCell>
                        <TableCell className="text-right font-bold">{entry.points}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Goals Scored by 15-Min Interval — stacked by opponent club */}
            <OpponentStackChart
              title={`Goals Scored by 15-Min Interval${l3ScInt ? " — Last 3 Rounds" : ""}`}
              description="When we score — stacked by opponent club (click legend to filter)"
              tooltip="Our goals grouped into 15-minute periods, split by the club we scored against. Click a club below to include/exclude it."
              data={teamScIntData}
              opponents={teamScIntOpps}
              colorMap={clubColorMap}
              hidden={hiddenTeamClubs}
              onToggle={toggleTeamClub}
              controls={<Last3Toggle active={l3ScInt} onToggle={() => setL3ScInt(v => !v)} />}
            />
          </div>

          {/* Goals Scored by Type — stacked by opponent club, custom code order */}
          <OpponentStackChart
            title={`Goals Scored by Type${l3ScType ? " — Last 3 Rounds" : ""}`}
            description="How our goals were created — coded by regain/set-piece type, stacked by opponent club"
            tooltip="Every goal scored by our players, grouped by its goal type code (e.g. R-MT-AT = regain in the middle third → after transition, SP-C = set piece corner) and split by opponent. Click a club below to include/exclude it."
            data={teamScTypeData}
            opponents={teamScTypeOpps}
            colorMap={clubColorMap}
            hidden={hiddenTeamClubs}
            onToggle={toggleTeamClub}
            angledLabels
            controls={<Last3Toggle active={l3ScType} onToggle={() => setL3ScType(v => !v)} />}
          />

          {/* Goal Detail by Type — stacked by opponent club, dropdown across 4 dimensions */}
          <OpponentStackChart
            title={`Goal Detail by Type${l3ScDet ? " — Last 3 Rounds" : ""}`}
            description="Break our goals down by assist, buildup, finish, or penetration — stacked by opponent club"
            tooltip="Our goals across the selected detail dimension, split by opponent. Hover a bar to see the individual goals (minute, scorer, opponent). Click a club below to include/exclude it."
            data={teamScDetData}
            opponents={teamScDetOpps}
            colorMap={clubColorMap}
            hidden={hiddenTeamClubs}
            onToggle={toggleTeamClub}
            angledLabels
            controls={
              <div className="flex flex-wrap items-center gap-3">
                <Select value={goalDetailDim} onValueChange={v => setGoalDetailDim(v as GoalDetailDim)}>
                  <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="assist">Assist Type</SelectItem>
                    <SelectItem value="buildup">Buildup Lane</SelectItem>
                    <SelectItem value="finish">Finish Type</SelectItem>
                    <SelectItem value="penetration">How Penetrated</SelectItem>
                    <SelectItem value="firsttime">First-time Finish</SelectItem>
                  </SelectContent>
                </Select>
                <Last3Toggle active={l3ScDet} onToggle={() => setL3ScDet(v => !v)} />
              </div>
            }
            tooltipContent={
              <GoalDetailStackTooltip goals={teamScDetGoals} dim={goalDetailDim} hidden={hiddenTeamClubs} shortName={sn} />
            }
          />

          {/* Pass-String by Goal Type — x = passes before the goal, stacked by goal type */}
          <ChartCard
            title={`Pass-String by Goal Type${l3Pass ? " — Last 3 Rounds" : ""}`}
            description="How many passes preceded each goal, split by goal type (set pieces grouped as 'Set play / n.a.')"
            tooltip="For each pass-string length (number of passes in the move before the goal), the bars show how many goals of each type resulted. Set-piece goals have no pass string, so they sit in the 'Set play / n.a.' column."
            controls={<Last3Toggle active={l3Pass} onToggle={() => setL3Pass(v => !v)} />}
            footer={<KeyLegend keys={passStr.keys} colorFn={colorForGoalType} />}
          >
            <StackBars rows={passStr.rows} keys={passStr.keys} colorFn={colorForGoalType} />
          </ChartCard>

          {/* ═══ Goals Scored — Breakdown by Type (pies), own opponent filter ═══ */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Goal Type Breakdown — Goals Scored</CardTitle>
                <CardDescription>
                  Open-play regains vs set pieces{pieOpponent ? ` · vs ${pieOpponent}` : " · all opponents"} — hover a segment for detail
                </CardDescription>
              </div>
              <Select value={pieOpponent || "__all"} onValueChange={v => setPieOpponent(v === "__all" ? "" : v)}>
                <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All opponents</SelectItem>
                  {(oppClubs ?? []).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardHeader>
          </Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <GoalTypePie
              title="Regain Types — Goals Scored"
              segments={buildPieSegments(pieScored, "regain")}
              colorMap={REGAIN_COLORS}
              grandTotal={pieScored.length}
              groupMode="third"
            />
            <GoalTypePie
              title="Set Piece Types — Goals Scored"
              segments={buildPieSegments(pieScored, "setpiece")}
              colorMap={SETPIECE_COLORS}
              grandTotal={pieScored.length}
              groupMode="setpiece"
            />
          </div>

          {/* ═══ Momentum: 5-minute response after a goal ═══ */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title="5-Minute Response After Goals"
              description="What happens in the 5 minutes after a goal — do we push on, or wobble?"
              tooltip="For every goal in a match, we look at the next 5 minutes. After WE score: did we score again, concede, or nothing? After WE concede: did we respond, concede again, or nothing? Draft — uses roster-based conceded attribution."
              footer={<KeyLegend keys={["We scored", "We conceded", "No goal"]} colorFn={RESPONSE_COLORS} />}
            >
              <StackBars rows={responseData(timelines)} keys={["We scored", "We conceded", "No goal"]} colorFn={RESPONSE_COLORS} showPct />
            </ChartCard>

            <OpponentStackChart
              title="5-Minute Response — Opponent Breakdown"
              description="Quick-fire swings (a goal within 5 min of a goal), split by situation & response — stacked by the opponent in that match"
              tooltip="Each 5-minute response event, grouped by what happened: after we score or concede, and whether we scored or conceded next — mirrors the situations in the chart above. Bars are stacked by the opponent club in that match. Click a club to include/exclude it."
              data={responseByOpp.rows}
              opponents={responseByOpp.opponents}
              colorMap={clubColorMap}
              hidden={hiddenResponseClubs}
              onToggle={toggleResponseClub}
              angledLabels
              tooltipContent={<ProfileStackTooltip showPct labelMap={RESPONSE_SIT_LABELS} />}
            />
          </div>

          {/* Goal Location Map — pitch scatter of where goals were scored/conceded */}
          <ChartCard
            title="Goal Location Map"
            auto
            description="Where goals were finished — blue = we scored, red = we conceded (hover a point for detail)"
            tooltip="Every goal with mapped pitch coordinates, on a vertical attacking third (goal at top). X spans the pitch width; Y is yards from the goal line (a point on the 18-yard line was finished from 18 yards out). Filter by club or goal type. Coordinates are set in the Goal Map tool."
          >
            <GoalLocationMap scored={goalBreakdownFull?.goals ?? []} conceded={goalBreakdownFull?.conceded ?? []} />
          </ChartCard>


          {/* ═══ Goals Conceded — mirrors of the scored stacked charts (stacked by the team that scored) ═══ */}
          <OpponentStackChart
            title={`Goals Conceded by 15-Min Interval${l3CcInt ? " — Last 3 Rounds" : ""}`}
            description="When we concede — stacked by the club that scored (click legend to filter)"
            tooltip="Goals we conceded grouped into 15-minute periods, split by the club that scored against us. Click a club below to include/exclude it."
            data={teamCcIntData}
            opponents={teamCcIntOpps}
            colorMap={clubColorMap}
            hidden={hiddenConcededClubs}
            onToggle={toggleConcededClub}
            controls={<Last3Toggle active={l3CcInt} onToggle={() => setL3CcInt(v => !v)} />}
          />

          <OpponentStackChart
            title={`Goals by Type (Conceded)${l3CcType ? " — Last 3 Rounds" : ""}`}
            description="How goals against were created — coded by regain/set-piece type, stacked by the club that scored"
            tooltip="Every goal we conceded, grouped by its goal type code and split by the club that scored it. Click a club below to include/exclude it."
            data={teamCcTypeData}
            opponents={teamCcTypeOpps}
            colorMap={clubColorMap}
            hidden={hiddenConcededClubs}
            onToggle={toggleConcededClub}
            angledLabels
            controls={<Last3Toggle active={l3CcType} onToggle={() => setL3CcType(v => !v)} />}
          />

          <OpponentStackChart
            title={`Goal Detail by Type (Conceded)${l3CcDet ? " — Last 3 Rounds" : ""}`}
            description="Break goals against down by assist, buildup, finish, or penetration — stacked by the club that scored"
            tooltip="Goals we conceded across the selected detail dimension, split by the club that scored. Hover a bar to see the individual goals. Click a club below to include/exclude it."
            data={teamCcDetData}
            opponents={teamCcDetOpps}
            colorMap={clubColorMap}
            hidden={hiddenConcededClubs}
            onToggle={toggleConcededClub}
            angledLabels
            controls={
              <div className="flex flex-wrap items-center gap-3">
                <Select value={concededDim} onValueChange={v => setConcededDim(v as GoalDetailDim)}>
                  <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="assist">Assist Type</SelectItem>
                    <SelectItem value="buildup">Buildup Lane</SelectItem>
                    <SelectItem value="finish">Finish Type</SelectItem>
                    <SelectItem value="penetration">How Penetrated</SelectItem>
                    <SelectItem value="firsttime">First-time Finish</SelectItem>
                  </SelectContent>
                </Select>
                <Last3Toggle active={l3CcDet} onToggle={() => setL3CcDet(v => !v)} />
              </div>
            }
            tooltipContent={
              <GoalDetailStackTooltip goals={ccDetConceded} dim={concededDim} hidden={hiddenConcededClubs} shortName={sn} />
            }
          />

          {/* ═══ Goals Conceded — Breakdown by Type (pies), own opponent filter ═══ */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>Goal Type Breakdown — Goals Conceded</CardTitle>
                <CardDescription>
                  Open-play regains vs set pieces{pieOppConceded ? ` · vs ${pieOppConceded}` : " · all opponents"} — hover a segment for detail
                </CardDescription>
              </div>
              <Select value={pieOppConceded || "__all"} onValueChange={v => setPieOppConceded(v === "__all" ? "" : v)}>
                <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All opponents</SelectItem>
                  {(oppClubs ?? []).map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardHeader>
          </Card>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <GoalTypePie
              title="Regain Types — Goals Conceded"
              segments={buildPieSegments(pieConceded, "regain")}
              colorMap={REGAIN_COLORS}
              grandTotal={pieConceded.length}
              groupMode="third"
            />
            <GoalTypePie
              title="Set Piece Types — Goals Conceded"
              segments={buildPieSegments(pieConceded, "setpiece")}
              colorMap={SETPIECE_COLORS}
              grandTotal={pieConceded.length}
              groupMode="setpiece"
            />
          </div>
          <p className="text-xs text-muted-foreground px-1">
            Conceded goals are attributed by scorer (any goal not scored by a rostered {" "}
            Belconnen player), so the conceded total can differ slightly from the official goals-against figure.
          </p>

          {/* ═══ First Goal Value Index ═══ */}
          <ChartCard
            title={`First Goal Value Index${l3FgIndex ? " — Last 3 Rounds" : ""}`}
            description="Match outcomes split by who scored first — points-per-game summary on top, full result breakdown stacked by opponent below"
            tooltip="Splits each match by who scored the opening goal (SF = we scored first, CF = we conceded first), then by the final result (W/D/L, from the recorded match score). Bars are stacked by the opponent club; hover for the scenario share and the exact matches."
            tall
            controls={<Last3Toggle active={l3FgIndex} onToggle={() => setL3FgIndex(v => !v)} />}
          >
            <FirstGoalIndex matches={fgMatches} colorMap={clubColorMap} hidden={hiddenFgClubs} onToggle={toggleFgClub} />
          </ChartCard>

          {/* ═══ Philosophy Alignment — Quadrant ═══ */}
          <ChartCard
            title="Philosophy Alignment — Quadrant"
            description="Every match plotted by possession (x) vs a control-and-dominance composite (y)"
            tooltip="x = Possession % (axis 20–80, midline 50 — right = more of the ball, our preferred style). y = Quadrant Points = 4·GoalsScored + Shots + Passes/10 − 4·GoalsConceded − OppShots − OppPasses/10, computed from the recorded match stats. Top-right = we controlled the game our way and it paid off. Dots are coloured by opponent club; hover for the full match breakdown."
            auto
          >
            <div className="h-[330px]">
              <PhilosophyQuadrant points={quadPoints} colorMap={clubColorMap} />
            </div>
          </ChartCard>
        </TabsContent>

        {/* ════════════════ PLAYER INSIGHTS ════════════════ */}
        <TabsContent value="player" className="space-y-4 mt-4">

          {/* 1 — Goals per Minute */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="xl:col-span-2">
              <ChartCard
                tall
                title={`${mpgSort === "mpg" ? "Minutes per Goal" : "Total Goals"}${mpgLastN ? " — Last 4 Games" : ""}`}
                description="Goals by opponent — click legend to include/exclude clubs"
                tooltip="Stacked by opponent. Each segment shows goals scored against that club. Click a club in the legend to remove them (e.g. filter out weaker opponents). Mins/goal recalculates based on visible clubs only."
                controls={
                  <div className="flex flex-wrap items-center gap-3">
                    <PillGroup
                      options={[
                        { value: "goals", label: "Total Goals" },
                        { value: "mpg",   label: "Mins / Goal" },
                      ]}
                      value={mpgSort}
                      onChange={v => setMpgSort(v as "goals" | "mpg")}
                    />
                    <button
                      onClick={() => setMpgLastN(v => !v)}
                      className={cn(
                        "px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                        mpgLastN
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      )}
                    >
                      Last 4 games
                    </button>
                  </div>
                }
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={goalsByOppChartData} margin={{ top: 10, right: 20, left: -20, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" {...AXIS_STYLE} angle={-35} textAnchor="end" interval={0} />
                    <YAxis {...AXIS_STYLE} allowDecimals={false} />
                    <Tooltip content={<MinsPerGoalTooltip hiddenOpponents={hiddenOpponents} />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                      onClick={(e) => toggleOpponent(e.value as string)}
                      formatter={(value) => (
                        <span style={{
                          color: hiddenOpponents.has(value) ? "hsl(var(--muted-foreground))" : undefined,
                          textDecoration: hiddenOpponents.has(value) ? "line-through" : undefined,
                          cursor: "pointer",
                        }}>
                          {value}
                        </span>
                      )}
                    />
                    {allOpponents.map(opp => (
                      <Bar
                        key={opp}
                        dataKey={opp}
                        name={opp}
                        stackId="goals"
                        fill={clubColorMap[opp] ?? "#888888"}
                        hide={hiddenOpponents.has(opp)}
                        radius={undefined}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>

          {/* 2 — Assists per Minute */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="xl:col-span-2">
              <ChartCard
                tall
                title={`${mpaSort === "mpg" ? "Minutes per Assist" : "Total Assists"}${mpaLastN ? " — Last 4 Games" : ""}`}
                description="Assists broken down by opponent club — click legend to include/exclude clubs"
                tooltip="Stacked by opponent club. Each bar segment = assists against that club. Toggle clubs off to filter out weaker opposition. Mins/assist uses total season minutes."
                controls={
                  <div className="flex flex-wrap items-center gap-3">
                    <PillGroup
                      options={[
                        { value: "total", label: "Total Assists" },
                        { value: "mpg",   label: "Mins / Assist" },
                      ]}
                      value={mpaSort}
                      onChange={v => setMpaSort(v as "total" | "mpg")}
                    />
                    <button
                      onClick={() => setMpaLastN(v => !v)}
                      className={cn(
                        "px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                        mpaLastN
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      )}
                    >
                      Last 4 games
                    </button>
                  </div>
                }
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={assistsChartData} margin={{ top: 10, right: 20, left: -20, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" {...AXIS_STYLE} angle={-35} textAnchor="end" interval={0} />
                    <YAxis {...AXIS_STYLE} allowDecimals={false} />
                    <Tooltip content={<AssistStackedTooltip hiddenOpponents={hiddenAssistOpponents} />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                      onClick={(e) => toggleAssistOpponent(e.value as string)}
                      formatter={(value) => (
                        <span style={{
                          color: hiddenAssistOpponents.has(value) ? "hsl(var(--muted-foreground))" : undefined,
                          textDecoration: hiddenAssistOpponents.has(value) ? "line-through" : undefined,
                          cursor: "pointer",
                        }}>
                          {value}
                        </span>
                      )}
                    />
                    {allAssistOpponents.map(opp => (
                      <Bar
                        key={opp}
                        dataKey={opp}
                        name={opp}
                        stackId="assists"
                        fill={clubColorMap[opp] ?? "#888888"}
                        hide={hiddenAssistOpponents.has(opp)}
                        radius={undefined}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>

          {/* 3 — Contributions per Minute */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="xl:col-span-2">
              <ChartCard
                tall
                title={`${contribSort === "mpg" ? "Minutes per Contribution" : "Goal Contributions"}${gcLastN ? " — Last 4 Games" : ""}`}
                description="Goals + assists broken down by opponent club — click legend to include/exclude clubs"
                tooltip="Stacked by opponent club. Each bar segment = goals + assists against that club. Toggle clubs off to filter out weaker opposition. Contributions are counted using the match roster, not scorerTeam."
                controls={
                  <div className="flex flex-wrap items-center gap-3">
                    <PillGroup
                      options={[
                        { value: "total", label: "Total G+A" },
                        { value: "mpg",   label: "Mins / Contribution" },
                      ]}
                      value={contribSort}
                      onChange={v => setContribSort(v as "total" | "mpg")}
                    />
                    <button
                      onClick={() => setGcLastN(v => !v)}
                      className={cn(
                        "px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                        gcLastN
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      )}
                    >
                      Last 4 games
                    </button>
                  </div>
                }
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={contribChartData} margin={{ top: 10, right: 20, left: -20, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" {...AXIS_STYLE} angle={-35} textAnchor="end" interval={0} />
                    <YAxis {...AXIS_STYLE} allowDecimals={false} />
                    <Tooltip content={<ContribTooltip hiddenOpponents={hiddenContribOpponents} />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                    <Legend
                      wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                      onClick={(e) => toggleContribOpponent(e.value as string)}
                      formatter={(value) => (
                        <span style={{
                          color: hiddenContribOpponents.has(value) ? "hsl(var(--muted-foreground))" : undefined,
                          textDecoration: hiddenContribOpponents.has(value) ? "line-through" : undefined,
                          cursor: "pointer",
                        }}>
                          {value}
                        </span>
                      )}
                    />
                    {allContribOpponents.map(opp => (
                      <Bar
                        key={opp}
                        dataKey={opp}
                        name={opp}
                        stackId="contrib"
                        fill={clubColorMap[opp] ?? "#888888"}
                        hide={hiddenContribOpponents.has(opp)}
                        radius={undefined}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>

          {/* Scoring DNA — one player's attacking profile as a radar (pick via dropdown) */}
          <PlayerDnaChart
            title={`Scoring DNA${dnaLastN ? " — Last 3 Rounds" : ""}`}
            label="Belconnen"
            srcFull={dnaFull} srcL3={dnaL3}
            lastN={dnaLastN} onLastN={() => setDnaLastN(v => !v)}
            colorMap={clubColorMap}
            players={(leaderboard ?? []).map(p => p.playerName)}
            player={dnaPlayer} onPlayer={setDnaPlayer}
            sn={sn}
          />

          {/* Combo Threat — our assist→scorer partnerships (who combines for goals) */}
          <ComboThreatChart
            title={`Combo Threat — Belconnen${comboLastN ? " — Last 3 Rounds" : ""}`}
            label="Belconnen"
            srcFull={goalCombosFull} srcL3={goalCombosL3}
            lastN={comboLastN} onLastN={() => setComboLastN(v => !v)}
            colorMap={clubColorMap} sn={sn} maxBars={12}
          />

          {/* 4 & 5 — Mins per Goal Conceded + On-Field Impact */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {defensiveData.length > 0 && (
            <ChartCard title="Mins per Goal Conceded — Defenders & GK" description="Higher is better — defensive players only" tooltip="Minutes played per goal conceded across games the player appeared in. Higher means better defensive involvement.">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={defensiveData} margin={{ top: 10, right: 10, left: -20, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" {...AXIS_STYLE} angle={-35} textAnchor="end" interval={0} />
                  <YAxis {...AXIS_STYLE} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v: number) => [`${v} mins`, "Mins / Goal Conceded"]} />
                  <Bar dataKey="value" name="Mins / Goal Conceded" radius={[4, 4, 0, 0]}>
                    {defensiveData.map((_, i) => <Cell key={i} fill={i === 0 ? C3 : C1} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
            <ChartCard
              title={`On-Field Impact — ${effMetric === "per90" ? "Per 90" : "Season Total"}`}
              description={`Team goal difference while player is on the pitch · ${effMetric === "per90" ? "per 90 mins" : "season total"}`}
              tooltip="Plus/minus: team goals scored minus team goals conceded in every match the player appeared in. Higher is better. Switch between raw season total and per-90 to normalise for playing time."
              controls={
                <div className="flex flex-wrap gap-2">
                  <PillGroup
                    options={[
                      { value: "per90", label: "Per 90" },
                      { value: "total", label: "Season Total" },
                    ]}
                    value={effMetric}
                    onChange={v => setEffMetric(v as "per90" | "total")}
                  />
                  <PillGroup
                    options={[
                      { value: "0",   label: "All" },
                      { value: "90",  label: "90+ mins" },
                      { value: "150", label: "150+ mins" },
                      { value: "180", label: "180+ mins" },
                    ]}
                    value={String(effMinMins)}
                    onChange={v => setEffMinMins(Number(v) as 0 | 90 | 150 | 180)}
                  />
                </div>
              }
              footer={
                <div className="flex gap-3 text-[10px] text-muted-foreground justify-center">
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: C3 }} />Positive GD</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: C4 }} />Negative GD</span>
                </div>
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={effectivenessData} margin={{ top: 10, right: 10, left: -20, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" {...AXIS_STYLE} angle={-35} textAnchor="end" interval={0} />
                  <YAxis {...AXIS_STYLE} tickFormatter={(v: number) => effMetric === "per90" ? v.toFixed(1) : String(v)} />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeWidth={1} />
                  <Tooltip content={<EffectivenessTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                  <Bar dataKey="value" name="GD" radius={[4, 4, 0, 0]}>
                    {effectivenessData.map((d, i) => (
                      <Cell key={i} fill={d.gd > 0 ? C3 : d.gd < 0 ? C4 : C1} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* 6 & 7 — Starts & Appearances + Total Minutes Played */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard
              title="Starts & Appearances"
              description={tlPlayer ? "Click any dot for match details" : "Blue = starts, amber = bench appearances — click a player for their game-by-game record"}
              tooltip="Shows squad involvement across the season. Sort by total appearances or starts, highest to lowest. Click a player's bar to see their game-by-game record."
              controls={tlPlayer ? undefined : (
                <PillGroup
                  options={[
                    { value: "appearances", label: "By Appearances" },
                    { value: "starts",      label: "By Starts" },
                  ]}
                  value={startsSort}
                  onChange={v => setStartsSort(v as "appearances" | "starts")}
                />
              )}
            >
              {tlPlayer ? (
                <PlayerTimelineChart seasonId={sId} club="Belconnen" player={tlPlayer} onBack={() => setTlPlayer(null)} />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={startsData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 30 }}
                    onClick={s => { const p = (s as { activePayload?: Array<{ payload?: { fullName?: string } }> } | null)?.activePayload?.[0]?.payload; if (p?.fullName) setTlPlayer(p.fullName); }}
                    style={{ cursor: "pointer" }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="name" {...AXIS_STYLE} angle={-35} textAnchor="end" interval={0} />
                    <YAxis {...AXIS_STYLE} allowDecimals={false} />
                    <Tooltip content={<StartsTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="starts" name="Starts" stackId="a" fill={C1} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="bench"  name="Bench"  stackId="a" fill={C2} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
            <ChartCard title="Total Minutes Played" description="Season total — dashed line = squad average" tooltip="All minutes played across the season. Includes sub appearances.">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={minutesData} margin={{ top: 10, right: 10, left: -20, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="name" {...AXIS_STYLE} angle={-35} textAnchor="end" interval={0} />
                  <YAxis {...AXIS_STYLE} />
                  <Tooltip content={<MinutesTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                  <ReferenceLine y={avgMins} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" label={{ value: `Avg ${avgMins}`, position: "insideTopRight", fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                  <Bar dataKey="value" name="Minutes" fill={C5} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* Full Leaderboard Table */}
          <Card>
            <CardHeader>
              <CardTitle>Full Squad Leaderboard</CardTitle>
              <CardDescription>All players sorted by goals · assists · minutes</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead>Pos</TableHead>
                    <TableHead className="text-right">Apps</TableHead>
                    <TableHead className="text-right">Starts</TableHead>
                    <TableHead className="text-right">Mins</TableHead>
                    <TableHead className="text-right font-bold text-chart-1">G</TableHead>
                    <TableHead className="text-right">A</TableHead>
                    <TableHead className="text-right text-muted-foreground">Mins/G</TableHead>
                    <TableHead className="text-right text-muted-foreground">Mins/A</TableHead>
                    <TableHead className="text-right text-yellow-400">Y</TableHead>
                    <TableHead className="text-right text-red-500">R</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboard?.map(p => (
                    <TableRow key={p.playerId}>
                      <TableCell className="font-medium">{p.playerName}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{p.position ?? "—"}</TableCell>
                      <TableCell className="text-right">{p.appearances}</TableCell>
                      <TableCell className="text-right">{p.starts}</TableCell>
                      <TableCell className="text-right">{p.minsPlayed}</TableCell>
                      <TableCell className="text-right font-bold text-chart-1">{p.goals}</TableCell>
                      <TableCell className="text-right">{p.assists}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{p.minsPerGoal ? Math.round(p.minsPerGoal) : "—"}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{p.minsPerAssist ? Math.round(p.minsPerAssist) : "—"}</TableCell>
                      <TableCell className="text-right text-yellow-400">{p.yellowCards || "—"}</TableCell>
                      <TableCell className="text-right text-red-500">{p.redCards || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ════════════════ OPPONENT INSIGHTS ════════════════ */}
        <TabsContent value="opponent" className="mt-4 space-y-4">

          {/* Club selector — always offers league-wide + Belconnen, even if no opponent clubs load */}
          {oppClubsLoading ? (
            <p className="text-muted-foreground text-sm">Loading clubs…</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                key="__ALL__"
                onClick={() => setSelectedClub("__ALL__")}
                className={cn(
                  "px-4 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-2",
                  selectedClub === "__ALL__"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                )}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-gradient-to-r from-primary to-accent" />
                All (league-wide)
              </button>
              {["Belconnen", ...(oppClubs ?? [])].map(club => (
                <button
                  key={club}
                  onClick={() => setSelectedClub(club)}
                  className={cn(
                    "px-4 py-1.5 rounded-full text-sm font-medium border transition-colors flex items-center gap-2",
                    selectedClub === club
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                  )}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: clubColorMap[club] ?? "#888888" }} />
                  {club}
                </button>
              ))}
            </div>
          )}

          {/* Team / Players sub-view — mirrors the main Team/Player split for easier navigation */}
          <Tabs value={oppView} onValueChange={v => setOppView(v as "team" | "player")}>
            <TabsList>
              <TabsTrigger value="team">Team Charts</TabsTrigger>
              <TabsTrigger value="player">Player Charts</TabsTrigger>
            </TabsList>
          </Tabs>

          {selectedClub && profile && (
            <>
              {oppView === "team" && (
              <>
              {isAll ? (
                <p className="text-sm text-muted-foreground">
                  League-wide view across all <span className="font-medium text-foreground">{profile.record.played}</span> league matches this season. Charts show every goal in the league, stacked by the club that scored or conceded. The record summary and match-history views are club-specific, so they are hidden here.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Scouting <span className="font-medium text-foreground">{selectedClub}</span> across <span className="font-medium text-foreground">all {profile.record.played}</span> of their league games this season. Chart segments show which opponent they scored against or conceded to.
                </p>
              )}

              {/* Club record summary */}
              {!isAll && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <StatCard title="League Position" value={profile.record.position ? `#${profile.record.position}` : "—"} subtitle={`${profile.record.points} pts`} />
                <StatCard title="Played" value={profile.record.played} subtitle={`${profile.record.won}W · ${profile.record.drawn}D · ${profile.record.lost}L`} />
                <StatCard
                  title="Goals For"
                  value={profile.record.goalsFor}
                  subtitle={profile.record.played ? `${(profile.record.goalsFor / profile.record.played).toFixed(1)} per game` : undefined}
                />
                <StatCard
                  title="Goals Against"
                  value={profile.record.goalsAgainst}
                  subtitle={profile.record.played ? `${(profile.record.goalsAgainst / profile.record.played).toFixed(1)} per game` : undefined}
                />
                <StatCard title="Goal Diff" value={profile.record.goalDiff > 0 ? `+${profile.record.goalDiff}` : profile.record.goalDiff} />
                <StatCard title="Win Rate" value={profile.record.played ? `${Math.round((profile.record.won / profile.record.played) * 100)}%` : "—"} />
              </div>
              )}

              {/* Match History table (all their fixtures) — club-relative, hidden league-wide */}
              {!isAll && profile.matches.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{selectedClub} — Season Results</CardTitle>
                    <CardDescription>Every league fixture, with our team highlighted where applicable</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Opponent</TableHead>
                          <TableHead className="text-center">H/A</TableHead>
                          <TableHead className="text-center">Result</TableHead>
                          <TableHead className="text-center">Score</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {profile.matches.map(m => {
                          const color = m.result === "W" ? "text-[hsl(var(--chart-3))]" : m.result === "L" ? "text-[hsl(var(--chart-4))]" : "text-muted-foreground";
                          return (
                            <TableRow key={m.matchId}>
                              <TableCell className="text-muted-foreground">{m.matchDate ?? "—"}</TableCell>
                              <TableCell className="font-medium flex items-center gap-2">
                                <span className="inline-block h-2 w-2 rounded-full" style={{ background: clubColorMap[m.opponent] ?? "#888888" }} />
                                {m.opponent}
                              </TableCell>
                              <TableCell className="text-center text-muted-foreground">{m.homeAway}</TableCell>
                              <TableCell className={cn("text-center font-bold", color)}>{m.result}</TableCell>
                              <TableCell className="text-center font-medium">{m.scored} – {m.conceded}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* 2. Coach behaviour — in-game management (Belconnen only) */}
              {selectedClub === "Belconnen" && (
                <ChartCard
                  title="Coach Behaviour — In-Game Management"
                  description="Every match plotted by possession (x) vs a control-and-dominance composite (y)"
                  tooltip="Belconnen only. x = Possession % (midline 50). y = Quadrant Points = 4·GoalsScored + Shots + Passes/10 − 4·GoalsConceded − OppShots − OppPasses/10. Top-right = controlled the game and it paid off. This tactical data is recorded for Belconnen matches only."
                  auto
                >
                  <div className="h-[330px]">
                    <PhilosophyQuadrant points={quadPoints} colorMap={clubColorMap} />
                  </div>
                </ChartCard>
              )}

              {/* 2b. Coach behaviour — first-substitution patterns (any club; club-relative so hidden league-wide) */}
              {!isAll && <FirstSubCard data={firstSub} club={selectedClub} />}

              {/* 3. Goals scored by interval */}
              <OpponentStackChart
                title={`${isAll ? "Goals Scored by Interval — by scoring club" : `When ${selectedClub} Score`}${l3ProfScInt ? " — Last 3 Rounds" : ""}`}
                description="Goals they scored, by 15-minute interval · stacked by opponent"
                tooltip="Every goal this club scored across all their games, bucketed into 15-minute periods. Each segment shows which opponent they scored against. Click a legend item to hide that opponent."
                data={scoredIntervalData}
                opponents={profileOpponents}
                colorMap={clubColorMap}
                hidden={hiddenProfileOpponents}
                onToggle={toggleProfileOpponent}
                controls={<Last3Toggle active={l3ProfScInt} onToggle={() => setL3ProfScInt(v => !v)} />}
              />

              {/* 4. Goals scored by type */}
              <OpponentStackChart
                title={`${isAll ? "Goals Scored by Type — by scoring club" : `How ${selectedClub} Score`}${l3ProfScType ? " — Last 3 Rounds" : ""}`}
                description="Goals they scored, by goal type · stacked by opponent"
                tooltip="Goal-type breakdown of goals this club scored. R = run-of-play. FT = first-time, MT = multi-touch, BT = break-through. AT = across-target, DT = direct. SP = set piece: C = corner, F = free kick, P = penalty."
                data={scoredTypeData}
                opponents={profileOpponents}
                colorMap={clubColorMap}
                hidden={hiddenProfileOpponents}
                onToggle={toggleProfileOpponent}
                angledLabels
                controls={<Last3Toggle active={l3ProfScType} onToggle={() => setL3ProfScType(v => !v)} />}
              />

              {/* 5. Goals scored by type — open-play regains vs set pieces (pies) */}
              <div className="space-y-3">
                <div className="flex items-center justify-end gap-2">
                  <span className="text-xs text-muted-foreground">{isAll ? "Scoring club" : "Scored against"}</span>
                  <Select value={scPieOpp} onValueChange={setScPieOpp}>
                    <SelectTrigger className="w-[190px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all">{isAll ? "All clubs" : "All opponents"}</SelectItem>
                      {profileOpponents.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <GoalTypePie title={isAll ? "Regain Types — League Scored" : `Regain Types — ${selectedClub} Scored`} segments={buildPieSegments(profileScoredPie, "regain")} colorMap={REGAIN_COLORS} grandTotal={profileScoredPie.length} groupMode="third" />
                  <GoalTypePie title={isAll ? "Set Piece Types — League Scored" : `Set Piece Types — ${selectedClub} Scored`} segments={buildPieSegments(profileScoredPie, "setpiece")} colorMap={SETPIECE_COLORS} grandTotal={profileScoredPie.length} groupMode="setpiece" />
                </div>
              </div>

              {/* 6. Goal scored detail by type */}
              <OpponentStackChart
                title={isAll ? "Goal Scored Detail — by scoring club" : `${selectedClub} — Goal Detail (Scored)`}
                description="Their goals broken down by assist, buildup, finish, or penetration — stacked by opponent"
                tooltip="Goals this club scored across the selected detail dimension, split by opponent. Hover a bar for the individual goals. Click a club below to include/exclude it."
                data={profileScDetData}
                opponents={profileOpponents}
                colorMap={clubColorMap}
                hidden={hiddenProfileOpponents}
                onToggle={toggleProfileOpponent}
                angledLabels
                controls={
                  <Select value={profileScDetDim} onValueChange={v => setProfileScDetDim(v as GoalDetailDim)}>
                    <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="assist">Assist Type</SelectItem>
                      <SelectItem value="buildup">Buildup Lane</SelectItem>
                      <SelectItem value="finish">Finish Type</SelectItem>
                      <SelectItem value="penetration">How Penetrated</SelectItem>
                      <SelectItem value="firsttime">First-time Finish</SelectItem>
                    </SelectContent>
                  </Select>
                }
                tooltipContent={<GoalDetailStackTooltip goals={profileScDetGoals} dim={profileScDetDim} hidden={hiddenProfileOpponents} shortName={{}} />}
              />

              {/* 7–14: conceded + tactical detail — club-specific, hidden under the league-wide ALL view */}
              {!isAll && (
                <>
                  {/* 7. Goals conceded by interval */}
                  <OpponentStackChart
                    title={`When ${selectedClub} Concede${l3ProfGcInt ? " — Last 3 Rounds" : ""}`}
                    description="Goals they conceded, by 15-minute interval · stacked by opponent"
                    tooltip="Every goal this club conceded across all their games, bucketed into 15-minute periods. Each segment shows which opponent scored against them."
                    data={concededIntervalData}
                    opponents={profileOpponents}
                    colorMap={clubColorMap}
                    hidden={hiddenProfileOpponents}
                    onToggle={toggleProfileOpponent}
                    controls={<Last3Toggle active={l3ProfGcInt} onToggle={() => setL3ProfGcInt(v => !v)} />}
                  />

                  {/* 8. Goals conceded by type */}
                  <OpponentStackChart
                    title={`How ${selectedClub} Concede${l3ProfGcType ? " — Last 3 Rounds" : ""}`}
                    description="Goals they conceded, by goal type · stacked by opponent"
                    tooltip="Goal-type breakdown of goals this club conceded. R = run-of-play. FT = first-time, MT = multi-touch, BT = break-through. AT = across-target, DT = direct. SP = set piece: C = corner, F = free kick, P = penalty."
                    data={concededTypeData}
                    opponents={profileOpponents}
                    colorMap={clubColorMap}
                    hidden={hiddenProfileOpponents}
                    onToggle={toggleProfileOpponent}
                    angledLabels
                    controls={<Last3Toggle active={l3ProfGcType} onToggle={() => setL3ProfGcType(v => !v)} />}
                  />

                  {/* 9. Goals conceded by type — pies */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-xs text-muted-foreground">Conceded against</span>
                      <Select value={gcPieOpp} onValueChange={setGcPieOpp}>
                        <SelectTrigger className="w-[190px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all">All opponents</SelectItem>
                          {profileOpponents.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <GoalTypePie title={`Regain Types — ${selectedClub} Conceded`} segments={buildPieSegments(profileConcededPie, "regain")} colorMap={REGAIN_COLORS} grandTotal={profileConcededPie.length} groupMode="third" />
                      <GoalTypePie title={`Set Piece Types — ${selectedClub} Conceded`} segments={buildPieSegments(profileConcededPie, "setpiece")} colorMap={SETPIECE_COLORS} grandTotal={profileConcededPie.length} groupMode="setpiece" />
                    </div>
                  </div>

                  {/* 10. Goal conceded detail by type */}
                  <OpponentStackChart
                    title={`${selectedClub} — Goal Detail (Conceded)`}
                    description="Goals against broken down by assist, buildup, finish, or penetration — stacked by opponent"
                    tooltip="Goals this club conceded across the selected detail dimension, split by opponent. Hover a bar for the individual goals. Click a club below to include/exclude it."
                    data={profileGcDetData}
                    opponents={profileOpponents}
                    colorMap={clubColorMap}
                    hidden={hiddenProfileOpponents}
                    onToggle={toggleProfileOpponent}
                    angledLabels
                    controls={
                      <Select value={profileGcDetDim} onValueChange={v => setProfileGcDetDim(v as GoalDetailDim)}>
                        <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="assist">Assist Type</SelectItem>
                          <SelectItem value="buildup">Buildup Lane</SelectItem>
                          <SelectItem value="finish">Finish Type</SelectItem>
                          <SelectItem value="penetration">How Penetrated</SelectItem>
                          <SelectItem value="firsttime">First-time Finish</SelectItem>
                        </SelectContent>
                      </Select>
                    }
                    tooltipContent={<GoalDetailStackTooltip goals={profileGcDetGoals} dim={profileGcDetDim} hidden={hiddenProfileOpponents} shortName={{}} />}
                  />

                  {/* 11 & 12. 5-minute response after goals + opponent breakdown */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <ChartCard
                      title="5-Minute Response After Goals"
                      description={`What ${selectedClub} do in the 5 minutes after a goal`}
                      tooltip="For every goal in their matches, we look at the next 5 minutes. After they score: do they score again, concede, or nothing? After they concede: do they respond, concede again, or nothing?"
                      footer={<KeyLegend keys={["We scored", "We conceded", "No goal"]} colorFn={RESPONSE_COLORS} />}
                    >
                      <StackBars rows={responseData(profileTimelines)} keys={["We scored", "We conceded", "No goal"]} colorFn={RESPONSE_COLORS} showPct />
                    </ChartCard>
                    <OpponentStackChart
                      title="5-Minute Response — Opponent Breakdown"
                      description="Quick-fire swings (a goal within 5 min of a goal), split by situation & response — stacked by opponent"
                      tooltip="Each 5-minute response event, grouped by what happened, stacked by the opponent in that match. Click a club to include/exclude it."
                      data={profileResponseByOpp.rows}
                      opponents={profileResponseByOpp.opponents}
                      colorMap={clubColorMap}
                      hidden={hiddenProfileOpponents}
                      onToggle={toggleProfileOpponent}
                      angledLabels
                      tooltipContent={<ProfileStackTooltip showPct labelMap={RESPONSE_SIT_LABELS} />}
                    />
                  </div>

                  {/* 13. Goal location map */}
                  <ChartCard
                    title="Goal Location Map"
                    auto
                    description="Where goals were finished — blue = they scored, red = they conceded (hover a point for detail)"
                    tooltip="Every goal with mapped pitch coordinates, on a vertical attacking third (goal at top). Filter by club or goal type."
                  >
                    <GoalLocationMap scored={profileScored} conceded={profileConceded} />
                  </ChartCard>

                  {/* 14. First goal value */}
                  <ChartCard
                    title="First Goal Value Index"
                    description="Match outcomes split by who scored first — result breakdown stacked by opponent"
                    tooltip="Splits each of their matches by who scored the opening goal (SF = they scored first, CF = they conceded first), then by the final result (W/D/L). Bars are stacked by opponent; hover for detail."
                    tall
                  >
                    <FirstGoalIndex matches={profileFgMatches} colorMap={clubColorMap} hidden={hiddenProfileOpponents} onToggle={toggleProfileOpponent} />
                  </ChartCard>
                </>
              )}
              </>
              )}

              {oppView === "player" && (
              <>
              {/* 15. Goals by opponent — stacked, clickable legend, Last 3 rounds, Total / Mins-per */}
              <OppPlayerStackChart
                metric="goals"
                clubLabel={isAll ? "League" : selectedClub}
                srcFull={oppPlayersFull} srcL3={oppPlayersL3}
                lastN={oppGoalL3} onLastN={() => setOppGoalL3(v => !v)}
                sort={oppGoalSort} onSort={setOppGoalSort}
                hidden={hiddenOppGoalOpp} onToggle={toggleOppGoalOpp}
                colorMap={clubColorMap} sn={sn} maxBars={isAll ? 20 : undefined}
              />

              {/* 16. Assists by opponent */}
              <OppPlayerStackChart
                metric="assists"
                clubLabel={isAll ? "League" : selectedClub}
                srcFull={oppPlayersFull} srcL3={oppPlayersL3}
                lastN={oppAssistL3} onLastN={() => setOppAssistL3(v => !v)}
                sort={oppAssistSort} onSort={setOppAssistSort}
                hidden={hiddenOppAssistOpp} onToggle={toggleOppAssistOpp}
                colorMap={clubColorMap} sn={sn} maxBars={isAll ? 20 : undefined}
              />

              {/* 17. Contributions (G + A) by opponent */}
              <OppPlayerStackChart
                metric="contrib"
                clubLabel={isAll ? "League" : selectedClub}
                srcFull={oppPlayersFull} srcL3={oppPlayersL3}
                lastN={oppContribL3} onLastN={() => setOppContribL3(v => !v)}
                sort={oppContribSort} onSort={setOppContribSort}
                hidden={hiddenOppContribOpp} onToggle={toggleOppContribOpp}
                colorMap={clubColorMap} sn={sn} maxBars={isAll ? 20 : undefined}
              />

              {/* 17c. Scoring DNA — one of the club's players (whole-league data) */}
              <PlayerDnaChart
                title={`Scoring DNA — ${isAll ? "League" : selectedClub}${oppDnaLastN ? " — Last 3 Rounds" : ""}`}
                label={isAll ? "" : selectedClub}
                srcFull={oppDnaFull} srcL3={oppDnaL3}
                lastN={oppDnaLastN} onLastN={() => setOppDnaLastN(v => !v)}
                colorMap={clubColorMap}
                players={oppDnaPlayers}
                player={oppDnaPlayer} onPlayer={setOppDnaPlayer}
                sn={sn}
              />

              {/* 17b. Combo Threat — the club's assist→scorer partnerships */}
              <ComboThreatChart
                title={`Combo Threat — ${isAll ? "League" : selectedClub}${oppComboLastN ? " — Last 3 Rounds" : ""}`}
                label={isAll ? "" : selectedClub}
                srcFull={oppCombosFull} srcL3={oppCombosL3}
                lastN={oppComboLastN} onLastN={() => setOppComboLastN(v => !v)}
                colorMap={clubColorMap} sn={sn} maxBars={isAll ? 15 : 12}
              />

              {/* 18. Starts & appearances (hidden league-wide) */}
              {!isAll && (
                <PlayerBarCard
                  title={`${selectedClub} — Starts & Appearances${oppStartsL3 ? " — Last 3 Rounds" : ""}`}
                  description="Appearances split into starts and off-the-bench"
                  tooltip="Each player's appearances, split into starts (darker) and substitute appearances (lighter). Sorted by total appearances."
                  data={oppStartsAppsData(oppStartsL3 ? oppPlayersL3 : oppPlayersFull)}
                  color="#3b82f6"
                  valueLabel="Appearances"
                  variant="startsApps"
                  controls={<Last3Toggle active={oppStartsL3} onToggle={() => setOppStartsL3(v => !v)} />}
                  timeline={{ seasonId: sId, club: selectedClub }}
                />
              )}

              {/* 19. Total minutes played */}
              <PlayerBarCard
                title={`${isAll ? "League" : selectedClub} — Total Minutes${oppMinsL3 ? " — Last 3 Rounds" : ""}`}
                description={`Total minutes played${oppMinsL3 ? " over the last 3 rounds" : " this season"} (top 15)`}
                tooltip="Total minutes played across their league season, top 15 by minutes."
                data={oppMinutesData(oppMinsL3 ? oppPlayersL3 : oppPlayersFull)}
                color="#0ea5e9"
                valueLabel="Minutes"
                controls={<Last3Toggle active={oppMinsL3} onToggle={() => setOppMinsL3(v => !v)} />}
              />

              {/* Top scorers */}
              {profile.topScorers.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{isAll ? "League Top Scorers" : `${selectedClub} — Top Scorers`}</CardTitle>
                    <CardDescription>{isAll ? "Every goalscorer across the whole league this season" : "Goalscorers across all their league games this season"}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12 text-center">#</TableHead>
                          <TableHead>Player</TableHead>
                          <TableHead className="text-right">Goals</TableHead>
                          <TableHead className="text-right">Share</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {profile.topScorers.map((s, i) => (
                          <TableRow key={s.scorer}>
                            <TableCell className="text-center text-muted-foreground">{i + 1}</TableCell>
                            <TableCell className="font-medium">{s.scorer}</TableCell>
                            <TableCell className="text-right font-semibold">{s.goals}</TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {profile.record.goalsFor ? `${Math.round((s.goals / profile.record.goalsFor) * 100)}%` : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
              </>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────
// ─── Coach behaviour: first-substitution patterns ──────────────────────────────
// Ported from the original Dash app's Coach Behaviour summary. Shows when a
// club's coach makes the first change, whether they have a favoured first sub,
// what happens in the 15 minutes after it, and how state-at-sub maps to results.
function FirstSubCard({ data, club }: { data?: FirstSubResponse; club: string }) {
  // "When it counts": first subs at 45′ are usually half-time changes in games
  // already decided, and anything earlier is usually an injury — so the default
  // view only counts first changes made AFTER half-time. Excluded matches stay
  // on the timeline (faded) so the blowout/injury pattern is still visible.
  const [whenItCounts, setWhenItCounts] = useState(true);
  if (!data) return null;

  const resColor = (r: string) =>
    r === "W" ? "hsl(var(--chart-3))" : r === "L" ? "hsl(var(--chart-4))" : "hsl(var(--muted-foreground))";

  const isCompetitive = (minute: number) => minute > 45;
  const included = whenItCounts ? data.entries.filter(e => isCompetitive(e.minute)) : data.entries;

  // All summary stats recomputed from the included set (entries carry everything needed).
  const avgMinute = included.length ? included.reduce((s, e) => s + e.minute, 0) / included.length : null;
  const counts = new Map<string, number>();
  for (const e of included) counts.set(e.player, (counts.get(e.player) ?? 0) + 1);
  const [prefPlayer, prefCount] = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [null, 0];
  const byState = (["Winning", "Drawing", "Losing"] as const)
    .map(state => {
      const rows = included.filter(e => e.gameState === state);
      if (!rows.length) return null;
      return {
        state,
        matches: rows.length,
        avgMinute: rows.reduce((s, e) => s + e.minute, 0) / rows.length,
        goalsFor: rows.reduce((s, e) => s + e.goalsFor15, 0),
        goalsAgainst: rows.reduce((s, e) => s + e.goalsAgainst15, 0),
        noGoal: rows.filter(e => e.goalsFor15 === 0 && e.goalsAgainst15 === 0).length,
        wins: rows.filter(e => e.result === "W").length,
        draws: rows.filter(e => e.result === "D").length,
        losses: rows.filter(e => e.result === "L").length,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s != null);

  // Stack dots that share the same minute so none are hidden.
  const seen = new Map<number, number>();
  const dots = data.entries.map(e => {
    const n = seen.get(e.minute) ?? 0;
    seen.set(e.minute, n + 1);
    return { ...e, stack: n, excluded: whenItCounts && !isCompetitive(e.minute) };
  });

  return (
    <ChartCard
      title={`Coach Behaviour — First Substitution`}
      description={`When ${club}'s coach makes the first change, and what happens next`}
      tooltip="Sub minutes are inferred as 90 − minutes played for players who came off the bench; the earliest sub in each match is 'the first change'. Game state = the scoreline just before that minute. Impact window = the 15 minutes after it. Dot colour = the final result of that match. 'When it counts' excludes first subs at 45′ or earlier — usually half-time changes in decided games, or injuries — so the stats reflect genuine in-game decisions."
      controls={
        <button
          onClick={() => setWhenItCounts(v => !v)}
          className={cn(
            "px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
            whenItCounts
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
          )}
        >
          When it counts (46′+)
        </button>
      }
      auto
    >
      {data.matchesTracked === 0 ? (
        <p className="text-sm text-muted-foreground">No substitution data available for {club} yet.</p>
      ) : included.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every first change {club} made came at 45′ or earlier — no competitive-phase substitutions to analyse yet. Toggle off "When it counts" to see them all.
        </p>
      ) : (
        <div className="space-y-5">
          {/* Headline numbers */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-2xl font-bold">{avgMinute != null ? `${Math.round(avgMinute)}′` : "—"}</p>
              <p className="text-xs text-muted-foreground">Avg first sub</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{data.subsPerMatch != null ? data.subsPerMatch.toFixed(1) : "—"}</p>
              <p className="text-xs text-muted-foreground">Subs per match</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{included.length}</p>
              <p className="text-xs text-muted-foreground">
                {included.length < data.matchesTracked ? `Matches counted (of ${data.matchesTracked})` : "Matches tracked"}
              </p>
            </div>
          </div>

          {/* Timeline of first-sub minutes */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">
              First-sub minute in each match — dot colour shows the final result
              (<span style={{ color: "hsl(var(--chart-3))" }}>W</span> · <span className="text-muted-foreground">D</span> · <span style={{ color: "hsl(var(--chart-4))" }}>L</span>). Hover a dot for detail.
            </p>
            <div className="relative h-16 mt-4">
              <div className="absolute left-0 right-0 h-px bg-border" style={{ top: "60%" }} />
              {[0, 15, 30, 45, 60, 75, 90].map(t => (
                <React.Fragment key={t}>
                  <div className="absolute w-px h-2 bg-border" style={{ left: `${(t / 90) * 100}%`, top: "60%" }} />
                  <span className="absolute text-[10px] text-muted-foreground" style={{ left: `${(t / 90) * 100}%`, top: "78%", transform: "translateX(-50%)" }}>{t}′</span>
                </React.Fragment>
              ))}
              {avgMinute != null && (
                <div
                  className="absolute w-px bg-foreground/40"
                  style={{ left: `${(Math.min(avgMinute, 90) / 90) * 100}%`, top: "10%", height: "50%" }}
                  title={`Average first sub: ${Math.round(avgMinute)}′`}
                />
              )}
              {dots.map(e => (
                <div
                  key={e.matchId}
                  title={`${e.matchDate ?? ""} vs ${e.opponent}: ${e.player} on at ${e.minute}′ while ${e.gameState.toLowerCase()} → next 15′: ${e.goalsFor15} for / ${e.goalsAgainst15} against · final result ${e.result}${e.excluded ? " · excluded (45′ or earlier)" : ""}`}
                  className="absolute h-3 w-3 rounded-full border border-background cursor-default"
                  style={{
                    left: `${(Math.min(e.minute, 90) / 90) * 100}%`,
                    top: `calc(60% - ${e.stack * 10}px)`,
                    transform: "translate(-50%, -50%)",
                    background: resColor(e.result),
                    opacity: e.excluded ? 0.25 : 1,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Preferred first substitute */}
          <p className="text-sm">
            {prefPlayer && prefCount >= 3 ? (
              <>Favoured first change: <span className="font-semibold">{prefPlayer}</span> ({prefCount}×) — a trusted impact option.</>
            ) : (
              <span className="text-muted-foreground">No favoured impact player — the first change varies with the game context.</span>
            )}
          </p>

          {/* Game state at first sub → impact + results */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State at first sub</TableHead>
                <TableHead className="text-center">Matches</TableHead>
                <TableHead className="text-center">Avg minute</TableHead>
                <TableHead className="text-center">Next 15′ (for / against / quiet)</TableHead>
                <TableHead className="text-center">Final results</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byState.map(s => (
                <TableRow key={s.state}>
                  <TableCell className="font-medium">{s.state}</TableCell>
                  <TableCell className="text-center">{s.matches}</TableCell>
                  <TableCell className="text-center">{Math.round(s.avgMinute)}′</TableCell>
                  <TableCell className="text-center">
                    <span className="text-[hsl(var(--chart-3))] font-medium">{s.goalsFor}</span>
                    <span className="text-muted-foreground"> / </span>
                    <span className="text-[hsl(var(--chart-4))] font-medium">{s.goalsAgainst}</span>
                    <span className="text-muted-foreground"> / {s.noGoal}</span>
                  </TableCell>
                  <TableCell className="text-center font-medium">
                    {s.wins}W · {s.draws}D · {s.losses}L
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ChartCard>
  );
}

function StatCard({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-3xl font-bold">{value}</span>
        </div>
        {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Combo Threat: assist→scorer partnerships (shared by Team + Opponent tabs) ──

interface ComboSrc {
  combos: { assister: string; scorer: string; count: number }[];
  totalGoals: number;
  assistedGoals: number;
}

function ComboTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: { assister: string; scorer: string; count: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[190px] space-y-2">
      <div className="font-semibold text-sm leading-tight">
        {d.assister} <span className="text-muted-foreground">→</span> {d.scorer}
      </div>
      <div className="flex justify-between gap-6 border-t pt-2">
        <span className="text-muted-foreground">Goals combined</span>
        <span className="font-medium tabular-nums">{d.count}</span>
      </div>
    </div>
  );
}

function ComboThreatChart({
  title, label, srcFull, srcL3, lastN, onLastN, colorMap, sn, maxBars,
}: {
  title: string;
  label: string;
  srcFull?: ComboSrc; srcL3?: ComboSrc;
  lastN: boolean; onLastN: () => void;
  colorMap: Record<string, string>; sn: Record<string, string>;
  maxBars?: number;
}) {
  const src = lastN ? srcL3 : srcFull;

  const data = useMemo(() => {
    const rows = (src?.combos ?? []).map(c => ({
      pair: `${sn[c.assister] ?? c.assister} → ${sn[c.scorer] ?? c.scorer}`,
      assister: c.assister, scorer: c.scorer, count: c.count,
    }));
    return maxBars ? rows.slice(0, maxBars) : rows;
  }, [src, sn, maxBars]);

  const fill = colorMap[label] ?? "hsl(var(--primary))";
  const total = src?.totalGoals ?? 0;
  const assisted = src?.assistedGoals ?? 0;
  const pct = total > 0 ? Math.round((assisted / total) * 100) : 0;

  return (
    <ChartCard
      tall
      title={title}
      description="Assist → scorer partnerships, ranked by goals combined for"
      tooltip={`Each bar is a partnership — the assister set up the scorer this many times. Only assisted goals count (own goals and unassisted goals are excluded). ${assisted} of ${total} goals (${pct}%) came from a recorded partnership.`}
      controls={<Last3Toggle active={lastN} onToggle={onLastN} />}
    >
      {data.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No assisted goals recorded for this selection.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" {...AXIS_STYLE} allowDecimals={false} />
            <YAxis type="category" dataKey="pair" {...AXIS_STYLE} width={150} interval={0} />
            <Tooltip content={<ComboTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
            <Bar dataKey="count" name="Goals combined" fill={fill} radius={[0, 4, 4, 0]}>
              <LabelList dataKey="count" position="right" fontSize={11} fill="hsl(var(--foreground))" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

// ─── Player Scoring DNA (radar) ────────────────────────────────────────────────
type DnaMetricKey = keyof PlayerDnaResponse["metrics"];
type DnaAxisKind = "goals" | "goalsPer90" | "assists" | "assistsPer90" | "firstTouch" | "poacher" | "foot";
const DNA_AXES: { key: DnaMetricKey; label: string; kind: DnaAxisKind }[] = [
  { key: "goals",         label: "Goals",       kind: "goals" },
  { key: "goalsPer90",    label: "Goals /90",   kind: "goalsPer90" },
  { key: "assists",       label: "Assists",     kind: "assists" },
  { key: "assistsPer90",  label: "Assists /90", kind: "assistsPer90" },
  { key: "firstTouchPct", label: "1st-touch %", kind: "firstTouch" },
  { key: "poacherPct",    label: "Poacher %",   kind: "poacher" },
  { key: "rightFoot",     label: "Right foot",  kind: "foot" },
  { key: "leftFoot",      label: "Left foot",   kind: "foot" },
  { key: "header",        label: "Header",      kind: "foot" },
];

// Format a value for a given axis: rates → 2dp, percentages → "n%", counts/averages → int or 1dp.
function fmtDnaVal(key: DnaMetricKey, v: number): string {
  if (key === "goalsPer90" || key === "assistsPer90") return v.toFixed(2);
  if (key === "firstTouchPct" || key === "poacherPct") return `${v}%`;
  return Number.isInteger(v) ? `${v}` : v.toFixed(1);
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

// A one-line context string beneath the value comparison — "8 of 19 goals (42%)" etc.
function dnaContext(kind: DnaAxisKind, key: DnaMetricKey, src: PlayerDnaResponse): string | null {
  const m = src.metrics;
  switch (kind) {
    case "goals":       return m.goals > 0 ? `${m.goalsPer90.toFixed(2)} per 90 mins` : null;
    case "assists":     return m.assists > 0 ? `${m.assistsPer90.toFixed(2)} per 90 mins` : null;
    case "goalsPer90":  return src.minsPlayed > 0 ? `from ${plural(m.goals, "goal")} in ${src.minsPlayed}'` : null;
    case "assistsPer90":return src.minsPlayed > 0 ? `from ${plural(m.assists, "assist")} in ${src.minsPlayed}'` : null;
    case "firstTouch":  return src.firstTouchTotal > 0
      ? `${src.firstTouchYes} of ${plural(src.firstTouchTotal, "goal")} finished first-time`
      : "no finish data recorded";
    case "poacher":     return src.poacherTotal > 0
      ? `${src.poacherYes} of ${plural(src.poacherTotal, "mapped goal")} from the poacher zone (post-to-post, within 10 yds)`
      : "no goal locations mapped";
    case "foot": {
      const n = m[key] as number;
      const share = m.goals > 0 ? Math.round((n / m.goals) * 100) : 0;
      return `${n} of ${plural(m.goals, "goal")} (${share}%)`;
    }
  }
}

function DnaTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: { metric: string; raw: string; squadAvg: string; squadBest: string; context: string | null; isPoacher?: boolean } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[200px] space-y-1.5">
      <div className="font-semibold text-sm mb-1">{d.metric}</div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">This player</span>
        <span className="font-semibold tabular-nums">{d.raw}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Squad avg</span>
        <span className="tabular-nums">{d.squadAvg}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Squad best</span>
        <span className="tabular-nums">{d.squadBest}</span>
      </div>
      {d.context && <div className="border-t pt-1.5 text-muted-foreground">{d.context}</div>}
      {d.isPoacher && <PoacherZoneDiagram className="mt-1.5 h-16 w-auto rounded" />}
    </div>
  );
}

function DnaCallout({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function PlayerDnaChart({
  title, label, srcFull, srcL3, lastN, onLastN, colorMap, players, player, onPlayer, sn,
}: {
  title: string;
  label: string;
  srcFull?: PlayerDnaResponse; srcL3?: PlayerDnaResponse;
  lastN: boolean; onLastN: () => void;
  colorMap: Record<string, string>;
  players: string[]; player: string; onPlayer: (v: string) => void;
  sn: Record<string, string>;
}) {
  const src = lastN ? srcL3 : srcFull;
  const fill = colorMap[label] ?? "hsl(var(--primary))";

  const data = useMemo(() => {
    if (!src) return [];
    return DNA_AXES.map(a => {
      const raw = src.metrics[a.key];
      const max = src.squadMax[a.key];
      const avg = src.squadAvg[a.key];
      return {
        metric: a.label,
        value: max > 0 ? Math.min(100, Math.round((raw / max) * 1000) / 10) : 0,
        raw: fmtDnaVal(a.key, raw),
        squadAvg: fmtDnaVal(a.key, avg),
        squadBest: fmtDnaVal(a.key, max),
        context: dnaContext(a.kind, a.key, src),
        isPoacher: a.kind === "poacher",
      };
    });
  }, [src]);

  const hasGoals = (src?.metrics.goals ?? 0) > 0 || (src?.metrics.assists ?? 0) > 0;
  const favOpp = src?.favouriteOpponent ?? null;
  const partner = src?.topAssistPartner ?? null;

  return (
    <ChartCard
      tall
      title={title}
      description="Attacking profile — each spoke is scaled against the squad's best on that metric"
      tooltip="One player's scoring shape. Each spoke is scaled against the squad's best on that metric — hover any spoke to compare this player vs the squad average and best, with the underlying counts (e.g. left-footed goals out of their total). Per-90 rates use total minutes; squad averages count only players who do that thing, so non-scorers don't drag them down."
      controls={
        <div className="flex flex-wrap items-center gap-3">
          <Select value={player} onValueChange={onPlayer}>
            <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue placeholder="Select player" /></SelectTrigger>
            <SelectContent>
              {players.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Last3Toggle active={lastN} onToggle={onLastN} />
        </div>
      }
    >
      <div className="grid h-full gap-4 md:grid-cols-5">
        <div className="md:col-span-3 min-h-[280px]">
          {data.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a player to see their scoring DNA.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={data} margin={{ top: 16, right: 24, bottom: 16, left: 24 }}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                {/* Radius ticks must actually render for Recharts v2 to honour `domain`;
                    with tick={false} the [0,100] scale is silently ignored. Keep them
                    subtle — they double as a "% of squad best" legend. */}
                <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={5} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${v}`} axisLine={false} />
                <Radar name={label} dataKey="value" stroke={fill} fill={fill} fillOpacity={0.45} isAnimationActive={false} />
                {/* allowEscapeViewBox: the poacher-zone tooltip is taller than the rest;
                    without this Recharts clamps it inside the chart, on top of the cursor */}
                <Tooltip content={<DnaTooltip />} allowEscapeViewBox={{ x: true, y: true }} wrapperStyle={{ zIndex: 20 }} />
              </RadarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="md:col-span-2 flex flex-col justify-center gap-2">
          {!hasGoals && src ? (
            <div className="text-sm text-muted-foreground">No goal involvements recorded for this selection.</div>
          ) : (
            <>
              <DnaCallout
                label="Favourite opponent"
                value={favOpp ? favOpp.label : "—"}
                sub={favOpp ? `${favOpp.count} goal${favOpp.count === 1 ? "" : "s"} scored` : undefined}
              />
              <DnaCallout
                label="Top assist partner"
                value={partner ? (sn[partner.label] ?? partner.label) : "—"}
                sub={partner ? `set up ${partner.count} of their goal${partner.count === 1 ? "" : "s"}` : undefined}
              />
              <DnaCallout
                label="Minutes per goal"
                value={src?.minsPerGoal != null ? `${src.minsPerGoal}'` : "—"}
                sub={src ? `${src.metrics.goals} goal${src.metrics.goals === 1 ? "" : "s"} total` : undefined}
              />
              <DnaCallout
                label="Game time"
                value={src ? `${src.minsPlayed}'` : "—"}
                sub={src ? `${src.appearances} appearance${src.appearances === 1 ? "" : "s"}` : undefined}
              />
            </>
          )}
        </div>
      </div>
    </ChartCard>
  );
}

function ChartCard({ title, description, tooltip, controls, footer, tall, auto, children }: {
  title: string; description?: string; tooltip?: string; tall?: boolean; auto?: boolean;
  controls?: React.ReactNode; footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between pb-2">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <CardDescription className="text-xs">{description}</CardDescription>}
        </div>
        {tooltip && <InfoTooltip content={tooltip} />}
      </CardHeader>
      {controls && <div className="px-6 pb-3 -mt-1">{controls}</div>}
      <CardContent className={auto ? "" : (tall ? "h-[380px]" : "h-[300px]")}>
        {children}
      </CardContent>
      {footer && <div className="px-6 pb-4 -mt-2">{footer}</div>}
    </Card>
  );
}

function PillGroup({ options, value, onChange }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
            value === o.value
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ProfileStackTooltip({ active, payload, label, showPct, labelMap }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
  showPct?: boolean;
  labelMap?: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const items = payload
    .filter(p => (p.value ?? 0) > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (!items.length) return null;
  const total = items.reduce((s, p) => s + (p.value ?? 0), 0);
  const heading = labelMap?.[label ?? ""] ?? label;
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[180px] space-y-2">
      <div className="font-semibold text-sm">{heading}</div>
      <div className="border-t pt-2 space-y-1">
        {items.map(p => (
          <div key={p.name} className="flex justify-between gap-6">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
              vs {p.name}
            </span>
            <span>
              {p.value}
              {showPct && total > 0 && (
                <span className="text-muted-foreground"> ({Math.round(((p.value ?? 0) / total) * 100)}%)</span>
              )}
            </span>
          </div>
        ))}
      </div>
      <div className="border-t pt-2 flex justify-between gap-6 font-semibold">
        <span className="text-muted-foreground">Total</span>
        <span>{total}</span>
      </div>
    </div>
  );
}

// Rich tooltip for Goal Detail by Type: lists the actual goals behind the hovered
// bar (minute + scorer + opponent) so a coach gets the context, not just a count.
function GoalDetailStackTooltip({ active, label, goals, dim, hidden, shortName }: {
  active?: boolean;
  label?: string;
  goals: ScoredGoalRecord[];
  dim: GoalDetailDim;
  hidden: Set<string>;
  shortName: Record<string, string>;
}) {
  if (!active || !label) return null;
  const get = DIM_GETTER[dim];
  const matching = goals.filter(g =>
    (get(g)?.trim() || "Unknown") === label && g.opponent && !hidden.has(g.opponent));
  if (!matching.length) return null;
  const sorted = matching.slice().sort((a, b) =>
    (a.opponent ?? "").localeCompare(b.opponent ?? "") || (a.minuteScored ?? 0) - (b.minuteScored ?? 0));
  const shown = sorted.slice(0, 14);
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[220px] max-w-[320px] space-y-2">
      <div className="font-semibold text-sm">{label} · {matching.length} goal{matching.length === 1 ? "" : "s"}</div>
      <div className="border-t pt-2 space-y-1">
        {shown.map(g => (
          <div key={g.id} className="flex justify-between gap-4">
            <span className="text-muted-foreground truncate">
              {g.minuteScored != null ? `${g.minuteScored}'` : "—"} {shortName[g.scorer ?? ""] ?? g.scorer ?? "Unknown"}
            </span>
            <span className="shrink-0">vs {g.opponent}</span>
          </div>
        ))}
        {sorted.length > shown.length && (
          <div className="text-muted-foreground italic">+{sorted.length - shown.length} more…</div>
        )}
      </div>
    </div>
  );
}

function OpponentStackChart({ title, description, tooltip, data, opponents, colorMap, hidden, onToggle, angledLabels, controls, tooltipContent }: {
  title: string; description?: string; tooltip?: string;
  data: Array<Record<string, string | number>>;
  opponents: string[];
  colorMap: Record<string, string>;
  hidden: Set<string>;
  onToggle: (opp: string) => void;
  angledLabels?: boolean;
  controls?: React.ReactNode;
  tooltipContent?: React.ReactElement;
}) {
  const legend = data.length === 0 ? undefined : (
    <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px]">
      {opponents.map(opp => {
        const off = hidden.has(opp);
        return (
          <button
            key={opp}
            type="button"
            onClick={() => onToggle(opp)}
            className="flex items-center gap-1.5"
            aria-pressed={!off}
            style={{ cursor: "pointer" }}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorMap[opp] ?? "#888888", opacity: off ? 0.3 : 1 }} />
            <span style={{
              color: off ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
              textDecoration: off ? "line-through" : "none",
            }}>
              {opp}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <ChartCard title={title} description={description} tooltip={tooltip} footer={legend} controls={controls}>
      {data.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No goals recorded</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: angledLabels ? 40 : 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" {...AXIS_STYLE} {...(angledLabels ? { angle: -35, textAnchor: "end", interval: 0 } : {})} />
            <YAxis {...AXIS_STYLE} allowDecimals={false} />
            <Tooltip content={tooltipContent ?? <ProfileStackTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
            {opponents.map(opp => (
              <Bar
                key={opp}
                dataKey={opp}
                name={opp}
                stackId="s"
                fill={colorMap[opp] ?? "#888888"}
                hide={hidden.has(opp)}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

// ─── Opponent Insights: club-centric profile helpers ──────────────────────────
// Raw per-goal records as returned by /analytics/opponent-profile (club-relative:
// `side` = scored/conceded from this club's view, `opponent` = the other club).
interface RawProfileGoal {
  matchId: string; matchDate: string | null; minuteScored: number | null; side: string; opponent: string;
  scorer: string | null; assist: string | null; goalType: string | null; assistType: string | null;
  howPenetrated: string | null; buildupLane: string | null; firstTimeFinish: boolean | null;
  finishType: string | null; passString: string | null; goalX: string | null; goalY: string | null;
}
interface RawProfileMatch { matchId: string; opponent: string; result: string }
interface ProfilePlayer {
  playerName: string; club: string | null; minsPlayed: number; starts: number; appearances: number; goals: number; assists: number;
}

// Keep only goals from the N most recent distinct match dates (a "round" = a match
// date). Undefined lastN returns every goal for the requested side.
function lastNRoundsGoals(goals: RawProfileGoal[], side: "scored" | "conceded", lastN?: number): RawProfileGoal[] {
  const forSide = goals.filter(g => g.side === side);
  if (!lastN) return forSide;
  // A "round" = a distinct match date the club actually played, derived from ALL their
  // goals (scored + conceded), not just the requested side. Otherwise a side that had no
  // goals in a recent round (e.g. a clean sheet) would reach back and pull in an older
  // round instead — showing opponents that weren't part of the last N matches.
  const dates = Array.from(new Set(goals.map(g => g.matchDate).filter((d): d is string => !!d))).sort();
  const keep = new Set(dates.slice(-lastN));
  return forSide.filter(g => g.matchDate != null && keep.has(g.matchDate));
}

// Map the profile's club-relative goals onto the ScoredGoalRecord shape the Team-tab
// transforms/components already understand (stacking key = opponent club).
function mapProfileGoals(goals: RawProfileGoal[] | undefined, side: "scored" | "conceded"): ScoredGoalRecord[] {
  return (goals ?? []).filter(g => g.side === side).map((g, i) => ({
    id: i, matchId: null, matchCode: g.matchId, opponent: g.opponent, minuteScored: g.minuteScored,
    goalType: g.goalType, assistType: g.assistType, buildupLane: g.buildupLane, finishType: g.finishType,
    howPenetrated: g.howPenetrated, firstTimeFinish: g.firstTimeFinish, passString: g.passString,
    scorer: g.scorer, assist: g.assist,
    goalX: g.goalX != null && g.goalX !== "" ? Number(g.goalX) : null,
    goalY: g.goalY != null && g.goalY !== "" ? Number(g.goalY) : null,
  } as ScoredGoalRecord));
}

// Per-match timelines + metadata keyed by an integer match index (aligned so
// firstGoalMatches' meta lookup lines up with the timeline keys).
function buildProfileTimelines(goals: RawProfileGoal[] | undefined, matches: RawProfileMatch[] | undefined) {
  const idxByMatch: Record<string, number> = {};
  const tl: Record<number, TimelineEvent[]> = {};
  const meta: Record<number, { code: string; opponent: string; result: FgMatch["result"] | null }> = {};
  let next = 0;
  const idxFor = (mid: string) => (idxByMatch[mid] ??= next++);
  for (const g of goals ?? []) {
    if (g.minuteScored == null) continue;
    const i = idxFor(g.matchId);
    (tl[i] ??= []).push({ minute: g.minuteScored, side: g.side === "scored" ? "for" : "against", opponent: g.opponent });
  }
  for (const m of matches ?? []) {
    const i = idxFor(m.matchId);
    const r = m.result === "W" || m.result === "D" || m.result === "L" ? m.result : null;
    meta[i] = { code: m.matchId, opponent: m.opponent, result: r };
  }
  for (const k of Object.keys(tl)) tl[Number(k)].sort((a, b) => a.minute - b.minute);
  return { profileTimelines: tl, profileMeta: meta };
}

interface PlayerBarDatum {
  name: string; value: number; mins: number; goals: number; assists: number; starts: number; appearances: number; sub: number;
}
const per90 = (v: number, mins: number) => (mins > 0 ? +(v * 90 / mins).toFixed(2) : 0);

// Top-15 rows for a single player metric. Rate metrics need a minutes floor so a
// one-off cameo goal doesn't top the chart; totals just filter to > 0.
function PlayerBarTooltip({ active, payload, valueLabel }: {
  active?: boolean;
  payload?: Array<{ payload: PlayerBarDatum }>;
  valueLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[190px] space-y-2">
      <div className="font-semibold text-sm leading-tight">{d.name}</div>
      <div className="border-t pt-2 space-y-1">
        <div className="flex justify-between gap-6 font-semibold">
          <span className="text-muted-foreground">{valueLabel}</span>
          <span>{d.value.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-6"><span className="text-muted-foreground">Minutes</span><span>{d.mins.toLocaleString()}</span></div>
        <div className="flex justify-between gap-6"><span className="text-muted-foreground">Goals / Assists</span><span>{d.goals}G · {d.assists}A</span></div>
        <div className="flex justify-between gap-6"><span className="text-muted-foreground">Starts / Apps</span><span>{d.starts} / {d.appearances}</span></div>
      </div>
    </div>
  );
}

// ─── Player timeline drill-down ───────────────────────────────────────────────
// Click a player in a Starts & Appearances chart and the chart area becomes their
// game-by-game record: Start / Bench / Out per fixture, most recent game on the LEFT
// so you read the season right-to-left ("are they playing lately?").
const TL_STATUS_NUM = { start: 2, bench: 1, out: 0 } as const;
const TL_STATUS_LABEL: Record<number, string> = { 2: "Started", 1: "Off bench", 0: "Didn't play" };
const TL_STATUS_COLOR: Record<number, string> = { 2: "#3b82f6", 1: "#93c5fd", 0: "hsl(var(--muted-foreground))" };

function TimelineTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: { matchId: string; matchDate: string | null; opponent: string | null; statusNum: number; minutes: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md space-y-1">
      <div className="font-semibold">{d.matchId}</div>
      {d.matchDate && <div className="text-muted-foreground">{d.matchDate}</div>}
      <div className="flex justify-between gap-6"><span className="text-muted-foreground">Opponent</span><span>{d.opponent ?? "—"}</span></div>
      <div className="flex justify-between gap-6 font-semibold"><span className="text-muted-foreground">Result</span><span style={{ color: TL_STATUS_COLOR[d.statusNum] }}>{TL_STATUS_LABEL[d.statusNum]}</span></div>
      <div className="flex justify-between gap-6"><span className="text-muted-foreground">Minutes</span><span>{d.minutes}</span></div>
    </div>
  );
}

function PlayerTimelineChart({ seasonId, club, player, onBack }: {
  seasonId: number; club: string; player: string; onBack: () => void;
}) {
  const params = { seasonId, club, player };
  const { data, isLoading } = useGetPlayerTimeline(params, {
    query: { queryKey: getGetPlayerTimelineQueryKey(params) },
  });

  // Chronological order: earliest fixture on the left, latest on the right
  const rows = useMemo(() =>
    (data?.matches ?? [])
      .map(m => ({ ...m, statusNum: TL_STATUS_NUM[m.status as keyof typeof TL_STATUS_NUM] ?? 0 })),
    [data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 pb-2">
        <span className="text-sm font-semibold">{player} — game by game <span className="font-normal text-muted-foreground">(season left to right)</span></span>
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" /> Back to squad
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No games found for {player}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 10, right: 15, left: 10, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="matchId" {...AXIS_STYLE} angle={-40} textAnchor="end" interval={0} height={60} />
              <YAxis
                {...AXIS_STYLE}
                domain={[0, 2]}
                ticks={[0, 1, 2]}
                tickFormatter={(v: number) => TL_STATUS_LABEL[v] ?? ""}
                width={70}
              />
              <Tooltip content={<TimelineTooltip />} cursor={{ stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" }} />
              <Line
                type="linear"
                dataKey="statusNum"
                stroke="#3b82f6"
                strokeWidth={2}
                isAnimationActive={false}
                dot={(props: { cx?: number; cy?: number; payload?: { statusNum: number; matchId: string } }) => (
                  <circle
                    key={props.payload?.matchId}
                    cx={props.cx} cy={props.cy} r={5}
                    fill={TL_STATUS_COLOR[props.payload?.statusNum ?? 0]}
                    stroke="hsl(var(--background))" strokeWidth={1.5}
                  />
                )}
                activeDot={{ r: 7 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// One player-metric bar chart. "single" plots one value per player; "startsApps"
// stacks starts + off-the-bench appearances. When `timeline` is supplied, clicking a
// player's bar swaps the chart for their game-by-game timeline.
function PlayerBarCard({ title, description, tooltip, data, color, valueLabel, allowDecimals, variant = "single", controls, timeline }: {
  title: string; description?: string; tooltip?: string;
  data: PlayerBarDatum[]; color: string; valueLabel: string; allowDecimals?: boolean;
  variant?: "single" | "startsApps"; controls?: React.ReactNode;
  timeline?: { seasonId: number; club: string };
}) {
  const [tlPlayer, setTlPlayer] = useState<string | null>(null);
  useEffect(() => { setTlPlayer(null); }, [timeline?.club, timeline?.seasonId]);
  return (
    <ChartCard
      title={title}
      description={tlPlayer ? "Click any dot for match details" : timeline ? `${description ?? ""} — click a player for their game-by-game record` : description}
      tooltip={tooltip}
      tall
      controls={tlPlayer ? undefined : controls}
      footer={variant === "startsApps" && !tlPlayer ? <KeyLegend keys={["Starts", "Off bench"]} colorFn={k => (k === "Starts" ? "#3b82f6" : "#93c5fd")} /> : undefined}
    >
      {tlPlayer && timeline ? (
        <PlayerTimelineChart seasonId={timeline.seasonId} club={timeline.club} player={tlPlayer} onBack={() => setTlPlayer(null)} />
      ) : data.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No data recorded</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 10, right: 10, left: -20, bottom: 60 }}
            onClick={timeline ? (s => { const p = (s as { activePayload?: Array<{ payload?: { name?: string } }> } | null)?.activePayload?.[0]?.payload; if (p?.name) setTlPlayer(p.name); }) : undefined}
            style={timeline ? { cursor: "pointer" } : undefined}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" {...AXIS_STYLE} angle={-40} textAnchor="end" interval={0} height={60} />
            <YAxis {...AXIS_STYLE} allowDecimals={variant === "startsApps" ? false : !!allowDecimals} />
            <Tooltip content={<PlayerBarTooltip valueLabel={variant === "startsApps" ? "Appearances" : valueLabel} />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
            {variant === "startsApps" && <Bar dataKey="starts" name="Starts" stackId="a" fill="#3b82f6" />}
            {variant === "startsApps" && <Bar dataKey="sub" name="Off bench" stackId="a" fill="#93c5fd" radius={[3, 3, 0, 0]} />}
            {variant !== "startsApps" && <Bar dataKey="value" name={valueLabel} fill={color} radius={[3, 3, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

function TooltipRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-6", bold && "font-semibold text-foreground")}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function StartsTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: { fullName: string; starts: number; bench: number; appearances: number; minsPlayed: number; yellowCards: number; redCards: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[200px] space-y-2">
      <div className="font-semibold text-sm leading-tight">{d.fullName}</div>
      <div className="border-t pt-2 space-y-1">
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Starts</span>
          <span>{d.starts}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Bench</span>
          <span>{d.bench}</span>
        </div>
        <div className="flex justify-between gap-6 font-semibold">
          <span className="text-muted-foreground">Appearances</span>
          <span>{d.appearances}</span>
        </div>
      </div>
      <div className="border-t pt-2 space-y-1">
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Mins</span>
          <span>{d.minsPlayed.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Cards</span>
          <span>Y: {d.yellowCards || 0}, R: {d.redCards || 0}</span>
        </div>
      </div>
    </div>
  );
}

function MinutesTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: { fullName: string; value: number; appearances: number; avgPerApp: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[200px] space-y-2">
      <div className="font-semibold text-sm leading-tight">{d.fullName}</div>
      <div className="border-t pt-2 space-y-1">
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Total mins</span>
          <span>{d.value.toLocaleString()}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Appearances</span>
          <span>{d.appearances}</span>
        </div>
        <div className="flex justify-between gap-6 font-semibold">
          <span className="text-muted-foreground">Avg min per app</span>
          <span>{d.avgPerApp}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Opponent Insights: per-player stacked-by-opponent chart (goals/assists/G+A) ─
type OppPlayerSrc = {
  opponents: string[];
  players: Array<{
    playerName: string; totalMins: number; totalGoals: number; totalAssists: number;
    totalStarts: number; totalApps: number;
    byOpponent: Record<string, { goals: number; assists: number; minsPlayed: number }>;
  }>;
};

// Squad charts (Starts & Appearances, Total Minutes) reuse PlayerBarCard but source
// their rows from the opponent-players endpoint so they inherit its "Last 3 rounds"
// window. Unlike the stacked goal/assist charts, these include the whole roster.
function oppStartsAppsData(src?: OppPlayerSrc): PlayerBarDatum[] {
  return (src?.players ?? [])
    .map(p => ({ name: p.playerName, value: p.totalApps, mins: p.totalMins, goals: p.totalGoals, assists: p.totalAssists, starts: p.totalStarts, appearances: p.totalApps, sub: Math.max(p.totalApps - p.totalStarts, 0) }))
    .filter(r => r.appearances > 0)
    .sort((a, b) => b.appearances - a.appearances || b.starts - a.starts)
    .slice(0, 18);
}
function oppMinutesData(src?: OppPlayerSrc): PlayerBarDatum[] {
  return (src?.players ?? [])
    .map(p => ({ name: p.playerName, value: p.totalMins, mins: p.totalMins, goals: p.totalGoals, assists: p.totalAssists, starts: p.totalStarts, appearances: p.totalApps, sub: Math.max(p.totalApps - p.totalStarts, 0) }))
    .filter(r => r.mins > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);
}

function OppPlayerStackChart({
  metric, clubLabel, srcFull, srcL3, lastN, onLastN, sort, onSort, hidden, onToggle, colorMap, sn, maxBars,
}: {
  metric: "goals" | "assists" | "contrib";
  clubLabel: string;
  srcFull?: OppPlayerSrc; srcL3?: OppPlayerSrc;
  lastN: boolean; onLastN: () => void;
  sort: "total" | "mpg"; onSort: (v: "total" | "mpg") => void;
  hidden: Set<string>; onToggle: (opp: string) => void;
  colorMap: Record<string, string>; sn: Record<string, string>; maxBars?: number;
}) {
  const src = lastN ? srcL3 : srcFull;
  const val = (v: { goals: number; assists: number }) =>
    metric === "goals" ? v.goals : metric === "assists" ? v.assists : v.goals + v.assists;

  const opponents = useMemo(() => {
    const s = new Set<string>();
    for (const p of src?.players ?? [])
      for (const [opp, v] of Object.entries(p.byOpponent)) if (val(v) > 0) s.add(opp);
    return Array.from(s).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, metric]);

  const data = useMemo(() => {
    if (!src?.players.length) return [];
    const rows = src.players.map(p => {
      const byOpponent: Record<string, { goals: number; assists: number; minsPlayed: number }> = {};
      for (const [opp, v] of Object.entries(p.byOpponent)) if (val(v) > 0) byOpponent[opp] = v;
      const visible = Object.entries(byOpponent).filter(([o]) => !hidden.has(o));
      const filteredGoals   = visible.reduce((s, [, v]) => s + v.goals, 0);
      const filteredAssists = visible.reduce((s, [, v]) => s + v.assists, 0);
      const filteredMins    = visible.reduce((s, [, v]) => s + v.minsPlayed, 0);
      const filteredContribs = filteredGoals + filteredAssists;
      const filteredValue = metric === "goals" ? filteredGoals : metric === "assists" ? filteredAssists : filteredContribs;
      const row: Record<string, unknown> = {
        name: sn[p.playerName] ?? p.playerName, fullName: p.playerName, totalMins: p.totalMins,
        filteredGoals, filteredAssists, filteredContribs, filteredMins, filteredValue, byOpponent,
      };
      for (const [opp, v] of Object.entries(byOpponent)) row[opp] = val(v);
      return row;
    }).filter(r => (r.filteredValue as number) > 0);
    rows.sort((a, b) => {
      if (sort === "mpg") {
        const am = (a.filteredValue as number) > 0 ? (a.totalMins as number) / (a.filteredValue as number) : Infinity;
        const bm = (b.filteredValue as number) > 0 ? (b.totalMins as number) / (b.filteredValue as number) : Infinity;
        return am - bm;
      }
      return (b.filteredValue as number) - (a.filteredValue as number);
    });
    return maxBars ? rows.slice(0, maxBars) : rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, metric, hidden, sort, sn, maxBars]);

  const cfg = {
    goals:   { noun: "Goals",         total: "Total Goals",  mpg: "Mins / Goal",         stackId: "oppGoals" },
    assists: { noun: "Assists",       total: "Total Assists", mpg: "Mins / Assist",       stackId: "oppAssists" },
    contrib: { noun: "Contributions", total: "Total G+A",    mpg: "Mins / Contribution", stackId: "oppContrib" },
  }[metric];
  const title = `${clubLabel} — ${sort === "mpg" ? cfg.mpg : cfg.noun}${lastN ? " — Last 3 Rounds" : ""}`;

  return (
    <ChartCard
      tall
      title={title}
      description={`${cfg.noun} broken down by the opponent each player faced — click legend to include/exclude clubs`}
      tooltip={`Stacked by the opponent each player came up against. Each segment = ${cfg.noun.toLowerCase()} in games vs that club. Click a club in the legend to remove it; the ${cfg.mpg} figure recalculates from the visible clubs. Rates use total season minutes.`}
      controls={
        <div className="flex flex-wrap items-center gap-3">
          <PillGroup
            options={[{ value: "total", label: cfg.total }, { value: "mpg", label: cfg.mpg }]}
            value={sort}
            onChange={v => onSort(v as "total" | "mpg")}
          />
          <button
            onClick={onLastN}
            className={cn(
              "px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
              lastN
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
            )}
          >
            Last 3 rounds
          </button>
        </div>
      }
    >
      {data.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No {cfg.noun.toLowerCase()} recorded for this selection.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 20, left: -20, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" {...AXIS_STYLE} angle={-35} textAnchor="end" interval={0} />
            <YAxis {...AXIS_STYLE} allowDecimals={false} />
            <Tooltip
              content={
                metric === "goals"
                  ? <MinsPerGoalTooltip hiddenOpponents={hidden} />
                  : metric === "assists"
                    ? <AssistStackedTooltip hiddenOpponents={hidden} />
                    : <ContribTooltip hiddenOpponents={hidden} />
              }
              cursor={{ fill: "hsl(var(--muted)/0.3)" }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 24 }}
              onClick={(e) => onToggle(e.value as string)}
              formatter={(value) => (
                <span style={{
                  color: hidden.has(value) ? "hsl(var(--muted-foreground))" : undefined,
                  textDecoration: hidden.has(value) ? "line-through" : undefined,
                  cursor: "pointer",
                }}>
                  {value}
                </span>
              )}
            />
            {opponents.map(opp => (
              <Bar
                key={opp}
                dataKey={opp}
                name={opp}
                stackId={cfg.stackId}
                fill={colorMap[opp] ?? "#888888"}
                hide={hidden.has(opp)}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

function ContribTooltip({ active, payload, hiddenOpponents }: {
  active?: boolean;
  payload?: Array<{ payload: ContribEntry }>;
  hiddenOpponents: Set<string>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const mpc = d.filteredContribs > 0 ? Math.round(d.totalMins / d.filteredContribs) : null;
  const visibleBreakdown = Object.entries(d.byOpponent)
    .filter(([opp]) => !hiddenOpponents.has(opp))
    .sort(([, a], [, b]) => (b.goals + b.assists) - (a.goals + a.assists));
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[220px] space-y-2">
      <div className="font-semibold text-sm leading-tight">{d.fullName}</div>
      <div className="border-t pt-2 space-y-1">
        {visibleBreakdown.map(([opp, data]) => (
          <div key={opp} className="flex justify-between gap-6">
            <span className="text-muted-foreground">vs {opp}</span>
            <span>{data.goals}G + {data.assists}A</span>
          </div>
        ))}
      </div>
      <div className="border-t pt-2 space-y-1">
        <div className="flex justify-between gap-6 font-semibold">
          <span className="text-muted-foreground">Mins / Contribution</span>
          <span>{mpc !== null ? `${mpc} mins` : "—"}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">G+A (visible)</span>
          <span>{d.filteredGoals}G + {d.filteredAssists}A = {d.filteredContribs}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Total season mins</span>
          <span>{d.totalMins.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

function AssistStackedTooltip({ active, payload, hiddenOpponents }: {
  active?: boolean;
  payload?: Array<{ payload: AssistEntry }>;
  hiddenOpponents: Set<string>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const mpa = d.filteredAssists > 0 ? Math.round(d.totalMins / d.filteredAssists) : null;
  const visibleBreakdown = Object.entries(d.byOpponent)
    .filter(([opp]) => !hiddenOpponents.has(opp))
    .sort(([, a], [, b]) => b.assists - a.assists);
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[210px] space-y-2">
      <div className="font-semibold text-sm leading-tight">{d.fullName}</div>
      <div className="border-t pt-2 space-y-1">
        {visibleBreakdown.map(([opp, data]) => (
          <div key={opp} className="flex justify-between gap-6">
            <span className="text-muted-foreground">vs {opp}</span>
            <span>{data.assists} assist{data.assists !== 1 ? "s" : ""}</span>
          </div>
        ))}
      </div>
      <div className="border-t pt-2 space-y-1">
        <div className="flex justify-between gap-6 font-semibold">
          <span className="text-muted-foreground">Mins / Assist</span>
          <span>{mpa !== null ? `${mpa} mins` : "—"}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Assists (visible)</span>
          <span>{d.filteredAssists}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Total season mins</span>
          <span>{d.totalMins.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

function MinsPerGoalTooltip({ active, payload, hiddenOpponents }: {
  active?: boolean;
  payload?: Array<{ payload: MpgEntry }>;
  hiddenOpponents: Set<string>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  // mpg uses total season minutes (matches the main leaderboard), not just mins vs scoring opponents
  const mpg = d.filteredGoals > 0 ? Math.round(d.totalMins / d.filteredGoals) : null;
  const visibleBreakdown = Object.entries(d.byOpponent)
    .filter(([opp]) => !hiddenOpponents.has(opp))
    .sort(([, a], [, b]) => b.goals - a.goals);
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[210px] space-y-2">
      <div className="font-semibold text-sm leading-tight">{d.fullName}</div>
      {/* Goals by opponent */}
      <div className="border-t pt-2 space-y-1">
        {visibleBreakdown.map(([opp, data]) => (
          <div key={opp} className="flex justify-between gap-6">
            <span className="text-muted-foreground">vs {opp}</span>
            <span>{data.goals} goal{data.goals !== 1 ? "s" : ""}</span>
          </div>
        ))}
      </div>
      {/* Efficiency */}
      <div className="border-t pt-2 space-y-1">
        <div className="flex justify-between gap-6 font-semibold">
          <span className="text-muted-foreground">Mins / Goal</span>
          <span>{mpg !== null ? `${mpg} mins` : "—"}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Goals (visible)</span>
          <span>{d.filteredGoals}</span>
        </div>
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">Total season mins</span>
          <span>{d.totalMins.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

function EffectivenessTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: EffEntry }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const gdSign = (v: number) => v > 0 ? `+${v}` : String(v);
  const gdColor = d.gd > 0 ? "text-[hsl(var(--chart-3))]" : d.gd < 0 ? "text-[hsl(var(--chart-4))]" : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[230px] space-y-2">
      {/* Header: name + position badge */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-sm leading-tight">{d.fullName}</div>
          <div className="text-muted-foreground mt-0.5">{d.position ?? "Position unknown"}</div>
        </div>
        <span className={cn("shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full", POS_BADGE_BG[d.posGroup])}>
          {d.posGroup}
        </span>
      </div>
      {/* On-field GD summary */}
      <div className="border-t pt-2 space-y-1">
        <div className="flex justify-between gap-6 font-semibold">
          <span className="text-muted-foreground">On-field GD</span>
          <span className={gdColor}>{gdSign(d.gd)}</span>
        </div>
        <TooltipRow label="GD per 90" value={gdSign(+d.gdPer90.toFixed(2))} />
      </div>
      {/* Raw breakdown */}
      <div className="border-t pt-2 space-y-1">
        <TooltipRow label="Goals scored (team)"   value={String(d.goalsFor)} />
        <TooltipRow label="Goals conceded (team)"  value={String(d.goalsAgainst)} />
      </div>
      {/* Playing time */}
      <div className="border-t pt-2 space-y-1">
        <TooltipRow label="Minutes"       value={`${d.minsPlayed.toLocaleString()} mins`} />
        <TooltipRow label="Appearances"   value={`${d.appearances} (${d.starts} starts)`} />
      </div>
      <div className="border-t pt-2 text-muted-foreground">
        Ranked #{d.rank} of {d.total} players this season
      </div>
    </div>
  );
}

interface OppChartEntry {
  name: string; fullName: string; position: string | null; posGroup: PosGroup;
  goalsFor: number; goalsConceded: number; gd: number;
  minsPlayed: number; appearances: number; starts: number;
}

function OppThreatTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: OppChartEntry }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const gdSign = (v: number) => v > 0 ? `+${v}` : String(v);
  const gdColor = d.gd > 0 ? "text-[hsl(var(--chart-4))]" : d.gd < 0 ? "text-[hsl(var(--chart-3))]" : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[230px] space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-sm leading-tight">{d.fullName}</div>
          <div className="text-muted-foreground mt-0.5">{d.position ?? "Position unknown"}</div>
        </div>
        <span className={cn("shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full", POS_BADGE_BG[d.posGroup])}>
          {d.posGroup}
        </span>
      </div>
      <div className="border-t pt-2 space-y-1">
        <TooltipRow label="Goals they scored (on)" value={String(d.goalsFor)}  bold />
        <TooltipRow label="Goals we scored (on)"   value={String(d.goalsConceded)} />
        <div className="flex justify-between gap-6 font-semibold pt-0.5">
          <span className="text-muted-foreground">On-field GD (their view)</span>
          <span className={gdColor}>{gdSign(d.gd)}</span>
        </div>
      </div>
      <div className="border-t pt-2 space-y-1">
        <TooltipRow label="Minutes"     value={`${d.minsPlayed.toLocaleString()} mins`} />
        <TooltipRow label="Appearances" value={`${d.appearances} (${d.starts} starts)`} />
      </div>
    </div>
  );
}

function InfoTooltip({ content }: { content: string }) {
  return (
    <RadixTooltip>
      <TooltipTrigger asChild>
        <Info className="h-4 w-4 text-muted-foreground cursor-help shrink-0 mt-0.5" />
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[250px]">
        <p className="text-sm">{content}</p>
      </TooltipContent>
    </RadixTooltip>
  );
}
