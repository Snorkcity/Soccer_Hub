import React from "react";
import { Link } from "wouter";
import {
  useListTeams, useListSeasons,
  useGetSeasonSummary, getGetSeasonSummaryQueryKey,
  useGetLeagueLadder, getGetLeagueLadderQueryKey,
  useListMatches, getListMatchesQueryKey,
} from "@workspace/api-client-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowUpRight, BarChart3, Trophy, BookHeart, Edit3,
} from "lucide-react";
import { useActiveLeague } from "@/contexts/LeagueContext";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import clubLogo from "@assets/testing_app/Testing_app/assets/clublogo.png";

// The Hub is a front door: identity + three headline numbers up top, then
// four doors matching the sidebar's story (Analyse → Prepare → Reflect →
// Admin). Page names sit quietly under each door; gating mirrors the sidebar.

type GroupPage = { label: string; module?: string; moduleAnywhere?: string; superadmin?: boolean };

const GROUPS: Array<{
  id: string;
  label: string;
  tagline: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  accentText: string;
  accentBorder: string;
  accentBg: string;
  pages: GroupPage[];
}> = [
  {
    id: "analyse",
    label: "Analyse",
    tagline: "Goals, GPS, Veo and season performance data",
    href: "/season-stats",
    icon: BarChart3,
    accentText: "text-sky-400",
    accentBorder: "border-t-sky-400",
    accentBg: "bg-sky-400/10 border-sky-400/25",
    pages: [
      { label: "Season Stats", module: "season-stats" },
      { label: "Veo Insights", module: "veo" },
      { label: "GPS Insights", module: "gps" },
      { label: "Season Report", module: "season-stats" },
      { label: "Testing", module: "testing" },
    ],
  },
  {
    id: "prepare",
    label: "Prepare",
    tagline: "Weekly brief, match deck and training session plans",
    href: "/match-prep",
    icon: Trophy,
    accentText: "text-amber-400",
    accentBorder: "border-t-amber-400",
    accentBg: "bg-amber-400/10 border-amber-400/25",
    pages: [
      { label: "Match Prep", module: "match-prep" },
      { label: "Session Planner", moduleAnywhere: "session-planner" },
      { label: "Session Library", moduleAnywhere: "session-planner" },
    ],
  },
  {
    id: "reflect",
    label: "Reflect",
    tagline: "Post-game journals, cycles and coach AI chat",
    href: "/reflections",
    icon: BookHeart,
    accentText: "text-purple-400",
    accentBorder: "border-t-purple-400",
    accentBg: "bg-purple-400/10 border-purple-400/25",
    pages: [
      { label: "Reflections", module: "reflections" },
      { label: "Coach Assistant", moduleAnywhere: "assistant" },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    tagline: "Match data entry, user accounts and settings",
    href: "/data-entry",
    icon: Edit3,
    accentText: "text-slate-400",
    accentBorder: "border-t-slate-400",
    accentBg: "bg-slate-400/10 border-slate-400/25",
    pages: [
      { label: "Data Entry", module: "data-entry" },
      { label: "Users", superadmin: true },
      { label: "My Account" },
    ],
  },
];

const PAGE_HREFS: Record<string, string> = {
  "Season Stats": "/season-stats",
  "Veo Insights": "/veo",
  "GPS Insights": "/gps",
  "Season Report": "/season-report",
  "Testing": "/testing",
  "Match Prep": "/match-prep",
  "Session Planner": "/sessions",
  "Session Library": "/library",
  "Reflections": "/reflections",
  "Coach Assistant": "/assistant",
  "Data Entry": "/data-entry",
  "Users": "/users",
  "My Account": "/account",
};

// Subtle football hex pattern — a nod to the ball's surface, kept very quiet.
// Uses an SVG <pattern> so it tiles the full page height however long it gets.
function HexPattern() {
  const r = 34;
  const w = r * 1.732; // hex width (flat-to-flat)
  const tileH = r * 3; // two staggered rows per repeat
  const pts = (cx: number, cy: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      return `${(cx + (r - 1) * Math.cos(a)).toFixed(1)},${(cy + (r - 1) * Math.sin(a)).toFixed(1)}`;
    }).join(" ");
  // Hex centres covering one tile (edges clip; the repeat completes them).
  const centres: Array<[number, number]> = [
    [0, 0], [w, 0], [w / 2, r * 1.5], [0, tileH], [w, tileH],
  ];
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full text-foreground/[0.045]"
    >
      <defs>
        <pattern id="hub-hex" width={w} height={tileH} patternUnits="userSpaceOnUse">
          {centres.map(([cx, cy], i) => (
            <polygon key={i} points={pts(cx, cy)} fill="none" stroke="currentColor" strokeWidth="1" />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hub-hex)" />
    </svg>
  );
}

export default function Home() {
  const { data: teams } = useListTeams();
  const { data: seasons } = useListSeasons();
  const { activeLeagueId, setActiveLeagueId, leagueOptions } = useActiveLeague();
  const { isSuperadmin, hasModule, hasModuleAnywhere } = useLeagueModules();

  const leagueSeasons = seasons?.filter(s => s.leagueId === activeLeagueId);
  const currentSeason = leagueSeasons?.find(s => s.isActive) || leagueSeasons?.[0];
  const firstTeam =
    teams?.find(t => t.analyticsEnabled && t.gender === "female") ||
    teams?.find(t => t.analyticsEnabled) ||
    teams?.[0];

  const ready = !!firstTeam?.id && !!currentSeason?.id;
  const params = { teamId: firstTeam?.id as number, seasonId: currentSeason?.id as number };

  const { data: summary } = useGetSeasonSummary(params, {
    query: { enabled: ready, queryKey: getGetSeasonSummaryQueryKey(params) },
  });
  const { data: ladder } = useGetLeagueLadder(params, {
    query: { enabled: ready, queryKey: getGetLeagueLadderQueryKey(params) },
  });
  const { data: matches } = useListMatches(params, {
    query: { enabled: ready, queryKey: getListMatchesQueryKey(params) },
  });

  const ladderPos = ladder ? ladder.findIndex(t => t.isFocusTeam) + 1 : 0;
  const ordinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  };

  // Latest recorded match (matches arrive in various orders; sort by date desc)
  const lastMatch = React.useMemo(() => {
    if (!matches?.length) return null;
    const dated = matches.filter(m => m.matchDate);
    if (!dated.length) return matches[matches.length - 1];
    return [...dated].sort((a, b) => (b.matchDate! > a.matchDate! ? 1 : -1))[0];
  }, [matches]);

  // Must mirror Shell.tsx itemVisible exactly — module items require the
  // active league's module even for superadmins.
  const pageVisible = (p: GroupPage) => {
    if (p.superadmin) return isSuperadmin;
    if (p.module) return activeLeagueId != null && hasModule(activeLeagueId, p.module);
    if (p.moduleAnywhere) return isSuperadmin || hasModuleAnywhere(p.moduleAnywhere);
    return true;
  };

  const visibleGroups = GROUPS
    .map(g => ({ ...g, pages: g.pages.filter(pageVisible) }))
    .filter(g => g.pages.length > 0);

  const groupStat = (id: string): string | null => {
    if (id === "analyse" && summary) {
      const pos = ladderPos > 0 ? ` · ${ordinal(ladderPos)} of ${ladder!.length}` : "";
      return `${summary.goalsScored} goals${pos}`;
    }
    if (id === "prepare" && lastMatch) {
      const score = lastMatch.fullScore ? ` · ${lastMatch.fullScore}` : "";
      // matchId codes look like "R18-BEL-MAJ" — show just the round.
      const round = lastMatch.matchId.match(/^R\d+/i)?.[0]?.toUpperCase();
      return `Last: ${round ? `${round} ` : ""}v ${lastMatch.opponent}${score}`;
    }
    if (id === "admin" && summary) {
      return `${summary.matchesPlayed} rounds entered`;
    }
    return null;
  };

  const headline = [
    { label: "Position", value: ladderPos > 0 ? ordinal(ladderPos) : "—", sub: ladder ? `of ${ladder.length} clubs` : "" },
    { label: "Win Rate", value: summary ? `${Math.round(summary.winRate * 100)}%` : "—", sub: summary ? `${summary.wins}W · ${summary.draws}D · ${summary.losses}L` : "" },
    { label: "Goals", value: summary ? String(summary.goalsScored) : "—", sub: summary ? `${summary.avgGoalsScored.toFixed(1)} per game` : "" },
  ];

  return (
    <div className="relative -m-4 md:-m-8 min-h-full overflow-hidden">
      <HexPattern />

      <div className="relative z-10 flex flex-col items-center px-4 py-10 md:py-14 gap-10">
        {/* Identity */}
        <div className="text-center">
          <div className="mb-4 flex items-center justify-center gap-4">
            <img src={clubLogo} alt="BUFC" className="h-14 w-14 object-contain drop-shadow-md" />
            <div className="text-left">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                Belconnen United FC
              </p>
              <h1 className="text-2xl md:text-3xl font-bold leading-tight text-foreground">
                Performance Hub
              </h1>
            </div>
          </div>

          {/* Season strip */}
          <div className="inline-flex items-stretch overflow-hidden rounded-lg border border-border bg-card/80 backdrop-blur-sm">
            <div className="border-r border-border px-4 py-2.5 md:px-5 text-left">
              <p className="mb-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">Season</p>
              <p className="text-sm font-semibold text-foreground/90 whitespace-nowrap">
                {currentSeason?.label ?? "Loading…"}
              </p>
            </div>
            {headline.map((s, i) => (
              <div
                key={s.label}
                className={`px-4 py-2.5 md:px-5 text-left ${i < headline.length - 1 ? "border-r border-border" : ""}`}
              >
                <p className="mb-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">{s.label}</p>
                <p className="text-sm font-bold text-foreground whitespace-nowrap">{s.value}</p>
                {s.sub && <p className="text-[10px] text-muted-foreground/70 whitespace-nowrap">{s.sub}</p>}
              </div>
            ))}
          </div>

          {leagueOptions.length > 1 && (
            <div className="mt-3 flex justify-center">
              <Select
                value={activeLeagueId != null ? String(activeLeagueId) : ""}
                onValueChange={v => setActiveLeagueId(Number(v))}
              >
                <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue placeholder="Select League" /></SelectTrigger>
                <SelectContent>
                  {leagueOptions.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Four doors — the card itself is not a link (page chips inside would
            nest anchors); the heading row links to the first VISIBLE page. */}
        <div className="grid w-full max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
          {visibleGroups.map(g => {
            const stat = groupStat(g.id);
            const primaryHref = PAGE_HREFS[g.pages[0].label];
            return (
              <div
                key={g.id}
                className={`group flex flex-col gap-3.5 rounded-xl border border-border border-t-2 ${g.accentBorder} bg-card/80 p-5 backdrop-blur-sm transition-colors hover:bg-card`}
              >
                <Link href={primaryHref} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${g.accentBg}`}>
                      <g.icon className={`h-4.5 w-4.5 ${g.accentText}`} />
                    </div>
                    <div>
                      <p className={`text-[11px] font-bold uppercase tracking-[0.14em] ${g.accentText}`}>
                        {g.label}
                      </p>
                      <p className="text-sm font-medium text-foreground/90">{g.tagline}</p>
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-muted-foreground" />
                </Link>

                {stat && (
                  <p className="border-t border-border pt-2 text-[11px] text-muted-foreground/80">
                    {stat}
                  </p>
                )}

                <div className="flex flex-wrap gap-x-1.5 gap-y-1">
                  {g.pages.map((p, i) => (
                    <span key={p.label} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-xs text-border">·</span>}
                      <Link
                        href={PAGE_HREFS[p.label]}
                        className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {p.label}
                      </Link>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Archive — quiet, only when there's history */}
        {leagueSeasons && leagueSeasons.filter(s => !s.isActive).length > 0 && (
          <p className="text-xs text-muted-foreground/60">
            Archive:{" "}
            {leagueSeasons.filter(s => !s.isActive).map(s => s.label).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}
