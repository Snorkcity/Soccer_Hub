import { useMemo, useState } from "react";
import type { TrainingGpsSession } from "@workspace/api-client-react";
import { TRAINING_METRICS, TRAINING_PARTS, trainingInsights, trainingPlayerKey, trainingValue } from "@workspace/api-zod";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, ChevronDown, X } from "lucide-react";
import {
  OVERLAY_COLORS, partIdFromLabel, fmtDate, fmtMetric, fmtMin, groupMean, groupWholeMean, matchesFilters, metricDef, metricUnit, partRows, sessionKey, usePM, selectedPlayerValues, selectedPartLabel, trainingChartContext, relativeStandings, sortStandings, teamMetricData, STANDING_PARTS, canRate,
  type TrainingFilters, type SelectedPart, type PartId, C } from "./shared";
import { TeamMetricChart } from "./TeamMetricChart";
import { PartComparisonChart } from "./PartComparisonChart";
import { EmptyChart, InsightList, Panel, axisProps, tooltipStyle } from "./ui";

interface Props {
  sessions: TrainingGpsSession[]; session: TrainingGpsSession; f: TrainingFilters;
  set: (p: Partial<TrainingFilters>) => void; drill: (p: Partial<TrainingFilters>, tab?: string) => void;
}
const POSITIONS = ["outfield", "Defenders", "Midfielders", "Forwards", "Mixed / other", "Unassigned", "Goalkeepers"];

const FIRST = ["distance", "power", "hsm", "vhsm", "load", "accels", "decels", "speed", "duration"];
const ORDER: string[] = [...FIRST, ...TRAINING_METRICS.map(m => m.id as string).filter(id => !FIRST.includes(id))];

export function TeamTrainingTab({ sessions, session, f, set, drill }: Props) {
  const pm = usePM(f);
  const fmt = (v: number | null | undefined) => fmtMetric(f.metric, v, pm);
  const [overlay, setOverlay] = useState<string[]>([]);
  const [sort, setSort] = useState<{ col: "name" | "value" | "duration"; desc: boolean }>({ col: "value", desc: true });
  const [standingSort, setStandingSort] = useState<{ col: "name" | SelectedPart; desc: boolean }>({ col: "full", desc: false });
  const [standingMetric, setStandingMetric] = useState("distance");
  const standingPm = f.perMinute && canRate(standingMetric);
  const context = trainingChartContext(f, session);

  const all = partRows(session);
  const squads = useMemo(() => [...new Set(sessions.flatMap(s => partRows(s).map(r => r.squad ?? "Unassigned")))].sort(), [sessions]);
  const rows = all.filter(r => matchesFilters(r, f));
  const names = new Map(all.map(r => [trainingPlayerKey(r), r.playerName]));
  const filteredKeys = [...new Set(rows.map(trainingPlayerKey))];

  const profile = TRAINING_PARTS.map(p => {
    const g = groupMean(rows.filter(r => r.part === p.id), f.metric, pm);
    const d: Record<string, number | string | null> = { id: p.id, label: p.label, mean: g.mean, n: g.n };
    overlay.forEach((k, i) => { const r = all.find(x => x.part === p.id && trainingPlayerKey(x) === k); d[`o${i}`] = r ? trainingValue(r, f.metric, pm) : null; });
    return d;
  });

  const partList = selectedPlayerValues({ ...session, rows }, f.part, f.metric, pm);
  const sorted = [...partList].sort((a, b) => {
    const dir = sort.desc ? -1 : 1;
    if (sort.col === "name") return dir * a.name.localeCompare(b.name);
    const av = a[sort.col], bv = b[sort.col];
    if (av == null) return 1; if (bv == null) return -1;
    return dir * (av - bv);
  });
  const maxV = Math.max(0, ...partList.map(p => p.value ?? 0));
  const contributors = partList.filter(p => p.value != null).length;

  const standing = sortStandings(relativeStandings(rows, standingMetric, standingPm), standingSort.col, standingSort.desc);
  const toggleStanding = (col: "name" | SelectedPart) => setStandingSort(s => ({ col, desc: s.col === col ? !s.desc : false }));
  const StandingIcon = ({ col }: { col: "name" | SelectedPart }) => standingSort.col !== col ? null : standingSort.desc
    ? <ArrowDown className="inline h-3 w-3" /> : <ArrowUp className="inline h-3 w-3" />;

  const history = sessions.map(s => {
    const filt = (r: Parameters<typeof matchesFilters>[0]) => matchesFilters(r, f);
    const w = groupWholeMean(s, f.metric, pm, filt);
    const p = groupMean(partRows(s).filter(r => r.part === f.part && filt(r)), f.metric, pm);
    return { id: sessionKey(s), date: fmtDate(s.date), whole: w.mean, wholeN: w.n, part: p.mean, partN: p.n };
  });

  const charts = useMemo(() => ORDER.map(metric => ({ metric, ...teamMetricData(session, f, metric) })), [session, f]);
  const insights = useMemo(() => {
    const scope = (s: TrainingGpsSession) => ({ ...s, rows: s.rows.filter(r => matchesFilters(r, { squad: f.squad, position: f.position })) });
    return trainingInsights(scope(session), null, sessions.map(scope));
  }, [session, sessions, f.squad, f.position]);
  const toggleSort = (col: typeof sort.col) => setSort(s => ({ col, desc: s.col === col ? !s.desc : col !== "name" }));
  const SortIcon = ({ col }: { col: typeof sort.col }) => sort.col !== col ? null : sort.desc ? <ArrowDown className="inline h-3 w-3" /> : <ArrowUp className="inline h-3 w-3" />;

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap gap-2">
        <Select value={f.squad} onValueChange={v => set({ squad: v })}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-40" data-testid="select-team-squad"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All squads</SelectItem>{squads.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={f.position} onValueChange={v => set({ position: v })}>
          <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-48" data-testid="select-team-position"><SelectValue /></SelectTrigger>
          <SelectContent>{POSITIONS.map(p => <SelectItem key={p} value={p}>{p === "outfield" ? "All outfield" : p}</SelectItem>)}</SelectContent>
        </Select>
        <span className="self-center text-xs text-muted-foreground" data-testid="text-team-count">{filteredKeys.length} players in filter</span>
      </div>


      <p className="text-xs text-muted-foreground" data-testid="text-team-period">{fmtDate(session.date)} · {session.title || "Training"} · <span className="text-foreground">{selectedPartLabel(f.part)}</span>{f.part === "full" ? " (five marked parts, uncut recording excluded)" : ""} · {f.perMinute ? "per-minute rates where available" : "totals"}. Players in the same alphabetical order on every chart.</p>

        <Panel testId="table-relative-standing" kicker="Relative standing · five parts and full session" title={`${metricDef(standingMetric).label} rank within each part`}
        context={`${fmtDate(session.date)} · ${metricDef(standingMetric).label} (${metricUnit(standingMetric, standingPm)})`}
        aside={<Select value={standingMetric} onValueChange={setStandingMetric}>
          <SelectTrigger className="w-full sm:w-64" data-testid="select-standing-metric"><SelectValue /></SelectTrigger>
          <SelectContent>{ORDER.map(m => <SelectItem key={m} value={m}>{metricDef(m).label}</SelectItem>)}</SelectContent>
        </Select>}>
        {standing.length === 0 ? <EmptyChart>No players.</EmptyChart> : (
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 text-left" aria-sort={standingSort.col === "name" ? standingSort.desc ? "descending" : "ascending" : "none"}>
                    <button type="button" onClick={() => toggleStanding("name")} data-testid="sort-standing-name">Player <StandingIcon col="name" /></button>
                  </th>
                  {STANDING_PARTS.map(p => <th key={p.id} className="px-1 py-2" aria-sort={standingSort.col === p.id ? standingSort.desc ? "descending" : "ascending" : "none"}>
                    <button type="button" className="min-h-9" onClick={() => toggleStanding(p.id)} data-testid={`sort-standing-${p.id}`} title={`Sort by ${p.label} rank`}>
                      {p.label} <StandingIcon col={p.id} />
                    </button>
                  </th>)}
                </tr>
              </thead>
              <tbody>{standing.map(s => (
                <tr key={s.key} className="border-t border-border/60">
                  <td className="py-1.5 pr-2"><button type="button" className="text-left hover:text-primary" onClick={() => drill({ playerKey: s.key, metric: standingMetric }, "player")} data-testid={`link-standing-player-${s.key}`}>{s.name}</button></td>
                  {s.cells.map((c, i) => {
                    const share = c ? 1 - (c.rank - 1) / Math.max(1, c.n - 1) : 0;
                    return <td key={i} className="px-1 py-1.5 text-center">
                      {c ? <span className="inline-block min-w-10 rounded px-1 py-0.5 font-mono" style={{ background: `rgba(97, 169, 189, ${0.12 + share * 0.6})` }}>{c.rank}/{c.n}</span> : <span className="text-muted-foreground">—</span>}
                    </td>;
                  })}
                </tr>))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">Click a heading to sort; click again to reverse. Missing values stay last; tied ranks share a number. Full session ranks only players with all five parts recorded; incomplete totals show —. Rank 1 = most recorded output among filtered participants. Ranks describe output only, not quality or effort.</p>
          </div>
        )}
      </Panel>

      <div className="space-y-5" data-testid="team-metric-charts">
        {charts.map(c => <TeamMetricChart key={c.metric} {...c} periodLabel={selectedPartLabel(f.part)} dateLabel={fmtDate(session.date)}
          onPick={k => drill({ playerKey: k, metric: c.metric }, "player")} />)}
      </div>

      <InsightList insights={insights} testId="insights-team" />

      <details className="group rounded-xl border border-border bg-card/40" data-testid="details-team-deeper">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold" data-testid="button-toggle-deeper">
          <span>Deeper analysis <span className="font-normal text-muted-foreground">· group profile, single-metric comparison, history</span></span>
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-5 p-3 sm:p-4">
          <div className="max-w-xs">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Metric for deeper analysis</p>
            <Select value={f.metric} onValueChange={v => set({ metric: v })}>
              <SelectTrigger data-testid="select-deeper-metric"><SelectValue /></SelectTrigger>
              <SelectContent>{ORDER.map(m => <SelectItem key={m} value={m}>{metricDef(m).label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
      <Panel testId="chart-group-profile" kicker="All five parts" title={`Group profile — ${metricDef(f.metric).label}`} context={context}
        aside={<Select value="" onValueChange={v => setOverlay(o => o.includes(v) || o.length >= 3 ? o : [...o, v])}>
          <SelectTrigger className="w-52" data-testid="select-overlay-player"><SelectValue placeholder="Overlay a player (max 3)" /></SelectTrigger>
          <SelectContent>{[...names].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => <SelectItem key={k} value={k}>{n}</SelectItem>)}</SelectContent>
        </Select>}>
        {overlay.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{overlay.map((k, i) => (
          <button key={k} onClick={() => setOverlay(o => o.filter(x => x !== k))} data-testid={`button-remove-overlay-${i}`}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: OVERLAY_COLORS[i], color: OVERLAY_COLORS[i] }}>
            {names.get(k)}<X className="h-3 w-3" /></button>))}</div>}
        {rows.length === 0 ? <EmptyChart>No players match these filters.</EmptyChart> : (
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={profile} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                onClick={(e: { activePayload?: { payload: { id: string } }[] } | null) => { const id = e?.activePayload?.[0]?.payload.id; if (id) set({ part: id as PartId }); }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
                <XAxis dataKey="label" {...axisProps} interval={0} tickFormatter={(l: string) => l.split(" ")[0]} className="cursor-pointer" onClick={(t: { value?: unknown }) => { const id = partIdFromLabel(t?.value); if (id) set({ part: id }); }} />
                <YAxis {...axisProps} width={48} />
                <Tooltip {...tooltipStyle} formatter={(v: number, name: string, item: { payload?: { n: number } }) =>
                  [fmt(v), name === "mean" ? `Participant mean (n=${item.payload?.n})` : names.get(overlay[Number(name.slice(1))]) ?? name]} />
                <Legend formatter={(v: string) => v === "mean" ? "Participant mean" : names.get(overlay[Number(v.slice(1))]) ?? v} wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="mean" stroke={C.primary} strokeWidth={3} dot={{ r: 5 }} />
                {overlay.map((_, i) => <Line key={i} dataKey={`o${i}`} stroke={OVERLAY_COLORS[i]} strokeWidth={2} dot={{ r: 4 }} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">Click a part to select it for comparison and history below. Scoped to the squad and position filter above; insights use the same scope. Participant mean: the arithmetic mean of each contributing player's own {pm ? "rate" : "value"}{pm ? " (not a pooled squad rate)" : ""}. Hover shows contributor counts.</p>
      </Panel>


        <Panel testId="table-part-comparison" kicker="Player comparison" title={`${selectedPartLabel(f.part)} — ${metricDef(f.metric).label}`} context={context}
          aside={<span className="font-mono text-xs text-muted-foreground">{contributors} contributors · {metricUnit(f.metric, pm)}</span>}>
          {sorted.length === 0 ? <EmptyChart>Nobody in this filter recorded {selectedPartLabel(f.part)}.</EmptyChart> : (
            <>
            <PartComparisonChart fmt={fmt} onPick={k => drill({ playerKey: k }, "player")}
              data={sorted.map(p => ({ key: p.key, name: p.name, value: p.value, meta: `${p.pos ?? "No position"} · ${p.squad ?? "No squad"} · ${fmtMin(p.duration)}${p.partial ? " · partial session" : ""}` }))} />
            <p className="mb-3 text-[11px] text-muted-foreground">Bars follow the table sort. Click a bar or name to open that player.</p>
            {f.part === "full" && <p className="mb-3 text-[11px] text-muted-foreground">Combined five marked parts only, excluding the uncut recording. Rates use each player's combined recorded time; peak metrics use their highest value. Incomplete sessions are labelled partial.</p>}
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="cursor-pointer py-2" onClick={() => toggleSort("name")} data-testid="sort-name">Player <SortIcon col="name" /></th>
                    <th className="cursor-pointer py-2" onClick={() => toggleSort("value")} data-testid="sort-value">{metricDef(f.metric).label} <SortIcon col="value" /></th>
                    <th className="hidden cursor-pointer py-2 text-right sm:table-cell" onClick={() => toggleSort("duration")} data-testid="sort-duration">Time <SortIcon col="duration" /></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(p => (
                    <tr key={p.key} className="border-t border-border/60 hover:bg-muted/30" data-testid={`row-team-player-${p.key}`}>
                      <td className="py-2 pr-2">
                        <button className="text-left hover:text-primary" onClick={() => drill({ playerKey: p.key }, "player")} data-testid={`link-player-${p.key}`}>{p.name}</button>
                        <p className="text-[10px] text-muted-foreground">{p.pos ?? "No position"} · {p.squad ?? "No squad"}{p.partial ? " · Partial session" : ""}</p>
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${maxV ? ((p.value ?? 0) / maxV) * 100 : 0}%` }} /></div>
                          <span className="w-28 shrink-0 text-right font-mono text-xs">{fmt(p.value)}</span>
                        </div>
                      </td>
                      <td className="hidden py-2 text-right font-mono text-xs text-muted-foreground sm:table-cell">{fmtMin(p.duration)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Panel>


      <Panel testId="chart-team-history" kicker="Historical comparison" title={`${f.part === "full" ? "Full session" : `Full session and ${selectedPartLabel(f.part)}`} — group means over dates`} context={context} aside={<span className="text-[11px] text-muted-foreground">Click a date to open it</span>}>
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={history} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
              onClick={(e: { activePayload?: { payload: { id: string } }[] } | null) => { const id = e?.activePayload?.[0]?.payload.id; if (id) drill({ sessionId: id }); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
              <XAxis dataKey="date" {...axisProps} />
              <YAxis {...axisProps} width={48} />
              <Tooltip {...tooltipStyle} formatter={(v: number, name: string, item: { payload?: { wholeN: number; partN: number } }) =>
                [fmt(v), name === "whole" ? `Whole session, mean of complete player totals (n=${item.payload?.wholeN})` : `${selectedPartLabel(f.part)} mean (n=${item.payload?.partN})`]} />
              <Legend formatter={(v: string) => v === "whole" ? "Whole session (complete players)" : selectedPartLabel(f.part)} wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="whole" stroke={C.primary} strokeWidth={3} dot={{ r: 5 }} />
              {f.part !== "full" && <Line dataKey="part" stroke={C.tertiary} strokeWidth={2} dot={{ r: 4 }} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {sessions.length === 1 && <p className="mt-2 text-[11px] text-muted-foreground">One session recorded — observed values only, no historical baseline.</p>}
      </Panel>

        </div>
      </details>
    </div>
  );
}
