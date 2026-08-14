import React, { useState, useMemo } from "react";
import {
  useVeoSync,
  useListVeoMatches,
  getListVeoMatchesQueryKey,
  useGetVeoMatch,
  getGetVeoMatchQueryKey,
  type VeoMatchSummary,
  type VeoEvent,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Video } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell,
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
  const { hasModule, ready } = useLeagueModules();
  const { activeLeagueId } = useActiveLeague();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

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
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground shrink-0">Match</span>
            <Select value={String(currentId ?? "")} onValueChange={(v) => setSelectedId(Number(v))}>
              <SelectTrigger className="w-full max-w-md"><SelectValue placeholder="Pick a match" /></SelectTrigger>
              <SelectContent>
                {synced.map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {opponentOf(m)}{fmtDate(m.startsAt) ? ` · ${fmtDate(m.startsAt)}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {matchLoading || !match ? (
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

// ─────────────────────────────────────────────────────────────────────────────
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
      // for any period where our goal sits on the left.
      const flip = side === "left";
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

// A simple SVG pitch with shot markers. x,y are 0..1 (x = length, y = width).
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
