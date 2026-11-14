import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { C } from "./shared";
import { axisProps, tooltipStyle } from "./ui";

export interface PartBarDatum { key: string; name: string; value: number | null; meta: string }

/** Horizontal bars in the table's current sort order; click a bar to open the player. */
export function PartComparisonChart({ data, fmt, onPick }: { data: PartBarDatum[]; fmt: (v: number | null) => string; onPick: (key: string) => void }) {
  const rows = data.filter(d => d.value != null);
  return (
    <div style={{ height: Math.max(180, rows.length * 26 + 40) }} data-testid="chart-part-player-bars">
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
          onClick={(e: { activePayload?: { payload: PartBarDatum }[] } | null) => { const k = e?.activePayload?.[0]?.payload.key; if (k) onPick(k); }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" horizontal={false} />
          <XAxis type="number" {...axisProps} />
          <YAxis type="category" dataKey="name" {...axisProps} width={110} interval={0} tickFormatter={(n: string) => n.length > 16 ? `${n.slice(0, 15)}…` : n} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(97,169,189,0.08)" }}
            formatter={(v: number, _n: string, item: { payload?: PartBarDatum }) => [fmt(v), item.payload?.meta ?? ""]} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} className="cursor-pointer">
            {rows.map(r => <Cell key={r.key} fill={C.primary} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
