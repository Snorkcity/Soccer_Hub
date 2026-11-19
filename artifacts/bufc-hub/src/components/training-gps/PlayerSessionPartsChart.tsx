import type { TrainingGpsSession } from "@workspace/api-client-react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { C, canRate, fmtDate, fmtMin, fmtNum, metricDef, type SelectedPart } from "./shared";
import { playerPartBreakdown } from "./playerPartBreakdown";
import { useMetricDisplay } from "./useMetricDisplay";
import { EmptyChart, Panel, axisProps, tooltipStyle } from "./ui";

interface Props {
  session: TrainingGpsSession | undefined; playerKey: string; playerName: string;
  metric: string; pm: boolean; selectedPart: SelectedPart;
  onPart: (part: SelectedPart) => void; onRate: (perMinute: boolean) => void;
}

export function PlayerSessionPartsChart({ session, playerKey, playerName, metric, pm, selectedPart, onPart, onRate }: Props) {
  const breakdown = playerPartBreakdown(session, playerKey, metric, pm);
  const display = useMetricDisplay(metric, pm);
  const data = breakdown.parts.map(p => ({ ...p, bar: display.value(p.value) }));
  const format = (v: number | null | undefined) => display.format(display.value(v));
  return (
    <Panel testId="chart-player-session-parts" kicker={`${playerName} · ${session ? fmtDate(session.date) : "No session"}`}
      title={`${metricDef(metric).label} — across the five parts`}
      context={`${session?.title || "Training"} · ${display.unit} · selected session only`}
      aside={metric === "speed" ? display.control : canRate(metric) ? (
        <div role="group" aria-label="Part breakdown totals or per minute" className="inline-flex rounded-md border border-input p-0.5">
          {[false, true].map(value => <button key={String(value)} type="button" aria-pressed={pm === value}
            data-testid={`button-parts-${value ? "pm" : "total"}`} onClick={() => onRate(value)}
            className={`min-h-8 rounded px-3 text-xs ${pm === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
            {value ? "/min" : "Total"}
          </button>)}
        </div>
      ) : undefined}>
      {data.every(p => p.value == null) ? <EmptyChart>No recorded values for this player and session.</EmptyChart> : (
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={data} layout="vertical" margin={{ top: 8, bottom: 8, left: 0, right: 50 }}
              onClick={(event: { activePayload?: { payload: { id: SelectedPart } }[] } | null) => {
                const part = event?.activePayload?.[0]?.payload.id;
                if (part) onPart(part);
              }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" horizontal={false} />
              <XAxis type="number" {...axisProps} domain={[0, "auto"]} />
              <YAxis type="category" dataKey="label" {...axisProps} width={112} interval={0} tick={{ fontSize: 10 }} />
              <Tooltip {...tooltipStyle} formatter={(v: number, _name: string, item: { payload?: { duration: number | null; share: number | null } }) =>
                [display.format(v), `${fmtMin(item.payload?.duration)}${item.payload?.share != null ? ` · ${item.payload.share.toFixed(1)}% of session total` : ""}`]} />
              <Bar dataKey="bar" name={metricDef(metric).label} maxBarSize={26} radius={[0, 3, 3, 0]} isAnimationActive={false} className="cursor-pointer">
                {data.map(p => <Cell key={p.id} fill={selectedPart === p.id ? C.secondary : C.primary} />)}
                <LabelList dataKey="bar" position="right" fontSize={11} fill="hsl(210 40% 92%)" formatter={(v: number | null) => v == null ? "—" : fmtNum(v)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 space-y-2 text-xs text-muted-foreground" data-testid="text-parts-summary">
        {breakdown.total != null && <p><strong className="text-foreground">Full-session total: {format(breakdown.total)}.</strong> The five parts above add up to this value.</p>}
        {breakdown.highestParts.length > 0 && <p>{breakdown.complete ? "Highest" : "Highest among recorded parts"}: <strong className="text-foreground">{breakdown.highestParts.map(p => p.label).join(" and ")}</strong> — {format(breakdown.highestParts[0].value)}{breakdown.highestParts.length > 1 ? " each" : ""}.</p>}
        {!breakdown.complete && <p>Some parts or measurements are missing (—), not zero.{breakdown.additive ? " A complete five-part total cannot be confirmed." : " Compare the available parts with care."}</p>}
        {!breakdown.additive && <p>{metric === "speed" ? "Each part shows its top speed; the full-session top speed is the highest, not their sum." : "Each part uses its own recorded minutes. Rates are not added together; the full-session rate uses combined output divided by combined recorded time."}</p>}
        <p>The uncut source recording is excluded. Click a part or its row below to update the period summary and ranks above; choose Full session to return to the overall summary.</p>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs" data-testid="table-player-session-parts">
          <thead className="text-muted-foreground"><tr><th className="py-2">Practice part</th><th className="px-2 text-right">Value ({display.unit})</th><th className="px-2 text-right">Time</th>{breakdown.total != null && <th className="text-right">Share</th>}</tr></thead>
          <tbody>{breakdown.parts.map(p => <tr key={p.id} className={`border-t border-border ${p.id === selectedPart ? "bg-primary/10" : ""}`}>
            <td className="py-2"><button type="button" aria-pressed={selectedPart === p.id} onClick={() => onPart(p.id)} className="text-left hover:underline" data-testid={`button-drill-part-${p.id}`}>{p.label}</button></td>
            <td className="px-2 text-right font-mono">{format(p.value)}</td><td className="px-2 text-right whitespace-nowrap">{fmtMin(p.duration)}</td>
            {breakdown.total != null && <td className="text-right">{p.share == null ? "—" : `${p.share.toFixed(1)}%`}</td>}
          </tr>)}</tbody>
        </table>
      </div>
    </Panel>
  );
}
