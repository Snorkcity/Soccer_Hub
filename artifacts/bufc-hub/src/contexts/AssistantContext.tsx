import React, { createContext, useContext, useState, useRef, useEffect, ReactNode } from 'react';
import { useLocation } from 'wouter';
import { 
  useListAssistantMatches,
  getListAssistantMatchesQueryKey,
  useListVeoMatches,
  getListVeoMatchesQueryKey,
  type AssistantMatchOption,
} from '@workspace/api-client-react';
import { useActiveLeague } from '@/contexts/LeagueContext';
import { useLeagueModules } from '@/hooks/useLeagueModules';

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

export interface Msg {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

export interface MatchContext {
  leagueId: number;
  matchRowId?: number;
  veoId?: number;
  label: string;
  opponent: string | null;
}

export const SUGGESTIONS_DEFAULT = [
  "What should we focus on in training this week based on our recent results and reflections?",
  "Suggest a training theme, then let me decide if I want the full session",
  "Give me U13 Cycle 2, week 1, session 1",
  "Explain Drive-Draw-Play in simple terms",
];

export function suggestionsForMatch(opponent: string | null): string[] {
  const opp = opponent ?? "the opponent";
  return [
    `Based on our results, ${opp}'s form and my recent reflections, what should we focus on?`,
    `What training theme would you recommend before we play ${opp}?`,
    `What did the last meeting suggest we should sharpen against ${opp}?`,
    `Give me a short recommendation first, then I'll ask for the full session`,
  ];
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function matchLabel(m: AssistantMatchOption): string {
  const date = fmtDate(m.matchDate);
  return `${m.matchId} · ${m.opponent}${date ? ` · ${date}` : ""}`;
}

interface AssistantContextValue {
  messages: Msg[];
  setMessages: React.Dispatch<React.SetStateAction<Msg[]>>;
  input: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  busy: boolean;
  error: string | null;
  listening: boolean;
  matchContext: MatchContext | null;
  setMatchContext: React.Dispatch<React.SetStateAction<MatchContext | null>>;
  speechSupported: boolean;
  send: (text?: string) => Promise<void>;
  toggleMic: () => void;
  reset: () => void;
  abort: () => void;

  assistantLeagues: Array<{ id: number; name: string }>;
  availableMatches: AssistantMatchOption[];
  matchListLoading: boolean;
  selectorLeagueId: number | null;
  setSelectorLeagueId: React.Dispatch<React.SetStateAction<number | null>>;
  effectiveSelectorLeagueId: number | null;
  selectorOpen: boolean;
  setSelectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleSelectMatch: (matchRowId: number) => void;
  openWithContext: (context?: MatchContext) => void;
  
  isVisible: boolean;
  setVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { activeLeagueId, leagueOptions } = useActiveLeague();
  const { hasModule, isSuperadmin } = useLeagueModules();
  
  const [isVisible, setVisible] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRec | null>(null);
  const [speechSupported] = useState(() =>
    typeof window !== "undefined" &&
    Boolean((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition),
  );

  const [matchContext, setMatchContext] = useState<MatchContext | null>(null);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorLeagueId, setSelectorLeagueId] = useState<number | null>(null);

  // Search params handling on navigation
  const [qpLeagueId, setQpLeagueId] = useState<number | null>(null);
  const [qpVeoId, setQpVeoId] = useState<number | null>(null);
  const [qpMatchRowId, setQpMatchRowId] = useState<number | null>(null);
  const [qpResolved, setQpResolved] = useState(true);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const lId = Number(searchParams.get("leagueId"));
    const vId = Number(searchParams.get("veoId"));
    const mId = Number(searchParams.get("matchRowId"));
    
    if (lId > 0 && (vId > 0 || mId > 0)) {
      setQpLeagueId(lId);
      setQpVeoId(vId > 0 ? vId : null);
      setQpMatchRowId(mId > 0 ? mId : null);
      setQpResolved(false);
      setSelectorLeagueId(lId);
    } else {
      setQpLeagueId(null);
      setQpVeoId(null);
      setQpMatchRowId(null);
      setQpResolved(true);
    }
  }, [location]);

  const hasQp = qpLeagueId !== null && (qpVeoId !== null || qpMatchRowId !== null) && !qpResolved;
  const assistantLeagues = leagueOptions.filter((league) => isSuperadmin || hasModule(league.id, "assistant"));

  const effectiveSelectorLeagueId = selectorLeagueId ??
    (assistantLeagues.some((league) => league.id === activeLeagueId) ? activeLeagueId : (assistantLeagues[0]?.id ?? null));

  const matchListParams = { leagueId: effectiveSelectorLeagueId ?? 0 };
  const matchListEnabled = effectiveSelectorLeagueId != null && (selectorOpen || hasQp);
  const { data: matchListData, isLoading: matchListLoading } = useListAssistantMatches(matchListParams, {
    query: {
      enabled: matchListEnabled,
      queryKey: getListAssistantMatchesQueryKey(matchListParams),
    },
  });
  const availableMatches = matchListData?.matches ?? [];

  // Legacy Veo-only links can still target an unlinked recording. The main
  // selector uses official Hub matches; this query is only for resolving an
  // older ?leagueId=&veoId= URL when no Hub link exists yet.
  const legacyVeoParams = { leagueId: qpLeagueId ?? 0 };
  const { data: legacyVeoData, isLoading: legacyVeoLoading } = useListVeoMatches(legacyVeoParams, {
    query: {
      enabled: hasQp && qpVeoId != null,
      queryKey: getListVeoMatchesQueryKey(legacyVeoParams),
    },
  });

  // Resolve match context from query params
  useEffect(() => {
    if (qpResolved || qpLeagueId === null || (qpVeoId === null && qpMatchRowId === null)) return;
    
    if (matchListData && effectiveSelectorLeagueId === qpLeagueId) {
      const found = availableMatches.find((match) =>
        (qpMatchRowId != null && match.id === qpMatchRowId) ||
        (qpVeoId != null && match.veoId === qpVeoId),
      );
      if (found) {
        setMatchContext({
          leagueId: qpLeagueId,
          matchRowId: found.id,
          veoId: found.veoId ?? undefined,
          label: matchLabel(found),
          opponent: found.opponent,
        });
        setQpResolved(true);
        const url = new URL(window.location.href);
        url.search = '';
        window.history.replaceState({}, '', url.toString());
      } else if (qpVeoId != null && legacyVeoData) {
        const legacy = legacyVeoData.matches.find((match) => match.id === qpVeoId);
        if (legacy) {
          const opponent = legacy.hubOpponent ?? legacy.opponent ?? "Unknown opponent";
          setMatchContext({
            leagueId: qpLeagueId,
            veoId: qpVeoId,
            label: `${legacy.matchCode ? `${legacy.matchCode} · ` : ""}${opponent}${legacy.startsAt ? ` · ${fmtDate(legacy.startsAt)}` : ""}`,
            opponent,
          });
        }
        setQpResolved(true);
        const url = new URL(window.location.href);
        url.search = '';
        window.history.replaceState({}, '', url.toString());
      } else if (!matchListLoading && (qpVeoId == null || !legacyVeoLoading)) {
        setQpResolved(true);
      }
    }
  }, [
    availableMatches,
    effectiveSelectorLeagueId,
    legacyVeoData,
    legacyVeoLoading,
    matchListData,
    matchListLoading,
    qpLeagueId,
    qpMatchRowId,
    qpResolved,
    qpVeoId,
  ]);

  function handleSelectMatch(matchRowId: number) {
    const found = availableMatches.find((match) => match.id === matchRowId);
    if (!found || effectiveSelectorLeagueId == null) return;
    setMatchContext({
      leagueId: effectiveSelectorLeagueId,
      matchRowId,
      veoId: found.veoId ?? undefined,
      label: matchLabel(found),
      opponent: found.opponent,
    });
    setSelectorOpen(false);
  }

  function openWithContext(context?: MatchContext) {
    if (context) {
      setMatchContext(context);
      setSelectorLeagueId(context.leagueId);
    }
    setVisible(true);
  }

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
  useEffect(() => () => abortRef.current?.abort(), []);

  function reset() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
  }

  function abort() {
    abortRef.current?.abort();
    setBusy(false);
  }

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || busy) return;
    setInput("");
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
      const leagueContextId = matchContext?.leagueId ?? effectiveSelectorLeagueId;
      if (leagueContextId != null) {
        body.context = {
          leagueId: leagueContextId,
          ...(matchContext?.matchRowId != null ? { matchRowId: matchContext.matchRowId } : {}),
          ...(matchContext?.veoId != null ? { veoId: matchContext.veoId } : {}),
        };
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

  const value = {
    messages, setMessages,
    input, setInput,
    busy, error, listening,
    matchContext, setMatchContext,
    speechSupported,
    send, toggleMic, reset, abort,
    assistantLeagues, availableMatches, matchListLoading,
    selectorLeagueId, setSelectorLeagueId, effectiveSelectorLeagueId,
    selectorOpen, setSelectorOpen, handleSelectMatch, openWithContext,
    isVisible, setVisible
  };

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant() {
  const context = useContext(AssistantContext);
  if (!context) {
    throw new Error("useAssistant must be used within an AssistantProvider");
  }
  return context;
}
