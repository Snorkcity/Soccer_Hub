import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetAuthStatus, getGetAuthStatusQueryKey, useLogin } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Loader2, AlertTriangle } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// App-wide login gate. Nothing renders (and no data loads) until the user has
// a session. Today there is a single club password (admin role); in future,
// club coach/analyst logins will land here too and receive a viewer role.
// ─────────────────────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  const anyE = e as { data?: { error?: string }; error?: string; message?: string } | undefined;
  return anyE?.data?.error ?? anyE?.error ?? anyE?.message ?? "Something went wrong";
}

function LoginScreen() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const login = useLogin({ mutation: {
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() }); },
    onError: (e) => setErr(errMsg(e)),
  }});

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">BUFC Performance Hub</h1>
          <p className="text-sm text-muted-foreground">Belconnen United FC</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Lock className="h-4 w-4" />Club access</CardTitle>
            <CardDescription>Enter the club password to view the hub.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={e => { e.preventDefault(); setErr(null); login.mutate({ data: { password } }); }}
            >
              <Input
                type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Password" autoFocus autoComplete="current-password"
              />
              <Button type="submit" className="w-full" disabled={login.isPending || password.length === 0}>
                {login.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log in"}
              </Button>
              {err && (
                <div className="flex items-center gap-2 text-sm text-chart-4">
                  <AlertTriangle className="h-4 w-4 shrink-0" />{err}
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { data: auth, isLoading } = useGetAuthStatus();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!auth?.authenticated) return <LoginScreen />;
  return <>{children}</>;
}
