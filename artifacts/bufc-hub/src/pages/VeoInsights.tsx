import React, { useState, useMemo, useEffect, useRef } from "react";
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
  useGetVeoSeasonPassing,
  getGetVeoSeasonPassingQueryKey,
  getGetVeoPlayerSeasonQueryKey,
  getGetVeoPlayerMatchQueryKey,
  type VeoSeasonPassingMatch,
  useListVeoLinks,
  getListVeoLinksQueryKey,
  useVeoAutoLink,
  useVeoSetLink,
  useVeoRemoveMatch,
  useVeoRefetchMatch,
  type VeoMatchSummary,
  type VeoSeasonMatch,
  type VeoSeasonShotMatch,
  type VeoEvent,
  type VeoLinkRow,
  type HubMatchOption,
  type VeoScoreMismatch,
  useGetClubs,
  getGetClubsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Loader2, RefreshCw, Video, Link2, ChevronDown, ChevronUp, Wand2, Check, Trash2, Undo2, RotateCcw, Clock, AlertTriangle } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
  ComposedChart, Line, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { NoAccess } from "@/components/NoAccess";
import { useActiveLeague } from "@/contexts/LeagueContext";
import { VeoSeasonPlayers } from "@/components/veo/VeoSeasonPlayers";
import { VeoMatchPlayers } from "@/components/veo/VeoMatchPlayers";

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

// Old recording titles use club abbreviations — map them to the club names the
// rest of the Hub uses so the legend groups games under one club per opponent.
// (The server does the same on sync; this covers rows synced before that.)
const CLUB_ALIASES: Record<string, string> = { TUFC: "Tuggeranong", CCFC: "Croatia" };
function normalizeClub(name: string): string {
  return name
    .replace(/\b[A-Z]{3,5}\b/g, (tok) => CLUB_ALIASES[tok] ?? tok)
    .replace(/\s+(Res(erves)?|1sts?|2nds?)$/i, "")
    .trim();
}

// Opponent CLUB for a recording. Best source is the linked Hub match's own
// opponent (always a clean club name); otherwise parse it out of the Veo
// title — "… vs Club" or the coach's "YYYYMMDD-round-squad-Club" convention.
function opponentOf(m: { opponent?: string | null; title?: string | null; hubOpponent?: string | null }): string {
  const hub = (m.hubOpponent ?? "").trim();
  if (hub) return hub;
  const raw = (m.opponent ?? "").trim();
  if (raw && !/firsts|reserves|nplw|1sts|^\d{8}-|^$/i.test(raw)) return normalizeClub(raw) || "Opponent";
  const t = (m.title ?? "").trim();
  const vs = t.match(/\bvs?\.?\s+(.+)$/i);
  if (vs && vs[1].trim()) return normalizeClub(vs[1]) || "Opponent";
  if (/^\d{8}-/.test(t)) {
    const segs = t.split("-").map((s) => s.trim()).filter(Boolean);
    const squadIdx = segs.findIndex((s) => /^(1sts?|2nds?|firsts?|seconds?|res(erves)?|u\d+)$/i.test(s));
    const rest = squadIdx >= 0 ? segs.slice(squadIdx + 1) : segs.slice(3);
    if (rest.length > 0) return normalizeClub(rest.join("-")) || "Opponent";
  }
  return normalizeClub(t || raw) || "Opponent";
}

// Clickable opponent legend (same pattern as Season Stats): toggle a club off
// to drop its games from every season chart — handy for judging the numbers
// against just the stronger teams.
function OppToggleLegend({ opponents, hidden, onToggle, colorFor }: {
  opponents: string[]; hidden: Set<string>; onToggle: (opp: string) => void;
  colorFor?: (opp: string) => string | undefined;
}) {
  if (opponents.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
      {opponents.map((opp) => {
        const off = hidden.has(opp);
        return (
          <button key={opp} type="button" onClick={() => onToggle(opp)} aria-pressed={!off}
            className="flex items-center gap-1.5" style={{ cursor: "pointer" }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorFor?.(opp) ?? "hsl(var(--chart-1))", opacity: off ? 0.25 : 1 }} />
            <span style={{
              color: off ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
              textDecoration: off ? "line-through" : "none",
            }}>
              {opp}
            </span>
          </button>
        );
      })}
      {hidden.size > 0 && (
        <button type="button" className="text-muted-foreground underline" onClick={() => opponents.forEach((o) => hidden.has(o) && onToggle(o))}>
          show all
        </button>
      )}
    </div>
  );
}

// Rich hover card for the season trend charts: hovered series values up top,
// then the full context of that match (score, shots, corners, tilt) so any
// chart's hover tells the whole story of the game.
type SeasonRow = {
  label?: string; opp?: string; date?: string;
  goalsFor?: number; goalsAgainst?: number; shotsFor?: number; shotsAgainst?: number;
  cornersFor?: number; cornersAgainst?: number; tilt?: number | null;
};
function VeoSeasonTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: SeasonRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  // Drop null-valued series (e.g. tilt on a no-event match) — showing "0% us"
  // for missing tilt would be false data, not an unavailable stat.
  const items = payload.filter((p) => p.value != null);
  if (!items.length) return null;
  const shownNames = new Set(items.map((p) => p.name));
  const ctx: { label: string; value: string }[] = [];
  const pair = (name: string, f?: number, a?: number) => {
    if (!shownNames.has(name) && f != null && a != null) ctx.push({ label: name, value: `${f} – ${a}` });
  };
  pair("Score", row.goalsFor, row.goalsAgainst);
  pair("Shots", row.shotsFor, row.shotsAgainst);
  pair("Corners", row.cornersFor, row.cornersAgainst);
  if (row.tilt != null && !shownNames.has("Field tilt")) ctx.push({ label: "Field tilt", value: `${row.tilt.toFixed(0)}% us` });
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[190px] space-y-2">
      <div className="font-semibold text-sm">{row.label}</div>
      <div className="border-t pt-2 space-y-1">
        {items.map((p) => (
          <div key={p.name} className="flex justify-between gap-6">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span>{p.name === "Field tilt" ? `${(Number(p.value) + 50).toFixed(0)}% us` : p.value}</span>
          </div>
        ))}
      </div>
      {ctx.length > 0 && (
        <div className="border-t pt-2 space-y-1">
          {ctx.map((c) => (
            <div key={c.label} className="flex justify-between gap-6">
              <span className="text-muted-foreground">{c.label}</span>
              <span>{c.value}</span>
            </div>
          ))}
          <div className="text-[10px] text-muted-foreground pt-1">us – them, from Veo events</div>
        </div>
      )}
    </div>
  );
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
  const [subView, setSubView] = useState<"team" | "players">("team");

  const listParams = { leagueId: activeLeagueId ?? 0 };
  const { data: listData, isLoading: listLoading } = useListVeoMatches(listParams, {
    query: { enabled: activeLeagueId != null, queryKey: getListVeoMatchesQueryKey(listParams) },
  });
  const matches: VeoMatchSummary[] = listData?.matches ?? [];
  const synced = matches.filter((m) => m.synced);

  // Fall back to the newest match if the selected one disappears from the list
  // (e.g. the coach just removed it in Match links).
  const currentId =
    selectedId != null && synced.some((m) => m.id === selectedId)
      ? selectedId
      : synced[0]?.id ?? null;
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

  // Possession & passing summaries (Veo RAS analytics) — used by the season
  // trend charts AND the match view (looked up by veo row id).
  const { data: seasonPassingData } = useGetVeoSeasonPassing(seasonParams, {
    query: {
      enabled: activeLeagueId != null,
      queryKey: getGetVeoSeasonPassingQueryKey(seasonParams),
    },
  });

  const syncMut = useVeoSync();
  async function runSync() {
    if (activeLeagueId == null) return;
    setSyncMsg("Starting sync…");
    try {
      for (let i = 0; i < 25; i++) {
        const r = await syncMut.mutateAsync({ data: { leagueId: activeLeagueId, batch: 20 } });
        const playerReady = Math.max(0, r.totalMatches - r.playerRemaining - r.playerUnavailable);
        setSyncMsg(
          `Team data ${r.totalMatches - r.remaining}/${r.totalMatches} · player data ${playerReady}/${r.totalMatches}${r.playerUnavailable > 0 ? ` · ${r.playerUnavailable} unavailable` : ""}…`,
        );
        if (r.done) {
          if (r.analyticsPending > 0 || r.playerUnavailable > 0) {
            const notes: string[] = [];
            if (r.analyticsPending > 0) notes.push(`${r.analyticsPending} passing ${r.analyticsPending === 1 ? "feed" : "feeds"} still processing`);
            if (r.playerUnavailable > 0) notes.push(`${r.playerUnavailable} player ${r.playerUnavailable === 1 ? "dataset" : "datasets"} unavailable`);
            setSyncMsg(`Done — ${notes.join(" · ")}.`);
          } else {
            setSyncMsg(`Done — team and player data synced for ${r.totalMatches} matches.`);
          }
          break;
        }
      }
      qc.invalidateQueries({ queryKey: getListVeoMatchesQueryKey(listParams) });
      qc.invalidateQueries({ queryKey: getGetVeoSeasonQueryKey(seasonParams) });
      qc.invalidateQueries({ queryKey: getGetVeoSeasonShotsQueryKey(seasonParams) });
      qc.invalidateQueries({ queryKey: getGetVeoSeasonPassingQueryKey(seasonParams) });
      qc.invalidateQueries({ queryKey: getGetVeoPlayerSeasonQueryKey(seasonParams) });
      if (currentId != null) {
        const playerMatchParams = { leagueId: activeLeagueId, veoId: currentId };
        qc.invalidateQueries({ queryKey: getGetVeoPlayerMatchQueryKey(playerMatchParams) });
      }
    } catch (e) {
      // Show the server's actual reason (e.g. Veo login failure) so repeated
      // failures are diagnosable instead of a generic "try again".
      const detail = e instanceof Error && e.message ? ` — ${e.message}` : " — please try again.";
      setSyncMsg(`Sync failed${detail}`);
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

            <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
              {(["team", "players"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setSubView(v)}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                    subView === v ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v === "team" ? "Team" : "Players"}
                </button>
              ))}
            </div>

            {view === "match" && (
              <Select value={String(currentId ?? "")} onValueChange={(v) => setSelectedId(Number(v))}>
                <SelectTrigger className="w-full max-w-md"><SelectValue placeholder="Pick a match" /></SelectTrigger>
                <SelectContent>
                  {synced.map((m) => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      <span className="flex items-center gap-1.5">
                        {m.matchCode ? `${m.matchCode} · ` : ""}{opponentOf(m)}{fmtDate(m.startsAt) ? ` · ${fmtDate(m.startsAt)}` : ""}
                        {m.pendingAnalytics && (
                          <span className="inline-flex items-center gap-0.5 rounded text-[10px] font-medium px-1 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                            <Clock className="h-2.5 w-2.5" />
                            Passing pending
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {view === "season" ? (
            subView === "team" ? (
              seasonLoading || !seasonData ? (
                <Card><CardContent className="py-16 text-center text-muted-foreground">Loading season…</CardContent></Card>
              ) : (
                <SeasonView
                  matches={seasonData.matches}
                  shotMatches={seasonShotsData?.matches ?? []}
                  passingMatches={seasonPassingData?.matches ?? []}
                />
              )
            ) : (
              <VeoSeasonPlayers leagueId={activeLeagueId!} />
            )
          ) : matchLoading || !match ? (
            <Card><CardContent className="py-16 text-center text-muted-foreground">Loading match…</CardContent></Card>
          ) : subView === "team" ? (
            events.length === 0 ? (
              <Card><CardContent className="py-16 text-center text-muted-foreground">
                This match has no event data in Veo.
              </CardContent></Card>
            ) : (
              <MatchView
                match={match}
                events={events}
                passing={seasonPassingData?.matches.find((p) => p.id === currentId) ?? null}
              />
            )
          ) : (
            currentId != null ? (
              <VeoMatchPlayers leagueId={activeLeagueId!} veoId={currentId} />
            ) : (
              <Card><CardContent className="py-16 text-center text-muted-foreground">No match selected.</CardContent></Card>
            )
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

  const removeMut = useVeoRemoveMatch();
  async function setRemoved(veoId: number, removed: boolean, label: string) {
    if (removed && !window.confirm(`Remove "${label}" from all charts and reports? The data is kept and you can restore it here any time.`)) return;
    try {
      await removeMut.mutateAsync({ data: { leagueId, veoId, removed } });
      // A removed/restored game changes every chart on this page, not just
      // the links list — refetch the lot.
      qc.invalidateQueries();
    } catch {
      setMsg(removed ? "Couldn't remove that game — try again." : "Couldn't restore that game — try again.");
    }
  }

  const [refetchingId, setRefetchingId] = useState<number | null>(null);
  const refetchMut = useVeoRefetchMatch();
  async function refetchStats(veoId: number, label: string) {
    if (!window.confirm(`Re-fetch stats for "${label}" from Veo?\n\nThis clears the current data and re-downloads it — useful after fixing team directions or other settings in Veo.`)) return;
    setRefetchingId(veoId);
    try {
      await refetchMut.mutateAsync({ data: { leagueId, veoId } });
      setMsg("Stats re-fetched — charts will update now.");
      // Invalidate everything so all charts pick up the fresh data.
      qc.invalidateQueries();
    } catch {
      setMsg("Re-fetch failed — try again or press Sync to retry.");
    } finally {
      setRefetchingId(null);
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
              <div key={l.id} className={`flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3 rounded-md border p-2.5 ${l.removed ? "opacity-60" : ""}`}>
                <div className="min-w-0 sm:w-1/2">
                  <div className="text-sm font-medium truncate flex items-center gap-1.5">
                    {!l.removed && l.matchId != null && <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                    {opponentOf(l)}
                    {l.removed && (
                      <span className="text-[10px] font-normal uppercase tracking-wide rounded bg-muted px-1.5 py-0.5 text-muted-foreground shrink-0">removed</span>
                    )}
                    {!l.removed && l.pendingAnalytics && (
                      <span className="inline-flex items-center gap-0.5 rounded text-[10px] font-medium px-1.5 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0" title="Pass analytics are still processing on Veo — sync again later to pick them up">
                        <Clock className="h-2.5 w-2.5" />
                        Passing pending
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[fmtDate(l.startsAt), l.title].filter(Boolean).join(" · ")}
                  </div>
                  {l.scoreMismatch && (
                    <div className="flex items-center gap-1 mt-0.5 text-[11px] text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Veo: {l.scoreMismatch.veoFor}–{l.scoreMismatch.veoAgainst} · Hub: {l.scoreMismatch.hubFor}–{l.scoreMismatch.hubAgainst} — check the result
                    </div>
                  )}
                </div>
                <div className="sm:flex-1">
                  {l.removed ? (
                    <span className="text-xs text-muted-foreground">Hidden from all charts & reports</span>
                  ) : canLink ? (
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
                {canLink && !l.removed && l.synced && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground shrink-0 self-start sm:self-center gap-1"
                    disabled={refetchingId === l.id}
                    onClick={() =>
                      refetchStats(l.id, `${opponentOf(l)}${fmtDate(l.startsAt) ? ` · ${fmtDate(l.startsAt)}` : ""}`)
                    }
                    title="Clear and re-download stats from Veo (e.g. after fixing team directions)"
                  >
                    {refetchingId === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    Re-fetch
                  </Button>
                )}
                {canLink && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground shrink-0 self-start sm:self-center gap-1"
                    disabled={removeMut.isPending}
                    onClick={() =>
                      setRemoved(l.id, !l.removed, `${opponentOf(l)}${fmtDate(l.startsAt) ? ` · ${fmtDate(l.startsAt)}` : ""}`)
                    }
                  >
                    {l.removed ? <Undo2 className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {l.removed ? "Restore" : "Remove"}
                  </Button>
                )}
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
function SeasonView({ matches, shotMatches, passingMatches }: {
  matches: VeoSeasonMatch[];
  shotMatches: VeoSeasonShotMatch[];
  passingMatches: VeoSeasonPassingMatch[];
}) {
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

  const yearFiltered = useMemo(() => {
    if (year === "all") return matches;
    return matches.filter((m) => {
      const d = m.startsAt ? new Date(m.startsAt) : null;
      return d != null && !isNaN(d.getTime()) && d.getFullYear() === year;
    });
  }, [matches, year]);

  // Club brand colours so the opponent legend dots match the other tabs.
  const { data: clubs } = useGetClubs({ query: { queryKey: getGetClubsQueryKey() } });
  const clubColorFor = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of clubs ?? []) map[c.name] = c.primaryColor;
    return (opp: string) => map[opp];
  }, [clubs]);

  // Clickable opponent legend: hide clubs to focus the season charts on the
  // games that matter (e.g. just the stronger teams).
  const [hiddenOpps, setHiddenOpps] = useState<Set<string>>(new Set());
  // A hidden club must not silently filter a different season or league —
  // reset the legend whenever the dataset scope changes.
  useEffect(() => {
    setHiddenOpps(new Set());
  }, [year, matches]);
  const toggleOpp = (opp: string) =>
    setHiddenOpps((prev) => {
      const next = new Set(prev);
      if (next.has(opp)) next.delete(opp); else next.add(opp);
      return next;
    });
  const allOpponents = useMemo(
    () => Array.from(new Set(yearFiltered.map(opponentOf))).sort((a, b) => a.localeCompare(b)),
    [yearFiltered],
  );
  const filtered = useMemo(
    () => yearFiltered.filter((m) => !hiddenOpps.has(opponentOf(m))),
    [yearFiltered, hiddenOpps],
  );

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
        // Diverging view: distance from an even 50/50 game, so "better than
        // even" bars go up and "worse than even" bars go down.
        tiltDiff: tilt != null ? tilt - 50 : null,
      };
    });
  }, [filtered]);

  // Season shot map + 15-min threat bands (from /veo/season-shots).
  const [showUs, setShowUs] = useState(true);
  const [showThem, setShowThem] = useState(true);
  const filteredShotMatches = useMemo(() => {
    return shotMatches.filter((m) => {
      if (hiddenOpps.has(opponentOf(m))) return false;
      if (year === "all") return true;
      const d = m.startsAt ? new Date(m.startsAt) : null;
      return d != null && !isNaN(d.getTime()) && d.getFullYear() === year;
    });
  }, [shotMatches, year, hiddenOpps]);

  // Per-chart club legends for the busy season charts — the shot map and the
  // two threat-timing charts each get their own toggle, on top of the page-wide
  // opponent legend up top.
  const [hiddenMapOpps, setHiddenMapOpps] = useState<Set<string>>(new Set());
  const [hiddenThreatUsOpps, setHiddenThreatUsOpps] = useState<Set<string>>(new Set());
  const [hiddenThreatThemOpps, setHiddenThreatThemOpps] = useState<Set<string>>(new Set());
  useEffect(() => {
    setHiddenMapOpps(new Set());
    setHiddenThreatUsOpps(new Set());
    setHiddenThreatThemOpps(new Set());
  }, [year, shotMatches]);
  const toggleIn = (set: React.Dispatch<React.SetStateAction<Set<string>>>) => (opp: string) =>
    set((prev) => {
      const next = new Set(prev);
      if (next.has(opp)) next.delete(opp); else next.add(opp);
      return next;
    });
  const shotOpponents = useMemo(
    () => Array.from(new Set(filteredShotMatches.map(opponentOf))).sort((a, b) => a.localeCompare(b)),
    [filteredShotMatches],
  );
  const mapMatches = useMemo(
    () => filteredShotMatches.filter((m) => !hiddenMapOpps.has(opponentOf(m))),
    [filteredShotMatches, hiddenMapOpps],
  );

  const seasonShots = useMemo(() => {
    const pts: { x: number; y: number; own: boolean; goal: boolean }[] = [];
    let usTotal = 0, themTotal = 0, located = 0;
    for (const m of mapMatches) {
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
  }, [mapMatches, showUs, showThem]);

  // Average shots per game in each 15-min band — real counts, not shares, so
  // our volume and the opponents' volume can be compared honestly. One chart
  // per side (each with its own club toggle) because the raw numbers differ.
  const bandCounts = (ms: VeoSeasonShotMatch[], us: boolean) => {
    const BANDS = 6;
    const sum = Array(BANDS).fill(0);
    const n = ms.length;
    for (const m of ms) {
      for (const s of m.shots) {
        if (s.us !== us) continue;
        // Extra/stoppage time folds into the 75–90 band.
        sum[Math.min(BANDS - 1, Math.max(0, Math.floor(s.minute / 15)))]++;
      }
    }
    const labels = ["0–15", "15–30", "30–45", "45–60", "60–75", "75–90"];
    return labels.map((label, i) => ({
      label,
      avg: n > 0 ? Number((sum[i] / n).toFixed(2)) : 0,
      total: sum[i],
    }));
  };
  const threatUs = useMemo(
    () => bandCounts(filteredShotMatches.filter((m) => !hiddenThreatUsOpps.has(opponentOf(m))), true),
    [filteredShotMatches, hiddenThreatUsOpps],
  );
  const threatThem = useMemo(
    () => bandCounts(filteredShotMatches.filter((m) => !hiddenThreatThemOpps.has(opponentOf(m))), false),
    [filteredShotMatches, hiddenThreatThemOpps],
  );

  // Both threat charts share a Y scale so the volumes compare honestly.
  const threatMax = useMemo(
    () => Math.max(1, Math.ceil(Math.max(...threatUs.map((b) => b.avg), ...threatThem.map((b) => b.avg)))),
    [threatUs, threatThem],
  );

  // Hedged insight line, now on real volumes rather than shares.
  const threatInsight = useMemo(() => {
    if (filteredShotMatches.length < 3) return null;
    const hi = [...threatUs].sort((a, b) => b.avg - a.avg)[0];
    const lo = [...threatUs].sort((a, b) => a.avg - b.avg)[0];
    if (!hi || hi.avg <= 0) return null;
    return `So far our shot volume looks heaviest in the ${hi.label} window (~${hi.avg.toFixed(1)} per game) and quietest in ${lo.label} (~${lo.avg.toFixed(1)}), though a handful of games can still swing these numbers.`;
  }, [threatUs, filteredShotMatches.length]);

  // ── Possession & passing rows (from Veo RAS analytics) ─────────────────────
  // Same year + opponent-legend filters as the event charts; oldest first, so
  // left→right on these charts reads as the season's progression.
  const passRows = useMemo(() => {
    const filteredPassing = passingMatches.filter((m) => {
      if (hiddenOpps.has(opponentOf(m))) return false;
      if (year === "all") return true;
      const d = m.startsAt ? new Date(m.startsAt) : null;
      return d != null && !isNaN(d.getTime()) && d.getFullYear() === year;
    });
    return filteredPassing.map((m) => {
      const totalSec = m.possessionSecUs + m.possessionSecThem;
      const possPct = totalSec > 0 ? (m.possessionSecUs / totalSec) * 100 : null;
      const bucket = (strings: { len: number; count: number }[]) => {
        let short = 0, mid = 0, long = 0, weighted = 0, total = 0;
        for (const s of strings) {
          if (s.len <= 2) short += s.count;
          else if (s.len <= 5) mid += s.count;
          else long += s.count;
          weighted += s.len * s.count;
          total += s.count;
        }
        return { short, mid, long, avgLen: total > 0 ? weighted / total : null, total };
      };
      const us = bucket(m.passStringsUs);
      const them = bucket(m.passStringsThem);
      const thirdsTotal = m.thirdsUs.defensive + m.thirdsUs.middle + m.thirdsUs.attacking;
      return {
        opp: m.matchCode ?? opponentOf(m),
        date: fmtDate(m.startsAt),
        label: m.matchCode
          ? `${m.matchCode} · ${opponentOf(m)}${fmtDate(m.startsAt) ? ` · ${fmtDate(m.startsAt)}` : ""}`
          : `${opponentOf(m)}${fmtDate(m.startsAt) ? ` · ${fmtDate(m.startsAt)}` : ""}`,
        possPct: possPct != null ? Number(possPct.toFixed(1)) : null,
        possMinUs: Number((m.possessionSecUs / 60).toFixed(1)),
        possMinThem: Number((m.possessionSecThem / 60).toFixed(1)),
        passesUs: m.passesUs,
        passesThem: m.passesThem,
        possWonUs: m.possessionWonUs,
        possWonThem: m.possessionWonThem,
        strings2: us.short, strings35: us.mid, strings6: us.long,
        avgStringUs: us.avgLen != null ? Number(us.avgLen.toFixed(2)) : null,
        avgStringThem: them.avgLen != null ? Number(them.avgLen.toFixed(2)) : null,
        longThem: them.long,
        thirdDef: thirdsTotal > 0 ? Number(((m.thirdsUs.defensive / thirdsTotal) * 100).toFixed(1)) : null,
        thirdMid: thirdsTotal > 0 ? Number(((m.thirdsUs.middle / thirdsTotal) * 100).toFixed(1)) : null,
        thirdAtt: thirdsTotal > 0 ? Number(((m.thirdsUs.attacking / thirdsTotal) * 100).toFixed(1)) : null,
      };
    });
  }, [passingMatches, year, hiddenOpps]);

  // Rolling 3-game averages — the "momentum" read: is the trend line climbing?
  const passRowsWithRolling = useMemo(() => {
    const roll = (vals: (number | null)[], i: number) => {
      const win = vals.slice(Math.max(0, i - 2), i + 1).filter((v): v is number => v != null);
      return win.length > 0 ? Number((win.reduce((s, v) => s + v, 0) / win.length).toFixed(1)) : null;
    };
    const poss = passRows.map((r) => r.possPct);
    const passes = passRows.map((r) => r.passesUs as number | null);
    const mins = passRows.map((r) => r.possMinUs as number | null);
    const longs = passRows.map((r) => r.strings6 as number | null);
    const wons = passRows.map((r) => r.possWonUs as number | null);
    return passRows.map((r, i) => ({
      ...r,
      possRoll: roll(poss, i),
      passesRoll: roll(passes, i),
      minsRoll: roll(mins, i),
      longRoll: roll(longs, i),
      wonRoll: roll(wons, i),
    }));
  }, [passRows]);

  // Passing style by club — average pass length + long-ball share, aggregated
  // across every filtered match. Veo's pass vectors give relative lengths (no
  // known units), so this is an index for comparing styles, not metres.
  const clubStyle = useMemo(() => {
    const agg = new Map<string, { sumLen: number; n: number; long: number }>();
    const add = (club: string, s: { n: number; mean: number; longPct: number } | null | undefined) => {
      if (!s || s.n <= 0) return;
      const a = agg.get(club) ?? { sumLen: 0, n: 0, long: 0 };
      a.sumLen += s.mean * s.n;
      a.n += s.n;
      a.long += (s.longPct / 100) * s.n;
      agg.set(club, a);
    };
    for (const m of passingMatches) {
      if (hiddenOpps.has(opponentOf(m))) continue;
      if (year !== "all") {
        const d = m.startsAt ? new Date(m.startsAt) : null;
        if (d == null || isNaN(d.getTime()) || d.getFullYear() !== year) continue;
      }
      add("Belconnen", m.passLenUs);
      add(opponentOf(m), m.passLenThem);
    }
    return Array.from(agg.entries())
      .map(([club, a]) => ({
        club,
        avgIdx: Number(((a.sumLen / a.n) * 100).toFixed(1)),
        longPct: Number(((a.long / a.n) * 100).toFixed(1)),
        n: a.n,
      }))
      .filter((r) => r.n >= 50) // too few passes = noise, not style
      .sort((a, b) => b.longPct - a.longPct);
  }, [passingMatches, year, hiddenOpps]);

  const passTotals = useMemo(() => {
    const withPct = passRows.filter((r) => r.possPct != null);
    const avg = (vals: number[]) => (vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null);
    return {
      games: passRows.length,
      avgPoss: avg(withPct.map((r) => r.possPct!)),
      avgPasses: avg(passRows.map((r) => r.passesUs)),
      avgPossMin: avg(passRows.map((r) => r.possMinUs)),
      avgLongStrings: avg(passRows.map((r) => r.strings6)),
    };
  }, [passRows]);

  // Hedged progress line for the team talk: first third vs last third of games.
  const passInsight = useMemo(() => {
    const withPct = passRowsWithRolling.filter((r) => r.possPct != null);
    if (withPct.length < 6) return null;
    const n = Math.max(2, Math.floor(withPct.length / 3));
    const early = withPct.slice(0, n);
    const late = withPct.slice(-n);
    const avg = (vals: number[]) => vals.reduce((s, v) => s + v, 0) / vals.length;
    const dPoss = avg(late.map((r) => r.possPct!)) - avg(early.map((r) => r.possPct!));
    const dPasses = avg(late.map((r) => r.passesUs)) - avg(early.map((r) => r.passesUs));
    const dLong = avg(late.map((r) => r.strings6)) - avg(early.map((r) => r.strings6));
    const dir = (v: number, unit: string, noun: string) =>
      `${noun} ${v >= 0 ? "up" : "down"} ${Math.abs(v).toFixed(1)}${unit}`;
    return `Comparing the first ${n} and last ${n} games with tracking: ${dir(dPoss, " pts", "possession share")}, ${dir(dPasses, "", "completed passes per game")}, ${dir(dLong, "", "6+ pass strings per game")}. A few one-sided games can swing these, so read the rolling lines rather than any single match.`;
  }, [passRowsWithRolling]);

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
    <Tooltip content={<VeoSeasonTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
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
      <OppToggleLegend opponents={allOpponents} hidden={hiddenOpps} onToggle={toggleOpp} colorFor={clubColorFor} />
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

      <div className="grid grid-cols-1 gap-6">
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
              Momentum-style view: the middle line is an even 50/50 game. Bars up = we carried more of the threat,
              bars down = they did — the further from the line, the more one-sided it was.
              Dashed line is the season average{totals.avgTilt != null ? ` (${totals.avgTilt.toFixed(0)}% us)` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={rows} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                {xAxis}
                <YAxis
                  {...AXIS}
                  domain={[-50, 50]}
                  ticks={[-50, -25, 0, 25, 50]}
                  tickFormatter={(v) => (v === 0 ? "even" : `${v > 0 ? "+" : "−"}${Math.abs(Number(v))}`)}
                />
                {tooltip}
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                {totals.avgTilt != null && (
                  <ReferenceLine y={totals.avgTilt - 50} stroke={C_US} strokeDasharray="5 4" />
                )}
                <Bar dataKey="tiltDiff" name="Field tilt">
                  {rows.map((r, i) => (
                    <Cell key={i} fill={(r.tiltDiff ?? 0) >= 0 ? C_US : C_THEM} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {passRowsWithRolling.length > 0 && (
        <>
          <div className="pt-2">
            <h2 className="text-xl font-semibold tracking-tight">Possession &amp; passing</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              From Veo's ball-tracking analytics — how our passing game is developing across the season.
              {passInsight ? <> {passInsight}</> : null}
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Avg possession"
              value={passTotals.avgPoss != null ? `${passTotals.avgPoss.toFixed(0)}%` : "—"}
              sub={`${passTotals.games} games with tracking`}
            />
            <StatCard
              label="Passes per game"
              value={passTotals.avgPasses != null ? passTotals.avgPasses.toFixed(0) : "—"}
              sub="completed, us"
            />
            <StatCard
              label="Possession minutes"
              value={passTotals.avgPossMin != null ? passTotals.avgPossMin.toFixed(1) : "—"}
              sub="per game, us"
            />
            <StatCard
              label="6+ pass strings"
              value={passTotals.avgLongStrings != null ? passTotals.avgLongStrings.toFixed(1) : "—"}
              sub="per game, us"
            />
          </div>

          {/* One chart per row — full width keeps every opponent label visible. */}
          <div className="grid grid-cols-1 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Possession share per match</CardTitle>
                <CardDescription>
                  Our share of ball-in-possession time. Solid line is the 3-game rolling average — that's the trend to watch.
                  {passTotals.avgPoss != null ? ` Season average ${passTotals.avgPoss.toFixed(0)}% (dashed).` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={passRowsWithRolling} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="opp" {...AXIS} interval={0} angle={-55} textAnchor="end" height={90} />
                    <YAxis {...AXIS} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                    {tooltip}
                    <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" />
                    {passTotals.avgPoss != null && (
                      <ReferenceLine y={passTotals.avgPoss} stroke={C_US} strokeDasharray="5 4" />
                    )}
                    <Bar dataKey="possPct" name="Possession %">
                      {passRowsWithRolling.map((r, i) => (
                        <Cell key={i} fill={(r.possPct ?? 0) >= 50 ? C_US : C_THEM} />
                      ))}
                    </Bar>
                    <Line dataKey="possRoll" name="3-game trend" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Possession minutes per match</CardTitle>
                <CardDescription>Minutes of ball-in-possession time, us vs opponents, with our 3-game rolling average.</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={passRowsWithRolling} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="opp" {...AXIS} interval={0} angle={-55} textAnchor="end" height={90} />
                    <YAxis {...AXIS} />
                    {tooltip}
                    {legend}
                    <Bar dataKey="possMinUs" name="Belconnen" fill={C_US} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="possMinThem" name="Opponents" fill={C_THEM} radius={[3, 3, 0, 0]} />
                    <Line dataKey="minsRoll" name="3-game trend (us)" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Completed passes per match</CardTitle>
                <CardDescription>Completed passes for and against, with our 3-game rolling average.</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={passRowsWithRolling} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="opp" {...AXIS} interval={0} angle={-55} textAnchor="end" height={90} />
                    <YAxis {...AXIS} allowDecimals={false} />
                    {tooltip}
                    {legend}
                    <Bar dataKey="passesUs" name="Belconnen" fill={C_US} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="passesThem" name="Opponents" fill={C_THEM} radius={[3, 3, 0, 0]} />
                    <Line dataKey="passesRoll" name="3-game trend (us)" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Pass strings per match</CardTitle>
                <CardDescription>
                  Our connected-pass sequences by length — the taller the 3–5 and 6+ segments, the more we're keeping the ball moving. Line tracks 6+ strings (3-game rolling).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={passRowsWithRolling} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="opp" {...AXIS} interval={0} angle={-55} textAnchor="end" height={90} />
                    <YAxis {...AXIS} allowDecimals={false} />
                    {tooltip}
                    {legend}
                    <Bar dataKey="strings2" name="2 passes" stackId="s" fill={C_US} fillOpacity={0.35} />
                    <Bar dataKey="strings35" name="3–5 passes" stackId="s" fill={C_US} fillOpacity={0.7} />
                    <Bar dataKey="strings6" name="6+ passes" stackId="s" fill={C_US} radius={[3, 3, 0, 0]} />
                    <Line dataKey="longRoll" name="6+ trend" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Possession won per match</CardTitle>
                <CardDescription>
                  Regains — how many times each side won the ball back. Line is our 3-game rolling average.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={passRowsWithRolling} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="opp" {...AXIS} interval={0} angle={-55} textAnchor="end" height={90} />
                    <YAxis {...AXIS} allowDecimals={false} />
                    {tooltip}
                    {legend}
                    <Bar dataKey="possWonUs" name="Belconnen" fill={C_US} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="possWonThem" name="Opponents" fill={C_THEM} radius={[3, 3, 0, 0]} />
                    <Line dataKey="wonRoll" name="3-game trend (us)" stroke="hsl(var(--foreground))" strokeWidth={2} dot={false} connectNulls />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Where we have the ball — possession by third</CardTitle>
              <CardDescription>
                Share of our possession spent in each third of the pitch, match by match. More middle/attacking third over time = playing higher up.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={passRowsWithRolling} stackOffset="expand" margin={{ left: -10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="opp" {...AXIS} interval={0} angle={-55} textAnchor="end" height={90} />
                  <YAxis {...AXIS} tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`} />
                  {tooltip}
                  {legend}
                  <Bar dataKey="thirdDef" name="Defensive third" stackId="t" fill={C_THEM} fillOpacity={0.6} />
                  <Bar dataKey="thirdMid" name="Middle third" stackId="t" fill={C_US} fillOpacity={0.45} />
                  <Bar dataKey="thirdAtt" name="Attacking third" stackId="t" fill={C_US} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {clubStyle.length >= 2 && (
            <Card>
              <CardHeader>
                <CardTitle>Passing style by club</CardTitle>
                <CardDescription>
                  How each side moves the ball, from the length of every recorded pass. Veo doesn't give real-world
                  units, so "length index" is for comparing clubs (higher = longer passing); long passes are the
                  clearly-hit ones — roughly the longest quarter league-wide. Sorted most direct → shortest passing.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Two panels with independent scales — long-pass share is a %
                    of passes, the length index is unitless; one shared axis
                    would invite false comparisons between the two. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { key: "longPct" as const, title: "Long passes — share of all passes", fmt: (v: number, n: number) => `${v.toFixed(1)}% (${n} passes sampled)` },
                    { key: "avgIdx" as const, title: "Average pass length (index)", fmt: (v: number, n: number) => `${v.toFixed(1)} (${n} passes sampled)` },
                  ].map(({ key, title, fmt }) => (
                    <div key={key}>
                      <div className="text-xs font-medium text-muted-foreground mb-1">{title}</div>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={clubStyle} margin={{ left: -10, right: 10 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="club" {...AXIS} interval={0} angle={-35} textAnchor="end" height={70} />
                          <YAxis {...AXIS} />
                          <Tooltip
                            contentStyle={TOOLTIP_BOX}
                            cursor={{ fill: "hsl(var(--muted)/0.3)" }}
                            formatter={(v: number, _name, item) => [
                              fmt(Number(v), (item?.payload as { n?: number })?.n ?? 0),
                              title,
                            ]}
                          />
                          <Bar dataKey={key} name={title} fill={C_US} radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

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
          <OppToggleLegend opponents={shotOpponents} hidden={hiddenMapOpps} onToggle={toggleIn(setHiddenMapOpps)} colorFor={clubColorFor} />
          <ShotMap shots={seasonShots.pts} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>When our threat comes — 15-minute bands</CardTitle>
            <CardDescription>
              Average shots (incl. goals) we take per game in each 15-minute window — real volumes, so a quiet band means genuinely few shots, not just a smaller share. Stoppage and extra time count in the 75–90 band.
              {threatInsight ? <> {threatInsight}</> : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <OppToggleLegend opponents={shotOpponents} hidden={hiddenThreatUsOpps} onToggle={toggleIn(setHiddenThreatUsOpps)} colorFor={clubColorFor} />
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={threatUs} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" {...AXIS} />
                <YAxis {...AXIS} domain={[0, threatMax]} />
                <Tooltip
                  contentStyle={TOOLTIP_BOX}
                  cursor={{ fill: "hsl(var(--muted)/0.3)" }}
                  formatter={(v: number, n, item) => [
                    `${Number(v).toFixed(1)} per game (${(item?.payload as { total?: number })?.total ?? 0} total)`,
                    "Belconnen shots",
                  ]}
                  labelFormatter={(l) => `${l} min`}
                />
                <Bar dataKey="avg" name="Belconnen" fill={C_US} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>When their threat comes — 15-minute bands</CardTitle>
            <CardDescription>
              Average shots per game our opponents take in each window, on the same scale as our chart — so the two can be compared side by side.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <OppToggleLegend opponents={shotOpponents} hidden={hiddenThreatThemOpps} onToggle={toggleIn(setHiddenThreatThemOpps)} colorFor={clubColorFor} />
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={threatThem} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" {...AXIS} />
                <YAxis {...AXIS} domain={[0, threatMax]} />
                <Tooltip
                  contentStyle={TOOLTIP_BOX}
                  cursor={{ fill: "hsl(var(--muted)/0.3)" }}
                  formatter={(v: number, n, item) => [
                    `${Number(v).toFixed(1)} per game (${(item?.payload as { total?: number })?.total ?? 0} total)`,
                    "Opponent shots",
                  ]}
                  labelFormatter={(l) => `${l} min`}
                />
                <Bar dataKey="avg" name="Opponents" fill={C_THEM} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
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

function MatchView({ match, events, passing }: {
  match: { opponent?: string | null; title?: string | null; startsAt?: string | null; periods?: unknown; passDetails?: Record<string, unknown> | null };
  events: VeoEvent[];
  passing: VeoSeasonPassingMatch | null;
}) {
  const opp = opponentOf(match);

  // Possession heat map from the RAS 18-zone grid. Veo's raw "passLocations"
  // points turned out NOT to be pitch positions (they form the same centred
  // blob for every team in every match — pass geometry, not location), so the
  // zone grid is the real positional data. Layout, verified against the
  // per-third possession totals: 18 values = 6 lengthwise columns of 3
  // cross-pitch cells, ordered from the team's OWN defensive end to its
  // attacking end (per-team relative — no own_side flip needed, just mirror
  // the opponent when rendering).
  const possHeat = useMemo(() => {
    const pd = match.passDetails as { available?: boolean; items?: Array<{
      start: number; end: number;
      possessionLocationsGrid?: Record<string, { type?: string; values?: number[] }>;
    }> } | null | undefined;
    if (!pd || pd.available !== true || !Array.isArray(pd.items)) return null;
    const periodRows = Array.isArray(match.periods)
      ? (match.periods as { timeframe?: [number, number]; own_side?: string }[])
      : [];
    const us = Array.from({ length: 18 }, () => 0);
    const them = Array.from({ length: 18 }, () => 0);
    for (const item of pd.items) {
      const period = periodRows.find(
        (p) => p.timeframe?.[0] === item.start && p.timeframe?.[1] === item.end,
      );
      const ownSide = period?.own_side ?? "right";
      const ownLR = ownSide === "left" ? "L" : "R";
      const oppLR = ownSide === "left" ? "R" : "L";
      const grab = (key: string, into: number[]) => {
        const g = item.possessionLocationsGrid?.[key];
        if (g?.type !== "18_zone_system" || !Array.isArray(g.values) || g.values.length !== 18) return;
        g.values.forEach((v, i) => { into[i] += Number(v) || 0; });
      };
      grab(ownLR, us);
      grab(oppLR, them);
    }
    const usTot = us.reduce((a, b) => a + b, 0);
    const themTot = them.reduce((a, b) => a + b, 0);
    if (usTot === 0 && themTot === 0) return null;
    return { us, them, usTot, themTot };
  }, [match.passDetails, match.periods]);

  // 5-minute heat windows (synced separately by the server) mapped onto match
  // minutes, so the heat map can be scrubbed to any time window. Windows keep
  // per-team-relative grids; own_side of the containing period picks us/them.
  const heatWins = useMemo(() => {
    const pd = match.passDetails as { available?: boolean; heatWindows?: Array<{
      start: number; end: number; grid?: Record<string, { type?: string; values?: number[] }>;
    }> } | null | undefined;
    if (pd?.available !== true || !Array.isArray(pd.heatWindows) || pd.heatWindows.length === 0) return null;
    const periodRows = Array.isArray(match.periods)
      ? (match.periods as { timeframe?: [number, number]; own_side?: string; duration?: number }[])
      : [];
    const durMin = periodRows.map((p) => (Number(p?.duration) > 0 ? Number(p.duration) / 60 : 45));
    const wins: { fromMin: number; toMin: number; us: number[] | null; them: number[] | null }[] = [];
    for (const w of pd.heatWindows) {
      const idx = periodRows.findIndex(
        (p) => Array.isArray(p.timeframe) && w.start >= p.timeframe[0] && w.end <= p.timeframe[1],
      );
      if (idx < 0) continue;
      const ownSide = periodRows[idx]?.own_side ?? "right";
      const ownLR = ownSide === "left" ? "L" : "R";
      const oppLR = ownSide === "left" ? "R" : "L";
      const offset = durMin.slice(0, idx).reduce((a, b) => a + b, 0);
      const grab = (key: string) => {
        const g = w.grid?.[key];
        return g?.type === "18_zone_system" && Array.isArray(g.values) && g.values.length === 18 ? g.values : null;
      };
      wins.push({
        fromMin: offset + (w.start - periodRows[idx].timeframe![0]) / 60,
        toMin: offset + (w.end - periodRows[idx].timeframe![0]) / 60,
        us: grab(ownLR),
        them: grab(oppLR),
      });
    }
    if (wins.length === 0) return null;
    wins.sort((a, b) => a.fromMin - b.fromMin);
    return { wins, maxMin: Math.ceil(wins[wins.length - 1].toMin) };
  }, [match.passDetails, match.periods]);

  // null = full match. Reset whenever the selected match changes; the clamp
  // below also guards the first render after switching to a shorter match
  // (before the effect fires) so Radix never sees out-of-range thumbs.
  const [heatRange, setHeatRange] = useState<[number, number] | null>(null);
  useEffect(() => { setHeatRange(null); }, [match.title, match.startsAt]);
  const heatRangeClamped = useMemo<[number, number] | null>(() => {
    if (!heatWins || !heatRange) return null;
    const a = Math.max(0, Math.min(heatRange[0], heatWins.maxMin));
    const b = Math.max(0, Math.min(heatRange[1], heatWins.maxMin));
    if (b - a <= 0) return null; // degenerate after clamping → full match
    if (a === 0 && b === heatWins.maxMin) return null; // full range = full match
    return [a, b];
  }, [heatWins, heatRange]);

  // Passing style for this match: pass lengths from the RAS pass vectors
  // (distance from the 0.5,0.5 origin — relative units, comparison only).
  const passStyle = useMemo(() => {
    const pd = match.passDetails as { available?: boolean; items?: Array<{
      start: number; end: number; passLocations?: Record<string, { x: number; y: number }[]>;
    }> } | null | undefined;
    if (pd?.available !== true || !Array.isArray(pd.items)) return null;
    const periodRows = Array.isArray(match.periods)
      ? (match.periods as { timeframe?: [number, number]; own_side?: string }[])
      : [];
    const us: number[] = [];
    const them: number[] = [];
    for (const item of pd.items) {
      const period = periodRows.find(
        (p) => p.timeframe?.[0] === item.start && p.timeframe?.[1] === item.end,
      );
      const ownSide = period?.own_side ?? "right";
      const ownLR = ownSide === "left" ? "L" : "R";
      const oppLR = ownSide === "left" ? "R" : "L";
      const push = (arr: number[], pts: { x: number; y: number }[] | undefined) => {
        for (const pt of pts ?? []) {
          const dx = Number(pt?.x), dy = Number(pt?.y);
          if (Number.isFinite(dx) && Number.isFinite(dy)) arr.push(Math.hypot(dx - 0.5, dy - 0.5));
        }
      };
      push(us, item.passLocations?.[ownLR]);
      push(them, item.passLocations?.[oppLR]);
    }
    const stats = (arr: number[]) => {
      if (arr.length < 20) return null; // too few passes to call it a style
      const sorted = [...arr].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const shortN = arr.filter((v) => v < 0.1).length;
      const longN = arr.filter((v) => v > 0.25).length;
      return {
        n: arr.length,
        medianIdx: Number((median * 100).toFixed(1)),
        shortPct: (shortN / arr.length) * 100,
        midPct: ((arr.length - shortN - longN) / arr.length) * 100,
        longPct: (longN / arr.length) * 100,
      };
    };
    const u = stats(us), t = stats(them);
    if (!u && !t) return null;
    return { us: u, them: t };
  }, [match.passDetails, match.periods]);

  const heatSel = useMemo(() => {
    if (!heatWins || !heatRangeClamped) return null;
    const [a, b] = heatRangeClamped;
    const us = Array.from({ length: 18 }, () => 0);
    const them = Array.from({ length: 18 }, () => 0);
    for (const w of heatWins.wins) {
      // Weight each slice by how much of it falls inside the selection —
      // period boundaries rarely land on whole 5-minute marks (29.5-min
      // halves exist), so partial slices must not count in full.
      const overlap = Math.min(w.toMin, b) - Math.max(w.fromMin, a);
      if (overlap <= 0) continue;
      const frac = Math.min(1, overlap / Math.max(w.toMin - w.fromMin, 0.001));
      w.us?.forEach((v, i) => { us[i] += (Number(v) || 0) * frac; });
      w.them?.forEach((v, i) => { them[i] += (Number(v) || 0) * frac; });
    }
    return {
      us, them,
      usTot: us.reduce((x, y) => x + y, 0),
      themTot: them.reduce((x, y) => x + y, 0),
    };
  }, [heatWins, heatRangeClamped]);

  // Possession & passing (Veo RAS analytics) for this match, when available.
  const passStats = useMemo(() => {
    if (!passing) return null;
    const totalSec = passing.possessionSecUs + passing.possessionSecThem;
    if (totalSec <= 0) return null;
    // Merge both teams' pass-string buckets onto one axis for the histogram.
    const lens = Array.from(new Set([
      ...passing.passStringsUs.map((s) => s.len),
      ...passing.passStringsThem.map((s) => s.len),
    ])).sort((a, b) => a - b);
    const hist = lens.map((len) => ({
      len: `${len}`,
      us: passing.passStringsUs.find((s) => s.len === len)?.count ?? 0,
      them: passing.passStringsThem.find((s) => s.len === len)?.count ?? 0,
    }));
    const thirds = (t: { defensive: number; middle: number; attacking: number }) => {
      const total = t.defensive + t.middle + t.attacking;
      return total > 0
        ? { def: (t.defensive / total) * 100, mid: (t.middle / total) * 100, att: (t.attacking / total) * 100 }
        : null;
    };
    return {
      possPctUs: (passing.possessionSecUs / totalSec) * 100,
      possMinUs: passing.possessionSecUs / 60,
      possMinThem: passing.possessionSecThem / 60,
      passesUs: passing.passesUs,
      passesThem: passing.passesThem,
      possWonUs: passing.possessionWonUs,
      possWonThem: passing.possessionWonThem,
      hist,
      thirdsUs: thirds(passing.thirdsUs),
      thirdsThem: thirds(passing.thirdsThem),
    };
  }, [passing]);

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

  // Field-tilt timeline: a 0–90′ line sampled every 5 minutes. Each point is
  // our share of the weighted threat events (shots, goals, corners, frees…)
  // inside a 15-minute window centred on that point — the window smooths out
  // bins that happen to have no events. Stored as tilt−50 so the midline is an
  // even game. A dashed per-half step line adds TERRITORY when RAS possession
  // thirds exist: our share of the attacking-third possession time that half.
  const tiltLine = useMemo(() => {
    const minuteOf = makeMinuteOf(match.periods);
    const evs = events
      .map((e) => ({ min: minuteOf(e), w: MOMENTUM_WEIGHT[e.event_type] ?? 0, own: isOwn(e) }))
      .filter((e) => e.w > 0);
    if (evs.length === 0) return null;

    // Per-half territory tilt from RAS possession-by-thirds (the raw pass
    // "locations" turned out not to be pitch positions, so we use each side's
    // attacking-third possession seconds instead). Renders as flat half
    // segments — the thirds data is only bucketed per half.
    const halfTilt: { from: number; to: number; tilt: number }[] = [];
    const pd = match.passDetails as { available?: boolean; items?: Array<{
      start: number; end: number;
      possessionLocations?: Record<string, { defensive?: number; middle?: number; attacking?: number }>;
    }> } | null | undefined;
    const periodRows = Array.isArray(match.periods)
      ? (match.periods as { timeframe?: [number, number]; own_side?: string; duration?: number }[]) : [];
    const durMin = periodRows.map((p) => (Number(p?.duration) > 0 ? Number(p.duration) / 60 : 45));
    // Chart extent: total played time from real period durations (short halves
    // exist!); fall back to 90 only when Veo gave us no periods.
    const playedMin = durMin.reduce((a, b) => a + b, 0);
    const maxEventMin = Math.max(...evs.map((e) => e.min));
    const maxMin = periodRows.length > 0 ? Math.max(playedMin, maxEventMin) : Math.max(90, maxEventMin);
    if (pd?.available === true && Array.isArray(pd.items)) {
      pd.items.forEach((item) => {
        const idx = periodRows.findIndex((p) => p.timeframe?.[0] === item.start && p.timeframe?.[1] === item.end);
        if (idx < 0) return;
        const ownSide = periodRows[idx]?.own_side ?? "right";
        const ownLR = ownSide === "left" ? "L" : "R";
        const oppLR = ownSide === "left" ? "R" : "L";
        // Attacking-third possession seconds — per-team relative, no flip needed.
        const usFin = Number(item.possessionLocations?.[ownLR]?.attacking) || 0;
        const themFin = Number(item.possessionLocations?.[oppLR]?.attacking) || 0;
        if (usFin + themFin === 0) return;
        const from = durMin.slice(0, idx).reduce((a, b) => a + b, 0);
        halfTilt.push({ from, to: from + durMin[idx], tilt: (usFin / (usFin + themFin)) * 100 });
      });
    }

    const HALF_WINDOW = 7.5;
    const rows: { min: number; tiltDiff: number | null; evUs: number; evThem: number; passDiff: number | null }[] = [];
    for (let t = 0; t <= Math.ceil(maxMin / 5) * 5; t += 5) {
      let us = 0, them = 0, evUs = 0, evThem = 0;
      for (const e of evs) {
        if (e.min < t - HALF_WINDOW || e.min >= t + HALF_WINDOW) continue;
        if (e.own) { us += e.w; evUs++; } else { them += e.w; evThem++; }
      }
      const tot = us + them;
      // Half-open interval so a boundary sample (e.g. exactly 45') belongs to
      // the second half; the very last endpoint stays with the final half.
      const seg = halfTilt.find((h, i) => t >= h.from && (i === halfTilt.length - 1 ? t <= h.to : t < h.to));
      rows.push({
        min: t,
        tiltDiff: tot > 0 ? Number(((us / tot) * 100 - 50).toFixed(1)) : null,
        evUs, evThem,
        passDiff: seg ? Number((seg.tilt - 50).toFixed(1)) : null,
      });
    }
    const halfAt = periodRows.length > 0 && Number(periodRows[0]?.duration) > 0 ? Number(periodRows[0].duration) / 60 : 45;
    return { rows, maxMin: rows[rows.length - 1].min, halfAt, hasPass: halfTilt.length > 0 };
  }, [events, match.periods, match.passDetails]);

  // Shot map: normalise so we always attack to the right, them to the left.
  const shots = useMemo(() => {
    const periods = Array.isArray(match.periods) ? (match.periods as { own_side?: string }[]) : [];
    const minuteOf = makeMinuteOf(match.periods);
    const pts: { x: number; y: number; own: boolean; goal: boolean; min: number }[] = [];
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
      pts.push({ x, y, own: isOwn(e), goal: e.event_type === "FootballGoal", min: minuteOf(e) });
    }
    return pts;
  }, [events, match.periods]);

  const shotTotals = useMemo(() => {
    let us = 0, them = 0;
    for (const e of events) if (e.event_type === "FootballShot" || e.event_type === "FootballGoal") (isOwn(e) ? us++ : them++);
    return { us, them };
  }, [events]);

  // Spider-web match story: each spoke is a metric shown as our share vs
  // theirs (both sides always sum to 100%), with the raw numbers in the hover.
  const radar = useMemo(() => {
    const rows: { metric: string; us: number; them: number; rawUs: string; rawThem: string }[] = [];
    const add = (metric: string, u: number | null | undefined, t: number | null | undefined, fmt: (v: number) => string = (v) => String(Math.round(v))) => {
      if (u == null || t == null) return;
      const tot = u + t;
      if (tot <= 0) return;
      rows.push({ metric, us: Number(((u / tot) * 100).toFixed(1)), them: Number(((t / tot) * 100).toFixed(1)), rawUs: fmt(u), rawThem: fmt(t) });
    };
    add("Shots", shotTotals.us, shotTotals.them);
    const corners = { us: 0, them: 0 };
    for (const e of events) if (e.event_type === "FootballCornerKick") (isOwn(e) ? corners.us++ : corners.them++);
    add("Corners", corners.us, corners.them);
    let wUs = 0, wThem = 0;
    for (const e of events) {
      const w = MOMENTUM_WEIGHT[e.event_type];
      if (!w) continue;
      if (isOwn(e)) wUs += w; else wThem += w;
    }
    add("Field tilt", wUs, wThem, (v) => `${Math.round((v / (wUs + wThem)) * 100)}%`);
    if (passStats) {
      add("Possession", passStats.possMinUs, passStats.possMinThem, (v) => `${v.toFixed(1)} min`);
      add("Passes", passStats.passesUs, passStats.passesThem);
    }
    return rows;
  }, [events, shotTotals, passStats]);

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

      {radar.length >= 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Match story at a glance</CardTitle>
            <CardDescription>
              Each spoke splits a metric between the two sides — the bigger our shaded area, the more of the game we owned. Hover a spoke for the real numbers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={320}>
              <RadarChart data={radar} outerRadius="72%">
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                {/* Ticks must be rendered (tiny) or Recharts ignores the domain. */}
                <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={3} tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))", opacity: 0.4 }} tickFormatter={(v) => `${v}`} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as { metric: string; rawUs: string; rawThem: string } | undefined;
                    if (!row) return null;
                    return (
                      <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[160px] space-y-1">
                        <div className="font-semibold text-sm">{row.metric}</div>
                        <div className="flex justify-between gap-6">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="inline-block h-2 w-2 rounded-full" style={{ background: C_US }} />Belconnen
                          </span>
                          <span>{row.rawUs}</span>
                        </div>
                        <div className="flex justify-between gap-6">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="inline-block h-2 w-2 rounded-full" style={{ background: C_THEM }} />{opp}
                          </span>
                          <span>{row.rawThem}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Radar name="Belconnen" dataKey="us" stroke={C_US} fill={C_US} fillOpacity={0.35} />
                <Radar name={opp} dataKey="them" stroke={C_THEM} fill={C_THEM} fillOpacity={0.2} />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {passStats && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Possession" value={`${passStats.possPctUs.toFixed(0)}%`} sub="of ball-in-possession time" />
            <StatCard label="Possession minutes" value={`${passStats.possMinUs.toFixed(1)} – ${passStats.possMinThem.toFixed(1)}`} sub="us – them" />
            <StatCard label="Completed passes" value={`${passStats.passesUs} – ${passStats.passesThem}`} sub="us – them" />
            <StatCard label="Possession won" value={`${passStats.possWonUs} – ${passStats.possWonThem}`} sub="regains, us – them" />
          </div>

          <div className="grid grid-cols-1 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Pass strings</CardTitle>
                <CardDescription>
                  Connected-pass sequences by length — us vs {opp}. Longer strings mean the ball is sticking with us.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={passStats.hist} margin={{ left: -10, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="len" {...AXIS} label={{ value: "passes in string", position: "insideBottom", offset: -2, fontSize: 10, fill: "hsl(var(--muted-foreground))" }} height={36} />
                    <YAxis {...AXIS} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP_BOX} cursor={{ fill: "hsl(var(--muted)/0.3)" }} labelFormatter={(l) => `${l}-pass strings`} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="us" name="Belconnen" fill={C_US} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="them" name={opp} fill={C_THEM} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Possession location</CardTitle>
                <CardDescription>Where each side's possession happened — defensive, middle and attacking thirds.</CardDescription>
              </CardHeader>
              <CardContent>
                {passStats.thirdsUs && passStats.thirdsThem ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart
                      data={[
                        { zone: "Defensive third", us: Number(passStats.thirdsUs.def.toFixed(1)), them: Number(passStats.thirdsThem.def.toFixed(1)) },
                        { zone: "Middle third", us: Number(passStats.thirdsUs.mid.toFixed(1)), them: Number(passStats.thirdsThem.mid.toFixed(1)) },
                        { zone: "Attacking third", us: Number(passStats.thirdsUs.att.toFixed(1)), them: Number(passStats.thirdsThem.att.toFixed(1)) },
                      ]}
                      layout="vertical" margin={{ left: 30, right: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                      <XAxis type="number" {...AXIS} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                      <YAxis type="category" dataKey="zone" width={100} {...AXIS} />
                      <Tooltip contentStyle={TOOLTIP_BOX} cursor={{ fill: "hsl(var(--muted)/0.3)" }} formatter={(v: number, n) => [`${Number(v).toFixed(0)}%`, n]} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="us" name="Belconnen" fill={C_US} radius={[0, 3, 3, 0]} />
                      <Bar dataKey="them" name={opp} fill={C_THEM} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">No possession-location data for this match.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {possHeat && (
            <Card>
              <CardHeader>
                <CardTitle>Possession heat map</CardTitle>
                <CardDescription>
                  Where each side spent its time on the ball, from Veo's 18-zone possession tracking — both maps read left to right as
                  defending end → attacking end. Darker = more possession time there. Hover a zone for its share.
                  {heatWins ? " Drag the slider handles to focus on any part of the match." : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {heatWins && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {heatRangeClamped ? `${heatRangeClamped[0]}′ – ${heatRangeClamped[1]}′` : `Full match (0′ – ${heatWins.maxMin}′)`}
                      </span>
                      {heatRangeClamped && (
                        <button className="underline hover:text-foreground" onClick={() => setHeatRange(null)}>
                          Reset to full match
                        </button>
                      )}
                    </div>
                    <Slider
                      min={0}
                      max={heatWins.maxMin}
                      step={5}
                      minStepsBetweenThumbs={1}
                      value={heatRangeClamped ?? [0, heatWins.maxMin]}
                      onValueChange={(v) => setHeatRange([v[0], v[1]])}
                    />
                  </div>
                )}
                {heatSel && heatSel.usTot === 0 && heatSel.themTot === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No possession recorded in this window — likely half-time. Widen the selection.
                  </p>
                ) : (
                  <>
                    <HeatPitch label="Belconnen" values={(heatSel ?? possHeat).us} total={(heatSel ?? possHeat).usTot} color={C_US} />
                    <HeatPitch label={opp} values={(heatSel ?? possHeat).them} total={(heatSel ?? possHeat).themTot} color={C_THEM} />
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {passStyle && (
            <Card>
              <CardHeader>
                <CardTitle>Passing style</CardTitle>
                <CardDescription>
                  The length of every recorded pass, split short / medium / long. Veo's units are relative, so use
                  this to compare the two sides — more long passes = a more direct game.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { name: "Belconnen", s: passStyle.us, color: C_US },
                  { name: opp, s: passStyle.them, color: C_THEM },
                ].map(({ name, s, color }) => (
                  <div key={name}>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-medium flex items-center gap-1.5">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />{name}
                      </span>
                      {s ? (
                        <span className="text-muted-foreground">median length index {s.medianIdx} · {s.n} passes</span>
                      ) : (
                        <span className="text-muted-foreground">not enough recorded passes</span>
                      )}
                    </div>
                    {s && (
                      <div className="flex h-6 w-full overflow-hidden rounded-md text-[10px] font-medium text-white">
                        <div className="flex items-center justify-center" style={{ width: `${s.shortPct}%`, background: color, opacity: 0.45 }}>
                          {s.shortPct >= 12 ? `short ${s.shortPct.toFixed(0)}%` : ""}
                        </div>
                        <div className="flex items-center justify-center" style={{ width: `${s.midPct}%`, background: color, opacity: 0.7 }}>
                          {s.midPct >= 12 ? `medium ${s.midPct.toFixed(0)}%` : ""}
                        </div>
                        <div className="flex items-center justify-center" style={{ width: `${s.longPct}%`, background: color }}>
                          {s.longPct >= 12 ? `long ${s.longPct.toFixed(0)}%` : ""}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <div className="grid grid-cols-1 gap-6">
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

      {tiltLine && (
        <Card>
          <CardHeader>
            <CardTitle>Field tilt through the match</CardTitle>
            <CardDescription>
              Our share of the threat (shots, corners, frees — same weights as the momentum chart) sampled every 5 minutes over a rolling 15-minute window.
              Midline is an even game; above it we were on top, below it {opp} were.
              {tiltLine.hasPass && <> The dashed line adds territory — our share of the time either side spent with the ball in their attacking third, per half (Veo buckets that by half, not by minute).</>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={tiltLine.rows} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="min" type="number" domain={[0, tiltLine.maxMin]} ticks={[0, 15, 30, 45, 60, 75, 90].filter((t) => t <= tiltLine.maxMin)} {...AXIS} tickFormatter={(m) => `${m}'`} />
                <YAxis {...AXIS} domain={[-50, 50]} ticks={[-50, -25, 0, 25, 50]} tickFormatter={(v: number) => `${v + 50}%`} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as { tiltDiff: number | null; evUs: number; evThem: number; passDiff: number | null } | undefined;
                    if (!row) return null;
                    return (
                      <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[170px] space-y-1">
                        <div className="font-semibold">{Math.max(0, Number(label) - 7.5).toFixed(0)}–{Math.min(tiltLine.maxMin, Number(label) + 7.5).toFixed(0)} min window</div>
                        {row.tiltDiff != null && (
                          <div className="flex justify-between gap-6"><span className="text-muted-foreground">Field tilt</span><span className="font-medium">{(row.tiltDiff + 50).toFixed(0)}% us</span></div>
                        )}
                        <div className="flex justify-between gap-6"><span className="text-muted-foreground">Threat events</span><span>{row.evUs} us · {row.evThem} them</span></div>
                        {row.passDiff != null && (
                          <div className="flex justify-between gap-6"><span className="text-muted-foreground">Territory (half)</span><span>{(row.passDiff + 50).toFixed(0)}% us</span></div>
                        )}
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <ReferenceLine x={tiltLine.halfAt} stroke="hsl(var(--border))" strokeDasharray="4 4" label={{ value: "HT", fontSize: 10, fill: "hsl(var(--muted-foreground))", position: "top" }} />
                <Line dataKey="tiltDiff" name="Field tilt" stroke={C_US} strokeWidth={2.5} dot={{ r: 2.5, fill: C_US, strokeWidth: 0 }} connectNulls />
                {tiltLine.hasPass && (
                  <Line type="stepAfter" dataKey="passDiff" name="Territory" stroke="hsl(var(--foreground))" strokeWidth={1.5} strokeDasharray="6 4" dot={false} connectNulls={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

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

      <div className="grid grid-cols-1 gap-6">
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
          <ShotMap shots={shots} opp={opp} />
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
function ShotMap({ shots, opp }: { shots: { x: number; y: number; own: boolean; goal: boolean; min?: number }[]; opp?: string }) {
  const W = 900, H = 560, pad = 12;
  const px = (x: number) => pad + x * (W - 2 * pad);
  const py = (y: number) => pad + y * (H - 2 * pad);
  const line = "hsl(var(--border))";
  // Styled hover tooltip (same look as the charts) instead of a native title.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);
  const onMove = (i: number) => (e: React.MouseEvent) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ i, px: e.clientX - box.left, py: e.clientY - box.top });
  };
  const hs = hover ? shots[hover.i] : null;
  return (
    <div className="w-full overflow-x-auto">
      <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: 420 }}>
          <rect x={pad} y={pad} width={W - 2 * pad} height={H - 2 * pad} fill="hsl(var(--muted)/0.25)" stroke={line} rx={6} />
          <line x1={W / 2} y1={pad} x2={W / 2} y2={H - pad} stroke={line} />
          <circle cx={W / 2} cy={H / 2} r={64} fill="none" stroke={line} />
          {/* penalty boxes */}
          <rect x={pad} y={H * 0.22} width={(W - 2 * pad) * 0.16} height={H * 0.56} fill="none" stroke={line} />
          <rect x={W - pad - (W - 2 * pad) * 0.16} y={H * 0.22} width={(W - 2 * pad) * 0.16} height={H * 0.56} fill="none" stroke={line} />
          {shots.map((s, i) => (
            <g key={i}>
              {/* invisible larger hit area so small dots are easy to hover */}
              <circle cx={px(s.x)} cy={py(s.y)} r={14} fill="transparent" onMouseMove={onMove(i)} onMouseLeave={() => setHover(null)} />
              <circle cx={px(s.x)} cy={py(s.y)} r={s.goal ? 9 : 6}
                fill={s.goal ? (s.own ? C_US : C_THEM) : "transparent"}
                stroke={s.own ? C_US : C_THEM} strokeWidth={hover?.i === i ? 3 : 2} opacity={hover?.i === i ? 1 : 0.9}
                pointerEvents="none" />
            </g>
          ))}
        </svg>
        {hs && hover && (
          <div
            className="pointer-events-none absolute z-10"
            style={{
              ...TOOLTIP_BOX,
              left: hover.px + 12,
              top: hover.py + 12,
              transform: [
                hover.px > (wrapRef.current?.clientWidth ?? 0) * 0.7 ? "translateX(calc(-100% - 24px))" : "",
                hover.py > (wrapRef.current?.clientHeight ?? 0) * 0.7 ? "translateY(calc(-100% - 24px))" : "",
              ].join(" ").trim() || undefined,
              whiteSpace: "nowrap",
            }}
          >
            <span className="font-medium" style={{ color: hs.own ? C_US : C_THEM }}>
              {hs.own ? "Belconnen" : (opp ?? "Opponent")} {hs.goal ? "goal" : "shot"}
            </span>
            {hs.min != null && Number.isFinite(hs.min) && (
              <span className="text-muted-foreground"> — {Math.floor(hs.min)}'</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Possession heat pitch: 6 lengthwise columns × 3 cross-pitch cells from Veo's
// 18-zone grid. Values are PER-TEAM RELATIVE, ordered from the team's own
// defensive end (index 0) to its attacking end — so with both maps labelled
// defending-left / attacking-right, columns draw directly for either team.
function HeatPitch({ label, values, total, color }: {
  label: string; values: number[]; total: number; color: string;
}) {
  const W = 900, H = 560, pad = 12;
  const line = "hsl(var(--border))";
  const innerW = W - 2 * pad, innerH = H - 2 * pad;
  const max = Math.max(...values, 1);
  // Styled hover tooltip (matches the Recharts TOOLTIP_BOX look) instead of
  // the browser's native <title> bubble. Position tracks the cursor within
  // the wrapper div; hidden zone index = null.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);
  const cells = values.map((v, i) => {
    const col = Math.floor(i / 3); // 0 = own defensive end
    const row = i % 3;
    return {
      x: pad + (col / 6) * innerW,
      y: pad + (row / 3) * innerH,
      v,
      pct: total > 0 ? (v / total) * 100 : 0,
      opacity: v > 0 ? 0.12 + 0.68 * (v / max) : 0,
    };
  });
  const onMove = (i: number) => (e: React.MouseEvent) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ i, px: e.clientX - box.left, py: e.clientY - box.top });
  };
  return (
    <div className="w-full">
      <div className="text-xs font-medium mb-1.5 flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />{label}
      </div>
      <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: 300 }}>
          <rect x={pad} y={pad} width={innerW} height={innerH} fill="hsl(var(--muted)/0.25)" stroke={line} rx={6} />
          {cells.map((c, i) => (
            <rect
              key={i}
              x={c.x} y={c.y} width={innerW / 6} height={innerH / 3}
              fill={color} opacity={hover?.i === i ? Math.min(1, c.opacity + 0.15) : c.opacity}
              onMouseMove={onMove(i)} onMouseLeave={() => setHover(null)}
            />
          ))}
          {/* pitch markings on top of the heat cells (ignore the mouse so cells get hover) */}
          <g pointerEvents="none">
            <rect x={pad} y={pad} width={innerW} height={innerH} fill="none" stroke={line} rx={6} />
            <line x1={W / 2} y1={pad} x2={W / 2} y2={H - pad} stroke={line} />
            <circle cx={W / 2} cy={H / 2} r={64} fill="none" stroke={line} />
            <rect x={pad} y={H * 0.22} width={innerW * 0.16} height={H * 0.56} fill="none" stroke={line} />
            <rect x={W - pad - innerW * 0.16} y={H * 0.22} width={innerW * 0.16} height={H * 0.56} fill="none" stroke={line} />
            <text x={pad + 8} y={H - pad - 10} fontSize={20} fill="hsl(var(--muted-foreground))">defending</text>
            <text x={W - pad - 8} y={H - pad - 10} fontSize={20} fill="hsl(var(--muted-foreground))" textAnchor="end">attacking</text>
          </g>
        </svg>
        {hover && (
          <div
            className="pointer-events-none absolute z-10"
            style={{
              ...TOOLTIP_BOX,
              left: hover.px + 12,
              top: hover.py + 12,
              transform: [
                hover.px > (wrapRef.current?.clientWidth ?? 0) * 0.7 ? "translateX(calc(-100% - 24px))" : "",
                hover.py > (wrapRef.current?.clientHeight ?? 0) * 0.7 ? "translateY(calc(-100% - 24px))" : "",
              ].join(" ").trim() || undefined,
              whiteSpace: "nowrap",
            }}
          >
            <span className="font-medium" style={{ color }}>{cells[hover.i].pct.toFixed(1)}%</span>
            <span className="text-muted-foreground"> of {label}'s possession</span>
          </div>
        )}
      </div>
    </div>
  );
}
