import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, CalendarArrowUp } from "lucide-react";
import { C, canRate, fmtDate, fmtMetric, fmtMin, fmtNum, metricDef, metricUnit, type PlayerHistorySort, type PlayerMetricHistoryItem } from "./shared";
import { tooltipStyle } from "./ui";

interface Props {
  metric: string; items: PlayerMetricHistoryItem[]; pm: boolean;
  playerName: string; periodLabel: string; currentKey: string | null;
  sort: PlayerHistorySort; onSort: (s: PlayerHistorySort) => void; onRate: (perMinute: boolean) => void;
  onPick: (sessionKey: string) => void;
}
const SORTS: { id: PlayerHistorySort; label: string; Icon: typeof CalendarArrowUp }[] = [
  { id: "date", label: "Date order, oldest first", Icon: CalendarArrowUp },
  { id: "highest", label: "Highest first", Icon: ArrowDownWideNarrow },
  { id: "lowest", label: "Lowest first", Icon: ArrowUpNarrowWide },
];
const COL = 52;
const PEAK = ["speed", "maxAccel", "maxDecel"];

/** One column per tracked session for one metric; value sorts reorder columns and are labelled as rankings, not trends. */
export function PlayerMetricHistoryChart({ metric, items, pm, playerName, periodLabel, currentKey, sort, onSort, onRate, onPick }: Props) {
  const def = metricDef(metric);
  const unit = metricUnit(metric, pm);
  const slug = metric.toLowerCase();
  const rateable = canRate(metric);
  const short = (v: number | null | undefined) => v == null ? "—" : metric === "speed" ? v.toFixed(1) : fmtNum(v, Math.abs(v) >= 100 ? 0 : pm || Math.abs(v) < 10 ? 1 : 0);
  const data = items.map(i => ({ ...i, bar: i.value }));
  const recorded = items.filter(i => i.value != null);
  const zeros = recorded.filter(i => i.value === 0).length;
  const hasPartial = items.some(i => i.partial);
  const seg = (on: boolean) => `inline-flex min-h-8 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`;
  const best = recorded.length ? Math.max(...recorded.map(i => i.value!)) : null;
  const byKey = new Map(items.map(i => [i.key, i]));

  return (
    <section data-testid={`chart-player-metric-${slug}`} className="rounded-xl border border-card-border bg-card/80 p-4 sm:p-5">
      <header className="mb-3 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary/80">{playerName} · {periodLabel}</p>
            <h3 className="text-lg font-semibold tracking-tight">{def.label} <span className="text-sm font-normal text-muted-foreground">({unit})</span></h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <div className="inline-flex rounded-md border border-input p-0.5" role="group" aria-label={`Sort ${def.label}`}>
              {SORTS.map(o => <button key={o.id} type="button" aria-pressed={sort === o.id} title={o.label} aria-label={o.label}
                onClick={() => onSort(o.id)} className={seg(sort === o.id)} data-testid={`button-player-sort-${slug}-${o.id}`}>
                <o.Icon className="h-3.5 w-3.5" />{o.id === "date" && <span>Date</span>}</button>)}
            </div>
            <div className="inline-flex rounded-md border border-input p-0.5" role="group" aria-label={`${def.label} totals or per minute`}
              title={rateable ? undefined : "Peak or participation value; a per-minute rate would not be meaningful"}>
              <button type="button" aria-pressed={!pm} onClick={() => onRate(false)} className={seg(!pm)} data-testid={`button-player-rate-${slug}-total`}>Total</button>
              <button type="button" aria-pressed={pm} disabled={!rateable} onClick={() => onRate(true)} className={seg(pm)} data-testid={`button-player-rate-${slug}-pm`}>/min</button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
          <span data-testid={`text-player-recorded-${slug}`}>{recorded.length}/{items.length} sessions with a value</span>
          {best != null && <span className="text-muted-foreground">Highest {fmtMetric(metric, best, pm)}</span>}
          <span className={sort === "date" ? "text-muted-foreground" : "text-secondary"}>{sort === "date" ? "Oldest left, newest right" : `Ranked ${sort === "highest" ? "highest" : "lowest"} first, not a time trend`}</span>
          {!rateable && <span className="text-muted-foreground">Not a rate metric</span>}
        </div>
      </header>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{playerName} has no tracked sessions in this season.</p>
      ) : (
        <div className="overflow-x-auto overscroll-x-contain">
          <div style={{ minWidth: items.length * COL + 56, height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 4 }}
                onClick={(e: { activePayload?: { payload: PlayerMetricHistoryItem }[] } | null) => { const k = e?.activePayload?.[0]?.payload.key; if (k) onPick(k); }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
                <XAxis dataKey="key" interval={0} height={70} tickLine={false} stroke="hsl(215 20% 65%)"
                  tick={(p: { x: number; y: number; payload: { value: string } }) => {
                    const it = byKey.get(p.payload.value);
                    const cur = it?.key === currentKey;
                    return (
                      <g transform={`translate(${p.x},${p.y + 6})`} className="cursor-pointer outline-none [&:focus-visible>text]:underline" role="button" tabIndex={0}
                        aria-label={`Open session ${it ? fmtDate(it.date) : ""}: ${def.label} ${fmtMetric(metric, it?.value, pm)}${it?.partial ? ", partial" : ""}`}
                        onClick={e => { e.stopPropagation(); onPick(p.payload.value); }}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onPick(p.payload.value); } }}>
                        <text transform="rotate(-35)" textAnchor="end" fontSize={11} fontWeight={cur ? 700 : 400}
                          fill={cur ? C.secondary : it?.partial ? "hsl(215 20% 65%)" : "hsl(210 40% 92%)"}>
                          {it ? fmtDate(it.date) : ""}{it?.partial ? " *" : ""}{it?.value == null ? " (—)" : ""}
                        </text>
                      </g>
                    );
                  }} />
                <YAxis stroke="hsl(215 20% 65%)" fontSize={11} tickLine={false} width={48} domain={[0, "auto"]} />
                <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(97,169,189,0.08)" }}
                  formatter={(v: number, _n: string, item: { payload?: PlayerMetricHistoryItem }) => {
                    const p = item.payload;
                    return [fmtMetric(metric, v, pm), `${fmtMin(p?.duration)} · ${p?.parts ?? 0}/5 parts${p?.partial ? " · partial" : ""}`];
                  }}
                  labelFormatter={(k: string) => { const it = byKey.get(k); return it ? `${fmtDate(it.date)} · ${it.title || "Training"}` : k; }} />
                <Bar dataKey="bar" radius={[3, 3, 0, 0]} maxBarSize={34} className="cursor-pointer" isAnimationActive={false}>
                  {data.map(d => <Cell key={d.key} fill={d.partial ? C.mutedDark : d.key === currentKey ? C.secondary : C.primary} />)}
                  <LabelList dataKey="bar" position="top" fontSize={10} fill="hsl(210 40% 92%)" formatter={(v: number | null) => short(v)} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {items.length === 1 ? "One tracked session only, no history to compare yet. " : ""}
        Missing values show as —, no column{zeros ? "; a recorded 0 is a real zero" : ""}.
        {hasPartial ? " * marks an incomplete total or missing metric reading; partial values use darker columns." : ""}
        {PEAK.includes(metric) ? " Peak value, never summed." : ""} Yellow marks the session selected above. Click a column or press Enter on a date to open its details below the charts.
      </p>
    </section>
  );
}
