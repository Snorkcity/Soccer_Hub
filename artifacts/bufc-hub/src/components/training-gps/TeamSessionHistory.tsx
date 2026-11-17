import { useState } from "react";
import type { TrainingGpsSession } from "@workspace/api-client-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { C, STANDING_PARTS, TRAINING_REVIEW_METRICS, canRate, fmtDate, groupMean, groupWholeMean, matchesFilters, metricDef, partRows, selectedPartLabel, sessionKey, type SelectedPart, type TrainingFilters } from "./shared";
import { useMetricDisplay } from "./useMetricDisplay";
import { EmptyChart, Panel, Stat, axisProps, tooltipStyle } from "./ui";

interface Props {
  sessions: TrainingGpsSession[];
  session: TrainingGpsSession;
  filters: TrainingFilters;
  onPick: (id: string) => void;
}

/** Each date contributes one participant mean, not a squad attendance-dependent sum. */
export function TeamSessionHistory({ sessions, session, filters, onPick }: Props) {
  const [metric, setMetric] = useState(filters.metric);
  const [part, setPart] = useState<SelectedPart>(filters.part);
  const [rate, setRate] = useState(false);
  const pm = rate && canRate(metric);
  const display = useMetricDisplay(metric, pm);
  const history = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || sessionKey(a).localeCompare(sessionKey(b))).map(s => {
    const filter = (r: TrainingGpsSession["rows"][number]) => matchesFilters(r, filters);
    const result = part === "full"
      ? groupWholeMean(s, metric, pm, filter)
      : groupMean(partRows(s).filter(r => r.part === part && filter(r)), metric, pm);
    return { id: sessionKey(s), date: fmtDate(s.date), title: s.title || "Training", mean: display.value(result.mean), n: result.n };
  });
  const valid = history.filter((r): r is typeof r & { mean: number } => r.mean != null);
  const selected = history.find(r => r.id === sessionKey(session));
  const others = valid.filter(r => r.id !== sessionKey(session));
  const baseline = others.length ? others.reduce((sum, r) => sum + r.mean, 0) / others.length : null;
  const difference = selected?.mean != null && baseline != null && baseline !== 0 ? (selected.mean - baseline) / baseline * 100 : null;
  const low = valid.length ? Math.min(...valid.map(r => r.mean)) : null;
  const high = valid.length ? Math.max(...valid.map(r => r.mean)) : null;
  const lowest = valid.filter(r => r.mean === low);
  const highest = valid.filter(r => r.mean === high);
  const tiedDate = (rows: typeof valid) => rows.length === 1 ? rows[0].date : `${rows.length} sessions tied`;
  const fmt = display.format;
  const label = selectedPartLabel(part);

  return (
    <Panel testId="chart-team-history" kicker="Historical comparison" title={`${label} — team output across sessions`}
      context={`${metricDef(metric).label} (${display.unit}) · ${filters.squad === "all" ? "All squads" : filters.squad} · ${filters.position === "outfield" ? "All outfield" : filters.position} · oldest → newest`}>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 sm:flex-none">
          <span className="mb-1 block text-xs text-muted-foreground">Compare metric</span>
          <Select value={metric} onValueChange={setMetric}>
            <SelectTrigger className="w-full sm:w-60" data-testid="select-history-metric"><SelectValue /></SelectTrigger>
            <SelectContent>{TRAINING_REVIEW_METRICS.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        <label className="min-w-0 flex-1 sm:flex-none">
          <span className="mb-1 block text-xs text-muted-foreground">Session / part</span>
          <Select value={part} onValueChange={v => setPart(v as SelectedPart)}>
            <SelectTrigger className="w-full sm:w-52" data-testid="select-history-part"><SelectValue /></SelectTrigger>
            <SelectContent>{STANDING_PARTS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </label>
        {metric === "speed" ? display.control : canRate(metric) ? (
          <div role="group" aria-label="History totals or per minute" className="inline-flex rounded-md border border-input p-0.5">
            {([false, true] as const).map(value => <button key={String(value)} type="button" aria-pressed={pm === value} onClick={() => setRate(value)}
              className={`min-h-9 rounded px-3 text-xs ${pm === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              {value ? "Per minute" : "Total"}
            </button>)}
          </div>
        ) : <span className="pb-2 text-xs text-muted-foreground">{display.unit}</span>}
      </div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="history-summary">
        <Stat label={`Selected · ${fmtDate(session.date)}`} value={fmt(selected?.mean)}
          sub={selected?.mean != null ? `${selected.n} contributing ${selected.n === 1 ? "player" : "players"}` : "No qualifying values in this filter"} />
        <Stat label="Other sessions' average" value={fmt(baseline)}
          sub={`${others.length} sessions · each session weighted equally`} />
        <Stat label="Lowest recorded mean" value={fmt(low)} sub={valid.length ? tiedDate(lowest) : "No qualifying sessions"} />
        <Stat label="Highest recorded mean" value={fmt(high)} sub={valid.length ? tiedDate(highest) : "No qualifying sessions"} />
      </div>
      {valid.length === 0 ? <EmptyChart>No qualifying values for this metric, part and player filter.</EmptyChart> : (
        <div className="h-72" data-testid="history-line-chart">
          <ResponsiveContainer>
            <LineChart data={history} margin={{ top: 12, right: 14, left: 0, bottom: 0 }}
              onClick={(e: { activePayload?: { payload: { id: string } }[] } | null) => {
                const id = e?.activePayload?.[0]?.payload.id;
                if (id) onPick(id);
              }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
              <XAxis dataKey="date" {...axisProps} />
              <YAxis {...axisProps} width={54} domain={[0, "auto"]} />
              <Tooltip {...tooltipStyle} labelFormatter={(_label, payload) => {
                const row = payload?.[0]?.payload;
                return row ? `${row.date} · ${row.title}` : "";
              }} formatter={(value: number, _name: string, item: { payload?: { n: number } }) =>
                [fmt(value), `Mean per player (n=${item.payload?.n ?? 0})`]} />
              <Line name="Mean per player" dataKey="mean" connectNulls={false} stroke={C.primary} strokeWidth={3} dot={{ r: 5 }} activeDot={{ r: 7 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 space-y-2 text-xs text-muted-foreground" data-testid="history-explanation">
        {difference != null && <p><span className="font-semibold text-foreground">{fmtDate(session.date)}:</span> mean {metricDef(metric).label.toLowerCase()} was {Math.abs(difference).toFixed(1)}% {difference < 0 ? "below" : difference > 0 ? "above" : "different from"} the average of the other {others.length} tracked {others.length === 1 ? "session" : "sessions"}.</p>}
        <p>Each point is the average of the contributing players' own {metric === "speed" ? "top speeds" : pm || metric === "distancePerMinute" ? "per-minute rates" : "recorded values"}, not the squad total.
          {part === "full" ? " Full session includes only players with all five marked parts and a valid metric; the uncut recording is excluded." : ` Only ${label.toLowerCase()} is compared.`}
          {" "}Squad and position filters above apply; the players contributing can change between dates.</p>
        <p>{metric === "speed" ? "Top speed is a peak, not an overall intensity measure." : pm || metric === "distancePerMinute" ? "Rates help compare output intensity when recorded durations differ; stoppages within marked parts remain included." : "Totals depend on recorded duration as well as activity. Try Distance per minute or the Per minute option to explore intensity."}
          {" "}Lower output is not automatically a worse session—it may reflect the practice aim, duration or player mix. This is your tracked history, not a target or injury-risk assessment.</p>
        {valid.length < 3 && <p>Only {valid.length} qualifying {valid.length === 1 ? "session" : "sessions"}: an early comparison, not an established pattern.</p>}
      </div>
      <details className="mt-4 rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Session values and player counts · {history.length} tracked sessions</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="text-muted-foreground"><th className="py-2">Session</th><th className="px-2 text-right">Mean ({display.unit})</th><th className="text-right">Players</th></tr></thead>
            <tbody>{history.map(row => <tr key={row.id} className={`border-t border-border ${row.id === sessionKey(session) ? "bg-primary/10" : ""}`}>
              <td className="py-2"><button type="button" onClick={() => onPick(row.id)} className="text-left hover:underline"><span className="font-medium">{row.date}</span><span className="block text-muted-foreground">{row.title}</span></button></td>
              <td className="px-2 text-right font-mono">{fmt(row.mean)}</td><td className="text-right">{row.n}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>
      <p className="mt-2 text-[11px] text-muted-foreground">Click a chart point or a session in the list to open that session. These controls affect only this comparison.</p>
    </Panel>
  );
}
