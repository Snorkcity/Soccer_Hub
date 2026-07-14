import React, { useState, useMemo, useEffect } from "react";
import {
  useListGpsSessions,
  getListGpsSessionsQueryKey,
  type GpsSession,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileDown, Loader2 } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

const YEARS = ["2026", "2025", "2024"];

const C_H1 = "hsl(var(--chart-1))";
const C_H2 = "hsl(var(--chart-2))";
const C_SINGLE = "hsl(var(--chart-1))";
const C_ACC = "hsl(var(--chart-1))";
const C_DEC = "hsl(var(--chart-5))";
const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 10 };
const TOOLTIP_BOX: React.CSSProperties = {
  backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
  color: "hsl(var(--foreground))", fontSize: 12, borderRadius: 8, padding: "8px 12px",
};

function parseDate(d: string | null | undefined): number | null {
  if (!d) return null;
  const [dd, mm, yyyy] = d.split("/").map(Number);
  if (!dd || !mm || !yyyy) return null;
  return new Date(yyyy, mm - 1, dd).getTime();
}

/** Which squad does a round code belong to? e.g. R5-1sts / R2-res / R2-r / R11-18s / R2 (bare = 1sts) */
function squadOf(round: string | null | undefined): string {
  if (!round) return "1sts";
  if (/-(res|r)$/i.test(round)) return "Reserves";
  if (/-1[78]s$/i.test(round)) return "17s / 18s";
  return "1sts";
}
const SQUADS = ["1sts", "Reserves", "17s / 18s"];

// ─────────────────────────────────────────────────────────────────────────────
// Metric definitions
// ─────────────────────────────────────────────────────────────────────────────

interface GpsMetric {
  id: string;
  title: string;
  unit: string;
  decimals: number;
  /** additive: halves sum to the game total (stackable) */
  additive: boolean;
  value: (r: GpsSession) => number | null;
}

const M_DISTANCE: GpsMetric = { id: "distance", title: "Total Distance", unit: "km", decimals: 2, additive: true, value: r => r.distanceKm ?? null };
const M_HSM: GpsMetric = { id: "hsm", title: "High Speed Metres (>18 km/h)", unit: "m", decimals: 0, additive: true, value: r => r.sprintDistanceM ?? null };
const M_VHS: GpsMetric = { id: "vhs", title: "Very High Speed Metres (>25 km/h)", unit: "m", decimals: 0, additive: true, value: r => (r.distanceZone5Km == null ? null : r.distanceZone5Km * 1000) };
const M_TOPSPEED: GpsMetric = { id: "topSpeed", title: "Top Speed", unit: "km/h", decimals: 1, additive: false, value: r => (r.topSpeedMs == null ? null : r.topSpeedMs * 3.6) };
const M_POWERPLAYS: GpsMetric = { id: "powerPlays", title: "Power Plays", unit: "", decimals: 0, additive: true, value: r => r.powerPlays ?? null };
const M_DPM: GpsMetric = { id: "dpm", title: "Distance Per Minute", unit: "m/min", decimals: 0, additive: false, value: r => r.distancePerMinMm ?? null };
const M_LOAD: GpsMetric = { id: "load", title: "Player Load", unit: "", decimals: 0, additive: true, value: r => r.playerLoad ?? null };

const PLAYER_METRICS = [M_DISTANCE, M_HSM, M_VHS, M_TOPSPEED, M_POWERPLAYS, M_DPM, M_LOAD];
const fmtV = (v: number | null | undefined, d: number, unit: string) =>
  v == null ? "—" : `${v.toFixed(d)}${unit ? ` ${unit}` : ""}`;

// ─────────────────────────────────────────────────────────────────────────────
// Row bundles: game + halves for one round (player tab) or one player (team tab)
// ─────────────────────────────────────────────────────────────────────────────

interface Bundle {
  key: string;          // round code or player name
  date: number | null;
  opponent: string | null;
  game?: GpsSession;
  h1?: GpsSession;
  h2?: GpsSession;
}

function buildBundles(rows: GpsSession[], keyOf: (r: GpsSession) => string): Bundle[] {
  const map = new Map<string, Bundle>();
  for (const r of rows) {
    const key = keyOf(r);
    if (!key) continue;
    let b = map.get(key);
    if (!b) {
      b = { key, date: parseDate(r.sessionDate), opponent: r.opponent ?? null };
      map.set(key, b);
    }
    if (r.splitName === "game") b.game = r;
    else if (r.splitName === "1st.half") b.h1 = r;
    else if (r.splitName === "2nd.half") b.h2 = r;
  }
  return [...map.values()];
}

/** Best-available total for a metric: game row first, else sum/max of halves. */
function bundleTotal(b: Bundle, m: GpsMetric): number | null {
  const g = b.game ? m.value(b.game) : null;
  if (g != null) return g;
  const v1 = b.h1 ? m.value(b.h1) : null;
  const v2 = b.h2 ? m.value(b.h2) : null;
  if (v1 == null && v2 == null) return null;
  return m.additive ? (v1 ?? 0) + (v2 ?? 0) : Math.max(v1 ?? -Infinity, v2 ?? -Infinity);
}

/** Accel/decel counts >3 m/s² = the 3–4 band plus the >4 band. */
function countOf(r: GpsSession | undefined, kind: "accel" | "decel"): number | null {
  if (!r) return null;
  const a = kind === "accel" ? r.accelCount34 : r.decelCount34;
  const b = kind === "accel" ? r.accelCountOver4 : r.decelCountOver4;
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/** Game-row count first, else sum of halves. */
function bundleCount(b: Bundle, kind: "accel" | "decel"): number | null {
  const g = countOf(b.game, kind);
  if (g != null) return g;
  const v1 = countOf(b.h1, kind);
  const v2 = countOf(b.h2, kind);
  if (v1 == null && v2 == null) return null;
  return (v1 ?? 0) + (v2 ?? 0);
}

const bundleMins = (b: Bundle): number | null =>
  b.game?.minsPlayed ?? (b.h1?.minsPlayed != null || b.h2?.minsPlayed != null
    ? (b.h1?.minsPlayed ?? 0) + (b.h2?.minsPlayed ?? 0) : null);

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function GpsInsights() {
  const [year, setYear] = useState("2026");

  // Meta query: all whole-game rows for the year → rounds, squads, player names
  const metaParams = { year, split: "game" };
  const { data: metaRows, isLoading } = useListGpsSessions(
    metaParams,
    { query: { queryKey: getListGpsSessionsQueryKey(metaParams) } },
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">GPS Insights</h1>
          <p className="text-muted-foreground text-sm mt-1">Running output from the wearable units — by player across the season, or the whole squad for one round.</p>
        </div>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
          <SelectContent>{YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">Loading GPS data…</CardContent></Card>
      ) : !metaRows?.length ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No GPS data for {year}.</CardContent></Card>
      ) : (
        <Tabs defaultValue="player" className="w-full">
          <TabsList className="flex w-full flex-wrap justify-start gap-1 h-auto">
            <TabsTrigger value="player">Player GPS</TabsTrigger>
            <TabsTrigger value="team">Team Overview</TabsTrigger>
          </TabsList>
          <TabsContent value="player" className="mt-6">
            <PlayerGpsTab year={year} metaRows={metaRows} />
          </TabsContent>
          <TabsContent value="team" className="mt-6">
            <TeamGpsTab year={year} metaRows={metaRows} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER TAB
// ─────────────────────────────────────────────────────────────────────────────

function PlayerGpsTab({ year, metaRows }: { year: string; metaRows: GpsSession[] }) {
  const names = useMemo(
    () => [...new Set(metaRows.map(r => r.playerName).filter((n): n is string => !!n))].sort(),
    [metaRows]);
  const [player, setPlayer] = useState("");
  useEffect(() => {
    if (!names.length) { if (player) setPlayer(""); }
    else if (!player || !names.includes(player)) setPlayer(names[0]);
  }, [names, player]);

  const params = { year, playerName: player };
  const { data: rows } = useListGpsSessions(
    params,
    { query: { enabled: !!player, queryKey: getListGpsSessionsQueryKey(params) } },
  );

  const bundles = useMemo(() => {
    const bs = buildBundles((rows ?? []).filter(r => r.tags === "game"), r => r.round ?? "");
    return bs.sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity)); // unknown dates last
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={player} onValueChange={setPlayer}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Player" /></SelectTrigger>
          <SelectContent>{names.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{bundles.length} games with GPS in {year}</p>
        <div className="ml-auto">
          <PlayerReportDialog player={player} year={year} bundles={bundles} />
        </div>
      </div>

      {bundles.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No games recorded for {player} in {year}.</CardContent></Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {PLAYER_METRICS.map(m => <PlayerChartCard key={m.id} metric={m} bundles={bundles} player={player} />)}
          <PlayerAccelCountCard bundles={bundles} player={player} />
          <PlayerAccelCard bundles={bundles} player={player} />
        </div>
      )}
    </div>
  );
}

// ── Player report (PPTX) ─────────────────────────────────────────────────────

const REPORT_BLURBS: Record<string, string> = {
  distance: "Total ground covered each game — the engine-room number.",
  hsm: "Metres covered above 18 km/h — the hard running that stretches defences.",
  vhs: "Metres covered above 25 km/h — genuine sprinting territory.",
  topSpeed: "The fastest moment recorded each game.",
  powerPlays: "Explosive efforts — short, sharp bursts of high power output.",
  dpm: "Work rate — metres covered for every minute on the pitch.",
  load: "Overall physical workload for the game, from every movement measured.",
};
const REPORT_SUMMABLE = new Set(["distance", "hsm", "vhs", "powerPlays"]);

function PlayerReportDialog({ player, year, bundles }: { player: string; year: string; bundles: Bundle[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(player);
  const [season, setSeason] = useState(`${year} Season`);
  const [team, setTeam] = useState("");
  const [note, setNote] = useState("");

  // Re-prefill whenever the dialog opens for the current selection
  useEffect(() => {
    if (!open) return;
    setName(player);
    setSeason(`${year} Season`);
    const squad = bundles.length ? squadOf(bundles[bundles.length - 1].key) : "1sts";
    setTeam(`Belconnen United FC — ${squad}`);
    setNote("");
    setError(null);
  }, [open, player, year, bundles]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { generatePlayerGpsReport } = await import("@/lib/playerGpsReport");
      const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
      await generatePlayerGpsReport({
        playerName: name.trim() || player,
        seasonLabel: season.trim() || `${year} Season`,
        teamLabel: team.trim() || "Belconnen United FC",
        coachNote: note,
        generatedOn: today,
        metrics: PLAYER_METRICS.map(m => ({
          id: m.id, title: m.title, unit: m.unit, decimals: m.decimals,
          blurb: REPORT_BLURBS[m.id] ?? "", summable: REPORT_SUMMABLE.has(m.id),
        })),
        games: bundles.map(b => ({
          round: b.key,
          opponent: b.opponent,
          dateLabel: b.game?.sessionDate ?? b.h1?.sessionDate ?? b.h2?.sessionDate ?? null,
          mins: bundleMins(b),
          values: Object.fromEntries(PLAYER_METRICS.map(m => [m.id, bundleTotal(b, m)])),
          accel: bundleCount(b, "accel"),
          decel: bundleCount(b, "decel"),
          maxAcc: b.game?.maxAccelerationMss ?? null,
          maxDec: b.game?.maxDecelerationMss ?? null,
        })),
      });
      setOpen(false);
    } catch (e) {
      setError("Something went wrong building the report. Please try again.");
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!player || bundles.length === 0}>
          <FileDown className="h-4 w-4 mr-1.5" /> Player report
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Player season report</DialogTitle>
          <DialogDescription>
            Builds a PowerPoint with every GPS chart for the season so far ({bundles.length} game{bundles.length === 1 ? "" : "s"}), ready to send to the player.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="rep-name">Player name (as it appears on the report)</Label>
            <Input id="rep-name" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rep-season">Season</Label>
              <Input id="rep-season" value={season} onChange={e => setSeason(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rep-team">Team</Label>
              <Input id="rep-team" value={team} onChange={e => setTeam(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep-note">A note from you (optional — goes on the final slide)</Label>
            <Textarea id="rep-note" rows={3} value={note} onChange={e => setNote(e.target.value)}
              placeholder="e.g. Great first half of the season — your work rate has jumped. Keep attacking those sprints." />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={generate} disabled={busy}>
            {busy ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Building…</> : <><FileDown className="h-4 w-4 mr-1.5" /> Create report</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LastNToggle({ lastN, setLastN }: { lastN: boolean; setLastN: (b: boolean) => void }) {
  return (
    <div className="flex rounded-md border overflow-hidden shrink-0">
      <Button variant={lastN ? "ghost" : "secondary"} size="sm" className="rounded-none h-7 px-2.5 text-xs" onClick={() => setLastN(false)}>All rounds</Button>
      <Button variant={lastN ? "secondary" : "ghost"} size="sm" className="rounded-none h-7 px-2.5 text-xs" onClick={() => setLastN(true)}>Last 4</Button>
    </div>
  );
}

function PlayerChartCard({ metric, bundles, player }: { metric: GpsMetric; bundles: Bundle[]; player: string }) {
  const [lastN, setLastN] = useState(false);

  const seasonAvg = useMemo(() => {
    const vals = bundles.map(b => bundleTotal(b, metric)).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [bundles, metric]);

  const shown = lastN ? bundles.slice(-4) : bundles;

  const data = useMemo(() => shown.map(b => {
    const v1 = b.h1 ? metric.value(b.h1) : null;
    const v2 = b.h2 ? metric.value(b.h2) : null;
    const total = bundleTotal(b, metric);
    // Only stack when BOTH halves are present — a lone half would render the
    // missing one as a false zero and understate the game.
    const stack = metric.additive && v1 != null && v2 != null;
    return {
      round: b.key,
      opponent: b.opponent,
      date: b.date,
      mins: bundleMins(b),
      h1: stack ? v1 : null,
      h2: stack ? v2 : null,
      single: stack ? null : total,
      total,
      m1: b.h1?.minsPlayed ?? null,
      m2: b.h2?.minsPlayed ?? null,
    };
  }), [shown, metric]);

  const anyHalves = data.some(d => d.h1 != null || d.h2 != null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">{metric.title}{metric.unit ? ` (${metric.unit})` : ""}</CardTitle>
          <CardDescription className="text-xs">
            Oldest → newest.{metric.additive ? " 1st half at the bottom, 2nd half stacked on top." : ""} Dashed line = {player}'s season average.
          </CardDescription>
        </div>
        <LastNToggle lastN={lastN} setLastN={setLastN} />
      </CardHeader>
      <CardContent className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="round" {...AXIS} angle={-40} textAnchor="end" interval={0} />
            <YAxis {...AXIS} fontSize={11} />
            <Tooltip content={<PlayerTooltip metric={metric} avg={seasonAvg} />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
            {seasonAvg != null && <ReferenceLine y={seasonAvg} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
            <Bar dataKey="h1" stackId="halves" name="1st half" fill={C_H1} hide={!anyHalves} />
            <Bar dataKey="h2" stackId="halves" name="2nd half" fill={C_H2} radius={[3, 3, 0, 0]} hide={!anyHalves} />
            <Bar dataKey="single" name={metric.title} fill={C_SINGLE} radius={[3, 3, 0, 0]} hide={!data.some(d => d.single != null)} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface PlayerTipPayload {
  round: string; opponent: string | null; mins: number | null;
  h1: number | null; h2: number | null; total: number | null;
  m1: number | null; m2: number | null;
}

function PlayerTooltip({ active, payload, metric, avg }: {
  active?: boolean; payload?: Array<{ payload: PlayerTipPayload }>;
  metric: GpsMetric; avg: number | null;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const vsAvg = d.total != null && avg ? ((d.total / avg - 1) * 100) : null;
  const perMin = metric.additive && d.total != null && d.mins ? d.total / d.mins : null;
  return (
    <div style={TOOLTIP_BOX}>
      <p className="font-semibold">{d.round}{d.opponent ? ` — vs ${d.opponent}` : ""}</p>
      {d.mins != null && <p className="text-muted-foreground">{Math.round(d.mins)} mins played</p>}
      <div className="mt-1 space-y-0.5">
        {d.h1 != null && <p><span style={{ color: C_H1 }}>●</span> 1st half: {fmtV(d.h1, metric.decimals, metric.unit)}{d.m1 ? ` (${Math.round(d.m1)} min)` : ""}</p>}
        {d.h2 != null && <p><span style={{ color: C_H2 }}>●</span> 2nd half: {fmtV(d.h2, metric.decimals, metric.unit)}{d.m2 ? ` (${Math.round(d.m2)} min)` : ""}</p>}
        <p className="font-medium">Game: {fmtV(d.total, metric.decimals, metric.unit)}</p>
        {perMin != null && <p className="text-muted-foreground">{perMin.toFixed(metric.decimals > 0 ? metric.decimals : 1)} {metric.unit || "units"}/min</p>}
        {vsAvg != null && (
          <p className="text-muted-foreground">{vsAvg >= 0 ? "▲" : "▼"} {Math.abs(vsAvg).toFixed(0)}% vs her season average</p>
        )}
      </div>
    </div>
  );
}

function Per10Toggle({ per10, setPer10 }: { per10: boolean; setPer10: (b: boolean) => void }) {
  return (
    <div className="flex rounded-md border overflow-hidden shrink-0">
      <Button variant={per10 ? "ghost" : "secondary"} size="sm" className="rounded-none h-7 px-2.5 text-xs" onClick={() => setPer10(false)}>Total</Button>
      <Button variant={per10 ? "secondary" : "ghost"} size="sm" className="rounded-none h-7 px-2.5 text-xs" onClick={() => setPer10(true)}>Per 10 min</Button>
    </div>
  );
}

interface AccelCountTip {
  label: string; opponent?: string | null; mins: number | null;
  acc: number | null; dec: number | null; accPer10: number | null; decPer10: number | null;
}

function AccelCountTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: AccelCountTip }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={TOOLTIP_BOX}>
      <p className="font-semibold">{d.label}{d.opponent ? ` — vs ${d.opponent}` : ""}</p>
      {d.mins != null && <p className="text-muted-foreground">{Math.round(d.mins)} mins played</p>}
      <div className="mt-1 space-y-0.5">
        <p><span style={{ color: C_ACC }}>●</span> Accelerations: {d.acc != null ? Math.round(d.acc) : "—"}</p>
        {d.accPer10 != null && <p className="text-muted-foreground pl-4">{d.accPer10.toFixed(1)} per 10 min</p>}
        <p><span style={{ color: C_DEC }}>●</span> Decelerations: {d.dec != null ? Math.round(d.dec) : "—"}</p>
        {d.decPer10 != null && <p className="text-muted-foreground pl-4">{d.decPer10.toFixed(1)} per 10 min</p>}
        {d.acc != null && d.dec != null && d.acc > 0 && (
          <p className="text-muted-foreground">{(d.dec / d.acc).toFixed(2)} decels per accel — {d.dec > d.acc ? "more braking than bursting" : "more bursting than braking"}</p>
        )}
      </div>
    </div>
  );
}

function PlayerAccelCountCard({ bundles, player }: { bundles: Bundle[]; player: string }) {
  const [lastN, setLastN] = useState(false);
  const [per10, setPer10] = useState(false);
  const shown = lastN ? bundles.slice(-4) : bundles;

  const data = useMemo(() => shown.map(b => {
    const acc = bundleCount(b, "accel");
    const dec = bundleCount(b, "decel");
    const mins = bundleMins(b);
    const accPer10 = acc != null && mins ? (acc / mins) * 10 : null;
    const decPer10 = dec != null && mins ? (dec / mins) * 10 : null;
    return {
      label: b.key, opponent: b.opponent, mins,
      acc, dec, accPer10, decPer10,
      accShow: per10 ? accPer10 : acc,
      decShow: per10 ? decPer10 : dec,
    };
  }), [shown, per10]);

  const hasData = data.some(d => d.acc != null || d.dec != null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">Accelerations / Decelerations &gt;3m/s²{per10 ? " (per 10 min)" : ""}</CardTitle>
          <CardDescription className="text-xs">
            How many hard bursts and hard stops per game. Per-10-min levels rounds where {player} played fewer minutes.
          </CardDescription>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Per10Toggle per10={per10} setPer10={setPer10} />
          <LastNToggle lastN={lastN} setLastN={setLastN} />
        </div>
      </CardHeader>
      <CardContent className="h-[280px]">
        {!hasData ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No accel/decel counts recorded for these games.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 30 }} barGap={1}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" {...AXIS} angle={-40} textAnchor="end" interval={0} />
              <YAxis {...AXIS} fontSize={11} />
              <Tooltip content={<AccelCountTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="accShow" name="Accelerations" fill={C_ACC} radius={[3, 3, 0, 0]} />
              <Bar dataKey="decShow" name="Decelerations" fill={C_DEC} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function PlayerAccelCard({ bundles, player }: { bundles: Bundle[]; player: string }) {
  const [lastN, setLastN] = useState(false);
  const shown = lastN ? bundles.slice(-4) : bundles;

  const data = shown.map(b => ({
    round: b.key,
    opponent: b.opponent,
    mins: bundleMins(b),
    acc: b.game?.maxAccelerationMss ?? null,
    dec: b.game?.maxDecelerationMss ?? null,
  }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">Max Acceleration / Deceleration (m/s²)</CardTitle>
          <CardDescription className="text-xs">
            A different lens: not how often, but how hard — each game's single hardest burst and hardest stop.
          </CardDescription>
        </div>
        <LastNToggle lastN={lastN} setLastN={setLastN} />
      </CardHeader>
      <CardContent className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 30 }} barGap={1}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="round" {...AXIS} angle={-40} textAnchor="end" interval={0} />
            <YAxis {...AXIS} fontSize={11} />
            <Tooltip cursor={{ fill: "hsl(var(--muted)/0.3)" }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as { round: string; opponent: string | null; mins: number | null; acc: number | null; dec: number | null };
              return (
                <div style={TOOLTIP_BOX}>
                  <p className="font-semibold">{d.round}{d.opponent ? ` — vs ${d.opponent}` : ""}</p>
                  {d.mins != null && <p className="text-muted-foreground">{Math.round(d.mins)} mins played</p>}
                  <p className="mt-1"><span style={{ color: C_ACC }}>●</span> Max acceleration: {fmtV(d.acc, 1, "m/s²")}</p>
                  <p><span style={{ color: C_DEC }}>●</span> Max deceleration: {fmtV(d.dec, 1, "m/s²")}</p>
                </div>
              );
            }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="acc" name="Max acceleration" fill={C_ACC} radius={[3, 3, 0, 0]} />
            <Bar dataKey="dec" name="Max deceleration" fill={C_DEC} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TEAM TAB
// ─────────────────────────────────────────────────────────────────────────────

function TeamGpsTab({ year, metaRows }: { year: string; metaRows: GpsSession[] }) {
  const [squad, setSquad] = useState("1sts");

  const roundsBySquad = useMemo(() => {
    const map = new Map<string, { round: string; date: number | null; opponent: string | null }>();
    for (const r of metaRows) {
      if (!r.round) continue;
      if (!map.has(r.round)) map.set(r.round, { round: r.round, date: parseDate(r.sessionDate), opponent: r.opponent ?? null });
    }
    const grouped = new Map<string, { round: string; date: number | null; opponent: string | null }[]>();
    for (const info of map.values()) {
      const s = squadOf(info.round);
      grouped.set(s, [...(grouped.get(s) ?? []), info]);
    }
    // newest first in dropdown; unknown dates last
    for (const list of grouped.values()) list.sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity));
    return grouped;
  }, [metaRows]);

  const availableSquads = SQUADS.filter(s => roundsBySquad.has(s));
  useEffect(() => {
    if (availableSquads.length && !availableSquads.includes(squad)) setSquad(availableSquads[0]);
  }, [availableSquads, squad]);

  const rounds = roundsBySquad.get(squad) ?? [];
  const [round, setRound] = useState("");
  useEffect(() => {
    if (!rounds.length) { if (round) setRound(""); }
    else if (!round || !rounds.some(r => r.round === round)) setRound(rounds[0].round);
  }, [rounds, round]);

  const params = { year, round };
  const { data: rows } = useListGpsSessions(
    params,
    { query: { enabled: !!round, queryKey: getListGpsSessionsQueryKey(params) } },
  );

  const bundles = useMemo(() => {
    const bs = buildBundles((rows ?? []).filter(r => r.tags === "game"), r => r.playerName ?? "");
    return bs;
  }, [rows]);

  const roundInfo = rounds.find(r => r.round === round);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={squad} onValueChange={setSquad}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>{availableSquads.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={round} onValueChange={setRound}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Round" /></SelectTrigger>
          <SelectContent>
            {rounds.map(r => <SelectItem key={r.round} value={r.round}>{r.round}{r.opponent ? ` — ${r.opponent}` : ""}</SelectItem>)}
          </SelectContent>
        </Select>
        {roundInfo && (
          <p className="text-sm text-muted-foreground">
            {bundles.length} players tracked{roundInfo.opponent ? ` vs ${roundInfo.opponent}` : ""}
          </p>
        )}
      </div>

      {bundles.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No GPS data for this round.</CardContent></Card>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {PLAYER_METRICS.map(m => <TeamChartCard key={m.id} metric={m} bundles={bundles} />)}
          <TeamAccelCountCard bundles={bundles} />
          <TeamAccelCard bundles={bundles} />
        </div>
      )}
    </div>
  );
}

type TeamView = "total" | "per10" | "halves";

function TeamViewToggle({ view, setView, additive }: { view: TeamView; setView: (v: TeamView) => void; additive: boolean }) {
  const opts: { v: TeamView; label: string }[] = additive
    ? [{ v: "total", label: "Total" }, { v: "per10", label: "Per 10 min" }, { v: "halves", label: "Halves" }]
    : [{ v: "total", label: "Game" }, { v: "halves", label: "Halves" }];
  return (
    <div className="flex rounded-md border overflow-hidden shrink-0">
      {opts.map(o => (
        <Button key={o.v} variant={view === o.v ? "secondary" : "ghost"} size="sm"
          className="rounded-none h-7 px-2.5 text-xs" onClick={() => setView(o.v)}>{o.label}</Button>
      ))}
    </div>
  );
}

function TeamChartCard({ metric, bundles }: { metric: GpsMetric; bundles: Bundle[] }) {
  const [view, setView] = useState<TeamView>("total");

  const data = useMemo(() => {
    const rows = bundles.map(b => {
      const total = bundleTotal(b, metric);
      const mins = bundleMins(b);
      const v1 = b.h1 ? metric.value(b.h1) : null;
      const v2 = b.h2 ? metric.value(b.h2) : null;
      const per10 = total != null && mins ? (total / mins) * 10 : null;
      const display = view === "per10" ? per10 : total;
      return {
        name: b.key, mins, total, per10, display,
        h1: v1, h2: v2,
        m1: b.h1?.minsPlayed ?? null, m2: b.h2?.minsPlayed ?? null,
      };
    }).filter(r => r.total != null);
    const sortVal = (r: typeof rows[number]) => (view === "per10" ? r.per10 : r.total) ?? -Infinity;
    return rows.sort((a, b) => sortVal(b) - sortVal(a));
  }, [bundles, metric, view]);

  const squadAvg = useMemo(() => {
    const vals = data.map(d => (view === "halves" ? d.total : d.display)).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [data, view]);

  const halvesStacked = metric.additive;
  const unitLabel = view === "per10" ? `${metric.unit || "units"} / 10 min` : metric.unit;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">{metric.title}{unitLabel ? ` (${unitLabel})` : ""}</CardTitle>
          <CardDescription className="text-xs">
            Biggest output on the left. Dashed line = squad average.
            {view === "per10" && " Per-10-min levels the field for players with fewer minutes."}
            {view === "halves" && (halvesStacked ? " 1st half at the bottom, 2nd half on top — a short top segment can mean fading late." : " 1st vs 2nd half side by side.")}
          </CardDescription>
        </div>
        <TeamViewToggle view={view} setView={setView} additive={metric.additive} />
      </CardHeader>
      <CardContent className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 35 }} barGap={1}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" {...AXIS} angle={-45} textAnchor="end" interval={0} />
            <YAxis {...AXIS} fontSize={11} />
            <Tooltip content={<TeamTooltip metric={metric} view={view} avg={squadAvg} />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
            {view !== "halves" && squadAvg != null && <ReferenceLine y={squadAvg} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
            <Bar dataKey="display" name={metric.title} fill={C_SINGLE} radius={[3, 3, 0, 0]} hide={view === "halves"} />
            <Bar dataKey="h1" stackId={halvesStacked ? "h" : undefined} name="1st half" fill={C_H1} hide={view !== "halves"} />
            <Bar dataKey="h2" stackId={halvesStacked ? "h" : undefined} name="2nd half" fill={C_H2} radius={[3, 3, 0, 0]} hide={view !== "halves"} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface TeamTipPayload {
  name: string; mins: number | null; total: number | null; per10: number | null;
  h1: number | null; h2: number | null; m1: number | null; m2: number | null;
}

function TeamTooltip({ active, payload, metric, view, avg }: {
  active?: boolean; payload?: Array<{ payload: TeamTipPayload }>;
  metric: GpsMetric; view: TeamView; avg: number | null;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const compare = view === "per10" ? d.per10 : d.total;
  const vsAvg = compare != null && avg ? ((compare / avg - 1) * 100) : null;
  const fade = metric.additive && d.h1 != null && d.h2 != null && d.h1 > 0
    ? ((d.h2 - d.h1) / d.h1) * 100 : null;
  return (
    <div style={TOOLTIP_BOX}>
      <p className="font-semibold">{d.name}</p>
      {d.mins != null && <p className="text-muted-foreground">{Math.round(d.mins)} mins played</p>}
      <div className="mt-1 space-y-0.5">
        <p className="font-medium">Game: {fmtV(d.total, metric.decimals, metric.unit)}</p>
        {d.per10 != null && metric.additive && <p className="text-muted-foreground">{fmtV(d.per10, metric.decimals, metric.unit)} per 10 min</p>}
        {d.h1 != null && <p><span style={{ color: C_H1 }}>●</span> 1st half: {fmtV(d.h1, metric.decimals, metric.unit)}{d.m1 ? ` (${Math.round(d.m1)} min)` : ""}</p>}
        {d.h2 != null && <p><span style={{ color: C_H2 }}>●</span> 2nd half: {fmtV(d.h2, metric.decimals, metric.unit)}{d.m2 ? ` (${Math.round(d.m2)} min)` : ""}</p>}
        {fade != null && metric.additive && (
          <p className="text-muted-foreground">2nd half {fade >= 0 ? "up" : "down"} {Math.abs(fade).toFixed(0)}% on the 1st</p>
        )}
        {vsAvg != null && <p className="text-muted-foreground">{vsAvg >= 0 ? "▲" : "▼"} {Math.abs(vsAvg).toFixed(0)}% vs squad average</p>}
      </div>
    </div>
  );
}

function TeamAccelCountCard({ bundles }: { bundles: Bundle[] }) {
  const [per10, setPer10] = useState(false);

  const data = useMemo(() =>
    bundles.map(b => {
      const acc = bundleCount(b, "accel");
      const dec = bundleCount(b, "decel");
      const mins = bundleMins(b);
      const accPer10 = acc != null && mins ? (acc / mins) * 10 : null;
      const decPer10 = dec != null && mins ? (dec / mins) * 10 : null;
      return {
        label: b.key, mins, acc, dec, accPer10, decPer10,
        accShow: per10 ? accPer10 : acc,
        decShow: per10 ? decPer10 : dec,
      };
    })
      .filter(d => d.acc != null || d.dec != null)
      .sort((a, b) => ((per10 ? b.accShow : b.acc) ?? 0) - ((per10 ? a.accShow : a.acc) ?? 0)),
    [bundles, per10]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">Accelerations / Decelerations &gt;3m/s²{per10 ? " (per 10 min)" : ""}</CardTitle>
          <CardDescription className="text-xs">
            Hard bursts and hard stops per player. Per-10-min levels the field for players with fewer minutes.
          </CardDescription>
        </div>
        <Per10Toggle per10={per10} setPer10={setPer10} />
      </CardHeader>
      <CardContent className="h-[300px]">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No accel/decel counts recorded for this round.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 35 }} barGap={1}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" {...AXIS} angle={-45} textAnchor="end" interval={0} />
              <YAxis {...AXIS} fontSize={11} />
              <Tooltip content={<AccelCountTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="accShow" name="Accelerations" fill={C_ACC} radius={[3, 3, 0, 0]} />
              <Bar dataKey="decShow" name="Decelerations" fill={C_DEC} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function TeamAccelCard({ bundles }: { bundles: Bundle[] }) {
  const data = useMemo(() =>
    bundles
      .map(b => ({
        name: b.key,
        mins: bundleMins(b),
        acc: b.game?.maxAccelerationMss ?? null,
        dec: b.game?.maxDecelerationMss ?? null,
      }))
      .filter(d => d.acc != null || d.dec != null)
      .sort((a, b) => (b.acc ?? 0) - (a.acc ?? 0)),
    [bundles]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Max Acceleration / Deceleration (m/s²)</CardTitle>
        <CardDescription className="text-xs">
          A different lens: not how often, but how hard — each player's single hardest burst and hardest stop.
        </CardDescription>
      </CardHeader>
      <CardContent className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 35 }} barGap={1}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" {...AXIS} angle={-45} textAnchor="end" interval={0} />
            <YAxis {...AXIS} fontSize={11} />
            <Tooltip cursor={{ fill: "hsl(var(--muted)/0.3)" }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as { name: string; mins: number | null; acc: number | null; dec: number | null };
              return (
                <div style={TOOLTIP_BOX}>
                  <p className="font-semibold">{d.name}</p>
                  {d.mins != null && <p className="text-muted-foreground">{Math.round(d.mins)} mins played</p>}
                  <p className="mt-1"><span style={{ color: C_ACC }}>●</span> Max acceleration: {fmtV(d.acc, 1, "m/s²")}</p>
                  <p><span style={{ color: C_DEC }}>●</span> Max deceleration: {fmtV(d.dec, 1, "m/s²")}</p>
                </div>
              );
            }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="acc" name="Max acceleration" fill={C_ACC} radius={[3, 3, 0, 0]} />
            <Bar dataKey="dec" name="Max deceleration" fill={C_DEC} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
