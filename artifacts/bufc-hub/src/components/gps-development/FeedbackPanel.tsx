import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateGpsDevelopmentFeedback, useDeleteGpsDevelopmentFeedback, useSendGpsReportEmail } from "@workspace/api-client-react";
import type { GpsDevelopmentFeedback, GpsDevelopmentProfile } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { generatePlayerDevelopmentReport } from "@/lib/playerDevelopmentReport";
import { fmtDate } from "./EvidencePanels";

const invalidate = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ predicate: q => q.queryKey[0] === "/api/gps-development" });

interface EmailTarget { profile: GpsDevelopmentProfile; feedback: GpsDevelopmentFeedback | null }

export function FeedbackPanel({ profile, feedback, leagueId, canEdit, canEmail }: {
  profile: GpsDevelopmentProfile; feedback: GpsDevelopmentFeedback[]; leagueId: number; canEdit: boolean; canEmail: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateGpsDevelopmentFeedback();
  const del = useDeleteGpsDevelopmentFeedback();
  const send = useSendGpsReportEmail();

  const [note, setNote] = useState("");
  const [focus, setFocus] = useState("");
  const [review, setReview] = useState("");
  const [includeFb, setIncludeFb] = useState(true);
  const [toDelete, setToDelete] = useState<GpsDevelopmentFeedback | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState<EmailTarget | null>(null);
  const [to, setTo] = useState(""); const [from, setFrom] = useState("");
  const [subject, setSubject] = useState(""); const [body, setBody] = useState("");

  const sorted = [...feedback].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = sorted[0] ?? null;
  const toReport = (f: GpsDevelopmentFeedback | null) => f && { note: f.note, focus: f.focus, reviewDate: f.reviewDate, createdAt: f.createdAt, year: f.year };

  const submit = () => {
    if (!note.trim() && !focus.trim()) return;
    create.mutate(
      { data: { leagueId, playerName: profile.playerName, year: profile.year, note: note.trim(), focus: focus.trim(), reviewDate: review || null } },
      {
        onSuccess: () => { setNote(""); setFocus(""); setReview(""); invalidate(qc); toast({ title: "Feedback saved with evidence snapshot" }); },
        onError: () => toast({ title: "Could not save feedback", description: "Your text is still here. Try again.", variant: "destructive" }),
      },
    );
  };

  const download = async (key: string, p: GpsDevelopmentProfile, f: GpsDevelopmentFeedback | null) => {
    setBusy(key);
    try { await generatePlayerDevelopmentReport(p, toReport(f), "download"); }
    catch { toast({ title: "Could not build report", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  const openEmail = (t: EmailTarget) => {
    setEmail(t);
    setSubject(`${t.profile.playerName} - player development${t.feedback ? ` (${t.feedback.year})` : ` ${t.profile.year}`}`);
    setBody(`Attached is the development report for ${t.profile.playerName}.`);
  };
  const doSend = async () => {
    if (!email || busy === "email" || send.isPending) return;
    setBusy("email");
    try {
      const r = await generatePlayerDevelopmentReport(email.profile, toReport(email.feedback), "base64");
      send.mutate(
        { data: { leagueId, to: to.trim(), from: from.trim(), subject: subject.trim(), body, fileName: r.fileName, pptxBase64: r.base64 ?? "" } },
        {
          onSuccess: () => { toast({ title: "Report sent", description: `Sent to ${to.trim()}` }); setEmail(null); },
          onError: () => toast({ title: "Email failed", description: "Check the addresses and try again.", variant: "destructive" }),
        },
      );
    } catch { toast({ title: "Could not build report", variant: "destructive" }); }
    finally { setBusy(null); }
  };

  return (
    <Card data-testid="card-feedback">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">One-to-one feedback</CardTitle>
        <p className="text-xs text-muted-foreground">A short note and one focus. Each entry keeps a snapshot of the evidence as it stood when saved.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {canEdit ? (
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="dev-focus">Development focus</Label>
              <Input id="dev-focus" value={focus} maxLength={2000} onChange={e => setFocus(e.target.value)} placeholder="One thing to work on" data-testid="input-focus" /></div>
            <div className="space-y-1.5"><Label htmlFor="dev-note">Note</Label>
              <Textarea id="dev-note" value={note} maxLength={6000} rows={4} onChange={e => setNote(e.target.value)} placeholder="What was discussed" data-testid="input-note" /></div>
            <div className="space-y-1.5 max-w-[200px]"><Label htmlFor="dev-review">Review date</Label>
              <Input id="dev-review" type="date" value={review} onChange={e => setReview(e.target.value)} data-testid="input-review-date" /></div>
            <Button onClick={submit} disabled={create.isPending || (!note.trim() && !focus.trim())} data-testid="button-save-feedback">
              {create.isPending ? "Saving" : "Save feedback"}
            </Button>
          </div>
        ) : <p className="text-sm text-muted-foreground" data-testid="text-feedback-readonly">Feedback is read-only for your access in this league.</p>}

        <div className="rounded-md bg-muted/50 p-3 space-y-2">
          <div className="text-sm font-medium">Current report ({profile.year})</div>
          {latest && (
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={includeFb} onCheckedChange={v => setIncludeFb(v === true)} data-testid="check-include-feedback" />
              Include latest feedback ({latest.year}, saved {fmtDate(latest.createdAt)})
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy === "cur"} onClick={() => download("cur", profile, includeFb ? latest : null)} data-testid="button-download-current">
              {busy === "cur" ? "Building" : "Download report"}
            </Button>
            {canEmail && <Button size="sm" variant="outline" onClick={() => openEmail({ profile, feedback: includeFb ? latest : null })} data-testid="button-email-current">Email report</Button>}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Saved feedback ({sorted.length})</div>
          {sorted.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="text-no-feedback">No feedback saved for this player yet.</p> :
            sorted.map(f => (
              <div key={f.id} className="rounded-md border p-3 space-y-1.5 text-sm" data-testid={`feedback-${f.id}`}>
                <div className="font-semibold break-words">Player Development — {f.year}</div>
                <div className="text-xs text-muted-foreground">Season {f.year} | saved {fmtDate(f.createdAt)} | review {f.reviewDate ? fmtDate(f.reviewDate) : "not set"}</div>
                {f.focus && <div><span className="font-medium">Focus: </span>{f.focus}</div>}
                {f.note && <p className="whitespace-pre-wrap break-words">{f.note}</p>}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" disabled={busy === `f${f.id}`} onClick={() => download(`f${f.id}`, f.snapshot, f)} data-testid={`button-download-feedback-${f.id}`}>
                    {busy === `f${f.id}` ? "Building" : "Download saved evidence"}
                  </Button>
                  {canEmail && <Button size="sm" variant="outline" onClick={() => openEmail({ profile: f.snapshot, feedback: f })}>Email</Button>}
                  {canEdit && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setToDelete(f)} data-testid={`button-delete-feedback-${f.id}`}>Delete</Button>}
                </div>
              </div>
            ))}
        </div>
      </CardContent>

      <AlertDialog open={!!toDelete} onOpenChange={o => { if (!o && !del.isPending) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this feedback?</AlertDialogTitle>
            <AlertDialogDescription>The note and its saved evidence snapshot ({toDelete?.year}, saved {toDelete ? fmtDate(toDelete.createdAt) : ""}) will be removed permanently.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction data-testid="button-confirm-delete" onClick={e => {
              e.preventDefault();
              if (!toDelete) return;
              del.mutate({ params: { leagueId, id: toDelete.id } }, {
                onSuccess: () => { setToDelete(null); invalidate(qc); toast({ title: "Feedback deleted" }); },
                onError: () => toast({ title: "Could not delete feedback", variant: "destructive" }),
              });
            }}>{del.isPending ? "Deleting" : "Delete"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!email} onOpenChange={o => { if (!o && !send.isPending) setEmail(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Email report</DialogTitle>
            <DialogDescription>Sent only when you press Send. Addresses are yours to enter.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="em-to">To</Label><Input id="em-to" type="email" value={to} onChange={e => setTo(e.target.value)} data-testid="input-email-to" /></div>
            <div className="space-y-1.5"><Label htmlFor="em-from">From</Label><Input id="em-from" type="email" value={from} onChange={e => setFrom(e.target.value)} data-testid="input-email-from" /></div>
            <div className="space-y-1.5"><Label htmlFor="em-sub">Subject</Label><Input id="em-sub" value={subject} onChange={e => setSubject(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="em-body">Message</Label><Textarea id="em-body" rows={3} value={body} onChange={e => setBody(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmail(null)} disabled={send.isPending}>Cancel</Button>
            <Button onClick={doSend} disabled={send.isPending || busy === "email" || to.trim().length < 3 || from.trim().length < 3 || !subject.trim()} data-testid="button-send-email">
              {busy === "email" ? "Building" : send.isPending ? "Sending" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
