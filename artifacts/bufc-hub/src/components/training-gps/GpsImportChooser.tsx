import { useState, type ReactNode } from "react";
import { useSearch } from "wouter";
import { TrainingUploadForm } from "./TrainingUploadForm";
import { useLeagueModules } from "@/hooks/useLeagueModules";

/** Wraps the existing match uploader with a Match / Training switch (honours ?type=training). */
export function GpsImportChooser({ leagueId, year, renderMatch }: { leagueId: number; year: string | null; renderMatch: (toTraining: () => void) => ReactNode }) {
  const search = useSearch();
  const { hasModule } = useLeagueModules();
  const canTraining = leagueId > 0 && hasModule(leagueId, "gps") && hasModule(leagueId, "data-entry");
  const [kind, setKind] = useState<"match" | "training">(() => new URLSearchParams(search).get("type") === "training" ? "training" : "match");
  const [redirected, setRedirected] = useState(false);
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1" role="tablist">
        {(["match", "training"] as const).map(k => (
          <button key={k} role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setRedirected(false); }} data-testid={`button-gps-kind-${k}`}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {k === "match" ? "Match GPS" : "Training GPS"}
          </button>
        ))}
      </div>
      {redirected && kind === "training" && <p className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm" data-testid="text-training-redirect">That file is a training export, so it was not parsed as a match. Choose it again below to preview it as training.</p>}
      {kind === "match" ? renderMatch(() => { setKind("training"); setRedirected(true); }) :
        !canTraining ? <p className="text-sm text-muted-foreground">Training uploads need both GPS and Data Entry access for this league.</p> :
        year ? <TrainingUploadForm key={`${leagueId}-${year}`} leagueId={leagueId} year={year} /> :
        <p className="text-sm text-muted-foreground">Choose a season first.</p>}
    </div>
  );
}
