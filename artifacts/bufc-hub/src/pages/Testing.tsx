import React, { useState, useMemo, useEffect } from "react";
import { useListAthleticTests, useListTeams, getListAthleticTestsQueryKey, type AthleticTest } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
  ScatterChart, Scatter, LabelList, LineChart, Line,
} from "recharts";
import { Zap, ShieldAlert } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Metric metadata
// ─────────────────────────────────────────────────────────────────────────────

type MetricKey = "verticalStart" | "verticalM" | "verticalTotal" | "horizontalM"
  | "balsomS" | "split010" | "split1020" | "split2030" | "total30m";

interface MetricDef { id: MetricKey; label: string; short: string; lowerIsBetter: boolean; decimals: number }

const METRICS: MetricDef[] = [
  { id: "verticalStart",  label: "Vertical Start",       short: "Vert start", lowerIsBetter: false, decimals: 0 },
  { id: "verticalM",      label: "Vertical Max",         short: "Vert max",   lowerIsBetter: false, decimals: 0 },
  { id: "verticalTotal",  label: "Vertical Total",       short: "Vert total", lowerIsBetter: false, decimals: 0 },
  { id: "horizontalM",    label: "Horizontal Jump (m)",  short: "Horizontal", lowerIsBetter: false, decimals: 2 },
  { id: "balsomS",        label: "Balsom Agility (s)",   short: "Balsom",     lowerIsBetter: true,  decimals: 2 },
  { id: "split010",       label: "0-10m Split (s)",      short: "0-10m",      lowerIsBetter: true,  decimals: 2 },
  { id: "split1020",      label: "10-20m Split (s)",     short: "10-20m",     lowerIsBetter: true,  decimals: 2 },
  { id: "split2030",      label: "20-30m Split (s)",     short: "20-30m",     lowerIsBetter: true,  decimals: 2 },
  { id: "total30m",       label: "Total 30m (s)",        short: "30m total",  lowerIsBetter: true,  decimals: 2 },
];
const metricDef = (id: string) => METRICS.find(m => m.id === id) ?? METRICS[0];

const POS_COLORS: Record<string, string> = {
  GK: "hsl(var(--chart-1))",
  Defender: "hsl(var(--chart-2))",
  Midfielder: "hsl(var(--chart-3))",
  Forward: "hsl(var(--chart-5))",
};
const POS_ORDER = ["GK", "Defender", "Midfielder", "Forward"];

function getPosGroup(pos: string | null | undefined): string {
  if (!pos) return "Unknown";
  const p = pos.trim().toLowerCase();
  if (p === "gk" || p === "goalkeeper" || p === "keeper") return "GK";
  if (p === "defender" || ["rb", "lb", "cb", "rcb", "lcb", "rwb", "lwb"].includes(p)) return "Defender";
  if (p === "midfielder" || ["dm", "cm", "rm", "lm", "cam", "cdm"].includes(p)) return "Midfielder";
  if (p === "forward" || p === "striker" || ["st", "cf", "rw", "lw"].includes(p)) return "Forward";
  return "Unknown";
}

const GREY = "hsl(var(--muted-foreground) / 0.35)";
const GREEN = "hsl(var(--chart-3))";
const AMBER = "hsl(var(--chart-4))";
const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 10 };
const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))",
  color: "hsl(var(--foreground))", fontSize: 12, borderRadius: 8,
};

const isRealPlayer = (t: AthleticTest) => !/^(averages?|unknown)$/i.test(t.playerName.trim());

/**
 * Percentile of `v` within `values` (which includes `v` itself), where 100 = best.
 * Convention: "at least as good as X% of the rest of the squad" — ties count,
 * so joint-best players all score 100.
 */
function pct(values: number[], v: number, lowerIsBetter: boolean): number {
  if (values.length <= 1) return 50;
  const notWorse = values.filter(o => (lowerIsBetter ? v <= o : v >= o)).length - 1; // -1 excludes self
  return Math.round((notWorse / (values.length - 1)) * 100);
}

const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function Testing() {
  const { data: teams } = useListTeams();
  const [teamId, setTeamId] = useState<number | "">("");
  useEffect(() => {
    if (teams?.length && teamId === "") {
      const analytics = teams.find(t => t.analyticsEnabled && t.gender === "female") ?? teams[0];
      setTeamId(analytics.id);
    }
  }, [teams, teamId]);

  const params = { teamId: teamId as number };
  const { data: allTests } = useListAthleticTests(
    params,
    { query: { enabled: teamId !== "", queryKey: getListAthleticTestsQueryKey(params) } },
  );

  const years = useMemo(() => {
    const ys = [...new Set((allTests ?? []).map(t => t.year))].sort();
    return ys;
  }, [allTests]);

  const [year, setYear] = useState<string>("");
  useEffect(() => {
    if (years.length && (year === "" || !years.includes(year))) setYear(years[years.length - 1]);
  }, [years, year]);

  const tests = useMemo(
    () => (allTests ?? []).filter(t => t.year === year && isRealPlayer(t)),
    [allTests, year],
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Athletic Testing</h1>
          <p className="text-muted-foreground text-sm mt-1">Jumps, agility and sprint results — and what they mean on the pitch.</p>
        </div>
        <div className="flex gap-2">
          {teams && (
            <Select value={teamId.toString()} onValueChange={v => setTeamId(Number(v))}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Team" /></SelectTrigger>
              <SelectContent>{teams.map(t => <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="w-[110px]"><SelectValue placeholder="Year" /></SelectTrigger>
            <SelectContent>{years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {tests.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          No testing data for this team yet — upload the trainer's spreadsheet in Data Entry → Testing.
        </CardContent></Card>
      ) : (
        <Tabs defaultValue="squad" className="w-full">
          <TabsList className="grid w-full grid-cols-4 md:grid-cols-7 h-auto md:h-10">
            <TabsTrigger value="squad">Squad</TabsTrigger>
            <TabsTrigger value="sprints">Sprints</TabsTrigger>
            <TabsTrigger value="h2h">Head to Head</TabsTrigger>
            <TabsTrigger value="profile">Player Profile</TabsTrigger>
            <TabsTrigger value="improvement">Year on Year</TabsTrigger>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            <TabsTrigger value="feedback">Feedback Mode</TabsTrigger>
          </TabsList>

          <TabsContent value="squad" className="mt-6 space-y-6">
            <SquadDistribution tests={tests} />
            <PositionComparison tests={tests} />
          </TabsContent>
          <TabsContent value="sprints" className="mt-6 space-y-6">
            <SprintBreakdown tests={tests} />
            <SpeedTypeScatter tests={tests} />
          </TabsContent>
          <TabsContent value="h2h" className="mt-6">
            <HeadToHead allTests={(allTests ?? []).filter(isRealPlayer)} years={years} defaultYear={year} />
          </TabsContent>
          <TabsContent value="profile" className="mt-6">
            <PlayerProfile tests={tests} year={year} />
          </TabsContent>
          <TabsContent value="improvement" className="mt-6">
            <Improvement allTests={(allTests ?? []).filter(isRealPlayer)} years={years} />
          </TabsContent>
          <TabsContent value="leaderboard" className="mt-6">
            <Leaderboard tests={tests} />
          </TabsContent>
          <TabsContent value="feedback" className="mt-6">
            <FeedbackMode tests={tests} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Squad distribution (ranked bars, coloured by position)
// ─────────────────────────────────────────────────────────────────────────────

function SquadDistribution({ tests }: { tests: AthleticTest[] }) {
  const [metric, setMetric] = useState<MetricKey>("total30m");
  const def = metricDef(metric);

  const data = useMemo(() =>
    tests
      .filter(t => t[metric] != null)
      .sort((a, b) => def.lowerIsBetter ? (a[metric]! - b[metric]!) : (b[metric]! - a[metric]!))
      .map(t => ({
        name: t.playerName, value: t[metric] as number, posGroup: getPosGroup(t.position),
      })),
    [tests, metric, def.lowerIsBetter]);

  const mean = avg(data.map(d => d.value));

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Squad ranking — {def.label}</CardTitle>
          <CardDescription>Best on the left. Dashed line is the squad average.</CardDescription>
        </div>
        <MetricSelect value={metric} onChange={setMetric} />
      </CardHeader>
      <CardContent className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" {...AXIS} angle={-45} textAnchor="end" interval={0} />
            <YAxis {...AXIS} fontSize={11} domain={["auto", "auto"]} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v.toFixed(def.decimals), def.label]} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
            <ReferenceLine y={mean} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={POS_COLORS[d.posGroup] ?? "hsl(var(--primary))"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
      <div className="flex gap-4 items-center justify-center text-xs text-muted-foreground flex-wrap pb-4">
        {POS_ORDER.map(p => (
          <span key={p} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: POS_COLORS[p] }} />{p}
          </span>
        ))}
        <span className="flex items-center gap-1.5 border-l border-border pl-4">
          <span className="w-4 border-t border-dashed border-muted-foreground inline-block" />Squad average
        </span>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Position group comparison
// ─────────────────────────────────────────────────────────────────────────────

function PositionComparison({ tests }: { tests: AthleticTest[] }) {
  const [metric, setMetric] = useState<MetricKey>("total30m");
  const def = metricDef(metric);

  const data = useMemo(() => {
    const groups = new Map<string, number[]>();
    for (const t of tests) {
      const v = t[metric];
      if (v == null) continue;
      const g = getPosGroup(t.position);
      if (g === "Unknown") continue;
      groups.set(g, [...(groups.get(g) ?? []), v]);
    }
    return POS_ORDER
      .filter(g => groups.has(g))
      .map(g => ({ group: g, value: avg(groups.get(g)!), count: groups.get(g)!.length }));
  }, [tests, metric]);

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Position groups — {def.label}</CardTitle>
          <CardDescription>Average per position group. {def.lowerIsBetter ? "Lower is better." : "Higher is better."}</CardDescription>
        </div>
        <MetricSelect value={metric} onChange={setMetric} />
      </CardHeader>
      <CardContent className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 10, left: -15, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="group" {...AXIS} fontSize={12} />
            <YAxis {...AXIS} fontSize={11} domain={["auto", "auto"]} />
            <Tooltip contentStyle={TOOLTIP_STYLE}
              formatter={(v: number, _n, item) => [`${v.toFixed(def.decimals)} (from ${(item?.payload as { count?: number })?.count ?? "?"} players)`, "Average"]}
              cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              <LabelList dataKey="value" position="top" formatter={(v: number) => v.toFixed(def.decimals)} style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              {data.map((d, i) => <Cell key={i} fill={POS_COLORS[d.group]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint breakdown (three splits side by side)
// ─────────────────────────────────────────────────────────────────────────────

function SprintBreakdown({ tests }: { tests: AthleticTest[] }) {
  const [sortBy, setSortBy] = useState<MetricKey>("split010");

  const data = useMemo(() =>
    tests
      .filter(t => t.split010 != null && t.split1020 != null && t.split2030 != null)
      .sort((a, b) => (a[sortBy] ?? 99) - (b[sortBy] ?? 99))
      .map(t => ({ name: t.playerName, s1: t.split010, s2: t.split1020, s3: t.split2030 })),
    [tests, sortBy]);

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Sprint splits — who's quick off the mark vs quick at full speed</CardTitle>
          <CardDescription>Each player's 0-10, 10-20 and 20-30 metre times. Sorted fastest-first on the highlighted split.</CardDescription>
        </div>
        <Select value={sortBy} onValueChange={v => setSortBy(v as MetricKey)}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="split010">Sort by 0-10m</SelectItem>
            <SelectItem value="split1020">Sort by 10-20m</SelectItem>
            <SelectItem value="split2030">Sort by 20-30m</SelectItem>
            <SelectItem value="total30m">Sort by total 30m</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 40 }} barGap={1} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" {...AXIS} angle={-45} textAnchor="end" interval={0} />
            <YAxis {...AXIS} fontSize={11} domain={[(dataMin: number) => Math.floor(dataMin * 10) / 10, "auto"]} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => v.toFixed(2)} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="s1" name="0-10m" fill="hsl(var(--chart-1))" opacity={sortBy === "split010" || sortBy === "total30m" ? 1 : 0.45} />
            <Bar dataKey="s2" name="10-20m" fill="hsl(var(--chart-2))" opacity={sortBy === "split1020" || sortBy === "total30m" ? 1 : 0.45} />
            <Bar dataKey="s3" name="20-30m" fill="hsl(var(--chart-5))" opacity={sortBy === "split2030" || sortBy === "total30m" ? 1 : 0.45} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Speed type scatter — explosive starters vs long-run speedsters
// ─────────────────────────────────────────────────────────────────────────────

function SpeedTypeScatter({ tests }: { tests: AthleticTest[] }) {
  const data = useMemo(() =>
    tests
      .filter(t => t.split010 != null && t.split2030 != null)
      .map(t => ({ name: t.playerName, x: t.split010!, y: t.split2030!, posGroup: getPosGroup(t.position) })),
    [tests]);

  const avgX = avg(data.map(d => d.x));
  const avgY = avg(data.map(d => d.y));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Speed types — first step vs top gear</CardTitle>
        <CardDescription>
          Left of the line = explosive first 10m (trust her in stop-start 1v1s). Below the line = flying 20-30m
          (can knock the ball past and just run). Bottom-left corner is both.
        </CardDescription>
      </CardHeader>
      <CardContent className="h-[380px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 15, right: 25, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis type="number" dataKey="x" name="0-10m (s)" {...AXIS} fontSize={11} domain={["auto", "auto"]}
              label={{ value: "0-10m split (s) — faster ←", position: "insideBottom", offset: -5, fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis type="number" dataKey="y" name="20-30m (s)" {...AXIS} fontSize={11} domain={["auto", "auto"]}
              label={{ value: "20-30m split (s) — faster ↓", angle: -90, position: "insideLeft", fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <ZAxis range={[70, 70]} />
            <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ strokeDasharray: "3 3" }}
              formatter={(v: number) => v.toFixed(2)}
              labelFormatter={() => ""}
              content={({ payload }) => {
                const p = payload?.[0]?.payload as { name: string; x: number; y: number } | undefined;
                if (!p) return null;
                return (
                  <div style={TOOLTIP_STYLE as React.CSSProperties} className="border px-3 py-2">
                    <p className="font-medium">{p.name}</p>
                    <p>0-10m: {p.x.toFixed(2)}s · 20-30m: {p.y.toFixed(2)}s</p>
                  </div>
                );
              }} />
            <ReferenceLine x={avgX} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            <ReferenceLine y={avgY} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            <Scatter data={data}>
              {data.map((d, i) => <Cell key={i} fill={POS_COLORS[d.posGroup] ?? "hsl(var(--primary))"} />)}
              <LabelList dataKey="name" position="top" style={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Player profile — radar + on-pitch notes
// ─────────────────────────────────────────────────────────────────────────────

function buildGameNotes(t: AthleticTest, squad: AthleticTest[]): { strengths: string[]; cautions: string[] } {
  const p = (m: MetricKey): number | null => {
    const v = t[m];
    if (v == null) return null;
    const vals = squad.map(s => s[m]).filter((x): x is number => x != null);
    return pct(vals, v, metricDef(m).lowerIsBetter);
  };

  const strengths: string[] = [];
  const cautions: string[] = [];
  const HIGH = 67, LOW = 33;

  const s010 = p("split010");
  if (s010 != null && s010 >= HIGH) strengths.push("Explosive first 10m — in a 1v1 she can let it come to a stop and trust her first step: react late when defending, or stop the defender dead and accelerate away when dribbling.");
  if (s010 != null && s010 <= LOW) cautions.push("Slower first 10m — don't let 1v1s come to a standstill. Stay touch-tight when defending and keep the ball moving when attacking, rather than trusting a standing start.");

  const s2030 = p("split2030");
  if (s2030 != null && s2030 >= HIGH) strengths.push("Flying 20-30m — she can push the ball well past an opponent and simply outrun them. No need to beat anyone with skill.");
  if (s2030 != null && s2030 <= LOW) cautions.push("Top speed builds slowly — avoid long straight foot-races; win the duel early with body position and anticipation instead.");

  const vert = Math.max(p("verticalM") ?? -1, p("verticalStart") ?? -1);
  if (vert >= HIGH) strengths.push("Big vertical jump — use her in the key areas at set pieces, attacking and defending.");
  if (vert !== -1 && vert <= LOW) cautions.push("Smaller aerial presence — at set pieces give her a ground job: edge of the box, short option, or marking a smaller opponent.");

  const bals = p("balsomS");
  if (bals != null && bals >= HIGH) strengths.push("Sharp change of direction — thrives in tight areas and twisting 1v1s where the game keeps turning.");
  if (bals != null && bals <= LOW) cautions.push("Turning isn't her weapon — when defending, show the attacker into a footrace she can win rather than a twisting duel.");

  const t30 = p("total30m");
  if (t30 != null && t30 >= HIGH) strengths.push("One of the quickest over 30m — trust her with recovery runs and defending space in behind.");

  const horiz = p("horizontalM");
  if (horiz != null && horiz >= HIGH) strengths.push("Strong horizontal power — hard to knock off the ball and quick off the mark in duels.");

  return { strengths, cautions };
}

function PlayerProfile({ tests, year }: { tests: AthleticTest[]; year: string }) {
  const names = useMemo(() => tests.map(t => t.playerName).sort(), [tests]);
  const [player, setPlayer] = useState<string>("");
  useEffect(() => {
    if (names.length && (!player || !names.includes(player))) setPlayer(names[0]);
  }, [names, player]);

  const t = tests.find(x => x.playerName === player);

  const radarData = useMemo(() => {
    if (!t) return [];
    return METRICS.filter(m => m.id !== "verticalTotal").map(m => {
      const v = t[m.id];
      const vals = tests.map(s => s[m.id]).filter((x): x is number => x != null);
      return {
        metric: m.short,
        percentile: v == null ? 0 : pct(vals, v, m.lowerIsBetter),
        squad: 50,
        raw: v,
        decimals: m.decimals,
      };
    });
  }, [t, tests]);

  const notes = useMemo(() => (t ? buildGameNotes(t, tests) : { strengths: [], cautions: [] }), [t, tests]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Testing profile — {player || "…"}</CardTitle>
            <CardDescription>Each spoke is her standing in the {year} squad (100 = best). Dashed ring = squad middle.</CardDescription>
          </div>
          <Select value={player} onValueChange={setPlayer}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="Player" /></SelectTrigger>
            <SelectContent>{names.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={radarData} outerRadius="72%">
              <PolarGrid stroke="hsl(var(--border))" />
              <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <PolarRadiusAxis domain={[0, 100]} tickCount={5} angle={90}
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground) / 0.6)" }} />
              <Radar name="Squad middle" dataKey="squad" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" fill="none" />
              <Radar name={player} dataKey="percentile" stroke={GREEN} fill={GREEN} fillOpacity={0.25} />
              <Tooltip contentStyle={TOOLTIP_STYLE}
                formatter={(v: number, name, item) => {
                  if (name !== player) return [null as unknown as string, null as unknown as string];
                  const pl = item?.payload as { raw: number | null; decimals: number } | undefined;
                  const rawTxt = pl?.raw == null ? "no result" : pl.raw.toFixed(pl.decimals);
                  return [`better than ${v}% of the squad (${rawTxt})`, name];
                }} />
            </RadarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What this means on the pitch</CardTitle>
          <CardDescription>Coaching notes generated from where she sits in the squad — top third earns a strength, bottom third a caution.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {notes.strengths.length === 0 && notes.cautions.length === 0 && (
            <p className="text-sm text-muted-foreground">She sits mid-pack across the board — no standout flags either way. A balanced athletic profile.</p>
          )}
          {notes.strengths.map((n, i) => (
            <div key={`s${i}`} className="flex gap-2.5 text-sm">
              <Zap className="h-4 w-4 shrink-0 mt-0.5" style={{ color: GREEN }} />
              <p>{n}</p>
            </div>
          ))}
          {notes.cautions.map((n, i) => (
            <div key={`c${i}`} className="flex gap-2.5 text-sm">
              <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" style={{ color: AMBER }} />
              <p className="text-muted-foreground">{n}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Head to head — two players (or one player vs her past self)
// ─────────────────────────────────────────────────────────────────────────────

const H2H_COLOR_1 = "hsl(var(--chart-1))";
const H2H_COLOR_2 = "hsl(var(--chart-5))";

function HeadToHead({ allTests, years, defaultYear }: { allTests: AthleticTest[]; years: string[]; defaultYear: string }) {
  const [year1, setYear1] = useState(defaultYear);
  const [year2, setYear2] = useState(defaultYear);
  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");

  const namesFor = (y: string) => [...new Set(allTests.filter(t => t.year === y).map(t => t.playerName))].sort();
  const names1 = useMemo(() => namesFor(year1), [allTests, year1]); // eslint-disable-line react-hooks/exhaustive-deps
  const names2 = useMemo(() => namesFor(year2), [allTests, year2]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!names1.length) { if (player1) setPlayer1(""); }
    else if (!player1 || !names1.includes(player1)) setPlayer1(names1[0]);
  }, [names1, player1]);
  useEffect(() => {
    if (!names2.length) { if (player2) setPlayer2(""); }
    else if (!player2 || !names2.includes(player2)) setPlayer2(names2[Math.min(1, names2.length - 1)]);
  }, [names2, player2]);

  const t1 = allTests.find(t => t.year === year1 && t.playerName === player1);
  const t2 = allTests.find(t => t.year === year2 && t.playerName === player2);
  const label1 = `${player1} (${year1})`;
  const label2 = `${player2} (${year2})`;
  const samePick = t1 && t2 && t1.id === t2.id;

  const raceData = useMemo(() => {
    const cumul = (t: AthleticTest | undefined): (number | null)[] => {
      if (!t || t.split010 == null || t.split1020 == null || t.split2030 == null) return [null, null, null, null];
      const a = t.split010, b = a + t.split1020, c = b + t.split2030;
      return [0, a, b, c].map(v => Number(v.toFixed(2)));
    };
    const c1 = cumul(t1), c2 = cumul(t2);
    return [0, 10, 20, 30].map((d, i) => ({ distance: d, p1: c1[i], p2: c2[i] }));
  }, [t1, t2]);

  const hasRace = raceData.some(d => d.p1 != null) && raceData.some(d => d.p2 != null);
  const finish = raceData[3];
  const raceVerdict = useMemo(() => {
    if (!hasRace || finish.p1 == null || finish.p2 == null || samePick) return null;
    const gap = Math.abs(finish.p1 - finish.p2);
    if (gap < 0.005) return "Dead heat over 30m.";
    const winner = finish.p1 < finish.p2 ? label1 : label2;
    const metres = ((gap / Math.max(finish.p1, finish.p2)) * 30);
    return `${winner} wins the 30m race by ${gap.toFixed(2)}s — roughly ${metres.toFixed(1)} metres at the line.`;
  }, [hasRace, finish, label1, label2, samePick]);

  const compareRows = useMemo(() =>
    METRICS.map(m => {
      const v1 = t1?.[m.id] ?? null;
      const v2 = t2?.[m.id] ?? null;
      let winner: 0 | 1 | 2 = 0;
      if (v1 != null && v2 != null && v1 !== v2 && !samePick) {
        winner = (m.lowerIsBetter ? v1 < v2 : v1 > v2) ? 1 : 2;
      }
      return { def: m, v1, v2, winner };
    }),
    [t1, t2, samePick]);

  const wins1 = compareRows.filter(r => r.winner === 1).length;
  const wins2 = compareRows.filter(r => r.winner === 2).length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-4">
          <div className="space-y-1.5">
            <CardTitle>30m sprint — head to head</CardTitle>
            <CardDescription>
              Cumulative time at each 10m mark, built from the splits. Pick the same player in both slots with
              different years to race her against her past self.
            </CardDescription>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: H2H_COLOR_1 }}>Player 1</p>
              <Select value={player1} onValueChange={setPlayer1}>
                <SelectTrigger><SelectValue placeholder="Player 1" /></SelectTrigger>
                <SelectContent>{names1.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Year</p>
              <Select value={year1} onValueChange={setYear1}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium" style={{ color: H2H_COLOR_2 }}>Player 2</p>
              <Select value={player2} onValueChange={setPlayer2}>
                <SelectTrigger><SelectValue placeholder="Player 2" /></SelectTrigger>
                <SelectContent>{names2.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Year</p>
              <Select value={year2} onValueChange={setYear2}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="h-[380px]">
          {!hasRace ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              One of these two doesn't have full sprint splits for the chosen year.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={raceData} margin={{ top: 20, right: 30, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="distance" type="number" domain={[0, 30]} ticks={[0, 10, 20, 30]} {...AXIS} fontSize={11}
                  label={{ value: "Distance (m)", position: "insideBottom", offset: -2, fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis {...AXIS} fontSize={11}
                  label={{ value: "Cumulative time (s)", angle: -90, position: "insideLeft", offset: 20, fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => `${v.toFixed(2)}s`}
                  labelFormatter={(d) => `${d}m mark`} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="p1" name={label1} stroke={H2H_COLOR_1} strokeWidth={2.5} dot={{ r: 4, fill: H2H_COLOR_1 }}>
                  <LabelList dataKey="p1" position="top" formatter={(v: number) => v.toFixed(2)} style={{ fontSize: 10, fill: H2H_COLOR_1 }} />
                </Line>
                <Line dataKey="p2" name={label2} stroke={H2H_COLOR_2} strokeWidth={2.5} dot={{ r: 4, fill: H2H_COLOR_2 }}>
                  <LabelList dataKey="p2" position="bottom" formatter={(v: number) => v.toFixed(2)} style={{ fontSize: 10, fill: H2H_COLOR_2 }} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
        {raceVerdict && (
          <p className="text-center text-sm text-muted-foreground pb-4">{raceVerdict}</p>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Every test, side by side</CardTitle>
          <CardDescription>
            {samePick
              ? "Pick two different players (or two different years) to compare."
              : `The better result in each test is highlighted — ${label1} leads ${wins1}, ${label2} leads ${wins2}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground text-xs">
                  <th className="px-3 py-2 text-left font-medium">Test</th>
                  <th className="px-3 py-2 text-right font-medium" style={{ color: H2H_COLOR_1 }}>{label1}</th>
                  <th className="px-3 py-2 text-right font-medium" style={{ color: H2H_COLOR_2 }}>{label2}</th>
                  <th className="px-3 py-2 text-right font-medium">Gap</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map(({ def, v1, v2, winner }) => (
                  <tr key={def.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 whitespace-nowrap">{def.label}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${winner === 1 ? "font-bold" : ""}`}
                      style={winner === 1 ? { color: GREEN } : undefined}>
                      {v1 == null ? "—" : v1.toFixed(def.decimals)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${winner === 2 ? "font-bold" : ""}`}
                      style={winner === 2 ? { color: GREEN } : undefined}>
                      {v2 == null ? "—" : v2.toFixed(def.decimals)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {v1 == null || v2 == null ? "—" : Math.abs(v1 - v2).toFixed(def.decimals)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Year on year improvement
// ─────────────────────────────────────────────────────────────────────────────

function Improvement({ allTests, years }: { allTests: AthleticTest[]; years: string[] }) {
  const [metric, setMetric] = useState<MetricKey>("total30m");
  const def = metricDef(metric);
  const prevYear = years.length >= 2 ? years[years.length - 2] : null;
  const currYear = years.length >= 1 ? years[years.length - 1] : null;

  const data = useMemo(() => {
    if (!prevYear || !currYear) return [];
    const prev = new Map(allTests.filter(t => t.year === prevYear && t[metric] != null).map(t => [t.playerName, t[metric] as number]));
    return allTests
      .filter(t => t.year === currYear && t[metric] != null && prev.has(t.playerName))
      .map(t => {
        const before = prev.get(t.playerName)!;
        const after = t[metric] as number;
        // Positive delta always means "got better"
        const delta = def.lowerIsBetter ? before - after : after - before;
        return { name: t.playerName, before, after, delta: Number(delta.toFixed(def.decimals + 1)) };
      })
      .sort((a, b) => b.delta - a.delta);
  }, [allTests, metric, prevYear, currYear, def]);

  if (!prevYear) {
    return <Card><CardContent className="py-16 text-center text-muted-foreground">
      Year-on-year comparison unlocks once there are two years of testing in the system.
    </CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Improvement {prevYear} → {currYear} — {def.label}</CardTitle>
          <CardDescription>
            Green got better, amber went backwards — direction already accounts for whether lower or higher is better.
            Only players tested in both years appear.
          </CardDescription>
        </div>
        <MetricSelect value={metric} onChange={setMetric} />
      </CardHeader>
      <CardContent className="h-[420px]">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">No players with this test in both years</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="name" {...AXIS} angle={-45} textAnchor="end" interval={0} />
              <YAxis {...AXIS} fontSize={11} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "hsl(var(--muted)/0.3)" }}
                formatter={(v: number, _n, item) => {
                  const pl = item?.payload as { before: number; after: number } | undefined;
                  return [`${v > 0 ? "improved" : v < 0 ? "declined" : "no change"} · ${prevYear}: ${pl?.before.toFixed(def.decimals)} → ${currYear}: ${pl?.after.toFixed(def.decimals)}`, "Change"];
                }} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
              <Bar dataKey="delta" radius={[4, 4, 0, 0]}>
                {data.map((d, i) => <Cell key={i} fill={d.delta >= 0 ? GREEN : AMBER} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Leaderboard table
// ─────────────────────────────────────────────────────────────────────────────

function Leaderboard({ tests }: { tests: AthleticTest[] }) {
  const [sortKey, setSortKey] = useState<MetricKey | "playerName">("total30m");

  const best = useMemo(() => {
    const b = new Map<MetricKey, number>();
    for (const m of METRICS) {
      const vals = tests.map(t => t[m.id]).filter((v): v is number => v != null);
      if (vals.length) b.set(m.id, m.lowerIsBetter ? Math.min(...vals) : Math.max(...vals));
    }
    return b;
  }, [tests]);

  const rows = useMemo(() => {
    const sorted = [...tests];
    if (sortKey === "playerName") sorted.sort((a, b) => a.playerName.localeCompare(b.playerName));
    else {
      const def = metricDef(sortKey);
      sorted.sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        if (av == null) return 1;
        if (bv == null) return -1;
        return def.lowerIsBetter ? av - bv : bv - av;
      });
    }
    return sorted;
  }, [tests, sortKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leaderboard — every test, every player</CardTitle>
        <CardDescription>Click a column to rank by it (best at the top). The squad's best result in each test is highlighted.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/50 text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium sticky left-0 bg-muted/50 cursor-pointer hover:text-foreground" onClick={() => setSortKey("playerName")}>
                  Player{sortKey === "playerName" && " ▾"}
                </th>
                <th className="px-2 py-2 text-left font-medium">Pos</th>
                {METRICS.map(m => (
                  <th key={m.id} className="px-2 py-2 text-right font-medium cursor-pointer hover:text-foreground whitespace-nowrap" onClick={() => setSortKey(m.id)}>
                    {m.short}{sortKey === m.id && " ▾"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-2 py-1.5 font-medium whitespace-nowrap sticky left-0 bg-card">
                    <span className="text-muted-foreground tabular-nums mr-2">{i + 1}</span>{t.playerName}
                  </td>
                  <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{getPosGroup(t.position)}</td>
                  {METRICS.map(m => {
                    const v = t[m.id];
                    const isBest = v != null && v === best.get(m.id);
                    return (
                      <td key={m.id} className={`px-2 py-1.5 text-right tabular-nums ${isBest ? "font-bold" : ""}`}
                        style={isBest ? { color: GREEN } : undefined}>
                        {v == null ? "—" : v.toFixed(m.decimals)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Feedback mode — anonymous bars, pick a player to light hers up
// ─────────────────────────────────────────────────────────────────────────────

function FeedbackMode({ tests }: { tests: AthleticTest[] }) {
  const [metric, setMetric] = useState<MetricKey>("total30m");
  const [player, setPlayer] = useState<string>("");
  const def = metricDef(metric);
  const names = useMemo(() => tests.map(t => t.playerName).sort(), [tests]);

  const data = useMemo(() =>
    tests
      .filter(t => t[metric] != null)
      .sort((a, b) => def.lowerIsBetter ? (a[metric]! - b[metric]!) : (b[metric]! - a[metric]!))
      .map(t => ({ name: t.playerName, value: t[metric] as number })),
    [tests, metric, def.lowerIsBetter]);

  const mean = avg(data.map(d => d.value));
  const selected = data.find(d => d.name === player);
  const rank = selected ? data.indexOf(selected) + 1 : null;

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 space-y-0">
        <div className="space-y-1.5">
          <CardTitle>Individual feedback — {def.label}</CardTitle>
          <CardDescription>
            Made for showing a player where she sits: no names anywhere, just grey bars — pick her and her bar turns green.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <MetricSelect value={metric} onChange={setMetric} />
          <Select value={player} onValueChange={setPlayer}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="Pick a player…" /></SelectTrigger>
            <SelectContent>{names.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 25, right: 10, left: -15, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" tick={false} axisLine={{ stroke: "hsl(var(--border))" }}
              label={{ value: def.lowerIsBetter ? "← fastest                                   slowest →" : "← best                                   →", fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis {...AXIS} fontSize={11} domain={["auto", "auto"]} />
            <ReferenceLine y={mean} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3"
              label={{ value: "squad average", position: "insideTopRight", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={d.name === player ? GREEN : GREY} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
      {selected && rank && (
        <div className="flex items-center justify-center gap-2 pb-4 text-sm text-muted-foreground">
          <Badge variant="secondary" style={{ color: GREEN }}>her result: {selected.value.toFixed(def.decimals)}</Badge>
          <span>· {rank} of {data.length} in the squad · squad average {mean.toFixed(def.decimals)}</span>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared metric select
// ─────────────────────────────────────────────────────────────────────────────

function MetricSelect({ value, onChange }: { value: MetricKey; onChange: (m: MetricKey) => void }) {
  return (
    <Select value={value} onValueChange={v => onChange(v as MetricKey)}>
      <SelectTrigger className="w-[190px]"><SelectValue /></SelectTrigger>
      <SelectContent>
        {METRICS.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
