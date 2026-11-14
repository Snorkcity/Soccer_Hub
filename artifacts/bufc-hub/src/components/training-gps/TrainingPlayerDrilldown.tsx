import { useMemo, useState } from "react";
import type { TrainingGpsSession } from "@workspace/api-client-react";
import { TRAINING_PARTS } from "@workspace/api-zod";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayerMetricHistoryChart } from "./PlayerMetricHistoryChart";
import { metricDrillAnalysis } from "./metricDrillAnalysis";
import {
  fmtDate, fmtMetric, metricDef, selectedPartLabel, sessionPlayers, sortPlayerMetricHistory,
  type PlayerHistorySort, type SelectedPart, type TrainingFilters,
} from "./shared";
import { Note, Stat } from "./ui";

interface Props {
  sessions: TrainingGpsSession[];
  initialFilters: TrainingFilters;
  onClose: () => void;
  onReturnFocus: () => void;
  /** Label of the view the coach returns to. */
  returnTo?: string;
}

const rankText = (r: { rank: number; n: number } | null) => r ? `${r.rank} of ${r.n}` : "No rank";

/** One focused metric for one player. All exploration is local; underlying views never change. */
export function TrainingPlayerDrilldown({ sessions, initialFilters, onClose, onReturnFocus, returnTo = "Team" }: Props) {
  const [f, setF] = useState(() => ({ ...initialFilters }));
  const set = (patch: Partial<TrainingFilters>) => setF(previous => ({ ...previous, ...patch }));
  const [sort, setSort] = useState<PlayerHistorySort>("date");
  const player = useMemo(() => sessionPlayers(sessions).find(p => p.key === f.playerKey), [sessions, f.playerKey]);
  const a = useMemo(() => metricDrillAnalysis(sessions, f), [sessions, f]);
  const def = metricDef(f.metric);
  const name = player?.name ?? "Player";
  const items = sortPlayerMetricHistory(a.history, sort);
  const currentKey = a.currentItem?.key ?? null;
  const period = selectedPartLabel(f.part);
  const sampleLabel = f.part === "full" ? "full-session" : period.toLowerCase();
  const cur = a.currentItem;
  const diff = cur?.value != null && !cur.partial && a.ownMean != null ? cur.value - a.ownMean : null;
  const slug = returnTo.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0"
        data-testid="dialog-training-player"
        onCloseAutoFocus={event => { event.preventDefault(); onReturnFocus(); }}>
        <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12 text-left sm:px-6">
          <Button variant="outline" size="sm" className="mb-2 w-fit" onClick={onClose} data-testid={`button-back-to-training-${slug}`}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />Back to {returnTo}
          </Button>
          <DialogTitle>{name} — {def.label}</DialogTitle>
          <DialogDescription>
            Focused evidence for this one metric across tracked training dates. Your {returnTo} view and settings stay unchanged.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-64">
              <label className="mb-1 block text-xs text-muted-foreground" id="drill-date-label">Session date</label>
              <Select value={currentKey ?? ""} onValueChange={sessionId => set({ sessionId })}>
                <SelectTrigger aria-labelledby="drill-date-label" data-testid="select-drilldown-session"><SelectValue placeholder="No tracked session" /></SelectTrigger>
                <SelectContent>{[...a.history].reverse().map(h => <SelectItem key={h.key} value={h.key}>{fmtDate(h.date)} · {h.title || "Training"}{h.partial ? " (partial)" : ""}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-56">
              <label className="mb-1 block text-xs text-muted-foreground" id="drill-part-label">Period</label>
              <Select value={f.part} onValueChange={part => set({ part: part as SelectedPart })}>
                <SelectTrigger aria-labelledby="drill-part-label" data-testid="select-drilldown-part"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full session</SelectItem>
                  {TRAINING_PARTS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="drilldown-stats">
            <Stat label={cur ? `Value · ${fmtDate(cur.date)}` : "Selected session"} value={fmtMetric(f.metric, cur?.value, a.pm)}
              sub={!cur ? "Player not tracked in this session" : cur.partial ? "Partial, excluded from stats and ranks" : diff == null ? undefined : `${diff >= 0 ? "+" : ""}${fmtMetric(f.metric, diff, a.pm)} vs own mean`} testId="stat-drill-current" />
            <Stat label="Own mean" value={fmtMetric(f.metric, a.ownMean, a.pm)} sub={`${a.validCount} valid ${sampleLabel} recording${a.validCount === 1 ? "" : "s"}`} testId="stat-drill-mean" />
            <Stat label="Own highest" value={fmtMetric(f.metric, a.highest, a.pm)} testId="stat-drill-highest" />
            <Stat label="Personal rank" value={rankText(a.personalRank)} sub="This date among own comparable recordings" testId="stat-drill-personal-rank" />
            <Stat label="Session rank" value={rankText(a.sessionRank)} sub={a.cohortLabel} testId="stat-drill-session-rank" />
            <Stat label="Season rank (mean)" value={rankText(a.seasonRank)}
              sub={a.seasonRank ? `Mean ${fmtMetric(f.metric, a.seasonRank.mean, a.pm)} over ${a.seasonRank.samples} session${a.seasonRank.samples === 1 ? "" : "s"}` : a.cohortLabel} testId="stat-drill-season-rank" />
          </div>

          <div className="space-y-2" data-testid="drilldown-notes">
            {a.validCount <= 1 && <Note tone="watch">{a.validCount === 0 ? `No valid ${sampleLabel} recordings yet, so personal stats are unavailable.` : `Only one valid ${sampleLabel} recording: personal mean, highest and rank describe a single date, not a pattern.`}</Note>}
            {cur && !a.sessionRank && <Note tone="watch">No session rank: {cur.partial || cur.value == null ? "this value is partial or missing" : "player falls outside the comparable group"} on {fmtDate(cur.date)}.</Note>}
            <Note>Ranks order recorded {period.toLowerCase()} values against {a.cohortLabel.toLowerCase()} ({a.seasonMeans.length} players in season ranking, each by their own mean per comparable session, sample sizes vary). Goalkeepers are ranked separately. Ranks describe measured values only; they are not effort or performance grades.</Note>
          </div>

          <PlayerMetricHistoryChart metric={f.metric} items={items} pm={a.pm} playerName={name} periodLabel={period}
            currentKey={currentKey} sort={sort} onSort={setSort} onRate={perMinute => set({ perMinute })}
            onPick={sessionId => set({ sessionId })} variant="popup" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
