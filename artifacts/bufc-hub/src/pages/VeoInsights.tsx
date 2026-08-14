import React, { useState, useMemo } from "react";
import {
  useVeoSync,
  useListVeoMatches,
  getListVeoMatchesQueryKey,
  useGetVeoMatch,
  getGetVeoMatchQueryKey,
  useGetVeoSeason,
  getGetVeoSeasonQueryKey,
  useGetVeoSeasonShots,
  getGetVeoSeasonShotsQueryKey,
  useListVeoLinks,
  getListVeoLinksQueryKey,
  useVeoAutoLink,
  useVeoSetLink,
  type VeoMatchSummary,
  type VeoSeasonMatch,
  type VeoSeasonShotMatch,
  type VeoEvent,
  type VeoLinkRow,
  type HubMatchOption,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Video, Link2, ChevronDown, ChevronUp, Wand2, Check } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
  ComposedChart, Line, Legend,
} from "recharts";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { NoAccess } from "@/components/NoAccess";
import { useActiveLeague } from "@/contexts/LeagueContext";

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────
const C_US = "hsl(var(--chart-1))";
const C_THEM = "hsl(var(--chart-5))";
const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 10 };
const TOOLTIP_BOX: React.CSSProperties = {
  backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
  color: "hsl(var(--foreground))", fontSize: 12, borderRadius: 8, padding: "8px 12px",
};

// Friendly labels + display order for the event types we surface.
const EVENT_LABELS: Record<string, string> = {
  FootballGoal: "Goals",
  FootballShot: "Shots",
  FootballCornerKick: "Corners",
  FootballFreeKick: "Free kicks",
  FootballPenaltyKick: "Penalties",
  FootballThrowIn: "Throw-ins",
  FootballFoul: "Fouls",
  FootballGoalKick: "Goal kicks",
};
const COMPARE_ORDER = [
  "FootballShot", "FootballGoal", "FootballCornerKick", "FootballFreeKick",
  "FootballPenaltyKick", "FootballThrowIn", "FootballFoul", "FootballGoalKick",
];

// Event-weighted attacking momentum (a field-tilt proxy from the event stream —
// Veo doesn't expose true possession territory on this tier). Higher weight =
// more threatening.
const MOMENTUM_WEIGHT: Record<string, number> = {
  FootballGoal: 6, FootballPenaltyKick: 5, FootballShot: 3,
  FootballCornerKick: 2, FootballFreeKick: 1, FootballThrowIn: 0.3,
};
const BIN_MIN = 5; // minutes per momentum bar

const isOwn = (e: VeoEvent) => e.team === "Own";

// Overall match minute from period + time-within-period, using real period
// durations from Veo when available (falls back to 45-min halves).
function makeMinuteOf(periods: unknown): (e: VeoEvent) => number {
  const durMin: number[] = Array.isArray(periods)
    ? (periods as { duration?: number }[]).map((p) => (Number(p?.duration) > 0 ? Number(p.duration) / 60 : 45))
    : [];
  const offsets: number[] = [0];
  for (let i = 0; i < durMin.length; i++) offsets.push(offsets[i] + durMin[i]);
  return (e: VeoEvent) => {
    const pid = Number(e.period_id) || 1;
    const off = offsets[pid - 1] ?? (pid - 1) * 45;
    return off + (Number(e.period_time_ms) || 0) / 60000;
  };
}

function opponentOf(m: { opponent?: string | null; title?: string | null }): string {
  const raw = (m.opponent ?? "").trim();
  if (raw && !/firsts|reserves|nplw|1sts|^$/i.test(raw)) return raw;
  const t = (m.title ?? "").replace(/^.*\bvs\.?\s*/i, "").trim();
  return t || raw || "Opponent";
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
export default function VeoInsights() {
  const { hasModule, ready, isSuperadmin } = useLeagueModules();
  const { activeLeagueId } = useActiveLeague();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [view, setView] = useState<"season" | "match">("season");

  const listParams = { leagueId: activeLeagueId ?? 0 };
  const { data: listData, isLoading: listLoading } = useListVeoMatches(listParams, {
    query: { enabled: activeLeagueId != null, queryKey: getListVeoMatchesQueryKey(listParams) },
  });
  const matches: VeoMatchSummary[] = listData?.matches ?? [];
  const synced = matches.filter((m) => m.synced);

  const currentId = selectedId ?? synced[0]?.id ?? null;
  const detailParams = { id: currentId ?? 0, leagueId: activeLeagueId ?? 0 };
  const { data: match, isLoading: matchLoading } = useGetVeoMatch(detailParams, {
    query: { enabled: currentId != null && activeLeagueId != null, queryKey: getGetVeoMatchQueryKey(detailParams) },
  });

  const seasonParams = { leagueId: activeLeagueId ?? 0 };
  const { data: seasonData, isLoading: seasonLoading } = useGetVeoSeason(seasonParams, {
    query: {
      enabled: view === "season" && activeLeagueId != null,
      queryKey: getGetVeoSeasonQueryKey(seasonParams),
    },
  });

  const { data: seasonShotsData } = useGetVeoSeasonShots(seasonParams, {
    query: {
      enabled: view === "season" && activeLeagueId != null,
      queryKey: getGetVeoSeasonShotsQueryKey(seasonParams),
    },
  });

  const syncMut = useVeoSync();
  async function runSync() {
    if (activeLeagueId == null) return;
    setSyncMsg("Starting sync…");
    try {
      for (let i = 0; i < 25; i++) {
        const r = await syncMut.mutateAsync({ data: { leagueId: activeLeagueId, batch: 20 } });
        setSyncMsg(`Synced ${r.totalMatches - r.remaining}/${r.totalMatches} matches…`);
        if (r.done) { setSyncMsg(`Done — ${r.totalMatches} matches synced.`); break; }
      }
      qc.invalidateQueries({ queryKey: getListVeoMatchesQueryKey(listParams) });
      qc.invalidateQueries({ queryKey: getGetVeoSeasonQueryKey(seasonParams) });
      qc.invalidateQueries({ queryKey: getGetVeoSeasonShotsQueryKey(seasonParams) });
    } catch {
      setSyncMsg("Sync failed — please try again.");
    }
  }

  if (ready && activeLeagueId != null && !hasModule(activeLeagueId, "veo")) return <NoAccess />;

  const events: VeoEvent[] = (match?.events as VeoEvent[] | undefined) ?? [];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Video className="h-7 w-7" /> Veo Insights
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Match stats pulled from Veo — event breakdowns, attacking momentum and shot maps for every recorded game.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button onClick={runSync} disabled={syncMut.isPending} className="gap-2">
            {syncMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync from Veo
          </Button>
          {syncMsg && <span className="text-xs text-muted-foreground">{syncMsg}</span>}
        </div>
      </div>

      {listLoading ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">Loading Veo matches…</CardContent></Card>
      ) : synced.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          No Veo matches synced yet for this squad. Hit <span className="font-medium">Sync from Veo</span> to pull them in.
        </CardContent></Card>
      ) : (
        <>
          <MatchLinksCard
            leagueId={activeLeagueId!}
            canLink={isSuperadmin || hasModule(activeLeagueId!, "data-entry")}
          />

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
              {(["season", "match"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                    view === v ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v === "season" ? "Season" : "Match"}
                </button>
              ))}
            </div>
            {view === "match" && (
              <Select value={String(currentId ?? "")} onValueChange={(v) => setSelectedId(Number(v))}>
                <SelectTrigger className="w-full max-w-md"><SelectValue placeholder="Pick a match" /></SelectTrigger>
                <SelectContent>
                  {synced.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.matchCode ? `${m.matchCode} · ` : ""}{opponentOf(m)}{fmtDate(m.startsAt) ? ` · ${fmtDate(m.startsAt)}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {view === "season" ? (
            seasonLoading || !seasonData ? (
              <Card><CardContent className="py-16 text-center text-muted-foreground">Loading season…</CardContent></Card>
            ) : (
              <SeasonView matches={seasonData.matches} shotMatches={seasonShotsData?.matches ?? []} />
            )
          ) : matchLoading || !match ? (
            <Card><CardContent className="py-16 text-center text-muted-foreground">Loading match…</CardContent></Card>
          ) : events.length === 0 ? (
            <Card><CardContent className="py-16 text-center text-muted-foreground">
              This match has no event data in Veo.
            </CardContent></Card>
          ) : (
            <MatchView match={match} events={events} />
          )}
        </>
      )}
    </div>
  );
}

function MatchLinksCard({ leagueId, canLink }: { leagueId: number; canLink: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const linkParams = { leagueId };
  const { data } = useListVeoLinks(linkParams, {
    query: { queryKey: getListVeoLinksQueryKey(linkParams) },
  });
  const links: VeoLinkRow[] = data?.links ?? [];
  const hubMatches: HubMatchOption[] = data?.hubMatches ?? [];
  const linkedCount = links.filter((l) => l.matchId != null).length;

  const invalidate = () => qc.invalidateQueries({ queryKey: getListVeoLinksQueryKey(linkParams) });

  const autoMut = useVeoAutoLink();
  async function runAutoLink() {
    setMsg(null);
    try {
      const r = await autoMut.mutateAsync({ data: { leagueId } });
      setMsg(
        r.linked > 0
          ? `Linked ${r.linked} match${r.linked === 1 ? "" : "es"}${r.ambiguous > 0 ? ` — ${r.ambiguous} ambiguous, fix below` : ""}.`
          : r.ambiguous > 0
            ? `No confident matches — ${r.ambiguous} ambiguous, pick them below.`
            : "Nothing new to link.",
      );
      invalidate();
    } catch {
      setMsg("Auto-link failed — try again.");
    }
  }

  const setMut = useVeoSetLink();
  async function setLink(veoId: number, matchId: number | null) {
    try {
      await setMut.mutateAsync({ data: { leagueId, veoId, matchId } });
      invalidate();
    } catch {
      setMsg("Couldn't save that link — try again.");
    }
  }

  const hubLabel = (h: HubMatchOption) =>
    `${h.matchId.split("-")[0]} v ${h.opponent}${h.matchDate ? ` · ${h.matchDate}` : ""}`;

  return (
    <Card>
      <CardHeader className="pb-3 cursor-pointer select-none" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="h-4 w-4" /> Match links
              <span className="text-xs font-normal text-muted-foreground">
                {linkedCount}/{links.length} linked
              </span>
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Link each Veo recording to its Hub match so video stats appear on the Football Match Report.
            </CardDescription>
          </div>
          {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {canLink && (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="outline" onClick={runAutoLink} disabled={autoMut.isPending} className="gap-1.5">
                {autoMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                Auto-link by date & opponent
              </Button>
              {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
            </div>
          )}
          <div className="space-y-2">
            {links.map((l) => (
              <div key={l.id} className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 rounded-md border p-2.5">
                <div className="min-w-0 sm:w-1/2">
                  <div className="text-sm font-medium truncate flex items-center gap-1.5">
                    {l.matchId != null && <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                    {opponentOf(l)}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[fmtDate(l.startsAt), l.title].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="sm:flex-1">
                  {canLink ? (
                    <Select
                      value={l.matchId != null ? String(l.matchId) : "none"}
                      onValueChange={(v) => setLink(l.id, v === "none" ? null : Number(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Not linked" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not linked</SelectItem>
                        {hubMatches.map((h) => (
                          <SelectItem key={h.id} value={String(h.id)}>{hubLabel(h)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {l.matchId != null
                        ? hubMatches.find((h) => h.id === l.matchId)
                          ? hubLabel(hubMatches.find((h) => h.id === l.matchId)!)
                          : "Linked"
                        : "Not linked"}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {links.length === 0 && (
              <p className="text-xs text-muted-foreground">No Veo matches synced yet.</p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Season view — one row per synced match (oldest → newest), server-aggregated
// event counts, momentum weights applied client-side (same weights as the
// match view's momentum chart).
function SeasonView({ matches, shotMatches }: { matches: VeoSeasonMatch[]; shotMatches: VeoSeasonShotMatch[] }) {
  // A "season" is one calendar year here; the Veo library spans several years,
  // so charts default to the latest year with a year picker to look back.
  const years = useMemo(() => {
    const ys = new Set<number>();
    for (const m of matches) {
      const d = m.startsAt ? new Date(m.startsAt) : null;
      if (d && !isNaN(d.getTime())) ys.add(d.getFullYear());
    }
    return Array.from(ys).sort((a, b) => b - a);
  }, [matches]);
  const [pickedYear, setPickedYear] = useState<number | "all" | null>(null);
  // Clamp to the years that actually exist for this league — a stale pick from
  // another league (or after a re-sync) falls back to the latest year.
  const year: number | "all" =
    pickedYear === "all" || (typeof pickedYear === "number" && years.includes(pickedYear))
      ? pickedYear
      : years[0] ?? "all";
  const setYear = setPickedYear;

  const filtered = useMemo(() => {
    if (year === "all") return matches;
    return matches.filter((m) => {
      const d = m.startsAt ? new Date(m.startsAt) : null;
      return d != null && !isNaN(d.getTime()) && d.getFullYear() === year;
    });
  }, [matches, year]);

  const rows = useMemo(() => {
    return filtered.map((m, i) => {
      const f = (m.countsFor ?? {}) as Record<string, number>;
      const a = (m.countsAgainst ?? {}) as Record<string, number>;
      const n = (c: Record<string, number>, k: string) => Number(c[k] ?? 0);
      // Match view counts goals as shots too (a goal is an on-target shot).
      const shotsFor = n(f, "FootballShot") + n(f, "FootballGoal");
      const shotsAgainst = n(a, "FootballShot") + n(a, "FootballGoal");
      let wFor = 0, wAgainst = 0;
      for (const [type, w] of Object.entries(MOMENTUM_WEIGHT)) {
        wFor += n(f, type) * w;
        wAgainst += n(a, type) * w;
      }
      const tilt = wFor + wAgainst > 0 ? (wFor / (wFor + wAgainst)) * 100 : null;
      return {
        idx: i + 1,
        // Match ID (e.g. R16-WAN-BEL) when linked — matches GPS Insights so the
        // coach can correlate across tabs; fall back to opponent for unlinked games.
        opp: m.matchCode ?? opponentOf(m),
        date: fmtDate(m.startsAt),
        label: m.matchCode
          ? `${m.matchCode} · ${opponentOf(m)}${fmtDate(m.startsAt) ? ` · ${fmtDate(m.startsAt)}` : ""}`
          : `${opponentOf(m)}${fmtDate(m.startsAt) ? ` · ${fmtDate(m.startsAt)}` : ""}`,
        shotsFor, shotsAgainst,
        goalsFor: n(f, "FootballGoal"), goalsAgainst: n(a, "FootballGoal"),
        cornersFor: n(f, "FootballCornerKick"), cornersAgainst: n(a, "FootballCornerKick"),
        tilt,
      };
    });
  }, [filtered]);

  // Season shot map + 15-min threat bands (from /veo/season-shots).
  const [showUs, setShowUs] = useState(true);
  const [showThem, setShowThem] = useState(true);
  const filteredShotMatches = useMemo(() => {
    if (year === "all") return shotMatches;
    return shotMatches.filter((m) => {
      const d = m.startsAt ? new Date(m.startsAt) : null;
      return d != null && !isNaN(d.getTime()) && d.getFullYear() === year;
    });
  }, [shotMatches, year]);

  const seasonShots = useMemo(() => {
    const pts: { x: number; y: number; own: boolean; goal: boolean }[] = [];
    let usTotal = 0, themTotal = 0, located = 0;
    for (const m of filteredShotMatches) {
      for (const s of m.shots) {
        if (s.us) usTotal++; else themTotal++;
        if (s.x == null || s.y == null) continue;
        located++;
        if (s.us && !showUs) continue;
        if (!s.us && !showThem) continue;
        pts.push({ x: s.x, y: s.y, own: s.us, goal: s.goal });
      }
    }
    return { pts, usTotal, themTotal, located };
  }, [filteredShotMatches, showUs, showThem]);

  // Share of each side's shots per 15-min band, computed per match then
  // averaged across matches (so one shot-heavy game can't dominate).
  const threatBands = useMemo(() => {
    const BANDS = 6;
    const sumUs = Array(BANDS).fill(0), sumThem = Array(BANDS).fill(0);
    let nUs = 0, nThem = 0;
    for (const m of filteredShotMatches) {
      const cu = Array(BANDS).fill(0), ct = Array(BANDS).fill(0);
      let tu = 0, tt = 0;
      for (const s of m.shots) {
        // Extra/stoppage time folds into the 75–90 band.
        const b = Math.min(BANDS - 1, Math.max(0, Math.floor(s.minute / 15)));
        if (s.us) { cu[b]++; tu++; } else { ct[b]++; tt++; }
      }
      if (tu > 0) { nUs++; for (let i = 0; i < BANDS; i++) sumUs[i] += cu[i] / tu; }
      if (tt > 0) { nThem++; for (let i = 0; i < BANDS; i++) sumThem[i] += ct[i] / tt; }
    }
    const labels = ["0–15", "15–30", "30–45", "45–60", "60–75", "75–90"];
    return labels.map((label, i) => ({
      label,
      us: nUs > 0 ? (sumUs[i] / nUs) * 100 : 0,
      them: nThem > 0 ? (sumThem[i] / nThem) * 100 : 0,
    }));
  }, [filteredShotMatches]);

  // Hedged insight line: flag our strongest and quietest bands, with the
  // even-share baseline (~16.7%) as the reference point.
  const threatInsight = useMemo(() => {
    if (filteredShotMatches.length < 3) return null;
    const withIdx = threatBands.map((b, i) => ({ ...b, i }));
    const hi = [...withIdx].sort((a, b) => b.us - a.us)[0];
    const lo = [...withIdx].sort((a, b) => a.us - b.us)[0];
    if (hi.us <= 0) return null;
    return `An even spread would put ~17% in each band — so far our threat looks heaviest in the ${hi.label} window (${hi.us.toFixed(0)}%) and quietest in ${lo.label} (${lo.us.toFixed(0)}%), though a handful of games can still swing these numbers.`;
  }, [threatBands, filteredShotMatches.length]);

  const totals = useMemo(() => {
    const withTilt = rows.filter((r) => r.tilt != null);
    const avgTilt = withTilt.length > 0 ? withTilt.reduce((s, r) => s + (r.tilt ?? 0), 0) / withTilt.length : null;
    const sum = (k: "shotsFor" | "shotsAgainst" | "goalsFor" | "goalsAgainst" | "cornersFor" | "cornersAgainst") =>
      rows.reduce((s, r) => s + r[k], 0);
    const games = rows.length || 1;
    return {
      games: rows.length,
      avgTilt,
      shotsForPg: sum("shotsFor") / games, shotsAgainstPg: sum("shotsAgainst") / games,
      goalsFor: sum("goalsFor"), goalsAgainst: sum("goalsAgainst"),
      cornersForPg: sum("cornersFor") / games, cornersAgainstPg: sum("cornersAgainst") / games,
    };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <Card><CardContent className="py-16 text-center text-muted-foreground">
        No synced matches with event data yet.
      </CardContent></Card>
    );
  }

  const tooltip = (
    <Tooltip
      contentStyle={TOOLTIP_BOX}
      cursor={{ fill: "hsl(var(--muted)/0.3)" }}
      labelFormatter={(_, payload) => (payload?.[0]?.payload as { label?: string })?.label ?? ""}
    />
  );
  // With a big "All matches" set, per-match labels turn to soup — thin them out.
  const xAxis = (
    <XAxis dataKey="opp" {...AXIS} interval={rows.length > 24 ? Math.ceil(rows.length / 24) - 1 : 0} angle={-35} textAnchor="end" height={70} />
  );
  const legend = <Legend wrapperStyle={{ fontSize: 12 }} />;

  return (
    <div className="space-y-6">
      {years.length > 1 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground shrink-0">Season</span>
          <Select value={String(year)} onValueChange={(v) => setYear(v === "all" ? "all" : Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
              <SelectItem value="all">All matches</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Games with Veo events" value={String(totals.games)} />
        <StatCard
          label="Avg field tilt (us)"
          value={totals.avgTilt != null ? `${totals.avgTilt.toFixed(0)}%` : "—"}
          sub="Event-weighted momentum share"
        />
        <StatCard label="Shots per game" value={`${totals.shotsForPg.toFixed(1)} – ${totals.shotsAgainstPg.toFixed(1)}`} sub="us – them" />
        <StatCard label="Corners per game" value={`${totals.cornersForPg.toFixed(1)} – ${totals.cornersAgainstPg.toFixed(1)}`} sub="us – them" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Shots per match</CardTitle>
            <CardDescription>Shots (incl. goals) for and against, round by round.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={rows} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                {xAxis}
                <YAxis {...AXIS} allowDecimals={false} />
                {tooltip}
                {legend}
                <Bar dataKey="shotsFor" name="Belconnen" fill={C_US} radius={[3, 3, 0, 0]} />
                <Bar dataKey="shotsAgainst" name="Opponents" fill={C_THEM} radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Goals per match</CardTitle>
            <CardDescription>Season so far: {totals.goalsFor} scored, {totals.goalsAgainst} conceded (from Veo events).</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={rows} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                {xAxis}
                <YAxis {...AXIS} allowDecimals={false} />
                {tooltip}
                {legend}
                <Bar dataKey="goalsFor" name="Belconnen" fill={C_US} radius={[3, 3, 0, 0]} />
                <Bar dataKey="goalsAgainst" name="Opponents" fill={C_THEM} radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Corners per match</CardTitle>
            <CardDescription>Corner counts for and against, round by round.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={rows} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                {xAxis}
                <YAxis {...AXIS} allowDecimals={false} />
                {tooltip}
                {legend}
                <Bar dataKey="cornersFor" name="Belconnen" fill={C_US} radius={[3, 3, 0, 0]} />
                <Bar dataKey="cornersAgainst" name="Opponents" fill={C_THEM} radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Field tilt per match</CardTitle>
            <CardDescription>
              Our share of event-weighted attacking momentum — above 50% means we carried more threat.
              Dashed line is the season average{totals.avgTilt != null ? ` (${totals.avgTilt.toFixed(0)}%)` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={rows} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                {xAxis}
                <YAxis {...AXIS} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <Tooltip
                  contentStyle={TOOLTIP_BOX}
                  cursor={{ fill: "hsl(var(--muted)/0.3)" }}
                  formatter={(v: number) => [`${Number(v).toFixed(0)}%`, "Field tilt"]}
                  labelFormatter={(_, payload) => (payload?.[0]?.payload as { label?: string })?.label ?? ""}
                />
                <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" />
                {totals.avgTilt != null && (
                  <ReferenceLine y={totals.avgTilt} stroke={C_US} strokeDasharray="5 4" />
                )}
                <Bar dataKey="tilt" name="Field tilt">
                  {rows.map((r, i) => (
                    <Cell key={i} fill={(r.tilt ?? 0) >= 50 ? C_US : C_THEM} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Season shot map</CardTitle>
          <CardDescription>
            {seasonShots.located > 0 ? (
              <>Every shot with a recorded location across {filteredShotMatches.length} synced {filteredShotMatches.length === 1 ? "match" : "matches"} — we attack right ({seasonShots.usTotal} shots), opponents attack left ({seasonShots.themTotal}). Filled markers are goals.</>
            ) : (
              "No shot locations recorded for this season yet."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={showUs ? "default" : "outline"} size="sm"
              onClick={() => setShowUs((v) => !v)}
            >
              Belconnen
            </Button>
            <Button
              variant={showThem ? "default" : "outline"} size="sm"
              onClick={() => setShowThem((v) => !v)}
            >
              Opponents
            </Button>
          </div>
          <ShotMap shots={seasonShots.pts} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>When the threat comes — 15-minute bands</CardTitle>
          <CardDescription>
            Share of each side's shots (incl. goals) per 15-minute window, averaged per match across the season. Stoppage and extra time count in the 75–90 band.
            {threatInsight ? <> {threatInsight}</> : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={threatBands} margin={{ left: -10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="label" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={(v) => `${v}%`} />
              <Tooltip
                contentStyle={TOOLTIP_BOX}
                cursor={{ fill: "hsl(var(--muted)/0.3)" }}
                formatter={(v: number, n) => [`${Number(v).toFixed(1)}%`, n]}
                labelFormatter={(l) => `${l} min`}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={100 / 6} stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" />
              <Bar dataKey="us" name="Belconnen" fill={C_US} radius={[3, 3, 0, 0]} />
              <Bar dataKey="them" name="Opponents" fill={C_THEM} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1">{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function MatchView({ match, events }: { match: { opponent?: string | null; title?: string | null; startsAt?: string | null; periods?: unknown }; events: VeoEvent[] }) {
  const opp = opponentOf(match);

  const goals = useMemo(() => {
    let us = 0, them = 0;
    for (const e of events) if (e.event_type === "FootballGoal") (isOwn(e) ? us++ : them++);
    return { us, them };
  }, [events]);

  // Own vs Opp counts per event type.
  const compare = useMemo(() => {
    const rows = COMPARE_ORDER.map((type) => {
      let us = 0, them = 0;
      for (const e of events) if (e.event_type === type) (isOwn(e) ? us++ : them++);
      return { type, label: EVENT_LABELS[type] ?? type, us, them };
    }).filter((r) => r.us > 0 || r.them > 0);
    return rows;
  }, [events]);

  // Field-tilt / momentum: event-weighted, per 5-min bin, us positive / them negative.
  const momentum = useMemo(() => {
    const minuteOf = makeMinuteOf(match.periods);
    const maxMin = Math.max(90, ...events.map(minuteOf));
    const bins = Math.ceil(maxMin / BIN_MIN);
    const arr = Array.from({ length: bins }, (_, i) => ({ min: i * BIN_MIN, us: 0, them: 0 }));
    for (const e of events) {
      const w = MOMENTUM_WEIGHT[e.event_type];
      if (!w) continue;
      const idx = Math.min(bins - 1, Math.floor(minuteOf(e) / BIN_MIN));
      if (idx < 0) continue;
      if (isOwn(e)) arr[idx].us += w; else arr[idx].them -= w;
    }
    return arr;
  }, [events, match.periods]);

  // Shot map: normalise so we always attack to the right, them to the left.
  const shots = useMemo(() => {
    const periods = Array.isArray(match.periods) ? (match.periods as { own_side?: string }[]) : [];
    const pts: { x: number; y: number; own: boolean; goal: boolean }[] = [];
    for (const e of events) {
      if (e.event_type !== "FootballShot" && e.event_type !== "FootballGoal") continue;
      if (e.x == null || e.z == null) continue;
      const side = periods[(Number(e.period_id) || 1) - 1]?.own_side ?? "right";
      // own_side = the end our GOAL is at, so we attack the other end. To show
      // us always attacking right (and them left), rotate the WHOLE pitch 180°
      // for any period where our goal sits on the RIGHT (we'd be attacking left).
      const flip = side === "right";
      const x = flip ? 1 - e.x : e.x;
      const y = flip ? 1 - e.z : e.z;
      pts.push({ x, y, own: isOwn(e), goal: e.event_type === "FootballGoal" });
    }
    return pts;
  }, [events, match.periods]);

  const shotTotals = useMemo(() => {
    let us = 0, them = 0;
    for (const e of events) if (e.event_type === "FootballShot" || e.event_type === "FootballGoal") (isOwn(e) ? us++ : them++);
    return { us, them };
  }, [events]);

  // Shot timeline: every shot (both teams) placed on the match clock; goals highlighted.
  const timeline = useMemo(() => {
    const minuteOf = makeMinuteOf(match.periods);
    const pts: { min: number; own: boolean; goal: boolean }[] = [];
    for (const e of events) {
      if (e.event_type !== "FootballShot" && e.event_type !== "FootballGoal") continue;
      pts.push({ min: minuteOf(e), own: isOwn(e), goal: e.event_type === "FootballGoal" });
    }
    pts.sort((a, b) => a.min - b.min);
    const maxMin = Math.max(90, ...pts.map((p) => p.min));
    // Half-time marker from real period durations when available.
    const durs = Array.isArray(match.periods)
      ? (match.periods as { duration?: number }[]).map((p) => (Number(p?.duration) > 0 ? Number(p.duration) / 60 : 45))
      : [];
    const halfAt = durs.length > 0 ? durs[0] : 45;
    return { pts, maxMin, halfAt };
  }, [events, match.periods]);

  // Set-piece pressure: corners + free kicks by half, us vs them.
  const setPieces = useMemo(() => {
    const nHalves = Math.max(2, Array.isArray(match.periods) ? (match.periods as unknown[]).length : 2);
    const rows = Array.from({ length: nHalves }, (_, i) => ({
      half: i === 0 ? "1st half" : i === 1 ? "2nd half" : `Period ${i + 1}`,
      usCorners: 0, usFreeKicks: 0, themCorners: 0, themFreeKicks: 0,
    }));
    let any = false;
    for (const e of events) {
      if (e.event_type !== "FootballCornerKick" && e.event_type !== "FootballFreeKick") continue;
      const idx = Math.min(rows.length - 1, Math.max(0, (Number(e.period_id) || 1) - 1));
      const corner = e.event_type === "FootballCornerKick";
      if (isOwn(e)) (corner ? rows[idx].usCorners++ : rows[idx].usFreeKicks++);
      else (corner ? rows[idx].themCorners++ : rows[idx].themFreeKicks++);
      any = true;
    }
    return { rows, any };
  }, [events, match.periods]);

  // Box vs outside: bucket located shots by whether they were struck inside the
  // penalty box. Uses the already-flipped shot coords (we attack right, them
  // left); box depth 16.5/105 ≈ 0.157 of pitch length, width 40.3/68 ≈ 0.59.
  const shotZones = useMemo(() => {
    const BOX_X = 16.5 / 105, BOX_Y_LO = 0.5 - 40.3 / 68 / 2, BOX_Y_HI = 0.5 + 40.3 / 68 / 2;
    const z = { usBox: 0, usOut: 0, themBox: 0, themOut: 0 };
    for (const s of shots) {
      const inBox = s.own
        ? s.x >= 1 - BOX_X && s.y >= BOX_Y_LO && s.y <= BOX_Y_HI
        : s.x <= BOX_X && s.y >= BOX_Y_LO && s.y <= BOX_Y_HI;
      if (s.own) (inBox ? z.usBox++ : z.usOut++);
      else (inBox ? z.themBox++ : z.themOut++);
    }
    return {
      any: shots.length > 0,
      rows: [
        { zone: "Inside the box", us: z.usBox, them: z.themBox },
        { zone: "Outside the box", us: z.usOut, them: z.themOut },
      ],
    };
  }, [shots]);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="py-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-center">
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Belconnen</div>
            <div className="text-3xl font-bold" style={{ color: C_US }}>{goals.us}</div>
          </div>
          <div className="text-2xl font-light text-muted-foreground">–</div>
          <div className="text-left">
            <div className="text-xs text-muted-foreground">{opp}</div>
            <div className="text-3xl font-bold" style={{ color: C_THEM }}>{goals.them}</div>
          </div>
          <div className="w-full text-xs text-muted-foreground">{fmtDate(match.startsAt)} · from Veo events</div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Match events — us vs {opp}</CardTitle>
            <CardDescription>Counts from the Veo event feed.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(240, compare.length * 42)}>
              <BarChart data={compare} layout="vertical" margin={{ left: 10, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" {...AXIS} allowDecimals={false} />
                <YAxis type="category" dataKey="label" width={80} {...AXIS} />
                <Tooltip contentStyle={TOOLTIP_BOX} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                <Bar dataKey="us" name="Belconnen" fill={C_US} radius={[0, 3, 3, 0]} />
                <Bar dataKey="them" name={opp} fill={C_THEM} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Attacking momentum</CardTitle>
            <CardDescription>Event-weighted field tilt in {BIN_MIN}-min blocks — up is us, down is {opp}.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={momentum} stackOffset="sign" margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="min" {...AXIS} tickFormatter={(m) => `${m}'`} />
                <YAxis {...AXIS} />
                <Tooltip contentStyle={TOOLTIP_BOX} cursor={{ fill: "hsl(var(--muted)/0.3)" }}
                  formatter={(v: number, n) => [Math.abs(v).toFixed(1), n]} labelFormatter={(m) => `${m}–${Number(m) + BIN_MIN} min`} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <Bar dataKey="us" name="Belconnen" fill={C_US} stackId="m" />
                <Bar dataKey="them" name={opp} fill={C_THEM} stackId="m" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shot timeline</CardTitle>
          <CardDescription>
            {timeline.pts.length > 0
              ? <>Every shot on the match clock — us above the line, {opp} below. Filled markers are goals. Read alongside the momentum chart to spot goals against the run of play.</>
              : "No shots recorded for this match."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShotTimeline pts={timeline.pts} maxMin={timeline.maxMin} halfAt={timeline.halfAt} opp={opp} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Set-piece pressure</CardTitle>
            <CardDescription>
              {setPieces.any
                ? <>Corners and free kicks by half — us vs {opp}.</>
                : "No corners or free kicks recorded for this match."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {setPieces.any && (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={setPieces.rows} margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="half" {...AXIS} />
                  <YAxis {...AXIS} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_BOX} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="usCorners" name="Our corners" stackId="us" fill={C_US} />
                  <Bar dataKey="usFreeKicks" name="Our free kicks" stackId="us" fill={C_US} fillOpacity={0.45} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="themCorners" name={`${opp} corners`} stackId="them" fill={C_THEM} />
                  <Bar dataKey="themFreeKicks" name={`${opp} free kicks`} stackId="them" fill={C_THEM} fillOpacity={0.45} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Box vs outside shots</CardTitle>
            <CardDescription>
              {shotZones.any
                ? <>Located shots bucketed by where they were struck — inside the penalty box (real chances) vs outside (hopeful punts).</>
                : "No shot locations recorded for this match."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shotZones.any && (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={shotZones.rows} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" {...AXIS} allowDecimals={false} />
                  <YAxis type="category" dataKey="zone" width={100} {...AXIS} />
                  <Tooltip contentStyle={TOOLTIP_BOX} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="us" name="Belconnen" fill={C_US} radius={[0, 3, 3, 0]} />
                  <Bar dataKey="them" name={opp} fill={C_THEM} radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Shot map</CardTitle>
          <CardDescription>
            {shotTotals.us + shotTotals.them > 0
              ? <>Every shot with a recorded location — we attack right ({shotTotals.us}), {opp} attack left ({shotTotals.them}). Filled markers are goals.</>
              : "No shot locations recorded for this match."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ShotMap shots={shots} />
        </CardContent>
      </Card>
    </div>
  );
}

function ShotTimeline({ pts, maxMin, halfAt, opp }: { pts: { min: number; own: boolean; goal: boolean }[]; maxMin: number; halfAt: number; opp: string }) {
  if (pts.length === 0) return null;
  const W = 900, H = 150, padX = 28, padY = 18;
  const midY = H / 2;
  const px = (m: number) => padX + (m / maxMin) * (W - 2 * padX);
  const line = "hsl(var(--border))";
  const muted = "hsl(var(--muted-foreground))";
  const ticks: number[] = [];
  for (let m = 0; m <= maxMin; m += 15) ticks.push(m);
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: 170 }}>
        <line x1={padX} y1={midY} x2={W - padX} y2={midY} stroke={line} />
        <line x1={px(halfAt)} y1={padY} x2={px(halfAt)} y2={H - padY} stroke={muted} strokeDasharray="4 4" opacity={0.6} />
        <text x={px(halfAt)} y={padY - 5} textAnchor="middle" fontSize={10} fill={muted}>HT</text>
        {ticks.map((m) => (
          <g key={m}>
            <line x1={px(m)} y1={midY - 3} x2={px(m)} y2={midY + 3} stroke={muted} />
            <text x={px(m)} y={H - 2} textAnchor="middle" fontSize={10} fill={muted}>{m}'</text>
          </g>
        ))}
        <text x={padX} y={padY + 2} fontSize={10} fill={C_US}>Belconnen</text>
        <text x={padX} y={H - padY + 4} fontSize={10} fill={C_THEM}>{opp}</text>
        {pts.map((p, i) => {
          const cy = p.own ? midY - 22 : midY + 22;
          return (
            <g key={i}>
              <line x1={px(p.min)} y1={midY} x2={px(p.min)} y2={cy} stroke={p.own ? C_US : C_THEM} strokeWidth={1} opacity={0.35} />
              <circle cx={px(p.min)} cy={cy} r={p.goal ? 8 : 5}
                fill={p.goal ? (p.own ? C_US : C_THEM) : "transparent"}
                stroke={p.own ? C_US : C_THEM} strokeWidth={2} opacity={0.9}>
                <title>{`${Math.floor(p.min)}' — ${p.own ? "Belconnen" : opp} ${p.goal ? "GOAL" : "shot"}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
function ShotMap({ shots }: { shots: { x: number; y: number; own: boolean; goal: boolean }[] }) {
  const W = 900, H = 560, pad = 12;
  const px = (x: number) => pad + x * (W - 2 * pad);
  const py = (y: number) => pad + y * (H - 2 * pad);
  const line = "hsl(var(--border))";
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: 420 }}>
        <rect x={pad} y={pad} width={W - 2 * pad} height={H - 2 * pad} fill="hsl(var(--muted)/0.25)" stroke={line} rx={6} />
        <line x1={W / 2} y1={pad} x2={W / 2} y2={H - pad} stroke={line} />
        <circle cx={W / 2} cy={H / 2} r={64} fill="none" stroke={line} />
        {/* penalty boxes */}
        <rect x={pad} y={H * 0.22} width={(W - 2 * pad) * 0.16} height={H * 0.56} fill="none" stroke={line} />
        <rect x={W - pad - (W - 2 * pad) * 0.16} y={H * 0.22} width={(W - 2 * pad) * 0.16} height={H * 0.56} fill="none" stroke={line} />
        {shots.map((s, i) => (
          <circle key={i} cx={px(s.x)} cy={py(s.y)} r={s.goal ? 9 : 6}
            fill={s.goal ? (s.own ? C_US : C_THEM) : "transparent"}
            stroke={s.own ? C_US : C_THEM} strokeWidth={2} opacity={0.9} />
        ))}
      </svg>
    </div>
  );
}
