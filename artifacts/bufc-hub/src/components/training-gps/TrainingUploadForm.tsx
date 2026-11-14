import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  usePreviewGpsTraining, useSaveGpsTraining, useGetSeasonRoster, getGetSeasonRosterQueryKey, getListGpsTrainingQueryKey,
  type TrainingGpsPreview, type TrainingGpsImportInput, type TrainingGpsSession,
} from "@workspace/api-client-react";
import { trainingPartLabel, trainingTimetable } from "@workspace/api-zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, FileUp, Loader2, AlertTriangle } from "lucide-react";
import { fmtDate } from "./shared";
import { isTrainingGpsText } from "./detect";

const errMsg = (e: unknown) => (e as { message?: string })?.message ?? "Request failed.";

export function TrainingUploadForm({ leagueId, year }: { leagueId: number; year: string }) {
  const qc = useQueryClient();
  const preview = usePreviewGpsTraining();
  const save = useSaveGpsTraining();
  const rosterParams = { leagueId, year };
  const roster = useGetSeasonRoster(rosterParams, { query: { enabled: leagueId > 0 && /^\d{4}$/.test(year), queryKey: getGetSeasonRosterQueryKey(rosterParams) } });

  const [file, setFile] = useState<{ name: string; csv: string; rev: number } | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [mappings, setMappings] = useState<Record<string, number>>({});
  const [allowUnmatched, setAllowUnmatched] = useState(false);
  const [result, setResult] = useState<{ key: string; data: TrainingGpsPreview } | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [saved, setSaved] = useState<TrainingGpsSession | null>(null);
  const [needsReplaceSaved, setNeedsReplaceSaved] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const readToken = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Every input that changes the server's answer is part of this key. `rev` is
  // unique per file read, so a corrected file never collides with the old one.
  const inputKey = JSON.stringify([leagueId, year, file?.rev ?? 0, mappings, allowUnmatched]);
  const latestKey = useRef(inputKey);
  latestKey.current = inputKey;
  const current = (key: string) => mounted.current && latestKey.current === key;
  const pv = result && result.key === inputKey ? result.data : null;
  const invalidate = () => { setConfirmReplace(false); setSaved(null); setActionErr(null); };

  const onFile = async (f: File | undefined) => {
    const token = ++readToken.current;
    setFile(null); setFileErr(null); setMappings({}); setAllowUnmatched(false); setResult(null); invalidate();
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) { setFileErr("Choose a .csv file exported from Catapult."); return; }
    let csv: string;
    try { csv = await f.text(); } catch (e) {
      if (mounted.current && token === readToken.current) setFileErr(`Could not read this file: ${errMsg(e)}`);
      return;
    }
    if (!mounted.current || token !== readToken.current) return;
    if (!csv.trim()) { setFileErr("This file is empty."); return; }
    setFile({ name: f.name, csv, rev: token });
  };

  const body = (extra: Partial<TrainingGpsImportInput> = {}): TrainingGpsImportInput => ({
    leagueId, year, csv: file!.csv, sourceFilename: file!.name.slice(0, 200),
    playerMappings: Object.entries(mappings).map(([sourceName, rosterId]) => ({ sourceName, rosterId })),
    allowUnmatched, ...extra,
  });

  const runPreview = () => {
    if (!file) return;
    const key = inputKey; invalidate();
    preview.mutate({ data: body() }, {
      onSuccess: d => { if (current(key)) setResult({ key, data: d }); },
      onError: e => { if (current(key)) setActionErr(errMsg(e)); },
    });
  };

  const unresolved = pv ? [...pv.unmatchedNames, ...pv.ambiguousNames].filter(n => mappings[n] == null) : [];
  const needsReplace = !!pv && pv.existingId != null && !pv.identical;
  const canSave = !!pv && !pv.identical && (unresolved.length === 0 || allowUnmatched) && (!needsReplace || confirmReplace) && !save.isPending;

  const runSave = () => {
    if (!pv || !canSave) return;
    const key = inputKey;
    save.mutate({ data: body(needsReplace ? { replace: true, expectedVersion: pv.existingVersion ?? undefined } : {}) }, {
      onSuccess: s => {
        // Always refresh the scope that was written, even if the user moved on.
        void qc.invalidateQueries({ queryKey: getListGpsTrainingQueryKey({ leagueId: s.leagueId, year: s.year }) });
        if (!current(key)) return;
        setSaved(s); setNeedsReplaceSaved(needsReplace); setResult(null); setConfirmReplace(false);
      },
      onError: e => { if (!current(key)) return; setActionErr(/409|version|conflict/i.test(errMsg(e)) ? "This session changed since your preview. Preview again before replacing." : errMsg(e)); setResult(null); },
    });
  };

  const tt = useMemo(() => pv ? trainingTimetable(pv.session) : [], [pv]);
  const players = pv ? new Set(pv.session.rows.map(r => r.sourceName)).size : 0;
  const rosterOpts = [...(roster.data ?? [])].sort((a, b) => a.playerName.localeCompare(b.playerName));
  const looksTraining = useMemo(() => (file ? isTrainingGpsText(file.csv) : true), [file]);
  const wrongType = !!file && !pv && !saved && !looksTraining;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Training GPS upload</CardTitle>
        <CardDescription>Catapult training export with Warm-up, Passing, Technical, Main and End game splits for {year}. Preview first; nothing is saved until you confirm.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border px-4 py-5 hover:border-primary/60">
          <FileUp className="h-5 w-5 text-primary" />
          <span className="text-sm">{file ? file.name : "Choose a training .csv"}</span>
          <input type="file" accept=".csv,text/csv" className="hidden" data-testid="input-training-file"
            onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {fileErr && <p role="alert" className="text-sm text-destructive">{fileErr}</p>}
        {wrongType && <p className="flex gap-2 text-sm text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" />No training part names found in this file. If it is a match export, switch to Match above.</p>}

        <Button onClick={runPreview} disabled={!file || preview.isPending} data-testid="button-preview-training">
          {preview.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{pv ? "Preview again" : "Preview"}
        </Button>
        {result && !pv && <p className="text-xs text-amber-200" data-testid="text-preview-stale">Inputs changed — preview again before saving.</p>}
        {actionErr && <p role="alert" className="text-sm text-destructive" data-testid="text-training-error">{actionErr}</p>}

        {pv && (
          <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4" data-testid="panel-training-preview">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span><b>{fmtDate(pv.session.date)}</b> · {pv.session.title}</span>
              <span>{players} players · {tt.length} parts</span>
            </div>
            <ul className="grid gap-1 text-xs sm:grid-cols-2">
              {tt.map(t => <li key={t.part} className="font-mono">{trainingPartLabel(t.part)}: {t.durationSeconds != null ? `${(t.durationSeconds / 60).toFixed(1)} min` : "no duration"} · {t.playerCount} players</li>)}
            </ul>
            {pv.session.warnings.length > 0 && <ul className="list-disc pl-5 text-xs text-amber-200">{pv.session.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}

            {(pv.unmatchedNames.length > 0 || pv.ambiguousNames.length > 0) && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Match names to the {year} roster</p>
                {[...pv.unmatchedNames, ...pv.ambiguousNames].map(n => (
                  <div key={n} className="grid items-center gap-2 sm:grid-cols-[1fr_16rem]">
                    <span className="text-sm">{n} <span className="text-xs text-muted-foreground">{pv.ambiguousNames.includes(n) ? "(ambiguous)" : "(not found)"}</span></span>
                    <Select value={mappings[n] != null ? String(mappings[n]) : "none"} onValueChange={v => setMappings(m => { const c = { ...m }; if (v === "none") delete c[n]; else c[n] = Number(v); return c; })}>
                      <SelectTrigger data-testid={`select-map-${n}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Leave unassigned</SelectItem>
                        {rosterOpts.map(r => <SelectItem key={r.id} value={String(r.id)}>{r.playerName} · {r.positionCode} · {r.squad}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={allowUnmatched} onCheckedChange={v => setAllowUnmatched(v === true)} data-testid="checkbox-allow-unmatched" />
                  Save unmatched players unassigned (they count in group stats, with no position)
                </label>
                <p className="text-xs text-muted-foreground">Changing a mapping requires a fresh preview.</p>
              </div>
            )}

            {pv.identical && <p className="text-sm text-muted-foreground" data-testid="text-identical">These exact GPS measurements are already saved for this session (session revision {pv.existingVersion}). Nothing to do.</p>}
            {needsReplace && (
              <label className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <Checkbox checked={confirmReplace} onCheckedChange={v => setConfirmReplace(v === true)} data-testid="checkbox-confirm-replace" />
                <span>A training session for this date already exists (session revision {pv.existingVersion}). Replace its GPS measurements with this file. The session's saved plan is preserved.</span>
              </label>
            )}
            {unresolved.length > 0 && !allowUnmatched && <p className="text-xs text-amber-200">{unresolved.length} name(s) still need a roster match or explicit unassigned save.</p>}
            <Button onClick={runSave} disabled={!canSave} data-testid="button-save-training">
              {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{needsReplace ? "Replace GPS measurements" : "Save session"}
            </Button>
          </div>
        )}

        {saved && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm" data-testid="text-training-saved">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            {needsReplaceSaved ? "Replaced GPS measurements" : "Saved"} for {fmtDate(saved.date)} (session revision {saved.version}).
            <Link href="/gps?view=training" className="font-semibold text-primary underline-offset-2 hover:underline" data-testid="link-open-training">Open in Training GPS</Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
