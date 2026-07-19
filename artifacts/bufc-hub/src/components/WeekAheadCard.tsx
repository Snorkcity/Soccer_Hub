import { useState } from "react";
import {
  useListTeams,
  useListSeasons,
  useGetOpponentClubs,
  getGetOpponentClubsQueryKey,
  getOpponentProfile,
  createWeekAheadBrief,
  useListJournalReflections,
  getListJournalReflectionsQueryKey,
  type OpponentProfileResponse,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { FileDown, Loader2 } from "lucide-react";
import { KIND_DEFS, type JournalStandaloneKind } from "@/lib/journalFields";

/** Parse the coach's dd.mm.yyyy entry date; null if it doesn't parse. */
export function parseEntryDate(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const t = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  return Number.isNaN(t) ? null : t;
}

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

  const [weekOpp, setWeekOpp] = useState("");
  const [building, setBuilding] = useState(false);

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

  async function buildWeekAhead() {
    if (!weekOpp || teamId == null || seasonId == null) return;
    setBuilding(true);
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

      const { buildWeekAheadPptx } = await import("@/lib/weekAheadPptx");
      const pptx = buildWeekAheadPptx({
        weekOf: comingMonday(),
        opponent: weekOpp,
        author: "Belconnen United FC",
        generatedOn: new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }),
        review: brief.review,
        pointers: brief.pointers,
        lastVsOpponent: lastVsOpp
          ? { title: "Match Reflection", date: lastVsOpp.entryDate ?? "", rows: reflectionRows(lastVsOpp) }
          : null,
        theirGames,
        ourGames,
        ourSnapshot: clubSnapshot(ours, 3),
        theirSnapshot: clubSnapshot(theirs, 3),
      });
      await pptx.writeFile({ fileName: `Week Ahead — vs ${weekOpp}.pptx` });
    } catch {
      toast({
        title: "Couldn't build the report",
        description: "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setBuilding(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Your Monday briefing as a PowerPoint: last week's reflections reviewed, then the
          coming opponent — their last 3 games, ours, and prep pointers for the week. Pick who
          you play next and build it.
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
          <Button onClick={() => void buildWeekAhead()} disabled={!weekOpp || building}>
            {building ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Building…</>
            ) : (
              <><FileDown className="h-4 w-4 mr-1" /> Build report</>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
