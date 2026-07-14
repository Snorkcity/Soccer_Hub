import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, BarChart3, Edit3, Home, Navigation2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import clubLogo from "@assets/testing_app/Testing_app/assets/clublogo.png";

const navItems = [
  { href: "/", label: "Hub", icon: Home },
  { href: "/season-stats", label: "Season Stats", icon: BarChart3 },
  { href: "/gps", label: "GPS Insights", icon: Navigation2 },
  { href: "/testing", label: "Testing", icon: Activity },
  { href: "/data-entry", label: "Data Entry", icon: Edit3 },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      {/* Sidebar */}
      <aside
        className={`w-full shrink-0 border-b border-border bg-card md:border-b-0 md:border-r flex flex-col z-20 transition-[width] duration-200 ease-in-out ${
          collapsed ? "md:w-16" : "md:w-64"
        }`}
      >
        <div className={`flex h-16 items-center md:h-20 border-b border-border ${collapsed ? "md:justify-center md:px-0 px-4 gap-3" : "px-4 gap-3"}`}>
          <img src={clubLogo} alt="BUFC Logo" className="w-10 h-10 object-contain drop-shadow-md shrink-0" />
          <div className={collapsed ? "md:hidden" : ""}>
            <h1 className="text-lg font-bold uppercase tracking-wider text-foreground leading-tight">BUFC</h1>
            <p className="text-xs text-primary font-medium uppercase tracking-widest leading-none">Performance Hub</p>
          </div>
          {/* Collapse toggle — desktop only */}
          <button
            onClick={() => setCollapsed(v => !v)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`hidden md:flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors ${
              collapsed ? "md:hidden" : "ml-auto"
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

        <nav className="flex-1 overflow-auto p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-md py-2.5 text-sm font-medium transition-colors ${
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
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Top decoration line */}
        <div className="h-1 w-full bg-gradient-to-r from-primary/80 to-transparent absolute top-0 left-0 z-10" />
        <div className="flex-1 overflow-auto p-4 md:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
