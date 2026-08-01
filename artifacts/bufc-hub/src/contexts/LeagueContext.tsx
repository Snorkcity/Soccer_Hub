import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  useListSeasons,
  useGetAuthStatus,
  getGetAuthStatusQueryKey,
} from "@workspace/api-client-react";

export type LeagueOption = { id: number; name: string };

type LeagueContextValue = {
  /** The app-wide league everything is scoped to (null while loading). */
  activeLeagueId: number | null;
  setActiveLeagueId: (id: number) => void;
  /** Leagues this user can switch between (1 entry = no dropdown anywhere). */
  leagueOptions: LeagueOption[];
  /** The team the current page is showing (e.g. "1sts") — drives the header
      "viewing" badge so coaches with several squads always know where they are. */
  viewingTeamLabel: string | null;
  setViewingTeamLabel: (label: string | null) => void;
};

const LeagueContext = createContext<LeagueContextValue>({
  activeLeagueId: null,
  setActiveLeagueId: () => {},
  leagueOptions: [],
  viewingTeamLabel: null,
  setViewingTeamLabel: () => {},
});

const STORAGE_KEY = "bufc.activeLeagueId";

export function LeagueProvider({ children }: { children: React.ReactNode }) {
  const { data: auth } = useGetAuthStatus({ query: { queryKey: getGetAuthStatusQueryKey() } });
  const { data: seasons } = useListSeasons();

  const isSuperadmin = auth?.authenticated === true && auth.user?.isSuperadmin === true;
  const grantedIds = useMemo(
    () => new Set((auth?.user?.leagues ?? []).map(l => l.leagueId)),
    [auth],
  );

  // Distinct leagues, in season-list order, limited to what the user can access.
  const leagueOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const s of seasons ?? []) {
      if (!isSuperadmin && !grantedIds.has(s.leagueId)) continue;
      if (!seen.has(s.leagueId)) seen.set(s.leagueId, s.leagueName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [seasons, isSuperadmin, grantedIds]);

  const [activeLeagueId, setActive] = useState<number | null>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  });

  // Default / repair: prefer the league of an active season the user can see.
  useEffect(() => {
    if (!leagueOptions.length) return;
    if (activeLeagueId == null || !leagueOptions.some(l => l.id === activeLeagueId)) {
      const withActive = (seasons ?? []).find(
        s => s.isActive && leagueOptions.some(l => l.id === s.leagueId),
      );
      const repaired = withActive ? withActive.leagueId : leagueOptions[0].id;
      localStorage.setItem(STORAGE_KEY, String(repaired)); // don't re-repair every reload
      setActive(repaired);
    }
  }, [leagueOptions, activeLeagueId, seasons]);

  const [viewingTeamLabel, setViewingTeamLabel] = useState<string | null>(null);

  const value = useMemo<LeagueContextValue>(() => ({
    activeLeagueId,
    leagueOptions,
    setActiveLeagueId: (id: number) => {
      localStorage.setItem(STORAGE_KEY, String(id));
      setActive(id);
    },
    viewingTeamLabel,
    setViewingTeamLabel,
  }), [activeLeagueId, leagueOptions, viewingTeamLabel]);

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useActiveLeague(): LeagueContextValue {
  return useContext(LeagueContext);
}

/** Pages that show a specific team call this with the team's name; the Shell
    header then reads "League · Team". Cleared automatically on unmount so the
    badge never shows a stale team on pages that aren't team-scoped. */
export function useViewingTeam(label: string | null | undefined) {
  const { setViewingTeamLabel } = useContext(LeagueContext);
  useEffect(() => {
    setViewingTeamLabel(label ?? null);
    return () => setViewingTeamLabel(null);
  }, [label, setViewingTeamLabel]);
}
