import React from "react";
import { Link } from "wouter";
import { useListTeams, useListSeasons, useGetSeasonSummary, getGetSeasonSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, BarChart3, Navigation2, Activity, Calendar, BookHeart, BookOpen, ClipboardList, PenLine, Bot, Presentation, Trophy } from "lucide-react";
import { useActiveLeague } from "@/contexts/LeagueContext";
import { useLeagueModules } from "@/hooks/useLeagueModules";

export default function Home() {
  const { data: teams } = useListTeams();
  const { data: seasons } = useListSeasons();
  const { activeLeagueId, setActiveLeagueId, leagueOptions } = useActiveLeague();
  const { isSuperadmin, hasModule, hasModuleAnywhere } = useLeagueModules();

  // Everything on the Hub is scoped to the active league
  const leagueSeasons = seasons?.filter(s => s.leagueId === activeLeagueId);
  const currentSeason = leagueSeasons?.find(s => s.isActive) || leagueSeasons?.[0];
  // Prefer an analytics-enabled female team (Women's 1sts has all historical data)
  const firstTeam = teams?.find(t => t.analyticsEnabled && t.gender === "female") || teams?.find(t => t.analyticsEnabled) || teams?.[0];

  const summaryParams = { teamId: firstTeam?.id as number, seasonId: currentSeason?.id as number };
  const { data: summary } = useGetSeasonSummary(
    summaryParams,
    { query: { enabled: !!firstTeam?.id && !!currentSeason?.id, queryKey: getGetSeasonSummaryQueryKey(summaryParams) } }
  );

  const modules = [
    {
      title: "Season Stats",
      description: "Team performance, player leaderboards, and match analysis.",
      icon: BarChart3,
      href: "/season-stats",
      stat: summary ? `${summary.goalsScored} Goals Scored` : "Loading...",
      color: "text-chart-1",
      module: "season-stats"
    },
    {
      title: "GPS Insights",
      description: "Physical performance data, load monitoring, and top speeds.",
      icon: Navigation2,
      href: "/gps",
      stat: "Catapult Integration",
      color: "text-chart-2",
      module: "gps"
    },
    {
      title: "Player Testing",
      description: "Athletic testing results, jump heights, and sprint splits.",
      icon: Activity,
      href: "/testing",
      stat: "Performance Baselines",
      color: "text-chart-3",
      module: "testing"
    },
    {
      title: "Match Prep",
      description: "Build the weekly pre-match deck — starting XI, corners, and free kicks.",
      icon: Presentation,
      href: "/match-prep",
      stat: "Pre-Match Deck",
      color: "text-chart-3",
      module: "match-prep"
    },
    {
      title: "Reflections",
      description: "Journal cycles, post-training and post-match reflections — export your journal as a pptx.",
      icon: BookHeart,
      href: "/reflections",
      stat: "New",
      color: "text-chart-2",
      module: "reflections"
    },
    {
      title: "Coach Assistant",
      description: "Ask questions of the full football development curriculum, right here in the hub.",
      icon: Bot,
      href: "/assistant",
      stat: "U11 to 16+ curriculum",
      color: "text-chart-2",
      moduleAnywhere: "assistant"
    },
    {
      title: "Session Planner",
      description: "Plan training sessions, pick practices for each part, and print session sheets.",
      icon: ClipboardList,
      href: "/sessions",
      stat: "4-Part Sessions",
      color: "text-chart-5",
      moduleAnywhere: "session-planner"
    },
    {
      title: "Session Library",
      description: "The full practice library — activations, main parts, end games, and past write-ups.",
      icon: BookOpen,
      href: "/library",
      stat: "580+ Practices",
      color: "text-chart-4",
      moduleAnywhere: "session-planner"
    },
    {
      title: "Data Entry",
      description: "Enter match results, goals, and player stats — with AI screenshot reading.",
      icon: PenLine,
      href: "/data-entry",
      stat: "Admin Only",
      color: "text-chart-1",
      module: "data-entry"
    },
  ] as Array<{
    title: string; description: string; icon: React.ComponentType<{ className?: string }>;
    href: string; stat: string; color: string; module?: string; moduleAnywhere?: string;
  }>;

  // Cards mirror the sidebar: module cards only for modules the user has in the
  // active league (superadmin sees everything).
  const visibleModules = modules.filter(m => {
    if (isSuperadmin) return true;
    if (m.module) return activeLeagueId != null && hasModule(activeLeagueId, m.module);
    if (m.moduleAnywhere) return hasModuleAnywhere(m.moduleAnywhere);
    return true;
  });

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Performance Hub</h1>
        <p className="text-muted-foreground">
          Belconnen United FC analytics and team management platform.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">Current Season: {currentSeason?.label || "Loading..."}</h2>
          </div>
          {leagueOptions.length > 1 && (
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-muted-foreground" />
              <Select
                value={activeLeagueId != null ? String(activeLeagueId) : ""}
                onValueChange={v => setActiveLeagueId(Number(v))}
              >
                <SelectTrigger className="w-[220px]"><SelectValue placeholder="Select League" /></SelectTrigger>
                <SelectContent>
                  {leagueOptions.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {visibleModules.map((mod) => (
            <Link key={mod.href} href={mod.href}>
              <Card className="h-full hover-elevate transition-all border-l-4 border-l-transparent hover:border-l-primary cursor-pointer group">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <mod.icon className={`h-8 w-8 ${mod.color}`} />
                    <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity transform group-hover:translate-x-1" />
                  </div>
                  <CardTitle className="mt-4">{mod.title}</CardTitle>
                  <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                    {mod.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-xs font-medium text-primary/80 bg-primary/10 inline-flex items-center px-2.5 py-0.5 rounded-full">
                    {mod.stat}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      <div className="space-y-4 pt-4 border-t border-border/50">
        <h2 className="text-xl font-semibold tracking-tight text-muted-foreground">Archive</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {leagueSeasons?.filter(s => !s.isActive).map(season => (
            <Card key={season.id} className="opacity-70 hover:opacity-100 transition-opacity">
              <CardHeader className="py-4">
                <CardTitle className="text-base">{season.label}</CardTitle>
                <CardDescription>Historical data</CardDescription>
              </CardHeader>
            </Card>
          ))}
          {leagueSeasons?.filter(s => !s.isActive).length === 0 && (
            <p className="text-sm text-muted-foreground">No archived seasons available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
