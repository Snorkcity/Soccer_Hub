import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  createMatchPrepReport,
  deleteMatchPrepReport,
  type OpponentProfileResponse,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { FileDown, Loader2, Copy, Trash2, Sparkles } from "lucide-react";
import { KIND_DEFS, parseEntryDate, type JournalStandaloneKind } from "@/lib/journalFields";

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
  const { data: reflections } = useListJournalReflections({
    query: { queryKey: getListJournalReflectionsQueryKey() },
  });

  const queryClient = useQueryClient();
  const { data: savedReports } = useListMatchPrepReports({
    query: { queryKey: getListMatchPrepReportsQueryKey() },
  });
  // Sort briefings by the Monday they cover, newest first (fall back to saved time).
  const mondayTime = (r: { data?: unknown; updatedAt: string }): number => {
    const wk = ((r.data ?? {}) as { weekOf?: string }).weekOf ?? "";
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
  const [drafting, setDrafting] = useState(false);
  // Which saved row is currently building its PowerPoint (row spinner).
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  async function refreshList() {
    await queryClient.invalidateQueries({ queryKey: getListMatchPrepReportsQueryKey() });
  }

  type SavedBriefData = { opponent?: string; weekOf?: string; review?: string[]; pointers?: string[] };

  /** "Start new from this" — duplicate a saved briefing for the coming Monday. */
  async function copySaved(r: NonNullable<typeof savedReports>[number]) {
    const data = (r.data ?? {}) as SavedBriefData;
    const opponent = data.opponent ?? r.opponent ?? "";
    const wk = comingMonday();
    try {
      await createMatchPrepReport({
        kind: "monday",
        title: `Week Ahead — vs ${opponent} (${wk})`,
        opponent,
        data: { opponent, weekOf: wk, review: data.review ?? [], pointers: data.pointers ?? [] },
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
      const [theirs, ours] = await Promise.all([
        getOpponentProfile({ teamId, seasonId, club: weekOpp }),
        getOpponentProfile({ teamId, seasonId, club: "Belconnen" }),
      ]);
      const theirGames = lastGames(theirs, 3);
      const ourGames = lastGames(ours, 3);

      const sorted = [...(reflections ?? [])].sort(
        (a, b) =>
          (parseEntryDate(b.entryDate) ?? new Date(b.createdAt).getTime()) -
          (parseEntryDate(a.entryDate) ?? new Date(a.createdAt).getTime()),
      );
      const latestMatch = sorted.find((r) => r.kind === "match_reflection");
      // All training sessions since the last game (there are usually 1–2 per
      // week); fall back to the single latest if none are newer than the game.
      const matchTime = latestMatch
        ? (parseEntryDate(latestMatch.entryDate) ?? new Date(latestMatch.createdAt).getTime())
        : 0;
      const trainings = sorted.filter((r) => r.kind === "session_reflection");
      const sinceMatch = trainings.filter(
        (r) => (parseEntryDate(r.entryDate) ?? new Date(r.createdAt).getTime()) >= matchTime,
      );
      const recentTrainings = (sinceMatch.length ? sinceMatch : trainings.slice(0, 1)).slice(0, 3);
      const oppNeedle = weekOpp.toLowerCase();
      const lastVsOpp = sorted.find(
        (r) =>
          r.kind === "match_reflection" &&
          `${r.title ?? ""} ${Object.values(r.content).join(" ")}`.toLowerCase().includes(oppNeedle),
      );

      const recent = [...recentTrainings, latestMatch].filter(
        (r): r is NonNullable<typeof r> => r != null,
      );
      const brief = await createWeekAheadBrief({
        opponent: weekOpp,
        reflectionsText: recent
          .map((r) => `${KIND_DEFS[r.kind as JournalStandaloneKind]?.title ?? r.kind} (${r.entryDate ?? ""}):\n${reflectionText(r)}`)
          .join("\n\n") || undefined,
        lastVsOpponentText: lastVsOpp ? reflectionText(lastVsOpp) : undefined,
        theirGamesText: gamesText(theirGames) || undefined,
        ourGamesText: gamesText(ourGames) || undefined,
      });

      // Save straight into the list — downloads happen from the saved rows.
      const wk = comingMonday();
      await createMatchPrepReport({
        kind: "monday",
        title: `Week Ahead — vs ${weekOpp} (${wk})`,
        opponent: weekOpp,
        data: { opponent: weekOpp, weekOf: wk, review: brief.review, pointers: brief.pointers },
      });
      await refreshList();
      toast({ title: "Briefing drafted and saved", description: "Download it from the list below." });
    } catch {
      toast({
        title: "Couldn't draft the briefing",
        description: "Check your connection and try again.",
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
        opponent,
        author: "Belconnen United FC",
        generatedOn: new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }),
        review: data.review ?? [],
        pointers: data.pointers ?? [],
        lastVsOpponent: lastVsOpp
          ? { title: "Match Reflection", date: lastVsOpp.entryDate ?? "", rows: reflectionRows(lastVsOpp) }
          : null,
        theirGames: lastGames(theirs, 3),
        ourGames: lastGames(ours, 3),
        ourSnapshot: clubSnapshot(ours, 3),
        theirSnapshot: clubSnapshot(theirs, 3),
      });
      await pptx.writeFile({ fileName: `Week Ahead — vs ${opponent}.pptx` });
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
          you play next, draft it, then download from the saved list below.
        </p>
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={weekOpp} onValueChange={setWeekOpp}>
            <SelectTrigger className="w-full sm:w-[240px]">
              <SelectValue placeholder="This week's opponent…" />
            </SelectTrigger>
            <SelectContent>
              {(oppClubs ?? []).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => void generateBrief()} disabled={!weekOpp || drafting}>
            {drafting ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Drafting…</>
            ) : (
              <><Sparkles className="h-4 w-4 mr-1" /> Draft with AI</>
            )}
          </Button>
        </div>

        {mondayReports.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs text-muted-foreground">Saved briefings</Label>
            <div className="space-y-1">
              {(showAllBriefs ? mondayReports : mondayReports.slice(0, 5)).map((r) => (
                <div key={r.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                  <span className="flex-1 truncate">{r.title}</span>
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
