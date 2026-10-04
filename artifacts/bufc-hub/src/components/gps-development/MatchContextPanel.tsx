import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSaveGpsDevelopmentMatchContext, GpsDevelopmentContextInputRole, GpsDevelopmentContextInputMatchType } from "@workspace/api-client-react";
import type { GpsDevelopmentGame, GpsDevelopmentProfile } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { fmtDate } from "./EvidencePanels";

const ROLES = Object.values(GpsDevelopmentContextInputRole) as string[];
const TYPES = Object.values(GpsDevelopmentContextInputMatchType) as string[];
const UNSET = "__unset";

function Row({ game, leagueId, playerName, canEdit }: { game: GpsDevelopmentGame; leagueId: number; playerName: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const save = useSaveGpsDevelopmentMatchContext();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState(game.role && ROLES.includes(game.role) ? game.role : UNSET);
  const [type, setType] = useState<string>(game.matchType);
  const [comparable, setComparable] = useState(game.comparable);

  const submit = () => {
    save.mutate(
      {
        data: {
          leagueId, playerName, year: game.year, round: game.round,
          role: role === UNSET ? null : (role as GpsDevelopmentContextInputRole),
          matchType: type as GpsDevelopmentContextInputMatchType,
          comparable,
        },
      },
      {
        onSuccess: () => {
          setEditing(false);
          qc.invalidateQueries({ predicate: q => q.queryKey[0] === "/api/gps-development" });
          toast({ title: "Match context saved", description: `${game.round} ${game.year}. GPS measurements unchanged.` });
        },
        onError: () => toast({ title: "Could not save match context", variant: "destructive" }),
      },
    );
  };

  return (
    <div className="rounded-md border p-3 text-sm space-y-2" data-testid={`row-game-${game.key}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{game.round} {game.year}</span>
        <span className="text-muted-foreground text-xs">{game.opponent ? `v ${game.opponent} | ` : ""}{fmtDate(game.date)} | {game.squad} | {game.mins == null ? "mins not recorded" : `${game.mins} min`}</span>
        <Badge variant={game.qualifies ? "default" : "outline"} className="text-[10px]">{game.qualifies ? "Qualifies" : "Does not qualify"}</Badge>
        {canEdit && !editing && <Button size="sm" variant="ghost" className="ml-auto h-7" onClick={() => setEditing(true)} data-testid={`button-edit-context-${game.key}`}>Edit context</Button>}
      </div>
      {!editing ? (
        <div className="text-xs text-muted-foreground">
          Role {game.role ?? "unknown"} ({game.roleSource}) | {game.matchType} match | {game.comparable ? "comparable" : "not comparable"}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] items-end">
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger aria-label="Role" data-testid={`select-role-${game.key}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>Role unknown</SelectItem>
              {ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger aria-label="Match type" data-testid={`select-type-${game.key}`}><SelectValue /></SelectTrigger>
            <SelectContent>{TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={comparable} onCheckedChange={v => setComparable(v === true)} data-testid={`check-comparable-${game.key}`} /> Comparable
          </label>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={save.isPending} data-testid={`button-save-context-${game.key}`}>{save.isPending ? "Saving" : "Save"}</Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={save.isPending}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MatchContextPanel({ profile, leagueId, canEdit }: { profile: GpsDevelopmentProfile; leagueId: number; canEdit: boolean }) {
  const games = [...profile.games].reverse();
  return (
    <Card data-testid="card-match-context">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Matches and context</CardTitle>
        <p className="text-xs text-muted-foreground">
          {games.length} match(es) across history. Role, match type and comparability decide what counts toward references; GPS measurements are never changed.
          {!canEdit && " Context is read-only here (not editable for this league or your access)."}
        </p>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[560px] overflow-y-auto">
        {games.length === 0 ? <p className="text-sm text-muted-foreground">No matches recorded for this player.</p> :
          games.map(g => <Row key={g.key} game={g} leagueId={leagueId} playerName={profile.playerName} canEdit={canEdit} />)}
      </CardContent>
    </Card>
  );
}
