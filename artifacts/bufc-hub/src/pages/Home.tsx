import React from "react";
import { Link } from "wouter";
import { useListTeams, useListSeasons, useGetSeasonSummary, getGetSeasonSummaryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { ArrowRight, BarChart3, Navigation2, Activity, Map, Calendar } from "lucide-react";

export default function Home() {
  const { data: teams } = useListTeams();
  const { data: seasons } = useListSeasons();
  
  const currentSeason = seasons?.find(s => s.isActive) || seasons?.[0];
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
      color: "text-chart-1"
    },
    {
      title: "GPS Insights",
      description: "Physical performance data, load monitoring, and top speeds.",
      icon: Navigation2,
      href: "/gps",
      stat: "Catapult Integration",
      color: "text-chart-2"
    },
    {
      title: "Player Testing",
      description: "Athletic testing results, jump heights, and sprint splits.",
      icon: Activity,
      href: "/testing",
      stat: "Performance Baselines",
      color: "text-chart-3"
    },
    {
      title: "Goal Map Tool",
      description: "Interactive pitch mapper for goal creation and conceded events.",
      icon: Map,
      href: "/goal-map",
      stat: "X/Y Coordinate Plotting",
      color: "text-chart-5"
    }
  ];

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-500">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Performance Hub</h1>
        <p className="text-muted-foreground">
          Belconnen United FC analytics and team management platform.
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Current Season: {currentSeason?.label || "Loading..."}</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {modules.map((mod) => (
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
          {seasons?.filter(s => !s.isActive).map(season => (
            <Card key={season.id} className="opacity-70 hover:opacity-100 transition-opacity">
              <CardHeader className="py-4">
                <CardTitle className="text-base">{season.label}</CardTitle>
                <CardDescription>Historical data</CardDescription>
              </CardHeader>
            </Card>
          ))}
          {seasons?.filter(s => !s.isActive).length === 0 && (
            <p className="text-sm text-muted-foreground">No archived seasons available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
