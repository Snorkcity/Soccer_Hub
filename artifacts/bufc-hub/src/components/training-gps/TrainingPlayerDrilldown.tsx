import { useState } from "react";
import type { TrainingGpsSession } from "@workspace/api-client-react";
import { TRAINING_METRICS, TRAINING_PARTS } from "@workspace/api-zod";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PlayerTrainingTab } from "./PlayerTrainingTab";
import { canRate, metricDef, sessionKey, sessionPlayers, type SelectedPart, type TrainingFilters } from "./shared";

interface Props {
  sessions: TrainingGpsSession[];
  initialFilters: TrainingFilters;
  onClose: () => void;
  onReturnFocus: () => void;
}

/** Exploration stays local: neither the Team filters nor its mounted charts change. */
export function TrainingPlayerDrilldown({ sessions, initialFilters, onClose, onReturnFocus }: Props) {
  const [f, setF] = useState(() => ({ ...initialFilters }));
  const set = (patch: Partial<TrainingFilters>) => setF(previous => ({ ...previous, ...patch }));
  const current = sessions.find(s => sessionKey(s) === f.sessionId) ?? sessions.at(-1);
  const player = sessionPlayers(sessions).find(p => p.key === f.playerKey);
  const rateOk = canRate(f.metric);

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0"
        data-testid="dialog-training-player"
        onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }}>
        <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12 text-left sm:px-6">
          <Button variant="outline" size="sm" className="mb-2 w-fit" onClick={onClose} data-testid="button-back-to-training-team">
            <ArrowLeft className="mr-1.5 h-4 w-4" />Back to Team
          </Button>
          <DialogTitle>{player?.name ?? "Player"} — {metricDef(f.metric).label}</DialogTitle>
          <DialogDescription>
            Full-session history across tracked training dates in the selected league and season.
            Your Team view and settings stay unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-64">
              <p className="mb-1 text-xs text-muted-foreground">Metric</p>
              <Select value={f.metric} onValueChange={metric => set({ metric })}>
                <SelectTrigger data-testid="select-drilldown-metric"><SelectValue /></SelectTrigger>
                <SelectContent>{TRAINING_METRICS.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-56">
              <p className="mb-1 text-xs text-muted-foreground">Period for detailed comparison</p>
              <Select value={f.part} onValueChange={part => set({ part: part as SelectedPart })}>
                <SelectTrigger data-testid="select-drilldown-part"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full session</SelectItem>
                  {TRAINING_PARTS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <label className={`flex items-center gap-2 pb-2 text-sm ${rateOk ? "" : "opacity-50"}`}>
              <Switch checked={rateOk && f.perMinute} disabled={!rateOk} onCheckedChange={perMinute => set({ perMinute })}
                data-testid="switch-drilldown-per-minute" />
              <span>{rateOk && f.perMinute ? "Per minute" : rateOk ? "Totals" : "Not a rate metric"}</span>
            </label>
          </div>
          {current && <PlayerTrainingTab sessions={sessions} session={current} f={f} set={set} drill={set} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
