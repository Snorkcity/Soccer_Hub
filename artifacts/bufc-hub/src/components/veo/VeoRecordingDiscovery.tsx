import { useMemo, useRef, useState } from "react";
import {
  useDiscoverVeoRecordings,
  useImportVeoRecording,
  type VeoDiscoveryResult,
  type VeoDiscoveredRecording,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, DownloadCloud, Search, AlertTriangle, CheckCircle2, X, Info } from "lucide-react";

const NO_FIXTURE = "none";
const PAGE = 20;
const RECENT_DAYS = 90;

function fmtSydney(iso?: string | null, withTime = true): string {
  if (!iso) return "Date unknown";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Date unknown";
  return d.toLocaleString("en-AU", {
    timeZone: "Australia/Sydney",
    day: "numeric", month: "short", year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function errText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "Something went wrong — please try again.";
}

export function VeoRecordingDiscovery({ leagueId, seasonId, teamName, campaignYear, onImported }: {
  leagueId: number;
  seasonId: number;
  teamName: string;
  campaignYear: string;
  onImported: () => Promise<void>;
}) {
  const discoverMut = useDiscoverVeoRecordings();
  const importMut = useImportVeoRecording();
  const [result, setResult] = useState<VeoDiscoveryResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [importedTokens, setImportedTokens] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [showOlder, setShowOlder] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [confirmTeam, setConfirmTeam] = useState(false);
  const [fixture, setFixture] = useState<string>(NO_FIXTURE);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const inFlight = useRef(false);

  async function runDiscover() {
    if (discoverMut.isPending || inFlight.current) return;
    setFetchError(null);
    setNotice(null);
    try {
      const r = await discoverMut.mutateAsync({ data: { leagueId, seasonId } });
      setResult(r);
      setImportedTokens(new Set());
      setVisible(PAGE);
    } catch (e) {
      setFetchError(errText(e));
    }
  }

  const cutoff = useMemo(() => Date.now() - RECENT_DAYS * 86400000, [result]);
  const sorted = useMemo(() => {
    const recs = result?.recordings ?? [];
    return [...recs].sort((a, b) => {
      const ta = a.startsAt ? new Date(a.startsAt).getTime() : -Infinity;
      const tb = b.startsAt ? new Date(b.startsAt).getTime() : -Infinity;
      return tb - ta;
    });
  }, [result]);
  const olderCount = sorted.filter((r) => !r.startsAt || new Date(r.startsAt).getTime() < cutoff).length;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((r) => {
      if (!showOlder && (!r.startsAt || new Date(r.startsAt).getTime() < cutoff)) return false;
      if (!q) return true;
      return [r.title, r.team, r.source, r.recordingId].some((s) => s.toLowerCase().includes(q));
    });
  }, [sorted, search, showOlder, cutoff]);
  const shown = filtered.slice(0, visible);
  const fixtures = useMemo(
    () => [...(result?.fixtures ?? [])].sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? "")),
    [result],
  );

  function openConfirm(r: VeoDiscoveredRecording) {
    setPendingToken(r.token);
    setConfirmTeam(false);
    setFixture(NO_FIXTURE);
    setNotice(null);
  }

  async function runImport(r: VeoDiscoveredRecording) {
    if (inFlight.current || !confirmTeam) return;
    inFlight.current = true;
    setBusyToken(r.token);
    setNotice(null);
    try {
      const matchId = fixture === NO_FIXTURE ? null : Number(fixture);
      await importMut.mutateAsync({ data: { leagueId, seasonId, token: r.token, matchId } });
      setImportedTokens((prev) => new Set(prev).add(r.token));
      setPendingToken(null);
      setNotice({ tone: "ok", text: `Imported "${r.title}" into ${teamName} ${campaignYear}. Refreshing saved stats…` });
      try {
        await onImported();
        setNotice({ tone: "ok", text: `Imported "${r.title}" into ${teamName} ${campaignYear}. Stats refreshed.` });
      } catch (e) {
        setNotice({ tone: "err", text: `Imported "${r.title}", but the stats refresh failed — ${errText(e)} Use Refresh saved stats to retry.` });
      }
    } catch (e) {
      setNotice({ tone: "err", text: `Import failed — ${errText(e)}` });
    } finally {
      inFlight.current = false;
      setBusyToken(null);
    }
  }

  const busy = busyToken != null;
  const yearMismatch = result && result.campaignYear !== campaignYear;

  return (
    <Card className="border-primary/30" data-testid="card-veo-discovery">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <DownloadCloud className="h-5 w-5 text-primary" /> New Veo recordings
            </CardTitle>
            <CardDescription className="mt-1 leading-relaxed">
              Checks all shared Veo sources. Nothing is added until you confirm the recording belongs to{" "}
              <span className="font-medium text-foreground">{teamName} · {campaignYear}</span>.
            </CardDescription>
          </div>
          <Button onClick={runDiscover} disabled={discoverMut.isPending || busy} className="gap-2 shrink-0" data-testid="button-fetch-veo">
            {discoverMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
            {discoverMut.isPending ? "Checking sources…" : result ? "Fetch again" : "Fetch new videos"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {fetchError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert" data-testid="status-veo-fetch-error">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
            <div className="flex-1">Could not check Veo — {fetchError}</div>
            <Button size="sm" variant="outline" onClick={runDiscover} disabled={discoverMut.isPending}>Retry</Button>
          </div>
        )}

        {notice && (
          <div
            role="status"
            data-testid="status-veo-import"
            className={`flex items-start gap-2 rounded-md border p-3 text-sm animate-in fade-in ${notice.tone === "ok" ? "border-green-500/40 bg-green-500/10" : "border-destructive/40 bg-destructive/10"}`}
          >
            {notice.tone === "ok" ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-green-400" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />}
            <div className="flex-1">{notice.text}</div>
            <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
        )}

        {discoverMut.isPending && !result && (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2].map((i) => <div key={i} className="h-14 rounded-md bg-muted animate-pulse" />)}
          </div>
        )}

        {result && (
          <>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground" data-testid="text-veo-sources">
              <span>Sources checked:</span>
              {result.sourcesChecked.length === 0
                ? <span>none</span>
                : result.sourcesChecked.map((s) => <Badge key={s} variant="secondary" className="font-normal">{s}</Badge>)}
            </div>

            {(result.warnings.length > 0 || yearMismatch) && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm space-y-1" data-testid="status-veo-warnings">
                <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-amber-500" /> Partial results</div>
                {yearMismatch && <p className="text-muted-foreground">Server campaign is {result.campaignYear}; the page is showing {campaignYear}. Switch context before importing.</p>}
                {result.warnings.map((w, i) => <p key={i} className="text-muted-foreground">{w}</p>)}
              </div>
            )}

            {sorted.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                No recordings found in the shared sources.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setVisible(PAGE); }}
                      placeholder="Search title, Veo team or source"
                      className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      data-testid="input-veo-search"
                    />
                  </div>
                  <Button
                    variant={showOlder ? "secondary" : "outline"}
                    onClick={() => { setShowOlder((v) => !v); setVisible(PAGE); }}
                    aria-pressed={showOlder}
                    data-testid="button-veo-older"
                  >
                    {showOlder ? `Last ${RECENT_DAYS} days only` : `Show older (${olderCount})`}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {filtered.length} {filtered.length === 1 ? "recording" : "recordings"} · newest first · {showOlder ? "all dates" : `last ${RECENT_DAYS} days`} · times in Sydney
                </p>

                {filtered.length === 0 ? (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {search ? "No recordings match that search." : `Nothing recorded in the last ${RECENT_DAYS} days.`}
                    {!showOlder && olderCount > 0 && (
                      <Button variant="link" className="ml-1 h-auto p-0" onClick={() => setShowOlder(true)}>Show older recordings</Button>
                    )}
                  </div>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {shown.map((r) => {
                      const done = r.imported || importedTokens.has(r.token);
                      const open = pendingToken === r.token && !done;
                      const isBusy = busyToken === r.token;
                      return (
                        <li key={r.token} className={`p-3 transition-colors ${open ? "bg-muted/60" : ""}`} data-testid={`row-veo-recording-${r.recordingId}`}>
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate">{r.title || "Untitled recording"}</div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                <span>{fmtSydney(r.startsAt)}</span>
                                <span aria-hidden>·</span>
                                <span>Veo team: <span className="text-foreground">{r.team || "unknown"}</span></span>
                                <span aria-hidden>·</span>
                                <span>Source: {r.source}</span>
                              </div>
                            </div>
                            {done ? (
                              <Badge className="bg-green-500/15 text-green-300 border-green-500/30 gap-1 self-start sm:self-center"><CheckCircle2 className="h-3 w-3" /> Imported</Badge>
                            ) : r.removed ? (
                              <Badge variant="secondary" className="self-start sm:self-center">Archived</Badge>
                            ) : !open ? (
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => openConfirm(r)} data-testid={`button-veo-choose-${r.recordingId}`}>
                                Import…
                              </Button>
                            ) : null}
                          </div>

                          {open && (
                            <div className="mt-3 space-y-3 rounded-md border border-primary/30 bg-background/60 p-3 animate-in fade-in slide-in-from-top-1">
                              <label className="flex items-start gap-2 text-sm cursor-pointer">
                                <input
                                  type="checkbox"
                                  className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
                                  checked={confirmTeam}
                                  onChange={(e) => setConfirmTeam(e.target.checked)}
                                  disabled={isBusy}
                                  data-testid="checkbox-veo-confirm-team"
                                />
                                <span>
                                  This recording is a <span className="font-semibold">{teamName}</span> game for the{" "}
                                  <span className="font-semibold">{campaignYear}</span> campaign.
                                  {r.team && <span className="block text-xs text-muted-foreground">Veo filed it under "{r.team}" — check this matches.</span>}
                                </span>
                              </label>
                              <div className="space-y-1">
                                <div className="text-xs text-muted-foreground">Hub fixture (optional)</div>
                                <Select value={fixture} onValueChange={setFixture} disabled={isBusy}>
                                  <SelectTrigger className="bg-background" data-testid="select-veo-fixture"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={NO_FIXTURE}>No fixture — friendly or training game</SelectItem>
                                    {fixtures.map((f) => (
                                      <SelectItem key={f.id} value={String(f.id)}>
                                        {f.opponent} · {f.matchDate ? fmtSydney(f.matchDate, false) : "date TBC"}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {fixtures.length === 0 && (
                                  <p className="flex items-center gap-1 text-xs text-muted-foreground"><Info className="h-3 w-3" /> No Hub fixtures available for this campaign.</p>
                                )}
                              </div>
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => setPendingToken(null)}>Cancel</Button>
                                <Button size="sm" disabled={!confirmTeam || busy || !!yearMismatch} onClick={() => runImport(r)} className="gap-2" data-testid="button-veo-import">
                                  {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                                  {isBusy ? "Importing…" : "Import recording"}
                                </Button>
                              </div>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {filtered.length > visible && (
                  <div className="flex justify-center">
                    <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE)} data-testid="button-veo-load-more">
                      Load more ({filtered.length - visible} remaining)
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
