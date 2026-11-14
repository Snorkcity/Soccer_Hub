import { useMemo } from "react";
import type { TrainingGpsRow, TrainingGpsSession } from "@workspace/api-client-react";
import { TRAINING_PARTS, trainingInsights, trainingPlayerKey, trainingPositionGroup, trainingValue } from "@workspace/api-zod";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  fmtDate, partIdFromLabel, fmtMetric, groupMean, groupWholeMean, isGk, metricDef, metricUnit, partRows, playerWhole, sessionKey, sessionPlayers, usePM, selectedPartLabel, trainingChartContext,
  type TrainingFilters, type PartId, C } from "./shared";
import { EmptyChart, InsightList, Note, Panel, Stat, axisProps, tooltipStyle } from "./ui";

interface Props {
  sessions: TrainingGpsSession[]; session: TrainingGpsSession; f: TrainingFilters;
  set: (p: Partial<TrainingFilters>) => void; drill: (p: Partial<TrainingFilters>, tab?: string) => void;
}

function wholeCaption(metric: string, partial: boolean): string {
  const base = ["speed", "maxAccel", "maxDecel"].includes(metric) ? "Highest value in any marked part"
    : metric === "duration" ? "Combined recorded participation across marked parts" : "Sum of the marked parts";
  return partial ? `${base} · partial, not all five parts` : base;
}

function peers(rows: TrainingGpsRow[], me: TrainingGpsRow, mode: "squad" | "position") {
  return rows.filter(r => r.part === me.part && trainingPlayerKey(r) !== trainingPlayerKey(me) && isGk(r) === isGk(me) &&
    (mode === "squad" ? (r.squad ?? null) === (me.squad ?? null) : trainingPositionGroup(r.positionCode) === trainingPositionGroup(me.positionCode)));
}

export function PlayerTrainingTab({ sessions, session, f, set, drill }: Props) {
  const pm = usePM(f);
  const players = useMemo(() => sessionPlayers(sessions), [sessions]);
  const inSession = useMemo(() => new Set(partRows(session).map(trainingPlayerKey)), [session]);
  const playerKey = f.playerKey && players.some(p => p.key === f.playerKey) ? f.playerKey : players.find(p => inSession.has(p.key))?.key ?? null;
  const player = players.find(p => p.key === playerKey);
  const posComparable = player && !["Unassigned", "Mixed / other"].includes(player.group);
  const unit = metricUnit(f.metric, pm);
  const fmt = (v: number | null | undefined) => fmtMetric(f.metric, v, pm);
  const context = `${player?.name ?? "Player"} · ${trainingChartContext(f, session)}`;

  const whole = useMemo(() => !playerKey ? [] : sessions.map(s => {
    const w = playerWhole(s, playerKey, f.metric, pm);
    const me = partRows(s).find(r => trainingPlayerKey(r) === playerKey);
    const peerMean = me ? groupWholeMean(s, f.metric, pm, r => trainingPlayerKey(r) !== playerKey && isGk(r) === isGk(me) && (r.squad ?? null) === (me.squad ?? null)) : null;
    return {
      id: sessionKey(s), date: fmtDate(s.date),
      complete: w && !w.partial ? w.value : null,
      partialV: w && w.partial ? w.value ?? null : null,
      parts: w?.parts ?? 0, peer: peerMean?.mean ?? null, peerN: peerMean?.n ?? 0,
    };
  }).filter(d => d.parts > 0), [sessions, playerKey, f.metric, pm]);

  const myRows = partRows(session).filter(r => trainingPlayerKey(r) === playerKey);
  const sessionAll = partRows(session);
  const cw = playerKey ? playerWhole(session, playerKey, f.metric, pm) : null;

  const parts = TRAINING_PARTS.map(p => {
    const me = myRows.find(r => r.part === p.id);
    const sq = me ? groupMean(peers(sessionAll, me, "squad"), f.metric, pm) : null;
    const pos = me && posComparable ? groupMean(peers(sessionAll, me, "position"), f.metric, pm) : null;
    return { id: p.id, label: p.label, me: me ? trainingValue(me, f.metric, pm) : null, squad: sq?.mean ?? null, squadN: sq?.n ?? 0, pos: pos?.mean ?? null, posN: pos?.n ?? 0, recorded: !!me };
  });

  const partTrend = f.part === "full" ? whole.map(w => ({
    id: w.id, date: w.date, me: w.complete ?? w.partialV, peer: w.peer, peerN: w.peerN, partial: w.parts < 5,
  })) : !playerKey ? [] : sessions.flatMap(s => {
    const rows = partRows(s);
    const me = rows.find(r => r.part === f.part && trainingPlayerKey(r) === playerKey);
    if (!me) return [];
    const sq = groupMean(peers(rows, me, "squad"), f.metric, pm);
    return [{ id: sessionKey(s), date: fmtDate(s.date), me: trainingValue(me, f.metric, pm), peer: sq.mean, peerN: sq.n, partial: false }];
  });

  const insights = useMemo(() => playerKey ? trainingInsights(session, playerKey, sessions) : [], [session, playerKey, sessions]);
  const single = sessions.length === 1;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select value={playerKey ?? ""} onValueChange={v => set({ playerKey: v })}>
          <SelectTrigger className="sm:w-80" data-testid="select-training-player"><SelectValue placeholder="Choose a player" /></SelectTrigger>
          <SelectContent>{players.map(p => <SelectItem key={p.key} value={p.key}>{p.name}{p.position ? ` · ${p.position}` : ""}{p.squad ? ` · ${p.squad}` : ""}{inSession.has(p.key) ? "" : " (not in this session)"}</SelectItem>)}</SelectContent>
        </Select>
        {player && <p className="text-xs text-muted-foreground" data-testid="text-player-identity">{player.group}{player.key.startsWith("source:") ? " · not linked to roster" : ""}</p>}
      </div>

      {!player ? <EmptyChart>Pick a player to see their training load.</EmptyChart> : <>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat testId="stat-whole-session" label={`Whole session · ${fmtDate(session.date)}`} value={cw ? fmt(cw.value) : "Not recorded"} sub={wholeCaption(f.metric, cw?.partial ?? true)} />
          <Stat testId="stat-parts-recorded" label="Parts recorded" value={`${cw?.parts ?? 0} / 5`} sub={cw?.missingSplit ? "Unknown or missing split in export" : undefined} />
          <Stat testId="stat-top-speed" label="Session top speed" value={fmtMetric("speed", cw ? playerWhole(session, playerKey!, "speed", false)?.value : null)} />
          <Stat testId="stat-sessions" label="Sessions with this player" value={String(whole.length)} sub={single ? "Observed only — no baseline yet" : undefined} />
        </div>

        <Panel testId="chart-whole-session" kicker="Always full session · over dates" title={`Full session — ${metricDef(f.metric).label} across every session`} context={context}
          aside={<span className="font-mono text-xs text-muted-foreground">{unit} · click a point to open that date</span>}>
          {whole.length === 0 ? <EmptyChart>No recordings for this player.</EmptyChart> : (
            <div className="h-72 sm:h-80">
              <ResponsiveContainer>
                <ComposedChart data={whole} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                  onClick={(e: { activePayload?: { payload: { id: string } }[] } | null) => { const id = e?.activePayload?.[0]?.payload.id; if (id) drill({ sessionId: id }); }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
                  <XAxis dataKey="date" {...axisProps} />
                  <YAxis {...axisProps} width={48} />
                  <Tooltip {...tooltipStyle} formatter={(v: number, name: string, item: { payload?: { parts: number; peerN: number } }) =>
                    [fmt(v), name === "peer" ? `Squad peers mean (n=${item.payload?.peerN ?? 0})` : name === "partialV" ? `Partial (${item.payload?.parts}/5 parts)` : "Whole session"]} />
                  <Legend formatter={(v: string) => v === "peer" ? "Squad peers, mean of complete totals" : v === "partialV" ? "Partial session" : "Whole session (5 parts)"} wrapperStyle={{ fontSize: 11 }} />
                  <Line dataKey="peer" stroke={C.muted} strokeDasharray="5 4" dot={false} connectNulls />
                  <Line dataKey="complete" stroke={C.primary} strokeWidth={3} dot={{ r: 5, fill: C.primary }} activeDot={{ r: 7 }} connectNulls={false} />
                  <Line dataKey="partialV" stroke="transparent" dot={{ r: 5, fill: "transparent", stroke: C.orange, strokeWidth: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          {single && <div className="mt-3"><Note>Only one session recorded. Values are observed for this date only — there is no historical baseline yet.</Note></div>}
        </Panel>

        <div className="grid gap-5 xl:grid-cols-2">
          <Panel testId="chart-five-part" kicker="All five parts" title={`${metricDef(f.metric).label} vs participating peers`} context={context}
            aside={<span className="text-[11px] text-muted-foreground">Click a part to trend it</span>}>
            {myRows.length === 0 ? <EmptyChart>Not in this session.</EmptyChart> : (
              <div className="h-72">
                <ResponsiveContainer>
                  <BarChart data={parts} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
                    onClick={(e: { activePayload?: { payload: { id: string } }[] } | null) => { const id = e?.activePayload?.[0]?.payload.id; if (id) set({ part: id as PartId }); }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
                    <XAxis dataKey="label" {...axisProps} interval={0} tickFormatter={(l: string) => l.split(" ")[0]} className="cursor-pointer" onClick={(t: { value?: unknown }) => { const id = partIdFromLabel(t?.value); if (id) set({ part: id }); }} />
                    <YAxis {...axisProps} width={48} />
                    <Tooltip {...tooltipStyle} formatter={(v: number, name: string, item: { payload?: { squadN: number; posN: number } }) =>
                      [fmt(v), name === "squad" ? `Squad peers mean (n=${item.payload?.squadN})` : name === "pos" ? `Position peers mean (n=${item.payload?.posN})` : player.name]} />
                    <Legend formatter={(v: string) => v === "squad" ? "Squad peers" : v === "pos" ? "Position peers" : player.name} wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="me" fill={C.primary} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="squad" fill={C.mutedDark} radius={[4, 4, 0, 0]} />
                    {posComparable && <Bar dataKey="pos" fill={C.secondary} radius={[4, 4, 0, 0]} />}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">Peers are players who took part in that same part; means are of each peer's own value. {posComparable ? "" : "No confirmed position, so no position-peer comparison."} {parts.filter(p => !p.recorded).length ? `Not recorded: ${parts.filter(p => !p.recorded).map(p => p.label).join(", ")}.` : ""}</p>
          </Panel>

          <Panel testId="chart-part-trend" kicker="Selected period · history" title={`${selectedPartLabel(f.part)} — ${metricDef(f.metric).label} over dates`} context={context}
            aside={<span className="text-[11px] text-muted-foreground">Click a point to open that date</span>}>
            {f.part === "full" && <p className="mb-3 text-[11px] text-muted-foreground">Combined marked parts only, excluding the uncut recording. Rates use combined recorded participation; peak metrics use the highest value.</p>}
            {partTrend.length === 0 ? <EmptyChart>No {selectedPartLabel(f.part)} recordings for this player.</EmptyChart> : (
              <div className="h-72">
                <ResponsiveContainer>
                  <LineChart data={partTrend} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                    onClick={(e: { activePayload?: { payload: { id: string } }[] } | null) => { const id = e?.activePayload?.[0]?.payload.id; if (id) drill({ sessionId: id }); }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
                    <XAxis dataKey="date" {...axisProps} />
                    <YAxis {...axisProps} width={48} />
                    <Tooltip {...tooltipStyle} formatter={(v: number, name: string, item: { payload?: { peerN: number; partial: boolean } }) => [fmt(v), name === "peer" ? `Squad peers mean (n=${item.payload?.peerN})` : `${player.name}${item.payload?.partial ? " · partial session" : ""}`]} />
                    <Line dataKey="peer" stroke={C.muted} strokeDasharray="5 4" dot={{ r: 3 }} />
                    <Line dataKey="me" stroke={C.tertiary} strokeWidth={2.5} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>
        </div>

        <InsightList insights={insights} testId="insights-player" />
      </>}
    </div>
  );
}
