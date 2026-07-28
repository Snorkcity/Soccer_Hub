import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuthStatus, getGetAuthStatusQueryKey, useUpdateProfile, useChangePassword, useLogout,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, LogOut, KeyRound, UserRound } from "lucide-react";

function errMsg(e: unknown): string {
  const anyE = e as { data?: { error?: string }; error?: string; message?: string } | undefined;
  return anyE?.data?.error ?? anyE?.error ?? anyE?.message ?? "Something went wrong";
}

export default function Account() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: auth } = useGetAuthStatus();
  const me = auth?.authenticated === true ? auth.user : undefined;

  // ── Profile (name + email) ──
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [profileErr, setProfileErr] = useState<string | null>(null);
  useEffect(() => {
    if (me) { setName(me.name); setEmail(me.email); }
  }, [me?.name, me?.email]);

  const updateProfile = useUpdateProfile({ mutation: {
    onSuccess: () => {
      setProfileErr(null);
      void queryClient.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() });
      toast({ description: "Details updated" });
    },
    onError: (e) => setProfileErr(errMsg(e)),
  }});

  const profileDirty = me !== undefined && (name.trim() !== me.name || email.trim().toLowerCase() !== me.email);

  // ── Password ──
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const changePw = useChangePassword({ mutation: {
    onSuccess: () => { setCurPw(""); setNewPw(""); setPwErr(null); toast({ description: "Password changed" }); },
    onError: (e) => setPwErr(errMsg(e)),
  }});

  const logout = useLogout({ mutation: {
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() }); },
  }});

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Account</h1>
        <p className="text-sm text-muted-foreground">Signed in as {me?.name} ({me?.email})</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><UserRound className="h-4 w-4" />Your details</CardTitle>
          <CardDescription>Change the name and email you sign in with.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setProfileErr(null);
              updateProfile.mutate({ data: { name: name.trim(), email: email.trim().toLowerCase() } });
            }}
          >
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            <Button type="submit" disabled={updateProfile.isPending || !profileDirty || name.trim().length === 0 || email.trim().length === 0}>
              {updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
            </Button>
            {profileErr && <p className="text-sm text-chart-4">{profileErr}</p>}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-4 w-4" />Change password</CardTitle>
          <CardDescription>You'll need your current password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
            onSubmit={(e) => { e.preventDefault(); setPwErr(null); changePw.mutate({ data: { currentPassword: curPw, newPassword: newPw } }); }}
          >
            <Input type="password" placeholder="Current password" value={curPw} onChange={(e) => setCurPw(e.target.value)} autoComplete="current-password" />
            <Input type="password" placeholder="New password (8+ characters)" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
            <Button type="submit" disabled={changePw.isPending || curPw.length === 0 || newPw.length < 8}>
              {changePw.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Change password"}
            </Button>
          </form>
          {pwErr && <p className="text-sm text-chart-4">{pwErr}</p>}
        </CardContent>
      </Card>

      <Button variant="outline" onClick={() => logout.mutate()} className="text-muted-foreground">
        <LogOut className="h-4 w-4 mr-1.5" />Log out
      </Button>
    </div>
  );
}
