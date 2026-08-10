import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveLeague } from "@/contexts/LeagueContext";
import {
  useListTeams,
  useListSeasons,
  useGetOpponentClubs,
  getGetOpponentClubsQueryKey,
  getOpponentProfile,
  createWeekAheadBrief,
  useListJournalReflections,
  getListJournalReflectionsQueryKey,
  useListMatchPrepReports,
  getListMatchPrepReportsQueryKey,
  useGetLastMeetingFacts,
  getGetLastMeetingFactsQueryKey,
  createMatchPrepReport,
  deleteMatchPrepReport,
  listMatches,
  getMatchReport,
  listMatchReports,
  type OpponentProfileResponse,
  type MatchReportResponse,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { FileDown, Loader2, Copy, Trash2, Sparkles } from "lucide-react";
import { KIND_DEFS, parseEntryDate, type JournalStandaloneKind } from "@/lib/journalFields";
import { openAiQuotaMessage } from "@/lib/openaiQuota";

/** Parse a match date that may be dd.mm.yyyy or ISO; NaN-safe. */
function parseMatchDate(raw: string | null | undefined): number {
  if (!raw) return 0;
  const ddmm = parseEntryDate(raw);
  if (ddmm != null) return ddmm;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

/** "Smith ×2, Brown — assists: Jones" for one game's scored goals. */
function scorersLine(goals: OpponentProfileResponse["goals"], matchId: string): string {
  const scored = goals.filter((g) => g.matchId === matchId && g.side === "scored");
  if (!scored.length) return "";
  const byScorer = new Map<string, number>();
  const byAssister = new Map<string, number>();
  for (const g of scored) {
    const s = (g.scorer ?? "").trim() || "Unknown";
    byScorer.set(s, (byScorer.get(s) ?? 0) + 1);
    const a = (g.assist ?? "").trim();
    if (a) byAssister.set(a, (byAssister.get(a) ?? 0) + 1);
  }
  const fmt = (m: Map<string, number>) =>
    [...m.entries()].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
  const scorers = fmt(byScorer);
  const assists = fmt(byAssister);
  return assists ? `${scorers} — assists: ${assists}` : scorers;
}

/** Last N games of a club profile, newest first, as report rows. */
function lastGames(profile: OpponentProfileResponse, n: number) {
  return [...profile.matches]
    .sort((a, b) => parseMatchDate(b.matchDate) - parseMatchDate(a.matchDate))
    .slice(0, n)
    .map((m) => ({
      date: m.matchDate ?? "",
      opponent: m.opponent,
      result: `${m.result} ${m.scored}–${m.conceded}`,
      scorers: scorersLine(profile.goals, m.matchId),
    }));
}

/** Scout-snapshot rows for one club: watch list, minutes, danger windows. */
function clubSnapshot(profile: OpponentProfileResponse, n: number): Array<[string, string]> {
  const ids = new Set(
    [...profile.matches]
      .sort((a, b) => parseMatchDate(b.matchDate) - parseMatchDate(a.matchDate))
      .slice(0, n)
      .map((m) => m.matchId),
  );

  // Players to watch — top goal involvements across those games.
  const contrib = new Map<string, { g: number; a: number }>();
  const bump = (name: string | null, key: "g" | "a") => {
    const clean = (name ?? "").trim();
    if (!clean) return;
    const c = contrib.get(clean) ?? { g: 0, a: 0 };
    c[key] += 1;
    contrib.set(clean, c);
  };
  for (const goal of profile.goals) {
    if (!ids.has(goal.matchId) || goal.side !== "scored") continue;
    bump(goal.scorer, "g");
    bump(goal.assist, "a");
  }
  const toWatch = [...contrib.entries()]
    .sort((a, b) => b[1].g + b[1].a - (a[1].g + a[1].a) || b[1].g - a[1].g)
    .slice(0, 3)
    .map(([name, c]) => `${name} (${[c.g ? `${c.g}G` : "", c.a ? `${c.a}A` : ""].filter(Boolean).join(" ")})`)
    .join(", ");

  // Most minutes — season aggregate and last-3-games window.
  const topMins = (players: OpponentProfileResponse["players"]) =>
    [...players]
      .sort((a, b) => b.minsPlayed - a.minsPlayed)
      .slice(0, 3)
      .map((p) => `${p.playerName} (${p.minsPlayed.toLocaleString()}')`)
      .join(", ");
  const minutes = [
    `Season – ${topMins(profile.players) || "—"}`,
    `Last 3 – ${topMins(profile.playersLast3) || "—"}`,
  ].join("\n");

  // Danger windows — busiest 15-min interval scored / conceded in those
  // games, plus the dominant goal type on a second line.
  const labels = ["1–15'", "16–30'", "31–45'", "46–60'", "61–75'", "76–90+'"];
  const window = (side: string): string => {
    const buckets = [0, 0, 0, 0, 0, 0];
    const types = new Map<string, number>();
    for (const goal of profile.goals) {
      if (!ids.has(goal.matchId) || goal.side !== side) continue;
      if (goal.minuteScored != null) {
        buckets[Math.min(Math.floor((goal.minuteScored - 1) / 15), 5)] += 1;
      }
      const t = (goal.goalType ?? "").trim();
      if (t) types.set(t, (types.get(t) ?? 0) + 1);
    }
    const max = Math.max(...buckets);
    if (!max && !types.size) return "—";
    const interval = max
      ? buckets
          .map((v, i) => (v === max ? `${labels[i]} (${v})` : null))
          .filter(Boolean)
          .join(", ")
      : "—";
    const topType = [...types.entries()].sort((a, b) => b[1] - a[1])[0];
    return [
      `Interval – ${interval}`,
      topType ? `Type – ${topType[0]} (${topType[1]})` : null,
    ]
      .filter(Boolean)
      .join("\n");
  };

  return [
    ["Players to watch (last 3)", toWatch || "—"],
    ["Most minutes", minutes],
    ["Scores most in (last 3)", window("scored")],
    ["Concedes most in (last 3)", window("conceded")],
  ];
}

function gamesText(games: ReturnType<typeof lastGames>): string {
  return games
    .map((g) => `${g.date} vs ${g.opponent}: ${g.result}${g.scorers ? ` (${g.scorers})` : ""}`)
    .join("\n");
}

/** Plain-text facts of one of OUR matches, from the match report: score line,
 * each goal with its Goal DNA category, and the tactical read. Feeds the AI. */
function matchFactsText(rep: MatchReportResponse): string {
  const h = rep.header;
  const lines: string[] = [
    `${h.matchLabel}${h.matchDate ? ` (${h.matchDate})` : ""} — result ${h.result ?? "?"}, score ${h.goalsScored ?? "?"}–${h.goalsConceded ?? "?"} to us${h.cleanSheet ? ", clean sheet" : ""}`,
  ];
  for (const g of rep.goalDna?.matchGoals ?? []) {
    lines.push(
      [
        g.side === "scored" ? "We scored" : "We conceded",
        g.minute != null ? `${g.minute}'` : "",
        g.scorer ?? "",
        g.category ? `— ${g.category}` : "",
        g.timing ? `(${g.timing === "DT" ? "in transition, before they reset" : "vs an organised defence"})` : "",
      ].filter(Boolean).join(" "),
    );
  }
  lines.push(...(rep.goalDna?.tacticalRead ?? []));
  return lines.join("\n");
}

/** The Monday of the coming week (today if it's Monday). */
function comingMonday(): string {
  const d = new Date();
  const add = (8 - d.getDay()) % 7; // Mon=1 → 0 when today is Monday
  d.setDate(d.getDate() + add);
  return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/**
 * "Week Ahead report" builder card — the Monday PowerPoint briefing.
 * Lives on the Match Prep page; pulls reflections + opponent profiles itself.
 */
export default function WeekAheadCard() {
  const { toast } = useToast();

  const { data: teams } = useListTeams({ query: { queryKey: ["listTeams"] } });
  const { data: seasons } = useListSeasons({ query: { queryKey: ["listSeasons"] } });
  const teamId = (teams?.find((t) => t.analyticsEnabled && t.gender === "female") ?? teams?.[0])?.id;
  const seasonId = (seasons?.find((s) => s.isActive) ?? seasons?.[0])?.id;
  const clubsParams = { teamId: teamId ?? 0, seasonId: seasonId ?? 0 };
  const { data: oppClubs } = useGetOpponentClubs(clubsParams, {
    query: {
      queryKey: getGetOpponentClubsQueryKey(clubsParams),
      enabled: teamId != null && seasonId != null,
    },
  });
  const { activeLeagueId } = useActiveLeague();
  const leagueParams = { leagueId: activeLeagueId ?? 0 };
  const { data: reflections } = useListJournalReflections(leagueParams, {
    query: { enabled: activeLeagueId != null, queryKey: getListJournalReflectionsQueryKey(leagueParams) },
  });

  const queryClient = useQueryClient();
  const { data: savedReports } = useListMatchPrepReports(leagueParams, {
    query: { enabled: activeLeagueId != null, queryKey: getListMatchPrepReportsQueryKey(leagueParams) },
  });
  // Sort briefings by the Monday they cover, newest first (fall back to saved time).
  const mondayTime = (r: { data?: unknown; updatedAt: string }): number => {
    const d = (r.data ?? {}) as { weekOf?: string; matchDate?: string };
    if (d.matchDate) {
      const t = new Date(`${d.matchDate}T12:00:00`).getTime();
      if (!Number.isNaN(t)) return t;
    }
    const wk = d.weekOf ?? "";
    const m = wk.match(/(\d{1,2}) (\w+) (\d{4})/);
    if (m) {
      const t = new Date(`${m[1]} ${m[2]} ${m[3]}`).getTime();
      if (!Number.isNaN(t)) return t;
    }
    return new Date(r.updatedAt).getTime();
  };
  const mondayReports = (savedReports ?? [])
    .filter((r) => r.kind === "monday")
    .sort((a, b) => mondayTime(b) - mondayTime(a));

  // Long seasons mean 20+ briefings — show the latest few, expand on demand.
  const [showAllBriefs, setShowAllBriefs] = useState(false);

  const [weekOpp, setWeekOpp] = useState("");
  const [weekRound, setWeekRound] = useState("");
  const [weekDate, setWeekDate] = useState(""); // yyyy-mm-dd from the date input
  const [drafting, setDrafting] = useState(false);
  // "Last time we met" panel — the same facts the briefing prompt and PPTX
  // use, shown as soon as an opponent is picked so he can sanity-check them.
  const lastMeetingParams = { seasonId: seasonId ?? 0, opponent: weekOpp };
  const { data: lastMeetingData, isLoading: lastMeetingLoading } = useGetLastMeetingFacts(
    lastMeetingParams,
    {
      query: {
        queryKey: getGetLastMeetingFactsQueryKey(lastMeetingParams),
        enabled: seasonId != null && !!weekOpp,
      },
    },
  );
  // Which saved row is currently building its PowerPoint (row spinner).
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  async function refreshList() {
    await queryClient.invalidateQueries({ queryKey: getListMatchPrepReportsQueryKey(leagueParams) });
  }

  type SavedBriefData = { opponent?: string; weekOf?: string; round?: string; matchDate?: string; review?: string[]; pointers?: string[]; trainingFocus?: string[]; lastMeeting?: string[] };

  /** "Sunday 2 August 2026" from the yyyy-mm-dd date input. */
  function niceGameDate(iso: string): string {
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  /** Saved-list name, matching the pre-match deck style: "Week Ahead — R17 v Tuggeranong — 2 August 2026". */
  function briefTitle(round: string, opponent: string, iso: string): string {
    const d = new Date(`${iso}T12:00:00`);
    const nice = Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
    return `Week Ahead — ${round ? `${round} ` : ""}v ${opponent}${nice ? ` — ${nice}` : ""}`;
  }

  /** "Start new from this" — duplicate a saved briefing for the coming Monday. */
  async function copySaved(r: NonNullable<typeof savedReports>[number]) {
    const data = (r.data ?? {}) as SavedBriefData;
    const opponent = data.opponent ?? r.opponent ?? "";
    const wk = comingMonday();
    try {
      await createMatchPrepReport({
        leagueId: activeLeagueId ?? 0,
        kind: "monday",
        title: briefTitle("", opponent, ""),
        opponent,
        data: { opponent, weekOf: wk, review: data.review ?? [], pointers: data.pointers ?? [], trainingFocus: data.trainingFocus ?? [], lastMeeting: data.lastMeeting ?? [] },
      });
      await refreshList();
      toast({ title: "New briefing created from that one", description: `Dated ${wk}.` });
    } catch {
      toast({ title: "Couldn't copy the briefing", variant: "destructive" });
    }
  }

  async function removeSaved(id: number) {
    try {
      await deleteMatchPrepReport(id);
      await refreshList();
    } catch {
      toast({ title: "Couldn't delete that briefing", variant: "destructive" });
    }
  }

  /** One reflection as [label, answer] rows, empty answers dropped. */
  function reflectionRows(r: NonNullable<typeof reflections>[number]): Array<[string, string]> {
    const def = KIND_DEFS[r.kind as JournalStandaloneKind] ?? KIND_DEFS.session_reflection;
    return def.fields
      .map((f): [string, string] => [f.label, (r.content[f.id] ?? "").trim()])
      .filter(([, v]) => v);
  }

  function reflectionText(r: NonNullable<typeof reflections>[number]): string {
    return reflectionRows(r).map(([q, a]) => `${q} ${a}`).join("\n");
  }

  async function generateBrief() {
    if (!weekOpp || teamId == null || seasonId == null) return;
    setDrafting(true);
    try {
      const [theirs, ours, ourMatches, savedMatchReports] = await Promise.all([
        getOpponentProfile({ teamId, seasonId, club: weekOpp }),
        getOpponentProfile({ teamId, seasonId, club: "Belconnen" }),
        listMatches({ teamId, seasonId }).catch(() => []),
        activeLeagueId != null
          ? listMatchReports({ leagueId: activeLeagueId }).catch(() => [])
          : Promise.resolve([]),
      ]);
      const theirGames = lastGames(theirs, 3);
      const ourGames = lastGames(ours, 3);

      // Continuity input 1 — what actually happened last time we met them:
      // the most recent recorded fixture vs this opponent, told through its
      // match report (score, each goal's DNA category, tactical read).
      const oppLc = weekOpp.trim().toLowerCase();
      // Played fixtures only (a future fixture vs them may already be listed),
      // newest first; if the top one's report fails, try the meeting before it.
      const now = Date.now();
      const pastMeetings = [...ourMatches]
        .filter((m) => (m.opponent ?? "").trim().toLowerCase() === oppLc)
        .filter((m) => {
          const t = parseMatchDate(m.matchDate);
          return t > 0 && t <= now;
        })
        .sort((a, b) => parseMatchDate(b.matchDate) - parseMatchDate(a.matchDate));
      let lastMeetingText: string | undefined;
      for (const meeting of pastMeetings.slice(0, 2)) {
        lastMeetingText = await getMatchReport({ teamId, seasonId, matchRowId: meeting.id })
          .then(matchFactsText)
          .catch(() => undefined);
        if (lastMeetingText) break;
      }

      // Continuity input 2 — the analyst's most recent SAVED match report
      // (whoever we played): its frozen report carries the same facts + read.
      const latestSaved = [...savedMatchReports].sort(
        (a, b) => parseMatchDate(b.matchDate) - parseMatchDate(a.matchDate)
          || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )[0];
      const savedModel = latestSaved?.data as { report?: MatchReportResponse } | undefined;
      const lastReportText = savedModel?.report
        ? `${latestSaved.title}\n${matchFactsText(savedModel.report)}${
            savedModel.report.goalDna?.comments?.length
              ? `\nSeason patterns flagged: ${savedModel.report.goalDna.comments.join(" ")}`
              : ""
          }`
        : undefined;

      const sorted = [...(reflections ?? [])].sort(
        (a, b) =>
          (parseEntryDate(b.entryDate) ?? new Date(b.createdAt).getTime()) -
          (parseEntryDate(a.entryDate) ?? new Date(a.createdAt).getTime()),
      );
      // Roughly the last 3 weeks of reflections (trainings + matches), newest
      // first — the brief looks for themes that recur across weeks, not just
      // what happened since the last game.
      const rTime = (r: NonNullable<typeof reflections>[number]) =>
        parseEntryDate(r.entryDate) ?? new Date(r.createdAt).getTime();
      const threeWeeksAgo = Date.now() - 22 * 24 * 60 * 60 * 1000;
      const windowed = sorted
        .filter((r) => r.kind === "session_reflection" || r.kind === "match_reflection")
        .filter((r) => rTime(r) >= threeWeeksAgo)
        .slice(0, 10);
      // Never send an empty review section — fall back to the latest few.
      const recent = windowed.length ? windowed : sorted.slice(0, 4);
      const oppNeedle = weekOpp.toLowerCase();
      const lastVsOpp = sorted.find(
        (r) =>
          r.kind === "match_reflection" &&
          `${r.title ?? ""} ${Object.values(r.content).join(" ")}`.toLowerCase().includes(oppNeedle),
      );
      // What we trained on in the ~10 days before the last meeting vs this
      // opponent — lets the brief connect "what we worked on then" to now.
      let prevMeetingPrepText: string | undefined;
      if (lastVsOpp) {
        const meetT = rTime(lastVsOpp);
        const prepRows = sorted.filter(
          (r) =>
            r.kind === "session_reflection" &&
            rTime(r) < meetT &&
            rTime(r) >= meetT - 10 * 24 * 60 * 60 * 1000,
        );
        prevMeetingPrepText =
          prepRows
            .map((r) => `Training (${r.entryDate ?? ""}):\n${reflectionText(r)}`)
            .join("\n\n") || undefined;
      }
      const brief = await createWeekAheadBrief({
        opponent: weekOpp,
        seasonId,
        leagueId: activeLeagueId ?? undefined,
        reflectionsText: recent
          .map((r) => `${KIND_DEFS[r.kind as JournalStandaloneKind]?.title ?? r.kind} (${r.entryDate ?? ""}):\n${reflectionText(r)}`)
          .join("\n\n") || undefined,
        lastVsOpponentText: lastVsOpp ? reflectionText(lastVsOpp) : undefined,
        prevMeetingPrepText,
        lastMeetingText,
        lastReportText,
        theirGamesText: gamesText(theirGames) || undefined,
        ourGamesText: gamesText(ourGames) || undefined,
      });

      // Save straight into the list — downloads happen from the saved rows.
      const wk = weekDate ? niceGameDate(weekDate) : comingMonday();
      await createMatchPrepReport({
        leagueId: activeLeagueId ?? 0,
        kind: "monday",
        title: briefTitle(weekRound, weekOpp, weekDate),
        opponent: weekOpp,
        data: {
          opponent: weekOpp,
          weekOf: wk,
          round: weekRound || undefined,
          matchDate: weekDate || undefined,
          review: brief.review,
          pointers: brief.pointers,
          trainingFocus: brief.trainingFocus ?? [],
          lastMeeting: brief.lastMeeting ?? [],
        },
      });
      await refreshList();
      toast({ title: "Briefing created and saved", description: "Download it from the list below." });
    } catch (e) {
      toast({
        title: "Couldn't draft the briefing",
        description: openAiQuotaMessage(e) ?? "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setDrafting(false);
    }
  }

  /** Build and download the PowerPoint for one saved briefing row. */
  async function downloadSaved(r: NonNullable<typeof savedReports>[number]) {
    const data = (r.data ?? {}) as SavedBriefData;
    const opponent = data.opponent ?? r.opponent ?? "";
    if (!opponent || teamId == null || seasonId == null) return;
    setDownloadingId(r.id);
    try {
      const [theirs, ours] = await Promise.all([
        getOpponentProfile({ teamId, seasonId, club: opponent }),
        getOpponentProfile({ teamId, seasonId, club: "Belconnen" }),
      ]);
      const oppNeedle = opponent.toLowerCase();
      const lastVsOpp = [...(reflections ?? [])]
        .sort(
          (a, b) =>
            (parseEntryDate(b.entryDate) ?? new Date(b.createdAt).getTime()) -
            (parseEntryDate(a.entryDate) ?? new Date(a.createdAt).getTime()),
        )
        .find(
          (r) =>
            r.kind === "match_reflection" &&
            `${r.title ?? ""} ${Object.values(r.content).join(" ")}`.toLowerCase().includes(oppNeedle),
        );
      const { buildWeekAheadPptx } = await import("@/lib/weekAheadPptx");
      const pptx = buildWeekAheadPptx({
        weekOf: data.weekOf || comingMonday(),
        round: data.round,
        opponent,
        author: "Belconnen United FC",
        generatedOn: new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }),
        review: data.review ?? [],
        pointers: data.pointers ?? [],
        trainingFocus: data.trainingFocus ?? [],
        lastMeeting: data.lastMeeting ?? [],
        lastVsOpponent: lastVsOpp
          ? { title: "Match Reflection", date: lastVsOpp.entryDate ?? "", rows: reflectionRows(lastVsOpp) }
          : null,
        theirGames: lastGames(theirs, 3),
        ourGames: lastGames(ours, 3),
        ourSnapshot: clubSnapshot(ours, 3),
        theirSnapshot: clubSnapshot(theirs, 3),
      });
      const rawRound = (data.round ?? "").trim();
      const roundTag = rawRound ? (/^r/i.test(rawRound) ? rawRound.toUpperCase() : `R${rawRound}`) : "R";
      await pptx.writeFile({ fileName: `${roundTag}-Week_Ahead-${opponent.trim().replace(/\s+/g, "_")}.pptx` });
    } catch {
      toast({
        title: "Couldn't build the report",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Your Monday briefing as a PowerPoint: last week's reflections reviewed, then the
          coming opponent — their last 3 games, ours, and prep pointers for the week. Pick who
          you play next, add the round and game date, then download from the saved list below.
        </p>
        <div className="flex gap-2 flex-wrap items-end">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">This week's opponent</Label>
            <Select value={weekOpp} onValueChange={setWeekOpp}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Pick a club…" />
              </SelectTrigger>
              <SelectContent>
                {(oppClubs ?? []).map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Round</Label>
            <Input value={weekRound} onChange={(e) => setWeekRound(e.target.value)} placeholder="e.g. R16" className="w-[90px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Game date</Label>
            <Input type="date" value={weekDate} onChange={(e) => setWeekDate(e.target.value)} className="w-[160px]" />
          </div>
          <Button onClick={() => void generateBrief()} disabled={!weekOpp || drafting}>
            {drafting ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Creating…</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-1" /> Create with AI</>
            )}
          </Button>
        </div>

        {weekOpp && (
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Last time we met
            </p>
            {lastMeetingLoading ? (
              <p className="text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
              </p>
            ) : lastMeetingData && lastMeetingData.facts.length > 0 ? (
              <ul className="space-y-0.5">
                {lastMeetingData.facts.map((line, i) => (
                  <li key={i} className={i === 0 ? "font-medium" : "text-muted-foreground"}>
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">First meeting this season.</p>
            )}
          </div>
        )}

        {mondayReports.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs text-muted-foreground">Saved briefings</Label>
            <div className="space-y-1">
              {(showAllBriefs ? mondayReports : mondayReports.slice(0, 5)).map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                  <span className="flex-1 truncate">
                    {(() => {
                      const data = (r.data ?? {}) as SavedBriefData;
                      if (!data.round && !data.matchDate) return r.title; // legacy briefings keep their saved name
                      const gameDate = data.matchDate
                        ? new Date(`${data.matchDate}T12:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
                        : "";
                      return (
                        <>
                          <span className="font-semibold">Week Ahead — {data.round || "—"} v {data.opponent ?? r.opponent ?? "?"}</span>
                          {gameDate && <span className="text-muted-foreground"> · {gameDate}</span>}
                          <span className="text-muted-foreground text-xs"> · saved {new Date(r.updatedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>
                        </>
                      );
                    })()}
                  </span>
                  <Button variant="ghost" size="sm" className="h-7 px-2" title="Download report" disabled={downloadingId != null} onClick={() => void downloadSaved(r)}>
                    {downloadingId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2" title="Start a new briefing from this one" onClick={() => void copySaved(r)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" title="Delete" onClick={() => void removeSaved(r.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            {mondayReports.length > 5 && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setShowAllBriefs((v) => !v)}>
                {showAllBriefs ? "Show fewer" : `Show all (${mondayReports.length})`}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
