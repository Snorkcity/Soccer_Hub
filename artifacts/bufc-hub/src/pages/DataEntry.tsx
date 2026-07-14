import React, { useState, useMemo, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTeams,
  useListSeasons,
  useGetClubs,
  useGetAuthStatus,
  getGetAuthStatusQueryKey,
  useLogout,
  useListLeagueMatches,
  getListLeagueMatchesQueryKey,
  useGetGoalOptions,
  getGetGoalOptionsQueryKey,
  useCreateEntryMatch,
  useCreateEntryGoal,
  useGetGoalTally,
  getGetGoalTallyQueryKey,
  useListEntryGoals,
  getListEntryGoalsQueryKey,
  useDeleteEntryGoal,
  useGetPlayerTally,
  getGetPlayerTallyQueryKey,
  useSaveEntryPlayerStats,
  useExtractPlayersFromImage,
  useListLeagues,
  useCreateLeague,
  useCreateSeason,
  useCreateClub,
  getListLeaguesQueryKey,
  getListSeasonsQueryKey,
  getGetClubsQueryKey,
  type LeagueMatchInfo,
  type GoalOptionsResponse,
  type EntryPlayerRow,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lock, LogOut, CheckCircle2, AlertTriangle, Trash2, Plus, Upload, Loader2, ScanText, X } from "lucide-react";

const FOCUS_CLUB = "Belconnen";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function errMsg(e: unknown): string {
  const anyE = e as { data?: { error?: string }; error?: string; message?: string } | undefined;
  return anyE?.data?.error ?? anyE?.error ?? anyE?.message ?? "Something went wrong";
}

/** "2026-07-14" (date input) → "2026/07/14" (DB format) */
function toDbDate(isoDate: string): string {
  return isoDate.replaceAll("-", "/");
}

function clubCode(name: string): string {
  return name.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
}

function StatusLine({ ok, err }: { ok: string | null; err: string | null }) {
  if (!ok && !err) return null;
  return ok ? (
    <div className="flex items-center gap-2 text-sm text-chart-3"><CheckCircle2 className="h-4 w-4 shrink-0" />{ok}</div>
  ) : (
    <div className="flex items-center gap-2 text-sm text-chart-4"><AlertTriangle className="h-4 w-4 shrink-0" />{err}</div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** Free-text input with suggestions from existing data (keeps spellings consistent, allows new values). */
function VocabInput({ label, value, onChange, options, listId, placeholder, className }: {
  label: string; value: string; onChange: (v: string) => void;
  options: string[]; listId: string; placeholder?: string; className?: string;
}) {
  return (
    <Field label={label} className={className}>
      <Input list={listId} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      <datalist id={listId}>{options.map(o => <option key={o} value={o} />)}</datalist>
    </Field>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Match form
// ─────────────────────────────────────────────────────────────────────────────

function MatchForm({ teamId, seasonId, clubs, options, onSaved }: {
  teamId: number; seasonId: number; clubs: string[]; options: GoalOptionsResponse | undefined; onSaved: () => void;
}) {
  const [matchDate, setMatchDate] = useState("");
  const [homeTeam, setHomeTeam] = useState("");
  const [awayTeam, setAwayTeam] = useState("");
  const [round, setRound] = useState("");
  const [matchId, setMatchId] = useState("");
  const [matchIdEdited, setMatchIdEdited] = useState(false);
  const [homeGoals, setHomeGoals] = useState("");
  const [awayGoals, setAwayGoals] = useState("");
  // Belconnen-only details
  const [venue, setVenue] = useState("");
  const [halfScore, setHalfScore] = useState("");
  const [conditions, setConditions] = useState("");
  const [formation, setFormation] = useState("");
  const [oppFormation, setOppFormation] = useState("");
  const [possession, setPossession] = useState("");
  const [shots, setShots] = useState("");
  const [passes, setPasses] = useState("");
  const [oppShots, setOppShots] = useState("");
  const [oppPasses, setOppPasses] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const isBelconnen = homeTeam === FOCUS_CLUB || awayTeam === FOCUS_CLUB;

  // Auto-build the Match ID from round + clubs unless the coach typed their own
  useEffect(() => {
    if (matchIdEdited) return;
    if (homeTeam && awayTeam) {
      setMatchId(`${round ? `R${round}` : "R?"}-${clubCode(homeTeam)}-${clubCode(awayTeam)}`);
    }
  }, [round, homeTeam, awayTeam, matchIdEdited]);

  const create = useCreateEntryMatch({ mutation: {
    onSuccess: (res) => {
      setOk(`Saved ${matchId} (${res.fullScore})${res.belconnenMatchId != null ? " — Belconnen match row created too" : ""}`);
      onSaved();
      // Reset the whole form back to its default look, ready for the next match
      setMatchDate(""); setHomeTeam(""); setAwayTeam("");
      setHomeGoals(""); setAwayGoals(""); setHalfScore(""); setRound("");
      setMatchId(""); setMatchIdEdited(false);
      setVenue(""); setConditions(""); setFormation(""); setOppFormation("");
      setPossession(""); setShots(""); setPasses(""); setOppShots(""); setOppPasses("");
    },
    onError: (e) => setErr(errMsg(e)),
  }});

  const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));
  const canSave = matchDate && homeTeam && awayTeam && homeTeam !== awayTeam
    && matchId.trim() && homeGoals.trim() !== "" && awayGoals.trim() !== "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a match</CardTitle>
        <CardDescription>
          Every fixture in the league goes here — it feeds the ladder and opponent charts.
          When Belconnen is playing, the extra section saves your Veo team stats too.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Date">
            <Input type="date" value={matchDate} onChange={e => setMatchDate(e.target.value)} />
          </Field>
          <Field label="Round">
            <Input type="number" min={1} value={round} onChange={e => setRound(e.target.value)} placeholder="e.g. 14" />
          </Field>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
          <Field label="Home team">
            <Select value={homeTeam} onValueChange={setHomeTeam}>
              <SelectTrigger><SelectValue placeholder="Club" /></SelectTrigger>
              <SelectContent>{clubs.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Home goals">
            <Input type="number" min={0} value={homeGoals} onChange={e => setHomeGoals(e.target.value)} />
          </Field>
          <Field label="Away team">
            <Select value={awayTeam} onValueChange={setAwayTeam}>
              <SelectTrigger><SelectValue placeholder="Club" /></SelectTrigger>
              <SelectContent>{clubs.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Away goals">
            <Input type="number" min={0} value={awayGoals} onChange={e => setAwayGoals(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Match ID (fills in automatically)" className="col-span-2">
            <Input value={matchId} onChange={e => { setMatchId(e.target.value); setMatchIdEdited(true); }} placeholder="R14-MAJ-CRO" />
          </Field>
          <Field label="Half-time score">
            <Input value={halfScore} onChange={e => setHalfScore(e.target.value)} placeholder="e.g. 1-0" />
          </Field>
        </div>

        {isBelconnen && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
            <p className="text-sm font-medium">Belconnen match details <span className="text-muted-foreground font-normal">(all optional — add Veo numbers later if you like)</span></p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <VocabInput label="Venue" value={venue} onChange={setVenue} options={options?.venues ?? []} listId="dl-venues" />
              <VocabInput label="Conditions" value={conditions} onChange={setConditions} options={options?.conditions ?? []} listId="dl-conditions" />
              <VocabInput label="Our formation" value={formation} onChange={setFormation} options={options?.formations ?? []} listId="dl-formations" />
              <VocabInput label="Their formation" value={oppFormation} onChange={setOppFormation} options={options?.formations ?? []} listId="dl-formations2" />
              <Field label="Possession %">
                <Input type="number" min={0} max={100} step="0.1" value={possession} onChange={e => setPossession(e.target.value)} />
              </Field>
              <Field label="Our shots">
                <Input type="number" min={0} value={shots} onChange={e => setShots(e.target.value)} />
              </Field>
              <Field label="Our passes">
                <Input type="number" min={0} value={passes} onChange={e => setPasses(e.target.value)} />
              </Field>
              <Field label="Their shots">
                <Input type="number" min={0} value={oppShots} onChange={e => setOppShots(e.target.value)} />
              </Field>
              <Field label="Their passes">
                <Input type="number" min={0} value={oppPasses} onChange={e => setOppPasses(e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            disabled={!canSave || create.isPending}
            onClick={() => {
              setOk(null); setErr(null);
              create.mutate({ data: {
                teamId, seasonId,
                matchId: matchId.trim(),
                matchDate: toDbDate(matchDate),
                homeTeam, awayTeam,
                homeGoals: Number(homeGoals), awayGoals: Number(awayGoals),
                halfScore: halfScore.trim() || null,
                ...(isBelconnen ? {
                  venue: venue.trim() || null,
                  conditions: conditions.trim() || null,
                  formation: formation.trim() || null,
                  oppFormation: oppFormation.trim() || null,
                  possession: num(possession),
                  shots: num(shots), passes: num(passes),
                  oppShots: num(oppShots), oppPasses: num(oppPasses),
                } : {}),
              }});
            }}
          >
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save match"}
          </Button>
          <StatusLine ok={ok} err={err} />
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Goal-mouth / pitch-map picker (goalX 0–100 across the pitch width, posts at
// 45/55; goalY = yards out from the goal line, goal at the top — matches the
// Goal Map chart's coordinate system)
// ─────────────────────────────────────────────────────────────────────────────

function GoalSpotPicker({ goalX, goalY, onPick }: {
  goalX: number | null; goalY: number | null; onPick: (x: number, y: number) => void;
}) {
  const DEPTH = 35;        // yards of pitch shown from the goal line
  const YARDS_ACROSS = 70; // standard pitch width — keeps the boxes true to life
  const W = 320, H = (DEPTH / YARDS_ACROSS) * W;
  const sx = (x: number) => (x / 100) * W;                  // 0–100 across → px
  const sy = (y: number) => (y / DEPTH) * H;                // yards out → px
  const yd = (yards: number) => (yards / YARDS_ACROSS) * W; // real yards → px

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        Where from? Click the pitch (goal at the top){goalX != null && goalY != null ? ` — across ${goalX}, ${goalY} out` : ""}
      </Label>
      <svg
        viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[380px] rounded-md border bg-chart-3/5 cursor-crosshair select-none"
        onClick={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * DEPTH;
          onPick(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
        }}
      >
        {/* goal line + goal mouth (posts at 45/55 — matches the goal-map data) */}
        <line x1={0} y1={1} x2={W} y2={1} stroke="currentColor" strokeOpacity={0.5} strokeWidth={2} />
        <rect x={sx(45)} y={0} width={sx(10)} height={4} fill="currentColor" fillOpacity={0.65} />
        {/* 6-yard box: 20yd wide, 6yd deep */}
        <rect x={W / 2 - yd(10)} y={0} width={yd(20)} height={sy(6)} fill="none" stroke="currentColor" strokeOpacity={0.35} />
        {/* 18-yard box: 44yd wide, 18yd deep */}
        <rect x={W / 2 - yd(22)} y={0} width={yd(44)} height={sy(18)} fill="none" stroke="currentColor" strokeOpacity={0.35} />
        {/* penalty spot (12yd) + arc (10yd radius from the spot) */}
        <circle cx={W / 2} cy={sy(12)} r={2} fill="currentColor" fillOpacity={0.45} />
        <path
          d={`M ${W / 2 - yd(8)} ${sy(18)} A ${yd(10)} ${yd(10)} 0 0 0 ${W / 2 + yd(8)} ${sy(18)}`}
          fill="none" stroke="currentColor" strokeOpacity={0.35}
        />
        {/* depth guides — plain numbers (yards out from the goal line) */}
        {[10, 20, 30].map(y => (
          <g key={y}>
            <line x1={0} y1={sy(y)} x2={W} y2={sy(y)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={4} y={sy(y) - 3} fontSize={8} fill="currentColor" fillOpacity={0.4}>{y}</text>
          </g>
        ))}
        {goalX != null && goalY != null && (
          <g>
            <circle cx={sx(goalX)} cy={sy(Math.min(goalY, DEPTH))} r={6} fill="hsl(var(--primary))" fillOpacity={0.9} />
            <circle cx={sx(goalX)} cy={sy(Math.min(goalY, DEPTH))} r={10} fill="none" stroke="hsl(var(--primary))" strokeOpacity={0.4} />
          </g>
        )}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Goal form
// ─────────────────────────────────────────────────────────────────────────────

function GoalForm({ teamId, seasonId, fixtures, options }: {
  teamId: number; seasonId: number; fixtures: LeagueMatchInfo[]; options: GoalOptionsResponse | undefined;
}) {
  const [matchId, setMatchId] = useState("");
  const [scorerTeam, setScorerTeam] = useState("");
  const [minute, setMinute] = useState("");
  const [scorer, setScorer] = useState("");
  const [assist, setAssist] = useState("");
  const [goalType, setGoalType] = useState("");
  const [assistType, setAssistType] = useState("");
  const [howPenetrated, setHowPenetrated] = useState("");
  const [buildupLane, setBuildupLane] = useState("");
  const [finishType, setFinishType] = useState("");
  const [firstTime, setFirstTime] = useState(false);
  const [passString, setPassString] = useState("");
  const [goalX, setGoalX] = useState<number | null>(null);
  const [goalY, setGoalY] = useState<number | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fixture = fixtures.find(f => f.matchId === matchId);
  useEffect(() => { setScorerTeam(""); }, [matchId]);

  const queryClient = useQueryClient();
  const { data: tally } = useGetGoalTally(
    { seasonId, matchId },
    { query: { enabled: !!matchId, queryKey: getGetGoalTallyQueryKey({ seasonId, matchId }) } },
  );

  const { data: loggedGoals } = useListEntryGoals(
    { seasonId, matchId },
    { query: { enabled: !!matchId, queryKey: getListEntryGoalsQueryKey({ seasonId, matchId }) } },
  );

  // Prefix invalidation (no params) so caches for EVERY fixture refresh — safe even
  // if the coach switches match while a save/delete is still in flight
  const invalidateGoalQueries = () => {
    void queryClient.invalidateQueries({ queryKey: getGetGoalTallyQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListEntryGoalsQueryKey() });
  };

  const removeGoal = useDeleteEntryGoal({ mutation: {
    onSuccess: () => { invalidateGoalQueries(); setOk("Goal removed"); },
    onError: (e) => setErr(errMsg(e)),
  }});

  const create = useCreateEntryGoal({ mutation: {
    onSuccess: (res) => {
      invalidateGoalQueries();
      setOk(`Goal saved${res.belconnenGoalId != null ? " (Belconnen copy written too)" : ""} — ready for the next one`);
      // keep match + scorer team selected for rapid entry; clear the goal detail
      setMinute(""); setScorer(""); setAssist(""); setGoalType(""); setAssistType("");
      setHowPenetrated(""); setBuildupLane(""); setFinishType(""); setFirstTime(false);
      setPassString(""); setGoalX(null); setGoalY(null);
    },
    onError: (e) => setErr(errMsg(e)),
  }});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log goals</CardTitle>
        <CardDescription>
          One save per goal. Record the match first — then log each goal against it.
          Dropdowns suggest the wordings you've already used so the charts stay tidy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Match" className="md:col-span-2">
            <Select value={matchId} onValueChange={setMatchId}>
              <SelectTrigger><SelectValue placeholder="Pick a fixture" /></SelectTrigger>
              <SelectContent>
                {fixtures.map(f => (
                  <SelectItem key={f.matchId} value={f.matchId}>
                    {f.matchId} — {f.homeTeam} {f.fullScore ?? ""} {f.awayTeam}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Who scored it?">
            <Select value={scorerTeam} onValueChange={setScorerTeam} disabled={!fixture}>
              <SelectTrigger><SelectValue placeholder="Team" /></SelectTrigger>
              <SelectContent>
                {fixture && [fixture.homeTeam, fixture.awayTeam].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {tally && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {[
              { team: tally.homeTeam, logged: tally.homeLogged, expected: tally.homeExpected },
              { team: tally.awayTeam, logged: tally.awayLogged, expected: tally.awayExpected },
            ].map(({ team, logged, expected }) => {
              const done = expected != null && logged >= expected;
              const over = expected != null && logged > expected;
              return (
                <Badge key={team} variant="outline" className={over ? "border-chart-4 text-chart-4" : done ? "border-chart-3 text-chart-3" : "text-muted-foreground"}>
                  {done && !over && <CheckCircle2 className="h-3 w-3 mr-1" />}
                  {over && <AlertTriangle className="h-3 w-3 mr-1" />}
                  {team}: {logged} of {expected ?? "?"} logged{over ? " — too many!" : ""}
                </Badge>
              );
            })}
          </div>
        )}

        {loggedGoals && loggedGoals.goals.length > 0 && (
          <div className="rounded-md border border-border/60 divide-y divide-border/40">
            <p className="px-3 py-2 text-xs font-medium text-muted-foreground">Goals logged so far — bin one to fix a mistake, then re-enter it</p>
            {loggedGoals.goals.map(g => (
              <div key={g.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="w-10 text-muted-foreground">{g.minuteScored != null ? `${g.minuteScored}'` : "—"}</span>
                <span className="font-medium">{g.scorer ?? "Unknown"}</span>
                <span className="text-muted-foreground">({g.scorerTeam ?? "?"})</span>
                {g.assist && <span className="text-xs text-muted-foreground">assist: {g.assist}</span>}
                {g.goalType && <Badge variant="outline" className="text-xs">{g.goalType}</Badge>}
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 ml-auto text-muted-foreground"
                  disabled={removeGoal.isPending}
                  onClick={() => { setOk(null); setErr(null); removeGoal.mutate({ goalId: g.id }); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Minute">
            <Input type="number" min={0} max={130} value={minute} onChange={e => setMinute(e.target.value)} />
          </Field>
          <Field label="Scorer">
            <Input value={scorer} onChange={e => setScorer(e.target.value)} placeholder="J.Bloggs (or Own Goal)" />
          </Field>
          <Field label="Assist">
            <Input value={assist} onChange={e => setAssist(e.target.value)} placeholder="Blank if none" />
          </Field>
          <VocabInput label="Goal type" value={goalType} onChange={setGoalType} options={options?.goalTypes ?? []} listId="dl-goaltypes" placeholder="R-MT-AT / SP-C…" />
          <VocabInput label="Assist type" value={assistType} onChange={setAssistType} options={options?.assistTypes ?? []} listId="dl-assisttypes" />
          <VocabInput label="How penetrated" value={howPenetrated} onChange={setHowPenetrated} options={options?.howPenetrated ?? []} listId="dl-howpen" placeholder="Through / Around / Over" />
          <VocabInput label="Buildup lane" value={buildupLane} onChange={setBuildupLane} options={options?.buildupLanes ?? []} listId="dl-lanes" placeholder="Left / Centre / Right" />
          <VocabInput label="Finish" value={finishType} onChange={setFinishType} options={options?.finishTypes ?? []} listId="dl-finish" placeholder="Right Foot / Head…" />
          <Field label="Pass string (passes in buildup)">
            <Input type="number" min={0} value={passString} onChange={e => setPassString(e.target.value)} />
          </Field>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={firstTime} onCheckedChange={v => setFirstTime(v === true)} />
              First-time finish
            </label>
          </div>
        </div>

        <GoalSpotPicker goalX={goalX} goalY={goalY} onPick={(x, y) => { setGoalX(x); setGoalY(y); }} />

        <div className="flex items-center gap-3">
          <Button
            disabled={!fixture || !scorerTeam || create.isPending}
            onClick={() => {
              setOk(null); setErr(null);
              create.mutate({ data: {
                teamId, seasonId, matchId, scorerTeam,
                minuteScored: minute.trim() === "" ? null : Number(minute),
                scorer: scorer.trim() || null,
                assist: assist.trim() || null,
                goalType: goalType.trim() || null,
                assistType: assistType.trim() || null,
                howPenetrated: howPenetrated.trim() || null,
                buildupLane: buildupLane.trim() || null,
                firstTimeFinish: firstTime,
                finishType: finishType.trim() || null,
                passString: passString.trim() || null,
                goalX, goalY,
              }});
            }}
          >
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save goal"}
          </Button>
          <StatusLine ok={ok} err={err} />
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Player stats form (screenshot reader + editable review table)
// ─────────────────────────────────────────────────────────────────────────────

type EditableRow = EntryPlayerRow;

const POSITIONS = ["GK", "LB", "RB", "CB", "LWB", "RWB", "DM", "CM", "AM", "LM", "RM", "LW", "RW", "ST", "F"] as const;

function PlayersForm({ teamId, seasonId, fixtures }: {
  teamId: number; seasonId: number; fixtures: LeagueMatchInfo[];
}) {
  const [matchId, setMatchId] = useState("");
  const [club, setClub] = useState("");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fixture = fixtures.find(f => f.matchId === matchId);
  useEffect(() => { setClub(""); setRows([]); setWarnings([]); setOk(null); setErr(null); }, [matchId]);

  const queryClient = useQueryClient();
  const { data: playerTally } = useGetPlayerTally(
    { seasonId, matchId },
    { query: { enabled: !!matchId, queryKey: getGetPlayerTallyQueryKey({ seasonId, matchId }) } },
  );

  const extract = useExtractPlayersFromImage({ mutation: {
    onSuccess: (res) => {
      setRows(res.rows);
      setWarnings(res.warnings);
      setOk(`Read ${res.rows.length} players — check the table, fix anything, then save`);
    },
    onError: (e) => setErr(errMsg(e)),
  }});

  const save = useSaveEntryPlayerStats({ mutation: {
    onSuccess: (res) => {
      setOk(`Saved ${res.saved} players${res.replaced > 0 ? ` (replaced ${res.replaced} previous rows)` : ""}${res.belconnenCopies > 0 ? ` — mirrored into Belconnen tables` : ""}`);
      // Prefix invalidation so every fixture's tally refreshes, even mid-flight
      void queryClient.invalidateQueries({ queryKey: getGetPlayerTallyQueryKey() });
      // Reset back to the default look, ready for the next team sheet
      setRows([]); setWarnings([]); setClub("");
    },
    onError: (e) => setErr(errMsg(e)),
  }});

  const update = (i: number, patch: Partial<EditableRow>) =>
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const onFile = (file: File) => {
    setOk(null); setErr(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      extract.mutate({ data: { imageBase64: dataUrl, club: club || null } });
    };
    reader.readAsDataURL(file);
  };

  // Paste a screenshot straight from the clipboard (Ctrl/Cmd+V anywhere on the page)
  const canPaste = Boolean(fixture && club) && !extract.isPending;
  useEffect(() => {
    if (!canPaste) return;
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const item = Array.from(e.clipboardData?.items ?? []).find(it => it.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) { e.preventDefault(); onFile(file); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPaste, club]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Player stats</CardTitle>
        <CardDescription>
          Pick the match and team, then upload a Dribl screenshot — the reader fills the
          table for you to check before saving. You can also add rows by hand.
          Re-saving the same match + team replaces the old rows, so fixing a mistake is safe.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Match" className="md:col-span-2">
            <Select value={matchId} onValueChange={setMatchId}>
              <SelectTrigger><SelectValue placeholder="Pick a fixture" /></SelectTrigger>
              <SelectContent>
                {fixtures.map(f => (
                  <SelectItem key={f.matchId} value={f.matchId}>
                    {f.matchId} — {f.homeTeam} {f.fullScore ?? ""} {f.awayTeam}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Which team's players?">
            <Select value={club} onValueChange={setClub} disabled={!fixture}>
              <SelectTrigger><SelectValue placeholder="Team" /></SelectTrigger>
              <SelectContent>
                {fixture && [fixture.homeTeam, fixture.awayTeam].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {playerTally && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {[
              { team: playerTally.homeTeam, saved: playerTally.homeSaved },
              { team: playerTally.awayTeam, saved: playerTally.awaySaved },
            ].map(({ team, saved }) => (
              <Badge key={team} variant="outline" className={saved > 0 ? "border-chart-3 text-chart-3" : "text-muted-foreground"}>
                {saved > 0 && <CheckCircle2 className="h-3 w-3 mr-1" />}
                {team}: {saved > 0 ? `${saved} players saved` : "not done yet"}
              </Badge>
            ))}
          </div>
        )}

        {fixture && club && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
            />
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={extract.isPending}>
              {extract.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ScanText className="h-4 w-4 mr-2" />}
              {extract.isPending ? "Reading screenshot…" : "Read a Dribl screenshot"}
            </Button>
            <span className="text-xs text-muted-foreground">or paste a copied screenshot (Ctrl/Cmd+V)</span>
            <Button
              variant="outline"
              onClick={() => setRows(rs => [...rs, { playerName: "", minsPlayed: 90, position: null, discipline: null, started: true, appearance: true }])}
            >
              <Plus className="h-4 w-4 mr-2" />Add row
            </Button>
            {rows.length > 0 && (
              <Button
                variant="outline"
                onClick={() => { setRows([]); setWarnings([]); setOk(null); setErr(null); }}
              >
                <X className="h-4 w-4 mr-2" />Cancel — clear table
              </Button>
            )}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="rounded-md border border-chart-4/40 bg-chart-4/10 p-3 space-y-1">
            {warnings.map((w, i) => (
              <p key={i} className="text-xs flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-chart-4" />{w}</p>
            ))}
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b">
                  <th className="text-left py-2 pr-2 font-medium">Player</th>
                  <th className="text-left py-2 pr-2 font-medium">Mins</th>
                  <th className="text-left py-2 pr-2 font-medium">Pos</th>
                  <th className="text-left py-2 pr-2 font-medium">Card</th>
                  <th className="text-center py-2 px-2 font-medium">Started</th>
                  <th className="text-center py-2 px-2 font-medium">Played</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-1.5 pr-2 min-w-[140px]">
                      <Input className="h-8" value={r.playerName} onChange={e => update(i, { playerName: e.target.value })} placeholder="J.Bloggs" />
                    </td>
                    <td className="py-1.5 pr-2 w-20">
                      <Input className="h-8" type="number" min={0} max={130} value={r.minsPlayed ?? ""} onChange={e => update(i, { minsPlayed: e.target.value === "" ? null : Number(e.target.value) })} />
                    </td>
                    <td className="py-1.5 pr-2 w-24">
                      <Select value={r.position ?? "__none__"} onValueChange={v => update(i, { position: v === "__none__" ? null : v })}>
                        <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          {POSITIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                          {r.position && !POSITIONS.includes(r.position as typeof POSITIONS[number]) && (
                            <SelectItem value={r.position}>{r.position}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-1.5 pr-2 w-24">
                      <Input className="h-8" value={r.discipline ?? ""} onChange={e => update(i, { discipline: e.target.value || null })} placeholder="—" />
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <Checkbox checked={r.started} onCheckedChange={v => update(i, { started: v === true })} />
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <Checkbox checked={r.appearance} onCheckedChange={v => update(i, { appearance: v === true })} />
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setRows(rs => rs.filter((_, j) => j !== i))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-3">
          <Button
            disabled={!fixture || !club || rows.length === 0 || rows.some(r => !r.playerName.trim()) || save.isPending}
            onClick={() => {
              setOk(null); setErr(null);
              save.mutate({ data: { teamId, seasonId, matchId, club, rows } });
            }}
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
            Save {rows.length > 0 ? `${rows.length} players` : "players"}
          </Button>
          <StatusLine ok={ok} err={err} />
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// League setup — create a league, its season, and its clubs
// ─────────────────────────────────────────────────────────────────────────────

function LeagueSetupCard() {
  const queryClient = useQueryClient();
  const { data: leagues } = useListLeagues();
  const { data: seasons } = useListSeasons();
  const { data: clubs } = useGetClubs();

  const [leagueName, setLeagueName] = useState("");
  const [leagueRegion, setLeagueRegion] = useState("");
  const [seasonLeagueId, setSeasonLeagueId] = useState("");
  const [seasonYear, setSeasonYear] = useState(String(new Date().getFullYear()));
  const [seasonActive, setSeasonActive] = useState(false);
  const [clubLeagueId, setClubLeagueId] = useState("");
  const [clubName, setClubName] = useState("");
  const [clubColor, setClubColor] = useState("#888888");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getListLeaguesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListSeasonsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetClubsQueryKey() });
  };

  const createLeague = useCreateLeague({ mutation: {
    onSuccess: (l) => {
      setMsg({ ok: true, text: `League "${l.name}" created — now add its season and clubs below.` });
      setLeagueName(""); setLeagueRegion("");
      setSeasonLeagueId(String(l.id)); setClubLeagueId(String(l.id));
      invalidate();
    },
    onError: (e) => setMsg({ ok: false, text: errMsg(e) }),
  }});
  const createSeason = useCreateSeason({ mutation: {
    onSuccess: (s) => { setMsg({ ok: true, text: `Season "${s.leagueName} · ${s.label}" created.` }); invalidate(); },
    onError: (e) => setMsg({ ok: false, text: errMsg(e) }),
  }});
  const createClub = useCreateClub({ mutation: {
    onSuccess: (c) => { setMsg({ ok: true, text: `Club "${c.name}" added.` }); setClubName(""); invalidate(); },
    onError: (e) => setMsg({ ok: false, text: errMsg(e) }),
  }});

  const leagueSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Select league" /></SelectTrigger>
      <SelectContent>
        {(leagues ?? []).map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <div className="space-y-6">
      {msg && (
        <div className={`flex items-center gap-2 text-sm rounded-md border px-3 py-2 ${msg.ok ? "border-emerald-500/40 text-emerald-500" : "border-destructive/40 text-destructive"}`}>
          {msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          {msg.text}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>1. Create a league</CardTitle>
          <CardDescription>A competition, e.g. "ACT NPLW Reserves". Each league keeps its own clubs and seasons.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] items-end">
          <div className="space-y-1.5">
            <Label>League name</Label>
            <Input value={leagueName} onChange={e => setLeagueName(e.target.value)} placeholder="ACT NPLW Reserves" />
          </div>
          <div className="space-y-1.5">
            <Label>Region (optional)</Label>
            <Input value={leagueRegion} onChange={e => setLeagueRegion(e.target.value)} placeholder="ACT" />
          </div>
          <Button
            disabled={!leagueName.trim() || createLeague.isPending}
            onClick={() => createLeague.mutate({ data: { name: leagueName.trim(), ...(leagueRegion.trim() ? { region: leagueRegion.trim() } : {}) } })}
          >
            <Plus className="h-4 w-4 mr-1.5" />Create league
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Add a season</CardTitle>
          <CardDescription>Which year this league is running. "Active" makes it that league's current season.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[1fr_140px_auto_auto] items-end">
          <div className="space-y-1.5">
            <Label>League</Label>
            {leagueSelect(seasonLeagueId, setSeasonLeagueId)}
          </div>
          <div className="space-y-1.5">
            <Label>Year</Label>
            <Input value={seasonYear} onChange={e => setSeasonYear(e.target.value)} placeholder="2026" />
          </div>
          <div className="flex items-center gap-2 pb-2.5">
            <Checkbox id="season-active" checked={seasonActive} onCheckedChange={v => setSeasonActive(v === true)} />
            <Label htmlFor="season-active" className="cursor-pointer">Active</Label>
          </div>
          <Button
            disabled={!seasonLeagueId || !/^\d{4}$/.test(seasonYear.trim()) || createSeason.isPending}
            onClick={() => createSeason.mutate({ data: {
              leagueId: Number(seasonLeagueId),
              year: seasonYear.trim(),
              label: `${seasonYear.trim()} Season`,
              isActive: seasonActive,
            } })}
          >
            <Plus className="h-4 w-4 mr-1.5" />Add season
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Add clubs</CardTitle>
          <CardDescription>The teams competing in the league, named exactly as the league calls them. The colour is used in the charts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_1fr_90px_auto] items-end">
            <div className="space-y-1.5">
              <Label>League</Label>
              {leagueSelect(clubLeagueId, setClubLeagueId)}
            </div>
            <div className="space-y-1.5">
              <Label>Club name</Label>
              <Input value={clubName} onChange={e => setClubName(e.target.value)} placeholder="Belconnen" />
            </div>
            <div className="space-y-1.5">
              <Label>Colour</Label>
              <Input type="color" value={clubColor} onChange={e => setClubColor(e.target.value)} className="h-9 p-1 cursor-pointer" />
            </div>
            <Button
              disabled={!clubLeagueId || !clubName.trim() || createClub.isPending}
              onClick={() => createClub.mutate({ data: { leagueId: Number(clubLeagueId), name: clubName.trim(), primaryColor: clubColor } })}
            >
              <Plus className="h-4 w-4 mr-1.5" />Add club
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current leagues</CardTitle>
          <CardDescription>Everything set up so far.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {(leagues ?? []).map(l => {
            const leagueSeasons = (seasons ?? []).filter(s => s.leagueId === l.id);
            const leagueClubs = (clubs ?? []).filter(c => c.leagueId === l.id);
            return (
              <div key={l.id} className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{l.name}</span>
                  {leagueSeasons.map(s => (
                    <Badge key={s.id} variant={s.isActive ? "default" : "secondary"}>{s.label}{s.isActive ? " · active" : ""}</Badge>
                  ))}
                  {leagueSeasons.length === 0 && <span className="text-xs text-muted-foreground">no season yet</span>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {leagueClubs.map(c => (
                    <span key={c.id} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground border rounded-full px-2.5 py-0.5">
                      <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: c.primaryColor }} />
                      {c.name}
                    </span>
                  ))}
                  {leagueClubs.length === 0 && <span className="text-xs text-muted-foreground">no clubs yet</span>}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

function EntryWorkspace() {
  const queryClient = useQueryClient();
  const { data: teams } = useListTeams();
  const { data: seasons } = useListSeasons();
  const { data: clubs } = useGetClubs();

  const [teamId, setTeamId] = useState<number | null>(null);
  const [seasonId, setSeasonId] = useState<number | null>(null);
  useEffect(() => {
    if (teams && teams.length > 0 && teamId == null) {
      const analytics = teams.find(t => t.analyticsEnabled && t.gender === "female") ?? teams[0];
      setTeamId(analytics.id);
    }
  }, [teams, teamId]);
  useEffect(() => {
    if (seasons && seasons.length > 0 && seasonId == null) {
      const active = seasons.find(s => s.isActive);
      setSeasonId(active ? active.id : seasons[0].id);
    }
  }, [seasons, seasonId]);

  const isReady = teamId != null && seasonId != null;

  const { data: fixtures } = useListLeagueMatches(
    { seasonId: seasonId ?? 0 },
    { query: { enabled: isReady, queryKey: getListLeagueMatchesQueryKey({ seasonId: seasonId ?? 0 }) } },
  );
  const { data: options } = useGetGoalOptions(
    { seasonId: seasonId ?? 0 },
    { query: { enabled: isReady, queryKey: getGetGoalOptionsQueryKey({ seasonId: seasonId ?? 0 }) } },
  );

  const logout = useLogout({ mutation: {
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() }); },
  }});

  const season = seasons?.find(s => s.id === seasonId);
  // Only offer clubs that belong to the selected season's league
  const clubNames = useMemo(
    () => (clubs ?? []).filter(c => season && c.leagueId === season.leagueId).map(c => c.name).sort(),
    [clubs, season],
  );

  if (!isReady) return <p className="text-muted-foreground text-center py-16">Loading…</p>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Data Entry</h1>
          <p className="text-muted-foreground">Record fixtures, goals and player minutes — everything flows straight into the charts.</p>
        </div>
        <div className="flex items-center gap-2">
          {season && <Badge variant="secondary">{season.leagueName} · {season.label}</Badge>}
          <Button variant="ghost" size="sm" onClick={() => logout.mutate()} className="text-muted-foreground">
            <LogOut className="h-4 w-4 mr-1.5" />Log out
          </Button>
        </div>
      </div>

      <Tabs defaultValue="match" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 h-auto md:h-10">
          <TabsTrigger value="match">1 · Match</TabsTrigger>
          <TabsTrigger value="goals">2 · Goals</TabsTrigger>
          <TabsTrigger value="players">3 · Player Stats</TabsTrigger>
          <TabsTrigger value="league">4 · League Setup</TabsTrigger>
        </TabsList>

        <TabsContent value="match" className="mt-6">
          <MatchForm
            teamId={teamId} seasonId={seasonId} clubs={clubNames} options={options}
            onSaved={() => { void queryClient.invalidateQueries({ queryKey: getListLeagueMatchesQueryKey({ seasonId }) }); }}
          />
        </TabsContent>
        <TabsContent value="goals" className="mt-6">
          <GoalForm teamId={teamId} seasonId={seasonId} fixtures={fixtures ?? []} options={options} />
        </TabsContent>
        <TabsContent value="league" className="mt-6">
          <LeagueSetupCard />
        </TabsContent>
        <TabsContent value="players" className="mt-6">
          <PlayersForm teamId={teamId} seasonId={seasonId} fixtures={fixtures ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function DataEntry() {
  // The app-wide AuthGate guarantees a session; this page additionally needs
  // the admin role (future viewer/coach logins can see charts but not this).
  const { data: auth, isLoading } = useGetAuthStatus();
  if (isLoading) return <p className="text-muted-foreground text-center py-16">Loading…</p>;
  if (auth?.role !== "admin") {
    return (
      <div className="max-w-sm mx-auto mt-16 text-center space-y-2">
        <Lock className="h-6 w-6 mx-auto text-muted-foreground" />
        <p className="text-muted-foreground">Data entry needs an admin login.</p>
      </div>
    );
  }
  return <EntryWorkspace />;
}
