import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, BarChart3, BookHeart, BookOpen, Bot, ClipboardList, Edit3, Home, Menu, Navigation2, PanelLeftClose, PanelLeftOpen, TrendingUp as TrendingUp2, Trophy, UserRound, Users, X } from "lucide-react";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { useActiveLeague } from "@/contexts/LeagueContext";
import clubLogo from "@assets/testing_app/Testing_app/assets/clublogo.png";

// `module` gates a module-locked item to the ACTIVE league. `moduleAnywhere`
// gates a paid add-on tool shown when the user has it in ANY league (the tools
// aren't league-scoped). `superadmin` gates the Users page.
const navItems: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  module?: string;
  moduleAnywhere?: string;
  superadmin?: boolean;
}[] = [
  { href: "/", label: "Hub", icon: Home },
  { href: "/season-stats", label: "Season Stats", icon: BarChart3, module: "season-stats" },
  { href: "/season-report", label: "Season Report", icon: TrendingUp2, module: "season-stats" },
  { href: "/gps", label: "GPS Insights", icon: Navigation2, module: "gps" },
  { href: "/testing", label: "Testing", icon: Activity, module: "testing" },
  { href: "/match-prep", label: "Match Prep", icon: Trophy, module: "match-prep" },
  { href: "/reflections", label: "Reflections", icon: BookHeart, module: "reflections" },
  { href: "/assistant", label: "Coach Assistant", icon: Bot, moduleAnywhere: "assistant" },
  { href: "/sessions", label: "Session Planner", icon: ClipboardList, moduleAnywhere: "session-planner" },
  { href: "/library", label: "Session Library", icon: BookOpen, moduleAnywhere: "session-planner" },
  { href: "/data-entry", label: "Data Entry", icon: Edit3, module: "data-entry" },
  { href: "/users", label: "Users", icon: Users, superadmin: true },
  { href: "/account", label: "My Account", icon: UserRound },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { isSuperadmin, hasModule, hasModuleAnywhere } = useLeagueModules();
  const { activeLeagueId, leagueOptions, viewingTeamLabel } = useActiveLeague();
  const activeLeagueName = leagueOptions.find(l => l.id === activeLeagueId)?.name ?? null;
  // Module items follow the ACTIVE league (picked on the Hub) — switching league
  // changes which pages appear. Fall back to any-league while it's still loading.
  const visibleItems = navItems.filter((item) => {
    if (item.superadmin) return isSuperadmin;
    // Hide module items until the active league is known — briefly showing too
    // few is safer than flashing pages the user can't actually open.
    if (item.module) {
      return activeLeagueId != null && hasModule(activeLeagueId, item.module);
    }
    if (item.moduleAnywhere) return isSuperadmin || hasModuleAnywhere(item.moduleAnywhere);
    return true;
  });
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      {/* Sidebar */}
      <aside
        className={`w-full shrink-0 border-b border-border bg-card md:border-b-0 md:border-r flex flex-col z-20 transition-[width] duration-200 ease-in-out ${
          collapsed ? "md:w-16" : "md:w-64"
        }`}
      >
        <div className={`flex h-14 items-center md:h-20 border-b border-border ${collapsed ? "md:justify-center md:px-0 px-4 gap-3" : "px-4 gap-3"}`}>
          <img src={clubLogo} alt="BUFC Logo" className="w-9 h-9 md:w-10 md:h-10 object-contain drop-shadow-md shrink-0" />
          <div className={collapsed ? "md:hidden" : ""}>
            <h1 className="text-base md:text-lg font-bold uppercase tracking-wider text-foreground leading-tight">BUFC</h1>
            <p className="text-[10px] md:text-xs text-primary font-medium uppercase tracking-widest leading-none">Performance Hub</p>
          </div>
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setMobileOpen(v => !v)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            className="ml-auto flex md:hidden items-center justify-center h-10 w-10 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          {/* Collapse toggle — desktop only */}
          <button
            onClick={() => setCollapsed(v => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`hidden md:flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${
              collapsed ? "md:hidden" : "md:ml-auto"
            }`}
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        {/* Expand button shown when collapsed (desktop) */}
        {collapsed && (
          <button
            onClick={() => setCollapsed(false)}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="hidden md:flex items-center justify-center h-9 mx-2 mt-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}

        <nav className={`flex-1 overflow-auto p-3 md:p-4 space-y-1 ${mobileOpen ? "block" : "hidden md:block"}`}>
          {visibleItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-md py-3 md:py-2.5 text-sm font-medium transition-colors ${
                  collapsed ? "md:justify-center md:px-0 px-3" : "px-3"
                } ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <item.icon className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Build stamp — quick "has my deploy landed?" check. Dev just says
            dev; prod shows when the running bundle was built (+ commit id). */}
        <div
          className={`hidden md:block border-t border-border px-3 py-2 text-[10px] leading-tight text-muted-foreground/70 ${collapsed ? "text-center" : ""}`}
          title={import.meta.env.DEV ? "Development preview" : `Built ${__BUILD_TIME__}${__GIT_SHA__ ? ` · commit ${__GIT_SHA__}` : ""}`}
        >
          {import.meta.env.DEV ? (
            <span>dev</span>
          ) : (
            <span className={collapsed ? "md:hidden" : ""}>
              Updated{" "}
              {new Date(__BUILD_TIME__).toLocaleString("en-AU", {
                day: "numeric",
                month: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
              {__GIT_SHA__ ? ` · ${__GIT_SHA__}` : ""}
            </span>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Top decoration line */}
        <div className="h-1 w-full bg-gradient-to-r from-primary/80 to-transparent absolute top-0 left-0 z-10" />
        {/* "Where am I?" strip — league (and team when the page is team-scoped).
            Most users have one team, but clubs with 1sts/Reserves/23s need this. */}
        {activeLeagueName && (
          <div className="flex items-center gap-2 border-b border-border bg-card/60 px-4 md:px-8 py-1.5 text-xs text-muted-foreground">
            <span className="uppercase tracking-wide text-[10px]">Viewing</span>
            <span className="font-medium text-foreground">{activeLeagueName}</span>
            {viewingTeamLabel && (
              <>
                <span className="text-muted-foreground/60">·</span>
                <span className="font-medium text-primary">{viewingTeamLabel}</span>
              </>
            )}
          </div>
        )}
        <div className="flex-1 overflow-auto p-4 md:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
