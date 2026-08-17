// Season Report — how the season is trending at a glance, framed around the
// 16+ coach-pack success measures: decisions under fatigue, game management,
// professional consistency (repeat quality every week), and pressing that
// produces attacking advantage. Football series come from the season-report
// endpoint; the physical section aggregates GPS rows client-side per round.
import { useEffect, useMemo, useState } from 'react';
import {
  useListTeams, useListSeasons, useGetAuthStatus,
  useGetSeasonReport, getGetSeasonReportQueryKey,
  useListGpsSessions, getListGpsSessionsQueryKey,
  type GpsSession,
} from '@workspace/api-client-react';
import { useActiveLeague, useViewingTeam } from '@/contexts/LeagueContext';
import { useLeagueModules } from '@/hooks/useLeagueModules';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShieldCheck, AlertTriangle, Info, Sparkles, TrendingUp } from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend, ReferenceLine,
} from 'recharts';

// ── shared bits ──────────────────────────────────────────────────────────────
const toneIcon = (tone: string) =>
  tone === 'good' ? <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />
    : tone === 'watch' ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
    : <Info className="h-4 w-4 mt-0.5 shrink-0 text-sky-500" />;

const CHART_H = 260;
const axisTick = { fontSize: 11 } as const;
const cursorFill = { fill: 'hsl(var(--muted)/0.3)' } as const;

// ── Card-style tooltip matching the rest of the app ─────────────────────────
function TipCard({ title, sub, children, footer }: {
  title: string; sub?: string | null; children: React.ReactNode; footer?: string | null;
}) {
  return (
    <div className="rounded-lg border bg-card p-3 shadow-lg text-xs min-w-[180px] space-y-2">
      <div>
        <div className="font-semibold text-sm">{title}</div>
        {sub && <div className="text-muted-foreground">{sub}</div>}
      </div>
      <div className="border-t pt-2 space-y-1">{children}</div>
      {footer && <div className="border-t pt-2 text-muted-foreground">{footer}</div>}
    </div>
  );
}

function TipRow({ color, name, value }: { color?: string; name: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-6">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {color && <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />}
        {name}
      </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

type TipPayload = Array<{ name?: unknown; value?: unknown; color?: string; payload?: any }>;

// Same convention as the GPS Insights tab: squad comes from the round suffix,
// normalised case-insensitively ("R3-Res" and "R2-res" are the same squad) so
// upload-time typos can't split one squad into duplicate dropdown entries.
function squadOf(round: string | null | undefined): string {
  if (!round) return '1sts';
  if (/-(res|r)$/i.test(round)) return 'Reserves';
  if (/-1[78]s$/i.test(round)) return '17s / 18s';
  return '1sts';
}

const fmt = (v: number | null | undefined, d = 0) => (v == null ? '—' : v.toFixed(d));

export default function SeasonReport() {
  const { data: teams } = useListTeams();
  const { data: allSeasons } = useListSeasons();
  const { data: auth } = useGetAuthStatus();
  const { hasModule } = useLeagueModules();
  const { activeLeagueId } = useActiveLeague();

  const seasons = useMemo(
    () => (allSeasons ?? []).filter(s => s.leagueId === activeLeagueId && hasModule(s.leagueId, 'season-stats')),
    [allSeasons, activeLeagueId, hasModule],
  );
  const [teamId, setTeamId] = useState<number | ''>('');
  const [seasonId, setSeasonId] = useState<number | ''>('');
  useEffect(() => {
    if (teams?.length && teamId === '') {
      const analytics = teams.find(t => t.analyticsEnabled && t.gender === 'female') ?? teams[0];
      setTeamId(analytics.id);
    }
    if (seasons.length && (seasonId === '' || !seasons.some(s => s.id === seasonId))) {
      const active = seasons.find(s => s.isActive);
      setSeasonId(active ? active.id : seasons[0].id);
    }
  }, [teams, seasons, teamId, seasonId]);
  useViewingTeam(teams?.find(t => t.id === teamId)?.name);

  const isReady = teamId !== '' && seasonId !== '';
  const params = { teamId: teamId as number, seasonId: seasonId as number };
  const { data: report } = useGetSeasonReport(params, {
    query: { enabled: isReady, queryKey: getGetSeasonReportQueryKey(params) },
  });

  // ── football series ────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    let pts = 0;
    // Charts show played games only; unplayed fixtures come back with null results.
    return (report?.rounds ?? []).filter(r => r.result != null).map(r => {
      pts += r.result === 'W' ? 3 : r.result === 'D' ? 1 : 0;
      return {
        ...r,
        points: pts,
        label: r.round,
        dateLabel: r.date ? r.date.slice(5).replace('/', '-') : '',
      };
    });
  }, [report]);

  const timing = report?.timing ?? [];
  const dnaMix = useMemo(
    () => (report?.dnaMix ?? []).map(c => ({ ...c, pctR: c.pct != null ? Number(c.pct.toFixed(0)) : null })),
    [report],
  );

  // ── GPS (physical) section — client-side per-round aggregation ────────────
  const year = useMemo(
    () => seasons.find(s => s.id === seasonId)?.year ?? new Date().getFullYear(),
    [seasons, seasonId],
  );
  const gpsEnabled = activeLeagueId != null && hasModule(activeLeagueId, 'gps');
  const gpsParams = { leagueId: activeLeagueId ?? 0, year: String(year) };
  const { data: gpsRows } = useListGpsSessions(gpsParams, {
    query: { enabled: !!gpsEnabled, queryKey: getListGpsSessionsQueryKey(gpsParams) },
  });

  const gpsSquads = useMemo(() => {
    const s = new Set<string>();
    for (const r of gpsRows ?? []) if (r.tags === 'game' && r.round) s.add(squadOf(r.round));
    return [...s].sort();
  }, [gpsRows]);
  const [squad, setSquad] = useState('1sts');
  useEffect(() => {
    if (gpsSquads.length && !gpsSquads.includes(squad)) setSquad(gpsSquads[0]);
  }, [gpsSquads, squad]);

  interface GpsRound {
    round: string; date: string | null; opponent: string | null;
    km: number | null; dpm: number | null; hsmPerMin: number | null;
    h2DpmChangePct: number | null; players: number;
  }
  const gpsTrend: GpsRound[] = useMemo(() => {
    const rowsIn = (gpsRows ?? []).filter(r => r.tags === 'game' && r.round && squadOf(r.round) === squad && r.playerName);
    const byRound = new Map<string, GpsSession[]>();
    for (const r of rowsIn) {
      const list = byRound.get(r.round!) ?? [];
      list.push(r); byRound.set(r.round!, list);
    }
    const out: GpsRound[] = [];
    for (const [round, list] of byRound.entries()) {
      const game = list.filter(r => r.splitName === 'game');
      const h1 = list.filter(r => r.splitName === '1st.half');
      const h2 = list.filter(r => r.splitName === '2nd.half');
      const sum = (xs: GpsSession[], f: (r: GpsSession) => number | null | undefined) =>
        xs.reduce<{ v: number; n: number }>((a, r) => {
          const v = f(r);
          return v == null ? a : { v: a.v + v, n: a.n + 1 };
        }, { v: 0, n: 0 });
      const src = game.length ? game : [...h1, ...h2]; // halves fallback when no game split
      const km = sum(src, r => r.distanceKm);
      const mins = sum(src, r => r.minsPlayed);
      const hsm = sum(src, r => r.sprintDistanceM);
      const dpmOf = (xs: GpsSession[]) => {
        const k = sum(xs, r => r.distanceKm); const m = sum(xs, r => r.minsPlayed);
        return k.n && m.v > 0 ? (k.v * 1000) / m.v : null;
      };
      const d1 = dpmOf(h1); const d2 = dpmOf(h2);
      out.push({
        round,
        date: src[0]?.sessionDate ?? null,
        opponent: src[0]?.opponent ?? null,
        km: km.n ? km.v : null,
        dpm: km.n && mins.v > 0 ? (km.v * 1000) / mins.v : null,
        hsmPerMin: hsm.n && mins.v > 0 ? hsm.v / mins.v : null,
        h2DpmChangePct: d1 != null && d2 != null && d1 > 0 ? ((d2 - d1) / d1) * 100 : null,
        players: new Set(game.map(r => r.playerName)).size || new Set(src.map(r => r.playerName)).size,
      });
    }
    return out.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  }, [gpsRows, squad]);

  // Client-side physical reads in the same voice as the server insights.
  const gpsInsights = useMemo(() => {
    const out: { tone: 'good' | 'watch' | 'info'; text: string }[] = [];
    const changes = gpsTrend.map(t => t.h2DpmChangePct).filter((v): v is number => v != null);
    if (changes.length >= 4) {
      const avgDrop = changes.reduce((a, b) => a + b, 0) / changes.length;
      if (avgDrop <= -8) out.push({ tone: 'watch', text: `Second-half intensity drops ${Math.abs(avgDrop).toFixed(0)}% on average — the curriculum asks for "repeat high-intensity efforts" deep into games, and the legs are fading before the whistle.` });
      else if (avgDrop >= -3) out.push({ tone: 'good', text: `Second-half intensity holds within ${Math.abs(avgDrop).toFixed(0)}% of the first half on average — the physical base is standing up to full games.` });
    }
    const kms = gpsTrend.map(t => t.km).filter((v): v is number => v != null);
    if (kms.length >= 5) {
      const mean = kms.reduce((a, b) => a + b, 0) / kms.length;
      const cvv = mean > 0 ? Math.sqrt(kms.reduce((a, b) => a + (b - mean) ** 2, 0) / kms.length) / mean : null;
      if (cvv != null && cvv >= 0.15) out.push({ tone: 'watch', text: `Team distance swings ${(cvv * 100).toFixed(0)}% game to game — some weeks the physical output simply isn't there. Consistency of effort is a senior standard.` });
      else if (cvv != null && cvv <= 0.08) out.push({ tone: 'good', text: `Team running output is remarkably steady week to week — the same physical shift turns up every game.` });
    }
    return out;
  }, [gpsTrend]);

  if (!auth?.authenticated) return null;

  const allInsights = [...(report?.insights ?? []), ...gpsInsights];

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><TrendingUp className="h-5 w-5 text-sky-500" />Season Report</h1>
          <p className="text-sm text-muted-foreground">How the season is trending — measured against the club's senior-readiness markers.</p>
        </div>
        {seasons.length > 1 && (
          <Select value={String(seasonId)} onValueChange={v => setSeasonId(Number(v))}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {seasons.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.year}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* ── Senior-readiness reads ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-sky-500" />Senior-readiness reads</CardTitle>
          <CardDescription className="text-xs">
            The coach pack's success measures for this phase — decisions under fatigue, game management,
            week-to-week consistency, pressing that produces — checked against the season's numbers.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {allInsights.length === 0 && <div className="text-sm text-muted-foreground">Not enough games yet to read the season.</div>}
          {allInsights.map((ins, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-md border p-2.5 text-sm ${ins.tone === 'watch' ? 'border-amber-500/40 bg-amber-500/5' : ''}`}>
              {toneIcon(ins.tone)}
              <span>{ins.text}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Results & points ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Results through the year</CardTitle>
          <CardDescription className="text-xs">Goals for and against each round, with the points total building across the season.</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={CHART_H}>
            <ComposedChart data={rows} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" tick={axisTick} interval={0} angle={-35} textAnchor="end" height={45} />
              <YAxis yAxisId="g" tick={axisTick} allowDecimals={false} />
              <YAxis yAxisId="p" orientation="right" tick={axisTick} allowDecimals={false} />
              <Tooltip cursor={cursorFill} content={({ active, payload }: { active?: boolean; payload?: TipPayload }) => {
                const r = payload?.[0]?.payload;
                if (!active || !r) return null;
                const res = r.result === 'W' ? 'Win' : r.result === 'L' ? 'Loss' : 'Draw';
                const ht = r.htResult === 'W' ? 'led at half-time' : r.htResult === 'L' ? 'trailed at half-time' : r.htResult === 'D' ? 'level at half-time' : null;
                return (
                  <TipCard title={`${r.label} v ${r.opponent}`} sub={[res, ht].filter(Boolean).join(' · ')}
                    footer={report?.leagueAvgGoals != null ? `League average: ${report.leagueAvgGoals.toFixed(1)} goals per team per game` : null}>
                    <TipRow color="#22c55e" name="Goals for" value={r.goalsFor ?? '—'} />
                    <TipRow color="#ef4444" name="Goals against" value={r.goalsAgainst ?? '—'} />
                    <TipRow color="#0ea5e9" name="Points so far" value={r.points} />
                  </TipCard>
                );
              }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="g" dataKey="goalsFor" name="Goals for" fill="#22c55e" radius={[3, 3, 0, 0]} />
              <Bar yAxisId="g" dataKey="goalsAgainst" name="Goals against" fill="#ef4444" radius={[3, 3, 0, 0]} />
              <Line yAxisId="p" dataKey="points" name="Points (cumulative)" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 2 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── Ball use trend ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Passing & possession</CardTitle>
            <CardDescription className="text-xs">Steady lines here are the "repeat performance quality every week" the curriculum asks for.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={CHART_H}>
              <ComposedChart data={rows} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={axisTick} interval={0} angle={-35} textAnchor="end" height={45} />
                <YAxis yAxisId="pa" tick={axisTick} allowDecimals={false} />
                <YAxis yAxisId="po" orientation="right" tick={axisTick} domain={[0, 100]} unit="%" />
                <Tooltip cursor={cursorFill} content={({ active, payload }: { active?: boolean; payload?: TipPayload }) => {
                  const r = payload?.[0]?.payload;
                  if (!active || !r) return null;
                  const avgPasses = rows.length ? rows.reduce((s, x) => s + (x.passes ?? 0), 0) / Math.max(1, rows.filter(x => x.passes != null).length) : null;
                  return (
                    <TipCard title={`${r.label} v ${r.opponent}`} sub={r.result === 'W' ? 'Win' : r.result === 'L' ? 'Loss' : 'Draw'}
                      footer={avgPasses ? `Our season average: ${avgPasses.toFixed(0)} passes` : null}>
                      <TipRow color="#818cf8" name="Passes" value={r.passes ?? '—'} />
                      <TipRow color="#f59e0b" name="Possession" value={r.possession != null ? `${fmt(r.possession, 0)}%` : '—'} />
                    </TipCard>
                  );
                }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="pa" dataKey="passes" name="Passes" fill="#818cf8" radius={[3, 3, 0, 0]} />
                <Line yAxisId="po" dataKey="possession" name="Possession %" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ── Shots trend ─────────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Shots for & against</CardTitle>
            <CardDescription className="text-xs">Creation vs control — the gap between the lines is the game's territory story.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={CHART_H}>
              <ComposedChart data={rows} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={axisTick} interval={0} angle={-35} textAnchor="end" height={45} />
                <YAxis tick={axisTick} allowDecimals={false} />
                <Tooltip cursor={cursorFill} content={({ active, payload }: { active?: boolean; payload?: TipPayload }) => {
                  const r = payload?.[0]?.payload;
                  if (!active || !r) return null;
                  const diff = r.shots != null && r.oppShots != null ? r.shots - r.oppShots : null;
                  return (
                    <TipCard title={`${r.label} v ${r.opponent}`} sub={r.result === 'W' ? 'Win' : r.result === 'L' ? 'Loss' : 'Draw'}
                      footer={diff != null ? `Shot difference: ${diff > 0 ? '+' : ''}${diff} — ${diff >= 5 ? 'territory was ours' : diff <= -5 ? 'they had the territory' : 'an even contest'}` : null}>
                      <TipRow color="#22c55e" name="Our shots" value={r.shots ?? '—'} />
                      <TipRow color="#ef4444" name="Shots against" value={r.oppShots ?? '—'} />
                    </TipCard>
                  );
                }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="shots" name="Our shots" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                <Line dataKey="oppShots" name="Shots against" stroke="#ef4444" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ── Goal timing bands ───────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">When the goals come</CardTitle>
            <CardDescription className="text-xs">The 76+ column is the "decisions under fatigue" test — who owns the last quarter of games.</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={CHART_H}>
              <ComposedChart data={timing} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="band" tick={axisTick} />
                <YAxis tick={axisTick} allowDecimals={false} />
                <Tooltip cursor={cursorFill} content={({ active, payload }: { active?: boolean; payload?: TipPayload }) => {
                  const r = payload?.[0]?.payload;
                  if (!active || !r) return null;
                  const totScored = timing.reduce((s, t) => s + t.scored, 0);
                  const ourPct = totScored > 0 ? (r.scored / totScored) * 100 : null;
                  return (
                    <TipCard title={`Minutes ${r.band}`}
                      footer={r.leaguePct != null
                        ? `League-wide, ${r.leaguePct.toFixed(0)}% of all goals fall in this window${ourPct != null ? ` — ${ourPct.toFixed(0)}% of ours do` : ''}`
                        : null}>
                      <TipRow color="#22c55e" name="Scored" value={r.scored} />
                      <TipRow color="#ef4444" name="Conceded" value={r.conceded} />
                    </TipCard>
                  );
                }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="scored" name="Scored" fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="conceded" name="Conceded" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ── Goal DNA mix vs benchmark ───────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Goal DNA mix vs benchmark</CardTitle>
            <CardDescription className="text-xs">
              {report && report.dnaTyped > 0
                ? `Where our ${report.dnaTyped} typed goals come from, against the club benchmark blend.`
                : 'Where our typed goals come from, against the club benchmark blend.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={CHART_H}>
              <ComposedChart data={dnaMix} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={axisTick} interval={0} />
                <YAxis tick={axisTick} unit="%" />
                <Tooltip cursor={cursorFill} content={({ active, payload }: { active?: boolean; payload?: TipPayload }) => {
                  const r = payload?.[0]?.payload;
                  if (!active || !r) return null;
                  return (
                    <TipCard title={r.label} sub={`${r.count} goal${r.count === 1 ? '' : 's'} this season`}
                      footer={r.leaguePct != null ? `This league's actual mix this season: ${r.leaguePct.toFixed(0)}%` : null}>
                      <TipRow color="#0ea5e9" name="Our share" value={r.pctR != null ? `${r.pctR}%` : '—'} />
                      <TipRow color="#94a3b8" name="Benchmark" value={r.benchmarkPct != null ? `${r.benchmarkPct}%` : '—'} />
                    </TipCard>
                  );
                }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="pctR" name="Our share" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                <Bar dataKey="benchmarkPct" name="Benchmark" fill="#94a3b8" radius={[3, 3, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* ── Physical season (GPS) ───────────────────────────────────────────── */}
      {gpsEnabled && gpsTrend.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Physical season</CardTitle>
                <CardDescription className="text-xs">
                  Team distance and intensity each round, plus how much intensity changes after half-time
                  (0% = held; below = second-half drop-off).
                </CardDescription>
              </div>
              {gpsSquads.length > 1 && (
                <Select value={squad} onValueChange={setSquad}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {gpsSquads.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResponsiveContainer width="100%" height={CHART_H}>
              <ComposedChart data={gpsTrend} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="round" tick={axisTick} interval={0} angle={-35} textAnchor="end" height={45} />
                <YAxis yAxisId="km" tick={axisTick} />
                <YAxis yAxisId="dpm" orientation="right" tick={axisTick} />
                <Tooltip cursor={cursorFill} content={({ active, payload }: { active?: boolean; payload?: TipPayload }) => {
                  const r = payload?.[0]?.payload;
                  if (!active || !r) return null;
                  const kms = gpsTrend.map(t => t.km).filter((v): v is number => v != null);
                  const avgKm = kms.length ? kms.reduce((a, b) => a + b, 0) / kms.length : null;
                  return (
                    <TipCard title={r.opponent ? `${r.round} v ${r.opponent}` : r.round} sub={`${r.players} players tracked`}
                      footer={avgKm != null && r.km != null ? `Season average: ${avgKm.toFixed(1)} km (${r.km >= avgKm ? '+' : ''}${(((r.km - avgKm) / avgKm) * 100).toFixed(0)}% this game)` : null}>
                      <TipRow color="#38bdf8" name="Total km" value={r.km != null ? `${fmt(r.km, 1)} km` : '—'} />
                      <TipRow color="#f59e0b" name="Intensity" value={r.dpm != null ? `${fmt(r.dpm, 0)} m/min` : '—'} />
                    </TipCard>
                  );
                }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="km" dataKey="km" name="Total km" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                <Line yAxisId="dpm" dataKey="dpm" name="Intensity (m/min)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={gpsTrend} margin={{ top: 5, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="round" tick={axisTick} interval={0} angle={-35} textAnchor="end" height={45} />
                <YAxis tick={axisTick} unit="%" />
                <ReferenceLine y={0} stroke="#64748b" />
                <Tooltip content={({ active, payload }: { active?: boolean; payload?: TipPayload }) => {
                  const r = payload?.[0]?.payload;
                  if (!active || !r || r.h2DpmChangePct == null) return null;
                  const v = r.h2DpmChangePct;
                  return (
                    <TipCard title={r.opponent ? `${r.round} v ${r.opponent}` : r.round}
                      footer={v <= -8 ? 'A drop this size usually means the legs went — worth checking rotations' : v >= 0 ? 'Second half matched or beat the first — strong finish' : 'A small drop is normal'}>
                      <TipRow color="#a78bfa" name="2nd-half intensity change" value={`${v > 0 ? '+' : ''}${fmt(v, 1)}%`} />
                    </TipCard>
                  );
                }} />
                <Line dataKey="h2DpmChangePct" name="2nd-half intensity change" stroke="#a78bfa" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
