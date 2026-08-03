// Football Match Report — the "EPL analyst" view of a single game.
// Pick a match, get the story: result strip, stat tiles vs season, scorers
// with season context, and coach-style insight lines. All computed
// server-side by /analytics/match-report. Reports can be saved (frozen as-is),
// downloaded as a dark PPTX deck, and emailed to the coach list — the same
// trio the GPS Match Report has.
import { useEffect, useMemo, useState } from "react";
import {
  useListMatches, getListMatchesQueryKey,
  useGetMatchReport, getGetMatchReportQueryKey,
  useListMatchReports, getListMatchReportsQueryKey,
  createMatchReport, deleteMatchReport,
  useListMatchReportCoachEmails, getListMatchReportCoachEmailsQueryKey,
  saveMatchReportCoachEmails, sendMatchReportEmail,
  type MatchReportResponse, type SavedMatchReport,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { GoalDnaStoryBlock } from "@/components/GoalDnaStoryBlock";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sparkles, ShieldCheck, AlertTriangle, Info, Activity, History, Save, FileDown, Loader2, Trash2, ArrowLeft,
  Mail, CheckCircle2, XCircle, Plus,
} from "lucide-react";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { useActiveLeague } from "@/contexts/LeagueContext";
import type { FootballMatchReportModel } from "@/lib/matchReportPptx";

interface Props {
  teamId: number;
  seasonId: number;
}
const resultBadge = (r: string | null | undefined) =>
  r === "W" ? "bg-green-500/15 text-green-600 border-green-500/30"
  : r === "L" ? "bg-red-500/15 text-red-600 border-red-500/30"
  : "bg-amber-500/15 text-amber-600 border-amber-500/30";

export default function MatchReportTab({ teamId, seasonId }: Props) {
  const { activeLeagueId } = useActiveLeague();
  const { isSuperadmin, hasModuleAnywhere } = useLeagueModules();
  const isAdmin = isSuperadmin || hasModuleAnywhere("data-entry");

  const listParams = { teamId, seasonId };
  const { data: matches } = useListMatches(listParams, {
    query: { queryKey: getListMatchesQueryKey(listParams) },
  });

  const sorted = useMemo(
    () => (matches ?? []).slice().sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? "")),
    [matches],
  );
  const [matchRowId, setMatchRowId] = useState<number | null>(null);
  const selectedId = matchRowId ?? sorted[0]?.id ?? null;
  const selectedMatch = sorted.find(m => m.id === selectedId) ?? null;

  const reportParams = { teamId, seasonId, matchRowId: selectedId ?? 0 };
  const { data: liveReport, isLoading } = useGetMatchReport(reportParams, {
    query: { enabled: selectedId != null, queryKey: getGetMatchReportQueryKey(reportParams) },
  });

  const roundOf = (matchId: string, opponent: string, date?: string | null) =>
    `${matchId.split("-")[0]} v ${opponent}${date ? ` · ${date}` : ""}`;

  // The frozen model a save/deck/email works from.
  const liveModel: FootballMatchReportModel | null = useMemo(() => {
    if (!liveReport || !selectedMatch) return null;
    const round = selectedMatch.matchId.split("-")[0];
    return {
      report: liveReport,
      matchLabel: liveReport.header.matchLabel,
      round,
      opponent: selectedMatch.opponent,
      matchDate: selectedMatch.matchDate ?? null,
      generatedOn: new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }),
    };
  }, [liveReport, selectedMatch]);

  // Saved reports (league-private, like the GPS ones)
  const queryClient = useQueryClient();
  const savedParams = { leagueId: activeLeagueId ?? 0 };
  const { data: saved } = useListMatchReports(
    savedParams,
    { query: { enabled: activeLeagueId != null, queryKey: getListMatchReportsQueryKey(savedParams) } },
  );
  const invalidateSaved = () =>
    queryClient.invalidateQueries({ queryKey: getListMatchReportsQueryKey(savedParams) });

  const [viewingSaved, setViewingSaved] = useState<SavedMatchReport | null>(null);
  const model = viewingSaved ? (viewingSaved.data as unknown as FootballMatchReportModel) : liveModel;
  const report: MatchReportResponse | null = model?.report ?? null;

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const saveReport = async () => {
    if (!liveModel || activeLeagueId == null) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await createMatchReport({
        leagueId: activeLeagueId,
        title: `Match Report — ${liveModel.round} v ${liveModel.opponent}`,
        round: liveModel.round,
        opponent: liveModel.opponent,
        matchDate: liveModel.matchDate ?? undefined,
        data: liveModel as unknown as Record<string, unknown>,
      });
      await invalidateSaved();
      setSaveMsg("Saved");
    } catch {
      setSaveMsg("Save failed — try again");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 4000);
    }
  };

  const [deckMsg, setDeckMsg] = useState<string | null>(null);
  const downloadDeck = async () => {
    if (!model) return;
    setDownloading(true);
    setDeckMsg(null);
    try {
      const { generateFootballMatchReport } = await import("@/lib/matchReportPptx");
      await generateFootballMatchReport(model, undefined);
    } catch {
      // Most common cause: a stale page holding pre-deploy chunk URLs.
      setDeckMsg("Download failed — refresh the page and try again");
      setTimeout(() => setDeckMsg(null), 6000);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {viewingSaved ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setViewingSaved(null)}>
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to live report
            </Button>
            <p className="text-sm text-muted-foreground">
              Viewing saved report: <span className="font-medium text-foreground">{viewingSaved.title}</span>
            </p>
          </>
        ) : (
          <>
            <Select value={selectedId != null ? String(selectedId) : undefined} onValueChange={v => setMatchRowId(Number(v))}>
              <SelectTrigger className="w-72"><SelectValue placeholder="Pick a match" /></SelectTrigger>
              <SelectContent>
                {sorted.map(m => (
                  <SelectItem key={m.id} value={String(m.id)}>{roundOf(m.matchId, m.opponent, m.matchDate)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isLoading && <span className="text-sm text-muted-foreground">Building report…</span>}
          </>
        )}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          {!viewingSaved && (
            <Button variant="outline" size="sm" onClick={saveReport} disabled={saving || !liveModel}>
              {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
              {saveMsg ?? "Save report"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={downloadDeck} disabled={downloading || !model}>
            {downloading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <FileDown className="h-4 w-4 mr-1.5" />}
            {deckMsg ?? "Download deck"}
          </Button>
          {isAdmin && model && <EmailCoachesDialog model={model} />}
        </div>
      </div>

      {report && model && (
        <>
          {/* ── Header: scoreline + form strip ─────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    {report.header.matchLabel}
                    {report.header.result && (
                      <Badge variant="outline" className={resultBadge(report.header.result)}>
                        {report.header.result === "W" ? "Win" : report.header.result === "L" ? "Loss" : "Draw"} {report.header.goalsScored}–{report.header.goalsConceded}
                      </Badge>
                    )}
                    {report.header.cleanSheet && (
                      <Badge variant="outline" className="bg-sky-500/10 text-sky-600 border-sky-500/30">
                        <ShieldCheck className="h-3 w-3 mr-1" />Clean sheet
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {[report.header.matchDate, report.header.venue,
                      report.header.halfScore ? `HT ${report.header.halfScore}` : null,
                      report.header.formation ? `Us ${report.header.formation}${report.header.oppFormation ? ` · them ${report.header.oppFormation}` : ""}` : null,
                    ].filter(Boolean).join(" · ")}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-1.5">
                  {report.form.map((f, i) => (
                    <Tooltip key={i}>
                      <TooltipTrigger asChild>
                        <div
                          className={`h-7 w-7 rounded-full grid place-items-center text-xs font-semibold border cursor-default
                            ${f.result === "W" ? "bg-green-500/15 text-green-600 border-green-500/40"
                              : f.result === "L" ? "bg-red-500/15 text-red-600 border-red-500/40"
                              : "bg-amber-500/15 text-amber-600 border-amber-500/40"}
                            ${f.isThisMatch ? "ring-2 ring-primary" : "opacity-80"}`}>
                          {f.result}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        {f.opponent} · {f.score}{f.isThisMatch ? " (this match)" : ""}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                  {report.ladderPos != null && (
                    <span className="ml-2 text-xs text-muted-foreground whitespace-nowrap">
                      {report.ladderPos}<sup>{report.ladderPos === 1 ? "st" : report.ladderPos === 2 ? "nd" : report.ladderPos === 3 ? "rd" : "th"}</sup> of {report.teamsInLeague} · {report.ladderPoints} pts
                    </span>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* ── Stat tiles vs season ───────────────────────────────────────── */}
          {report.tiles.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              {report.tiles.map(t => {
                const good = t.rank != null && t.outOf != null && t.rank <= Math.ceil(t.outOf / 3);
                const poor = t.rank != null && t.outOf != null && t.rank > t.outOf - Math.ceil(t.outOf / 3);
                return (
                  <Card key={t.id}>
                    <CardContent className="pt-4 pb-3">
                      <div className="text-xs text-muted-foreground">{t.label}</div>
                      <div className="text-2xl font-semibold">{t.value?.toFixed(t.decimals)}{t.unit}</div>
                      {t.oppAvg != null && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          avg v {report.header.opponent} {t.oppAvg.toFixed(t.decimals === 0 ? 1 : t.decimals)}{t.unit}
                        </div>
                      )}
                      <div className={`text-[11px] text-muted-foreground ${t.oppAvg != null ? "" : "mt-0.5"}`}>
                        season avg {t.seasonAvg != null ? `${t.seasonAvg.toFixed(t.decimals === 0 ? 1 : t.decimals)}${t.unit}` : "—"}
                      </div>
                      {t.rank != null && t.outOf != null && (
                        <div className={`text-[11px] font-medium ${good ? "text-green-500" : poor ? "text-amber-500" : "text-muted-foreground"}`}>
                          {t.rank === 1 ? (t.higherIsBetter ? "best" : "best") : `${t.rank}${t.rank === 2 ? "nd" : t.rank === 3 ? "rd" : "th"}`} of {t.outOf} this season
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* ── GPS + previous meetings ────────────────────────────────────── */}
          {(report.gps || report.previousMeetings.length > 0) && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {report.gps && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4 text-emerald-500" />Physical output (GPS)</CardTitle>
                    <CardDescription className="text-xs">From the Catapult upload for this round — {report.gps.playerCount} players tracked.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {([
                      ["Team distance", report.gps.totalDistanceKm, report.gps.seasonAvgTotalDistanceKm, "km", 1, null, "distanceKm", "km", 1],
                      ["Defenders", report.gps.defendersMPerMin, report.gps.seasonAvgDefendersMPerMin, "m/min", 0, "Defender", "mPerMin", "m/min", 0],
                      ["Midfielders", report.gps.midfieldersMPerMin, report.gps.seasonAvgMidfieldersMPerMin, "m/min", 0, "Midfielder", "mPerMin", "m/min", 0],
                      ["Forwards HSM", report.gps.forwardsHighSpeedM, report.gps.seasonAvgForwardsHighSpeedM, "m", 0, "Forward", "sprintDistanceM", "m", 0],
                    ] as const).map(([label, v, sAvg, unit, dp, pos, field, fUnit, fDp]) => {
                      const rows = (report.gps?.players ?? []).filter(p => pos == null || p.position === pos);
                      const delta = v != null && sAvg != null && sAvg > 0 ? ((v - sAvg) / sAvg) * 100 : null;
                      const stat = (
                        <div className={rows.length ? "cursor-default" : undefined}>
                          <div className="text-xs text-muted-foreground">{label}</div>
                          <div className="text-xl font-semibold">{v != null ? v.toFixed(dp) : "—"}<span className="text-xs font-normal text-muted-foreground ml-1">{unit}</span></div>
                          {sAvg != null && (
                            <div className="text-[11px] text-muted-foreground mt-0.5">
                              season avg {sAvg.toFixed(dp)}{unit === "km" || unit === "m" ? ` ${unit}` : ` ${unit}`}
                              {delta != null && Math.abs(delta) >= 3 && (
                                <span className={delta > 0 ? "text-green-500 ml-1" : "text-amber-500 ml-1"}>
                                  {delta > 0 ? "+" : ""}{delta.toFixed(0)}%
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      );
                      if (!rows.length) return <div key={label}>{stat}</div>;
                      return (
                        <Tooltip key={label}>
                          <TooltipTrigger asChild>{stat}</TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">
                            <div className="space-y-0.5">
                              {rows.map(p => (
                                <div key={p.name} className="flex justify-between gap-4">
                                  <span>{p.name}{p.mins != null ? ` · ${Math.round(p.mins)} min` : ""}</span>
                                  <span className="font-mono">{p[field] != null ? `${p[field]!.toFixed(fDp)} ${fUnit}` : "—"}</span>
                                </div>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
              {report.previousMeetings.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4 text-sky-500" />Earlier this season v {report.header.opponent}</CardTitle>
                    <CardDescription className="text-xs">How the previous meetings went.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {report.previousMeetings.map((m, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-md border p-2 text-sm">
                        <Badge variant="outline" className={resultBadge(m.result)}>{m.result ?? "?"}</Badge>
                        <span className="font-medium">{m.matchLabel}</span>
                        <span className="font-mono">{m.score}</span>
                        <span className="text-xs text-muted-foreground ml-auto">{m.matchDate}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* ── Goal DNA: goals-by-type story ──────────────────────────────── */}
          {report.goalDna && (() => {
            const dna = report.goalDna;
            // Older saved reports won't have the per-goal story — fall back to
            // the legacy per-side matchLines rendering for those.
            const hasStory = dna.matchGoals != null;
            const sideBlock = (side: typeof dna.scored, title: string, isScored: boolean) => (
              <div className="space-y-3">
                <div className="text-sm font-semibold">{title}</div>
                {!hasStory && (side.matchLines.length > 0 ? (
                  <div className="space-y-1.5">
                    {side.matchLines.map((l, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        {isScored
                          ? <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />
                          : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />}
                        <span>{l}</span>
                      </div>
                    ))}
                  </div>
                ) : !hasStory ? (
                  <div className="text-xs text-muted-foreground">Nothing out of the ordinary in {isScored ? "how the goals came" : "what we gave up"} today.</div>
                ) : null)}
              </div>
            );
            return (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-amber-500" />Goal story — what today's goals tell us
                  </CardTitle>
                  <CardDescription className="text-xs">
                    The headlines from today's goals — type, timing, scorers, assists and the defence — each read against the season. The full goal-by-goal detail and season mix vs benchmark sit at the bottom of the report.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Headline badge squares — up to 4, weighted server-side so
                      the mix varies game to game. Older saved reports won't
                      have them. */}
                  {(dna.insightBadges ?? []).length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {(dna.insightBadges ?? []).map((b, i) => (
                        <div key={i} className={`rounded-md border p-3 ${b.tone === "watch" ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
                          <div className={`text-xs ${b.tone === "watch" ? "text-amber-600" : "text-muted-foreground"}`}>{b.label}</div>
                          <div className="text-sm font-semibold leading-snug mt-0.5">{b.value}</div>
                          {b.sub && <div className="text-[11px] text-muted-foreground mt-0.5">{b.sub}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Per-goal table dropped by coach request — the season DNA
                      table lower in the report covers it. Keep the tactical read. */}
                  {hasStory && (
                    <GoalDnaStoryBlock matchGoals={[]} tacticalRead={dna.tacticalRead ?? []} />
                  )}
                  {(dna.dayInsights ?? []).length > 0 && (
                    <div className="space-y-1.5">
                      {(dna.dayInsights ?? []).map((c, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
                          <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-violet-500" />
                          <span>{c}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {!hasStory && (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                      {sideBlock(dna.scored, "Scored", true)}
                      {sideBlock(dna.conceded, "Conceded", false)}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* ── Ball use quadrant ──────────────────────────────────────────── */}
          {report.ballUse && (() => {
            const bu = report.ballUse;
            const quadrantTitle =
              bu.quadrant === "control" ? "Control & cut through"
              : bu.quadrant === "sterile" ? "Sterile possession"
              : bu.quadrant === "direct" ? "Efficient without the ball"
              : bu.quadrant === "chasing" ? "Chased it" : null;
            const quadrantTone =
              bu.quadrant === "control" ? "bg-green-500/15 text-green-600 border-green-500/30"
              : bu.quadrant === "chasing" ? "bg-red-500/15 text-red-600 border-red-500/30"
              : "bg-sky-500/15 text-sky-600 border-sky-500/30";
            return (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Activity className="h-4 w-4 text-violet-500" />Ball use
                    </CardTitle>
                    {quadrantTitle && <Badge variant="outline" className={quadrantTone}>{quadrantTitle}</Badge>}
                  </div>
                  <CardDescription className="text-xs">
                    How much of the ball we had, and how often having it turned into a shot.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {([
                      ["Possession", `${bu.possession}%`, bu.seasonAvgPossession != null ? `season avg ${bu.seasonAvgPossession.toFixed(0)}%` : null],
                      ["Passes", bu.passes != null ? `${bu.passes}` : "—", bu.seasonAvgPasses != null ? `season avg ${bu.seasonAvgPasses.toFixed(0)}` : null],
                      ["Passes per shot", bu.passesPerShot.toFixed(0), bu.seasonAvgShotsPer100 != null && bu.seasonAvgShotsPer100 > 0 ? `season avg ${(100 / bu.seasonAvgShotsPer100).toFixed(0)}` : null],
                      ["Shots per 100 passes", bu.shotsPer100Passes.toFixed(1), bu.seasonAvgShotsPer100 != null ? `season avg ${bu.seasonAvgShotsPer100.toFixed(1)}` : null],
                    ] as const).map(([label, v, sub]) => (
                      <div key={label} className="rounded-md border p-3">
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className="text-xl font-semibold">{v}</div>
                        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    {bu.comments.map((c, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <Info className="h-4 w-4 mt-0.5 shrink-0 text-sky-500" />
                        <span>{c}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* ── Insights ─────────────────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-sky-500" />The analyst's notes</CardTitle>
                <CardDescription className="text-xs">What stood out, with the season as context.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {report.insights.length === 0 && <div className="text-sm text-muted-foreground">Nothing unusual to flag in this one.</div>}
                {report.insights.map((ins, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
                    {ins.tone === "good" ? <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />
                      : ins.tone === "watch" ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                      : <Info className="h-4 w-4 mt-0.5 shrink-0 text-sky-500" />}
                    <span>{ins.text}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* ── Goals timeline ───────────────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">How the goals came</CardTitle>
                <CardDescription className="text-xs">Every goal with the scorer's season running total.</CardDescription>
              </CardHeader>
              <CardContent>
                {report.goals.length === 0 && <div className="text-sm text-muted-foreground">No goal detail recorded for this match.</div>}
                <div className="space-y-1.5">
                  {report.goals.map((g: typeof report.goals[number], i) => (
                    <div key={i} className={`flex items-start gap-3 rounded-md p-2 text-sm ${g.ours ? "" : "bg-red-500/5"}`}>
                      <span className="w-9 shrink-0 text-right font-mono text-xs text-muted-foreground pt-0.5">{g.minute != null ? `${g.minute}'` : "—"}</span>
                      <div className="min-w-0">
                        <div className={`font-medium ${g.ours ? "" : "text-red-500"}`}>
                          {g.ours ? g.scorer ?? "Goal" : `Conceded${g.scorer ? ` — ${g.scorer}` : ""}`}
                          {g.ours && g.assist && g.assist !== "OG" && <span className="text-muted-foreground font-normal"> (assist {g.assist})</span>}
                        </div>
                        {(g.typeLabel || g.note) && (
                          <div className="text-[11px] text-muted-foreground">{[g.typeLabel, g.note].filter(Boolean).join(" · ")}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Season DNA vs benchmark — the reference box, right at the bottom ── */}
          {report.goalDna && (report.goalDna.scored.totalTyped > 0 || report.goalDna.conceded.totalTyped > 0) && (() => {
            const dna = report.goalDna;
            const mixBlock = (side: typeof dna.scored, title: string, isScored: boolean) => (
              <div className="space-y-3">
                <div className="text-sm font-semibold">{title}</div>
                {side.totalTyped > 0 ? (
                  <div className="space-y-1">
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Season mix ({side.totalTyped} goals)</div>
                    {side.categories.map(c => {
                      const flagged = c.verdict != null;
                      const goodFlag = c.verdict === "high" ? isScored : !isScored;
                      return (
                        <div key={c.id} className="flex items-center gap-2 text-xs">
                          <span className="w-40 shrink-0">{c.label}</span>
                          <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                            <div
                              className={`h-full ${flagged ? (goodFlag ? "bg-green-500" : "bg-red-500") : "bg-primary/60"}`}
                              style={{ width: `${Math.min(100, c.pct ?? 0)}%` }}
                            />
                          </div>
                          <span className="w-24 text-right font-mono">{c.pct != null ? `${c.pct.toFixed(0)}%` : "—"} <span className="text-muted-foreground">/ {c.benchmarkLabel}</span></span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No typed goals yet.</div>
                )}
              </div>
            );
            return (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Info className="h-4 w-4 text-sky-500" />Season DNA vs benchmark
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Where the season's goals have come from, against the benchmark mix: set pieces 27%, middle-third regains 48–50%, front & back thirds ~12% each.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {mixBlock(dna.scored, "Scored", true)}
                    {mixBlock(dna.conceded, "Conceded", false)}
                  </div>
                  {dna.comments.length > 0 && (
                    <div className="space-y-1.5 border-t pt-3">
                      {dna.comments.map((c, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <Info className="h-4 w-4 mt-0.5 shrink-0 text-sky-500" />
                          <span>{c}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}
        </>
      )}

      <SavedReportsCard saved={saved ?? []} onOpen={setViewingSaved} onChanged={invalidateSaved} />
    </div>
  );
}

function SavedReportsCard({ saved, onOpen, onChanged }: {
  saved: SavedMatchReport[]; onOpen: (r: SavedMatchReport) => void; onChanged: () => void;
}) {
  const [deleting, setDeleting] = useState<number | null>(null);
  if (!saved.length) return null;
  const savedLabel = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  };
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Saved match reports</CardTitle>
        <CardDescription className="text-xs">A saved report keeps the numbers exactly as they were the day it was saved.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border divide-y">
          {saved.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2">
              <button className="text-left min-w-0 flex-1" onClick={() => onOpen(r)}>
                <p className="text-sm font-semibold truncate">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {r.matchDate ?? ""}{r.matchDate ? "  ·  " : ""}<span className="text-[11px]">saved {savedLabel(r.createdAt)}</span>
                </p>
              </button>
              <Button variant="ghost" size="sm" className="h-7 px-2 shrink-0" disabled={deleting === r.id}
                onClick={async () => {
                  setDeleting(r.id);
                  try { await deleteMatchReport(r.id); onChanged(); } finally { setDeleting(null); }
                }}>
                {deleting === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

type SendState = { status: "pending" | "sending" | "sent" | "failed"; reason?: string };

interface CoachRow { name: string; email: string; }

const FROM_OPTIONS = [
  "BUFC Performance Hub <noreply@gameinsights.com.au>",
  "Scott Conlon <scott@gameinsights.com.au>",
];

function EmailCoachesDialog({ model }: { model: FootballMatchReportModel }) {
  const [open, setOpen] = useState(false);
  const { activeLeagueId } = useActiveLeague();
  const queryClient = useQueryClient();

  const listParams = { leagueId: activeLeagueId ?? 0 };
  const { data: savedCoaches } = useListMatchReportCoachEmails(
    listParams,
    { query: { enabled: open && activeLeagueId != null, queryKey: getListMatchReportCoachEmailsQueryKey(listParams) } },
  );

  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!open) { setLoaded(false); return; }
    if (savedCoaches && !loaded) {
      const mine = savedCoaches.map(c => ({ name: c.name ?? "", email: c.email }));
      setCoaches(mine.length ? mine : [{ name: "", email: "" }]);
      setLoaded(true);
    }
  }, [open, savedCoaches, loaded]);

  const matchLine = model.matchLabel;
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [from, setFrom] = useState(FROM_OPTIONS[0]);
  const [coachNote, setCoachNote] = useState("");
  const [sendStates, setSendStates] = useState<Map<number, SendState>>(new Map());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubject(`Match Report — ${matchLine}`);
    setBody(`Hi,\n\nAttached is the match report for ${matchLine} — the story of the game, with every number judged against the rest of our season.\n\nCheers,\nScott`);
    setFrom(FROM_OPTIONS[0]);
    setCoachNote("");
    setSendStates(new Map());
    setBusy(false);
    setDone(false);
  }, [open, matchLine]);

  const setCoach = (i: number, patch: Partial<CoachRow>) =>
    setCoaches(prev => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const send = async () => {
    if (activeLeagueId == null) return;
    const targets = coaches
      .map((c, i) => ({ ...c, i, email: c.email.trim() }))
      .filter(c => c.email);
    if (!targets.length) return;
    setBusy(true);
    setDone(false);
    const states = new Map<number, SendState>(targets.map(t => [t.i, { status: "pending" as const }]));
    setSendStates(new Map(states));

    // Save the list first so next week it's pre-filled
    try {
      await saveMatchReportCoachEmails({ leagueId: activeLeagueId, coaches: targets.map(t => ({ name: t.name.trim() || undefined, email: t.email })) });
      queryClient.invalidateQueries({ queryKey: getListMatchReportCoachEmailsQueryKey(listParams) });
    } catch {
      setBusy(false);
      setDone(true);
      setSendStates(new Map(targets.map(t => [t.i, { status: "failed" as const, reason: "Couldn't save the coach list — check the addresses and try again" }])));
      return;
    }

    // Build the deck ONCE, send to each coach
    let fileName = "", base64: string | undefined;
    try {
      const { generateFootballMatchReport } = await import("@/lib/matchReportPptx");
      ({ fileName, base64 } = await generateFootballMatchReport(model, coachNote.trim() || undefined, "base64"));
    } catch {
      setBusy(false);
      setDone(true);
      setSendStates(new Map(targets.map(t => [t.i, { status: "failed" as const, reason: "Couldn't build the report deck" }])));
      return;
    }

    for (const t of targets) {
      states.set(t.i, { status: "sending" });
      setSendStates(new Map(states));
      try {
        await sendMatchReportEmail({
          to: t.email,
          subject: subject.trim() || `Match Report — ${matchLine}`,
          body,
          from,
          fileName,
          pptxBase64: base64!,
          leagueId: activeLeagueId,
        });
        states.set(t.i, { status: "sent" });
      } catch (e) {
        console.error(e);
        states.set(t.i, { status: "failed", reason: "Send failed" });
      }
      setSendStates(new Map(states));
    }
    setBusy(false);
    setDone(true);
  };

  const sentCount = [...sendStates.values()].filter(s => s.status === "sent").length;
  const failedCount = [...sendStates.values()].filter(s => s.status === "failed").length;
  const targetCount = coaches.filter(c => c.email.trim()).length;

  return (
    <Dialog open={open} onOpenChange={v => { if (!busy) setOpen(v); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Mail className="h-4 w-4 mr-1.5" /> Email to coaches</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Email the match report</DialogTitle>
          <DialogDescription>
            Sends the {matchLine} deck to the football coach list. The list is remembered for next week.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Football coaches</Label>
            <div className="rounded-md border divide-y">
              {coaches.map((c, i) => {
                const st = sendStates.get(i);
                return (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5">
                    <Input value={c.name} onChange={e => setCoach(i, { name: e.target.value })}
                      placeholder="Name (optional)" disabled={busy} className="h-7 text-xs w-32 shrink-0" />
                    <Input value={c.email} onChange={e => setCoach(i, { email: e.target.value })}
                      placeholder="coach@example.com" disabled={busy} className="h-7 text-xs flex-1 min-w-0" />
                    <span className="w-5 shrink-0 flex justify-center">
                      {st?.status === "sending" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                      {st?.status === "sent" && <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />}
                      {st?.status === "failed" && <span title={st.reason}><XCircle className="h-3.5 w-3.5 text-destructive" /></span>}
                    </span>
                    <Button variant="ghost" size="sm" className="h-7 px-1.5 shrink-0" disabled={busy}
                      onClick={() => setCoaches(prev => prev.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button variant="secondary" size="sm" className="h-7 px-2 text-xs" disabled={busy}
              onClick={() => setCoaches(prev => [...prev, { name: "", email: "" }])}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add coach
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fmr-from">Send from</Label>
            <Select value={from} onValueChange={setFrom} disabled={busy}>
              <SelectTrigger id="fmr-from"><SelectValue /></SelectTrigger>
              <SelectContent>{FROM_OPTIONS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fmr-subject">Subject</Label>
            <Input id="fmr-subject" value={subject} onChange={e => setSubject(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fmr-body">Message</Label>
            <Textarea id="fmr-body" rows={4} value={body} onChange={e => setBody(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fmr-note">Closing note inside the deck (optional)</Label>
            <Textarea id="fmr-note" rows={2} value={coachNote} onChange={e => setCoachNote(e.target.value)} disabled={busy}
              placeholder="e.g. Second halves are still costing us — pressing triggers are Tuesday's focus." />
          </div>

          {done && (
            <div className={`flex items-center gap-2 text-sm rounded-md border p-3 ${failedCount ? "border-amber-500/50" : "border-green-500/50"}`}>
              {failedCount ? <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" /> : <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
              <span>{sentCount} sent{failedCount ? `, ${failedCount} failed — hover the red cross for the reason` : " — all done"}</span>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{done ? "Close" : "Cancel"}</Button>
          <Button onClick={send} disabled={busy || !targetCount}>
            {busy
              ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Sending…</>
              : <><Mail className="h-4 w-4 mr-1.5" /> Send to {targetCount} coach{targetCount === 1 ? "" : "es"}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
