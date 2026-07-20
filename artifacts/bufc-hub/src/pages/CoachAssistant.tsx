import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Loader2, RotateCcw, Send, User } from "lucide-react";

interface Msg {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

const SUGGESTIONS = [
  "Give me U13 Cycle 2, week 1, session 1",
  "How should I run a U11 pre-match warm-up?",
  "Explain Drive–Draw–Play in simple terms",
  "What are the U14 phase outcomes?",
];

export default function CoachAssistant() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

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
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Send trimmed history — the assistant is stateless server-side.
          messages: history.slice(-16).map(({ role, content: c }) => ({ role, content: c })),
        }),
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

  return (
    <div className="p-4 md:p-6 flex flex-col max-w-4xl mx-auto h-[calc(100dvh-1rem)] md:h-[calc(100dvh-2rem)]">
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

      <div className="flex-1 overflow-y-auto mt-4 space-y-3 pr-1">
        {messages.length === 0 && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Ask for a session ("U13 Cycle 2, week 1, session 1"), matchday guidance, or a framework explained. Try one of these:
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
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
                  <div className="prose prose-sm dark:prose-invert max-w-none [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_p]:my-1.5 [&_ul]:my-1.5 [&_li]:my-0.5">
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

      <div className="mt-3 flex items-end gap-2">
        <Textarea
          rows={2}
          value={input}
          placeholder="Ask about a session, cycle, framework or matchday routine..."
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="resize-none"
        />
        <Button onClick={() => void send()} disabled={busy || !input.trim()} className="h-10">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
