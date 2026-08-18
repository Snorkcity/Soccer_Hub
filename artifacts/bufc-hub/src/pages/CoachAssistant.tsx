import { useEffect, useRef, useState, useMemo } from "react";
import { useLocation } from "wouter";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Loader2, Mic, RotateCcw, Send, User, Video, X, ChevronDown } from "lucide-react";
import {
  useListVeoLeagues,
  getListVeoLeaguesQueryKey,
  useListVeoMatches,
  getListVeoMatchesQueryKey,
  type VeoMatchSummary,
} from "@workspace/api-client-react";
import { useActiveLeague } from "@/contexts/LeagueContext";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { NoAccess } from "@/components/NoAccess";

// Web Speech API (Chrome/Android); typed loosely because lib.dom omits it.
type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getSpeechRecognition(): SpeechRec | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

interface Msg {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

interface MatchContext {
  leagueId: number;
  veoId: number;
  label: string;   // display label built from match data
  opponent: string | null;
}

const SUGGESTIONS_DEFAULT = [
  "Give me U13 Cycle 2, week 1, session 1",
  "How should I run a U11 pre-match warm-up?",
  "Explain Drive-Draw-Play in simple terms",
  "What are the U14 phase outcomes?",
];

function suggestionsForMatch(opponent: string | null): string[] {
  const opp = opponent ?? "the opponent";
  return [
    `What session would you recommend before a game against ${opp}?`,
    `Help me give a pre-match talk focusing on our attacking shape`,
    `What are good training cues for managing possession in tight spaces?`,
    `How do I apply Drive-Draw-Play against a defensive opponent?`,
  ];
}

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function matchLabel(m: VeoMatchSummary): string {
  const opp = m.hubOpponent ?? m.opponent ?? "Unknown";
  const date = fmtDate(m.startsAt);
  const code = m.matchCode ? `${m.matchCode} · ` : "";
  return `${code}${opp}${date ? ` · ${date}` : ""}`;
}

// Coach Assistant is a paid add-on: shown only with the "assistant" module in some league.
export default function CoachAssistant() {
  const { isSuperadmin, hasModuleAnywhere, ready } = useLeagueModules();
  if (ready && !isSuperadmin && !hasModuleAnywhere("assistant")) return <NoAccess />;
  if (!ready) return null;
  return <CoachAssistantInner />;
}

function CoachAssistantInner() {
  const [, setLocation] = useLocation();

  // ── Parse optional query params: ?leagueId=X&veoId=Y ────────────────────
  const searchParams = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);
  const qpLeagueId = Number(searchParams.get("leagueId") ?? "");
  const qpVeoId = Number(searchParams.get("veoId") ?? "");
  const hasQp = Number.isFinite(qpLeagueId) && qpLeagueId > 0 && Number.isFinite(qpVeoId) && qpVeoId > 0;

  // ── Conversation state ───────────────────────────────────────────────────
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const [speechSupported] = useState(() =>
    typeof window !== "undefined" &&
    Boolean((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition),
  );

  // ── Match context state ──────────────────────────────────────────────────
  const [matchContext, setMatchContext] = useState<MatchContext | null>(null);

  // ── League / match selector state ────────────────────────────────────────
  const { activeLeagueId } = useActiveLeague();
  useLeagueModules(); // access check handled by parent CoachAssistant wrapper
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorLeagueId, setSelectorLeagueId] = useState<number | null>(null);

  // Fetch leagues with Veo.
  const { data: veoLeaguesData } = useListVeoLeagues({
    query: { queryKey: getListVeoLeaguesQueryKey() },
  });
  const veoLeagues = veoLeaguesData?.leagues ?? [];

  // Filter to leagues the user has access to (canSeeLeague is server-side;
  // client-side: user has this league in their grants — already filtered by the
  // /veo/leagues endpoint which canSeeLeague-filters).
  // selectorLeagueId defaults to activeLeagueId if it has Veo.
  const effectiveSelectorLeagueId = selectorLeagueId ??
    (veoLeagues.some((l) => l.id === activeLeagueId) ? activeLeagueId : (veoLeagues[0]?.id ?? null));

  // Track whether we've resolved query-param context (must be before matchListEnabled).
  const [qpResolved, setQpResolved] = useState(false);

  const matchListParams = { leagueId: effectiveSelectorLeagueId ?? 0 };
  // Fetch when selector is open OR when resolving query params (hasQp + not yet resolved).
  const matchListEnabled = effectiveSelectorLeagueId != null && (selectorOpen || (hasQp && !qpResolved));
  const { data: matchListData, isLoading: matchListLoading } = useListVeoMatches(matchListParams, {
    query: {
      enabled: matchListEnabled,
      queryKey: getListVeoMatchesQueryKey(matchListParams),
    },
  });
  const availableMatches: VeoMatchSummary[] = (matchListData?.matches ?? []).filter((m) => m.synced);

  // ── Resolve match context from query params (on mount / param change) ────
  useEffect(() => {
    if (!hasQp) return;
    // Set the selector league so match list is fetched for this league.
    setSelectorLeagueId(qpLeagueId);
  }, [hasQp, qpLeagueId]);

  // Once we have match list data and query params, resolve the context.
  useEffect(() => {
    if (!hasQp || qpResolved) return;
    if (matchListData && effectiveSelectorLeagueId === qpLeagueId) {
      const found = availableMatches.find((m) => m.id === qpVeoId);
      if (found) {
        const opp = found.hubOpponent ?? found.opponent ?? null;
        setMatchContext({
          leagueId: qpLeagueId,
          veoId: qpVeoId,
          label: matchLabel(found),
          opponent: opp,
        });
        setQpResolved(true);
        // Clear query params from URL without reload.
        setLocation("/assistant", { replace: true });
      } else if (!matchListLoading) {
        // Match not found in this league — clear params.
        setQpResolved(true);
        setLocation("/assistant", { replace: true });
      }
    }
  }, [hasQp, qpResolved, matchListData, matchListLoading, effectiveSelectorLeagueId, qpLeagueId, qpVeoId, availableMatches, setLocation]);

  function toggleMic() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = getSpeechRecognition();
    if (!rec) return;
    recRef.current = rec;
    rec.lang = "en-AU";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript;
      }
      if (text) setInput((prev) => (prev ? prev.replace(/\s+$/, "") + " " : "") + text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }

  useEffect(() => () => recRef.current?.stop(), []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setError(null);
    const history = [...messages, { role: "user" as const, content }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setBusy(true);

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const body: Record<string, unknown> = {
        messages: history.slice(-16).map(({ role, content: c }) => ({ role, content: c })),
        mobile: window.matchMedia("(max-width: 767px)").matches,
      };
      if (matchContext) {
        body.context = { leagueId: matchContext.leagueId, veoId: matchContext.veoId };
      }
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? "The assistant is unavailable right now — please try again.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6)) as {
            content?: string; error?: string; done?: boolean; sources?: string[];
          };
          if (payload.error) throw new Error(payload.error);
          if (payload.content) {
            acc += payload.content;
            const snapshot = acc;
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { role: "assistant", content: snapshot };
              return copy;
            });
          }
          if (payload.done && payload.sources) {
            const sources = payload.sources;
            setMessages((m) => {
              const copy = [...m];
              copy[copy.length - 1] = { ...copy[copy.length - 1], sources };
              return copy;
            });
          }
        }
      }
      if (!acc) throw new Error("The assistant didn't return an answer — please try again.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
        setMessages((m) => (m[m.length - 1]?.content === "" ? m.slice(0, -1) : m));
      }
    } finally {
      setBusy(false);
    }
  }

  const suggestions = matchContext ? suggestionsForMatch(matchContext.opponent) : SUGGESTIONS_DEFAULT;

  function handleSelectMatch(veoId: number) {
    const found = availableMatches.find((m) => m.id === veoId);
    if (!found || effectiveSelectorLeagueId == null) return;
    const opp = found.hubOpponent ?? found.opponent ?? null;
    setMatchContext({
      leagueId: effectiveSelectorLeagueId,
      veoId,
      label: matchLabel(found),
      opponent: opp,
    });
    setSelectorOpen(false);
  }

  return (
    <div className="p-4 md:p-6 flex flex-col max-w-4xl mx-auto h-[calc(100dvh-1rem)] md:h-[calc(100dvh-2rem)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" /> Coach Assistant
          </h1>
          <p className="text-sm text-muted-foreground">
            Answers come straight from the Belconnen development curriculum — coach packs, session plans and the framework library (U11 to 16+).
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => { abortRef.current?.abort(); setMessages([]); setError(null); }}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> New chat
          </Button>
        )}
      </div>

      {/* Match context panel */}
      <div className="mt-3 space-y-2">
        {matchContext ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
            <Video className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <span className="font-medium">Match context: </span>
              <span className="text-muted-foreground truncate">{matchContext.label}</span>
              <span className="ml-2 text-xs text-muted-foreground">(camera data + Hub facts included in all messages)</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={() => setMatchContext(null)}
              title="Remove match context"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}

        {/* Match selector toggle */}
        {veoLeagues.length > 0 && (
          <div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={() => setSelectorOpen((o) => !o)}
            >
              <Video className="h-3.5 w-3.5" />
              {matchContext ? "Change match context" : "Add match context from Veo"}
              <ChevronDown className={`h-3 w-3 transition-transform ${selectorOpen ? "rotate-180" : ""}`} />
            </Button>
            {selectorOpen && (
              <Card className="mt-2">
                <CardHeader className="pb-2 pt-3 px-3">
                  <CardTitle className="text-sm font-medium">Select a recorded match</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2">
                  {veoLeagues.length > 1 && (
                    <Select
                      value={String(effectiveSelectorLeagueId ?? "")}
                      onValueChange={(v) => setSelectorLeagueId(Number(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Pick a squad" />
                      </SelectTrigger>
                      <SelectContent>
                        {veoLeagues.map((l) => (
                          <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {matchListLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading matches...
                    </div>
                  ) : availableMatches.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">No synced matches for this squad.</p>
                  ) : (
                    <Select
                      value={matchContext && matchContext.leagueId === effectiveSelectorLeagueId ? String(matchContext.veoId) : ""}
                      onValueChange={(v) => handleSelectMatch(Number(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Pick a match..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableMatches.map((m) => (
                          <SelectItem key={m.id} value={String(m.id)}>
                            {matchLabel(m)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {matchContext && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground h-7 px-2"
                      onClick={() => { setMatchContext(null); setSelectorOpen(false); }}
                    >
                      <X className="h-3 w-3 mr-1" /> Clear context
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto mt-4 space-y-3 pr-1">
        {messages.length === 0 && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                {matchContext
                  ? `Match context selected: ${matchContext.label}. The assistant will include Veo camera observations and Hub match data in its answers. Curriculum guidance always takes priority.`
                  : 'Ask for a session ("U13 Cycle 2, week 1, session 1"), matchday guidance, or a framework explained. Try one of these:'}
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <Button key={s} variant="outline" size="sm" className="text-xs" onClick={() => void send(s)}>
                    {s}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "assistant" && (
              <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div className={`rounded-lg px-3.5 py-2.5 text-sm max-w-[85%] ${
              m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}>
              {m.role === "assistant" ? (
                m.content ? (
                  <div className="prose prose-sm prose-invert prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground prose-headings:text-foreground prose-blockquote:text-foreground/80 max-w-none [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-1.5 [&_ul]:my-1.5 [&_li]:my-0.5">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )
              ) : (
                <span className="whitespace-pre-wrap">{m.content}</span>
              )}
              {m.sources && m.sources.length > 0 && (
                <details className="mt-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Sources from the curriculum</summary>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {[...new Set(m.sources)].map((s) => <li key={s}>{s}</li>)}
                  </ul>
                </details>
              )}
            </div>
            {m.role === "user" && (
              <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-muted flex items-center justify-center">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div ref={bottomRef} />
      </div>

      {/* ChatGPT-style pill input */}
      <div className="mt-3 flex items-end gap-1.5 rounded-3xl border bg-background px-3 py-1.5 focus-within:ring-1 focus-within:ring-ring">
        <Textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={listening ? "Listening — tap the mic when done..." : "Ask the assistant..."}
          onChange={(e) => {
            setInput(e.target.value);
            const el = e.target;
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="resize-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent px-1 py-2 min-h-0 max-h-32 text-base md:text-sm"
        />
        {speechSupported && (
          <Button
            size="icon"
            variant={listening ? "destructive" : "ghost"}
            onClick={toggleMic}
            className="h-9 w-9 shrink-0 rounded-full mb-0.5"
            title={listening ? "Listening — tap to stop" : "Dictate with your voice"}
          >
            <Mic className={listening ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />
          </Button>
        )}
        <Button
          size="icon"
          onClick={() => void send()}
          disabled={busy || !input.trim()}
          className="h-9 w-9 shrink-0 rounded-full mb-0.5"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
