// Veo video stats inside the Football Match Report — shown only when this Hub
// match has a linked Veo recording (see the Match links card on Veo Insights).
// Deliberately small: shots for/against + the attacking-momentum strip. The
// full breakdown (shot map, event compare) lives on the Veo Insights tab.
import { useGetVeoReportStats, getGetVeoReportStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Video } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

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
}

export function VeoReportPanel({ leagueId, matchRowId, opponent }: Props) {
  const params = { leagueId, matchRowId };
  const { data } = useGetVeoReportStats(params, {
    query: { queryKey: getGetVeoReportStatsQueryKey(params) },
  });

  // No linked Veo recording (or still loading) → render nothing at all.
  if (!data?.linked || !data.shots) return null;
  const { shots } = data;
  const momentum = data.momentum ?? [];
  const total = shots.us + shots.them;
  const usPct = total > 0 ? Math.round((shots.us / total) * 100) : 50;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Video className="h-4 w-4 text-violet-500" />Video stats (Veo)
        </CardTitle>
        <CardDescription className="text-xs">
          From the linked Veo recording — shots include goals; momentum is event-weighted field tilt in {BIN_MIN}-min blocks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Shots for/against with a share bar */}
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

        {/* Momentum strip */}
        {momentum.length > 0 && (
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={momentum} stackOffset="sign" margin={{ left: -22, right: 6, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="min" {...AXIS} tickFormatter={(m) => `${m}'`} />
              <YAxis {...AXIS} />
              <Tooltip contentStyle={TOOLTIP_BOX} cursor={{ fill: "hsl(var(--muted)/0.3)" }}
                formatter={(v: number, n) => [Math.abs(v).toFixed(1), n]}
                labelFormatter={(m) => `${m}–${Number(m) + BIN_MIN} min`} />
              <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" />
              <Bar dataKey="us" name="Belconnen" fill={C_US} stackId="m" />
              <Bar dataKey="them" name={opponent} fill={C_THEM} stackId="m" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
