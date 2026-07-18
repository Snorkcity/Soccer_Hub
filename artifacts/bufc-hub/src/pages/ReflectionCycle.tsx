import { useMemo, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetJournalCycle,
  getGetJournalCycleQueryKey,
  useUpsertJournalEntry,
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { ArrowLeft, CheckCircle2, Circle, CircleDot, Download } from "lucide-react";
import {
  CYCLE_KIND_ORDER, KIND_DEFS, filledCount, type JournalCycleKind,
} from "@/lib/journalFields";

export default function ReflectionCycle() {
  const [, params] = useRoute("/reflections/:id");
  const cycleId = Number(params?.id);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: auth } = useGetAuthStatus({ query: { queryKey: getGetAuthStatusQueryKey() } });
  const canWrite = auth?.authenticated && auth.role === "admin";

  const { data: cycle, isLoading } = useGetJournalCycle(cycleId, {
    query: { queryKey: getGetJournalCycleQueryKey(cycleId), enabled: Number.isInteger(cycleId) && cycleId > 0 },
  });

  const entryMap = useMemo(() => {
    const m = new Map<string, Record<string, string>>();
    for (const e of cycle?.entries ?? []) {
      if (e.weekNo != null) m.set(`${e.weekNo}:${e.kind}`, e.content);
    }
    return m;
  }, [cycle]);

  // ── Editor state ──
  const [editorOpen, setEditorOpen] = useState(false);
  const [editWeek, setEditWeek] = useState(1);
  const [editKind, setEditKind] = useState<JournalCycleKind>("weekly_planner");
  const [editContent, setEditContent] = useState<Record<string, string>>({});

  function openEditor(week: number, kind: JournalCycleKind) {
    setEditWeek(week);
    setEditKind(kind);
    setEditContent({ ...(entryMap.get(`${week}:${kind}`) ?? {}) });
    setEditorOpen(true);
  }

  const upsert = useUpsertJournalEntry({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetJournalCycleQueryKey(cycleId) });
        setEditorOpen(false);
      },
      onError: () => toast({ title: "Couldn't save", variant: "destructive" }),
    },
  });

  async function exportPptx() {
    if (!cycle) return;
    try {
      const { buildJournalPptx } = await import("@/lib/journalPptx");
      const pptx = buildJournalPptx({
        title: cycle.title,
        author: "Scott Conlon",
        weeksCount: cycle.weeksCount,
        startDate: cycle.startDate ?? null,
        generatedOn: new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }),
        entries: (cycle.entries ?? []).map((e) => ({ weekNo: e.weekNo ?? null, kind: e.kind, content: e.content })),
      });
      await pptx.writeFile({ fileName: `${cycle.title.replace(/[^\w\- ]+/g, "")}.pptx` });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  }

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!cycle) return <div className="p-6 text-sm text-muted-foreground">Cycle not found.</div>;

  const def = KIND_DEFS[editKind];
  const totalBlocks = cycle.weeksCount * CYCLE_KIND_ORDER.length;
  const doneBlocks = CYCLE_KIND_ORDER.reduce((acc, kind) => {
    for (let w = 1; w <= cycle.weeksCount; w++) {
      if (filledCount(kind, entryMap.get(`${w}:${kind}`)) === KIND_DEFS[kind].fields.length) acc++;
    }
    return acc;
  }, 0);

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => navigate("/reflections")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> All reflections
          </Button>
          <h1 className="text-2xl font-bold">{cycle.title}</h1>
          <div className="flex gap-2 flex-wrap text-xs">
            <Badge variant="secondary">{cycle.weeksCount} weeks</Badge>
            {cycle.startDate && <Badge variant="outline">From {cycle.startDate}</Badge>}
            <Badge variant="outline">{doneBlocks}/{totalBlocks} blocks complete</Badge>
          </div>
        </div>
        <Button onClick={exportPptx}>
          <Download className="h-4 w-4 mr-1" /> Export journal (pptx)
        </Button>
      </div>

      <div className="space-y-4">
        {Array.from({ length: cycle.weeksCount }, (_, i) => i + 1).map((week) => (
          <Card key={week}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="font-semibold">Week {week}</div>
                {(entryMap.get(`${week}:weekly_planner`)?.phaseCode ?? "").trim() && (
                  <Badge variant="secondary" className="font-mono text-xs">
                    {entryMap.get(`${week}:weekly_planner`)!.phaseCode.trim()}
                  </Badge>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {CYCLE_KIND_ORDER.map((kind) => {
                  const kd = KIND_DEFS[kind];
                  const filled = filledCount(kind, entryMap.get(`${week}:${kind}`));
                  const total = kd.fields.length;
                  const state = filled === 0 ? "empty" : filled === total ? "done" : "partial";
                  return (
                    <button
                      key={kind}
                      onClick={() => openEditor(week, kind)}
                      className="flex items-center gap-2 rounded-md border p-2.5 text-left text-sm hover:border-primary/60 transition-colors"
                    >
                      {state === "done" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                      ) : state === "partial" ? (
                        <CircleDot className="h-4 w-4 shrink-0 text-amber-500" />
                      ) : (
                        <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{kd.title}</span>
                        <span className="block text-xs text-muted-foreground">{filled}/{total} answered</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Block editor ── */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Week {editWeek} — {def.title}</DialogTitle>
            <DialogDescription>{def.blurb}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {def.fields.map((f) => (
              <div key={f.id} className="space-y-1.5">
                <Label>{f.label}</Label>
                {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                {f.short ? (
                  <Input
                    value={editContent[f.id] ?? ""}
                    onChange={(e) => setEditContent((c) => ({ ...c, [f.id]: e.target.value }))}
                  />
                ) : (
                  <Textarea
                    rows={3}
                    value={editContent[f.id] ?? ""}
                    onChange={(e) => setEditContent((c) => ({ ...c, [f.id]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              disabled={upsert.isPending || !canWrite}
              onClick={() => upsert.mutate({ id: cycleId, week: editWeek, kind: editKind, data: { content: editContent } })}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
