import React from "react";
import {
  Activity, BarChart3, BookHeart, BookOpen, Bot, ClipboardList, Edit3,
  Navigation2, TrendingUp as TrendingUp2, Trophy, UserRound, Users, Video,
} from "lucide-react";

// Shared between the Hub front door (Home) and the per-group landing pages
// (GroupHome). Gating fields mirror Shell.tsx navSections exactly.

export type GroupPage = {
  label: string;
  href: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  module?: string;
  moduleAnywhere?: string;
  superadmin?: boolean;
};

export type HubGroup = {
  id: string;
  label: string;
  tagline: string;
  icon: React.ComponentType<{ className?: string }>;
  accentText: string;
  accentBorder: string;
  accentBg: string;
  pages: GroupPage[];
};

export const GROUPS: HubGroup[] = [
  {
    id: "analyse",
    label: "Analyse",
    tagline: "Goals, GPS, Veo and season performance data",
    icon: BarChart3,
    accentText: "text-sky-400",
    accentBorder: "border-t-sky-400",
    accentBg: "bg-sky-400/10 border-sky-400/25",
    pages: [
      { label: "Season Stats", href: "/season-stats", icon: BarChart3, module: "season-stats", description: "Goals, assists, the ladder and every team and player chart for the season." },
      { label: "Veo Insights", href: "/veo", icon: Video, module: "veo", description: "Match video stats from Veo — shots, possession and passing trends." },
      { label: "GPS Insights", href: "/gps", icon: Navigation2, module: "gps", description: "Distance, sprints and running loads from the GPS units, round by round." },
      { label: "Season Report", href: "/season-report", icon: TrendingUp2, module: "season-stats", description: "The full-season story pulled together into one downloadable report." },
      { label: "Testing", href: "/testing", icon: Activity, module: "testing", description: "Athletic testing results and how each player compares to the squad." },
    ],
  },
  {
    id: "prepare",
    label: "Prepare",
    tagline: "Weekly brief, match deck and training session plans",
    icon: Trophy,
    accentText: "text-amber-400",
    accentBorder: "border-t-amber-400",
    accentBg: "bg-amber-400/10 border-amber-400/25",
    pages: [
      { label: "Match Prep", href: "/match-prep", icon: Trophy, module: "match-prep", description: "Build the Monday brief and Friday match deck for the week's opponent." },
      { label: "Session Planner", href: "/sessions", icon: ClipboardList, moduleAnywhere: "session-planner", description: "Plan training sessions for the week and the cycle." },
      { label: "Session Library", href: "/library", icon: BookOpen, moduleAnywhere: "session-planner", description: "Browse the practice library to drop drills into your sessions." },
    ],
  },
  {
    id: "reflect",
    label: "Reflect",
    tagline: "Post-game journals, cycles and coach AI chat",
    icon: BookHeart,
    accentText: "text-purple-400",
    accentBorder: "border-t-purple-400",
    accentBg: "bg-purple-400/10 border-purple-400/25",
    pages: [
      { label: "Reflections", href: "/reflections", icon: BookHeart, module: "reflections", description: "Post-game journal entries and reflection cycles across the season." },
      { label: "Coach Assistant", href: "/assistant", icon: Bot, moduleAnywhere: "assistant", description: "Ask the AI assistant questions grounded in the coaching curriculum." },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    tagline: "Match data entry, user accounts and settings",
    icon: Edit3,
    accentText: "text-slate-400",
    accentBorder: "border-t-slate-400",
    accentBg: "bg-slate-400/10 border-slate-400/25",
    pages: [
      { label: "Data Entry", href: "/data-entry", icon: Edit3, module: "data-entry", description: "Enter match results, goals and player minutes for each round." },
      { label: "Users", href: "/users", icon: Users, superadmin: true, description: "Manage accounts and who can see which league." },
      { label: "My Account", href: "/account", icon: UserRound, description: "Your login details and password." },
    ],
  },
];

// Subtle football hex pattern — a nod to the ball's surface, kept very quiet.
// Uses an SVG <pattern> so it tiles the full page height however long it gets.
export function HexPattern() {
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

// Must mirror Shell.tsx itemVisible exactly — module items require the
// active league's module even for superadmins.
export function makePageVisible(opts: {
  isSuperadmin: boolean;
  activeLeagueId: number | null;
  hasModule: (leagueId: number, module: string) => boolean;
  hasModuleAnywhere: (module: string) => boolean;
}) {
  return (p: GroupPage) => {
    if (p.superadmin) return opts.isSuperadmin;
    if (p.module) return opts.activeLeagueId != null && opts.hasModule(opts.activeLeagueId, p.module);
    if (p.moduleAnywhere) return opts.isSuperadmin || opts.hasModuleAnywhere(p.moduleAnywhere);
    return true;
  };
}
