import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { competitionsForYear } from "./competitionSeasons";
import {
  useListSeasons,
  useGetAuthStatus,
  getGetAuthStatusQueryKey,
} from "@workspace/api-client-react";

export type LeagueOption = { id: number; name: string };
export type SeasonOption = { id: number; leagueId: number; year: string; label: string; isActive: boolean };

type LeagueContextValue = {
  /** The app-wide league everything is scoped to (null while loading). */
  activeLeagueId: number | null;
  setActiveLeagueId: (id: number) => void;
  /** Leagues this user can switch between (1 entry = no dropdown anywhere). */
  leagueOptions: LeagueOption[];
  /** Accessible competitions that actually have the currently selected year. */
  competitionOptions: LeagueOption[];
  /** The team the current page is showing (e.g. "1sts") — drives the header
      "viewing" badge so coaches with several squads always know where they are. */
  viewingTeamLabel: string | null;
  setViewingTeamLabel: (label: string | null) => void;
  /** Seasons of the active league the user can see, newest year first. */
  seasonOptions: SeasonOption[];
  /** The selected campaign within the active league. Always a season of
      activeLeagueId (never a stale one from a previous league), else null. */
  activeSeasonId: number | null;
  activeSeason: SeasonOption | null;
  setActiveSeasonId: (id: number) => void;
};

const LeagueContext = createContext<LeagueContextValue>({
  activeLeagueId: null,
  setActiveLeagueId: () => {},
  leagueOptions: [],
  competitionOptions: [],
  viewingTeamLabel: null,
  setViewingTeamLabel: () => {},
  seasonOptions: [],
  activeSeasonId: null,
  activeSeason: null,
  setActiveSeasonId: () => {},
});

const STORAGE_KEY = "bufc.activeLeagueId";
const SEASON_STORAGE_KEY = "bufc.seasonByLeague";

function readSeasonMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SEASON_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

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

  // Only expose a league once it is confirmed accessible, so no consumer
  // queries a stale/unauthorised league during repair.
  const leagueValid = activeLeagueId != null && leagueOptions.some(l => l.id === activeLeagueId);

  const seasonOptions = useMemo<SeasonOption[]>(() => {
    if (!leagueValid) return [];
    return (seasons ?? [])
      .filter(s => s.leagueId === activeLeagueId)
      .map(s => ({ id: s.id, leagueId: s.leagueId, year: s.year, label: s.label, isActive: s.isActive }))
      .sort((a, b) => b.year.localeCompare(a.year, undefined, { numeric: true }) || b.id - a.id);
  }, [seasons, activeLeagueId, leagueValid]);

  // Explicit picks, remembered per league. isActive is only the default.
  const [seasonByLeague, setSeasonByLeague] = useState<Record<string, number>>(readSeasonMap);

  // Derived synchronously: a league switch resolves its season in the same
  // render, so an old league's season id can never reach a query.
  const activeSeason = useMemo<SeasonOption | null>(() => {
    if (!seasonOptions.length || activeLeagueId == null) return null;
    const picked = seasonByLeague[String(activeLeagueId)];
    return (
      seasonOptions.find(s => s.id === picked) ??
      seasonOptions.find(s => s.isActive) ??
      seasonOptions[0]
    );
  }, [seasonOptions, seasonByLeague, activeLeagueId]);

  const competitionOptions = useMemo(
    () => competitionsForYear(leagueOptions, seasons ?? [], activeSeason?.year),
    [leagueOptions, seasons, activeSeason?.year],
  );

  const value = useMemo<LeagueContextValue>(() => ({
    activeLeagueId,
    leagueOptions,
    competitionOptions,
    setActiveLeagueId: (id: number) => {
      if (!leagueOptions.some(l => l.id === id)) return;
      // Keep the chosen campaign when switching competitions, even if this
      // competition was previously viewed in another year.
      const sameYear = (seasons ?? []).find(s =>
        s.leagueId === id && s.year === activeSeason?.year,
      );
      if (sameYear) {
        setSeasonByLeague(prev => {
          if (prev[String(id)] === sameYear.id) return prev;
          const next = { ...prev, [String(id)]: sameYear.id };
          try { localStorage.setItem(SEASON_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
          return next;
        });
      }
      localStorage.setItem(STORAGE_KEY, String(id));
      setActive(id);
    },
    viewingTeamLabel,
    setViewingTeamLabel,
    seasonOptions,
    activeSeason,
    activeSeasonId: activeSeason?.id ?? null,
    setActiveSeasonId: (id: number) => {
      const season = (seasons ?? []).find(s => s.id === id);
      if (!season || !leagueOptions.some(l => l.id === season.leagueId)) return;
      setSeasonByLeague(prev => {
        const next = { ...prev, [String(season.leagueId)]: id };
        try { localStorage.setItem(SEASON_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    },
  }), [activeLeagueId, leagueOptions, competitionOptions, viewingTeamLabel, seasonOptions, activeSeason, seasons, seasonByLeague]);

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
