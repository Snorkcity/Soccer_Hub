// Veo match intelligence inside the Football Match Report — shown only when
// this Hub match has a linked Veo recording (see Match links on Veo Insights).
// SIEM-style layering, in coach language: correlated key findings first, then
// a unified moment timeline, then the drill-down charts (momentum, field tilt,
// match shape). Findings + all series are computed server-side and frozen
// into saved reports via the optional `preloaded` prop.
import { useGetVeoReportStats, getGetVeoReportStatsQueryKey, type VeoReportStats } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Video, TrendingUp, AlertTriangle, Info } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
  LineChart, Line,
} from "recharts";
import { useActiveLeague } from "@/contexts/LeagueContext";
import {
  clampMatchMinute,
  matchTimelineTicks,
  matchTimingForLeague,
} from "@workspace/api-zod";

const C_US = "hsl(var(--chart-1))";
const C_THEM = "hsl(var(--chart-5))";
const AXIS = { stroke: "hsl(var(--muted-foreground))", fontSize: 10 };
const TOOLTIP_BOX: React.CSSProperties = {
  backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))",
  color: "hsl(var(--foreground))", fontSize: 12, borderRadius: 8, padding: "8px 12px",
};
const BIN_MIN = 5;

interface Props {
  leagueId: number;
  matchRowId: number;
  opponent: string;
  /** Saved-report snapshot — when set, no fetch happens and this is rendered. */
  preloaded?: VeoReportStats | null;
}

const TONE_STYLE: Record<string, { border: string; icon: React.ReactNode }> = {
  good: { border: "border-l-emerald-500", icon: <TrendingUp className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" /> },
  watch: { border: "border-l-amber-500", icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" /> },
  info: { border: "border-l-sky-500", icon: <Info className="h-3.5 w-3.5 text-sky-500 shrink-0 mt-0.5" /> },
};

/** Unified moment timeline: goals (filled), shots (rings), corners (ticks). */
function MomentTimeline({ moments, maxMin, halfAt, ticks, opponent }: {
  moments: NonNullable<VeoReportStats["timeline"]>;
  maxMin: number; halfAt: number; ticks: number[]; opponent: string;
}) {
  const W = 900, H = 130, padX = 14, midY = H / 2;
  const px = (m: number) => padX + (m / Math.max(maxMin, 1)) * (W - 2 * padX);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" style={{ maxHeight: 120 }}>
      <line x1={padX} y1={midY} x2={W - padX} y2={midY} stroke="hsl(var(--border))" />
      <line x1={px(halfAt)} y1={14} x2={px(halfAt)} y2={H - 14} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
      <text x={px(halfAt) + 5} y={20} fontSize={11} fill="hsl(var(--muted-foreground))">HT</text>
      {ticks.map((m) => (
        <text key={m} x={px(m)} y={H - 2} fontSize={10} fill="hsl(var(--muted-foreground))" textAnchor="middle">{m}'</text>
      ))}
      {moments.map((p, i) => {
        const cy = p.us ? midY - 22 : midY + 22;
        const color = p.us ? C_US : C_THEM;
        if (p.type === "corner") {
          return <line key={i} x1={px(p.min)} y1={p.us ? midY - 8 : midY + 2} x2={px(p.min)} y2={p.us ? midY - 2 : midY + 8}
            stroke={color} strokeWidth={2} opacity={0.55}><title>{`${Math.floor(p.min)}' — ${p.us ? "Belconnen" : opponent} corner`}</title></line>;
        }
        return (
          <circle key={i} cx={px(p.min)} cy={cy} r={p.type === "goal" ? 8 : 5}
            fill={p.type === "goal" ? color : "transparent"} stroke={color} strokeWidth={2} opacity={0.9}>
            <title>{`${Math.floor(p.min)}' — ${p.us ? "Belconnen" : opponent} ${p.type === "goal" ? "GOAL" : "shot"}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

export function VeoReportPanel({ leagueId, matchRowId, opponent, preloaded }: Props) {
  const { leagueOptions } = useActiveLeague();
  const leagueName = leagueOptions.find((league) => league.id === leagueId)?.name;
  const timing = matchTimingForLeague(leagueName);
  const params = { leagueId, matchRowId };
  const { data: fetched } = useGetVeoReportStats(params, {
    query: { enabled: !preloaded, queryKey: getGetVeoReportStatsQueryKey(params) },
  });
  const data = preloaded ?? fetched;

  // No linked Veo recording (or still loading) → render nothing at all.
  if (!data?.linked || !data.shots) return null;
  const { shots } = data;
  const maxMin = data.matchMinutes ?? timing.regulationMinutes;
  const chartTiming = maxMin === timing.regulationMinutes
    ? timing
    : { ...timing, regulationMinutes: maxMin };
  const ticks = matchTimelineTicks(chartTiming);
  const momentum = (data.momentum ?? []).filter((bin) => bin.min < maxMin);
  const findings = data.findings ?? [];
  const timeline = (data.timeline ?? []).map((moment) => ({
    ...moment,
    min: clampMatchMinute(moment.min, chartTiming),
  }));
  const tilt = (data.tilt ?? []).filter(
    (point) => point.min <= maxMin && (point.tiltDiff != null || point.passDiff != null),
  );
  const radar = data.radar ?? [];
  const total = shots.us + shots.them;
  const usPct = total > 0 ? Math.round((shots.us / total) * 100) : 50;
  const halfAt = Math.min(data.tiltHalfAt ?? maxMin / 2, maxMin);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Video className="h-4 w-4 text-violet-500" />What the video says (Veo)
        </CardTitle>
        <CardDescription className="text-xs">
          From the linked Veo recording — key findings first, then the match on one timeline, then the detail. Shots include goals.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* ── Key findings ── */}
        {findings.length > 0 && (
          <div className="space-y-1.5">
            {findings.map((f, i) => {
              const st = TONE_STYLE[f.tone] ?? TONE_STYLE.info;
              return (
                <div key={i} className={`flex items-start gap-2 rounded-md border border-l-4 ${st.border} bg-muted/30 px-3 py-2`}>
                  {st.icon}
                  <p className="text-xs leading-relaxed">{f.text}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Headline numbers: shots + possession ── */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-semibold" style={{ color: C_US }}>{shots.us}</span>
              <span className="text-xs text-muted-foreground">Shots · us v {opponent}</span>
              <span className="font-semibold" style={{ color: C_THEM }}>{shots.them}</span>
            </div>
            <div className="mt-1.5 h-2 w-full rounded-full overflow-hidden bg-muted flex">
              <div style={{ width: `${usPct}%`, backgroundColor: C_US }} />
              <div style={{ width: `${100 - usPct}%`, backgroundColor: C_THEM }} />
            </div>
          </div>
          {data.possession && (
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold" style={{ color: C_US }}>{data.possession.usMin.toFixed(0)} min</span>
                <span className="text-xs text-muted-foreground">Possession · {data.possession.usPct.toFixed(0)}% ours</span>
                <span className="font-semibold" style={{ color: C_THEM }}>{data.possession.themMin.toFixed(0)} min</span>
              </div>
              <div className="mt-1.5 h-2 w-full rounded-full overflow-hidden bg-muted flex">
                <div style={{ width: `${data.possession.usPct}%`, backgroundColor: C_US }} />
                <div style={{ width: `${100 - data.possession.usPct}%`, backgroundColor: C_THEM }} />
              </div>
            </div>
          )}
        </div>

        {/* ── Unified moment timeline ── */}
        {timeline.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1">The match on one line — us above, {opponent} below. Filled dots are goals, rings are shots, small ticks are corners.</p>
            <MomentTimeline moments={timeline} maxMin={maxMin} halfAt={halfAt} ticks={ticks} opponent={opponent} />
          </div>
        )}

        {/* ── Momentum strip ── */}
        {momentum.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1">Attacking momentum — event-weighted, {BIN_MIN}-min blocks.</p>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={momentum} stackOffset="sign" margin={{ left: -22, right: 6, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="min" {...AXIS} ticks={ticks.filter((tick) => tick < maxMin)} tickFormatter={(m) => `${m}'`} />
                <YAxis {...AXIS} />
                <Tooltip contentStyle={TOOLTIP_BOX} cursor={{ fill: "hsl(var(--muted)/0.3)" }}
                  formatter={(v: number, n) => [Math.abs(v).toFixed(1), n]}
                  labelFormatter={(m) => `${m}–${Number(m) + BIN_MIN} min`} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                <Bar dataKey="us" name="Belconnen" fill={C_US} stackId="m" />
                <Bar dataKey="them" name={opponent} fill={C_THEM} stackId="m" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Field tilt line ── */}
        {tilt.length > 1 && (
          <div>
            <p className="text-xs font-medium mb-1">Field tilt through the match — above the line is our pressure, below is theirs{tilt.some((t) => t.passDiff != null) ? "; the dashed step is territory from possession in each attacking third" : ""}.</p>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={tilt} margin={{ left: -18, right: 6, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="min" type="number" domain={[0, maxMin]} ticks={ticks} {...AXIS} tickFormatter={(m) => `${m}'`} />
                <YAxis {...AXIS} domain={[-50, 50]} tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}`} />
                <Tooltip contentStyle={TOOLTIP_BOX}
                  formatter={(v: number, n) => [`${v > 0 ? "us +" : v < 0 ? `${opponent} +` : ""}${Math.abs(v).toFixed(0)}`, n]}
                  labelFormatter={(m) => `around ${m}'`} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
                {data.tiltHalfAt != null && <ReferenceLine x={Math.round(data.tiltHalfAt / 5) * 5} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
                <Line type="monotone" dataKey="tiltDiff" name="Threat tilt" stroke={C_US} strokeWidth={2} dot={false} connectNulls />
                {tilt.some((t) => t.passDiff != null) && (
                  <Line type="stepAfter" dataKey="passDiff" name="Territory" stroke={C_THEM} strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Match shape: share bars per metric ── */}
        {radar.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1.5">Match shape — our share of each battle.</p>
            <div className="space-y-1.5">
              {radar.map((r) => (
                <div key={r.metric} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-muted-foreground shrink-0">{r.metric}</span>
                  <span className="w-14 text-right font-medium shrink-0" style={{ color: C_US }}>{r.rawUs}</span>
                  <div className="h-2 flex-1 rounded-full overflow-hidden bg-muted flex">
                    <div style={{ width: `${r.us}%`, backgroundColor: C_US }} />
                    <div style={{ width: `${r.them}%`, backgroundColor: C_THEM }} />
                  </div>
                  <span className="w-14 font-medium shrink-0" style={{ color: C_THEM }}>{r.rawThem}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
