import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
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
import { BookHeart, CalendarRange, Mic, NotebookPen, Plus, Trash2 } from "lucide-react";
import InterviewDialog from "@/components/InterviewDialog";
import { KIND_DEFS, filledCount, type JournalStandaloneKind } from "@/lib/journalFields";
import { parseEntryDate } from "@/components/WeekAheadCard";

const STANDALONE_KINDS: JournalStandaloneKind[] = ["session_reflection", "match_reflection"];

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
