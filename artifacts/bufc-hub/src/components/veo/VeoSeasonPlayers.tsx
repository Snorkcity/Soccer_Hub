import React, { useState, useMemo } from "react";
import { 
  useGetVeoPlayerSeason, 
  getGetVeoPlayerSeasonQueryKey,
  type VeoSeasonPlayerRow,
  type VeoPlayerIdentity,
  type VeoPlayerTeam,
  type VeoPlayerStableMetrics
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { AlertCircle, CalendarDays, Info, Search, SlidersHorizontal, User, ChevronRight, Hash } from "lucide-react";
import { scopeSeasonPlayers } from "@/lib/veoSeasonMetrics";
import { teamLabel, VeoPlayerTeamBadge } from "./VeoPlayerTeamBadge";

type MetricGroup = "Summary" | "Physical" | "Attacking" | "Possession";
type TeamFilter = "all" | VeoPlayerTeam["side"];

const METRIC_GROUPS: Record<MetricGroup, (keyof VeoPlayerStableMetrics)[]> = {
  "Summary": ["matches", "starts", "minutesPlayed", "distanceMetres", "topSpeedKmh", "goals", "assists"],
  "Physical": ["minutesPlayed", "distanceMetres", "sprints", "hir", "avgSpeedKmh", "topSpeedKmh"],
  "Attacking": ["goals", "assists", "involvements", "shots", "conversion"],
  "Possession": ["passes", "passSuccess", "tackles", "interceptions", "looseRecoveries", "saves"],
};

const METRIC_LABELS: Record<string, string> = {
  matches: "Matches", starts: "Starts", minutesPlayed: "Mins",
  distanceMetres: "Dist (m)", sprints: "Sprints", hir: "HIR",
  topSpeedKmh: "Top Spd (km/h)", avgSpeedKmh: "Avg Spd (km/h)",
  goals: "Goals", assists: "Assists", shots: "Shots", attempts: "Attempts", conversion: "Conv %", involvements: "Involvements",
  passes: "Passes", passesSuccessful: "Passes+", passesUnsuccessful: "Passes-", passSuccess: "Pass %",
  tackles: "Tackles", dribbles: "Dribbles", interceptions: "Interceptions", looseRecoveries: "Recoveries", saves: "Saves",
  corners: "Corners", freeKicks: "Free Kicks", throwIns: "Throw-ins", fouls: "Fouls", penalties: "Penalties", goalKicks: "Goal Kicks"
};

function formatMetric(val: number | null | undefined, key: string, isPer90 = false): string {
  if (val == null) return "-";
  if (key === "distanceMetres") return (val / 1000).toFixed(1) + (isPer90 ? "" : "km");
  if (key === "passSuccess" || key === "conversion") return val.toFixed(1) + "%";
  if (key === "topSpeedKmh" || key === "avgSpeedKmh") return val.toFixed(1);
  return isPer90 && val > 0 && val < 10 && val % 1 !== 0 ? val.toFixed(1) : Math.round(val).toString();
}

function IdentityBadge({ identity, team }: { identity: VeoPlayerIdentity; team: VeoPlayerTeam }) {
  if (identity.identityStatus === "resolved") {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="font-medium text-foreground truncate">
            {identity.hubPlayerName || identity.veoPlayerName}
          </span>
          {identity.jerseyNumber != null && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
              <Hash className="h-2.5 w-2.5" />
              {identity.jerseyNumber}
            </span>
          )}
        </div>
        <VeoPlayerTeamBadge team={team} compact />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="font-medium text-muted-foreground italic truncate">
          {identity.veoPlayerName || `Jersey #${identity.jerseyNumber ?? "?"}`}
        </span>
        <span className="text-[9px] uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-bold shrink-0" title={identity.identityStatus === "ambiguous" ? "Multiple players share this jersey number in Dribl" : "Not matched to a Hub player"}>
          {identity.identityStatus === "ambiguous" ? "Ambiguous" : identity.veoPlayerName ? "Veo lineup" : "Unresolved"}
        </span>
      </div>
      <VeoPlayerTeamBadge team={team} compact />
    </div>
  );
}

export function VeoSeasonPlayers({ leagueId }: { leagueId: number }) {
  const [metricGroup, setMetricGroup] = useState<MetricGroup>("Summary");
  const [mode, setMode] = useState<"totals" | "per90">("totals");
  const [search, setSearch] = useState("");
  const [minMatches, setMinMatches] = useState(1);
  const [opponent, setOpponent] = useState("all");
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedPlayerKey, setSelectedPlayerKey] = useState<string | null>(null);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(false);

  const seasonParams = { leagueId };
  const { data, isLoading, isError, error } = useGetVeoPlayerSeason(seasonParams, {
    query: {
      enabled: leagueId > 0,
      queryKey: getGetVeoPlayerSeasonQueryKey(seasonParams),
    },
  });

  const players = data?.players || [];
  const teamFilteredPlayers = useMemo(
    () => teamFilter === "all"
      ? players
      : players.filter((player) => player.team.side === teamFilter),
    [players, teamFilter],
  );
  
  const scopedPlayers = useMemo(() => {
    return scopeSeasonPlayers(teamFilteredPlayers, { opponent, fromDate, toDate });
  }, [teamFilteredPlayers, opponent, fromDate, toDate]);

  const filteredPlayers = useMemo(() => {
    let p = scopedPlayers;
    if (minMatches > 1) {
      p = p.filter(r => r.matchCount >= minMatches);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      p = p.filter(r => 
        (r.identity.hubPlayerName?.toLowerCase().includes(s)) ||
        (r.identity.veoPlayerName?.toLowerCase().includes(s)) ||
        (r.identity.jerseyNumber?.toString().includes(s)) ||
        teamLabel(r.team).toLowerCase().includes(s)
      );
    }
    
    if (sortField) {
      p = [...p].sort((a, b) => {
        const isRate = sortField === "topSpeedKmh" || sortField === "avgSpeedKmh" || sortField === "passSuccess" || sortField === "conversion";
        const aVal = (mode === "per90" && !isRate) ? a.per90[sortField] : a.totals[sortField as keyof VeoPlayerStableMetrics];
        const bVal = (mode === "per90" && !isRate) ? b.per90[sortField] : b.totals[sortField as keyof VeoPlayerStableMetrics];
        
        const aNum = Number(aVal) || 0;
        const bNum = Number(bVal) || 0;
        
        return sortAsc ? aNum - bNum : bNum - aNum;
      });
    } else {
      // Default sort
      p = [...p].sort((a, b) => (b.totals.matches || 0) - (a.totals.matches || 0));
    }
    
    return p;
  }, [scopedPlayers, minMatches, search, sortField, sortAsc, mode]);

  const maxMatches = Math.max(1, ...scopedPlayers.map(p => p.matchCount));
  const opponents = useMemo(
    () => Array.from(new Set(players.flatMap(p => p.matchBreakdowns.map(m => m.opponent).filter((v): v is string => Boolean(v))))).sort(),
    [players],
  );
  const columns = METRIC_GROUPS[metricGroup];
  const teamCounts = useMemo(
    () => players.reduce<Record<VeoPlayerTeam["side"], number>>(
      (counts, player) => {
        counts[player.team.side]++;
        return counts;
      },
      { own: 0, opponent: 0, unassigned: 0 },
    ),
    [players],
  );
  const selectedPlayer = selectedPlayerKey
    ? filteredPlayers.find((player) => player.identityKey === selectedPlayerKey) ?? null
    : null;
  const selectedMatchBreakdowns = selectedPlayer?.matchBreakdowns.map((match) => ({
    ...match,
    displayOpponent: selectedPlayer.team.side === "opponent"
      ? data?.focusTeamName || "Our team"
      : match.opponent,
  })) ?? [];

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  if (isLoading) {
    return <Card><CardContent className="py-16 text-center text-muted-foreground">Loading player data...</CardContent></Card>;
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-destructive flex flex-col items-center gap-2">
          <AlertCircle className="h-6 w-6" />
          <p className="font-medium">Player analytics could not be loaded.</p>
          <p className="text-xs text-muted-foreground">{error instanceof Error ? error.message : "Please try again."}</p>
        </CardContent>
      </Card>
    );
  }

  if (players.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground flex flex-col items-center">
          <User className="h-8 w-8 mb-3 opacity-20" />
          <p>No player analytics available yet.</p>
          <p className="text-xs mt-1">Make sure Veo matches are synced and players are assigned jerseys.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 p-3 bg-muted/30 rounded-lg border border-border/50">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Player or jersey..." 
                value={search} 
                onChange={e => setSearch(e.target.value)}
                className="pl-9 bg-background"
              />
            </div>
            
            <Select value={metricGroup} onValueChange={(v) => setMetricGroup(v as MetricGroup)}>
              <SelectTrigger className="w-[140px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(METRIC_GROUPS) as MetricGroup[]).map(g => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex rounded-md border border-input overflow-hidden bg-background">
              <button 
                onClick={() => setMode("totals")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === "totals" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Totals
              </button>
              <button 
                onClick={() => setMode("per90")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === "per90" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                Per 90
              </button>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter players by team">
          {([
            ["all", "All players", players.length],
            ["own", data?.focusTeamName || "Our team", teamCounts.own],
            ["opponent", "Opponents", teamCounts.opponent],
            ["unassigned", "Unassigned", teamCounts.unassigned],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTeamFilter(value)}
              aria-pressed={teamFilter === value}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                teamFilter === value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              }`}
            >
              {label} <span className="tabular-nums opacity-75">{count}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
          <Select value={opponent} onValueChange={setOpponent}>
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="All opponents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All opponents</SelectItem>
              {opponents.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <CalendarDays className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input type="date" aria-label="From date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="pl-9 bg-background" />
          </div>
          <div className="relative">
            <CalendarDays className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input type="date" aria-label="To date" value={toDate} onChange={e => setToDate(e.target.value)} className="pl-9 bg-background" />
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm px-1">
          <div className="flex items-center gap-2 whitespace-nowrap text-muted-foreground">
            <SlidersHorizontal className="h-4 w-4" />
            <span>Min matches: {minMatches}</span>
          </div>
          <Slider 
            value={[minMatches]} 
            onValueChange={(v) => setMinMatches(v[0])} 
            max={maxMatches} 
            min={1} 
            step={1}
            className="max-w-[200px]"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium">
          Player coverage: {data?.coverageCount ?? 0} of {data?.totalCount ?? 0} synced recordings
        </span>
        {(data?.coverageCount ?? 0) < (data?.totalCount ?? 0) && (
          <span className="text-amber-600 dark:text-amber-400">Season totals only include recordings with available Analytics 2 data.</span>
        )}
      </div>

      <div className="flex items-center gap-2 p-2.5 bg-muted/50 rounded-md text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 text-primary" />
        Camera-derived estimate (Veo Analytics 2) — not wearable GPS. Team badges are assigned before aggregation; unassigned rows never enter a team total.
      </div>

      <div className="rounded-md border overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <thead className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3 sticky left-0 z-10 bg-muted/95 backdrop-blur shadow-[1px_0_0_hsl(var(--border))] font-semibold text-left">Player</th>
                {columns.map(key => (
                  <th 
                    key={key} 
                    className="py-2.5 px-3 font-semibold text-right cursor-pointer hover:text-foreground transition-colors group select-none"
                    onClick={() => handleSort(key)}
                  >
                    <div className="flex items-center justify-end gap-1">
                      {METRIC_LABELS[key] || key}
                      <span className={`w-3 inline-block text-[10px] ${sortField === key ? "opacity-100 text-primary" : "opacity-0 group-hover:opacity-50"}`}>
                        {sortField === key ? (sortAsc ? "▲" : "▼") : "▼"}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredPlayers.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 1} className="py-8 text-center text-muted-foreground bg-background">
                    No players match the filters.
                  </td>
                </tr>
              ) : (
                filteredPlayers.map((row) => (
                  <tr 
                    key={row.identityKey} 
                    className="hover:bg-muted/30 transition-colors cursor-pointer group bg-background"
                    onClick={() => setSelectedPlayerKey(row.identityKey)}
                  >
                    <td className="py-2 px-3 sticky left-0 z-10 bg-background group-hover:bg-muted/30 transition-colors shadow-[1px_0_0_hsl(var(--border))]">
                      <div className="flex items-center justify-between gap-4">
                        <IdentityBadge identity={row.identity} team={row.team} />
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </td>
                    {columns.map(key => {
                      // Some physical metrics like topSpeed don't make sense as per90, show them as-is
                      const isRateMetric = key === "topSpeedKmh" || key === "avgSpeedKmh" || key === "passSuccess" || key === "conversion";
                      const val = (mode === "per90" && !isRateMetric) 
                        ? row.per90[key] 
                        : row.totals[key as keyof VeoPlayerStableMetrics];
                      
                      return (
                        <td key={key} className="py-2 px-3 text-right font-mono tabular-nums text-[13px]">
                          {formatMetric(val as number | null, key, mode === "per90" && !isRateMetric)}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={!!selectedPlayer} onOpenChange={(o) => !o && setSelectedPlayerKey(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {selectedPlayer && (
            <>
              <SheetHeader className="mb-6">
                <SheetTitle className="flex items-center gap-2">
                  {selectedPlayer.identity.hubPlayerName || selectedPlayer.identity.veoPlayerName || "Unknown Player"}
                  {selectedPlayer.identity.jerseyNumber != null && (
                    <span className="text-sm font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      #{selectedPlayer.identity.jerseyNumber}
                    </span>
                  )}
                </SheetTitle>
                <SheetDescription>
                  <span className="flex flex-col items-start gap-2">
                    <VeoPlayerTeamBadge team={selectedPlayer.team} />
                    <span>Season Trends • {selectedPlayer.matchCount} Matches • {selectedPlayer.totals.minutesPlayed || 0} Minutes</span>
                  </span>
                </SheetDescription>
              </SheetHeader>
              
              <div className="space-y-6">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Distance", val: formatMetric(selectedPlayer.totals.distanceMetres, "distanceMetres") },
                    { label: "Top Speed", val: formatMetric(selectedPlayer.totals.topSpeedKmh, "topSpeedKmh") + " km/h" },
                    { label: "Sprints", val: formatMetric(selectedPlayer.totals.sprints, "sprints") },
                    { label: "Goals", val: formatMetric(selectedPlayer.totals.goals, "goals") },
                  ].map(stat => (
                    <div key={stat.label} className="bg-muted/40 p-3 rounded-md border text-center">
                      <div className="text-xs text-muted-foreground mb-1">{stat.label}</div>
                      <div className="text-lg font-semibold tabular-nums">{stat.val}</div>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center justify-between">
                    Match-to-Match Distance (km)
                  </h4>
                  <div className="h-[200px] border rounded-md bg-card p-3">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={selectedMatchBreakdowns.filter(m => m.metrics.distanceMetres != null)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis 
                          dataKey="displayOpponent"
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                          tickFormatter={(val) => val?.substring(0, 8) + (val?.length > 8 ? "..." : "") || "Opp"}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis 
                          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                          tickFormatter={(val) => (val / 1000).toFixed(1)}
                          axisLine={false}
                          tickLine={false}
                          width={30}
                        />
                        <Tooltip 
                          cursor={{ fill: "hsl(var(--muted))" }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const data = payload[0].payload;
                            return (
                              <div className="bg-popover border shadow-md rounded p-2 text-xs">
                                <div className="font-semibold mb-1">{data.displayOpponent || "Unknown Opponent"}</div>
                                <div className="text-muted-foreground mb-2">{data.startsAt ? new Date(data.startsAt).toLocaleDateString() : ""}</div>
                                <div>Distance: {((data.metrics.distanceMetres || 0) / 1000).toFixed(2)} km</div>
                                <div>Minutes: {data.metrics.minutesPlayed || 0}</div>
                              </div>
                            );
                          }}
                        />
                        <Bar 
                          dataKey="metrics.distanceMetres" 
                          fill="hsl(var(--primary))" 
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">Match Log</h4>
                  <div className="border rounded-md divide-y overflow-hidden text-sm">
                    {selectedMatchBreakdowns.map((m, i) => (
                      <div key={i} className="flex items-center justify-between p-2.5 bg-card hover:bg-muted/30 transition-colors">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{m.displayOpponent || m.title || "Match"}</div>
                          <div className="text-xs text-muted-foreground">{m.startsAt ? new Date(m.startsAt).toLocaleDateString() : ""}</div>
                        </div>
                        <div className="text-right shrink-0 ml-4">
                          <div className="tabular-nums">{m.metrics.minutesPlayed || 0} mins</div>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {m.metrics.distanceMetres ? (m.metrics.distanceMetres / 1000).toFixed(1) + " km" : "-"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
