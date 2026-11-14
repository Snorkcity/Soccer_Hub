import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAuthStatus, useListUsers, getListUsersQueryKey, useCreateUser, useUpdateUser, useDeleteUser, useInviteUser,
  useListLeagues, getListLeaguesQueryKey,
  useGetClubs, getGetClubsQueryKey,
  useSetUserSharedOk,
  useListSeasons, getListSeasonsQueryKey,
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
import { Loader2, Plus, Pencil, Trash2, ShieldCheck, MailPlus, Users as UsersIcon, AlertTriangle, History, ChevronDown, ChevronUp, BadgeCheck } from "lucide-react";

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

// Turn a raw user-agent string into a short human label, e.g. "Chrome · iPhone".
function deviceLabel(ua: string): string {
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\/|Opera/.test(ua) ? "Opera" :
    /SamsungBrowser/.test(ua) ? "Samsung Browser" :
    /Firefox\//.test(ua) ? "Firefox" :
    /CriOS\//.test(ua) ? "Chrome" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Safari\//.test(ua) ? "Safari" :
    "Unknown browser";
  const os =
    /iPhone/.test(ua) ? "iPhone" :
    /iPad/.test(ua) ? "iPad" :
    /Android/.test(ua) ? "Android" :
    /Windows/.test(ua) ? "Windows" :
    /Mac OS X|Macintosh/.test(ua) ? "Mac" :
    /Linux/.test(ua) ? "Linux" :
    "unknown device";
  return `${browser} · ${os}`;
}

// Null/omitted = legacy all seasons (including future); a map = explicit years only.
type SeasonModules = Record<string, string[]>;
type LeagueAccessWithSeasons = LeagueAccess;
type LeagueMode = "all" | "specific";
const shortModules = (mods: string[]) => mods.map((m) => MODULES.find((x) => x.key === m)?.short ?? m).join(", ");

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
  // leagueId → whether access covers all seasons (legacy) or explicit campaigns
  leagueMode: Record<number, LeagueMode>;
  // leagueId → year → ticked module keys (used when mode is "specific")
  leagueSeasons: Record<number, SeasonModules>;
}

export default function Users() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: auth } = useGetAuthStatus();
  const isSuperadmin = auth?.authenticated === true && auth.user?.isSuperadmin === true;

  const { data: users, isLoading } = useListUsers({ query: { enabled: isSuperadmin, queryKey: getListUsersQueryKey() } });
  const { data: leagues } = useListLeagues({ query: { queryKey: getListLeaguesQueryKey() } });
  const { data: clubs } = useGetClubs({ query: { queryKey: getGetClubsQueryKey() } });

  const seasonsQuery = useListSeasons({ query: { queryKey: getListSeasonsQueryKey() } });
  const seasons = seasonsQuery.data;
  const seasonsBlocked = seasonsQuery.isLoading || seasonsQuery.isError;
  const seasonsByLeague = useMemo(() => {
    const m = new Map<number, { year: string; label: string; isActive: boolean }[]>();
    for (const s of seasons ?? []) {
      const list = m.get(s.leagueId) ?? [];
      list.push({ year: String(s.year), label: `${s.leagueName} — ${s.year}`, isActive: !!s.isActive });
      m.set(s.leagueId, list);
    }
    for (const list of m.values()) list.sort((a, b) => b.year.localeCompare(a.year));
    return m;
  }, [seasons]);
  const [search, setSearch] = useState("");
  const leagueName = useMemo(() => new Map((leagues ?? []).map(l => [l.id, l.name])), [leagues]);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorErr, setEditorErr] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState<Set<number>>(new Set()); // user ids with the activity list expanded

  function toggleActivity(id: number) {
    setActivityOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

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
  const setSharedOk = useSetUserSharedOk({ mutation: {
    onSuccess: (_data, vars) => {
      refresh();
      toast({ description: vars.data.sharedOk
        ? "Marked as expected — no more alert emails about this account"
        : "Unmarked — alert emails can flag this account again" });
    },
    onError: (e) => toast({ description: errMsg(e), variant: "destructive" }),
  }});


  function openCreate() {
    setEditorErr(null);
    setEditor({ id: null, name: "", email: "", password: "", isSuperadmin: false, leagueModules: {}, leagueClubs: {}, leagueMode: {}, leagueSeasons: {} });
    setSearch("");
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
    const leagueMode: Record<number, LeagueMode> = {};
    const leagueSeasons: Record<number, SeasonModules> = {};
    for (const a of u.leagues as LeagueAccessWithSeasons[]) {
      leagueModules[a.leagueId] = [...a.modules];
      leagueClubs[a.leagueId] = a.club ?? "";
      if (a.seasonModules) {
        leagueMode[a.leagueId] = "specific";
        leagueSeasons[a.leagueId] = Object.fromEntries(Object.entries(a.seasonModules).map(([y, m]) => [y, [...m]]));
      } else if (a.modules.length > 0) {
        leagueMode[a.leagueId] = "all";
      }
    }
    setSearch("");
    setEditor({ id: u.id, name: u.name, email: u.email, password: "", isSuperadmin: u.isSuperadmin, leagueModules, leagueClubs, leagueMode, leagueSeasons });
  }
  function toggleModule(leagueId: number, module: string, on: boolean) {
    setEditor((prev) => {
      if (!prev) return prev;
      const current = new Set(prev.leagueModules[leagueId] ?? []);
      if (on) current.add(module); else current.delete(module);
      return { ...prev, leagueModules: { ...prev.leagueModules, [leagueId]: [...current] } };
    });
  }
  function setMode(leagueId: number, mode: LeagueMode) {
    setEditor((prev) => {
      if (!prev) return prev;
      const leagueSeasons = { ...prev.leagueSeasons };
      if (mode === "specific" && !leagueSeasons[leagueId]) {
        // Keep existing pages for currently listed campaigns only; future years are never implied.
        const old = prev.leagueModules[leagueId] ?? [];
        leagueSeasons[leagueId] = Object.fromEntries((seasonsByLeague.get(leagueId) ?? []).map((s) => [s.year, [...old]]));
      }
      return { ...prev, leagueMode: { ...prev.leagueMode, [leagueId]: mode }, leagueSeasons };
    });
  }
  function toggleSeasonModule(leagueId: number, year: string, module: string, on: boolean) {
    setEditor((prev) => {
      if (!prev) return prev;
      const map = { ...(prev.leagueSeasons[leagueId] ?? {}) };
      const cur = new Set(map[year] ?? []);
      if (on) cur.add(module); else cur.delete(module);
      map[year] = [...cur];
      return { ...prev, leagueSeasons: { ...prev.leagueSeasons, [leagueId]: map } };
    });
  }
  function saveEditor() {
    if (!editor) return;
    setEditorErr(null);
    // A league with zero ticked modules is omitted entirely. `role` stays required
    // in requests and is derived from the ticked modules.
    // Built from full editor state, never from the filtered view, so hidden grants survive.
    if (seasonsBlocked && !editor.isSuperadmin) return;
    const ids = new Set([...Object.keys(editor.leagueModules), ...Object.keys(editor.leagueSeasons)].map(Number));
    const leagueAccess: LeagueAccessWithSeasons[] = [];
    for (const leagueId of ids) {
      const club = editor.leagueClubs[leagueId] || null;
      if ((editor.leagueMode[leagueId] ?? "specific") === "all") {
        const modules = editor.leagueModules[leagueId] ?? [];
        if (modules.length) leagueAccess.push({ leagueId, role: roleForModules(modules), modules, club, seasonModules: null });
      } else {
        const seasonModules = Object.fromEntries(Object.entries(editor.leagueSeasons[leagueId] ?? {}).filter(([, m]) => m.length > 0));
        const modules = [...new Set(Object.values(seasonModules).flat())];
        if (modules.length) leagueAccess.push({ leagueId, role: roleForModules(modules), modules, club, seasonModules });
      }
    }
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
                        {u.possiblyShared && !u.sharedOk && (
                          <Badge variant="destructive" className="gap-1" title="Seen from more than one device or location within a few hours — this login may be shared.">
                            <AlertTriangle className="h-3 w-3" />Possibly shared
                          </Badge>
                        )}
                        {u.sharedOk && (
                          <Badge variant="outline" className="gap-1 text-muted-foreground" title="An admin marked this account's multi-device use as expected — it won't trigger alert emails.">
                            <BadgeCheck className="h-3 w-3" />Shared use expected
                          </Badge>
                        )}
                        {(u.possiblyShared || u.sharedOk) && (
                          <button
                            type="button"
                            className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
                            disabled={setSharedOk.isPending}
                            onClick={() => setSharedOk.mutate({ id: u.id, data: { sharedOk: !u.sharedOk } })}
                          >
                            {u.sharedOk ? "Undo" : "That's fine"}
                          </button>
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
                          {(u.leagues as LeagueAccessWithSeasons[]).filter((a) => a.modules.length > 0).map((a) => {
                            const name = leagueName.get(a.leagueId) ?? `League ${a.leagueId}`;
                            const club = a.club ? ` · ${a.club}` : "";
                            if (!a.seasonModules) return (
                              <Badge key={a.leagueId} variant="outline" className="text-xs" data-testid={`badge-access-${u.id}-${a.leagueId}-all`}>
                                {name}{club} · All seasons · {shortModules(a.modules)}
                              </Badge>
                            );
                            return Object.entries(a.seasonModules).filter(([, m]) => m.length > 0).sort(([x], [y]) => y.localeCompare(x)).map(([year, m]) => (
                              <Badge key={`${a.leagueId}-${year}`} variant="outline" className="text-xs" data-testid={`badge-access-${u.id}-${a.leagueId}-${year}`}>
                                {name} — {year}{club} · {shortModules(m)}
                              </Badge>
                            ));
                          })}
                        </div>
                      )}
                      {(u.recentActivity?.length ?? 0) > 0 && (
                        <div className="mt-1.5">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => toggleActivity(u.id)}
                          >
                            <History className="h-3 w-3" />
                            Recent activity ({u.recentActivity!.length}
                            {new Set(u.recentActivity!.map((a) => a.device)).size > 1
                              ? `, ${new Set(u.recentActivity!.map((a) => a.device)).size} devices`
                              : ""})
                            {activityOpen.has(u.id) ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                          {activityOpen.has(u.id) && (
                            <div className="mt-1.5 rounded-md border border-border bg-muted/30 px-3 py-2 space-y-1">
                              <p className="text-[11px] text-muted-foreground">Last 14 days — at most one entry per device per hour.</p>
                              {u.recentActivity!.map((a, i) => (
                                <div key={i} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                                  <span className="tabular-nums text-muted-foreground">{formatLastLogin(a.seenAt)}</span>
                                  <span className="font-medium">{deviceLabel(a.userAgent)}</span>
                                  <span className="text-muted-foreground cursor-default" title={`IP ${a.ip}`}>
                                    {a.location ? `— ${a.location}` : `from ${a.ip}`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost" size="sm" title="Email a set-password link"
                      disabled={inviteUser.isPending}
                      onClick={() => { if (window.confirm(`Email ${u.name} a link to set their password?`)) inviteUser.mutate({ id: u.id }); }}
                    ><MailPlus className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" aria-label={`Edit ${u.name}`} data-testid={`button-edit-user-${u.id}`} onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button>
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
        <DialogContent className="sm:max-w-2xl max-h-[90dvh] overflow-y-auto">
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
                    Choose All seasons (includes future campaigns) or Specific seasons, then tick pages per campaign. No ticks removes access to that competition.
                  </p>
                  <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" data-testid="text-season-scope-caveat">
                    Scope caveat: older reports and journals not tagged with a campaign cannot be shown to season-limited accounts. The server never guesses a campaign from a calendar date.
                  </p>
                  {seasonsQuery.isLoading && <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="status-seasons-loading"><Loader2 className="h-3 w-3 animate-spin" />Loading campaigns; saving is paused so no grants are lost.</p>}
                  {seasonsQuery.isError && (
                    <p className="text-xs text-chart-4" data-testid="status-seasons-error">
                      Could not load campaigns; saving is disabled so existing grants are not wiped.{" "}
                      <button type="button" className="underline" onClick={() => void seasonsQuery.refetch()} data-testid="button-retry-seasons">Retry</button>
                    </p>
                  )}
                  <div className="space-y-1">
                    <label htmlFor="input-league-search" className="text-xs text-muted-foreground">Find competition or year</label>
                    <Input id="input-league-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. NPLM or 2027" data-testid="input-league-search" />
                    {search && <p className="text-[11px] text-muted-foreground">Filtering the list only. Hidden grants are still saved unchanged.</p>}
                  </div>
                  {(leagues ?? []).filter((l) => {
                    const q = search.trim().toLowerCase();
                    if (!q) return true;
                    return l.name.toLowerCase().includes(q) || (seasonsByLeague.get(l.id) ?? []).some((x) => x.label.toLowerCase().includes(q));
                  }).map((l) => {
                    const mode: LeagueMode = editor.leagueMode[l.id] ?? "specific";
                    const ticked = new Set(editor.leagueModules[l.id] ?? []);
                    const map = editor.leagueSeasons[l.id] ?? {};
                    const listed = seasonsByLeague.get(l.id) ?? [];
                    const unlisted = Object.keys(map).filter((y) => (map[y]?.length ?? 0) > 0 && !listed.some((x) => x.year === y));
                    const hasAny = mode === "all" ? ticked.size > 0 : Object.values(map).some((m) => m.length > 0);
                    const leagueClubs = (clubs ?? []).filter((c) => c.leagueId === l.id);
                    return (
                      <fieldset key={l.id} className="rounded-md border border-border p-3 space-y-2" data-testid={`fieldset-league-${l.id}`}>
                        <legend className="px-1 text-sm font-medium">{l.name}</legend>
                        <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label={`${l.name} season scope`}>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" name={`mode-${l.id}`} checked={mode === "all"} onChange={() => setMode(l.id, "all")} data-testid={`radio-league-${l.id}-all`} />
                            All seasons <span className="text-xs text-muted-foreground">(includes future)</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" name={`mode-${l.id}`} checked={mode === "specific"} onChange={() => setMode(l.id, "specific")} data-testid={`radio-league-${l.id}-specific`} />
                            Specific seasons
                          </label>
                        </div>
                        {hasAny && leagueClubs.length > 0 && (
                          <div className="flex items-center gap-2">
                            <label htmlFor={`club-${l.id}`} className="text-xs text-muted-foreground shrink-0">Their club</label>
                            <select
                              id={`club-${l.id}`}
                              className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                              value={editor.leagueClubs[l.id] ?? ""}
                              onChange={(e) => setEditor({ ...editor, leagueClubs: { ...editor.leagueClubs, [l.id]: e.target.value } })}
                              data-testid={`select-league-club-${l.id}`}
                            >
                              <option value="">League default{l.focusClub ? ` (${l.focusClub})` : ""}</option>
                              {leagueClubs.map((c) => (
                                <option key={c.id} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        {mode === "all" ? (
                          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                            {MODULES.map((m) => (
                              <label key={m.key} className="flex items-center gap-2 text-sm cursor-pointer">
                                <Checkbox checked={ticked.has(m.key)} onCheckedChange={(v) => toggleModule(l.id, m.key, v === true)}
                                  data-testid={`checkbox-league-${l.id}-all-${m.key}`} />
                                <span>{m.label}</span>
                              </label>
                            ))}
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {listed.length === 0 && unlisted.length === 0 && <p className="text-xs italic text-muted-foreground">{seasonsBlocked ? "Campaigns unavailable." : "No campaigns set up for this competition yet."}</p>}
                            {[...listed, ...unlisted.map((y) => ({ year: y, label: `${l.name} — ${y} (not in season list)`, isActive: false }))].map((season) => {
                              const set = new Set(map[season.year] ?? []);
                              return (
                                <fieldset key={season.year} className="rounded border border-border/70 bg-muted/20 p-2" data-testid={`fieldset-season-${l.id}-${season.year}`}>
                                  <legend className="px-1 text-xs font-semibold">{season.label}{season.isActive ? " · active" : ""}</legend>
                                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                                    {MODULES.map((m) => (
                                      <label key={m.key} className="flex items-center gap-2 text-sm cursor-pointer">
                                        <Checkbox checked={set.has(m.key)} disabled={seasonsBlocked}
                                          aria-label={`${season.label}: ${m.label}`}
                                          onCheckedChange={(v) => toggleSeasonModule(l.id, season.year, m.key, v === true)}
                                          data-testid={`checkbox-season-${l.id}-${season.year}-${m.key}`} />
                                        <span>{m.label}</span>
                                      </label>
                                    ))}
                                  </div>
                                </fieldset>
                              );
                            })}
                          </div>
                        )}
                      </fieldset>
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
              data-testid="button-save-user"
              disabled={saving || (!!editor && !editor.isSuperadmin && seasonsBlocked) || !editor || editor.name.trim().length === 0 || editor.email.trim().length < 3 || (editor.password.length > 0 && editor.password.length < 8)}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
