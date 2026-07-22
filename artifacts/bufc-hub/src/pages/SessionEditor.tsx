import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetSession,
  getGetSessionQueryKey,
  getListSessionsQueryKey,
  useUpdateSession,
  useUpsertSessionPart,
  useClearSessionPart,
  useListLibraryPractices,
  getListLibraryPracticesQueryKey,
  useListPracticeVariations,
  getListPracticeVariationsQueryKey,
  useGetAuthStatus,
  getGetAuthStatusQueryKey,
} from "@workspace/api-client-react";
import type { LibraryPractice, PracticeVariation, SessionDetail, SessionPartDetail } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { PracticeDiagram, DiagramWithCrops, type DiagramData } from "@/components/PracticeDiagram";
import { ArrowLeft, Printer, Replace, Save, Search, X } from "lucide-react";

const PART_LABELS: Record<string, string> = {
  warmup: "Warmup",
  activation: "Passing activation / ball mastery",
  introduction: "Introduction",
  main: "Main part",
  endgame: "End game",
};
const PART_ORDER = ["warmup", "activation", "introduction", "main", "endgame"] as const;

type TextField =
  | "rules"
  | "tasks"
  | "progressions"
  | "coachingPoints"
  | "players"
  | "size"
  | "timing"
  | "scoring"
  | "intensity";

const EMPTY_FIELDS: Record<TextField, string> = {
  rules: "",
  tasks: "",
  progressions: "",
  coachingPoints: "",
  players: "",
  size: "",
  timing: "",
  scoring: "",
  intensity: "",
};

function slotFields(slot: SessionPartDetail | undefined): Record<TextField, string> {
  if (!slot) return { ...EMPTY_FIELDS };
  return {
    rules: slot.rules ?? "",
    tasks: slot.tasks ?? "",
    progressions: slot.progressions ?? "",
    coachingPoints: slot.coachingPoints ?? "",
    players: slot.players ?? "",
    size: slot.size ?? "",
    timing: slot.timing ?? "",
    scoring: slot.scoring ?? "",
    intensity: slot.intensity ?? "",
  };
}

/** Library chapter that naturally feeds each session part. */
const PART_CHAPTERS: Record<string, string> = {
  warmup: "Warmup",
  activation: "Activations",
  introduction: "Activations",
  main: "Main Part",
  endgame: "End Games",
};

function PracticePicker({
  open,
  onClose,
  onPick,
  part,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (p: LibraryPractice) => void;
  part: (typeof PART_ORDER)[number];
}) {
  const { data: practices } = useListLibraryPractices(undefined, {
    query: { queryKey: getListLibraryPracticesQueryKey(), enabled: open },
  });
  const [q, setQ] = useState("");

  const { suggested, rest } = useMemo(() => {
    let all = (practices ?? []).filter((p) => p.kind === "practice");
    const needle = q.trim().toLowerCase();
    if (needle) {
      all = all.filter((p) => {
        const blob = `${p.title ?? ""} ${p.sectionName ?? ""} ${p.sectionCode ?? ""} ${(p.paras ?? [])
          .map((x) => x.text)
          .join(" ")}`.toLowerCase();
        return blob.includes(needle);
      });
    }
    const chapter = PART_CHAPTERS[part];
    const isSuggested = (p: LibraryPractice) =>
      (p.variationParts ?? []).includes(part) || p.chapter === chapter;
    return {
      suggested: all.filter(isSuggested),
      rest: all.filter((p) => !isSuggested(p)),
    };
  }, [practices, q, part]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pick a practice from the library</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search practices..."
            className="pl-8"
            autoFocus
          />
        </div>
        {suggested.length > 0 && (
          <>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Suggested for {PART_LABELS[part]}
            </p>
            <PracticeGrid practices={suggested} onPick={onPick} />
            {rest.length > 0 && (
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
                Everything else
              </p>
            )}
          </>
        )}
        <PracticeGrid practices={rest} onPick={onPick} />
      </DialogContent>
    </Dialog>
  );
}

function PracticeGrid({
  practices,
  onPick,
}: {
  practices: LibraryPractice[];
  onPick: (p: LibraryPractice) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {practices.map((p) => (
        <button
          key={p.id}
          type="button"
          className="text-left border rounded-md overflow-hidden hover:ring-2 hover:ring-primary/50"
          style={{ contentVisibility: "auto", containIntrinsicSize: "160px" }}
          onClick={() => onPick(p)}
        >
          <div className="aspect-[4/3] bg-muted">
            <PracticeDiagram diagram={p.diagram as DiagramData} crop={p.reviewCrops?.[0] ?? null} className="w-full h-full" />
          </div>
          <div className="p-2">
            <p className="text-xs font-medium leading-tight line-clamp-2">
              {p.title ?? `Variation (slide ${p.ordinal})`}
            </p>
            <span className="flex flex-wrap gap-1 mt-1">
              {p.sectionCode && (
                <Badge variant="secondary" className="text-[10px]">
                  {p.sectionCode}
                </Badge>
              )}
              {p.variationCount > 0 && (
                <Badge className="text-[10px]" variant="outline">
                  {p.variationCount} past write-up{p.variationCount === 1 ? "" : "s"}
                </Badge>
              )}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

/** Offered after picking a practice that has imported wording variations:
 *  the coach can pre-fill the part with wording from a past session. */
function VariationPicker({
  practice,
  onChoose,
  onBlank,
}: {
  practice: LibraryPractice;
  onChoose: (v: PracticeVariation) => void;
  onBlank: () => void;
}) {
  const { data: variations } = useListPracticeVariations(practice.id, {
    query: { queryKey: getListPracticeVariationsQueryKey(practice.id) },
  });

  const snippet = (v: PracticeVariation) =>
    [v.rules, v.tasks, v.coachingPoints].filter(Boolean).join(" · ").slice(0, 180);

  return (
    <Dialog open onOpenChange={(o) => !o && onBlank()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Use wording from a past session?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          You've used <span className="font-medium">{practice.title ?? "this practice"}</span> before.
          Pick a past write-up to pre-fill the notes, or start blank.
        </p>
        <div className="space-y-2">
          <Button variant="outline" className="w-full justify-start" onClick={onBlank}>
            Start blank
          </Button>
          {(variations ?? []).map((v) => (
            <button
              key={v.id}
              type="button"
              className="w-full text-left border rounded-md p-3 hover:ring-2 hover:ring-primary/50"
              onClick={() => onChoose(v)}
            >
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="secondary" className="text-[10px]">
                  {v.sessionDate ?? "unknown date"}
                </Badge>
                <span className="text-xs text-muted-foreground">{PART_LABELS[v.part] ?? v.part}</span>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-line">
                {snippet(v) || "No notes"}
              </p>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PartSlot({
  session,
  part,
  isAdmin,
}: {
  session: SessionDetail;
  part: (typeof PART_ORDER)[number];
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const slot = session.parts.find((p) => p.part === part);
  const [draft, setDraft] = useState<Record<TextField, string>>(() => slotFields(slot));
  const [dirty, setDirty] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [variationPractice, setVariationPractice] = useState<LibraryPractice | null>(null);

  // Re-sync the draft from the server whenever fresh data arrives and the
  // coach has no unsaved edits — prevents stale drafts overwriting newer data.
  const serverSnapshot = JSON.stringify(slotFields(slot));
  useEffect(() => {
    if (!dirty) setDraft(JSON.parse(serverSnapshot));
  }, [serverSnapshot, dirty]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(session.id) });
    queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
  };

  const upsert = useUpsertSessionPart({
    mutation: {
      onSuccess: () => {
        invalidate();
        setDirty(false);
      },
      onError: () => toast({ title: "Couldn't save this part", variant: "destructive" }),
    },
  });
  const clear = useClearSessionPart({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: "Couldn't remove the practice", variant: "destructive" }),
    },
  });

  const set = (f: TextField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraft((d) => ({ ...d, [f]: e.target.value }));
    setDirty(true);
  };

  const draftAsPayload = () =>
    Object.fromEntries(
      (Object.keys(draft) as TextField[]).map((k) => [k, draft[k] === "" ? null : draft[k]]),
    );

  const saveText = () => {
    upsert.mutate({ id: session.id, part, data: draftAsPayload() });
  };

  const hasContent = slot && (slot.practice || Object.values(slotFields(slot)).some((v) => v !== ""));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between gap-2 flex-wrap">
          <span>
            {PART_LABELS[part]}
            {part === "activation" && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">(optional)</span>
            )}
          </span>
          {isAdmin && (
            <span className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                <Replace className="h-3.5 w-3.5 mr-1" />
                {slot?.practice ? "Swap practice" : "Pick practice"}
              </Button>
              {hasContent && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (window.confirm(`Clear the ${PART_LABELS[part]} part?`)) {
                      clear.mutate({ id: session.id, part });
                      setDraft({ ...EMPTY_FIELDS });
                      setDirty(false);
                    }
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {slot?.practice ? (
          <div className="space-y-3">
            <div className="rounded-md overflow-hidden border max-w-2xl mx-auto">
              <div className="p-1.5">
                <DiagramWithCrops
                  diagram={slot.practice.diagram as DiagramData}
                  crops={slot.practice.reviewCrops}
                  className="w-full h-auto"
                />
              </div>
              <p className="text-xs text-muted-foreground p-1.5 border-t">
                {slot.practice.title ?? "Untitled practice"}
              </p>
            </div>
            <SlotFields draft={draft} set={set} isAdmin={isAdmin} />
          </div>
        ) : (
          <SlotFields draft={draft} set={set} isAdmin={isAdmin} />
        )}
        {isAdmin && (
          <div className="flex justify-end">
            <Button size="sm" onClick={saveText} disabled={!dirty || upsert.isPending}>
              <Save className="h-3.5 w-3.5 mr-1" /> {dirty ? "Save" : "Saved"}
            </Button>
          </div>
        )}
      </CardContent>
      <PracticePicker
        open={pickerOpen}
        part={part}
        onClose={() => setPickerOpen(false)}
        onPick={(p) => {
          setPickerOpen(false);
          if (p.variationCount > 0) {
            // Let the coach pre-fill from a past write-up before saving.
            setVariationPractice(p);
            return;
          }
          // If there's unsaved text, persist it together with the practice pick
          // so nothing is silently lost.
          upsert.mutate({
            id: session.id,
            part,
            data: dirty ? { ...draftAsPayload(), practiceId: p.id } : { practiceId: p.id },
          });
        }}
      />
      {variationPractice && (
        <VariationPicker
          practice={variationPractice}
          onBlank={() => {
            const p = variationPractice;
            setVariationPractice(null);
            upsert.mutate({
              id: session.id,
              part,
              data: dirty ? { ...draftAsPayload(), practiceId: p.id } : { practiceId: p.id },
            });
          }}
          onChoose={(v) => {
            const p = variationPractice;
            setVariationPractice(null);
            const fields: Record<TextField, string> = {
              rules: v.rules ?? "",
              tasks: v.tasks ?? "",
              progressions: v.progressions ?? "",
              coachingPoints: v.coachingPoints ?? "",
              players: v.players ?? "",
              size: v.size ?? "",
              timing: v.timing ?? "",
              scoring: v.scoring ?? "",
              intensity: v.intensity ?? "",
            };
            setDraft(fields);
            // Keep dirty until the upsert succeeds — otherwise the !dirty
            // rehydrate effect overwrites the chosen wording with the stale
            // server snapshot, and a failed save would lose it entirely.
            setDirty(true);
            upsert.mutate({
              id: session.id,
              part,
              data: {
                practiceId: p.id,
                ...Object.fromEntries(
                  (Object.keys(fields) as TextField[]).map((k) => [k, fields[k] === "" ? null : fields[k]]),
                ),
              },
            });
          }}
        />
      )}
    </Card>
  );
}

function SlotFields({
  draft,
  set,
  isAdmin,
}: {
  draft: Record<TextField, string>;
  set: (f: TextField) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  isAdmin: boolean;
}) {
  const ro = !isAdmin;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Rules / explanation</label>
          <Textarea value={draft.rules} onChange={set("rules")} rows={4} readOnly={ro} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Coaching messages / tasks</label>
          <Textarea value={draft.tasks} onChange={set("tasks")} rows={4} readOnly={ro} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Progressions</label>
          <Textarea value={draft.progressions} onChange={set("progressions")} rows={2} readOnly={ro} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Coaching points</label>
          <Textarea value={draft.coachingPoints} onChange={set("coachingPoints")} rows={2} readOnly={ro} />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Players</label>
          <Input value={draft.players} onChange={set("players")} readOnly={ro} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Size</label>
          <Input value={draft.size} onChange={set("size")} readOnly={ro} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Timing</label>
          <Input value={draft.timing} onChange={set("timing")} readOnly={ro} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Scoring</label>
          <Input value={draft.scoring} onChange={set("scoring")} readOnly={ro} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Intensity</label>
          <Input value={draft.intensity} onChange={set("intensity")} readOnly={ro} />
        </div>
      </div>
    </div>
  );
}

const HEADER_FIELDS = [
  ["sessionDate", "Date", "9.07.2026"],
  ["title", "Session Title", "Pressing the centre backs with the 10."],
  ["team", "Team", "NPLW1"],
  ["sessionNumber", "Session", "S30"],
  ["theme", "Theme", "D- Pressing in open play"],
  ["cycleCode", "Cycle", "4-11-S3"],
  ["location", "Location", "McKellar"],
  ["timeSlot", "Time", "5.30-7.00pm"],
] as const;

type HeaderField = (typeof HEADER_FIELDS)[number][0];

/** Teams that can be picked today; more clubs/teams come later. */
const TEAM_OPTIONS = ["NPLW1"];

/** Coach's date format ("16.07.2026") ↔ the native date input ("2026-07-16"). */
function coachDateToIso(v: string): string {
  const m = v.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}
function isoToCoachDate(v: string): string {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return v;
  return `${Number(m[3])}.${m[2]}.${m[1]}`;
}

function HeaderEditor({ session, isAdmin }: { session: SessionDetail; isAdmin: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Record<HeaderField | "comments" | "squadText", string>>(() => ({
    sessionDate: session.sessionDate ?? "",
    title: session.title ?? "",
    team: session.team ?? "",
    sessionNumber: session.sessionNumber ?? "",
    theme: session.theme ?? "",
    cycleCode: session.cycleCode ?? "",
    location: session.location ?? "",
    timeSlot: session.timeSlot ?? "",
    comments: session.comments ?? "",
    squadText: session.squadText ?? "",
  }));
  const [dirty, setDirty] = useState(false);

  // Re-sync from the server when fresh data arrives and there are no unsaved edits.
  const serverSnapshot = JSON.stringify({
    sessionDate: session.sessionDate ?? "",
    title: session.title ?? "",
    team: session.team ?? "",
    sessionNumber: session.sessionNumber ?? "",
    theme: session.theme ?? "",
    cycleCode: session.cycleCode ?? "",
    location: session.location ?? "",
    timeSlot: session.timeSlot ?? "",
    comments: session.comments ?? "",
    squadText: session.squadText ?? "",
  });
  useEffect(() => {
    if (!dirty) setDraft(JSON.parse(serverSnapshot));
  }, [serverSnapshot, dirty]);

  const update = useUpdateSession({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey(session.id) });
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        setDirty(false);
      },
      onError: () => toast({ title: "Couldn't save the session details", variant: "destructive" }),
    },
  });

  const set = (f: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraft((d) => ({ ...d, [f]: e.target.value }));
    setDirty(true);
  };

  const save = () => {
    const { title, comments, squadText, ...rest } = draft;
    update.mutate({
      id: session.id,
      data: {
        title,
        comments: comments === "" ? null : comments,
        squadText: squadText === "" ? null : squadText,
        ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, v === "" ? null : v])),
      },
    });
  };

  const ro = !isAdmin;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Session details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {HEADER_FIELDS.map(([field, label, placeholder]) => (
            <div key={field} className={field === "title" || field === "theme" ? "col-span-2" : ""}>
              <label className="text-xs font-medium text-muted-foreground">{label}</label>
              {field === "sessionDate" ? (
                <Input
                  type="date"
                  value={coachDateToIso(draft.sessionDate)}
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, sessionDate: isoToCoachDate(e.target.value) }));
                    setDirty(true);
                  }}
                  readOnly={ro}
                />
              ) : field === "team" ? (
                <Select
                  value={draft.team || undefined}
                  onValueChange={(v) => {
                    setDraft((d) => ({ ...d, team: v }));
                    setDirty(true);
                  }}
                  disabled={ro}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a team" />
                  </SelectTrigger>
                  <SelectContent>
                    {[...new Set([...TEAM_OPTIONS, ...(draft.team ? [draft.team] : [])])].map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={draft[field]} onChange={set(field)} placeholder={placeholder} readOnly={ro} />
              )}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Comments (one per line)</label>
            <Textarea value={draft.comments} onChange={set("comments")} rows={4} readOnly={ro} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Squad list — one player per line: number | position | name | note
            </label>
            <Textarea
              value={draft.squadText}
              onChange={set("squadText")}
              rows={4}
              placeholder={"1 | GK | Matilde |\n2 | CB | Ailish |\n3 | CB | Rhi | Ankle"}
              readOnly={ro}
            />
          </div>
        </div>
        {isAdmin && (
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={!dirty || update.isPending}>
              <Save className="h-3.5 w-3.5 mr-1" /> {dirty ? "Save" : "Saved"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SessionEditor() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const { data: session, isLoading } = useGetSession(id, {
    query: { queryKey: getGetSessionQueryKey(id), enabled: Number.isInteger(id) },
  });
  const { data: auth } = useGetAuthStatus({ query: { queryKey: getGetAuthStatusQueryKey() } });
  const isAdmin = !!(auth?.authenticated && auth.role === "admin");

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading session…</div>;
  if (!session) return <div className="p-6 text-muted-foreground">Session not found.</div>;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="ghost" onClick={() => navigate("/sessions")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{session.title || "Untitled session"}</h1>
            <p className="text-sm text-muted-foreground">
              {[session.sessionDate, session.team, session.sessionNumber].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => navigate(`/sessions/${session.id}/print`)}>
          <Printer className="h-4 w-4 mr-1" /> Print / PDF
        </Button>
      </div>

      <HeaderEditor key={`h-${session.id}`} session={session} isAdmin={isAdmin} />

      {PART_ORDER.map((part) => (
        <PartSlot key={`${session.id}-${part}`} session={session} part={part} isAdmin={isAdmin} />
      ))}
    </div>
  );
}
