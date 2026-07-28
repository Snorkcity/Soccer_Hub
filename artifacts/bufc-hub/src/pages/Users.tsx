import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuthStatus, useListUsers, getListUsersQueryKey, useCreateUser, useUpdateUser, useDeleteUser,
  useChangePassword, useLogout, getGetAuthStatusQueryKey, useListLeagues, getListLeaguesQueryKey,
  type UserInfo, type LeagueAccess,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, LogOut, Plus, Pencil, Trash2, ShieldCheck, KeyRound, Users as UsersIcon } from "lucide-react";

function errMsg(e: unknown): string {
  const anyE = e as { data?: { error?: string }; error?: string; message?: string } | undefined;
  return anyE?.data?.error ?? anyE?.error ?? anyE?.message ?? "Something went wrong";
}

type LeagueRole = "admin" | "viewer" | "none";

interface EditorState {
  id: number | null; // null = creating
  name: string;
  email: string;
  password: string;
  isSuperadmin: boolean;
  leagueRoles: Record<number, LeagueRole>;
}

export default function Users() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: auth } = useGetAuthStatus();
  const isSuperadmin = auth?.authenticated === true && auth.user?.isSuperadmin === true;

  const { data: users, isLoading } = useListUsers({ query: { enabled: isSuperadmin, queryKey: getListUsersQueryKey() } });
  const { data: leagues } = useListLeagues({ query: { queryKey: getListLeaguesQueryKey() } });

  const leagueName = useMemo(() => new Map((leagues ?? []).map(l => [l.id, l.name])), [leagues]);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorErr, setEditorErr] = useState<string | null>(null);

  const refresh = () => { void queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); };
  const createUser = useCreateUser({ mutation: {
    onSuccess: () => { refresh(); setEditor(null); toast({ description: "User created" }); },
    onError: (e) => setEditorErr(errMsg(e)),
  }});
  const updateUser = useUpdateUser({ mutation: {
    onSuccess: () => { refresh(); setEditor(null); toast({ description: "User updated" }); },
    onError: (e) => setEditorErr(errMsg(e)),
  }});
  const deleteUser = useDeleteUser({ mutation: {
    onSuccess: () => { refresh(); toast({ description: "User deleted" }); },
    onError: (e) => toast({ description: errMsg(e), variant: "destructive" }),
  }});

  // ── My account (any signed-in user) ──
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

  function openCreate() {
    setEditorErr(null);
    setEditor({ id: null, name: "", email: "", password: "", isSuperadmin: false, leagueRoles: {} });
  }
  function openEdit(u: UserInfo) {
    setEditorErr(null);
    const roles: Record<number, LeagueRole> = {};
    for (const a of u.leagues) roles[a.leagueId] = a.role as LeagueRole;
    setEditor({ id: u.id, name: u.name, email: u.email, password: "", isSuperadmin: u.isSuperadmin, leagueRoles: roles });
  }
  function saveEditor() {
    if (!editor) return;
    setEditorErr(null);
    const leagueAccess: LeagueAccess[] = Object.entries(editor.leagueRoles)
      .filter(([, role]) => role === "admin" || role === "viewer")
      .map(([leagueId, role]) => ({ leagueId: Number(leagueId), role: role as "admin" | "viewer" }));
    if (editor.id === null) {
      createUser.mutate({ data: {
        name: editor.name.trim(), email: editor.email.trim(), password: editor.password,
        isSuperadmin: editor.isSuperadmin, leagues: leagueAccess,
      }});
    } else {
      updateUser.mutate({ id: editor.id, data: {
        name: editor.name.trim(), email: editor.email.trim(),
        ...(editor.password ? { password: editor.password } : {}),
        isSuperadmin: editor.isSuperadmin, leagues: leagueAccess,
      }});
    }
  }

  const saving = createUser.isPending || updateUser.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">Accounts, league access and your own password.</p>
      </div>

      {isSuperadmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg"><UsersIcon className="h-4 w-4" />Accounts</CardTitle>
              <CardDescription>Create logins and choose which leagues each person can see.</CardDescription>
            </div>
            <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1.5" />New user</Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="divide-y divide-border">
                {(users ?? []).map((u) => (
                  <div key={u.id} className="py-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{u.name}</span>
                        {u.isSuperadmin && (
                          <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" />Superadmin</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                      {!u.isSuperadmin && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {u.leagues.length === 0 && <span className="text-xs text-muted-foreground italic">No league access</span>}
                          {u.leagues.map((a) => (
                            <Badge key={a.leagueId} variant="outline" className="text-xs">
                              {leagueName.get(a.leagueId) ?? `League ${a.leagueId}`} · {a.role === "admin" ? "Admin" : "View only"}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button>
                    {auth?.user?.id !== u.id && (
                      <Button
                        variant="ghost" size="sm" className="text-destructive"
                        onClick={() => { if (window.confirm(`Delete ${u.name}'s account? They will no longer be able to log in.`)) deleteUser.mutate({ id: u.id }); }}
                      ><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-4 w-4" />My account</CardTitle>
          <CardDescription>
            Signed in as {auth?.user?.name} ({auth?.user?.email})
          </CardDescription>
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
          <Button variant="outline" size="sm" onClick={() => logout.mutate()} className="text-muted-foreground">
            <LogOut className="h-4 w-4 mr-1.5" />Log out
          </Button>
        </CardContent>
      </Card>

      <Dialog open={editor !== null} onOpenChange={(open) => { if (!open) setEditor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editor?.id === null ? "New user" : "Edit user"}</DialogTitle>
          </DialogHeader>
          {editor && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Name</label>
                <Input value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder="e.g. Luke" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Email</label>
                <Input type="email" value={editor.email} onChange={(e) => setEditor({ ...editor, email: e.target.value })} placeholder="name@example.com" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {editor.id === null ? "Temporary password (8+ characters)" : "Reset password (leave blank to keep current)"}
                </label>
                <Input type="text" value={editor.password} onChange={(e) => setEditor({ ...editor, password: e.target.value })} autoComplete="off" />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">Superadmin</div>
                  <div className="text-xs text-muted-foreground">Full access to everything, including users</div>
                </div>
                <Switch checked={editor.isSuperadmin} onCheckedChange={(v) => setEditor({ ...editor, isSuperadmin: v })} />
              </div>
              {!editor.isSuperadmin && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">League access</div>
                  {(leagues ?? []).map((l) => (
                    <div key={l.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm">{l.name}</span>
                      <Select
                        value={editor.leagueRoles[l.id] ?? "none"}
                        onValueChange={(v) => setEditor({ ...editor, leagueRoles: { ...editor.leagueRoles, [l.id]: v as LeagueRole } })}
                      >
                        <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No access</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="viewer">View only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
              {editorErr && <p className="text-sm text-chart-4">{editorErr}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>Cancel</Button>
            <Button
              onClick={saveEditor}
              disabled={saving || !editor || editor.name.trim().length === 0 || editor.email.trim().length < 3 || (editor.id === null && editor.password.length < 8)}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
