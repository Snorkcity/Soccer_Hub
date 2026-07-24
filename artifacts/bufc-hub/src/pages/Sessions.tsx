import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  useListSessions,
  getListSessionsQueryKey,
  useCreateSession,
  useDeleteSession,
  useGenerateSession,
  useGetAuthStatus,
  getGetAuthStatusQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { CalendarDays, Plus, Sparkles, Trash2 } from "lucide-react";

export default function Sessions() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: sessions, isLoading } = useListSessions({
    query: { queryKey: getListSessionsQueryKey() },
  });
  const { data: auth } = useGetAuthStatus({ query: { queryKey: getGetAuthStatusQueryKey() } });
  const isAdmin = auth?.authenticated && auth.role === "admin";

  const createMutation = useCreateSession({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        navigate(`/sessions/${res.id}`);
      },
      onError: () => toast({ title: "Couldn't create the session", variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteSession({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() }),
      onError: () => toast({ title: "Couldn't delete the session", variant: "destructive" }),
    },
  });

  // ── AI generation form ──
  const [genOpen, setGenOpen] = useState(false);
  const [theme, setTheme] = useState("");
  const [players, setPlayers] = useState("");
  const [minutes, setMinutes] = useState("90");
  const [endGame, setEndGame] = useState<"small" | "medium" | "big">("big");
  const [endGamePlan, setEndGamePlan] = useState("");
  const [includeActivation, setIncludeActivation] = useState(false);

  const generateMutation = useGenerateSession({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        setGenOpen(false);
        navigate(`/sessions/${res.id}`);
      },
      onError: (err) =>
        toast({
          title: "Couldn't generate the session",
          description: (err as { response?: { data?: { error?: string } } })?.response?.data?.error,
          variant: "destructive",
        }),
    },
  });

  const submitGenerate = () => {
    if (theme.trim().length < 3) {
      toast({ title: "Tell it what to train", description: "e.g. pressing from a mid block", variant: "destructive" });
      return;
    }
    const p = Number(players);
    const m = Number(minutes);
    generateMutation.mutate({
      data: {
        theme: theme.trim(),
        players: Number.isFinite(p) && p >= 4 ? p : undefined,
        minutes: Number.isFinite(m) && m >= 30 ? m : undefined,
        endGame,
        endGamePlan: endGamePlan.trim() || undefined,
        includeActivation: includeActivation || undefined,
      },
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Session Planner</h1>
          <p className="text-sm text-muted-foreground">
            Build training sessions from your practice library, then print the session plan
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setGenOpen(true)}>
              <Sparkles className="h-4 w-4 mr-1" /> Generate with AI
            </Button>
            <Button onClick={() => createMutation.mutate({ data: {} })} disabled={createMutation.isPending}>
              <Plus className="h-4 w-4 mr-1" /> New session
            </Button>
          </div>
        )}
      </div>

      <Dialog open={genOpen} onOpenChange={(o) => !generateMutation.isPending && setGenOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate a session</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="gen-theme">What are we training?</Label>
              <Input
                id="gen-theme"
                placeholder="e.g. pressing from a mid block"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="gen-players">Players</Label>
                <Input id="gen-players" inputMode="numeric" placeholder="e.g. 16" value={players} onChange={(e) => setPlayers(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gen-minutes">Minutes</Label>
                <Input id="gen-minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>End game cycle</Label>
              <div className="flex gap-2">
                {(["small", "medium", "big"] as const).map((c) => (
                  <Button
                    key={c}
                    type="button"
                    size="sm"
                    variant={endGame === c ? "default" : "outline"}
                    onClick={() => setEndGame(c)}
                    className="capitalize flex-1"
                  >
                    {c} games
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="gen-activation"
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={includeActivation}
                onChange={(e) => setIncludeActivation(e.target.checked)}
              />
              <Label htmlFor="gen-activation" className="font-normal">
                Include a passing activation in the warmup (older teams)
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gen-plan">End game plan / size (optional)</Label>
              <Input id="gen-plan" placeholder="e.g. 9v9 two big goals, offside on" value={endGamePlan} onChange={(e) => setEndGamePlan(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Builds a draft from your own practice library — standard warmup, matched introduction, main part and end game. You can swap or edit anything after.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGenOpen(false)} disabled={generateMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={submitGenerate} disabled={generateMutation.isPending}>
              {generateMutation.isPending ? "Assembling your session…" : "Generate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <p className="text-muted-foreground">Loading sessions…</p>
      ) : (sessions ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No sessions yet.{isAdmin ? ' Hit "New session" to build your first one.' : ""}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border divide-y">
          {(sessions ?? []).map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => navigate(`/sessions/${s.id}`)}
            >
              <span className="text-sm font-medium truncate min-w-0 flex-1">
                {s.title || "Untitled session"}
                {s.theme && (
                  <span className="ml-2 font-normal text-muted-foreground hidden md:inline">{s.theme}</span>
                )}
              </span>
              {s.team && <Badge variant="secondary" className="text-[10px] shrink-0">{s.team}</Badge>}
              {s.sessionNumber && (
                <Badge variant="outline" className="text-[10px] shrink-0 hidden sm:inline-flex">{s.sessionNumber}</Badge>
              )}
              <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                {s.partCount} part{s.partCount === 1 ? "" : "s"}
              </span>
              {s.sessionDate && (
                <span className="text-xs text-muted-foreground shrink-0 inline-flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" /> {s.sessionDate}
                </span>
              )}
              {isAdmin && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete "${s.title || "Untitled session"}"? This can't be undone.`)) {
                      deleteMutation.mutate({ id: s.id });
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
