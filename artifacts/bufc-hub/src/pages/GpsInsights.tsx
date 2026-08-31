import React, { useState, useMemo, useEffect } from "react";
import {
  useListGpsSessions,
  getListGpsSessionsQueryKey,
  useListGpsPlayerPositions,
  getListGpsPlayerPositionsQueryKey,
  useListGpsPlayerEmails,
  getListGpsPlayerEmailsQueryKey,
  useListGpsOpponentMismatches,
  getListGpsOpponentMismatchesQueryKey,
  useListLeagues,
  getListLeaguesQueryKey,
  saveGpsPlayerEmails,
  sendGpsReportEmail,
  type GpsSession,
} from "@workspace/api-client-react";
import type { ReportComparison } from "@/lib/playerGpsReport";
import { Checkbox } from "@/components/ui/checkbox";
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
import { FileDown, Loader2, Mail, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { NoAccess } from "@/components/NoAccess";
import { useActiveLeague, useViewingTeam } from "@/contexts/LeagueContext";
import { GpsMatchReportTab } from "@/components/GpsMatchReportTab";
import { gpsPeriodMinutes, gpsPeriodTotal } from "@workspace/api-zod";

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

const YEARS = ["2026", "2025", "2024"];

const C_H1 = "hsl(var(--chart-1))";
const C_H2 = "hsl(var(--chart-2))";
const C_ET = "hsl(var(--chart-4))";
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
// m/s view of the same metric — raw GPS units, for coaches converting from m/s.
const M_TOPSPEED_MS: GpsMetric = { id: "topSpeed", title: "Top Speed", unit: "m/s", decimals: 2, additive: false, value: r => r.topSpeedMs ?? null };

function SpeedUnitToggle({ ms, setMs }: { ms: boolean; setMs: (v: boolean) => void }) {
  return (
    <div className="flex rounded-md border overflow-hidden shrink-0">
      <Button variant={ms ? "ghost" : "secondary"} size="sm" className="rounded-none h-7 px-2.5 text-xs" onClick={() => setMs(false)}>km/h</Button>
      <Button variant={ms ? "secondary" : "ghost"} size="sm" className="rounded-none h-7 px-2.5 text-xs" onClick={() => setMs(true)}>m/s</Button>
    </div>
  );
}
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
  et?: GpsSession;
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
    else if (r.splitName?.toLowerCase() === "extra-time") b.et = r;
  }
  return [...map.values()];
}

/** Best-available total: authoritative game row first, else sum/max of all periods. */
function bundleTotal(b: Bundle, m: GpsMetric): number | null {
  return gpsPeriodTotal(b, m.value, m.additive);
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
  return gpsPeriodTotal(b, r => countOf(r, kind), true);
}

const bundleMins = (b: Bundle): number | null =>
  gpsPeriodMinutes(b, r => r.minsPlayed);

const bundleMaxField = (b: Bundle, value: (r: GpsSession) => number | null | undefined): number | null => {
  const game = b.game ? value(b.game) : null;
  if (game != null) return game;
  const values = [b.h1, b.h2, b.et].map(r => r ? value(r) : null).filter((v): v is number => v != null);
  return values.length ? Math.max(...values) : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Admin-only warning: rounds where the Catapult-carried opponent on the GPS
 * rows disagrees with the football fixture for the same round/squad/year —
 * one of them is mislabelled and would otherwise go unnoticed.
 */
function OpponentMismatchWarning({ year }: { year: string }) {
  const { isSuperadmin, hasModuleAnywhere } = useLeagueModules();
  const isAdmin = isSuperadmin || hasModuleAnywhere("data-entry");
  const { activeLeagueId } = useActiveLeague();
  const params = { leagueId: activeLeagueId ?? 0, year };
  const { data: mismatches } = useListGpsOpponentMismatches(
    params,
    { query: { enabled: isAdmin && activeLeagueId != null, queryKey: getListGpsOpponentMismatchesQueryKey(params) } },
  );

  if (!isAdmin || !mismatches?.length) return null;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
        <div className="space-y-1.5 text-sm">
          <p className="font-semibold">
            GPS opponent doesn't match the fixture for {mismatches.length === 1 ? "1 round" : `${mismatches.length} rounds`}
          </p>
          <ul className="space-y-0.5 text-muted-foreground">
            {mismatches.map(m => (
              <li key={`${m.year}-${m.round}`}>
                <span className="font-medium text-foreground">{m.round}</span> ({m.squad}): GPS file says{" "}
                <span className="font-medium text-foreground">{m.gpsOpponent}</span>, but the fixture is{" "}
                <span className="font-medium text-foreground">{m.fixtureOpponent}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            One of them is mislabelled — check the Catapult export or the fixture, then re-upload the round's GPS data with the right opponent.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function GpsInsights() {
  const [year, setYear] = useState("2026");
  const { hasModule, ready } = useLeagueModules();
  const { activeLeagueId } = useActiveLeague();

  // Meta query includes period-only matches too, so rounds remain discoverable
  // when Catapult did not provide an authoritative whole-game row.
  const metaParams = { leagueId: activeLeagueId ?? 0, year };
  const { data: metaRows, isLoading } = useListGpsSessions(
    metaParams,
    { query: { enabled: activeLeagueId != null, queryKey: getListGpsSessionsQueryKey(metaParams) } },
  );

  if (ready && activeLeagueId != null && !hasModule(activeLeagueId, "gps")) return <NoAccess />;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">GPS Insights</h1>
          <p className="text-muted-foreground text-sm mt-1">Running output from the wearable units — by player across the season, or the whole squad for one round.</p>
        </div>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-[110px] max-w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <OpponentMismatchWarning year={year} />

      {isLoading ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">Loading GPS data…</CardContent></Card>
      ) : !metaRows?.length ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No GPS data for {year}.</CardContent></Card>
      ) : (
        <Tabs defaultValue="player" className="w-full">
          <TabsList className="flex w-full flex-wrap justify-start gap-1 h-auto">
            <TabsTrigger value="player">Player GPS</TabsTrigger>
            <TabsTrigger value="team">Team Overview</TabsTrigger>
            <TabsTrigger value="matchReport">Match Report</TabsTrigger>
          </TabsList>
          <TabsContent value="player" className="mt-6">
            <PlayerGpsTab year={year} metaRows={metaRows} />
          </TabsContent>
          <TabsContent value="team" className="mt-6">
            <TeamGpsTab year={year} metaRows={metaRows} />
          </TabsContent>
          <TabsContent value="matchReport" className="mt-6">
            <GpsMatchReportTab year={year} metaRows={metaRows} />
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

  const { activeLeagueId } = useActiveLeague();
  const params = { leagueId: activeLeagueId ?? 0, year, playerName: player };
  const { data: rows } = useListGpsSessions(
    params,
    { query: { enabled: !!player && activeLeagueId != null, queryKey: getListGpsSessionsQueryKey(params) } },
  );

  const bundles = useMemo(() => {
    const bs = buildBundles((rows ?? []).filter(r => r.tags === "game"), r => r.round ?? "");
    return bs.sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity)); // unknown dates last
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={player} onValueChange={setPlayer}>
          <SelectTrigger className="w-[200px] max-w-full"><SelectValue placeholder="Player" /></SelectTrigger>
          <SelectContent>{names.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-sm text-muted-foreground">{bundles.length} games with GPS in {year}</p>
        <div className="ml-auto flex items-center gap-2">
          <EmailReportsDialog year={year} />
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

/** Average per-game numbers for a group of player-game bundles (a squad or a position). */
function groupAverages(label: string, bs: Bundle[]): ReportComparison {
  const mean = (vals: (number | null)[]): number | null => {
    const ok = vals.filter((v): v is number => v != null);
    return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
  };
  return {
    label,
    games: bs.length,
    mins: mean(bs.map(b => bundleMins(b))),
    values: Object.fromEntries(PLAYER_METRICS.map(m => [m.id, mean(bs.map(b => bundleTotal(b, m)))])),
    accel: mean(bs.map(b => bundleCount(b, "accel"))),
    decel: mean(bs.map(b => bundleCount(b, "decel"))),
    maxAcc: mean(bs.map(b => bundleMaxField(b, r => r.maxAccelerationMss))),
    maxDec: mean(bs.map(b => bundleMaxField(b, r => r.maxDecelerationMss))),
  };
}

const plural = (pos: string) => (pos === "GK" ? "GKs" : `${pos}s`);
/** Squad seniority, youngest first — a player defaults to seeing her own squad and everything above it. */
const SQUAD_LADDER = ["17s / 18s", "Reserves", "1sts"];

function PlayerReportDialog({ player, year, bundles }: { player: string; year: string; bundles: Bundle[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(player);
  const [season, setSeason] = useState(`${year} Season`);
  const [team, setTeam] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [defaultsSet, setDefaultsSet] = useState(false);

  const playerSquad = bundles.length ? squadOf(bundles[bundles.length - 1].key) : "1sts";

  // Everyone's games this year + positions — only fetched while the dialog is open
  const { activeLeagueId } = useActiveLeague();
  const allParams = { leagueId: activeLeagueId ?? 0, year };
  const { data: allRows, isLoading: loadingAll } = useListGpsSessions(
    allParams,
    { query: { enabled: open && activeLeagueId != null, queryKey: getListGpsSessionsQueryKey(allParams) } },
  );
  const { data: positions, isLoading: loadingPos } = useListGpsPlayerPositions(
    { query: { enabled: open, queryKey: getListGpsPlayerPositionsQueryKey() } },
  );

  // GPS-fed league (e.g. Reserves): also pull the source league's 1sts rows so
  // the report can offer 1st-grade averages alongside the squad's own.
  const { data: leagues } = useListLeagues(
    { query: { enabled: open, queryKey: getListLeaguesQueryKey() } },
  );
  const activeLeague = (leagues ?? []).find(l => l.id === activeLeagueId);
  const isFedLeague = activeLeague?.gpsSourceLeagueId != null;
  const firstsParams = { leagueId: activeLeagueId ?? 0, year, squad: "1sts" };
  const { data: firstsRows, isLoading: loadingFirsts } = useListGpsSessions(
    firstsParams,
    { query: { enabled: open && activeLeagueId != null && isFedLeague, queryKey: getListGpsSessionsQueryKey(firstsParams) } },
  );

  const loadingAverages = open && (loadingAll || loadingPos || (isFedLeague && loadingFirsts));

  // Every player-game bundle in the year, tagged with its player + squad
  const allBundles = useMemo(() => {
    const byPlayer = new Map<string, GpsSession[]>();
    const pooled = [...(allRows ?? []), ...(isFedLeague ? firstsRows ?? [] : [])];
    for (const r of pooled.filter(r => r.tags === "game")) {
      if (!r.playerName) continue;
      byPlayer.set(r.playerName, [...(byPlayer.get(r.playerName) ?? []), r]);
    }
    const out: { player: string; squad: string; bundle: Bundle }[] = [];
    for (const [p, rows] of byPlayer) {
      for (const b of buildBundles(rows, r => r.round ?? "")) {
        out.push({ player: p, squad: squadOf(b.key), bundle: b });
      }
    }
    return out;
  }, [allRows, firstsRows, isFedLeague]);

  const posOf = useMemo(
    () => new Map((positions ?? []).map(p => [p.playerName, p.position])),
    [positions]);

  // Available comparison groups: each squad with data, plus the player's position (all squads)
  const groups = useMemo(() => {
    const out: { key: string; title: string; comparison: ReportComparison }[] = [];
    for (const squad of SQUAD_LADDER) {
      const bs = allBundles.filter(e => e.squad === squad).map(e => e.bundle);
      if (bs.length) out.push({ key: squad, title: `${squad} average`, comparison: groupAverages(`${squad} average`, bs) });
    }
    // One position group per squad (e.g. "1sts Midfielders"), so a player can
    // see where she sits against her position at each grade.
    const pos = posOf.get(player);
    if (pos) {
      for (const squad of SQUAD_LADDER) {
        const bs = allBundles
          .filter(e => e.squad === squad && posOf.get(e.player) === pos)
          .map(e => e.bundle);
        if (bs.length) {
          const title = `${squad} ${plural(pos)} average`;
          out.push({ key: `pos:${squad}`, title, comparison: groupAverages(title, bs) });
        }
      }
    }
    return out;
  }, [allBundles, posOf, player]);

  // Re-prefill whenever the dialog opens for the current selection
  useEffect(() => {
    if (!open) return;
    setName(player);
    setSeason(`${year} Season`);
    setTeam(`Belconnen United FC — ${playerSquad}`);
    setNote("");
    setError(null);
    setDefaultsSet(false);
  }, [open, player, year, playerSquad]);

  // Default ticks once the data is in: own squad + squads above it + own position
  useEffect(() => {
    if (!open || defaultsSet || loadingAverages) return;
    const fromRung = SQUAD_LADDER.indexOf(playerSquad);
    const defaults = new Set<string>();
    for (const g of groups) {
      const squad = g.key.startsWith("pos:") ? g.key.slice(4) : g.key;
      if (SQUAD_LADDER.indexOf(squad) >= fromRung) defaults.add(g.key);
    }
    setSelected(defaults);
    setDefaultsSet(true);
  }, [open, defaultsSet, loadingAverages, groups, playerSquad]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const { generatePlayerGpsReport } = await import("@/lib/playerGpsReport");
      const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
      await generatePlayerGpsReport({
        playerName: name.trim() || player,
        position: posOf.get(player) ?? null,
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
          dateLabel: b.game?.sessionDate ?? b.h1?.sessionDate ?? b.h2?.sessionDate ?? b.et?.sessionDate ?? null,
          mins: bundleMins(b),
          values: Object.fromEntries(PLAYER_METRICS.map(m => [m.id, bundleTotal(b, m)])),
          accel: bundleCount(b, "accel"),
          decel: bundleCount(b, "decel"),
          maxAcc: bundleMaxField(b, r => r.maxAccelerationMss),
          maxDec: bundleMaxField(b, r => r.maxDecelerationMss),
        })),
        comparisons: groups.filter(g => selected.has(g.key)).map(g => g.comparison),
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
            <Label>Averages to show in the report</Label>
            {loadingAverages ? (
              <p className="text-xs text-muted-foreground">Working out the averages…</p>
            ) : groups.length === 0 ? (
              <p className="text-xs text-muted-foreground">No averages available for {year}.</p>
            ) : (
              <div className="space-y-1.5 rounded-md border p-3">
                {groups.map(g => (
                  <label key={g.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={selected.has(g.key)}
                      onCheckedChange={checked => {
                        setSelected(prev => {
                          const next = new Set(prev);
                          if (checked === true) next.add(g.key); else next.delete(g.key);
                          return next;
                        });
                      }}
                    />
                    <span>{g.title}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{g.comparison.games} player-games</span>
                  </label>
                ))}
                {!posOf.get(player) && !loadingAverages && (
                  <p className="text-xs text-muted-foreground pt-1">
                    No position set for {player} yet — add positions in Data Entry to unlock position averages.
                  </p>
                )}
              </div>
            )}
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

// ── Bulk email reports ───────────────────────────────────────────────────────

const FROM_OPTIONS = [
  "BUFC Performance Hub <noreply@gameinsights.com.au>",
  "Scott Conlon <scott@gameinsights.com.au>",
];

type SendState = { status: "pending" | "sending" | "sent" | "failed"; reason?: string };

function EmailReportsDialog({ year }: { year: string }) {
  const [open, setOpen] = useState(false);
  const { isSuperadmin, hasModuleAnywhere } = useLeagueModules();
  const isAdmin = isSuperadmin || hasModuleAnywhere("data-entry");

  const { activeLeagueId } = useActiveLeague();
  const allParams = { leagueId: activeLeagueId ?? 0, year };
  const { data: allRows, isLoading: loadingAll } = useListGpsSessions(
    allParams,
    { query: { enabled: open && activeLeagueId != null, queryKey: getListGpsSessionsQueryKey(allParams) } },
  );
  const { data: positions } = useListGpsPlayerPositions(
    { query: { enabled: open, queryKey: getListGpsPlayerPositionsQueryKey() } },
  );
  const { data: emails, refetch: refetchEmails } = useListGpsPlayerEmails(
    { query: { enabled: open && isAdmin, queryKey: getListGpsPlayerEmailsQueryKey() } },
  );

  const posOf = useMemo(() => new Map((positions ?? []).map(p => [p.playerName, p.position])), [positions]);
  const savedEmailOf = useMemo(() => new Map((emails ?? []).map(e => [e.playerName, e.email])), [emails]);

  // All player-game bundles for the year, per player, plus each player's squad (latest game wins)
  const byPlayer = useMemo(() => {
    const rowsByPlayer = new Map<string, GpsSession[]>();
    for (const r of (allRows ?? []).filter(r => r.tags === "game")) {
      if (!r.playerName) continue;
      rowsByPlayer.set(r.playerName, [...(rowsByPlayer.get(r.playerName) ?? []), r]);
    }
    const out = new Map<string, { bundles: Bundle[]; squad: string }>();
    for (const [p, rows] of rowsByPlayer) {
      const bs = buildBundles(rows, r => r.round ?? "").sort((a, b) => (a.date ?? Infinity) - (b.date ?? Infinity));
      if (bs.length) out.set(p, { bundles: bs, squad: squadOf(bs[bs.length - 1].key) });
    }
    return out;
  }, [allRows]);

  const allBundleEntries = useMemo(() => {
    const out: { player: string; squad: string; bundle: Bundle }[] = [];
    for (const [p, info] of byPlayer) for (const b of info.bundles) out.push({ player: p, squad: squadOf(b.key), bundle: b });
    return out;
  }, [byPlayer]);

  const players = useMemo(() =>
    [...byPlayer.keys()].sort((a, b) =>
      SQUAD_LADDER.indexOf(byPlayer.get(b)!.squad) - SQUAD_LADDER.indexOf(byPlayer.get(a)!.squad) || a.localeCompare(b)),
    [byPlayer]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [emailEdits, setEmailEdits] = useState<Map<string, string>>(new Map());
  const emailOf = (p: string) => (emailEdits.has(p) ? emailEdits.get(p)! : savedEmailOf.get(p) ?? "");

  // Averages: squad averages are global ticks; position averages follow each player's own position
  const [squadTicks, setSquadTicks] = useState<Set<string>>(new Set(SQUAD_LADDER));
  const [includePosAvgs, setIncludePosAvgs] = useState(true);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [from, setFrom] = useState(FROM_OPTIONS[0]);
  const [sharedNote, setSharedNote] = useState("");
  const [perPlayerNotes, setPerPlayerNotes] = useState(false);
  const [noteEdits, setNoteEdits] = useState<Map<string, string>>(new Map());
  const noteFor = (p: string) => {
    const own = perPlayerNotes ? (noteEdits.get(p) ?? "").trim() : "";
    return own || sharedNote.trim();
  };
  const [sendStates, setSendStates] = useState<Map<string, SendState>>(new Map());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setEmailEdits(new Map());
    setSendStates(new Map());
    setSquadTicks(new Set(SQUAD_LADDER));
    setIncludePosAvgs(true);
    setSharedNote("");
    setPerPlayerNotes(false);
    setNoteEdits(new Map());
    setSubject(`Your ${year} GPS report`);
    setBody("Hi,\n\nAttached is your personalised GPS report for the season so far. Have a look at how you're tracking and bring any questions to training.\n\nCheers,\nScott");
    setFrom(FROM_OPTIONS[0]);
    setBusy(false);
    setDone(false);
  }, [open, year]);

  const toggle = (p: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(p)) next.delete(p); else next.add(p);
    return next;
  });
  const selectWhere = (pred: (p: string) => boolean) => setSelected(prev => {
    const next = new Set(prev);
    let allIn = true;
    for (const p of players) if (pred(p) && !next.has(p)) { allIn = false; break; }
    for (const p of players) if (pred(p)) { if (allIn) next.delete(p); else next.add(p); }
    return next;
  });

  const buildComparisons = (player: string): ReportComparison[] => {
    const out: ReportComparison[] = [];
    for (const squad of SQUAD_LADDER) {
      if (!squadTicks.has(squad)) continue;
      const bs = allBundleEntries.filter(e => e.squad === squad).map(e => e.bundle);
      if (bs.length) out.push(groupAverages(`${squad} average`, bs));
    }
    const pos = posOf.get(player);
    if (includePosAvgs && pos) {
      for (const squad of SQUAD_LADDER) {
        if (!squadTicks.has(squad)) continue;
        const bs = allBundleEntries.filter(e => e.squad === squad && posOf.get(e.player) === pos).map(e => e.bundle);
        if (bs.length) out.push(groupAverages(`${squad} ${plural(pos)} average`, bs));
      }
    }
    return out;
  };

  const send = async () => {
    if (activeLeagueId == null) return;
    setBusy(true);
    setDone(false);
    const targets = players.filter(p => selected.has(p));
    // Save any email edits first so the addresses used are the addresses stored
    const edits = [...emailEdits.entries()].map(([playerName, email]) => ({ playerName, email: email.trim() || null }));
    try {
      if (edits.length) { await saveGpsPlayerEmails(edits); await refetchEmails(); setEmailEdits(new Map()); }
    } catch {
      setBusy(false);
      setDone(true);
      setSendStates(new Map(targets.map(p => [p, { status: "failed" as const, reason: "Couldn't save the email edits — check the addresses and try again" }])));
      return;
    }
    const states = new Map<string, SendState>(targets.map(p => [p, { status: "pending" as const }]));
    setSendStates(new Map(states));

    const { generatePlayerGpsReport } = await import("@/lib/playerGpsReport");
    const today = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

    for (const p of targets) {
      const email = emailOf(p).trim();
      if (!email) {
        states.set(p, { status: "failed", reason: "No email on file" });
        setSendStates(new Map(states));
        continue;
      }
      states.set(p, { status: "sending" });
      setSendStates(new Map(states));
      try {
        const info = byPlayer.get(p)!;
        const { fileName, base64 } = await generatePlayerGpsReport({
          playerName: p,
          position: posOf.get(p) ?? null,
          seasonLabel: `${year} Season`,
          teamLabel: `Belconnen United FC — ${info.squad}`,
          coachNote: noteFor(p),
          generatedOn: today,
          metrics: PLAYER_METRICS.map(m => ({
            id: m.id, title: m.title, unit: m.unit, decimals: m.decimals,
            blurb: REPORT_BLURBS[m.id] ?? "", summable: REPORT_SUMMABLE.has(m.id),
          })),
          games: info.bundles.map(b => ({
            round: b.key,
            opponent: b.opponent,
            dateLabel: b.game?.sessionDate ?? b.h1?.sessionDate ?? b.h2?.sessionDate ?? b.et?.sessionDate ?? null,
            mins: bundleMins(b),
            values: Object.fromEntries(PLAYER_METRICS.map(m => [m.id, bundleTotal(b, m)])),
            accel: bundleCount(b, "accel"),
            decel: bundleCount(b, "decel"),
            maxAcc: bundleMaxField(b, r => r.maxAccelerationMss),
            maxDec: bundleMaxField(b, r => r.maxDecelerationMss),
          })),
          comparisons: buildComparisons(p),
        }, "base64");
        await sendGpsReportEmail({
          to: email,
          subject: subject.trim() || `Your ${year} GPS report`,
          body,
          from,
          fileName,
          pptxBase64: base64!,
          leagueId: activeLeagueId,
        });
        states.set(p, { status: "sent" });
      } catch (e) {
        console.error(e);
        states.set(p, { status: "failed", reason: "Send failed" });
      }
      setSendStates(new Map(states));
    }
    setBusy(false);
    setDone(true);
  };

  if (!isAdmin) return null;

  const positionsPresent = [...new Set(players.map(p => posOf.get(p)))].filter((p): p is NonNullable<typeof p> => p != null);
  const sentCount = [...sendStates.values()].filter(s => s.status === "sent").length;
  const failedCount = [...sendStates.values()].filter(s => s.status === "failed").length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) setOpen(v); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Mail className="h-4 w-4 mr-1.5" /> Email reports
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email player reports</DialogTitle>
          <DialogDescription>
            Builds each ticked player's personalised {year} report and emails it to them as a PowerPoint attachment.
          </DialogDescription>
        </DialogHeader>
        {loadingAll ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading players…</p>
        ) : (
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Label className="mr-1">Players</Label>
                <Button variant="secondary" size="sm" className="h-6 px-2 text-xs" onClick={() => selectWhere(() => true)}>All</Button>
                {SQUAD_LADDER.map(s => (
                  <Button key={s} variant="secondary" size="sm" className="h-6 px-2 text-xs"
                    onClick={() => selectWhere(p => byPlayer.get(p)!.squad === s)}>{s}</Button>
                ))}
                {positionsPresent.map(pos => (
                  <Button key={pos} variant="secondary" size="sm" className="h-6 px-2 text-xs"
                    onClick={() => selectWhere(p => posOf.get(p) === pos)}>{plural(pos)}</Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">Tap a filter to tick that group (tap again to untick). Fix or add an email right in the list — it's saved when you send.</p>
              <div className="rounded-md border divide-y max-h-64 overflow-y-auto">
                {players.map(p => {
                  const st = sendStates.get(p);
                  return (
                    <div key={p} className="flex items-center gap-2 px-3 py-1.5">
                      <Checkbox checked={selected.has(p)} onCheckedChange={() => toggle(p)} disabled={busy} />
                      <button className="text-sm text-left min-w-0 shrink-0 w-28 truncate" onClick={() => !busy && toggle(p)}>{p}</button>
                      <span className="text-[10px] text-muted-foreground w-20 shrink-0 truncate">
                        {byPlayer.get(p)!.squad}{posOf.get(p) ? ` · ${posOf.get(p)}` : ""}
                      </span>
                      <Input
                        value={emailOf(p)}
                        onChange={e => setEmailEdits(prev => new Map(prev).set(p, e.target.value))}
                        placeholder="No email on file"
                        disabled={busy}
                        className="h-7 text-xs flex-1 min-w-0"
                      />
                      <span className="w-5 shrink-0 flex justify-center">
                        {st?.status === "sending" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                        {st?.status === "sent" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                        {st?.status === "failed" && (
                          <span title={st.reason}><XCircle className="h-3.5 w-3.5 text-destructive" /></span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">{selected.size} of {players.length} players ticked</p>
            </div>

            <div className="space-y-1.5">
              <Label>Averages to include in every report</Label>
              <div className="space-y-1.5 rounded-md border p-3">
                {SQUAD_LADDER.map(s => (
                  <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={squadTicks.has(s)} disabled={busy}
                      onCheckedChange={checked => setSquadTicks(prev => {
                        const next = new Set(prev);
                        if (checked === true) next.add(s); else next.delete(s);
                        return next;
                      })} />
                    <span>{s} average</span>
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={includePosAvgs} disabled={busy} onCheckedChange={c => setIncludePosAvgs(c === true)} />
                  <span>Each player's own position average (per ticked squad)</span>
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="em-from">Send from</Label>
              <Select value={from} onValueChange={setFrom} disabled={busy}>
                <SelectTrigger id="em-from"><SelectValue /></SelectTrigger>
                <SelectContent>{FROM_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="em-subject">Subject</Label>
              <Input id="em-subject" value={subject} onChange={e => setSubject(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="em-body">Message</Label>
              <Textarea id="em-body" rows={5} value={body} onChange={e => setBody(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="em-note">A note from you (optional — goes on the final slide of every report)</Label>
              <Textarea id="em-note" rows={3} value={sharedNote} onChange={e => setSharedNote(e.target.value)} disabled={busy}
                placeholder="e.g. Great first half of the season — your work rate has jumped. Keep attacking those sprints." />
              <label className="flex items-center gap-2 text-sm cursor-pointer pt-1">
                <Checkbox checked={perPlayerNotes} disabled={busy} onCheckedChange={c => setPerPlayerNotes(c === true)} />
                <span>Write a personal note for each player</span>
              </label>
              {perPlayerNotes && (
                <div className="rounded-md border divide-y max-h-64 overflow-y-auto">
                  {players.filter(p => selected.has(p)).length === 0 ? (
                    <p className="text-xs text-muted-foreground px-3 py-2">Tick some players above first.</p>
                  ) : players.filter(p => selected.has(p)).map(p => (
                    <div key={p} className="px-3 py-2 space-y-1">
                      <p className="text-xs font-medium">{p}</p>
                      <Textarea rows={2} value={noteEdits.get(p) ?? ""} disabled={busy}
                        onChange={e => setNoteEdits(prev => new Map(prev).set(p, e.target.value))}
                        placeholder="Personal note (blank = use the shared note above)"
                        className="text-xs" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {done && (
              <div className={`flex items-center gap-2 text-sm rounded-md border p-3 ${failedCount ? "border-amber-500/50" : "border-green-500/50"}`}>
                {failedCount ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" /> : <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                <span>{sentCount} sent{failedCount ? `, ${failedCount} failed — check the list above (hover the red cross for the reason)` : " — all done"}</span>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{done ? "Close" : "Cancel"}</Button>
          <Button onClick={send} disabled={busy || selected.size === 0}>
            {busy
              ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Sending {sentCount + failedCount + 1} of {selected.size}…</>
              : <><Mail className="h-4 w-4 mr-1.5" /> Send to {selected.size} player{selected.size === 1 ? "" : "s"}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Y-axis tick for the km/h Top Speed charts: km/h value with the m/s equivalent underneath. */
function SpeedAxisTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  const v = payload?.value ?? 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      {/* km/h value with the m/s equivalent side-by-side — smaller and lighter so it reads as secondary */}
      <text x={-4} y={0} dy={4} textAnchor="end">
        <tspan fill="hsl(var(--muted-foreground))" fontSize={11}>{v}</tspan>
        {v > 0 && <tspan fill="hsl(var(--muted-foreground))" fontSize={8} opacity={0.65}>{` (${(v / 3.6).toFixed(1)})`}</tspan>}
      </text>
    </g>
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

function PlayerChartCard({ metric: metricIn, bundles, player }: { metric: GpsMetric; bundles: Bundle[]; player: string }) {
  const [lastN, setLastN] = useState(false);
  const [per90, setPer90] = useState(false);
  const [ms, setMs] = useState(false);
  const isSpeed = metricIn.id === "topSpeed";
  const metric = isSpeed && ms ? M_TOPSPEED_MS : metricIn;
  // Per-90 only makes sense for additive volumes — Top Speed / Distance-per-min are already rates.
  const canPer90 = metric.additive;
  const norm = canPer90 && per90;

  const seasonAvg = useMemo(() => {
    if (norm) {
      // Weighted per-90: total volume across the season ÷ total minutes, ×90.
      let sumV = 0, sumM = 0;
      for (const b of bundles) {
        const v = bundleTotal(b, metric), m = bundleMins(b);
        if (v != null && m != null && m > 0) { sumV += v; sumM += m; }
      }
      return sumM > 0 ? (sumV / sumM) * 90 : null;
    }
    const vals = bundles.map(b => bundleTotal(b, metric)).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }, [bundles, metric, norm]);

  const shown = lastN ? bundles.slice(-4) : bundles;

  const data = useMemo(() => shown.map(b => {
    const v1 = b.h1 ? metric.value(b.h1) : null;
    const v2 = b.h2 ? metric.value(b.h2) : null;
    const vet = b.et ? metric.value(b.et) : null;
    const total = bundleTotal(b, metric);
    const mins = bundleMins(b);
    if (norm) {
      // One bar per game scaled to a 90-minute rate; halves aren't stacked in
      // this mode (each half is its own rate — they don't sum to the game rate).
      const rate = total != null && mins != null && mins > 0 ? (total / mins) * 90 : null;
      return {
        round: b.key, opponent: b.opponent, date: b.date, mins,
        h1: null as number | null, h2: null as number | null, et: null as number | null,
        single: rate, total: rate, rawTotal: total,
        m1: null as number | null, m2: null as number | null,
      };
    }
    // Only stack when BOTH halves are present — a lone half would render the
    // missing one as a false zero and understate the game.
    const stack = metric.additive && v1 != null && v2 != null;
    return {
      round: b.key,
      opponent: b.opponent,
      date: b.date,
      mins,
      h1: stack ? v1 : null,
      h2: stack ? v2 : null,
      et: stack ? vet : null,
      single: stack ? null : total,
      total,
      rawTotal: total,
      m1: b.h1?.minsPlayed ?? null,
      m2: b.h2?.minsPlayed ?? null,
      met: b.et?.minsPlayed ?? null,
    };
  }), [shown, metric, norm]);

  const anyHalves = data.some(d => d.h1 != null || d.h2 != null);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">{metric.title}{metric.unit ? ` (${metric.unit})` : ""}{norm ? " — per 90 mins" : ""}</CardTitle>
          <CardDescription className="text-xs">
            Oldest → newest.{norm
              ? " Each game scaled to a 90-minute rate, so short shifts compare fairly with full games."
              : metric.additive ? " Period splits stack in order: 1st half, 2nd half, then extra time when recorded." : ""} Dashed line = {player}'s season average{norm ? " (per 90)" : ""}.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canPer90 && (
            <div className="flex rounded-md border overflow-hidden shrink-0">
              <Button variant={norm ? "ghost" : "secondary"} size="sm" className="rounded-none h-7 px-2.5 text-xs" onClick={() => setPer90(false)}>Total</Button>
              <Button variant={norm ? "secondary" : "ghost"} size="sm" className="rounded-none h-7 px-2.5 text-xs" onClick={() => setPer90(true)}>Per 90</Button>
            </div>
          )}
          {isSpeed && <SpeedUnitToggle ms={ms} setMs={setMs} />}
          <LastNToggle lastN={lastN} setLastN={setLastN} />
        </div>
      </CardHeader>
      <CardContent className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 30 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="round" {...AXIS} angle={-40} textAnchor="end" interval={0} />
            <YAxis {...AXIS} fontSize={11} tick={isSpeed && !ms ? <SpeedAxisTick /> : undefined} />
            <Tooltip content={<PlayerTooltip metric={metric} avg={seasonAvg} per90Mode={norm} />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
            {seasonAvg != null && <ReferenceLine y={seasonAvg} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
            <Bar dataKey="h1" stackId="halves" name="1st half" fill={C_H1} hide={!anyHalves} />
            <Bar dataKey="h2" stackId="halves" name="2nd half" fill={C_H2} radius={[3, 3, 0, 0]} hide={!anyHalves} />
            <Bar dataKey="et" stackId="halves" name="Extra time" fill={C_ET} radius={[3, 3, 0, 0]} hide={!data.some(d => d.et != null)} />
            <Bar dataKey="single" name={metric.title} fill={C_SINGLE} radius={[3, 3, 0, 0]} hide={!data.some(d => d.single != null)} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface PlayerTipPayload {
  round: string; opponent: string | null; mins: number | null;
  h1: number | null; h2: number | null; et: number | null; total: number | null;
  rawTotal: number | null;
  m1: number | null; m2: number | null; met: number | null;
}

function PlayerTooltip({ active, payload, metric, avg, per90Mode }: {
  active?: boolean; payload?: Array<{ payload: PlayerTipPayload }>;
  metric: GpsMetric; avg: number | null; per90Mode?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const vsAvg = d.total != null && avg ? ((d.total / avg - 1) * 100) : null;
  // Per-90 normalises for time on the pitch — a 30-minute shift can be compared with a full game.
  const per90 = !per90Mode && metric.additive && d.total != null && d.mins ? (d.total / d.mins) * 90 : null;
  return (
    <div style={TOOLTIP_BOX}>
      <p className="font-semibold">{d.round}{d.opponent ? ` — vs ${d.opponent}` : ""}</p>
      {d.mins != null && <p className="text-muted-foreground">{Math.round(d.mins)} mins played</p>}
      <div className="mt-1 space-y-0.5">
        {d.h1 != null && <p><span style={{ color: C_H1 }}>●</span> 1st half: {fmtV(d.h1, metric.decimals, metric.unit)}{d.m1 ? ` (${Math.round(d.m1)} min)` : ""}</p>}
        {d.h2 != null && <p><span style={{ color: C_H2 }}>●</span> 2nd half: {fmtV(d.h2, metric.decimals, metric.unit)}{d.m2 ? ` (${Math.round(d.m2)} min)` : ""}</p>}
        {d.et != null && <p><span style={{ color: C_ET }}>●</span> Extra time: {fmtV(d.et, metric.decimals, metric.unit)}{d.met ? ` (${Math.round(d.met)} min)` : ""}</p>}
        {per90Mode ? (
          <>
            <p className="font-medium">Per 90: {fmtV(d.total, metric.decimals, metric.unit)}</p>
            {d.rawTotal != null && <p className="text-muted-foreground">Actual: {fmtV(d.rawTotal, metric.decimals, metric.unit)}</p>}
          </>
        ) : (
          <p className="font-medium">Game: {fmtV(d.total, metric.decimals, metric.unit)}</p>
        )}
        {per90 != null && <p className="text-muted-foreground">≈ {fmtV(per90, metric.decimals, metric.unit)} per 90 mins</p>}
        {vsAvg != null && (
          <p className="text-muted-foreground">{vsAvg >= 0 ? "▲" : "▼"} {Math.abs(vsAvg).toFixed(0)}% vs her season average{per90Mode ? " (per 90)" : ""}</p>
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
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between space-y-0 pb-2">
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
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 14 }} />
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
    acc: bundleMaxField(b, r => r.maxAccelerationMss),
    dec: bundleMaxField(b, r => r.maxDecelerationMss),
  }));

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between space-y-0 pb-2">
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
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 14 }} />
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
  useViewingTeam(squad);

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

  const { activeLeagueId } = useActiveLeague();
  const params = { leagueId: activeLeagueId ?? 0, year, round };
  const { data: rows } = useListGpsSessions(
    params,
    { query: { enabled: !!round && activeLeagueId != null, queryKey: getListGpsSessionsQueryKey(params) } },
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
          <SelectTrigger className="w-[140px] max-w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{availableSquads.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={round} onValueChange={setRound}>
          <SelectTrigger className="w-[200px] max-w-full"><SelectValue placeholder="Round" /></SelectTrigger>
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

function TeamChartCard({ metric: metricIn, bundles }: { metric: GpsMetric; bundles: Bundle[] }) {
  const [view, setView] = useState<TeamView>("total");
  const [ms, setMs] = useState(false);
  const isSpeed = metricIn.id === "topSpeed";
  const metric = isSpeed && ms ? M_TOPSPEED_MS : metricIn;

  const data = useMemo(() => {
    const rows = bundles.map(b => {
      const total = bundleTotal(b, metric);
      const mins = bundleMins(b);
      const v1 = b.h1 ? metric.value(b.h1) : null;
      const v2 = b.h2 ? metric.value(b.h2) : null;
      const vet = b.et ? metric.value(b.et) : null;
      const per10 = total != null && mins ? (total / mins) * 10 : null;
      const display = view === "per10" ? per10 : total;
      return {
        name: b.key, mins, total, per10, display,
        h1: v1, h2: v2, et: vet,
        m1: b.h1?.minsPlayed ?? null, m2: b.h2?.minsPlayed ?? null, met: b.et?.minsPlayed ?? null,
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
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">{metric.title}{unitLabel ? ` (${unitLabel})` : ""}</CardTitle>
          <CardDescription className="text-xs">
            Biggest output on the left. Dashed line = squad average.
            {view === "per10" && " Per-10-min levels the field for players with fewer minutes."}
            {view === "halves" && (halvesStacked ? " 1st half is at the bottom, 2nd half above it, and extra time is shown on top when recorded." : " 1st vs 2nd half side by side.")}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {isSpeed && <SpeedUnitToggle ms={ms} setMs={setMs} />}
          <TeamViewToggle view={view} setView={setView} additive={metric.additive} />
        </div>
      </CardHeader>
      <CardContent className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -15, bottom: 35 }} barGap={1}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="name" {...AXIS} angle={-45} textAnchor="end" interval={0} />
            <YAxis {...AXIS} fontSize={11} tick={isSpeed && !ms ? <SpeedAxisTick /> : undefined} />
            <Tooltip content={<TeamTooltip metric={metric} view={view} avg={squadAvg} />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
            {view !== "halves" && squadAvg != null && <ReferenceLine y={squadAvg} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
            <Bar dataKey="display" name={metric.title} fill={C_SINGLE} radius={[3, 3, 0, 0]} hide={view === "halves"} />
            <Bar dataKey="h1" stackId={halvesStacked ? "h" : undefined} name="1st half" fill={C_H1} hide={view !== "halves"} />
            <Bar dataKey="h2" stackId={halvesStacked ? "h" : undefined} name="2nd half" fill={C_H2} radius={[3, 3, 0, 0]} hide={view !== "halves"} />
            <Bar dataKey="et" stackId={halvesStacked ? "h" : undefined} name="Extra time" fill={C_ET} radius={[3, 3, 0, 0]} hide={view !== "halves" || !data.some(d => d.et != null)} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface TeamTipPayload {
  name: string; mins: number | null; total: number | null; per10: number | null;
  h1: number | null; h2: number | null; et: number | null; m1: number | null; m2: number | null; met: number | null;
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
        {d.per10 != null && metric.additive && <p className="text-muted-foreground">{fmtV(d.per10, metric.decimals, metric.unit)} per 10 min  ·  ≈ {fmtV(d.per10 * 9, metric.decimals, metric.unit)} per 90</p>}
        {d.h1 != null && <p><span style={{ color: C_H1 }}>●</span> 1st half: {fmtV(d.h1, metric.decimals, metric.unit)}{d.m1 ? ` (${Math.round(d.m1)} min)` : ""}</p>}
        {d.h2 != null && <p><span style={{ color: C_H2 }}>●</span> 2nd half: {fmtV(d.h2, metric.decimals, metric.unit)}{d.m2 ? ` (${Math.round(d.m2)} min)` : ""}</p>}
        {d.et != null && <p><span style={{ color: C_ET }}>●</span> Extra time: {fmtV(d.et, metric.decimals, metric.unit)}{d.met ? ` (${Math.round(d.met)} min)` : ""}</p>}
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
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between space-y-0 pb-2">
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
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 14 }} />
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
        acc: bundleMaxField(b, r => r.maxAccelerationMss),
        dec: bundleMaxField(b, r => r.maxDecelerationMss),
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
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 14 }} />
            <Bar dataKey="acc" name="Max acceleration" fill={C_ACC} radius={[3, 3, 0, 0]} />
            <Bar dataKey="dec" name="Max deceleration" fill={C_DEC} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
