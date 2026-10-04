import { useMemo, useState } from "react";
import { useGetGpsDevelopment, getGetGpsDevelopmentQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useActiveLeague } from "@/contexts/LeagueContext";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { SeasonComparison, GrefPanel, LatestMatch, ExternalPanel } from "./EvidencePanels";
import { MatchContextPanel } from "./MatchContextPanel";
import { FeedbackPanel } from "./FeedbackPanel";

interface Sel { scope: string; key: string; playerName: string; squad: string }

export function PlayerDevelopmentTab({ year }: { year: string }) {
  const { activeLeagueId } = useActiveLeague();
  const { isSuperadmin, hasModuleAnywhere } = useLeagueModules();
  const canEmail = isSuperadmin || hasModuleAnywhere("data-entry");
  const scope = `${activeLeagueId ?? "none"}:${year}`;
  const [selState, setSel] = useState<Sel | null>(null);
  const sel = selState && selState.scope === scope ? selState : null;
  const [squadState, setSquad] = useState({ scope: "", squad: "__all__" });
  const squad = squadState.scope === scope ? squadState.squad : "__all__";
  const rosterParams = { leagueId: activeLeagueId ?? 0, year };
  const roster = useGetGpsDevelopment(rosterParams, {
    query: { enabled: activeLeagueId != null, queryKey: getGetGpsDevelopmentQueryKey(rosterParams) },
  });

  const params = {
    leagueId: activeLeagueId ?? 0,
    year,
    ...(sel ? { playerName: sel.playerName, squad: sel.squad } : {}),
  };
  const q = useGetGpsDevelopment(params, {
    query: { enabled: activeLeagueId != null, queryKey: getGetGpsDevelopmentQueryKey(params) },
  });
  const data = q.data;
  const allPlayers = roster.data?.players ?? [];
  const players = useMemo(() => allPlayers.filter(p => squad === "__all__" || p.squad === squad), [allPlayers, squad]);

  if (activeLeagueId == null) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">Choose a league to see player development.</CardContent></Card>;
  }
  if (q.isError) {
    return (
      <Alert variant="destructive" data-testid="state-error">
        <AlertTitle>Player development could not load</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          Nothing has been changed.
          <Button size="sm" variant="outline" onClick={() => q.refetch()} data-testid="button-retry">Retry</Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (q.isLoading || !data) {
    return (
      <div className="space-y-4" data-testid="state-loading">
        <Skeleton className="h-10 w-full max-w-sm" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const profile = data.profile;
  return (
    <div className="space-y-5 min-w-0" data-testid="player-development-tab">
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="w-full sm:max-w-[180px]">
          <label className="text-xs text-muted-foreground block mb-1.5">Squad</label>
          <Select value={squad} onValueChange={v => { setSquad({ scope, squad: v }); setSel(null); }}>
            <SelectTrigger data-testid="select-dev-squad"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all__">All squads</SelectItem>{[...new Set(allPlayers.map(p => p.squad))].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="w-full sm:max-w-sm">
          <label className="text-xs text-muted-foreground block mb-1.5">Player</label>
          <Select
            value={sel?.key ?? ""}
            onValueChange={k => {
              const p = players.find(x => `${x.playerName}||${x.squad}` === k);
              if (p) setSel({ scope, key: k, playerName: p.playerName, squad: p.squad });
            }}
          >
            <SelectTrigger data-testid="select-dev-player"><SelectValue placeholder={players.length ? "Select a player" : "No players"} /></SelectTrigger>
            <SelectContent>
              {players.map(p => (
                <SelectItem key={`${p.playerName}||${p.squad}`} value={`${p.playerName}||${p.squad}`}>
                  {p.playerName} | {p.squad} | {p.role ?? "role unknown"} | {p.appearances} app
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground sm:pb-2">Recorded running output for one-to-one development. Not a fitness or selection grade.</p>
      </div>

      {players.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground" data-testid="state-empty">
          No players with GPS appearances in {year}. Pick another season or upload GPS data.
        </CardContent></Card>
      ) : !sel ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground" data-testid="state-pick">Pick a player to see their development evidence.</CardContent></Card>
      ) : q.isFetching && !profile ? (
        <Skeleton className="h-64 w-full" />
      ) : !profile ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground" data-testid="state-no-profile">No development evidence is available for this player.</CardContent></Card>
      ) : (
        <div className="space-y-5" key={`${scope}:${sel.key}`}>
          <div>
            <h2 className="text-xl font-semibold tracking-tight break-words" data-testid="text-dev-player">{profile.playerName}</h2>
            <p className="text-sm text-muted-foreground">{profile.squad} | {profile.role ?? "Role not recorded"} | {profile.year} | method {profile.methodologyVersion}</p>
          </div>
          {(profile.summary.length > 0 || profile.warnings.length > 0) && (
            <Card><CardContent className="py-4 space-y-1.5 text-sm">
              {profile.summary.map((t, i) => <p key={`s${i}`}>{t}</p>)}
              {profile.warnings.map((t, i) => <p key={`w${i}`} className="text-amber-300">Note: {t}</p>)}
            </CardContent></Card>
          )}
          <LatestMatch profile={profile} />
          <SeasonComparison profile={profile} />
          <GrefPanel profile={profile} />
          <MatchContextPanel profile={profile} leagueId={activeLeagueId} canEdit={data.canEdit} />
          <ExternalPanel profile={profile} />
          <FeedbackPanel profile={profile} feedback={data.feedback} leagueId={activeLeagueId} canEdit={data.canEdit} canEmail={canEmail} />
        </div>
      )}
    </div>
  );
}

export default PlayerDevelopmentTab;
