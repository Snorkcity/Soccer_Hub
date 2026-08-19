import React, { useState, useMemo } from "react";
import { 
  useGetVeoPlayerMatch, 
  getGetVeoPlayerMatchQueryKey,
  type VeoPlayerRecord,
  type VeoPlayerIdentity,
  type VeoPlayerTeam,
  type VeoPlayerStableMetrics,
  type VeoEventTimelineEntry
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { AlertCircle, Info, Search, User, ChevronRight, Hash, Activity, Clock } from "lucide-react";
import { teamLabel, VeoPlayerTeamBadge } from "./VeoPlayerTeamBadge";
import { compareVeoPlayerTeamSide } from "@/lib/veoPlayerOrdering";

type MetricGroup = "Summary" | "Physical" | "Attacking" | "Possession";
type TeamFilter = "all" | VeoPlayerTeam["side"];

const METRIC_GROUPS: Record<MetricGroup, (keyof VeoPlayerStableMetrics)[]> = {
  "Summary": ["minutesPlayed", "distanceMetres", "topSpeedKmh", "goals", "assists", "passes"],
  "Physical": ["minutesPlayed", "distanceMetres", "sprints", "hir", "avgSpeedKmh", "topSpeedKmh"],
  "Attacking": ["goals", "assists", "involvements", "shots", "conversion"],
  "Possession": ["passes", "passSuccess", "tackles", "interceptions", "looseRecoveries", "saves"],
};

const METRIC_LABELS: Record<string, string> = {
  minutesPlayed: "Mins", distanceMetres: "Dist (m)", sprints: "Sprints", hir: "HIR",
  topSpeedKmh: "Top Spd (km/h)", avgSpeedKmh: "Avg Spd (km/h)",
  goals: "Goals", assists: "Assists", shots: "Shots", attempts: "Attempts", conversion: "Conv %", involvements: "Involvements",
  passes: "Passes", passesSuccessful: "Passes+", passesUnsuccessful: "Passes-", passSuccess: "Pass %",
  tackles: "Tackles", dribbles: "Dribbles", interceptions: "Interceptions", looseRecoveries: "Recoveries", saves: "Saves",
  corners: "Corners", freeKicks: "Free Kicks", throwIns: "Throw-ins", fouls: "Fouls", penalties: "Penalties", goalKicks: "Goal Kicks"
};

function formatMetric(val: number | null | undefined, key: string): string {
  if (val == null) return "-";
  if (key === "distanceMetres") return (val / 1000).toFixed(1) + "km";
  if (key === "passSuccess" || key === "conversion") return val.toFixed(1) + "%";
  if (key === "topSpeedKmh" || key === "avgSpeedKmh") return val.toFixed(1);
  return val.toString();
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
        <span className="text-[9px] uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-bold shrink-0">
          {identity.identityStatus === "ambiguous" ? "Ambiguous" : identity.veoPlayerName ? "Veo lineup" : "Unresolved"}
        </span>
      </div>
      <VeoPlayerTeamBadge team={team} compact />
    </div>
  );
}

// Map technical Veo event types to friendly labels
const EVENT_LABELS: Record<string, string> = {
  FootballGoal: "Goal", FootballShot: "Shot", FootballCornerKick: "Corner",
  FootballFreeKick: "Free Kick", FootballPenaltyKick: "Penalty", FootballThrowIn: "Throw-in",
  FootballFoul: "Foul", FootballGoalKick: "Goal Kick"
};

function EventTimeline({ events }: { events: VeoEventTimelineEntry[] }) {
  const [filter, setFilter] = useState<string>("All");

  if (!events || events.length === 0) {
    return <div className="text-center text-sm text-muted-foreground py-8 border rounded-md border-dashed">No significant events logged for this player in this match.</div>;
  }
  
  // Sort events by video time or period time
  const sorted = [...events].sort((a, b) => {
    if (a.videoTimeMs && b.videoTimeMs) return a.videoTimeMs - b.videoTimeMs;
    return (a.periodTimeMs || 0) - (b.periodTimeMs || 0);
  });

  const filtered = filter === "All" ? sorted : sorted.filter(e => {
    const label = EVENT_LABELS[e.eventType] || e.eventType.replace(/^Football/, "");
    return label === filter;
  });

  const eventTypes = Array.from(new Set(sorted.map(e => EVENT_LABELS[e.eventType] || e.eventType.replace(/^Football/, ""))));

  return (
    <div className="space-y-4">
      {eventTypes.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          <button 
            onClick={() => setFilter("All")}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${filter === "All" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
          >
            All
          </button>
          {eventTypes.map(type => (
            <button 
              key={type}
              onClick={() => setFilter(type)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${filter === type ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {type}
            </button>
          ))}
        </div>
      )}
      
      {filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4">No events of this type.</div>
      ) : (
        <div className="relative border-l-2 border-muted ml-3 space-y-4 pb-2">
          {filtered.map((ev, i) => {
            const min = ev.periodTimeMs ? Math.floor(ev.periodTimeMs / 60000) : "?";
            const label = EVENT_LABELS[ev.eventType] || ev.eventType.replace(/^Football/, "");
            const isOwn = ev.isOwn;
            
            return (
              <div key={i} className="relative pl-5">
                <div className={`absolute -left-[5px] top-1 h-2 w-2 rounded-full border-2 border-background ${
                  label === "Goal" ? "bg-green-500 scale-125" : 
                  label === "Shot" ? "bg-primary" : 
                  "bg-muted-foreground"
                }`} />
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground flex items-center gap-2">
                    {label}
                    {ev.outcome && <span className="text-[10px] text-muted-foreground font-normal bg-muted px-1.5 rounded">{ev.outcome}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Period {ev.periodId || 1} • {min}'
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function VeoMatchPlayers({ leagueId, veoId }: { leagueId: number, veoId: number }) {
  const [metricGroup, setMetricGroup] = useState<MetricGroup>("Summary");
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("all");
  const [teamFilter, setTeamFilter] = useState<TeamFilter>("all");
  const [selectedPlayer, setSelectedPlayer] = useState<VeoPlayerRecord | null>(null);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(false);

  const matchParams = { leagueId, veoId };
  const { data, isLoading, isError, error } = useGetVeoPlayerMatch(matchParams, {
    query: {
      enabled: leagueId > 0 && veoId > 0,
      queryKey: getGetVeoPlayerMatchQueryKey(matchParams),
    },
  });

  const players = data?.players || [];
  
  const filteredPlayers = useMemo(() => {
    let p = players;
    if (teamFilter !== "all") {
      p = p.filter(r => r.team.side === teamFilter);
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
    if (eventType !== "all") {
      p = p.filter(r => r.eventTimeline.some(event => event.eventType === eventType));
    }
    
    p = [...p].sort((a, b) => {
      const sideDiff = compareVeoPlayerTeamSide(a, b);
      if (sideDiff !== 0) return sideDiff;
      if (sortField) {
        const aNum = Number(a.metrics[sortField as keyof VeoPlayerStableMetrics]) || 0;
        const bNum = Number(b.metrics[sortField as keyof VeoPlayerStableMetrics]) || 0;
        return sortAsc ? aNum - bNum : bNum - aNum;
      }
      return (b.metrics.minutesPlayed || 0) - (a.metrics.minutesPlayed || 0);
    });
    
    return p;
  }, [players, search, eventType, sortField, sortAsc, teamFilter]);

  const columns = METRIC_GROUPS[metricGroup];
  const eventTypes = useMemo(
    () => Array.from(new Set(players.flatMap(p => p.eventTimeline.map(e => e.eventType)))).sort(),
    [players],
  );
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

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  if (isLoading) {
    return <Card><CardContent className="py-16 text-center text-muted-foreground">Loading match player data...</CardContent></Card>;
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-destructive flex flex-col items-center gap-2">
          <AlertCircle className="h-6 w-6" />
          <p className="font-medium">Match player analytics could not be loaded.</p>
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
          <p>No player breakdown available for this match.</p>
          <p className="text-xs mt-1">
            {data?.status === "pending" ? "Analytics are still processing on Veo." :
             data?.status === "unavailable" ? "Player analytics were not generated for this match." :
             data?.status === "error" ? "There was an error pulling player analytics from Veo." :
             "Analytics might still be processing on Veo, or players haven't been tagged."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {data?.status === "partial" && (
        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-sm text-amber-600 dark:text-amber-400">
          <Activity className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <strong>Partial data available.</strong> Not all player analytics metrics could be loaded for this match.
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-muted/30 rounded-lg border border-border/50">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Find player or jersey..." 
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

          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="w-[150px] bg-background">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              {eventTypes.map(type => (
                <SelectItem key={type} value={type}>{EVENT_LABELS[type] || type.replace(/^Football/, "")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter players by team">
        {([
          ["all", "All players", players.length],
          ["own", data?.focusTeamName || "Our team", teamCounts.own],
          ["opponent", data?.opponentTeamName || "Opponent", teamCounts.opponent],
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

      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {[
          ["Player summary", data?.coverage.hasCrossMatch],
          ["Physical", data?.coverage.hasPhysicalMetrics],
          ["Events", data?.coverage.hasMesEvents],
          ["Shirt tracking", data?.coverage.hasJerseyNumbers],
        ].map(([label, ready]) => (
          <span key={String(label)} className={`rounded-full border px-2 py-1 ${ready ? "bg-primary/10 text-primary border-primary/20" : "bg-muted text-muted-foreground"}`}>
            {label}: {ready ? "available" : "not available"}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 p-2.5 bg-muted/50 rounded-md text-xs text-muted-foreground">
        <Info className="h-4 w-4 shrink-0 text-primary" />
        Camera-derived estimate (Veo Analytics 2) — not wearable GPS. Unassigned rows stay separate because no safe team match was available.
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
                    onClick={() => setSelectedPlayer(row)}
                  >
                    <td className="py-2 px-3 sticky left-0 z-10 bg-background group-hover:bg-muted/30 transition-colors shadow-[1px_0_0_hsl(var(--border))]">
                      <div className="flex items-center justify-between gap-4">
                        <IdentityBadge identity={row.identity} team={row.team} />
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </td>
                    {columns.map(key => (
                      <td key={key} className="py-2 px-3 text-right font-mono tabular-nums text-[13px]">
                        {formatMetric(row.metrics[key as keyof VeoPlayerStableMetrics] as number | null, key)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={!!selectedPlayer} onOpenChange={(o) => !o && setSelectedPlayer(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
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
                    <span>Match Performance</span>
                  </span>
                </SheetDescription>
              </SheetHeader>
              
              <div className="space-y-8">
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4 text-primary" /> Key Metrics
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Minutes", val: formatMetric(selectedPlayer.metrics.minutesPlayed, "minutesPlayed") },
                      { label: "Distance", val: formatMetric(selectedPlayer.metrics.distanceMetres, "distanceMetres") },
                      { label: "Top Speed", val: formatMetric(selectedPlayer.metrics.topSpeedKmh, "topSpeedKmh") + " km/h" },
                      { label: "Sprints", val: formatMetric(selectedPlayer.metrics.sprints, "sprints") },
                      { label: "Goals", val: formatMetric(selectedPlayer.metrics.goals, "goals") },
                      { label: "Passes", val: formatMetric(selectedPlayer.metrics.passes, "passes") + ` (${formatMetric(selectedPlayer.metrics.passSuccess, "passSuccess")})` },
                    ].map(stat => (
                      <div key={stat.label} className="bg-muted/40 p-2.5 rounded border flex flex-col">
                        <span className="text-xs text-muted-foreground">{stat.label}</span>
                        <span className="text-sm font-medium tabular-nums">{stat.val}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="h-4 w-4 text-primary" /> Event Timeline
                  </h4>
                  <EventTimeline events={selectedPlayer.eventTimeline} />
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
