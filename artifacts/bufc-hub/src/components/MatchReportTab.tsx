// Football Match Report — the "EPL analyst" view of a single game.
// Pick a match, get the story: result strip, stat tiles vs season, scorers
// with season context, and coach-style insight lines. All computed
// server-side by /analytics/match-report.
import { useMemo, useState } from "react";
import {
  useListMatches, getListMatchesQueryKey,
  useGetMatchReport, getGetMatchReportQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ShieldCheck, AlertTriangle, Info, Activity, History } from "lucide-react";

interface Props {
  teamId: number;
  seasonId: number;
}

const resultBadge = (r: string | null | undefined) =>
  r === "W" ? "bg-green-500/15 text-green-600 border-green-500/30"
  : r === "L" ? "bg-red-500/15 text-red-600 border-red-500/30"
  : "bg-amber-500/15 text-amber-600 border-amber-500/30";

export default function MatchReportTab({ teamId, seasonId }: Props) {
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

  const reportParams = { teamId, seasonId, matchRowId: selectedId ?? 0 };
  const { data: report, isLoading } = useGetMatchReport(reportParams, {
    query: { enabled: selectedId != null, queryKey: getGetMatchReportQueryKey(reportParams) },
  });

  const roundOf = (matchId: string, opponent: string, date?: string | null) =>
    `${matchId.split("-")[0]} v ${opponent}${date ? ` · ${date}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedId != null ? String(selectedId) : undefined} onValueChange={v => setMatchRowId(Number(v))}>
          <SelectTrigger className="w-72"><SelectValue placeholder="Pick a match" /></SelectTrigger>
          <SelectContent>
            {sorted.map(m => (
              <SelectItem key={m.id} value={String(m.id)}>{roundOf(m.matchId, m.opponent, m.matchDate)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isLoading && <span className="text-sm text-muted-foreground">Building report…</span>}
      </div>

      {report && (
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
                    <div key={i} title={`${f.opponent} ${f.score}`}
                      className={`h-7 w-7 rounded-full grid place-items-center text-xs font-semibold border
                        ${f.result === "W" ? "bg-green-500/15 text-green-600 border-green-500/40"
                          : f.result === "L" ? "bg-red-500/15 text-red-600 border-red-500/40"
                          : "bg-amber-500/15 text-amber-600 border-amber-500/40"}
                        ${f.isThisMatch ? "ring-2 ring-primary" : "opacity-80"}`}>
                      {f.result}
                    </div>
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
                      <div className="text-[11px] text-muted-foreground mt-0.5">
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
                      ["Team distance", report.gps.totalDistanceKm, "km", 1],
                      ["Defenders", report.gps.defendersMPerMin, "m/min", 0],
                      ["Midfielders", report.gps.midfieldersMPerMin, "m/min", 0],
                      ["Forwards HSM", report.gps.forwardsHighSpeedM, "m", 0],
                    ] as const).map(([label, v, unit, dp]) => (
                      <div key={label}>
                        <div className="text-xs text-muted-foreground">{label}</div>
                        <div className="text-xl font-semibold">{v != null ? v.toFixed(dp) : "—"}<span className="text-xs font-normal text-muted-foreground ml-1">{unit}</span></div>
                      </div>
                    ))}
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
        </>
      )}
    </div>
  );
}
