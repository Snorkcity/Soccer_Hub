import { useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useListGpsTraining, getListGpsTrainingQueryKey } from "@workspace/api-client-react";
import { TRAINING_PARTS } from "@workspace/api-zod";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { RefreshCw, Upload } from "lucide-react";
import { fmtDate, sessionKey, DEFAULT_TRAINING_FILTERS, type TrainingFilters, type SelectedPart } from "./shared";
import { PlayerTrainingOverview } from "./PlayerTrainingOverview";
import { TeamTrainingTab } from "./TeamTrainingTab";
import { CoachTrainingTab } from "./CoachTrainingTab";

export function TrainingView({ leagueId, year, sourceToggle }: { leagueId: number | null; year: string; sourceToggle?: ReactNode }) {
  const params = { leagueId: leagueId ?? 0, year };
  const q = useListGpsTraining(params, {
    query: { enabled: leagueId != null && leagueId > 0, queryKey: getListGpsTrainingQueryKey(params), staleTime: 0, refetchOnMount: "always" },
  });
  const { hasModule } = useLeagueModules();
  const canWrite = leagueId != null && hasModule(leagueId, "gps") && hasModule(leagueId, "data-entry");

  const sessions = useMemo(() => [...(q.data ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.version - b.version), [q.data]);
  const [tab, setTab] = useState("player");
  const [f, setF] = useState<TrainingFilters>(DEFAULT_TRAINING_FILTERS);
  const set = (p: Partial<TrainingFilters>) => setF(prev => ({ ...prev, ...p }));
  const current = sessions.find(s => sessionKey(s) === f.sessionId) ?? sessions[sessions.length - 1];
  const drill = (patch: Partial<TrainingFilters>, toTab?: string) => { set(patch); if (toTab) setTab(toTab); };

  const wrap = (body: ReactNode) => <div className="min-w-0 space-y-5">{sourceToggle}{body}</div>;
  if (q.isLoading) return wrap(
    <div className="space-y-4" data-testid="training-loading">
      <Skeleton className="h-16 w-full" /><Skeleton className="h-80 w-full" /><Skeleton className="h-48 w-full" />
    </div>
  );
  if (q.isError) return wrap(
    <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm" data-testid="training-error">
      <p className="font-semibold">Training GPS could not be loaded.</p>
      <p className="mt-1 text-muted-foreground">{(q.error as Error | null)?.message ?? "Unknown error"}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => void q.refetch()} data-testid="button-retry-training"><RefreshCw className="mr-1.5 h-4 w-4" />Retry</Button>
    </div>
  );
  if (!current) return wrap(
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center" data-testid="training-empty">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Training · {year}</p>
      <p className="mt-2 text-xl font-semibold">No training sessions recorded yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Upload a Catapult training export with Warm-up, Passing, Technical, Main and End game splits from the GPS area of Data Entry.</p>
      {canWrite && <Link href="/data-entry" className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-primary/50 px-3 py-1.5 text-sm text-primary hover:bg-primary/10" data-testid="link-upload-training"><Upload className="h-4 w-4" />Go to Data Entry</Link>}
    </div>
  );

  const label = "mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground";
  const partSelect = (
    <div className="w-full sm:w-56">
      <p className={label}>Period</p>
      <Select value={f.part} onValueChange={v => set({ part: v as SelectedPart })}>
        <SelectTrigger data-testid="select-training-part"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="full">Full session</SelectItem>
          {TRAINING_PARTS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end" data-testid="training-header">
        {sourceToggle}
        <div className="min-w-0 flex-1 sm:max-w-md">
          <p className={label}>Training session</p>
          <Select value={sessionKey(current)} onValueChange={v => set({ sessionId: v })}>
            <SelectTrigger data-testid="select-training-session"><SelectValue /></SelectTrigger>
            <SelectContent>{[...sessions].reverse().map(s => <SelectItem key={sessionKey(s)} value={sessionKey(s)}>{fmtDate(s.date)} · {s.title || "Training"}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full justify-start gap-1">
          <TabsTrigger value="player" data-testid="tab-training-player">Player</TabsTrigger>
          <TabsTrigger value="team" data-testid="tab-training-team">Team</TabsTrigger>
          <TabsTrigger value="coach" data-testid="tab-training-coach">Coach</TabsTrigger>
        </TabsList>
        {tab !== "coach" && <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card/40 p-3" data-testid="training-controls">
          {partSelect}
          {tab === "player" && <p className="pb-2 text-xs text-muted-foreground">Charts are grouped below; totals or per-minute and sort order are set on each chart.</p>}
          {tab === "team" && <p className="pb-2 text-xs text-muted-foreground">Totals or per-minute and sort order are set on each chart.</p>}
        </div>}
        <TabsContent value="player" className="mt-5">
          <PlayerTrainingOverview sessions={sessions} session={current} f={f} set={set} drill={drill} />
        </TabsContent>
        <TabsContent value="team" className="mt-5">
          <TeamTrainingTab sessions={sessions} session={current} f={f} set={set} drill={drill} />
        </TabsContent>
        <TabsContent value="coach" className="mt-5">
          <CoachTrainingTab sessions={sessions} session={current} f={f} drill={drill} canWrite={canWrite} />
        </TabsContent>
      </Tabs>
      {tab !== "coach" && <p className="text-[11px] text-muted-foreground">Training values are never normalised per 90. Per-minute rates divide by each recording's own duration. Goalkeepers are compared only with goalkeepers.</p>}
    </div>
  );
}
