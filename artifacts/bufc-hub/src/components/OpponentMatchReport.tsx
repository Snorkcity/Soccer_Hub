// Opponent Match Report — a slimmed scouting version of the Football Match
// Report for ANY league club's game, built from the league tables only
// (no GPS, no possession). Pick a match from the selected club's season;
// downloadable as the same dark PPTX deck (scouting variant).
import { useMemo, useState } from "react";
import {
  useGetOpponentMatchReport, getGetOpponentMatchReportQueryKey,
  type MatchReportResponse, type OpponentProfileMatch,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Sparkles, ShieldCheck, AlertTriangle, Info, History, FileDown, Loader2 } from "lucide-react";
import type { FootballMatchReportModel } from "@/lib/matchReportPptx";

interface Props {
  teamId: number;
  seasonId: number;
  club: string;                       // the league club the report is about
  matches: OpponentProfileMatch[];    // that club's season, from the profile
}

const resultBadge = (r: string | null | undefined) =>
  r === "W" ? "bg-green-500/15 text-green-600 border-green-500/30"
  : r === "L" ? "bg-red-500/15 text-red-600 border-red-500/30"
  : "bg-amber-500/15 text-amber-600 border-amber-500/30";

export default function OpponentMatchReport({ teamId, seasonId, club, matches }: Props) {
  const sorted = useMemo(
    () => matches.slice().sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? "")),
    [matches],
  );
  const [pickedId, setPickedId] = useState<string | null>(null);
  const matchId = pickedId ?? sorted[0]?.matchId ?? null;
  const picked = sorted.find(m => m.matchId === matchId) ?? null;

  const params = { teamId, seasonId, club, matchId: matchId ?? "" };
  const { data: report, isLoading } = useGetOpponentMatchReport(params, {
    query: { enabled: !!matchId, queryKey: getGetOpponentMatchReportQueryKey(params) },
  });

  const [downloading, setDownloading] = useState(false);
  const downloadDeck = async () => {
    if (!report || !picked) return;
    setDownloading(true);
    try {
      const model: FootballMatchReportModel = {
        report,
        matchLabel: report.header.matchLabel,
        round: picked.matchId.split("-")[0],
        opponent: report.header.opponent,
        matchDate: report.header.matchDate ?? null,
        generatedOn: new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }),
        subjectClub: club,
      };
      const { generateFootballMatchReport } = await import("@/lib/matchReportPptx");
      await generateFootballMatchReport(model, undefined);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={matchId ?? undefined} onValueChange={setPickedId}>
          <SelectTrigger className="w-80"><SelectValue placeholder="Pick a match" /></SelectTrigger>
          <SelectContent>
            {sorted.map(m => (
              <SelectItem key={m.matchId} value={m.matchId}>
                {m.matchId.split("-")[0]} v {m.opponent} · {m.result} {m.scored}–{m.conceded}{m.matchDate ? ` · ${m.matchDate}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isLoading && <span className="text-sm text-muted-foreground">Building report…</span>}
        <Button variant="outline" size="sm" className="sm:ml-auto" onClick={downloadDeck} disabled={downloading || !report}>
          {downloading ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <FileDown className="h-4 w-4 mr-1.5" />}
          Download deck
        </Button>
      </div>

      {report && <ReportBody report={report} club={club} />}
      {!isLoading && sorted.length === 0 && (
        <div className="text-sm text-muted-foreground">No league matches recorded for {club} this season.</div>
      )}
    </div>
  );
}

function ReportBody({ report, club }: { report: MatchReportResponse; club: string }) {
  return (
    <>
      {/* ── Header: scoreline + form strip (from the club's perspective) ── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-muted-foreground font-normal">{club}</span>
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
                Scouting view — results and badges read from {club}'s side of the game.
                {report.header.matchDate ? ` · ${report.header.matchDate}` : ""}
                {report.header.halfScore ? ` · HT ${report.header.halfScore} (home–away)` : ""}
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

      {/* ── Goal DNA (scouting voice from the server) ─────────────────────── */}
      {report.goalDna && (() => {
        const dna = report.goalDna;
        const sideBlock = (side: typeof dna.scored, title: string, isScored: boolean) => (
          <div className="space-y-3">
            <div className={`text-sm font-semibold ${isScored ? "text-green-600" : "text-red-500"}`}>
              {title} — {side.totalTyped} typed this season
            </div>
            {side.matchLines.length > 0 ? (
              <div className="space-y-1.5">
                {side.matchLines.map((l, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    {isScored
                      ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
                      : <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-green-500" />}
                    <span>{l}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Nothing out of the ordinary in this game.</div>
            )}
            {side.totalTyped > 0 && (
              <div className="space-y-1">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Season mix ({side.totalTyped} goals)</div>
                {side.categories.map(c => {
                  const flagged = c.verdict != null;
                  // Scouting flip: THEIR over-benchmark scoring is a threat
                  // (amber), their over-benchmark conceding is our opening (green).
                  const goodForUs = c.verdict === "high" ? !isScored : isScored;
                  return (
                    <div key={c.id} className="flex items-center gap-2 text-xs">
                      <span className="w-40 shrink-0">{c.label}</span>
                      <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                        <div
                          className={`h-full ${flagged ? (goodForUs ? "bg-green-500" : "bg-amber-500") : "bg-primary/60"}`}
                          style={{ width: `${Math.min(100, c.pct ?? 0)}%` }}
                        />
                      </div>
                      <span className="w-24 text-right font-mono">{c.pct != null ? `${c.pct.toFixed(0)}%` : "—"} <span className="text-muted-foreground">/ {c.benchmarkLabel}</span></span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-amber-500" />Goal DNA — their patterns
              </CardTitle>
              <CardDescription className="text-xs">
                How {club} score and concede across the season, against the league benchmarks. Amber = a threat to plan for; green = an opening to exploit.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {sideBlock(dna.scored, "They scored", true)}
                {sideBlock(dna.conceded, "They conceded", false)}
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* ── Scouting notes ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-sky-500" />The scout's notes</CardTitle>
            <CardDescription className="text-xs">What this game says about {club}, with their season as context.</CardDescription>
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

        {/* ── Goals timeline ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">How the goals came</CardTitle>
            <CardDescription className="text-xs">Every goal, with the scorer's league season tally.</CardDescription>
          </CardHeader>
          <CardContent>
            {report.goals.length === 0 && <div className="text-sm text-muted-foreground">No goal detail recorded for this match.</div>}
            <div className="space-y-1.5">
              {report.goals.map((g, i) => (
                <div key={i} className={`flex items-start gap-3 rounded-md p-2 text-sm ${g.ours ? "" : "bg-red-500/5"}`}>
                  <span className="w-9 shrink-0 text-right font-mono text-xs text-muted-foreground pt-0.5">{g.minute != null ? `${g.minute}'` : "—"}</span>
                  <div className="min-w-0">
                    <div className={`font-medium ${g.ours ? "" : "text-red-500"}`}>
                      {g.ours ? g.scorer ?? "Goal" : `Conceded${g.scorer ? ` — ${g.scorer}` : ""}`}
                      {g.ours && g.assist && g.assist !== "OG" && <span className="text-muted-foreground font-normal"> (assist {g.assist})</span>}
                    </div>
                    {g.note && <div className="text-[11px] text-muted-foreground">{g.note}</div>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Previous meetings of this pairing ────────────────────────────── */}
      {report.previousMeetings.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4 text-sky-500" />Earlier this season v {report.header.opponent}</CardTitle>
            <CardDescription className="text-xs">How the previous meetings of this pairing went, from {club}'s side.</CardDescription>
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
    </>
  );
}
