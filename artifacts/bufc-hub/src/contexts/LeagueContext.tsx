import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { campaignYears, competitionsForYear, resolveCampaign } from "./competitionSeasons";
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
  /** All accessible campaign years, independent of the selected competition. */
  yearOptions: string[];
  activeYear: string | null;
  setActiveYear: (year: string) => void;
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
  yearOptions: [],
  activeYear: null,
  setActiveYear: () => {},
  viewingTeamLabel: null,
  setViewingTeamLabel: () => {},
  seasonOptions: [],
  activeSeasonId: null,
  activeSeason: null,
  setActiveSeasonId: () => {},
});

const STORAGE_KEY = "bufc.activeLeagueId";
const SEASON_STORAGE_KEY = "bufc.seasonByLeague";
const YEAR_STORAGE_KEY = "bufc.activeCampaignYear";

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

  const [preferredLeagueId, setActive] = useState<number | null>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  });

  const [viewingTeamLabel, setViewingTeamLabel] = useState<string | null>(null);
  const [preferredYear, setPreferredYear] = useState<string | null>(
    () => localStorage.getItem(YEAR_STORAGE_KEY),
  );
  const [legacySeasonByLeague] = useState(readSeasonMap);
  const accessibleSeasons = useMemo(
    () => (seasons ?? []).filter(s => leagueOptions.some(l => l.id === s.leagueId)),
    [seasons, leagueOptions],
  );
  const yearOptions = useMemo(() => campaignYears(accessibleSeasons), [accessibleSeasons]);

  // Migrate the old per-competition remembered season on the first visit.
  const legacyYear = accessibleSeasons.find(
    s => s.leagueId === preferredLeagueId && s.id === legacySeasonByLeague[String(preferredLeagueId)],
  )?.year;
  const activeSeason = useMemo<SeasonOption | null>(
    () => resolveCampaign(accessibleSeasons, preferredLeagueId, preferredYear ?? legacyYear ?? null),
    [accessibleSeasons, preferredLeagueId, preferredYear, legacyYear],
  );
  const activeLeagueId = activeSeason?.leagueId ?? null;
  const activeYear = activeSeason?.year ?? null;

  // Persist only the resolved, authorised pair. Year is now the primary choice.
  useEffect(() => {
    if (activeLeagueId == null || activeYear == null) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(activeLeagueId));
      localStorage.setItem(YEAR_STORAGE_KEY, activeYear);
    } catch { /* A blocked browser store must not prevent navigation. */ }
  }, [activeLeagueId, activeYear]);

  const seasonOptions = useMemo<SeasonOption[]>(() => {
    if (activeLeagueId == null) return [];
    return accessibleSeasons
      .filter(s => s.leagueId === activeLeagueId)
      .map(s => ({ id: s.id, leagueId: s.leagueId, year: s.year, label: s.label, isActive: s.isActive }))
      .sort((a, b) => b.year.localeCompare(a.year, undefined, { numeric: true }) || b.id - a.id);
  }, [accessibleSeasons, activeLeagueId]);

  const competitionOptions = useMemo(
    () => competitionsForYear(leagueOptions, accessibleSeasons, activeYear ?? undefined),
    [leagueOptions, accessibleSeasons, activeYear],
  );

  const value = useMemo<LeagueContextValue>(() => ({
    activeLeagueId,
    leagueOptions,
    competitionOptions,
    yearOptions,
    activeYear,
    setActiveYear: (year: string) => {
      if (!yearOptions.includes(year)) return;
      setActive(activeLeagueId);
      setPreferredYear(year);
    },
    setActiveLeagueId: (id: number) => {
      if (!leagueOptions.some(l => l.id === id)) return;
      // The year is never changed merely by choosing a competition.
      setPreferredYear(prev => prev ?? activeYear);
      setActive(id);
    },
    viewingTeamLabel,
    setViewingTeamLabel,
    seasonOptions,
    activeSeason,
    activeSeasonId: activeSeason?.id ?? null,
    setActiveSeasonId: (id: number) => {
      const season = accessibleSeasons.find(s => s.id === id);
      if (!season) return;
      setActive(season.leagueId);
      setPreferredYear(season.year);
    },
  }), [activeLeagueId, leagueOptions, competitionOptions, yearOptions, activeYear, viewingTeamLabel, seasonOptions, activeSeason, accessibleSeasons]);

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
