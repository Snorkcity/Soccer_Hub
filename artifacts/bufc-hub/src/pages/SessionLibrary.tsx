import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLibraryPractices,
  getListLibraryPracticesQueryKey,
  useFlagLibraryPractice,
  useGetAuthStatus,
  getGetAuthStatusQueryKey,
  useListPracticeVariations,
  getListPracticeVariationsQueryKey,
} from "@workspace/api-client-react";
import type { LibraryPractice, PracticeVariation } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { PracticeDiagram, type DiagramData } from "@/components/PracticeDiagram";
import { Flag, Search } from "lucide-react";

const CHAPTER_ORDER = [
  "Warmup",
  "Activations",
  "Main Part",
  "End Games",
  "Miscellaneous",
  "Layout Templates",
];

function practiceTitle(p: LibraryPractice): string {
  return p.title ?? `Variation (slide ${p.ordinal})`;
}

const PART_LABELS: Record<string, string> = {
  warmup: "Warmup",
  activation: "Passing activation / ball mastery",
  introduction: "Introduction",
  main: "Main part",
  endgame: "End game",
};

const VARIATION_FIELDS: Array<[keyof PracticeVariation, string]> = [
  ["rules", "Rules"],
  ["tasks", "Coaching messages"],
  ["progressions", "Progressions"],
  ["coachingPoints", "Coaching points"],
  ["players", "Players"],
  ["size", "Size"],
  ["timing", "Timing"],
  ["scoring", "Scoring"],
  ["intensity", "Intensity"],
];

/** Past write-ups (imported from old session plans) shown inside the
 *  practice detail dialog on the Library page. */
function PastWriteUps({ practice }: { practice: LibraryPractice }) {
  const { data: variations } = useListPracticeVariations(practice.id, {
    query: {
      queryKey: getListPracticeVariationsQueryKey(practice.id),
      enabled: practice.variationCount > 0,
    },
  });
  const [openId, setOpenId] = useState<number | null>(null);
  if (practice.variationCount === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {practice.variationCount} past write-up{practice.variationCount === 1 ? "" : "s"} from old
        session plans
      </p>
      <div className="space-y-1">
        {(variations ?? []).map((v) => {
          const open = openId === v.id;
          return (
            <div key={v.id} className="border rounded-md">
              <button
                type="button"
                className="w-full flex items-center justify-between gap-2 p-2 text-left hover:bg-muted/50"
                onClick={() => setOpenId(open ? null : v.id)}
              >
                <span className="text-sm font-medium">
                  {v.sessionDate ?? "Undated"}
                  <span className="text-xs text-muted-foreground font-normal ml-2">
                    {PART_LABELS[v.part] ?? v.part}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
              </button>
              {open && (
                <div className="p-3 pt-1 space-y-2">
                  {VARIATION_FIELDS.map(([key, label]) => {
                    const val = v[key];
                    if (!val || typeof val !== "string") return null;
                    return (
                      <div key={key}>
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                          {label}
                        </p>
                        <p className="text-sm whitespace-pre-wrap">{val}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function searchBlob(p: LibraryPractice): string {
  const paras = (p.paras ?? []).map((x) => x.text).join(" ");
  return `${p.title ?? ""} ${p.sectionName ?? ""} ${p.sectionCode ?? ""} ${paras}`.toLowerCase();
}

export default function SessionLibrary() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: practices, isLoading } = useListLibraryPractices(
    undefined,
    { query: { queryKey: getListLibraryPracticesQueryKey() } },
  );
  const { data: auth } = useGetAuthStatus({ query: { queryKey: getGetAuthStatusQueryKey() } });
  const isAdmin = auth?.authenticated && auth.role === "admin";

  const [chapter, setChapter] = useState<string>("Activations");
  const [section, setSection] = useState<string>("all");
  const [q, setQ] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [selected, setSelected] = useState<LibraryPractice | null>(null);

  const flagMutation = useFlagLibraryPractice({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getListLibraryPracticesQueryKey() });
        setSelected((prev) => (prev && prev.id === res.id ? { ...prev, needsReview: res.needsReview } : prev));
      },
      onError: () => toast({ title: "Couldn't update the flag", variant: "destructive" }),
    },
  });

  const all = useMemo(
    () => (practices ?? []).filter((p) => p.kind === "practice"),
    [practices],
  );

  const chapters = useMemo(() => {
    const present = new Set(all.map((p) => p.chapter ?? "Other"));
    const ordered = CHAPTER_ORDER.filter((c) => present.has(c));
    for (const c of present) if (!ordered.includes(c)) ordered.push(c);
    return ordered;
  }, [all]);

  const sections = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of all) {
      if ((p.chapter ?? "Other") === chapter && p.sectionCode) {
        seen.set(p.sectionCode, p.sectionName ?? p.sectionCode);
      }
    }
    return [...seen.entries()];
  }, [all, chapter]);

  const blobs = useMemo(() => new Map(all.map((p) => [p.id, searchBlob(p)])), [all]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((p) => {
      if (needle) {
        // searching looks across ALL chapters — that's what you want from a search box
        if (!(blobs.get(p.id) ?? "").includes(needle)) return false;
      } else {
        if ((p.chapter ?? "Other") !== chapter) return false;
        if (section !== "all" && p.sectionCode !== section) return false;
      }
      if (flaggedOnly && !p.needsReview) return false;
      return true;
    });
  }, [all, blobs, q, chapter, section, flaggedOnly]);

  const flaggedCount = useMemo(() => all.filter((p) => p.needsReview).length, [all]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Session Library</h1>
        <p className="text-sm text-muted-foreground">
          {all.length} practices extracted from your master deck
          {flaggedCount > 0 && ` — ${flaggedCount} flagged for review`}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search all practices..."
            className="pl-8 w-56"
          />
        </div>
        {!q && (
          <>
            <div className="flex flex-wrap gap-1">
              {chapters.map((c) => (
                <Button
                  key={c}
                  size="sm"
                  variant={c === chapter ? "default" : "outline"}
                  onClick={() => {
                    setChapter(c);
                    setSection("all");
                  }}
                >
                  {c}
                </Button>
              ))}
            </div>
            {sections.length > 0 && (
              <Select value={section} onValueChange={setSection}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sections</SelectItem>
                  {sections.map(([code, name]) => (
                    <SelectItem key={code} value={code}>
                      {code} — {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        )}
        <Button
          size="sm"
          variant={flaggedOnly ? "default" : "outline"}
          onClick={() => setFlaggedOnly((v) => !v)}
        >
          <Flag className="h-3.5 w-3.5 mr-1" /> Flagged
        </Button>
        <span className="text-sm text-muted-foreground ml-auto">{visible.length} shown</span>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading the library…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {visible.map((p) => (
            <Card
              key={p.id}
              className="cursor-pointer hover:ring-2 hover:ring-primary/50 transition-shadow overflow-hidden"
              style={{ contentVisibility: "auto", containIntrinsicSize: "240px" }}
              onClick={() => setSelected(p)}
            >
              <div className="aspect-[4/3] bg-muted">
                <PracticeDiagram diagram={p.diagram as DiagramData} className="w-full h-full" />
              </div>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-tight line-clamp-2">{practiceTitle(p)}</p>
                  {p.needsReview && <Flag className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                </div>
                <div className="flex flex-wrap gap-1">
                  {p.sectionCode && (
                    <Badge variant="secondary" className="text-[10px]">
                      {p.sectionCode}
                    </Badge>
                  )}
                  {p.sectionName && (
                    <Badge variant="outline" className="text-[10px]">
                      {p.sectionName}
                    </Badge>
                  )}
                  {p.variationCount > 0 && (
                    <Badge variant="outline" className="text-[10px]">
                      {p.variationCount} past write-up{p.variationCount === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap pr-8">
                  {practiceTitle(selected)}
                  {selected.sectionCode && <Badge variant="secondary">{selected.sectionCode}</Badge>}
                  {selected.sectionName && <Badge variant="outline">{selected.sectionName}</Badge>}
                </DialogTitle>
              </DialogHeader>
              <div className="rounded-md overflow-hidden border">
                <PracticeDiagram diagram={selected.diagram as DiagramData} className="w-full h-auto" />
              </div>
              <PastWriteUps practice={selected} />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  Slide {selected.ordinal} · {selected.chapter}
                </p>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant={selected.needsReview ? "destructive" : "outline"}
                    disabled={flagMutation.isPending}
                    onClick={() =>
                      flagMutation.mutate({
                        id: selected.id,
                        data: { needsReview: !selected.needsReview },
                      })
                    }
                  >
                    <Flag className="h-3.5 w-3.5 mr-1" />
                    {selected.needsReview ? "Flagged — tap to clear" : "Flag for review"}
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
