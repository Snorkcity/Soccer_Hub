import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSessions,
  getListSessionsQueryKey,
  useCreateSession,
  useDeleteSession,
  useGetAuthStatus,
  getGetAuthStatusQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { CalendarDays, Plus, Trash2 } from "lucide-react";

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
          <Button onClick={() => createMutation.mutate({ data: {} })} disabled={createMutation.isPending}>
            <Plus className="h-4 w-4 mr-1" /> New session
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading sessions…</p>
      ) : (sessions ?? []).length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No sessions yet.{isAdmin ? ' Hit "New session" to build your first one.' : ""}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(sessions ?? []).map((s) => (
            <Card
              key={s.id}
              className="cursor-pointer hover:ring-2 hover:ring-primary/50 transition-shadow"
              onClick={() => navigate(`/sessions/${s.id}`)}
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium leading-tight">{s.title || "Untitled session"}</p>
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
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {s.sessionDate && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3 w-3" /> {s.sessionDate}
                    </span>
                  )}
                  {s.team && <Badge variant="secondary" className="text-[10px]">{s.team}</Badge>}
                  {s.sessionNumber && <Badge variant="outline" className="text-[10px]">{s.sessionNumber}</Badge>}
                  <Badge variant="outline" className="text-[10px]">{s.partCount} part{s.partCount === 1 ? "" : "s"}</Badge>
                </div>
                {s.theme && <p className="text-xs text-muted-foreground line-clamp-1">{s.theme}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
