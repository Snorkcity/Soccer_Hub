import React, { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Loader2, Mic, Send, User, Video, X, ChevronDown } from "lucide-react";
import { useAssistant, SUGGESTIONS_DEFAULT, suggestionsForMatch, matchLabel } from "@/contexts/AssistantContext";

export function CoachAssistantChat({ variant }: { variant: "full" | "overlay" }) {
  const {
    messages, input, setInput, busy, error, listening,
    matchContext: manualMatchContext, activeMatchContext: matchContext,
    setMatchContext, speechSupported,
    send, toggleMic,
    assistantLeagues, availableMatches, matchListLoading,
    effectiveSelectorLeagueId, setSelectorLeagueId,
    selectorOpen, setSelectorOpen, handleSelectMatch
  } = useAssistant();

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const suggestions = matchContext ? suggestionsForMatch(matchContext.opponent) : SUGGESTIONS_DEFAULT;

  return (
    <div className="flex flex-col flex-1 overflow-hidden relative">
      {/* Match context panel */}
      <div className={`shrink-0 z-20 ${variant === 'full' ? 'mt-3' : 'px-4 py-3 border-b bg-card'}`}>
        {matchContext ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm">
            <Video className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <span className="font-medium">Match context: </span>
              <span className="text-muted-foreground truncate block md:inline">{matchContext.label}</span>
              {variant === 'full' && (
                <span className="ml-2 text-xs text-muted-foreground hidden lg:inline">
                  ({matchContext.veoId != null ? "official Hub facts + linked Veo estimates" : "official Hub facts; no Veo recording linked"})
                </span>
              )}
            </div>
            {manualMatchContext && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => setMatchContext(null)}
                title="Use the current page context"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ) : null}

        {assistantLeagues.length > 0 && (
          <div className={matchContext ? "mt-2" : ""}>
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 w-full md:w-auto bg-card"
              onClick={() => setSelectorOpen((o) => !o)}
            >
              <Video className="h-3.5 w-3.5" />
              {matchContext ? "Change match context" : "Add match context"}
              <ChevronDown className={`h-3 w-3 transition-transform ${selectorOpen ? "rotate-180" : ""}`} />
            </Button>
            {selectorOpen && (
              <Card className="mt-2 shadow-xl bg-card">
                <CardHeader className="pb-2 pt-3 px-3">
                  <CardTitle className="text-sm font-medium">Select a Hub match</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-2">
                  {assistantLeagues.length > 1 && (
                    <Select
                      value={String(effectiveSelectorLeagueId ?? "")}
                      onValueChange={(v) => setSelectorLeagueId(Number(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Pick a squad" />
                      </SelectTrigger>
                      <SelectContent>
                        {assistantLeagues.map((league) => (
                          <SelectItem key={league.id} value={String(league.id)}>{league.name}</SelectItem>
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
                    <p className="text-xs text-muted-foreground py-1">No Hub matches are available for this squad.</p>
                  ) : (
                    <Select
                      value={matchContext?.matchRowId != null && matchContext.leagueId === effectiveSelectorLeagueId ? String(matchContext.matchRowId) : ""}
                      onValueChange={(v) => handleSelectMatch(Number(v))}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Pick a match..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableMatches.map((match) => (
                          <SelectItem key={match.id} value={String(match.id)}>
                            {matchLabel(match)}{match.veoId != null ? " · Veo linked" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {manualMatchContext && (
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
      <div className={`flex-1 overflow-y-auto space-y-3 z-0 ${variant === 'full' ? 'mt-4 pr-1' : 'p-4'}`}>
        {messages.length === 0 && (
          <Card className="bg-card">
            <CardContent className="p-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                {matchContext
                  ? matchContext.matchRowId != null
                    ? `Match context selected: ${matchContext.label}. The assistant will use official Hub facts${matchContext.veoId != null ? " and clearly labelled Veo estimates" : ""}. Curriculum guidance takes priority.`
                    : `Match context selected: ${matchContext.label}. This unlinked Veo recording supplies camera-derived estimates only; no official Hub match facts are attached. Curriculum guidance takes priority.`
                  : 'Ask for a short evidence-led training recommendation, discuss the theme, then request the full session when you are ready. Try one of these:'}
              </p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <Button key={s} variant="outline" size="sm" className="text-xs text-left h-auto py-1.5 px-2.5 leading-snug bg-card" onClick={() => void send(s)}>
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
                  <summary className="cursor-pointer">Sources from curriculum</summary>
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

      {/* Input area */}
      <div className={`shrink-0 z-20 ${variant === 'full' ? 'mt-3' : 'p-3 bg-card border-t'}`}>
        <div className={`flex items-end gap-1.5 rounded-3xl border focus-within:ring-1 focus-within:ring-ring ${variant === 'full' ? 'bg-background px-3 py-1.5' : 'bg-background px-2.5 py-1'}`}>
          <Textarea
            ref={inputRef}
            rows={1}
            value={input}
            placeholder={listening ? "Listening — tap mic when done..." : "Ask the assistant..."}
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
    </div>
  );
}
