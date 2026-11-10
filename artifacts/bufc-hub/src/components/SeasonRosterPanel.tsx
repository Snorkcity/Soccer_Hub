import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Users } from "lucide-react";
import {
  useGetSeasonRoster, getGetSeasonRosterQueryKey,
  type SeasonRosterPlayer,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Read-only review of the coach-supplied season roster(s) feeding a GPS hub.
    Shows before any GPS rows exist. Never merges or links players. */
export function SeasonRosterPanel({ leagueId, year }: { leagueId: number | null; year: string }) {
  const params = { leagueId: leagueId ?? 0, year };
  const { data, isLoading, isError, refetch, isFetching } = useGetSeasonRoster(params, {
    query: { enabled: leagueId != null && !!year, queryKey: getGetSeasonRosterQueryKey(params) },
  });
  const [squad, setSquad] = useState<string>("all");
  const [open, setOpen] = useState(true);

  // Belt and braces: only rows for exactly this league/year are ever shown.
  const rows = useMemo<SeasonRosterPlayer[]>(
    () => (data ?? []).filter(r => r.year === year && (r.gpsLeagueId === leagueId || r.leagueId === leagueId)),
    [data, year, leagueId],
  );
  const squads = useMemo(() => [...new Set(rows.map(r => r.squad))].sort(), [rows]);
  const sources = useMemo(() => [...new Set(rows.map(r => r.leagueName))].sort(), [rows]);
  const nameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.playerName.trim().toLowerCase();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [rows]);
  const isAmbiguous = (r: SeasonRosterPlayer) =>
    r.ambiguousName || (nameCounts.get(r.playerName.trim().toLowerCase()) ?? 0) > 1;
  const ambiguousNames = useMemo(
    () => [...new Set(rows.filter(isAmbiguous).map(r => r.playerName))],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, nameCounts],
  );

  const activeSquad = squad !== "all" && squads.includes(squad) ? squad : "all";
  const visible = rows
    .filter(r => activeSquad === "all" || r.squad === activeSquad)
    .sort((a, b) => a.squad.localeCompare(b.squad) || a.positionCode.localeCompare(b.positionCode) || a.playerName.localeCompare(b.playerName));

  if (leagueId == null) return null;

  if (isLoading) {
    return (
      <Card data-testid="roster-loading">
        <CardContent className="space-y-2 py-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card data-testid="roster-error">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
          <span className="text-muted-foreground">Could not load the {year} season roster.</span>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="button-retry-roster">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // No roster for this year: stay out of the way.
  if (!rows.length) return null;

  const shared = sources.length > 1 || rows.some(r => r.gpsLeagueId !== r.leagueId);

  return (
    <Card data-testid="panel-season-roster">
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            className="flex items-center gap-2 text-left"
            data-testid="button-toggle-roster"
          >
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">{year} season roster</span>
            <span className="text-xs text-muted-foreground">{rows.length} players</span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && squads.length > 1 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by squad">
              {["all", ...squads].map(s => (
                <Button
                  key={s}
                  size="sm"
                  variant={activeSquad === s ? "default" : "outline"}
                  className="h-7 px-2.5 text-xs"
                  aria-pressed={activeSquad === s}
                  onClick={() => setSquad(s)}
                  data-testid={`button-roster-squad-${s}`}
                >
                  {s === "all" ? "All squads" : s} ({s === "all" ? rows.length : rows.filter(r => r.squad === s).length})
                </Button>
              ))}
            </div>
          )}
        </div>

        {open && (
          <>
            <p className="text-xs text-muted-foreground" data-testid="text-roster-sources">
              {shared
                ? <>Shared GPS hub for {sources.join(" and ")}. Both squads appear here together; each player keeps their own roster entry, grade and position.</>
                : <>Roster source: {sources[0]}. Supplied by the club; recorded separately from match appearances and GPS measurements.</>}
            </p>

            {ambiguousNames.length > 0 && (
              <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" role="note" data-testid="warning-roster-ambiguous">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  Same name in more than one roster entry: {ambiguousNames.join(", ")}. These are kept as separate
                  players until the club confirms whether they are the same person. GPS rows for this name may need checking.
                </span>
              </div>
            )}

            <div className="max-h-[360px] overflow-auto rounded-md border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Player</th>
                    <th className="px-3 py-2 text-left font-medium">Position</th>
                    <th className="px-3 py-2 text-left font-medium">Squad</th>
                    <th className="hidden px-3 py-2 text-left font-medium sm:table-cell">Competition</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(r => (
                    <tr key={r.id} className="border-t border-border" data-testid={`row-roster-${r.id}`}>
                      <td className="px-3 py-1.5 font-medium">
                        {r.playerName}
                        {isAmbiguous(r) && (
                          <Badge variant="outline" className="ml-2 border-amber-500/50 px-1.5 py-0 text-[10px] text-amber-700">
                            Name shared
                          </Badge>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono">{r.positionCode}</td>
                      <td className="px-3 py-1.5">{r.squad}</td>
                      <td className="hidden px-3 py-1.5 text-muted-foreground sm:table-cell">{r.leagueName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
