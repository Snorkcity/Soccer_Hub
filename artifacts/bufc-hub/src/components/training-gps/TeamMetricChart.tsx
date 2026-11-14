import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownAZ, ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { C, canRate, fmtMetric, fmtMin, fmtNum, metricDef, metricUnit, type TeamChartSort } from "./shared";
import { tooltipStyle } from "./ui";

export interface TeamMetricItem { key: string; name: string; value: number | null; duration: number | null; partial: boolean; pos: string | null; squad: string | null }

interface Props {
  metric: string; items: TeamMetricItem[]; mean: number | null; total: number | null; n: number; pm: boolean;
  periodLabel: string; dateLabel: string; onPick: (key: string) => void;
  sort: TeamChartSort; onSort: (s: TeamChartSort) => void; onRate: (perMinute: boolean) => void;
}
const SORTS: { id: TeamChartSort; label: string; Icon: typeof ArrowDownAZ }[] = [
  { id: "name", label: "Alphabetical", Icon: ArrowDownAZ },
  { id: "highest", label: "Highest first", Icon: ArrowDownWideNarrow },
  { id: "lowest", label: "Lowest first", Icon: ArrowUpNarrowWide },
];

const COL = 42;

/** One vertical column per player, Catapult-style: value on top, participant average line. */
export function TeamMetricChart({ metric, items, mean, total, n, pm, periodLabel, dateLabel, onPick, sort, onSort, onRate }: Props) {
  const def = metricDef(metric);
  const unit = metricUnit(metric, pm);
  const short = (v: number | null | undefined) => {
    if (v == null) return "—";
    if (metric === "speed") return v.toFixed(1);
    return fmtNum(v, Math.abs(v) >= 100 ? 0 : pm || Math.abs(v) < 10 ? 1 : 0);
  };
  const data = items.map(i => ({ ...i, bar: i.value }));
  const recorded = items.filter(i => i.value != null).length;
  const hasPartial = items.some(i => i.partial);
  const slug = metric.toLowerCase();
  const rateable = canRate(metric);
  const seg = (on: boolean) => `inline-flex min-h-8 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`;

  return (
    <section data-testid={`chart-team-metric-${slug}`} className="rounded-xl border border-card-border bg-card/80 p-4 sm:p-5">
      <header className="mb-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">{dateLabel} · {periodLabel}</p>
          <h3 className="text-lg font-semibold tracking-tight">{def.label} <span className="text-sm font-normal text-muted-foreground">({unit})</span></h3>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <div className="inline-flex rounded-md border border-input p-0.5" role="group" aria-label={`Sort ${def.label}`}>
            {SORTS.map(o => <button key={o.id} type="button" aria-pressed={sort === o.id} title={o.label} aria-label={o.label}
              onClick={() => onSort(o.id)} className={seg(sort === o.id)} data-testid={`button-sort-${slug}-${o.id}`}><o.Icon className="h-3.5 w-3.5" /></button>)}
          </div>
          {metric === "speed" ? <span className="self-center px-2 text-xs text-muted-foreground" title="Maximum speed is a peak, not a distance-per-minute metric. Hover a column for km/h and m/s.">Peak speed · km/h</span> : metric === "distancePerMinute" ? <span className="self-center px-2 text-xs text-muted-foreground">Always m/min</span> : <div className="inline-flex rounded-md border border-input p-0.5" role="group" aria-label={`${def.label} totals or per minute`}
            title={rateable ? undefined : "Peak or participation value; a per-minute rate would not be meaningful"}>
            <button type="button" aria-pressed={!pm} onClick={() => onRate(false)} className={seg(!pm)} data-testid={`button-rate-${slug}-total`}>Total</button>
            <button type="button" aria-pressed={pm} disabled={!rateable} onClick={() => onRate(true)} className={seg(pm)} data-testid={`button-rate-${slug}-pm`}>/min</button>
          </div>}
        </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
          <span className="inline-flex items-center gap-1.5" data-testid={`text-avg-${slug}`}>
            <span className="inline-block h-0.5 w-4" style={{ background: C.secondary }} />
            Avg {fmtMetric(metric, mean, pm)} <span className="text-muted-foreground">(n={n})</span>
          </span>
          {total != null && <span data-testid={`text-total-${slug}`}>Total {fmtMetric(metric, total, pm)}</span>}
          <span className="text-muted-foreground">{recorded}/{items.length} recorded</span>
          {metric === "distancePerMinute" ? <span className="text-muted-foreground">Distance ÷ recorded participation minutes</span> : !rateable && <span className="text-muted-foreground">Not a rate metric</span>}
        </div>
      </header>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">No players in this filter for {periodLabel}.</p>
      ) : (
        <div className="overflow-x-auto overscroll-x-contain">
          <div style={{ minWidth: items.length * COL + 56, height: 300 }}>
            <ResponsiveContainer>
              <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 4 }}
                onClick={(e: { activePayload?: { payload: TeamMetricItem }[] } | null) => { const k = e?.activePayload?.[0]?.payload.key; if (k) onPick(k); }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
                <XAxis dataKey="key" interval={0} height={92} tickLine={false} stroke="hsl(215 20% 65%)"
                  tick={(p: { x: number; y: number; payload: { value: string } }) => {
                    const it = items.find(i => i.key === p.payload.value);
                    return (
                      <g transform={`translate(${p.x},${p.y + 6})`} className="cursor-pointer" role="button" tabIndex={0}
                        aria-label={`Open ${it?.name ?? "player"}: ${def.label}${pm ? " per minute" : ""}`}
                        onClick={e => { e.stopPropagation(); onPick(p.payload.value); }}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onPick(p.payload.value); } }}>
                        <text transform="rotate(-40)" textAnchor="end" fontSize={11} fill={it?.partial ? "hsl(215 20% 65%)" : "hsl(210 40% 92%)"}>
                          {it?.name}{it?.partial ? " *" : ""}{it?.value == null ? " (—)" : ""}
                        </text>
                      </g>
                    );
                  }} />
                <YAxis stroke="hsl(215 20% 65%)" fontSize={11} tickLine={false} width={48} domain={[0, "auto"]} allowDataOverflow={false} />
                <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(97,169,189,0.08)" }}
                  formatter={(v: number, _n: string, item: { payload?: TeamMetricItem }) => {
                    const p = item.payload;
                    return [fmtMetric(metric, v, pm), `${p?.pos ?? "No position"} · ${fmtMin(p?.duration)}${p?.partial ? " · incomplete total, not in average" : ""}`];
                  }}
                  labelFormatter={(k: string) => items.find(i => i.key === k)?.name ?? k} />
                {mean != null && <ReferenceLine y={mean} stroke={C.secondary} strokeWidth={1.5} />}
                <Bar dataKey="bar" radius={[3, 3, 0, 0]} maxBarSize={30} className="cursor-pointer" isAnimationActive={false}>
                  {data.map(d => <Cell key={d.key} fill={d.partial ? C.mutedDark : C.primary} />)}
                  <LabelList dataKey="bar" position="top" fontSize={10} fill="hsl(210 40% 92%)"
                    formatter={(v: number | null) => short(v)} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        Average line = mean of complete player values only{hasPartial ? "; * darker columns are incomplete totals, shown but excluded from the average and total" : ""}.
        {metric === "speed" ? " Each column is that player's highest recorded speed, not divided by minutes; hover for km/h and m/s." : metric === "maxAccel" || metric === "maxDecel" ? " Peak value, never summed." : ""} Missing values show as —. Click a column or name to open that player.
      </p>
    </section>
  );
}
