import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListGpsTraining, getListGpsTrainingQueryKey } from "@workspace/api-client-react";
import { TRAINING_METRICS, TRAINING_PARTS } from "@workspace/api-zod";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { RefreshCw, Upload } from "lucide-react";
import { canRate, fmtDate, sessionKey, type TrainingFilters, type SelectedPart } from "./shared";
import { PlayerTrainingTab } from "./PlayerTrainingTab";
import { TeamTrainingTab } from "./TeamTrainingTab";
import { CoachTrainingTab } from "./CoachTrainingTab";

export function TrainingView({ leagueId, year }: { leagueId: number | null; year: string }) {
  const params = { leagueId: leagueId ?? 0, year };
  const q = useListGpsTraining(params, {
    query: { enabled: leagueId != null && leagueId > 0, queryKey: getListGpsTrainingQueryKey(params), staleTime: 0, refetchOnMount: "always" },
  });
  const { hasModule } = useLeagueModules();
  const canWrite = leagueId != null && hasModule(leagueId, "gps") && hasModule(leagueId, "data-entry");

  const sessions = useMemo(() => [...(q.data ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.version - b.version), [q.data]);
  const [tab, setTab] = useState("player");
  const [f, setF] = useState<TrainingFilters>({
    sessionId: null, metric: "distance", perMinute: false, part: "main", playerKey: null, squad: "all", position: "outfield",
  });
  const set = (p: Partial<TrainingFilters>) => setF(prev => ({ ...prev, ...p }));
  const current = sessions.find(s => sessionKey(s) === f.sessionId) ?? sessions[sessions.length - 1];
  const drill = (patch: Partial<TrainingFilters>, toTab?: string) => { set(patch); if (toTab) setTab(toTab); };

  if (q.isLoading) return (
    <div className="space-y-4" data-testid="training-loading">
      <Skeleton className="h-16 w-full" /><Skeleton className="h-80 w-full" /><Skeleton className="h-48 w-full" />
    </div>
  );
  if (q.isError) return (
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm" data-testid="training-error">
      <p className="font-semibold">Training GPS could not be loaded.</p>
      <p className="mt-1 text-muted-foreground">{(q.error as Error | null)?.message ?? "Unknown error"}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()} data-testid="button-retry-training"><RefreshCw className="mr-1.5 h-4 w-4" />Retry</Button>
    </div>
  );
  if (!current) return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center" data-testid="training-empty">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Training · {year}</p>
      <p className="mt-2 text-xl font-semibold">No training sessions recorded yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Upload a Catapult training export with Warm-up, Passing, Technical, Main and End game splits from the GPS area of Data Entry.</p>
      {canWrite && <Link href="/data-entry" className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-primary/50 px-3 py-1.5 text-sm text-primary hover:bg-primary/10" data-testid="link-upload-training"><Upload className="h-4 w-4" />Go to Data Entry</Link>}
    </div>
  );

  const rateOk = canRate(f.metric);
  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-20 -mx-1 grid grid-cols-2 gap-2 rounded-xl border border-border bg-background/90 p-3 backdrop-blur md:grid-cols-[1.3fr_1.4fr_1fr_auto]" data-testid="training-controls">
        <div className="col-span-2 md:col-span-1">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Session</p>
          <Select value={sessionKey(current)} onValueChange={v => set({ sessionId: v })}>
            <SelectTrigger data-testid="select-training-session"><SelectValue /></SelectTrigger>
            <SelectContent>{[...sessions].reverse().map(s => <SelectItem key={sessionKey(s)} value={sessionKey(s)}>{fmtDate(s.date)} · {s.title || "Training"}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="col-span-2 md:col-span-1">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Metric</p>
          <Select value={f.metric} onValueChange={v => set({ metric: v })}>
            <SelectTrigger data-testid="select-training-metric"><SelectValue /></SelectTrigger>
            <SelectContent>{TRAINING_METRICS.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Part / session</p>
          <Select value={f.part} onValueChange={v => set({ part: v as SelectedPart })}>
            <SelectTrigger data-testid="select-training-part"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Full session</SelectItem>
              {TRAINING_PARTS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <label className={`flex items-end gap-2 pb-2 text-sm ${rateOk ? "" : "opacity-50"}`} title={rateOk ? "" : "Not a rate metric"}>
          <Switch checked={f.perMinute && rateOk} disabled={!rateOk} onCheckedChange={v => set({ perMinute: v })} data-testid="switch-per-minute" />
          <span>{f.perMinute && rateOk ? "Per minute" : "Totals"}</span>
        </label>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full justify-start gap-1">
          <TabsTrigger value="player" data-testid="tab-training-player">Player</TabsTrigger>
          <TabsTrigger value="team" data-testid="tab-training-team">Team</TabsTrigger>
          <TabsTrigger value="coach" data-testid="tab-training-coach">Coach</TabsTrigger>
        </TabsList>
        <TabsContent value="player" className="mt-5">
          <PlayerTrainingTab sessions={sessions} session={current} f={f} set={set} drill={drill} />
        </TabsContent>
        <TabsContent value="team" className="mt-5">
          <TeamTrainingTab sessions={sessions} session={current} f={f} set={set} drill={drill} />
        </TabsContent>
        <TabsContent value="coach" className="mt-5">
          <CoachTrainingTab sessions={sessions} session={current} f={f} drill={drill} canWrite={canWrite} />
        </TabsContent>
      </Tabs>
      <p className="text-[11px] text-muted-foreground">Training values are never normalised per 90. Per-minute rates divide by each recording's own duration. Goalkeepers are compared only with goalkeepers.</p>
    </div>
  );
}
