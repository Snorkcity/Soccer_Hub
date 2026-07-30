import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuthStatus, useListUsers, getListUsersQueryKey, useCreateUser, useUpdateUser, useDeleteUser, useInviteUser,
  useListLeagues, getListLeaguesQueryKey,
  useGetClubs, getGetClubsQueryKey,
  type UserInfo, type LeagueAccess,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Plus, Pencil, Trash2, ShieldCheck, MailPlus, Users as UsersIcon } from "lucide-react";

function errMsg(e: unknown): string {
  const anyE = e as { data?: { error?: string }; error?: string; message?: string } | undefined;
  return anyE?.data?.error ?? anyE?.error ?? anyE?.message ?? "Something went wrong";
}

// The tickable per-league modules, in display order. `short` labels are used in
// the compact access summary shown in the user list.
const MODULES: { key: string; label: string; short: string }[] = [
  { key: "season-stats", label: "Season Stats", short: "Stats" },
  { key: "gps", label: "GPS Insights", short: "GPS" },
  { key: "testing", label: "Testing", short: "Testing" },
  { key: "match-prep", label: "Match Prep", short: "Prep" },
  { key: "reflections", label: "Reflections", short: "Reflect" },
  { key: "data-entry", label: "Data Entry", short: "Entry" },
  { key: "session-planner", label: "Session Planner + Library", short: "Planner" },
  { key: "assistant", label: "Coach Assistant", short: "Assistant" },
];

// Legacy `role` is derived from modules: data-entry ⇒ admin, otherwise viewer.
function roleForModules(modules: string[]): "admin" | "viewer" {
  return modules.includes("data-entry") ? "admin" : "viewer";
}

interface EditorState {
  id: number | null; // null = creating
  name: string;
  email: string;
  password: string;
  isSuperadmin: boolean;
  // leagueId → set of ticked module keys
  leagueModules: Record<number, string[]>;
  // leagueId → the person's own club ("" = league default)
  leagueClubs: Record<number, string>;
}

export default function Users() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: auth } = useGetAuthStatus();
  const isSuperadmin = auth?.authenticated === true && auth.user?.isSuperadmin === true;

  const { data: users, isLoading } = useListUsers({ query: { enabled: isSuperadmin, queryKey: getListUsersQueryKey() } });
  const { data: leagues } = useListLeagues({ query: { queryKey: getListLeaguesQueryKey() } });
  const { data: clubs } = useGetClubs({ query: { queryKey: getGetClubsQueryKey() } });

  const leagueName = useMemo(() => new Map((leagues ?? []).map(l => [l.id, l.name])), [leagues]);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorErr, setEditorErr] = useState<string | null>(null);

  const refresh = () => { void queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }); };
  const createUser = useCreateUser({ mutation: {
    onSuccess: (_data, vars) => {
      refresh(); setEditor(null);
      toast({ description: vars.data.password ? "User created" : "User created — invite email sent" });
    },
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
  const inviteUser = useInviteUser({ mutation: {
    onSuccess: () => toast({ description: "Invite email sent" }),
    onError: (e) => toast({ description: errMsg(e), variant: "destructive" }),
  }});


  function openCreate() {
    setEditorErr(null);
    setEditor({ id: null, name: "", email: "", password: "", isSuperadmin: false, leagueModules: {}, leagueClubs: {} });
  }
  function formatLastLogin(iso: string): string {
    const d = new Date(iso);
    const date = d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
    const time = d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
    return `${date}, ${time}`;
  }

  function openEdit(u: UserInfo) {
    setEditorErr(null);
    const leagueModules: Record<number, string[]> = {};
    const leagueClubs: Record<number, string> = {};
    for (const a of u.leagues) {
      leagueModules[a.leagueId] = [...a.modules];
      leagueClubs[a.leagueId] = a.club ?? "";
    }
    setEditor({ id: u.id, name: u.name, email: u.email, password: "", isSuperadmin: u.isSuperadmin, leagueModules, leagueClubs });
  }
  function toggleModule(leagueId: number, module: string, on: boolean) {
    setEditor((prev) => {
      if (!prev) return prev;
      const current = new Set(prev.leagueModules[leagueId] ?? []);
      if (on) current.add(module); else current.delete(module);
      return { ...prev, leagueModules: { ...prev.leagueModules, [leagueId]: [...current] } };
    });
  }
  function saveEditor() {
    if (!editor) return;
    setEditorErr(null);
    // A league with zero ticked modules is omitted entirely. `role` stays required
    // in requests and is derived from the ticked modules.
    const leagueAccess: LeagueAccess[] = Object.entries(editor.leagueModules)
      .map(([leagueId, modules]) => ({ leagueId: Number(leagueId), modules }))
      .filter(({ modules }) => modules.length > 0)
      .map(({ leagueId, modules }) => ({
        leagueId, role: roleForModules(modules), modules,
        club: editor.leagueClubs[leagueId] || null,
      }));
    if (editor.id === null) {
      createUser.mutate({ data: {
        name: editor.name.trim(), email: editor.email.trim(),
        ...(editor.password ? { password: editor.password } : {}),
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
        <p className="text-sm text-muted-foreground">Accounts and league access. People change their own password on the My Account page.</p>
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
                      <div className="text-xs text-muted-foreground truncate">
                        {u.email}
                        <span className="mx-1.5 text-border">·</span>
                        {u.lastLoginAt ? (
                          <span>Last login {formatLastLogin(u.lastLoginAt)}</span>
                        ) : (
                          <span className="italic">Never logged in</span>
                        )}
                      </div>
                      {u.isSuperadmin ? (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge variant="outline" className="text-xs">Everything</Badge>
                        </div>
                      ) : (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {u.leagues.filter((a) => a.modules.length > 0).length === 0 && (
                            <span className="text-xs text-muted-foreground italic">No league access</span>
                          )}
                          {u.leagues.filter((a) => a.modules.length > 0).map((a) => (
                            <Badge key={a.leagueId} variant="outline" className="text-xs">
                              {leagueName.get(a.leagueId) ?? `League ${a.leagueId}`}
                              {a.club ? ` · ${a.club}` : ""} ·{" "}
                              {a.modules
                                .map((m) => MODULES.find((x) => x.key === m)?.short ?? m)
                                .join(", ")}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost" size="sm" title="Email a set-password link"
                      disabled={inviteUser.isPending}
                      onClick={() => { if (window.confirm(`Email ${u.name} a link to set their password?`)) inviteUser.mutate({ id: u.id }); }}
                    ><MailPlus className="h-4 w-4" /></Button>
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
                  {editor.id === null ? "Temporary password (optional)" : "Reset password (leave blank to keep current)"}
                </label>
                <Input type="text" value={editor.password} onChange={(e) => setEditor({ ...editor, password: e.target.value })} autoComplete="off" />
                {editor.id === null && (
                  <p className="text-xs text-muted-foreground">Leave blank to email them an invite with a set-password link instead.</p>
                )}
              </div>
              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">Superadmin</div>
                  <div className="text-xs text-muted-foreground">Full access to everything, including users</div>
                </div>
                <Switch checked={editor.isSuperadmin} onCheckedChange={(v) => setEditor({ ...editor, isSuperadmin: v })} />
              </div>
              {!editor.isSuperadmin && (
                <div className="space-y-3">
                  <div className="text-xs font-medium text-muted-foreground">League access</div>
                  <p className="text-xs text-muted-foreground">
                    Tick the pages this person can use in each team. Leaving all boxes clear removes their access to that team.
                  </p>
                  {(leagues ?? []).map((l) => {
                    const ticked = new Set(editor.leagueModules[l.id] ?? []);
                    const leagueClubs = (clubs ?? []).filter((c) => c.leagueId === l.id);
                    return (
                      <div key={l.id} className="rounded-md border border-border p-3 space-y-2">
                        <div className="text-sm font-medium">{l.name}</div>
                        {ticked.size > 0 && leagueClubs.length > 0 && (
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-muted-foreground shrink-0">Their club</label>
                            <select
                              className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                              value={editor.leagueClubs[l.id] ?? ""}
                              onChange={(e) => setEditor({ ...editor, leagueClubs: { ...editor.leagueClubs, [l.id]: e.target.value } })}
                            >
                              <option value="">League default{l.focusClub ? ` (${l.focusClub})` : ""}</option>
                              {leagueClubs.map((c) => (
                                <option key={c.id} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                          {MODULES.map((m) => (
                            <label key={m.key} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={ticked.has(m.key)}
                                onCheckedChange={(v) => toggleModule(l.id, m.key, v === true)}
                              />
                              <span>{m.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {editorErr && <p className="text-sm text-chart-4">{editorErr}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor(null)}>Cancel</Button>
            <Button
              onClick={saveEditor}
              disabled={saving || !editor || editor.name.trim().length === 0 || editor.email.trim().length < 3 || (editor.password.length > 0 && editor.password.length < 8)}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
