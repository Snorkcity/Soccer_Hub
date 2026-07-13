import React, { useState, useMemo } from "react";
import { useListAthleticTests, useListTeams, getListAthleticTestsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

const METRICS = [
  { id: "verticalStart", label: "Vertical Start" },
  { id: "verticalM", label: "Vertical Max" },
  { id: "horizontalM", label: "Horizontal (m)" },
  { id: "balsomS", label: "Balsom Agility (s)" },
  { id: "split010", label: "0-10m Split (s)" },
  { id: "total30m", label: "Total 30m (s)" },
];

const POS_COLORS: Record<string, string> = {
  "GK": "hsl(var(--chart-1))", // Blue
  "Defender": "hsl(var(--chart-2))", // Orange/Amber
  "Midfielder": "hsl(var(--chart-3))", // Green
  "Forward": "hsl(var(--chart-5))", // Purple
};

function getPosGroup(pos: string | null | undefined) {
  if (!pos) return "Midfielder";
  if (["GK"].includes(pos)) return "GK";
  if (["RB", "LB", "CB", "RCB", "LCB"].includes(pos)) return "Defender";
  if (["DM", "CM", "RM", "LM", "CAM"].includes(pos)) return "Midfielder";
  return "Forward";
}

export default function Testing() {
  const { data: teams } = useListTeams();
  const [selectedTeamId, setSelectedTeamId] = useState<number | "">("");
  const [selectedYear, setSelectedYear] = useState("2026");
  const [selectedMetric, setSelectedMetric] = useState("total30m");

  React.useEffect(() => {
    if (teams?.length && selectedTeamId === "") setSelectedTeamId(teams[0].id);
  }, [teams, selectedTeamId]);

  const testsParams = { teamId: selectedTeamId as number, year: selectedYear };
  const { data: tests } = useListAthleticTests(
    testsParams,
    { query: { enabled: !!selectedTeamId && !!selectedYear, queryKey: getListAthleticTestsQueryKey(testsParams) } }
  );

  const chartData = useMemo(() => {
    if (!tests) return [];
    
    // Sort logic depends on metric type. Time (s) -> lower is better. Distance -> higher is better.
    const isTime = ["balsomS", "split010", "split1020", "split2030", "total30m"].includes(selectedMetric);
    
    return [...tests]
      .filter(t => t[selectedMetric as keyof typeof t] != null)
      .sort((a, b) => {
        const valA = a[selectedMetric as keyof typeof a] as number;
        const valB = b[selectedMetric as keyof typeof b] as number;
        return isTime ? valA - valB : valB - valA; // Ascending for time, Descending for height/dist
      })
      .map(t => ({
        name: t.playerName.split(' ').map(n => n[0]).join(''), // Initials
        fullName: t.playerName,
        value: t[selectedMetric as keyof typeof t] as number,
        posGroup: getPosGroup(t.position)
      }));
  }, [tests, selectedMetric]);

  const avgValue = useMemo(() => {
    if (!chartData.length) return 0;
    return chartData.reduce((acc, curr) => acc + curr.value, 0) / chartData.length;
  }, [chartData]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Athletic Testing</h1>
        
        <div className="flex flex-col sm:flex-row gap-2">
          {teams && (
            <Select value={selectedTeamId.toString()} onValueChange={(v) => setSelectedTeamId(Number(v))}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select Team" />
              </SelectTrigger>
              <SelectContent>
                {teams.map(t => <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Year" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2025">2025</SelectItem>
              <SelectItem value="2026">2026</SelectItem>
            </SelectContent>
          </Select>
          <Select value={selectedMetric} onValueChange={setSelectedMetric}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select Metric" />
            </SelectTrigger>
            <SelectContent>
              {METRICS.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Squad Distribution - {METRICS.find(m => m.id === selectedMetric)?.label}</CardTitle>
        </CardHeader>
        <CardContent className="h-[500px]">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis 
                  dataKey="name" 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={10} 
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                  tickMargin={10}
                />
                <YAxis 
                  domain={['auto', 'auto']} 
                  stroke="hsl(var(--muted-foreground))" 
                  fontSize={12} 
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                  labelFormatter={(v, payload) => payload?.[0]?.payload?.fullName || v}
                  formatter={(val: number) => [val.toFixed(2), "Result"]}
                />
                <ReferenceLine y={avgValue} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={POS_COLORS[entry.posGroup] || "hsl(var(--primary))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              No testing data for this period
            </div>
          )}
        </CardContent>
      </Card>
      
      <div className="flex gap-4 items-center justify-center text-sm text-muted-foreground flex-wrap">
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-chart-1"></div>GK</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-chart-2"></div>Defender</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-chart-3"></div>Midfielder</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-chart-5"></div>Forward</div>
        <div className="flex items-center gap-1 ml-4 border-l border-border pl-4">
          <div className="w-4 border-t border-dashed border-muted-foreground"></div>Squad Average
        </div>
      </div>
    </div>
  );
}
