import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuthStatus, getGetAuthStatusQueryKey, useLogin,
  useForgotPassword, useResetPassword,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock, Loader2, AlertTriangle, MailCheck, KeyRound, CheckCircle2 } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// App-wide login gate. Nothing renders (and no data loads) until the user has
// a session. Also handles "forgot password" (email a reset link) and the
// reset form itself (reached via ?reset_token=... links from those emails).
// ─────────────────────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  const anyE = e as { data?: { error?: string }; error?: string; message?: string } | undefined;
  return anyE?.data?.error ?? anyE?.error ?? anyE?.message ?? "Something went wrong";
}

function readResetToken(): string | null {
  return new URLSearchParams(window.location.search).get("reset_token");
}

function clearResetTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("reset_token");
  window.history.replaceState({}, "", url.toString());
}

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <img src="/logo-outline.png" alt="Performance Hub" className="mx-auto h-24 w-24" />
          <h1 className="text-2xl font-bold tracking-tight">BUFC Performance Hub</h1>
          <p className="text-sm text-muted-foreground">Belconnen United FC</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-chart-4">
      <AlertTriangle className="h-4 w-4 shrink-0" />{msg}
    </div>
  );
}

function ResetPasswordScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const reset = useResetPassword({ mutation: {
    onSuccess: () => { setDone(true); clearResetTokenFromUrl(); },
    onError: (e) => setErr(errMsg(e)),
  }});

  return (
    <AuthFrame>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-4 w-4" />Set a new password</CardTitle>
          <CardDescription>{done ? "All done." : "Choose a new password for your account."}</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-chart-2" />Password changed. You can log in with it now.
              </div>
              <Button className="w-full" onClick={onDone}>Go to log in</Button>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={e => {
                e.preventDefault(); setErr(null);
                if (pw.length < 8) { setErr("Password must be at least 8 characters"); return; }
                if (pw !== pw2) { setErr("Passwords don't match"); return; }
                reset.mutate({ data: { token, newPassword: pw } });
              }}
            >
              <Input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="New password (8+ characters)" autoFocus autoComplete="new-password" />
              <Input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Repeat new password" autoComplete="new-password" />
              <Button type="submit" className="w-full" disabled={reset.isPending || pw.length === 0 || pw2.length === 0}>
                {reset.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set password"}
              </Button>
              {err && <ErrorLine msg={err} />}
            </form>
          )}
        </CardContent>
      </Card>
    </AuthFrame>
  );
}

function LoginScreen() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const login = useLogin({ mutation: {
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() }); },
    onError: (e) => setErr(errMsg(e)),
  }});
  const forgot = useForgotPassword({ mutation: {
    onSuccess: () => setSent(true),
    onError: (e) => setErr(errMsg(e)),
  }});

  if (mode === "forgot") {
    return (
      <AuthFrame>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-4 w-4" />Forgot password</CardTitle>
            <CardDescription>Enter your email and we'll send you a reset link.</CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 text-sm">
                  <MailCheck className="h-4 w-4 shrink-0 mt-0.5 text-chart-2" />
                  <span>If an account exists for <span className="font-medium">{email}</span>, a reset link is on its way. Check your inbox (and spam folder) — the link lasts 1 hour.</span>
                </div>
                <Button variant="outline" className="w-full" onClick={() => { setMode("login"); setSent(false); setErr(null); }}>Back to log in</Button>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={e => { e.preventDefault(); setErr(null); forgot.mutate({ data: { email } }); }}
              >
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoFocus autoComplete="username" />
                <Button type="submit" className="w-full" disabled={forgot.isPending || email.length === 0}>
                  {forgot.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset link"}
                </Button>
                {err && <ErrorLine msg={err} />}
                <button type="button" className="w-full text-sm text-muted-foreground hover:text-foreground" onClick={() => { setMode("login"); setErr(null); }}>
                  Back to log in
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Lock className="h-4 w-4" />Sign in</CardTitle>
          <CardDescription>Log in with your email and password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={e => { e.preventDefault(); setErr(null); login.mutate({ data: { email, password } }); }}
          >
            <Input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="Email" autoFocus autoComplete="username"
            />
            <Input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Password" autoComplete="current-password"
            />
            <Button type="submit" className="w-full" disabled={login.isPending || password.length === 0 || email.length === 0}>
              {login.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log in"}
            </Button>
            {err && <ErrorLine msg={err} />}
            <button type="button" className="w-full text-sm text-muted-foreground hover:text-foreground" onClick={() => { setMode("forgot"); setErr(null); }}>
              Forgot password?
            </button>
          </form>
        </CardContent>
      </Card>
    </AuthFrame>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { data: auth, isLoading } = useGetAuthStatus();
  const [resetToken, setResetToken] = useState<string | null>(() => readResetToken());
  // Reset link takes priority even if a session exists (e.g. shared computer).
  if (resetToken) {
    return <ResetPasswordScreen token={resetToken} onDone={() => setResetToken(null)} />;
  }
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
