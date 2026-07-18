import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTeams,
  useListSeasons,
  useGetOpponentClubs,
  getGetOpponentClubsQueryKey,
  getOpponentProfile,
  createWeekAheadBrief,
  type OpponentProfileResponse,
  useListJournalCycles,
  getListJournalCyclesQueryKey,
  useCreateJournalCycle,
  useDeleteJournalCycle,
  useListJournalReflections,
  getListJournalReflectionsQueryKey,
  useCreateJournalReflection,
  useUpdateJournalReflection,
  useDeleteJournalReflection,
  useGetAuthStatus,
  getGetAuthStatusQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { BookHeart, CalendarRange, FileDown, Loader2, Mic, NotebookPen, Plus, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import InterviewDialog from "@/components/InterviewDialog";
import { KIND_DEFS, filledCount, type JournalStandaloneKind } from "@/lib/journalFields";

const STANDALONE_KINDS: JournalStandaloneKind[] = ["session_reflection", "match_reflection"];

/** Parse the coach's dd.mm.yyyy entry date; null if it doesn't parse. */
function parseEntryDate(raw: string | null | undefined): number | null {
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

function formatCaptured(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function Reflections() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: auth } = useGetAuthStatus({ query: { queryKey: getGetAuthStatusQueryKey() } });
  const canWrite = auth?.authenticated && auth.role === "admin";

  const { data: cycles, isLoading: cyclesLoading } = useListJournalCycles({
    query: { queryKey: getListJournalCyclesQueryKey() },
  });
  const { data: reflections, isLoading: reflLoading } = useListJournalReflections({
    query: { queryKey: getListJournalReflectionsQueryKey() },
  });

  // ── New cycle dialog ──
  const [cycleOpen, setCycleOpen] = useState(false);
  const [cycleTitle, setCycleTitle] = useState("");
  const [cycleWeeks, setCycleWeeks] = useState("6");
  const [cycleStart, setCycleStart] = useState("");

  const createCycle = useCreateJournalCycle({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getListJournalCyclesQueryKey() });
        setCycleOpen(false);
        navigate(`/reflections/${res.id}`);
      },
      onError: () => toast({ title: "Couldn't create the cycle", variant: "destructive" }),
    },
  });
  const deleteCycle = useDeleteJournalCycle({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListJournalCyclesQueryKey() }),
      onError: () => toast({ title: "Couldn't delete the cycle", variant: "destructive" }),
    },
  });

  // ── Standalone reflection editor ──
  const [reflOpen, setReflOpen] = useState(false);
  const [reflId, setReflId] = useState<number | null>(null);
  const [reflKind, setReflKind] = useState<JournalStandaloneKind>("session_reflection");
  const [reflTitle, setReflTitle] = useState("");
  const [reflDate, setReflDate] = useState("");
  const [reflContent, setReflContent] = useState<Record<string, string>>({});
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [fromInterview, setFromInterview] = useState(false);

  function openNewReflection(kind: JournalStandaloneKind) {
    setReflId(null);
    setReflKind(kind);
    setReflTitle("");
    // Default to today — most reflections are written on the day.
    const now = new Date();
    setReflDate(
      `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`,
    );
    setReflContent({});
    setFromInterview(false);
    setReflOpen(true);
  }
  function openExisting(r: NonNullable<typeof reflections>[number]) {
    setReflId(r.id);
    setReflKind(
      STANDALONE_KINDS.includes(r.kind as JournalStandaloneKind)
        ? (r.kind as JournalStandaloneKind)
        : "session_reflection",
    );
    setReflTitle(r.title ?? "");
    setReflDate(r.entryDate ?? "");
    setReflContent({ ...r.content });
    setFromInterview(false);
    setReflOpen(true);
  }

  const invalidateRefl = () =>
    queryClient.invalidateQueries({ queryKey: getListJournalReflectionsQueryKey() });
  const createRefl = useCreateJournalReflection({
    mutation: {
      onSuccess: () => { invalidateRefl(); setReflOpen(false); },
      onError: () => toast({ title: "Couldn't save the reflection", variant: "destructive" }),
    },
  });
  const updateRefl = useUpdateJournalReflection({
    mutation: {
      onSuccess: () => { invalidateRefl(); setReflOpen(false); },
      onError: () => toast({ title: "Couldn't save the reflection", variant: "destructive" }),
    },
  });
  const deleteRefl = useDeleteJournalReflection({
    mutation: {
      onSuccess: () => invalidateRefl(),
      onError: () => toast({ title: "Couldn't delete the reflection", variant: "destructive" }),
    },
  });

  function saveReflection() {
    if (reflId == null) {
      createRefl.mutate({
        data: { kind: reflKind, title: reflTitle || undefined, entryDate: reflDate || undefined, content: reflContent, ...(fromInterview ? { source: "voice" as const } : {}) },
      });
    } else {
      updateRefl.mutate({
        id: reflId,
        data: { title: reflTitle || null, entryDate: reflDate || null, content: reflContent },
      });
    }
  }

  const reflDef = KIND_DEFS[reflKind];

  // ── Week Ahead report ──
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
      const latestTraining = sorted.find((r) => r.kind === "session_reflection");
      const latestMatch = sorted.find((r) => r.kind === "match_reflection");
      const oppNeedle = weekOpp.toLowerCase();
      const lastVsOpp = sorted.find(
        (r) =>
          r.kind === "match_reflection" &&
          `${r.title ?? ""} ${Object.values(r.content).join(" ")}`.toLowerCase().includes(oppNeedle),
      );

      const recent = [latestTraining, latestMatch].filter(
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
        reflections: recent.map((r) => ({
          title: KIND_DEFS[r.kind as JournalStandaloneKind]?.title ?? r.kind,
          date: r.entryDate ?? "",
          rows: reflectionRows(r),
        })),
        // Skip if it's the same entry already shown in full above.
        lastVsOpponent:
          lastVsOpp && lastVsOpp.id !== latestMatch?.id
            ? { title: "Match Reflection", date: lastVsOpp.entryDate ?? "", rows: reflectionRows(lastVsOpp) }
            : null,
        theirGames,
        ourGames,
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
    <div className="p-4 md:p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Reflections</h1>
        <p className="text-sm text-muted-foreground">
          Journal cycles for structured reflection, plus quick post-training and post-match reflections
        </p>
      </div>

      {/* ── Cycles ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-primary" /> Journal cycles
          </h2>
          {canWrite && (
            <Button onClick={() => { setCycleTitle(""); setCycleWeeks("6"); setCycleStart(""); setCycleOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> New cycle
            </Button>
          )}
        </div>
        {cyclesLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !cycles?.length ? (
          <Card><CardContent className="py-6 text-sm text-muted-foreground">
            No cycles yet. A cycle is a block of weeks (e.g. 6) with a weekly planner, reflections and game reviews — exported as your journal pptx.
          </CardContent></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cycles.map((c) => (
              <Card
                key={c.id}
                className="cursor-pointer hover:border-primary/60 transition-colors"
                onClick={() => navigate(`/reflections/${c.id}`)}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold leading-tight">{c.title}</div>
                    {canWrite && (
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${c.title}" and everything in it?`)) deleteCycle.mutate({ id: c.id });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap text-xs">
                    <Badge variant="secondary">{c.weeksCount} weeks</Badge>
                    {c.startDate && <Badge variant="outline">From {c.startDate}</Badge>}
                    <Badge variant="outline">{c.entryCount} blocks filled</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── Quick reflections ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BookHeart className="h-5 w-5 text-primary" /> Quick reflections
          </h2>
          {canWrite && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => openNewReflection("session_reflection")}>
                <NotebookPen className="h-4 w-4 mr-1" /> After training
              </Button>
              <Button variant="outline" onClick={() => openNewReflection("match_reflection")}>
                <NotebookPen className="h-4 w-4 mr-1" /> After a match
              </Button>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Mic className="h-3.5 w-3.5" /> Open a reflection and press “Interview me” to speak your answers instead of typing.
        </p>
        {reflLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !reflections?.length ? (
          <Card><CardContent className="py-6 text-sm text-muted-foreground">
            No quick reflections yet. Do one after each training and game — small, honest notes add up.
          </CardContent></Card>
        ) : (
          <div className="rounded-lg border divide-y">
            {[...reflections]
              .sort((a, b) => {
                // Newest at the top — by training/game date, with capture time
                // breaking ties on the same day.
                const da = parseEntryDate(a.entryDate) ?? new Date(a.createdAt).getTime();
                const db = parseEntryDate(b.entryDate) ?? new Date(b.createdAt).getTime();
                return db - da || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
              })
              .map((r) => {
                const def = KIND_DEFS[r.kind as JournalStandaloneKind] ?? KIND_DEFS.session_reflection;
                const filled = filledCount(def.kind, r.content);
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => openExisting(r)}
                  >
                    <Badge variant="secondary" className="shrink-0">
                      {r.kind === "match_reflection" ? "Match" : "Training"}
                    </Badge>
                    <span className="text-sm font-medium truncate min-w-0 flex-1">
                      {r.title || def.title}
                    </span>
                    {r.entryDate && (
                      <span className="text-xs text-muted-foreground shrink-0">{r.entryDate}</span>
                    )}
                    <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                      {filled}/{def.fields.length}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0 hidden md:inline">
                      captured {formatCaptured(r.createdAt)}
                    </span>
                    {canWrite && (
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm("Delete this reflection?")) deleteRefl.mutate({ id: r.id });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </section>

      {/* ── Week Ahead report ── */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileDown className="h-5 w-5 text-primary" /> Week Ahead report
        </h2>
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Your Monday briefing as a PowerPoint: last week's reflections reviewed, then the
              coming opponent — their last 3 games, ours, and prep pointers for the week. Pick who
              you play next and build it.
            </p>
            <div className="flex gap-2 flex-wrap items-center">
              <Select value={weekOpp} onValueChange={setWeekOpp}>
                <SelectTrigger className="w-[240px]">
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
      </section>

      {/* ── New cycle dialog ── */}
      <Dialog open={cycleOpen} onOpenChange={setCycleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New journal cycle</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input value={cycleTitle} onChange={(e) => setCycleTitle(e.target.value)} placeholder="e.g. Journal 2 — August block" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Weeks</Label>
                <Input type="number" min={1} max={12} value={cycleWeeks} onChange={(e) => setCycleWeeks(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Start date (optional)</Label>
                <Input value={cycleStart} onChange={(e) => setCycleStart(e.target.value)} placeholder="e.g. 3.08.2026" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              disabled={!cycleTitle.trim() || createCycle.isPending}
              onClick={() =>
                createCycle.mutate({
                  data: {
                    title: cycleTitle.trim(),
                    weeksCount: Math.min(12, Math.max(1, Number(cycleWeeks) || 6)),
                    startDate: cycleStart.trim() || undefined,
                  },
                })
              }
            >
              Create cycle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reflection editor dialog ── */}
      <Dialog open={reflOpen} onOpenChange={setReflOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{reflDef.title}</DialogTitle></DialogHeader>
          {canWrite && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => { setReflOpen(false); setInterviewOpen(true); }}
            >
              <Mic className="h-4 w-4 mr-2" /> Interview me — speak instead of typing
            </Button>
          )}
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Title (optional)</Label>
                <Input value={reflTitle} onChange={(e) => setReflTitle(e.target.value)} placeholder="e.g. U17 Tuesday session" />
              </div>
              <div className="space-y-1.5">
                <Label>{reflKind === "match_reflection" ? "Date of game" : "Date of training"}</Label>
                <Input value={reflDate} onChange={(e) => setReflDate(e.target.value)} placeholder="e.g. 21.07.2026" />
              </div>
            </div>
            {reflDef.fields.map((f) => (
              <div key={f.id} className="space-y-1.5">
                <Label>{f.label}</Label>
                {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                {f.short ? (
                  <Input
                    value={reflContent[f.id] ?? ""}
                    onChange={(e) => setReflContent((c) => ({ ...c, [f.id]: e.target.value }))}
                  />
                ) : (
                  <Textarea
                    rows={3}
                    value={reflContent[f.id] ?? ""}
                    onChange={(e) => setReflContent((c) => ({ ...c, [f.id]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button onClick={saveReflection} disabled={createRefl.isPending || updateRefl.isPending || !canWrite}>
              Save reflection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Voice interview ── */}
      <InterviewDialog
        open={interviewOpen}
        onOpenChange={(o) => {
          setInterviewOpen(o);
          if (!o) setReflOpen(true); // back to the editor either way
        }}
        def={reflDef}
        onComplete={(content, entryDate) => {
          setReflContent((c) => {
            const merged = { ...c };
            for (const [k, v] of Object.entries(content)) {
              if (v.trim()) merged[k] = v;
            }
            return merged;
          });
          if (entryDate) setReflDate(entryDate);
          setFromInterview(true);
        }}
      />
    </div>
  );
}
