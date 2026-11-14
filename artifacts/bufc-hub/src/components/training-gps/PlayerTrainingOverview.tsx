import { useMemo, useRef, useState } from "react";
import type { TrainingGpsSession } from "@workspace/api-client-react";
import { TRAINING_METRICS, trainingInsights, trainingPlayerKey } from "@workspace/api-zod";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  TRAINING_METRIC_GROUPS, canRate, fmtDate, partRows, playerMetricHistory, selectedPartLabel, sessionKey, sessionPlayers, sortPlayerMetricHistory,
  type PlayerHistorySort, type TrainingFilters,
} from "./shared";
import { PlayerMetricHistoryChart } from "./PlayerMetricHistoryChart";
import { PlayerTrainingTab } from "./PlayerTrainingTab";
import { EmptyChart, InsightList } from "./ui";

interface Props {
  sessions: TrainingGpsSession[]; session: TrainingGpsSession; f: TrainingFilters;
  set: (p: Partial<TrainingFilters>) => void; drill: (p: Partial<TrainingFilters>, tab?: string) => void;
}
type ChartPref = { sort: PlayerHistorySort; perMinute: boolean };
const DEFAULT_PREF: ChartPref = { sort: "date", perMinute: false };

export function PlayerTrainingOverview({ sessions, session, f, set, drill }: Props) {
  const players = useMemo(() => sessionPlayers(sessions), [sessions]);
  const inSession = useMemo(() => new Set(partRows(session).map(trainingPlayerKey)), [session]);
  const playerKey = f.playerKey && players.some(p => p.key === f.playerKey) ? f.playerKey : players.find(p => inSession.has(p.key))?.key ?? null;
  const player = players.find(p => p.key === playerKey);
  const [open, setOpen] = useState<Record<string, boolean>>({ running: true });
  const [prefs, setPrefs] = useState<Record<string, ChartPref>>({});
  const prefOf = (m: string) => prefs[m] ?? DEFAULT_PREF;
  const setPref = (m: string, p: Partial<ChartPref>) => setPrefs(s => ({ ...s, [m]: { ...(s[m] ?? DEFAULT_PREF), ...p } }));
  const [deep, setDeep] = useState<{ metric: string; perMinute: boolean }>({ metric: "distance", perMinute: false });
  const detailRef = useRef<HTMLDetailsElement>(null);
  const insights = useMemo(() => playerKey ? trainingInsights(session, playerKey, sessions) : [], [session, playerKey, sessions]);
  const period = selectedPartLabel(f.part);
  const currentKey = sessionKey(session);
  const tracked = playerKey ? playerMetricHistory(sessions, playerKey, f.part, "duration", false).length : 0;
  const openSession = (key: string, metric: string, perMinute: boolean) => {
    setDeep({ metric, perMinute });
    drill({ sessionId: key, playerKey });
    if (detailRef.current) detailRef.current.open = true;
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select value={playerKey ?? ""} onValueChange={v => set({ playerKey: v })}>
          <SelectTrigger className="sm:w-80" data-testid="select-training-player"><SelectValue placeholder="Choose a player" /></SelectTrigger>
          <SelectContent>{players.map(p => <SelectItem key={p.key} value={p.key}>{p.name}{p.position ? ` · ${p.position}` : ""}{p.squad ? ` · ${p.squad}` : ""}{inSession.has(p.key) ? "" : " (not in this session)"}</SelectItem>)}</SelectContent>
        </Select>
        {player && <p className="text-xs text-muted-foreground" data-testid="text-player-identity">{player.group}{player.key.startsWith("source:") ? " · not linked to roster" : ""}</p>}
      </div>

      {!player ? <EmptyChart>Pick a player to see their training output.</EmptyChart> : <>
        <p className="text-xs text-muted-foreground" data-testid="text-player-period">
          <span className="text-foreground">{player.name}</span> · <span className="text-foreground">{period}</span>{f.part === "full" ? " (five marked parts, uncut recording excluded)" : ""} · {tracked} tracked session{tracked === 1 ? "" : "s"} this season. Each chart has its own sort and Total or /min switch, top right.
        </p>

        <div className="space-y-3" data-testid="player-metric-charts">
          {TRAINING_METRIC_GROUPS.map(g => {
            const isOpen = !!open[g.id];
            return (
              <section key={g.id} className="rounded-xl border border-border bg-card/40" data-testid={`group-player-${g.id}`}>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [g.id]: !o[g.id] }))}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`button-toggle-player-group-${g.id}`}>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{g.label} <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{g.metrics.length} charts</span></span>
                    <span className="block truncate text-xs text-muted-foreground">{g.blurb}</span>
                  </span>
                  {isOpen ? <ChevronUp className="h-5 w-5 shrink-0 text-primary" /> : <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />}
                </button>
                {isOpen && <div className="space-y-4 border-t border-border p-2 sm:p-3">
                  {g.metrics.map(m => {
                    const p = prefOf(m);
                    const pm = p.perMinute && canRate(m);
                    const items = sortPlayerMetricHistory(playerMetricHistory(sessions, player.key, f.part, m, pm), p.sort);
                    return <PlayerMetricHistoryChart key={m} metric={m} items={items} pm={pm} playerName={player.name} periodLabel={period}
                      currentKey={currentKey} sort={p.sort} onSort={s => setPref(m, { sort: s })} onRate={v => setPref(m, { perMinute: v })} onPick={key => openSession(key, m, pm)} />;
                  })}
                </div>}
              </section>
            );
          })}
        </div>

        <details ref={detailRef} className="group rounded-xl border border-border bg-card/40" data-testid="details-player-deeper">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="button-toggle-player-deeper">
            <span>Deeper analysis <span className="font-normal text-muted-foreground">· {fmtDate(session.date)}: five-part peers, whole-session trend</span></span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-5 p-3 sm:p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full sm:w-64">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Metric for deeper analysis</p>
                <Select value={deep.metric} onValueChange={metric => setDeep(d => ({ ...d, metric }))}>
                  <SelectTrigger data-testid="select-player-deeper-metric"><SelectValue /></SelectTrigger>
                  <SelectContent>{TRAINING_METRICS.map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <label className={`flex items-center gap-2 pb-2 text-xs ${canRate(deep.metric) ? "" : "opacity-50"}`} title={canRate(deep.metric) ? "" : "Not a rate metric"}>
                <Switch checked={deep.perMinute && canRate(deep.metric)} disabled={!canRate(deep.metric)} onCheckedChange={perMinute => setDeep(d => ({ ...d, perMinute }))} data-testid="switch-player-deeper-per-minute" />
                <span>{deep.perMinute && canRate(deep.metric) ? "Per minute" : "Totals"}</span>
              </label>
            </div>
            <PlayerTrainingTab sessions={sessions} session={session} f={{ ...f, playerKey: player.key, metric: deep.metric, perMinute: deep.perMinute }}
              set={set} drill={patch => drill({ ...patch, playerKey: player.key })} hidePlayerSelector hideInsights />
          </div>
        </details>
        <InsightList insights={insights} testId="insights-player" />
      </>}
    </div>
  );
}
