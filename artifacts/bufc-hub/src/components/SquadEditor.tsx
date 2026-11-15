import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSeasonRoster, getGetSeasonRosterQueryKey,
  useSaveSeasonRosterPlayer, useDeleteSeasonRosterPlayer,
  type SeasonRosterPlayer, type SeasonRosterInput,
} from "@workspace/api-client-react";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

const POSITIONS: SeasonRosterInput["positionCode"][] = ["GK", "CB", "FB", "WB", "D", "DM", "CM", "AM", "AM/F", "W", "F", "ST"];
function errorText(err: unknown): string {
  const e = err as { data?: { error?: string }; message?: string };
  return e.data?.error ?? e.message ?? "Could not save the squad change.";
}

export function SquadEditor({ seasonId, leagueId, year, leagueName }: {
  seasonId: number; leagueId: number; year: string; leagueName: string;
}) {
  const client = useQueryClient();
  const params = { leagueId, year };
  const roster = useGetSeasonRoster(params, {
    query: { queryKey: getGetSeasonRosterQueryKey(params), staleTime: 0 },
  });
  // The GPS read endpoint also returns shared squads. Only this campaign is editable here.
  const rows = useMemo(() => (roster.data ?? []).filter(r => r.seasonId === seasonId)
    .sort((a, b) => a.playerName.localeCompare(b.playerName)), [roster.data, seasonId]);
  const defaultSquad = rows[0]?.squad ?? (/U23/i.test(leagueName) ? "U23" : "1sts");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [position, setPosition] = useState<SeasonRosterInput["positionCode"]>("CM");
  const [squad, setSquad] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const clear = () => { setEditingId(null); setName(""); setPosition("CM"); setSquad(null); };
  const refresh = () => client.invalidateQueries({ queryKey: getGetSeasonRosterQueryKey() });
  const save = useSaveSeasonRosterPlayer({ mutation: {
    onSuccess: async () => { await refresh(); clear(); setMessage("Squad entry saved."); },
    onError: err => setError(errorText(err)),
  } });
  const remove = useDeleteSeasonRosterPlayer({ mutation: {
    onSuccess: async () => { await refresh(); clear(); setMessage("Removed from the squad. Recorded match and GPS data are unchanged."); },
    onError: err => setError(errorText(err)),
  } });
  const busy = save.isPending || remove.isPending;
  const edit = (row: SeasonRosterPlayer) => {
    setEditingId(row.id); setName(row.playerName);
    setPosition(row.positionCode as SeasonRosterInput["positionCode"]); setSquad(row.squad);
    setMessage(""); setError("");
  };
  return (
    <Card data-testid="squad-editor">
      <CardHeader>
        <CardTitle>{year} · {leagueName} squad</CardTitle>
        <CardDescription>
          Manage this team’s players, positions and squad labels here. Shared GPS squads remain separate:
          select the U23 competition above to manage its players.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {roster.isLoading ? <p className="text-sm text-muted-foreground">Loading squad…</p> : roster.isError ? (
          <div role="alert" className="text-sm">
            Could not load this squad. <Button variant="outline" size="sm" onClick={() => roster.refetch()}>Retry</Button>
          </div>
        ) : <>
          <form className="space-y-3 rounded-lg border p-4" onSubmit={e => {
            e.preventDefault(); setError(""); setMessage("");
            save.mutate({ data: {
              ...(editingId == null ? {} : { id: editingId }), seasonId,
              playerName: name.trim(), squad: (squad ?? defaultSquad).trim(), positionCode: position,
            } });
          }}>
            <h3 className="text-sm font-semibold">{editingId == null ? "Add player" : "Edit player"}</h3>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
              <label className="space-y-1 text-xs">Player name
                <Input className="mt-1" required maxLength={100} value={name} onChange={e => setName(e.target.value)}
                  placeholder="e.g. C.Moir" disabled={busy} data-testid="input-squad-name" />
              </label>
              <label className="space-y-1 text-xs">Position
                <Select value={position} onValueChange={v => setPosition(v as typeof position)} disabled={busy}>
                  <SelectTrigger className="mt-1" aria-label="Squad player position" data-testid="select-squad-position"><SelectValue /></SelectTrigger>
                  <SelectContent>{POSITIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="space-y-1 text-xs">Squad
                <Input className="mt-1" required maxLength={60} value={squad ?? defaultSquad}
                  onChange={e => setSquad(e.target.value)} disabled={busy} data-testid="input-squad-grade" />
              </label>
            </div>
            <p className="text-xs text-muted-foreground">Use distinct names for different players. Changes here do not rename or rewrite historical match or GPS records.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy || !name.trim() || !(squad ?? defaultSquad).trim()} data-testid="button-save-squad">
                {save.isPending ? "Saving…" : editingId == null ? "Add player" : "Save changes"}
              </Button>
              {editingId != null && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={clear}>Cancel edit</Button>}
            </div>
          </form>
          <p className="text-sm text-muted-foreground">{rows.length} player{rows.length === 1 ? "" : "s"} in this campaign</p>
          {rows.length === 0 ? <p className="text-sm">No squad entered yet. Add the first player above.</p> : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr><th className="p-3 text-left">Player</th><th className="p-3 text-left">Position</th><th className="p-3 text-left">Squad</th><th className="p-3 text-right">Actions</th></tr>
                </thead>
                <tbody>{rows.map(row => (
                  <tr key={row.id} className="border-t" data-testid={`squad-player-${row.id}`}>
                    <td className="p-3 font-medium">{row.playerName}</td>
                    <td className="p-3">{row.positionCode}</td><td className="p-3">{row.squad}</td>
                    <td className="p-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => edit(row)} aria-label={`Edit ${row.playerName}`}>Edit</Button>
                        <Button size="sm" variant="ghost" className="text-destructive" disabled={busy}
                          aria-label={`Remove ${row.playerName}`}
                          onClick={() => {
                            if (!window.confirm(`Remove ${row.playerName} from this ${year} squad? Recorded match and GPS data will not be deleted.`)) return;
                            setError(""); setMessage(""); remove.mutate({ data: { id: row.id, seasonId } });
                          }}>Remove</Button>
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>}
        {message && <p role="status" className="text-sm text-primary">{message}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
