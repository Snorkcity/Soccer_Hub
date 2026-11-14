import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateGpsTrainingPlan, getListGpsTrainingQueryKey, type TrainingGpsSession, type TrainingGpsAllowance } from "@workspace/api-client-react";
import { TRAINING_PARTS } from "@workspace/api-zod";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Save } from "lucide-react";
import { Panel } from "./ui";
import { fmtDate } from "./shared";

type Row = { on: boolean; min: string; max: string };

export function PlanEditor({ session }: { session: TrainingGpsSession }) {
  const qc = useQueryClient();
  const update = useUpdateGpsTrainingPlan();
  const [planned, setPlanned] = useState(String(session.plannedMinutes));
  const [start, setStart] = useState(session.scheduledStartTime ?? "");
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(TRAINING_PARTS.map(p => {
    const a = session.allowances.find(x => x.part === p.id);
    return [p.id, { on: !!a, min: a ? String(a.minMinutes) : "", max: a ? String(a.maxMinutes) : "" }];
  })));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = () => {
    setError(null); setSaved(false);
    const pm = Number(planned);
    if (!Number.isInteger(pm) || pm < 1 || pm > 240) return setError("Planned minutes must be a whole number from 1 to 240.");
    if (start && !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) return setError("Scheduled start must be HH:mm (24-hour) or left empty.");
    const allowances: TrainingGpsAllowance[] = [];
    for (const p of TRAINING_PARTS) {
      const r = rows[p.id];
      if (!r.on) continue;
      const min = Number(r.min), max = Number(r.max);
      if (r.min === "" || r.max === "" || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 240 || min > max)
        return setError(`${p.label}: enter a minimum and maximum between 0 and 240, with minimum not above maximum.`);
      allowances.push({ part: p.id, minMinutes: min, maxMinutes: max });
    }
    if (session.id == null) return setError("This session has not been saved yet.");
    update.mutate({ id: session.id, data: {
      leagueId: session.leagueId, year: session.year, expectedVersion: session.version,
      plannedMinutes: pm, scheduledStartTime: start || null, allowances,
    } }, {
      onSuccess: () => { setSaved(true); void qc.invalidateQueries({ queryKey: getListGpsTrainingQueryKey({ leagueId: session.leagueId, year: session.year }) }); },
      onError: (e: unknown) => {
        const msg = (e as { message?: string })?.message ?? "Save failed.";
        setError(/409|version|conflict/i.test(msg) ? "Someone else changed this session. Reload the latest version before editing the plan." : msg);
      },
    });
  };

  return (
    <Panel testId="form-training-plan" kicker={`Plan · ${fmtDate(session.date)} · session revision ${session.version}`} title="Edit this session's plan">
      <p className="mb-4 text-xs text-muted-foreground">Changes apply only to this session's plan; GPS measurements are not touched. Earlier sessions keep their own saved plans.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Planned minutes
          <Input type="number" min={1} max={240} value={planned} onChange={e => setPlanned(e.target.value)} data-testid="input-planned-minutes" className="mt-1" />
        </label>
        <label className="text-sm">Scheduled start (HH:mm, optional)
          <Input type="time" value={start} onChange={e => setStart(e.target.value)} data-testid="input-scheduled-start" className="mt-1" />
        </label>
      </div>
      <div className="mt-4 space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Planned part ranges (minutes)</p>
        {TRAINING_PARTS.map(p => {
          const r = rows[p.id];
          const upd = (patch: Partial<Row>) => setRows(prev => ({ ...prev, [p.id]: { ...prev[p.id], ...patch } }));
          return (
            <div key={p.id} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={r.on} onCheckedChange={v => upd({ on: v === true })} data-testid={`checkbox-allowance-${p.id}`} />{p.label}
              </label>
              <Input type="number" placeholder="min" disabled={!r.on} value={r.min} onChange={e => upd({ min: e.target.value })} data-testid={`input-allowance-min-${p.id}`} />
              <Input type="number" placeholder="max" disabled={!r.on} value={r.max} onChange={e => upd({ max: e.target.value })} data-testid={`input-allowance-max-${p.id}`} />
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-destructive" data-testid="text-plan-error">{error}</p>}
      {saved && !error && <p role="status" className="mt-3 text-sm text-primary" data-testid="text-plan-saved">Plan saved. GPS measurements unchanged.</p>}
      <Button className="mt-4" onClick={submit} disabled={update.isPending} data-testid="button-save-plan">
        {update.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}{update.isPending ? "Saving…" : "Save plan"}
      </Button>
    </Panel>
  );
}
