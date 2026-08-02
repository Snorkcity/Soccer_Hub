/**
 * Match Report tab on GPS Insights — the "Monday after" team physical review.
 * Anyone with GPS access can view/run/save; emailing the deck is admin-only
 * (it rides on the admin-gated /gps-report-email endpoint).
 */
import React, { useState, useMemo, useEffect } from "react";
import {
  useListGpsSessions, getListGpsSessionsQueryKey,
  useListGpsPlayerPositions, getListGpsPlayerPositionsQueryKey,
  useListGpsMatchReports, getListGpsMatchReportsQueryKey,
  createGpsMatchReport, deleteGpsMatchReport,
  useListGpsCoachEmails, getListGpsCoachEmailsQueryKey,
  saveGpsCoachEmails, sendGpsReportEmail,
  type GpsSession, type GpsMatchReport,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FileDown, Loader2, Mail, CheckCircle2, XCircle, AlertTriangle, Save, Trash2, ArrowLeft, Plus,
  TrendingUp, TrendingDown, Radar, Star, Eye,
} from "lucide-react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { useActiveLeague } from "@/contexts/LeagueContext";
import { buildGpsMatchReport, groupInsights, type GpsMatchReportModel, type InsightLine, type PlayerLine } from "@/lib/gpsMatchReport";

const SQUADS = ["1sts", "Reserves", "17s / 18s"];
const FROM_OPTIONS = [
  "BUFC Performance Hub <noreply@gameinsights.com.au>",
  "Scott Conlon <scott@gameinsights.com.au>",
];

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
const fmt = (v: number | null | undefined, d: number, unit?: string) =>
  v == null ? "—" : `${v.toFixed(d)}${unit ? ` ${unit}` : ""}`;

const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 10 };

// ─────────────────────────────────────────────────────────────────────────────

export function GpsMatchReportTab({ year, metaRows }: { year: string; metaRows: GpsSession[] }) {
  const { activeLeagueId } = useActiveLeague();
  const { isSuperadmin, hasModuleAnywhere } = useLeagueModules();
  const isAdmin = isSuperadmin || hasModuleAnywhere("data-entry");

  // Squad + round pickers (same convention as Team Overview)
  const roundsBySquad = useMemo(() => {
    const seen = new Map<string, { round: string; date: number | null; opponent: string | null }>();
    for (const r of metaRows) {
      if (!r.round) continue;
      if (!seen.has(r.round)) seen.set(r.round, { round: r.round, date: parseDate(r.sessionDate), opponent: r.opponent ?? null });
    }
    const grouped = new Map<string, { round: string; date: number | null; opponent: string | null }[]>();
    for (const info of seen.values()) {
      const s = squadOf(info.round);
      grouped.set(s, [...(grouped.get(s) ?? []), info]);
    }
    for (const list of grouped.values()) list.sort((a, b) => (b.date ?? -Infinity) - (a.date ?? -Infinity));
    return grouped;
  }, [metaRows]);

  const availableSquads = SQUADS.filter(s => roundsBySquad.has(s));
  const [squad, setSquad] = useState(availableSquads[0] ?? "1sts");
  useEffect(() => {
    if (availableSquads.length && !availableSquads.includes(squad)) setSquad(availableSquads[0]);
  }, [availableSquads, squad]);

  const rounds = roundsBySquad.get(squad) ?? [];
  const [round, setRound] = useState("");
  useEffect(() => {
    if (!rounds.length) { if (round) setRound(""); }
    else if (!round || !rounds.some(r => r.round === round)) setRound(rounds[0].round);
  }, [rounds, round]);

  // All rows for the year (halves included) — the report engine needs the season
  const allParams = { leagueId: activeLeagueId ?? 0, year };
  const { data: allRows, isLoading } = useListGpsSessions(
    allParams,
    { query: { enabled: activeLeagueId != null, queryKey: getListGpsSessionsQueryKey(allParams) } },
  );
  const { data: positions } = useListGpsPlayerPositions(
    { query: { queryKey: getListGpsPlayerPositionsQueryKey() } },
  );
  const posMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of positions ?? []) if (p.position) m.set(p.playerName, p.position);
    return m;
  }, [positions]);

  const liveModel = useMemo(() => {
    if (!allRows?.length || !round) return null;
    return buildGpsMatchReport({
      rows: allRows, squad, round, year,
      teamLabel: `Belconnen United FC — ${squad}`,
      positions: posMap,
      generatedOn: new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }),
    });
  }, [allRows, squad, round, year, posMap]);

  // Saved reports
  const queryClient = useQueryClient();
  const listParams = { leagueId: activeLeagueId ?? 0 };
  const { data: saved } = useListGpsMatchReports(
    listParams,
    { query: { enabled: activeLeagueId != null, queryKey: getListGpsMatchReportsQueryKey(listParams) } },
  );
  const invalidateSaved = () =>
    queryClient.invalidateQueries({ queryKey: getListGpsMatchReportsQueryKey(listParams) });

  const [viewingSaved, setViewingSaved] = useState<GpsMatchReport | null>(null);
  const model = viewingSaved ? (viewingSaved.data as unknown as GpsMatchReportModel) : liveModel;

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const saveReport = async () => {
    if (!liveModel || activeLeagueId == null) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await createGpsMatchReport({
        leagueId: activeLeagueId,
        title: `GPS Match Report — ${liveModel.round}${liveModel.opponent ? ` v ${liveModel.opponent}` : ""}`,
        round: liveModel.round,
        opponent: liveModel.opponent ?? undefined,
        matchDate: liveModel.dateLabel ?? undefined,
        data: liveModel as unknown as Record<string, unknown>,
      });
      await invalidateSaved();
      setSaveMsg("Saved");
    } catch {
      setSaveMsg("Save failed — try again");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 4000);
    }
  };

  const downloadDeck = async () => {
    if (!model) return;
    setDownloading(true);
    try {
      const { generateTeamGpsMatchReport } = await import("@/lib/teamGpsMatchReport");
      await generateTeamGpsMatchReport(model, undefined);
    } finally {
      setDownloading(false);
    }
  };

  if (isLoading) {
    return <Card><CardContent className="py-16 text-center text-muted-foreground">Loading GPS data…</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {viewingSaved ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setViewingSaved(null)}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to live report
            </Button>
            <p className="text-sm text-muted-foreground">
              Viewing saved report: <span className="font-medium text-foreground">{viewingSaved.title}</span>
            </p>
          </>
        ) : (
          <>
            <Select value={squad} onValueChange={setSquad}>
              <SelectTrigger className="w-[140px] max-w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{availableSquads.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={round} onValueChange={setRound}>
              <SelectTrigger className="w-[220px] max-w-full"><SelectValue placeholder="Round" /></SelectTrigger>
              <SelectContent>
                {rounds.map(r => <SelectItem key={r.round} value={r.round}>{r.round}{r.opponent ? ` — ${r.opponent}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {!viewingSaved && (
            <Button variant="outline" size="sm" onClick={saveReport} disabled={saving || !liveModel}>
              {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              {saveMsg ?? "Save report"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={downloadDeck} disabled={downloading || !model}>
            {downloading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <FileDown className="h-4 w-4 mr-1.5" />}
            Download deck
          </Button>
          {isAdmin && model && <EmailCoachesDialog model={model} squad={model.squad} />}
        </div>
      </div>

      {!model ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No GPS data for this round.</CardContent></Card>
      ) : (
        <ReportBody model={model} />
      )}

      <SavedReportsCard saved={saved ?? []} onOpen={setViewingSaved} onChanged={invalidateSaved} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Report body
// ─────────────────────────────────────────────────────────────────────────────

type SortKey = "name" | "mins" | "km" | "dpm" | "hsm" | "vhs" | "topSpeed" | "hsmPctOfDist" | "dpmDelta";

function ReportBody({ model }: { model: GpsMatchReportModel }) {
  const [sortKey, setSortKey] = useState<SortKey>("mins");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => (d === "desc" ? "asc" : "desc"));
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
  };
  const sortedPlayers = useMemo(() => {
    const mul = sortDir === "asc" ? 1 : -1;
    return [...model.players].sort((a, b) => {
      if (sortKey === "name") return mul * a.name.localeCompare(b.name);
      const va = a[sortKey], vb = b[sortKey];
      if (va == null && vb == null) return a.name.localeCompare(b.name);
      if (va == null) return 1;   // blanks always sink to the bottom
      if (vb == null) return -1;
      return mul * (va - vb) || a.name.localeCompare(b.name);
    });
  }, [model.players, sortKey, sortDir]);
  const Th = ({ k, label, first }: { k: SortKey; label: string; first?: boolean }) => (
    <th className={`py-1.5 font-medium ${first ? "pr-3 text-left" : "px-2 text-center"}`}>
      <button
        className={`inline-flex items-center gap-0.5 hover:text-foreground ${sortKey === k ? "text-foreground" : ""}`}
        onClick={() => toggleSort(k)}
      >
        {label}
        <span className="w-3 text-[9px]">{sortKey === k ? (sortDir === "desc" ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );
  return (
    <div className="space-y-6">
      {/* Team at a glance */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">The team, at a glance — {model.round}{model.opponent ? ` v ${model.opponent}` : ""}</CardTitle>
          <CardDescription className="text-xs">
            Each tile compares this game with the squad's season average game. Totals move with player count — the per-minute numbers are the honest comparison.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {model.team.filter(t => t.value != null).map(t => (
              <div key={t.id} className="rounded-md border p-3">
                <p className="text-xl font-bold">{fmt(t.value, t.decimals)}<span className="text-xs font-normal text-muted-foreground ml-1">{t.unit}</span></p>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide mt-0.5">{t.label}</p>
                {t.deltaPct != null && (
                  <p className={`text-xs mt-1 ${t.deltaPct >= 0 ? "text-green-500" : "text-amber-500"}`}>
                    {t.deltaPct >= 0 ? "▲" : "▼"} {Math.abs(t.deltaPct).toFixed(0)}% vs normal ({fmt(t.seasonAvg, t.decimals)})
                  </p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Halves */}
      {model.halves.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">First half vs second half</CardTitle>
            <CardDescription className="text-xs">Summed across players with half splits. A big drop can mean fatigue — or game state. Season columns show the squad's usual second-half change and the best/worst game this year.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Team output</th>
                    <th className="py-1.5 px-3 text-center font-medium">1st half</th>
                    <th className="py-1.5 px-3 text-center font-medium">2nd half</th>
                    <th className="py-1.5 px-3 text-center font-medium">Change</th>
                    <th className="py-1.5 px-3 text-center font-medium">Season usual</th>
                    <th className="py-1.5 pl-3 text-center font-medium">Best · worst</th>
                  </tr>
                </thead>
                <tbody>
                  {model.halves.filter(h => h.h1 != null || h.h2 != null).map(h => (
                    <tr key={h.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3">{h.label}</td>
                      <td className="py-1.5 px-3 text-center">{fmt(h.h1, h.decimals, h.unit)}</td>
                      <td className="py-1.5 px-3 text-center">{fmt(h.h2, h.decimals, h.unit)}</td>
                      <td className={`py-1.5 px-3 text-center font-medium ${h.changePct != null && h.changePct < -10 ? "text-amber-500" : ""}`}>
                        {h.changePct == null ? "—" : `${h.changePct >= 0 ? "up" : "down"} ${Math.abs(h.changePct).toFixed(0)}%`}
                      </td>
                      <td className="py-1.5 px-3 text-center text-muted-foreground">
                        {h.seasonChangePct == null ? "—" : `${h.seasonChangePct >= 0 ? "up" : "down"} ${Math.abs(h.seasonChangePct).toFixed(0)}%`}
                      </td>
                      <td className="py-1.5 pl-3 text-center text-xs text-muted-foreground whitespace-nowrap">
                        {h.bestChange == null || h.worstChange == null ? "—" : (
                          <>
                            <span className="text-green-500">{h.bestChange.pct >= 0 ? "+" : "−"}{Math.abs(h.bestChange.pct).toFixed(0)}%</span> {h.bestChange.round}
                            <span className="mx-1">·</span>
                            <span className="text-amber-500">{h.worstChange.pct >= 0 ? "+" : "−"}{Math.abs(h.worstChange.pct).toFixed(0)}%</span> {h.worstChange.round}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Standouts + watch */}
      <div className="grid gap-6 lg:grid-cols-2">
        <InsightCard
          title="What stood out"
          desc="Season bests, above-normal outputs and the athletic radar — automatically flagged."
          items={model.standouts}
          empty="No automatic flags this week — a steady, normal-range performance across the group."
          tone="good"
        />
        <InsightCard
          title="Worth keeping an eye on"
          desc="Below-normal outputs and month-long slides. Context first — role and game state move these numbers."
          items={model.watch}
          empty="Nothing flagged — everyone was at or around their normal levels."
          tone="warn"
        />
      </div>

      {/* Player table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Every player, against their own normal</CardTitle>
          <CardDescription className="text-xs">
            "vs own normal" is one metric: running intensity (metres per minute) against that player's other {model.year} games (45+ minute games only) — so short stints are judged on intensity, not volume. High-speed running, top speed and season bests are flagged separately in the cards above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <Th k="name" label="Player" first />
                  <Th k="mins" label="Mins" />
                  <Th k="km" label="Km" />
                  <Th k="dpm" label="m/min" />
                  <Th k="hsm" label="HS m" />
                  <Th k="vhs" label="VHS m" />
                  <Th k="topSpeed" label="Top km/h" />
                  <Th k="hsmPctOfDist" label="HS % of dist" />
                  <Th k="dpmDelta" label="vs own normal" />
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map(p => <PlayerRow key={p.name} p={p} />)}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Trend */}
      {model.trend.length >= 2 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">How the group is tracking</CardTitle>
            <CardDescription className="text-xs">
              Team output across the last {model.trend.length} games. Bars (total km) move with player count; the intensity line is the fairer week-to-week read.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={model.trend.map(t => ({
                round: t.round,
                km: t.kmTotal == null ? null : Number(t.kmTotal.toFixed(1)),
                dpm: t.dpmAvg == null ? null : Number(t.dpmAvg.toFixed(0)),
              }))} margin={{ top: 10, right: 10, left: -15, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="round" {...AXIS} />
                <YAxis yAxisId="km" {...AXIS} fontSize={11} />
                <YAxis yAxisId="dpm" orientation="right" {...AXIS} fontSize={11} />
                <Tooltip contentStyle={{
                  backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
                  color: "hsl(var(--foreground))", fontSize: 12, borderRadius: 8,
                }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="km" dataKey="km" name="Total distance (km)" fill="hsl(var(--chart-1))" radius={[3, 3, 0, 0]} />
                <Line yAxisId="dpm" dataKey="dpm" name="Avg intensity (m/min)" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PlayerRow({ p }: { p: PlayerLine }) {
  const delta = p.dpmDelta;
  return (
    <tr className="border-b last:border-0">
      <td className="py-1.5 pr-3">
        <span className="font-medium">{p.name}</span>
        {p.position && <span className="text-xs text-muted-foreground ml-1.5">{p.position}</span>}
        {p.shortMins && <span className="text-[10px] text-muted-foreground ml-1.5 italic">(short stint)</span>}
      </td>
      <td className="py-1.5 px-2 text-center">{fmt(p.mins, 0)}</td>
      <td className="py-1.5 px-2 text-center">{fmt(p.km, 2)}</td>
      <td className="py-1.5 px-2 text-center">{fmt(p.dpm, 0)}</td>
      <td className="py-1.5 px-2 text-center">{fmt(p.hsm, 0)}</td>
      <td className="py-1.5 px-2 text-center">{fmt(p.vhs, 0)}</td>
      <td className="py-1.5 px-2 text-center">{fmt(p.topSpeed, 1)}</td>
      <td className={`py-1.5 px-2 text-center ${p.hsmPctOfDist != null && p.hsmPctOfDist >= 10 ? "text-sky-400 font-medium" : ""}`}>
        {p.hsmPctOfDist == null ? "—" : `${p.hsmPctOfDist.toFixed(1)}%`}
      </td>
      <td className={`py-1.5 pl-2 text-center font-medium ${
        delta == null ? "text-muted-foreground" : delta >= 0 ? "text-green-500" : delta <= -12 ? "text-red-400" : "text-muted-foreground"}`}>
        {delta == null ? (p.baselineGames ? "—" : "first game") : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(0)}%`}
      </td>
    </tr>
  );
}

const INSIGHT_ICONS: Record<InsightLine["kind"], React.ReactNode> = {
  best: <Star className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />,
  up: <TrendingUp className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />,
  radar: <Radar className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />,
  position: <Star className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />,
  down: <TrendingDown className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />,
  trend: <TrendingDown className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />,
  note: <Eye className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />,
};

function InsightCard({ title, desc, items, empty, tone }: {
  title: string; desc: string; items: InsightLine[]; empty: string; tone: "good" | "warn";
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-4 text-center">{empty}</p>
        ) : (
          <ul className="space-y-3">
            {groupInsights(items).map((g, i) => (
              <li key={i} className="text-sm">
                {g.player != null && (
                  <div className={`font-semibold mb-0.5 ${tone === "good" ? "text-green-500" : "text-amber-500"}`}>{g.player}</div>
                )}
                <ul className={g.player != null ? "space-y-1 pl-1" : "space-y-1"}>
                  {g.lines.map((it, j) => (
                    <li key={j} className="flex gap-2">
                      {INSIGHT_ICONS[it.kind]}
                      <span>{it.text}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Saved reports (saved-name standard: bold title, muted game date, small saved date)
// ─────────────────────────────────────────────────────────────────────────────

function SavedReportsCard({ saved, onOpen, onChanged }: {
  saved: GpsMatchReport[]; onOpen: (r: GpsMatchReport) => void; onChanged: () => void;
}) {
  const [deleting, setDeleting] = useState<number | null>(null);
  if (!saved.length) return null;
  const savedLabel = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  };
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Saved match reports</CardTitle>
        <CardDescription className="text-xs">A saved report keeps the numbers exactly as they were the day it was saved.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border divide-y">
          {saved.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2">
              <button className="text-left min-w-0 flex-1" onClick={() => onOpen(r)}>
                <p className="text-sm font-semibold truncate">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {r.matchDate ?? ""}{r.matchDate ? "  ·  " : ""}<span className="text-[11px]">saved {savedLabel(r.createdAt)}</span>
                </p>
              </button>
              <Button variant="ghost" size="sm" className="h-7 px-2 shrink-0" disabled={deleting === r.id}
                onClick={async () => {
                  setDeleting(r.id);
                  try { await deleteGpsMatchReport(r.id); onChanged(); } finally { setDeleting(null); }
                }}>
                {deleting === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Email the deck to the coach list
// ─────────────────────────────────────────────────────────────────────────────

type SendState = { status: "pending" | "sending" | "sent" | "failed"; reason?: string };
interface CoachRow { name: string; email: string; }

function EmailCoachesDialog({ model, squad }: { model: GpsMatchReportModel; squad: string }) {
  const [open, setOpen] = useState(false);
  const { activeLeagueId } = useActiveLeague();
  const queryClient = useQueryClient();

  const listParams = { leagueId: activeLeagueId ?? 0 };
  const { data: savedCoaches } = useListGpsCoachEmails(
    listParams,
    { query: { enabled: open && activeLeagueId != null, queryKey: getListGpsCoachEmailsQueryKey(listParams) } },
  );

  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!open) { setLoadedFor(null); return; }
    if (savedCoaches && loadedFor !== squad) {
      const mine = savedCoaches.filter(c => c.squad === squad).map(c => ({ name: c.name ?? "", email: c.email }));
      setCoaches(mine.length ? mine : [{ name: "", email: "" }]);
      setLoadedFor(squad);
    }
  }, [open, savedCoaches, squad, loadedFor]);

  const matchLine = `${model.round}${model.opponent ? ` v ${model.opponent}` : ""}`;
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [from, setFrom] = useState(FROM_OPTIONS[0]);
  const [coachNote, setCoachNote] = useState("");
  const [sendStates, setSendStates] = useState<Map<number, SendState>>(new Map());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubject(`GPS Match Report — ${matchLine}`);
    setBody(`Hi,\n\nAttached is the GPS match report for ${matchLine} — the physical story of the game, with every player judged against their own season levels.\n\nCheers,\nScott`);
    setFrom(FROM_OPTIONS[0]);
    setCoachNote("");
    setSendStates(new Map());
    setBusy(false);
    setDone(false);
  }, [open, matchLine]);

  const setCoach = (i: number, patch: Partial<CoachRow>) =>
    setCoaches(prev => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const send = async () => {
    if (activeLeagueId == null) return;
    const targets = coaches
      .map((c, i) => ({ ...c, i, email: c.email.trim() }))
      .filter(c => c.email);
    if (!targets.length) return;
    setBusy(true);
    setDone(false);
    const states = new Map<number, SendState>(targets.map(t => [t.i, { status: "pending" as const }]));
    setSendStates(new Map(states));

    // Save the list first so next week it's pre-filled
    try {
      await saveGpsCoachEmails({ leagueId: activeLeagueId, squad, coaches: targets.map(t => ({ name: t.name.trim() || undefined, email: t.email })) });
      queryClient.invalidateQueries({ queryKey: getListGpsCoachEmailsQueryKey(listParams) });
    } catch {
      setBusy(false);
      setDone(true);
      setSendStates(new Map(targets.map(t => [t.i, { status: "failed" as const, reason: "Couldn't save the coach list — check the addresses and try again" }])));
      return;
    }

    // Build the deck ONCE, send to each coach
    let fileName = "", base64: string | undefined;
    try {
      const { generateTeamGpsMatchReport } = await import("@/lib/teamGpsMatchReport");
      ({ fileName, base64 } = await generateTeamGpsMatchReport(model, coachNote.trim() || undefined, "base64"));
    } catch {
      setBusy(false);
      setDone(true);
      setSendStates(new Map(targets.map(t => [t.i, { status: "failed" as const, reason: "Couldn't build the report deck" }])));
      return;
    }

    for (const t of targets) {
      states.set(t.i, { status: "sending" });
      setSendStates(new Map(states));
      try {
        await sendGpsReportEmail({
          to: t.email,
          subject: subject.trim() || `GPS Match Report — ${matchLine}`,
          body,
          from,
          fileName,
          pptxBase64: base64!,
          leagueId: activeLeagueId,
        });
        states.set(t.i, { status: "sent" });
      } catch (e) {
        console.error(e);
        states.set(t.i, { status: "failed", reason: "Send failed" });
      }
      setSendStates(new Map(states));
    }
    setBusy(false);
    setDone(true);
  };

  const sentCount = [...sendStates.values()].filter(s => s.status === "sent").length;
  const failedCount = [...sendStates.values()].filter(s => s.status === "failed").length;
  const targetCount = coaches.filter(c => c.email.trim()).length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) setOpen(v); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Mail className="h-4 w-4 mr-1.5" /> Email to coaches</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email the match report</DialogTitle>
          <DialogDescription>
            Sends the {matchLine} deck to the {squad} coach list. The list is remembered for next week.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>{squad} coaches</Label>
            <div className="rounded-md border divide-y">
              {coaches.map((c, i) => {
                const st = sendStates.get(i);
                return (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                    <Input value={c.name} onChange={e => setCoach(i, { name: e.target.value })}
                      placeholder="Name (optional)" disabled={busy} className="h-7 text-xs w-32 shrink-0" />
                    <Input value={c.email} onChange={e => setCoach(i, { email: e.target.value })}
                      placeholder="coach@example.com" disabled={busy} className="h-7 text-xs flex-1 min-w-0" />
                    <span className="w-5 shrink-0 flex justify-center">
                      {st?.status === "sending" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                      {st?.status === "sent" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                      {st?.status === "failed" && <span title={st.reason}><XCircle className="h-3.5 w-3.5 text-destructive" /></span>}
                    </span>
                    <Button variant="ghost" size="sm" className="h-7 px-1.5 shrink-0" disabled={busy}
                      onClick={() => setCoaches(prev => prev.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" disabled={busy}
              onClick={() => setCoaches(prev => [...prev, { name: "", email: "" }])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add coach
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mc-from">Send from</Label>
            <Select value={from} onValueChange={setFrom} disabled={busy}>
              <SelectTrigger id="mc-from"><SelectValue /></SelectTrigger>
              <SelectContent>{FROM_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mc-subject">Subject</Label>
            <Input id="mc-subject" value={subject} onChange={e => setSubject(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mc-body">Message</Label>
            <Textarea id="mc-body" rows={4} value={body} onChange={e => setBody(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mc-note">Closing note inside the deck (optional)</Label>
            <Textarea id="mc-note" rows={2} value={coachNote} onChange={e => setCoachNote(e.target.value)} disabled={busy}
              placeholder="e.g. Big physical shift from the group — recovery focus Tuesday, back on the grass Thursday." />
          </div>

          {done && (
            <div className={`flex items-center gap-2 text-sm rounded-md border p-3 ${failedCount ? "border-amber-500/50" : "border-green-500/50"}`}>
              {failedCount ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" /> : <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
              <span>{sentCount} sent{failedCount ? `, ${failedCount} failed — hover the red cross for the reason` : " — all done"}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{done ? "Close" : "Cancel"}</Button>
          <Button onClick={send} disabled={busy || !targetCount}>
            {busy
              ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Sending…</>
              : <><Mail className="h-4 w-4 mr-1.5" /> Send to {targetCount} coach{targetCount === 1 ? "" : "es"}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
