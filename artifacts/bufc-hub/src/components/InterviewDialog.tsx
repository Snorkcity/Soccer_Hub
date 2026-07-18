/**
 * Voice reflection interview.
 *
 * Turn-based spoken interview over the fixed questions of one journal block:
 *  - each question is read aloud (TTS)
 *  - the coach speaks his answer (MediaRecorder → webm → base64)
 *  - the server may ask ONE gentle probe if the answer left a thread hanging
 *  - between questions it always asks "anything to add, or move on?" so a
 *    sneeze or background noise never cuts an answer short
 *  - at the end the answers are written up in the coach's voice and handed
 *    back for review in the normal editor (nothing saves without approval).
 */
import { useEffect, useRef, useState } from "react";
import {
  useJournalInterviewSpeak,
  useJournalInterviewTurn,
  useJournalInterviewWriteup,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Mic, PenLine, SkipForward, Square, Volume2 } from "lucide-react";
import type { JournalKindDef } from "@/lib/journalFields";

type Stage =
  | "intro"        // ready to start
  | "speaking"     // playing TTS
  | "ready"        // waiting for coach to press mic
  | "recording"
  | "thinking"     // server transcribing / judging
  | "writing"      // final write-up
  | "error";

type Phase = "answer" | "confirm";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  def: JournalKindDef;
  /** Called with the drafted content; parent shows it in the editor for review. */
  onComplete: (content: Record<string, string>) => void;
}

const CONFIRM_PROMPT = "Anything to add, or shall we move to the next question?";

// Cache TTS audio by text so repeated prompts (especially the confirm
// question, asked between every field) play instantly with no API round-trip.
const ttsCache = new Map<string, string>(); // text → data URI

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export default function InterviewDialog({ open, onOpenChange, def, onComplete }: Props) {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>("intro");
  const [fieldIdx, setFieldIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>("answer");
  const [probeUsed, setProbeUsed] = useState(false);
  const [prompt, setPrompt] = useState("");   // what's being asked right now
  const [lastHeard, setLastHeard] = useState(""); // last transcript shown to coach
  const answersRef = useRef<Record<string, string[]>>({});
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Monotonic session token: bumped on every open/close so async results from
  // an earlier session (a slow /turn, a late onended) can never leak into the
  // current one.
  const sessionRef = useRef(0);

  const speak = useJournalInterviewSpeak();
  const turn = useJournalInterviewTurn();
  const writeup = useJournalInterviewWriteup();

  const fields = def.fields;
  const field = fields[fieldIdx];

  // Reset when (re)opened
  useEffect(() => {
    sessionRef.current += 1;
    if (open) {
      answersRef.current = {};
      setFieldIdx(0);
      setPhase("answer");
      setProbeUsed(false);
      setPrompt("");
      setLastHeard("");
      setStage("intro");
    } else {
      stopPlayback();
      stopTracks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** True if this async continuation belongs to a stale session. */
  function stale(token: number) {
    return token !== sessionRef.current;
  }

  function stopPlayback() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }

  function stopTracks() {
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
  }

  async function say(text: string, nextStage: Stage = "ready") {
    const token = sessionRef.current;
    setPrompt(text);
    setStage("speaking");
    try {
      let uri = ttsCache.get(text);
      if (!uri) {
        const res = await speak.mutateAsync({ data: { text } });
        uri = `data:${res.mimeType};base64,${res.audioBase64}`;
        ttsCache.set(text, uri);
      }
      if (stale(token)) return;
      const audio = new Audio(uri);
      audioRef.current = audio;
      await audio.play().catch(() => undefined); // autoplay block → text still shown
      audio.onended = () => {
        if (!stale(token)) setStage(nextStage);
      };
      // Fallback if onended never fires (autoplay blocked)
      if (audio.paused) setStage(nextStage);
    } catch {
      if (!stale(token)) setStage(nextStage); // no voice — carry on with text
    }
  }

  function questionText(idx: number) {
    const f = fields[idx];
    const lead = idx === 0 ? `Let's start. ` : "";
    return `${lead}${f.question ?? f.label}`;
  }

  async function start() {
    setPhase("answer");
    setProbeUsed(!!def.quickInterview); // quick mode: never probe
    await say(questionText(0));
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      const token = sessionRef.current;

      // Quick mode: stop by itself after a pause, so the interview is
      // one tap per question. Only kicks in once he has actually spoken.
      let cleanupSilence: (() => void) | undefined;
      if (def.quickInterview && typeof AudioContext !== "undefined") {
        try {
          const ctx = new AudioContext();
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          src.connect(analyser);
          const buf = new Float32Array(analyser.fftSize);
          let hasSpoken = false;
          let quietSince = 0;
          const iv = window.setInterval(() => {
            analyser.getFloatTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            const rms = Math.sqrt(sum / buf.length);
            const now = performance.now();
            if (rms > 0.015) {
              hasSpoken = true;
              quietSince = 0;
            } else if (hasSpoken) {
              if (!quietSince) quietSince = now;
              else if (now - quietSince > 2800 && rec.state === "recording") rec.stop();
            }
          }, 200);
          cleanupSilence = () => {
            window.clearInterval(iv);
            void ctx.close().catch(() => undefined);
          };
        } catch {
          // silence detection unavailable — fall back to tap-to-stop
        }
      }

      rec.onstop = () => {
        cleanupSilence?.();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        if (!stale(token)) {
          setStage("thinking");
          void handleRecording(blob);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setStage("recording");
    } catch {
      toast({
        title: "Microphone blocked",
        description: "Allow microphone access in your browser to do a voice interview.",
        variant: "destructive",
      });
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setStage("thinking");
  }

  async function handleRecording(blob: Blob) {
    const f = fields[fieldIdx];
    const token = sessionRef.current;
    try {
      const audioBase64 = await blobToBase64(blob);
      const res = await turn.mutateAsync({
        data: {
          phase,
          question: f.question ?? f.label,
          hint: f.hint,
          priorAnswer: (answersRef.current[f.id] ?? []).join(" ") || undefined,
          probeUsed,
          audioBase64,
          audioMimeType: blob.type || "audio/webm",
        },
      });
      if (stale(token)) return;

      if (res.transcript) {
        answersRef.current[f.id] = [...(answersRef.current[f.id] ?? []), res.transcript];
        setLastHeard(res.transcript);
      }

      switch (res.action) {
        case "probe":
          setProbeUsed(true);
          setPhase("answer");
          await say(res.say ?? "Tell me a bit more about that.");
          break;
        case "confirm":
          setPhase("confirm");
          await say(res.say ?? CONFIRM_PROMPT);
          break;
        case "continue":
          if (res.say) {
            // He wants to add more but hasn't said it yet — listen in answer
            // mode (no further probing).
            setPhase("answer");
            setProbeUsed(true);
            await say(res.say);
          } else {
            // His reply already contained the extra content (appended above);
            // go straight back to the mandatory move-on gate.
            setPhase("confirm");
            await say(CONFIRM_PROMPT);
          }
          break;
        case "next":
          await nextField();
          break;
      }
    } catch {
      if (!stale(token)) {
        setStage("ready");
        toast({
          title: "That didn't go through",
          description: "Check your connection and try recording again.",
          variant: "destructive",
        });
      }
    }
  }

  async function nextField() {
    setLastHeard("");
    const next = fieldIdx + 1;
    if (next >= fields.length) {
      await finish();
      return;
    }
    setFieldIdx(next);
    setPhase("answer");
    setProbeUsed(!!def.quickInterview); // quick mode: never probe
    await say(questionText(next));
  }

  async function skipField() {
    stopPlayback();
    await nextField();
  }

  async function finish() {
    const token = sessionRef.current;
    setStage("writing");
    setPrompt("That's everything — writing it up now.");
    try {
      const qa = fields.map((f) => ({
        fieldId: f.id,
        // Give the write-up the question actually asked, so a rich spoken
        // answer isn't collapsed to fit a terse box label.
        label: f.question ?? f.label,
        hint: f.hint,
        answers: answersRef.current[f.id] ?? [],
      }));
      const res = await writeup.mutateAsync({ data: { kind: def.kind, title: def.title, qa } });
      if (stale(token)) return;
      onComplete(res.content);
      onOpenChange(false);
    } catch {
      if (!stale(token)) {
        setStage("error");
        setPrompt("The write-up failed. Your answers are safe — try finishing again.");
      }
    }
  }

  const answeredCount = Object.keys(answersRef.current).filter(
    (k) => (answersRef.current[k] ?? []).length > 0,
  ).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onOpenChange(false); }}>
      <DialogContent className="max-w-lg" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" /> Interview — {def.title}
          </DialogTitle>
          <DialogDescription>
            I'll ask each question out loud. Speak your answer, and I'll check before moving on.
          </DialogDescription>
        </DialogHeader>

        {stage === "intro" ? (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {fields.length} questions. Find a quiet-ish spot, speak naturally — I'll tidy the
              words up afterwards and you review everything before it's saved.
            </p>
            <Button className="w-full" onClick={() => void start()} disabled={speak.isPending}>
              <Volume2 className="h-4 w-4 mr-2" /> Start the interview
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <Badge variant="secondary">
                Question {Math.min(fieldIdx + 1, fields.length)} of {fields.length}
              </Badge>
              <span className="text-xs text-muted-foreground">{answeredCount} answered</span>
            </div>

            <div className="rounded-lg border bg-muted/40 p-4 min-h-[72px]">
              <p className="text-sm font-medium">{prompt}</p>
              {lastHeard && stage !== "writing" && (
                <p className="text-xs text-muted-foreground mt-2 italic">
                  Heard: “{lastHeard.length > 180 ? `${lastHeard.slice(0, 180)}…` : lastHeard}”
                </p>
              )}
            </div>

            <div className="flex flex-col items-center gap-3">
              {stage === "speaking" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Volume2 className="h-4 w-4 animate-pulse" /> Asking…
                </div>
              )}
              {stage === "ready" && (
                <Button size="lg" className="rounded-full h-16 w-16" onClick={() => void startRecording()}>
                  <Mic className="h-7 w-7" />
                </Button>
              )}
              {stage === "recording" && (
                <Button
                  size="lg"
                  variant="destructive"
                  className="rounded-full h-16 w-16 animate-pulse"
                  onClick={stopRecording}
                >
                  <Square className="h-6 w-6" />
                </Button>
              )}
              {(stage === "thinking" || stage === "writing") && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {stage === "writing" ? "Writing up your journal…" : "Listening back…"}
                </div>
              )}
              {stage === "error" && (
                <Button onClick={() => void finish()}>Try the write-up again</Button>
              )}
              {stage === "ready" && (
                <p className="text-xs text-muted-foreground">
                  {def.quickInterview
                    ? "Tap to talk — it stops by itself when you pause."
                    : "Tap to talk, tap again when you're done."}
                </p>
              )}
              {stage === "recording" && def.quickInterview && (
                <p className="text-xs text-muted-foreground">Just talk — I'll stop when you pause.</p>
              )}
            </div>

            {stage !== "writing" && stage !== "error" && (
              <div className="flex justify-between pt-1">
                <Button variant="ghost" size="sm" onClick={() => void skipField()} disabled={stage === "thinking"}>
                  <SkipForward className="h-3.5 w-3.5 mr-1" /> Skip question
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void finish()} disabled={stage === "thinking" || answeredCount === 0}>
                  <PenLine className="h-3.5 w-3.5 mr-1" /> Finish & write up
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
