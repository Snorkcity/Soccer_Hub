import { useMemo, useState } from "react";
import type { TrainingGpsSession } from "@workspace/api-client-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  C, TRAINING_REVIEW_METRICS, canRate, fmtDate, fmtMetric, metricDef, metricUnit, sessionPartMeans,
  type PartId,
} from "./shared";
import { EmptyChart, Panel, axisProps, tooltipStyle } from "./ui";

const METRICS = TRAINING_REVIEW_METRICS.filter(m => m.id !== "duration");
const POSITIONS = ["outfield", "Defenders", "Midfielders", "Forwards", "Mixed / other", "Unassigned", "Goalkeepers"];
const SHORT_LABELS: Record<string, string> = {
  warmup: "Warm-up", passing: "Passing", technical: "Technical", main: "Main part", end: "End game",
};

export function CoachSessionMomentum({
  session, selectedPart, onPick,
}: {
  session: TrainingGpsSession; selectedPart: string; onPick: (part: PartId) => void;
}) {
  const [metric, setMetric] = useState("distancePerMinute");
  const [perMinute, setPerMinute] = useState(false);
  const [position, setPosition] = useState("outfield");
  const pm = perMinute && canRate(metric);
  const data = useMemo(() => sessionPartMeans(session, metric, pm, position), [session, metric, pm, position]);
  const fmt = (v: number | null) => fmtMetric(metric, v, pm);
  const scope = position === "outfield" ? "All outfield" : position;
  const unit = metricUnit(metric, pm);

  return (
    <Panel testId="chart-coach-momentum" kicker="Session momentum · team averages"
      title={`${metricDef(metric).label} across session parts`}
      context={`${fmtDate(session.date)} · ${session.title || "Training"} · All five parts · ${scope} · ${unit}`}
      aside={<div className="flex w-full flex-wrap gap-2 sm:w-auto">
        <Select value={metric} onValueChange={v => { setMetric(v); setPerMinute(false); }}>
          <SelectTrigger aria-label="Session momentum metric" className="w-full sm:w-48" data-testid="select-coach-momentum-metric"><SelectValue /></SelectTrigger>
          <SelectContent>{METRICS.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={position} onValueChange={setPosition}>
          <SelectTrigger aria-label="Session momentum players" className="w-full sm:w-40" data-testid="select-coach-momentum-position"><SelectValue /></SelectTrigger>
          <SelectContent>{POSITIONS.map(p => <SelectItem key={p} value={p}>{p === "outfield" ? "All outfield" : p}</SelectItem>)}</SelectContent>
        </Select>
        {canRate(metric) && <div className="inline-flex items-center rounded-md border border-input p-0.5" role="group" aria-label="Session momentum totals or per minute">
          {[false, true].map(rate => <button key={String(rate)} type="button" aria-pressed={pm === rate}
            onClick={() => setPerMinute(rate)} data-testid={`button-coach-momentum-${rate ? "pm" : "total"}`}
            className={`min-h-8 rounded px-2 text-[11px] font-medium ${pm === rate ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
            {rate ? "/min" : "Total"}
          </button>)}
        </div>}
      </div>}>
      {data.every(d => d.mean == null) ? <EmptyChart>No valid measurements for this metric and player group in this session.</EmptyChart> : (
        <div className="h-64 min-w-0 sm:h-72" role="img" aria-label={`${metricDef(metric).label}: ${data.map(d => `${d.label}, ${fmt(d.mean)}, ${d.n} players`).join("; ")}`}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 20, right: 16, left: 0, bottom: 0 }}
              onClick={(e: { activePayload?: { payload: { id: PartId } }[] } | null) => {
                const part = e?.activePayload?.[0]?.payload.id;
                if (part) onPick(part);
              }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
              <XAxis type="category" dataKey="id" {...axisProps} interval={0} tickFormatter={id => SHORT_LABELS[id] ?? id} />
              <YAxis type="number" {...axisProps} width={48} domain={[0, "auto"]} />
              <Tooltip {...tooltipStyle} labelFormatter={(_label, payload) => payload?.[0]?.payload?.label ?? ""}
                formatter={(value: number, _name: string, item: { payload?: { n: number } }) =>
                  [fmt(Number(value)), `Mean per player · n=${item.payload?.n ?? 0}`]} />
              <Line type="linear" dataKey="mean" name="Mean per player" stroke={C.primary} strokeWidth={3}
                dot={{ r: 5 }} activeDot={{ r: 7 }} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="coach-momentum-values">
        {data.map(d => <button key={d.id} type="button" onClick={() => onPick(d.id)} aria-pressed={selectedPart === d.id}
          className={`min-w-0 rounded-lg border p-2 text-left hover:bg-muted ${selectedPart === d.id ? "border-primary bg-primary/10" : "border-border bg-muted/30"}`}
          data-testid={`button-coach-momentum-${d.id}`}>
          <span className="block text-xs text-muted-foreground">{d.label}</span>
          <span className="mt-1 block break-words font-mono text-sm font-semibold">{fmt(d.mean)}</span>
          <span className="block text-[10px] text-muted-foreground">{d.n} contributing player{d.n === 1 ? "" : "s"}</span>
        </button>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Each point is the mean of the contributing players’ own {pm || metric === "distancePerMinute" ? "per-minute rates" : metric === "speed" ? "maximum speeds" : "recorded values"} in that part—not the squad total.
        {" "}{pm || metric === "distancePerMinute" ? "Rates use each player’s recorded participation minutes, including stoppages within the part." : metric === "speed" ? "This is not the single fastest speed in the group." : "Longer parts can accumulate larger totals."}
        {" "}Player counts may differ between parts; missing values are gaps, not zero.
        {position === "outfield" && " Goalkeepers and players without an assigned position are excluded from All outfield."}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Parts are shown in session order, not elapsed clock time. The uncut recording is excluded. Click a point or part card to select its duration history below. This describes physical output, not effort or football performance.
      </p>
    </Panel>
  );
}
