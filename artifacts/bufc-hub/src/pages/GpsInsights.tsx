import React, { useState } from "react";
import { 
  useListTeams,
  useListPlayers,
  useListGpsSessions,
  useGetGpsLoadSummary,
  getListPlayersQueryKey,
  getGetGpsLoadSummaryQueryKey,
  getListGpsSessionsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

export default function GpsInsights() {
  const { data: teams } = useListTeams();
  const [selectedTeamId, setSelectedTeamId] = useState<number | "">("");
  const [selectedYear, setSelectedYear] = useState("2024");
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | "">("");

  React.useEffect(() => {
    if (teams?.length && selectedTeamId === "") setSelectedTeamId(teams[0].id);
  }, [teams, selectedTeamId]);

  const tId = selectedTeamId as number;
  const pId = selectedPlayerId as number;
  const isReady = !!tId && !!selectedYear;

  const playersParams = { teamId: tId };
  const { data: players } = useListPlayers(playersParams, { query: { enabled: !!tId, queryKey: getListPlayersQueryKey(playersParams) } });
  
  React.useEffect(() => {
    if (players?.length && selectedPlayerId === "") setSelectedPlayerId(players[0].id);
  }, [players, selectedPlayerId]);

  const gpsLoadParams = { teamId: tId, year: selectedYear };
  const { data: teamSummary } = useGetGpsLoadSummary(
    gpsLoadParams,
    { query: { enabled: isReady, queryKey: getGetGpsLoadSummaryQueryKey(gpsLoadParams) } }
  );

  const gpsSessionParams = { playerId: pId, year: selectedYear };
  const { data: playerSessions } = useListGpsSessions(
    gpsSessionParams,
    { query: { enabled: !!pId && !!selectedYear, queryKey: getListGpsSessionsQueryKey(gpsSessionParams) } }
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">GPS Insights</h1>
        
        <div className="flex flex-col sm:flex-row gap-2">
          {teams && (
            <Select value={selectedTeamId.toString()} onValueChange={(v) => { setSelectedTeamId(Number(v)); setSelectedPlayerId(""); }}>
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
              <SelectItem value="2024">2024</SelectItem>
              <SelectItem value="2025">2025</SelectItem>
              <SelectItem value="2026">2026</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="player" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
          <TabsTrigger value="player">Player GPS</TabsTrigger>
          <TabsTrigger value="team">Team Overview</TabsTrigger>
        </TabsList>
        
        <TabsContent value="player" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Individual Load Monitoring</h2>
            {players && (
              <Select value={selectedPlayerId.toString()} onValueChange={(v) => setSelectedPlayerId(Number(v))}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Select Player" />
                </SelectTrigger>
                <SelectContent>
                  {players.map(p => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard 
              title="Distance & Sprint" 
              data={playerSessions || []} 
              xKey="sessionDate" 
              bars={[
                { key: "distanceKm", name: "Distance (km)", color: "var(--chart-1)" },
                { key: "sprintDistanceM", name: "Sprint (m)", color: "var(--chart-2)", yAxisId: "right" }
              ]} 
              rightAxis
            />
            <ChartCard 
              title="Player Load & Top Speed" 
              data={playerSessions || []} 
              xKey="sessionDate" 
              bars={[
                { key: "playerLoad", name: "Player Load", color: "var(--chart-3)" },
                { key: "topSpeedMs", name: "Top Speed (m/s)", color: "var(--chart-5)", yAxisId: "right" }
              ]}
              rightAxis
            />
          </div>
        </TabsContent>
        
        <TabsContent value="team" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Team Aggregates</CardTitle>
              <CardDescription>Average session metrics per player</CardDescription>
            </CardHeader>
            <CardContent className="h-[400px]">
               {/* For the mockup, we map the single teamSummary to array if needed, or wait for a true team members summary endpoint. Let's just show a placeholder if we lack list endpoint for all players' load. */}
               <div className="flex h-full items-center justify-center text-muted-foreground flex-col gap-2">
                 <p>Team comparison charting requires full squad data.</p>
                 <p className="text-xs">Select Player GPS tab for detailed individual charts.</p>
               </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ChartCard({ title, data, xKey, bars, rightAxis = false }: any) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-[300px]">
        {data && data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: rightAxis ? 30 : 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey={xKey} stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(val) => val ? val.split('T')[0].slice(5) : ''} />
              <YAxis yAxisId="left" stroke="hsl(var(--muted-foreground))" fontSize={10} />
              {rightAxis && <YAxis yAxisId="right" orientation="right" stroke="hsl(var(--muted-foreground))" fontSize={10} />}
              <Tooltip 
                contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                labelFormatter={(val) => val ? val.split('T')[0] : val}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {bars.map((bar: any) => (
                <Bar 
                  key={bar.key} 
                  yAxisId={bar.yAxisId || "left"} 
                  dataKey={bar.key} 
                  name={bar.name} 
                  fill={`hsl(${bar.color})`} 
                  radius={[2, 2, 0, 0]} 
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">No data available</div>
        )}
      </CardContent>
    </Card>
  );
}
