import React from "react";
import { Link, Redirect, useParams } from "wouter";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { useActiveLeague } from "@/contexts/LeagueContext";
import { GROUPS, HexPattern, makePageVisible } from "@/lib/hubGroups";

// One landing page per Hub group: a badge for each tool with a plain
// sentence saying what it's for. Reached from the top half of the Hub doors.

export default function GroupHome() {
  const { groupId } = useParams<{ groupId: string }>();
  const { isSuperadmin, hasModule, hasModuleAnywhere } = useLeagueModules();
  const { activeLeagueId } = useActiveLeague();

  const group = GROUPS.find(g => g.id === groupId);
  if (!group) return <Redirect to="/" />;

  const pageVisible = makePageVisible({ isSuperadmin, activeLeagueId, hasModule, hasModuleAnywhere });
  const pages = group.pages.filter(pageVisible);

  return (
    <div className="relative -m-4 md:-m-8 min-h-[calc(100%+2rem)] md:min-h-[calc(100%+4rem)] overflow-hidden">
      <HexPattern />

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-col px-4 py-10 md:py-14 gap-8">
        <div>
          <Link
            href="/"
            className="mb-5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Hub
          </Link>

          <div className="flex items-center gap-3.5">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border ${group.accentBg}`}>
              <group.icon className={`h-5 w-5 ${group.accentText}`} />
            </div>
            <div>
              <h1 className={`text-lg font-bold uppercase tracking-[0.14em] ${group.accentText}`}>
                {group.label}
              </h1>
              <p className="text-sm text-muted-foreground">{group.tagline}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {pages.map(p => (
            <Link
              key={p.label}
              href={p.href}
              className={`group flex flex-col gap-2.5 rounded-xl border border-border border-t-2 ${group.accentBorder} bg-card/80 p-5 backdrop-blur-sm transition-colors hover:bg-card`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${group.accentBg}`}>
                    <p.icon className={`h-4.5 w-4.5 ${group.accentText}`} />
                  </div>
                  <p className="text-sm font-semibold text-foreground">{p.label}</p>
                </div>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-muted-foreground" />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{p.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
