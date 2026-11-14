import { useMemo } from "react";
import { useGetAuthStatus, getGetAuthStatusQueryKey } from "@workspace/api-client-react";
import { seasonGrantModules } from "@workspace/api-zod";

/**
 * Per-league module access, derived from the signed-in user's league grants.
 *
 * Superadmins implicitly have every module in every league. For everyone else a
 * module is available in a league only when it appears in that league's
 * `modules` array on their account.
 */
export function useLeagueModules(): {
  isSuperadmin: boolean;
  hasModule(leagueId: number, module: string, year?: string): boolean;
  hasModuleAnywhere(module: string): boolean;
  ready: boolean;
} {
  const { data: auth, isSuccess } = useGetAuthStatus({ query: { queryKey: getGetAuthStatusQueryKey() } });

  const isSuperadmin = auth?.authenticated === true && auth.user?.isSuperadmin === true;
  const leagues = auth?.user?.leagues ?? [];

  return useMemo(() => {
    const moduleByLeague = new Map<number, Set<string>>();
    for (const a of leagues) moduleByLeague.set(a.leagueId, new Set(a.modules));

    return {
      isSuperadmin,
      ready: isSuccess,
      hasModule(leagueId: number, module: string, year?: string) {
        if (isSuperadmin) return true;
        const grant = leagues.find(g => g.leagueId === leagueId);
        return !!grant && seasonGrantModules(grant.modules, grant.seasonModules, year).includes(module);
      },
      hasModuleAnywhere(module: string) {
        if (isSuperadmin) return true;
        for (const mods of moduleByLeague.values()) if (mods.has(module)) return true;
        return false;
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperadmin, isSuccess, JSON.stringify(leagues)]);
}
