import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLibraryPractices,
  getListLibraryPracticesQueryKey,
  useReviewLibraryPractice,
  useGetAuthStatus,
  getGetAuthStatusQueryKey,
} from "@workspace/api-client-react";
import type { LibraryPractice } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { PracticeDiagram, type DiagramData, type DiagramCrop } from "@/components/PracticeDiagram";
import { ArrowLeft, ArrowRight, Check, Crop, RotateCcw } from "lucide-react";
import { useLocation } from "wouter";

/** Chapters that go through the review pass (matches the AI generator). */
const REVIEW_CHAPTERS = ["Warmup", "Activations", "Main Part", "End Games"];

const PARTS = [
  { value: "warmup", label: "Warmup" },
  { value: "introduction", label: "Introduction" },
  { value: "main", label: "Main part" },
  { value: "endgame", label: "End game" },
  { value: "unusable", label: "Not usable" },
] as const;

const A_TAGS = [
  ["A1", "General Rondos"],
  ["A2", "Directional Rondos"],
  ["A3", "Build the Thirds"],
  ["A4", "Cover / Balance"],
  ["A5", "Pressing / Counter-Press"],
  ["A6", "Endzone-games"],
  ["A7", "Finishing Activations"],
  ["A8", "Hybrid / Other"],
] as const;

const MP_TAGS = [
  ["MP1", "Playing Out (back third)"],
  ["MP2", "Middle Third Attacking"],
  ["MP3", "Combination Play (final third)"],
  ["MP4", "Low Block (back third)"],
  ["MP5", "Mid-Block"],
  ["MP6", "High Pressing"],
  ["MP7", "Counter-Pressing"],
  ["MP8", "Transition to BP"],
  ["MP9", "Transition to BPO"],
  ["MP10", "General Possession"],
  ["MP11", "Opposition-Specific Tactical"],
] as const;

const EG_TAGS = [
  ["small", "Small games"],
  ["medium", "Medium games"],
  ["big", "Big games"],
] as const;

function tagsForPart(part: string): ReadonlyArray<readonly [string, string]> {
  if (part === "introduction") return A_TAGS;
  if (part === "main") return MP_TAGS;
  if (part === "endgame") return EG_TAGS;
  return [];
}

function defaultPart(p: LibraryPractice): string {
  switch (p.chapter) {
    case "Warmup":
      return "warmup";
    case "Activations":
      return "introduction";
    case "Main Part":
      return "main";
    case "End Games":
      return "endgame";
    default:
      return "main";
  }
}

/** Best-guess starting tags from the practice's section name. */
function defaultTags(p: LibraryPractice, part: string): string[] {
  const s = (p.sectionName ?? "").toLowerCase();
  if (!s) return [];
  const pool = tagsForPart(part);
  const hit = pool.find(([, label]) => {
    const l = label.toLowerCase();
    return s.includes(l) || l.includes(s) || l.split(" ")[0] === s.split(" ")[0];
  });
  return hit ? [hit[0]] : [];
}

function practiceTitle(p: LibraryPractice): string {
  return p.title ?? `Variation (slide ${p.ordinal})`;
}

/** Drag-a-box crop editor over the full slide. Coordinates are stored in
 *  diagram canvas units (usually 960x720) so the crop works at any size. */
function CropEditor({
  diagram,
  crop,
  onChange,
}: {
  diagram: DiagramData;
  crop: DiagramCrop | null;
  onChange: (c: DiagramCrop | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const W = diagram.canvas?.w ?? 960;
  const H = diagram.canvas?.h ?? 720;

  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const r = ref.current?.getBoundingClientRect();
      if (!r) return { x: 0, y: 0 };
      return {
        x: Math.min(Math.max(((clientX - r.left) / r.width) * W, 0), W),
        y: Math.min(Math.max(((clientY - r.top) / r.height) * H, 0), H),
      };
    },
    [W, H],
  );

  const rect = drag
    ? {
        x: Math.min(drag.x0, drag.x1),
        y: Math.min(drag.y0, drag.y1),
        w: Math.abs(drag.x1 - drag.x0),
        h: Math.abs(drag.y1 - drag.y0),
      }
    : crop;

  return (
    <div
      ref={ref}
      className="relative w-full touch-none select-none cursor-crosshair rounded-md overflow-hidden border bg-white"
      style={{ aspectRatio: `${W} / ${H}` }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = toCanvas(e.clientX, e.clientY);
        setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = toCanvas(e.clientX, e.clientY);
        setDrag({ ...drag, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (!drag) return;
        const w = Math.abs(drag.x1 - drag.x0);
        const h = Math.abs(drag.y1 - drag.y0);
        if (w >= 40 && h >= 40) {
          onChange({
            x: Math.round(Math.min(drag.x0, drag.x1)),
            y: Math.round(Math.min(drag.y0, drag.y1)),
            w: Math.round(w),
            h: Math.round(h),
          });
        }
        setDrag(null);
      }}
    >
      <PracticeDiagram diagram={diagram} className="w-full h-full pointer-events-none" />
      {rect && rect.w >= 20 && rect.h >= 20 && (
        <div
          className="absolute border-2 border-red-500 pointer-events-none"
          style={{
            left: `${(rect.x / W) * 100}%`,
            top: `${(rect.y / H) * 100}%`,
            width: `${(rect.w / W) * 100}%`,
            height: `${(rect.h / H) * 100}%`,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.45)",
          }}
        />
      )}
    </div>
  );
}

export default function DiagramReview() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const { data: auth } = useGetAuthStatus({ query: { queryKey: getGetAuthStatusQueryKey() } });
  const isAdmin = auth?.role === "admin";

  const { data: practices, isLoading } = useListLibraryPractices(
    {},
    { query: { queryKey: getListLibraryPracticesQueryKey({}) } },
  );

  const queue = useMemo(
    () =>
      (practices ?? [])
        .filter((p) => REVIEW_CHAPTERS.includes(p.chapter ?? ""))
        .sort((a, b) => a.ordinal - b.ordinal),
    [practices],
  );
  const reviewedCount = useMemo(() => queue.filter((p) => p.reviewPart != null).length, [queue]);

  const [idx, setIdx] = useState<number | null>(null);
  // Start at the first unreviewed practice once the list arrives.
  useEffect(() => {
    if (idx === null && queue.length > 0) {
      const first = queue.findIndex((p) => p.reviewPart == null);
      setIdx(first === -1 ? 0 : first);
    }
  }, [idx, queue]);

  const current = idx !== null ? queue[idx] : undefined;

  const [part, setPart] = useState<string>("main");
  const [tags, setTags] = useState<string[]>([]);
  const [crop, setCrop] = useState<DiagramCrop | null>(null);

  // Reset the form whenever we land on a new practice.
  useEffect(() => {
    if (!current) return;
    const p = current.reviewPart ?? defaultPart(current);
    setPart(p);
    setTags(current.reviewPart != null ? (current.reviewTags ?? []) : defaultTags(current, p));
    setCrop((current.reviewCrop as DiagramCrop | null) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const reviewMutation = useReviewLibraryPractice({
    mutation: {
      onSuccess: (_res, vars) => {
        // Patch the cached list so progress + queue update without a refetch.
        queryClient.setQueryData(
          getListLibraryPracticesQueryKey({}),
          (old: LibraryPractice[] | undefined) =>
            old?.map((p) =>
              p.id === vars.id
                ? { ...p, reviewPart: vars.data.part, reviewTags: vars.data.tags, reviewCrop: vars.data.crop ?? null }
                : p,
            ),
        );
        goNext();
      },
      onError: () => toast({ title: "Couldn't save — try again", variant: "destructive" }),
    },
  });

  const goNext = () => {
    setIdx((i) => {
      if (i === null) return i;
      // jump to the next unreviewed after this one, else just the next slide
      for (let j = i + 1; j < queue.length; j++) if (queue[j].reviewPart == null && j !== i) return j;
      return Math.min(i + 1, queue.length - 1);
    });
  };

  const save = () => {
    if (!current) return;
    reviewMutation.mutate({ id: current.id, data: { part: part as never, tags, crop } });
  };

  if (!isAdmin) {
    return <div className="p-6 text-muted-foreground">Diagram review is only available when you're logged in as admin.</div>;
  }

  const tagPool = tagsForPart(part);
  const pct = queue.length ? Math.round((reviewedCount / queue.length) * 100) : 0;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Diagram Review</h1>
          <p className="text-sm text-muted-foreground">
            Snip the bit of each slide you'd actually use, then tag it — {reviewedCount} of {queue.length} done
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/library")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Library
        </Button>
      </div>

      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>

      {isLoading || !current ? (
        <p className="text-muted-foreground">Loading the library…</p>
      ) : (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium leading-tight">{practiceTitle(current)}</p>
                <p className="text-xs text-muted-foreground">
                  {current.chapter}
                  {current.sectionName ? ` · ${current.sectionName}` : ""} · slide {current.ordinal}
                  {current.reviewPart != null && (
                    <span className="text-emerald-600 font-medium"> · already reviewed</span>
                  )}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="ghost" disabled={idx === 0} onClick={() => setIdx((i) => Math.max((i ?? 0) - 1, 0))}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" disabled={idx === queue.length - 1} onClick={() => setIdx((i) => Math.min((i ?? 0) + 1, queue.length - 1))}>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <CropEditor diagram={current.diagram as DiagramData} crop={crop} onChange={setCrop} />
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Crop className="h-3.5 w-3.5" /> Drag a box around the part you'd snip
              </p>
              {crop && (
                <Button size="sm" variant="outline" onClick={() => setCrop(null)}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Whole slide
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Session part</p>
              <div className="flex flex-wrap gap-1.5">
                {PARTS.map((p) => (
                  <Button
                    key={p.value}
                    size="sm"
                    variant={part === p.value ? "default" : "outline"}
                    className={p.value === "unusable" && part === p.value ? "bg-destructive hover:bg-destructive" : ""}
                    onClick={() => {
                      setPart(p.value);
                      setTags(defaultTags(current, p.value));
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            {tagPool.length > 0 && part !== "unusable" && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {part === "endgame" ? "Game size" : "Sub-category (pick all that fit)"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {tagPool.map(([code, label]) => {
                    const on = tags.includes(code);
                    return (
                      <Button
                        key={code}
                        size="sm"
                        variant={on ? "default" : "outline"}
                        onClick={() =>
                          setTags((t) =>
                            part === "endgame"
                              ? [code] // one size per end game
                              : on
                                ? t.filter((x) => x !== code)
                                : [...t, code],
                          )
                        }
                      >
                        {code !== label ? `${code} · ${label}` : label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={save} disabled={reviewMutation.isPending}>
                <Check className="h-4 w-4 mr-1" />
                {reviewMutation.isPending ? "Saving…" : "Save & next"}
              </Button>
              <Button variant="outline" onClick={goNext} disabled={reviewMutation.isPending}>
                Skip
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
