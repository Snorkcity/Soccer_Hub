import { useMemo, useState } from "react";
import type { TrainingGpsSession } from "@workspace/api-client-react";
import { TRAINING_PARTS, trainingInsights, trainingPartLabel, trainingPlayerKey, trainingValue } from "@workspace/api-zod";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import {
  OVERLAY_COLORS, partIdFromLabel, fmtDate, fmtMetric, fmtMin, groupMean, groupWholeMean, matchesFilters, metricDef, metricUnit, partRows, sessionKey, usePM,
  type TrainingFilters, type PartId, C } from "./shared";
import { PartComparisonChart } from "./PartComparisonChart";
import { EmptyChart, InsightList, Panel, axisProps, tooltipStyle } from "./ui";

interface Props {
  sessions: TrainingGpsSession[]; session: TrainingGpsSession; f: TrainingFilters;
  set: (p: Partial<TrainingFilters>) => void; drill: (p: Partial<TrainingFilters>, tab?: string) => void;
}
const POSITIONS = ["outfield", "Defenders", "Midfielders", "Forwards", "Mixed / other", "Unassigned", "Goalkeepers"];

export function TeamTrainingTab({ sessions, session, f, set, drill }: Props) {
  const pm = usePM(f);
  const fmt = (v: number | null | undefined) => fmtMetric(f.metric, v, pm);
  const [overlay, setOverlay] = useState<string[]>([]);
  const [sort, setSort] = useState<{ col: "name" | "value" | "duration"; desc: boolean }>({ col: "value", desc: true });

  const all = partRows(session);
  const squads = useMemo(() => [...new Set(sessions.flatMap(s => partRows(s).map(r => r.squad ?? "Unassigned")))].sort(), [sessions]);
  const rows = all.filter(r => matchesFilters(r, f));
  const names = new Map(all.map(r => [trainingPlayerKey(r), r.playerName]));
  const filteredKeys = [...new Set(rows.map(trainingPlayerKey))];

  const profile = TRAINING_PARTS.map(p => {
    const g = groupMean(rows.filter(r => r.part === p.id), f.metric, pm);
    const d: Record<string, number | string | null> = { id: p.id, label: p.label, mean: g.mean, n: g.n };
    overlay.forEach((k, i) => { const r = all.find(x => x.part === p.id && trainingPlayerKey(x) === k); d[`o${i}`] = r ? trainingValue(r, f.metric, pm) : null; });
    return d;
  });

  const partList = rows.filter(r => r.part === f.part).map(r => ({
    key: trainingPlayerKey(r), name: r.playerName, squad: r.squad, pos: r.positionCode,
    value: trainingValue(r, f.metric, pm), duration: r.durationSeconds,
  }));
  const sorted = [...partList].sort((a, b) => {
    const dir = sort.desc ? -1 : 1;
    if (sort.col === "name") return dir * a.name.localeCompare(b.name);
    const av = a[sort.col], bv = b[sort.col];
    if (av == null) return 1; if (bv == null) return -1;
    return dir * (av - bv);
  });
  const maxV = Math.max(0, ...partList.map(p => p.value ?? 0));
  const contributors = partList.filter(p => p.value != null).length;

  const standing = filteredKeys.map(k => ({
    key: k, name: names.get(k) ?? k,
    cells: TRAINING_PARTS.map(p => {
      const vals = rows.filter(r => r.part === p.id).map(r => ({ k: trainingPlayerKey(r), v: trainingValue(r, f.metric, pm) })).filter(x => x.v != null) as { k: string; v: number }[];
      const mine = vals.find(x => x.k === k);
      if (!mine) return null;
      return { rank: vals.filter(x => x.v > mine.v).length + 1, n: vals.length };
    }),
  })).sort((a, b) => a.name.localeCompare(b.name));

  const history = sessions.map(s => {
    const filt = (r: Parameters<typeof matchesFilters>[0]) => matchesFilters(r, f);
    const w = groupWholeMean(s, f.metric, pm, filt);
    const p = groupMean(partRows(s).filter(r => r.part === f.part && filt(r)), f.metric, pm);
    return { id: sessionKey(s), date: fmtDate(s.date), whole: w.mean, wholeN: w.n, part: p.mean, partN: p.n };
  });

  const insights = useMemo(() => {
    const scope = (s: TrainingGpsSession) => ({ ...s, rows: s.rows.filter(r => matchesFilters(r, { squad: f.squad, position: f.position })) });
    return trainingInsights(scope(session), null, sessions.map(scope));
  }, [session, sessions, f.squad, f.position]);
  const toggleSort = (col: typeof sort.col) => setSort(s => ({ col, desc: s.col === col ? !s.desc : col !== "name" }));
  const SortIcon = ({ col }: { col: typeof sort.col }) => sort.col !== col ? null : sort.desc ? <ArrowDown className="inline h-3 w-3" /> : <ArrowUp className="inline h-3 w-3" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Select value={f.squad} onValueChange={v => set({ squad: v })}>
          <SelectTrigger className="w-40" data-testid="select-team-squad"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All squads</SelectItem>{squads.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={f.position} onValueChange={v => set({ position: v })}>
          <SelectTrigger className="w-48" data-testid="select-team-position"><SelectValue /></SelectTrigger>
          <SelectContent>{POSITIONS.map(p => <SelectItem key={p} value={p}>{p === "outfield" ? "All outfield" : p}</SelectItem>)}</SelectContent>
        </Select>
        <span className="self-center text-xs text-muted-foreground" data-testid="text-team-count">{filteredKeys.length} players in filter</span>
      </div>

      <Panel testId="chart-group-profile" kicker={fmtDate(session.date)} title="Group profile across the five parts"
        aside={<Select value="" onValueChange={v => setOverlay(o => o.includes(v) || o.length >= 3 ? o : [...o, v])}>
          <SelectTrigger className="w-52" data-testid="select-overlay-player"><SelectValue placeholder="Overlay a player (max 3)" /></SelectTrigger>
          <SelectContent>{[...names].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => <SelectItem key={k} value={k}>{n}</SelectItem>)}</SelectContent>
        </Select>}>
        {overlay.length > 0 && <div className="mb-3 flex flex-wrap gap-2">{overlay.map((k, i) => (
          <button key={k} onClick={() => setOverlay(o => o.filter(x => x !== k))} data-testid={`button-remove-overlay-${i}`}
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: OVERLAY_COLORS[i], color: OVERLAY_COLORS[i] }}>
            {names.get(k)}<X className="h-3 w-3" /></button>))}</div>}
        {rows.length === 0 ? <EmptyChart>No players match these filters.</EmptyChart> : (
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={profile} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
                onClick={(e: { activePayload?: { payload: { id: string } }[] } | null) => { const id = e?.activePayload?.[0]?.payload.id; if (id) set({ part: id as PartId }); }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
                <XAxis dataKey="label" {...axisProps} interval={0} tickFormatter={(l: string) => l.split(" ")[0]} className="cursor-pointer" onClick={(t: { value?: unknown }) => { const id = partIdFromLabel(t?.value); if (id) set({ part: id }); }} />
                <YAxis {...axisProps} width={48} />
                <Tooltip {...tooltipStyle} formatter={(v: number, name: string, item: { payload?: { n: number } }) =>
                  [fmt(v), name === "mean" ? `Participant mean (n=${item.payload?.n})` : names.get(overlay[Number(name.slice(1))]) ?? name]} />
                <Legend formatter={(v: string) => v === "mean" ? "Participant mean" : names.get(overlay[Number(v.slice(1))]) ?? v} wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="mean" stroke={C.primary} strokeWidth={3} dot={{ r: 5 }} />
                {overlay.map((_, i) => <Line key={i} dataKey={`o${i}`} stroke={OVERLAY_COLORS[i]} strokeWidth={2} dot={{ r: 4 }} />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">Scoped to the squad and position filter above; insights use the same scope. Participant mean: the arithmetic mean of each contributing player's own {pm ? "rate" : "value"}{pm ? " (not a pooled squad rate)" : ""}. Hover shows contributor counts.</p>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
        <Panel testId="table-part-comparison" kicker={trainingPartLabel(f.part)} title="Player comparison"
          aside={<span className="font-mono text-xs text-muted-foreground">{contributors} contributors · {metricUnit(f.metric, pm)}</span>}>
          {sorted.length === 0 ? <EmptyChart>Nobody in this filter recorded {trainingPartLabel(f.part)}.</EmptyChart> : (
            <>
            <PartComparisonChart fmt={fmt} onPick={k => drill({ playerKey: k }, "player")}
              data={sorted.map(p => ({ key: p.key, name: p.name, value: p.value, meta: `${p.pos ?? "No position"} · ${p.squad ?? "No squad"} · ${fmtMin(p.duration)}` }))} />
            <p className="mb-3 text-[11px] text-muted-foreground">Bars follow the table sort. Click a bar or name to open that player.</p>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="cursor-pointer py-2" onClick={() => toggleSort("name")} data-testid="sort-name">Player <SortIcon col="name" /></th>
                    <th className="cursor-pointer py-2" onClick={() => toggleSort("value")} data-testid="sort-value">{metricDef(f.metric).label} <SortIcon col="value" /></th>
                    <th className="hidden cursor-pointer py-2 text-right sm:table-cell" onClick={() => toggleSort("duration")} data-testid="sort-duration">Time <SortIcon col="duration" /></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(p => (
                    <tr key={p.key} className="border-t border-border/60 hover:bg-muted/30" data-testid={`row-team-player-${p.key}`}>
                      <td className="py-2 pr-2">
                        <button className="text-left hover:text-primary" onClick={() => drill({ playerKey: p.key }, "player")} data-testid={`link-player-${p.key}`}>{p.name}</button>
                        <p className="text-[10px] text-muted-foreground">{p.pos ?? "No position"} · {p.squad ?? "No squad"}</p>
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${maxV ? ((p.value ?? 0) / maxV) * 100 : 0}%` }} /></div>
                          <span className="w-28 shrink-0 text-right font-mono text-xs">{fmt(p.value)}</span>
                        </div>
                      </td>
                      <td className="hidden py-2 text-right font-mono text-xs text-muted-foreground sm:table-cell">{fmtMin(p.duration)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}
        </Panel>

        <Panel testId="table-relative-standing" kicker="Relative standing" title="Output rank within each part">
          {standing.length === 0 ? <EmptyChart>No players.</EmptyChart> : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="py-2 text-left">Player</th>{TRAINING_PARTS.map(p => <th key={p.id} className="px-1 py-2">{p.label.split(" ")[0]}</th>)}</tr>
                </thead>
                <tbody>{standing.map(s => (
                  <tr key={s.key} className="border-t border-border/60">
                    <td className="py-1.5 pr-2">{s.name}</td>
                    {s.cells.map((c, i) => {
                      const share = c ? 1 - (c.rank - 1) / Math.max(1, c.n - 1) : 0;
                      return <td key={i} className="px-1 py-1.5 text-center">
                        {c ? <span className="inline-block min-w-10 rounded px-1 py-0.5 font-mono" style={{ background: `rgba(97, 169, 189, ${0.12 + share * 0.6})` }}>{c.rank}/{c.n}</span> : <span className="text-muted-foreground">—</span>}
                      </td>;
                    })}
                  </tr>))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">Rank 1 = most recorded output among filtered participants. Ranks describe output only, not quality or effort.</p>
            </div>
          )}
        </Panel>
      </div>

      <Panel testId="chart-team-history" kicker="Historical comparison" title="Group means over dates" aside={<span className="text-[11px] text-muted-foreground">Click a date to open it</span>}>
        <div className="h-72">
          <ResponsiveContainer>
            <LineChart data={history} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}
              onClick={(e: { activePayload?: { payload: { id: string } }[] } | null) => { const id = e?.activePayload?.[0]?.payload.id; if (id) drill({ sessionId: id }); }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(206 59% 25%)" vertical={false} />
              <XAxis dataKey="date" {...axisProps} />
              <YAxis {...axisProps} width={48} />
              <Tooltip {...tooltipStyle} formatter={(v: number, name: string, item: { payload?: { wholeN: number; partN: number } }) =>
                [fmt(v), name === "whole" ? `Whole session, mean of complete player totals (n=${item.payload?.wholeN})` : `${trainingPartLabel(f.part)} mean (n=${item.payload?.partN})`]} />
              <Legend formatter={(v: string) => v === "whole" ? "Whole session (complete players)" : trainingPartLabel(f.part)} wrapperStyle={{ fontSize: 11 }} />
              <Line dataKey="whole" stroke={C.primary} strokeWidth={3} dot={{ r: 5 }} />
              <Line dataKey="part" stroke={C.tertiary} strokeWidth={2} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        {sessions.length === 1 && <p className="mt-2 text-[11px] text-muted-foreground">One session recorded — observed values only, no historical baseline.</p>}
      </Panel>

      <InsightList insights={insights} testId="insights-team" />
    </div>
  );
}
