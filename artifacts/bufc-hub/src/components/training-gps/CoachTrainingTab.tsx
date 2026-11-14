import { useMemo } from "react";
import type { TrainingGpsSession } from "@workspace/api-client-react";
import { TRAINING_PARTS, trainingMean, trainingPartLabel, trainingTimetable } from "@workspace/api-zod";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { C, PART_COLORS, coachPeriod, fmtClock, fmtDate, selectedPartLabel, sessionKey, type SelectedPart, type TrainingFilters } from "./shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyChart, Note, Panel, Stat, axisProps, tooltipStyle } from "./ui";
import { PlanEditor } from "./PlanEditor";
import { CoachSessionMomentum } from "./CoachSessionMomentum";

interface Props {
  sessions: TrainingGpsSession[]; session: TrainingGpsSession; f: TrainingFilters;
  drill: (p: Partial<TrainingFilters>, tab?: string) => void; canWrite: boolean;
}
const m1 = (sec: number | null | undefined) => sec == null ? "—" : `${(sec / 60).toFixed(1)} min`;

function account(s: TrainingGpsSession) {
  const tt = trainingTimetable(s).filter(t => t.startSeconds != null && t.endSeconds != null).sort((a, b) => a.startSeconds! - b.startSeconds!);
  const all = trainingTimetable(s);
  const included = all.reduce((a, t) => a + (t.durationSeconds ?? 0), 0);
  let gaps = 0, overlap = 0;
  for (let i = 1; i < tt.length; i++) { const g = tt[i].startSeconds! - tt[i - 1].endSeconds!; if (g > 0) gaps += g; else overlap += -g; }
  const planned = s.plannedMinutes * 60;
  let leading: number | null = null, trailing: number | null = null;
  if (s.scheduledStartTime && tt.length) {
    const [h, m] = s.scheduledStartTime.split(":").map(Number);
    const sched = h * 3600 + m * 60;
    const first = tt[0].startSeconds! % 86400, last = tt[tt.length - 1].endSeconds! % 86400;
    leading = first - sched; trailing = sched + planned - last;
  }
  return { tt, all, included, gaps, overlap, planned, outside: planned - included, leading, trailing };
}

export function CoachTrainingTab({ sessions, session, f, drill, canWrite }: Props) {
  const a = useMemo(() => account(session), [session]);
  const origin = a.tt[0]?.startSeconds ?? 0;
  const span = a.tt.length ? Math.max(...a.tt.map(t => t.endSeconds!)) - origin : 0;
  const scale = Math.max(span, 1);
  const label = selectedPartLabel(f.part);
  const sessionContext = `${fmtDate(session.date)} · ${session.title || "Training"}`;
  const context = `${fmtDate(session.date)} · Selected: ${label} · Duration (minutes)`;

  const durations = sessions.map(s => {
    const period = coachPeriod(s, f.part);
    return { id: sessionKey(s), date: fmtDate(s.date), min: period.durationSeconds != null ? period.durationSeconds / 60 : null, planMin: period.planMin, planMax: period.planMax, players: period.players };
  });
  const present = durations.filter(d => d.min != null);
  const avg = trainingMean(present.map(d => d.min));
  const anyPlan = durations.some(d => d.planMin != null);

  const stacked = sessions.map(s => {
    const acc = account(s);
    const d: Record<string, number | string | null> = { id: sessionKey(s), date: fmtDate(s.date) };
    for (const t of acc.all) d[t.part] = t.durationSeconds != null ? +(t.durationSeconds / 60).toFixed(2) : null;
    d.outside = acc.outside > 0 ? +(acc.outside / 60).toFixed(2) : 0;
    return d;
  });
  const curAllowance = session.allowances.find(x => x.part === f.part);
  const curDur = coachPeriod(session, f.part).durationSeconds;

  return (
    <div className="min-w-0 max-w-full space-y-5">
      <Panel testId="chart-coach-timeline" kicker="All five parts · recorded clocks" title="Marked-part timeline" context={`${sessionContext} · All five parts`}>
        {a.tt.length === 0 ? <EmptyChart>No marked part clocks in this export.</EmptyChart> : <>
          <p className="mb-3 text-[11px] text-muted-foreground">Click a coloured part to select it and see its duration history below.</p>
          <div className="relative h-16 w-full min-w-0 max-w-full overflow-hidden rounded-lg bg-muted/40" role="group" aria-label="Session timeline">
            <div className="absolute inset-x-1 top-0 bottom-0" data-testid="coach-timeline-track">
            {a.tt.map((t, i) => {
              const left = ((t.startSeconds! - origin) / scale) * 100, width = ((t.endSeconds! - t.startSeconds!) / scale) * 100;
              return (
                <button key={t.part} onClick={() => drill({ part: t.part })} data-testid={`timeline-part-${t.part}`}
                  className={`absolute top-2 bottom-2 min-w-0 overflow-hidden rounded-md text-left text-[10px] font-semibold text-background transition-opacity hover:opacity-90 ${f.part === "full" || f.part === t.part ? "ring-2 ring-foreground" : ""}`}
                  style={{ left: `${left}%`, width: `${Math.min(Math.max(width, 0.8), 100 - left)}%`, background: PART_COLORS[t.part] }}
                  aria-label={`${t.label}: ${fmtClock(t.startSeconds)}–${fmtClock(t.endSeconds)}`}
                  title={`${t.label}: ${fmtClock(t.startSeconds)}–${fmtClock(t.endSeconds)}`}>
                  <span className="hidden whitespace-normal break-words px-1.5 leading-tight sm:block">{width > 8 ? t.label : i + 1}</span>
                  <span className="block text-center sm:hidden">{i + 1}</span>
                </button>
              );
            })}
            </div>
          </div>
          <ol className="mt-4 divide-y divide-border/60 text-sm">
            {a.tt.map((t, i) => {
              const gap = i > 0 ? t.startSeconds! - a.tt[i - 1].endSeconds! : null;
              return (
                <li key={t.part} className="py-1.5">
                  {gap != null && gap !== 0 && <p className="pb-1.5 font-mono text-[11px] text-muted-foreground">{gap > 0 ? `gap ${m1(gap)} between marked parts` : `overlap ${m1(-gap)}`}</p>}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                    <span className="inline-flex w-44 items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: PART_COLORS[t.part] }} />{t.label}</span>
                    <span className="font-mono text-xs">{fmtClock(t.startSeconds)} – {fmtClock(t.endSeconds)}</span>
                    <span className="font-mono text-xs text-muted-foreground">{m1(t.durationSeconds)} · {t.playerCount} players</span>
                  </div>
                </li>
              );
            })}
          </ol>
          {a.all.length > a.tt.length && <Note tone="watch">{a.all.length - a.tt.length} part(s) have no recorded clock and are counted in durations only.</Note>}
        </>}
      </Panel>

      <Panel testId="panel-ninety-accounting" kicker="Full session · planned and marked time" title={`${session.plannedMinutes}-minute accounting`} context={`${sessionContext} · Full session`}>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Inside marked parts" value={m1(a.included)} sub={`${a.all.length} of 5 parts marked`} testId="stat-included" />
          <Stat label="Gaps between parts" value={m1(a.gaps)} sub={a.overlap ? `Overlap ${m1(a.overlap)}` : "Between recorded clocks"} testId="stat-gaps" />
          <Stat label={a.outside >= 0 ? "Outside marked parts" : "Beyond planned time"} value={m1(Math.abs(a.outside))} sub={a.outside >= 0 ? "Planned minus marked" : "Marked parts exceed plan"} testId="stat-outside" />
          {a.leading != null ? (
            <Stat label="Before first / after last" value={`${m1(a.leading)} / ${m1(a.trailing)}`} sub={`From scheduled ${session.scheduledStartTime}`} testId="stat-lead-trail" />
          ) : (
            <Stat label="Unlocated outside time" value={m1(Math.max(0, a.outside - a.gaps))} sub="No scheduled start saved" testId="stat-unlocated" />
          )}
        </div>
        <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-muted">
          {a.all.map(t => <div key={t.part} style={{ width: `${((t.durationSeconds ?? 0) / Math.max(a.planned, a.included)) * 100}%`, background: PART_COLORS[t.part] }} />)}
        </div>
        {a.leading == null && <p className="mt-2 text-[11px] text-muted-foreground">Without a confirmed scheduled start, time outside the marked parts cannot be placed before, between or after them — beyond the internal gaps shown above.</p>}
      </Panel>

      <CoachSessionMomentum session={session} selectedPart={f.part} onPick={part => drill({ part })} />

      <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-2 [&>section]:min-w-0">
        <Panel testId="chart-part-durations" kicker="Selected period" title={`${label} duration over dates`} context={context}
          aside={<div className="flex w-full flex-col gap-2 sm:w-56 sm:shrink-0">
            <label htmlFor="coach-history-period" className="text-[10px] uppercase tracking-wider text-muted-foreground">Period for duration history</label>
            <Select value={f.part} onValueChange={v => drill({ part: v as SelectedPart })}>
              <SelectTrigger id="coach-history-period" data-testid="select-coach-history-part"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full session</SelectItem>
                {TRAINING_PARTS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="font-mono text-xs text-muted-foreground">avg {avg == null ? "—" : `${avg.toFixed(1)} min`} · n={present.length}</span>
          </div>}>
          {present.length === 0 ? <EmptyChart>{f.part === "full" ? "No complete five-part timetable recorded yet." : `${label} has not been marked yet.`}</EmptyChart> : (
            <div className="h-72">
              <ResponsiveContainer>
                <ComposedChart data={durations} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                  onClick={(e: { activePayload?: { payload: { id: string } }[] } | null) => { const id = e?.activePayload?.[0]?.payload.id; if (id) drill({ sessionId: id }); }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
                  <XAxis dataKey="date" {...axisProps} />
                  <YAxis {...axisProps} width={40} unit="m" />
                  <Tooltip {...tooltipStyle} formatter={(v: number, name: string, item: { payload?: { players: number } }) =>
                    [`${Number(v).toFixed(1)} min`, name === "min" ? `Marked duration (${item.payload?.players} players)` : f.part === "full" ? "Planned session length" : name === "planMin" ? "Planned minimum" : "Planned maximum"]} />
                  <Bar dataKey="min" fill={f.part === "full" ? C.primary : PART_COLORS[f.part]} radius={[4, 4, 0, 0]} />
                  {anyPlan && <Line dataKey="planMin" stroke="#C1C1C1" strokeDasharray="4 3" dot={{ r: 3 }} connectNulls={false} />}
                  {anyPlan && <Line dataKey="planMax" stroke="#C1C1C1" strokeDasharray="4 3" dot={{ r: 3 }} connectNulls={false} />}
                  {avg != null && <ReferenceLine y={avg} stroke={C.orange} strokeDasharray="6 4" label={{ value: `avg ${avg.toFixed(1)}`, fill: C.orange, fontSize: 10, position: "insideTopRight" }} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">Click a date's bar or point to open that session.</p>
          {f.part === "full" ? (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="text-plan-compare">Full session = the combined duration of the five marked parts, not the uncut recording or the sum of player minutes. Planned session: {session.plannedMinutes} min; time in marked parts: {m1(curDur)}. Sessions missing a part or duration are excluded from this trend and average. The planned-length line includes time outside parts; it is not an active-time target.</p>
          ) : curAllowance ? (
            <p className="mt-2 text-xs text-muted-foreground" data-testid="text-plan-compare">Saved plan for {fmtDate(session.date)}: {curAllowance.minMinutes}–{curAllowance.maxMinutes} min. Marked: {m1(curDur)}{curDur != null ? ` — ${curDur / 60 < curAllowance.minMinutes ? "below" : curDur / 60 > curAllowance.maxMinutes ? "above" : "within"} range` : ""}.</p>
          ) : <p className="mt-2 text-[11px] text-muted-foreground">No planned range saved for this part on this date.</p>}
        </Panel>

        <Panel testId="chart-stacked-allocation" kicker="Allocation · all five parts and outside time" title="Minutes per part across sessions" context="All tracked sessions · All five parts · Duration (minutes)"
          aside={<span className="text-[11px] text-muted-foreground">Click a bar to open that date</span>}>
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={stacked} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                onClick={(e: { activePayload?: { payload: { id: string } }[] } | null) => { const id = e?.activePayload?.[0]?.payload.id; if (id) drill({ sessionId: id }); }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
                <XAxis dataKey="date" {...axisProps} />
                <YAxis {...axisProps} width={40} unit="m" />
                <Tooltip {...tooltipStyle} formatter={(v: number, name: string) => [`${Number(v).toFixed(1)} min`, name === "outside" ? "Outside marked parts" : trainingPartLabel(name)]} />
                <Legend formatter={(v: string) => v === "outside" ? "Outside parts" : trainingPartLabel(v)} wrapperStyle={{ fontSize: 11 }} />
                {TRAINING_PARTS.map(p => <Bar key={p.id} dataKey={p.id} stackId="a" fill={PART_COLORS[p.id]} />)}
                <Bar dataKey="outside" stackId="a" fill={C.muted} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {session.warnings.length > 0 && <Note tone="watch">{session.warnings.join(" ")}</Note>}
      {canWrite && session.id != null && <PlanEditor key={`${session.id}-${session.version}`} session={session} />}
    </div>
  );
}
