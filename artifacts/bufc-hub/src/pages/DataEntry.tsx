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
  useListEntryPlayerStats,
  getListEntryPlayerStatsQueryKey,
  useDeleteEntryPlayerStat,
  useDeleteEntryPlayerStats,
  useExtractPlayersFromImage,
  useSaveEntryAthleticTests,
  useSaveEntryGpsSessions,
  useListGpsSessions,
  getListGpsSessionsQueryKey,
  useListGpsPlayerPositions,
  getListGpsPlayerPositionsQueryKey,
  useSaveGpsPlayerPositions,
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

  const { data: savedPlayers } = useListEntryPlayerStats(
    { seasonId, matchId, club },
    { query: { enabled: !!matchId && !!club, queryKey: getListEntryPlayerStatsQueryKey({ seasonId, matchId, club }) } },
  );

  // Prefix invalidation (no params) so caches for EVERY fixture refresh — safe even
  // if the coach switches match while a save/delete is still in flight
  const invalidatePlayerQueries = () => {
    void queryClient.invalidateQueries({ queryKey: getGetPlayerTallyQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListEntryPlayerStatsQueryKey() });
  };

  const removeSaved = useDeleteEntryPlayerStat({ mutation: {
    onSuccess: (res) => {
      invalidatePlayerQueries();
      setOk(`Player removed${res.belconnenDeleted ? " (Belconnen copy removed too)" : ""}`);
    },
    onError: (e) => setErr(errMsg(e)),
  }});

  const [confirmClear, setConfirmClear] = useState(false);
  const removeAll = useDeleteEntryPlayerStats({ mutation: {
    onSuccess: (res) => {
      invalidatePlayerQueries();
      setConfirmClear(false);
      setOk(`Removed all ${res.removed} saved players${res.belconnenRemoved > 0 ? " (Belconnen copies removed too)" : ""}`);
    },
    onError: (e) => { setConfirmClear(false); setErr(errMsg(e)); },
  }});
  useEffect(() => { setConfirmClear(false); }, [matchId, club]);

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
      invalidatePlayerQueries();
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

        {fixture && club && savedPlayers && savedPlayers.rows.length > 0 && (
          <div className="rounded-md border border-border/60 divide-y divide-border/40">
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {club} players already saved for this match — bin one if it shouldn't be there
              </p>
              {confirmClear ? (
                <span className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="destructive" size="sm" className="h-7 text-xs"
                    disabled={removeAll.isPending}
                    onClick={() => { setOk(null); setErr(null); removeAll.mutate({ params: { seasonId, matchId, club } }); }}
                  >
                    {removeAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : `Yes, remove all ${savedPlayers.rows.length}`}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConfirmClear(false)}>
                    Keep them
                  </Button>
                </span>
              ) : (
                <Button
                  variant="outline" size="sm" className="h-7 text-xs shrink-0 text-muted-foreground"
                  onClick={() => setConfirmClear(true)}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />Remove all
                </Button>
              )}
            </div>
            {savedPlayers.rows.map(p => (
              <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="font-medium">{p.playerName}</span>
                <span className="text-xs text-muted-foreground">
                  {p.started ? "started" : p.appearance ? "off bench" : "didn't play"}
                  {p.minsPlayed != null ? ` · ${p.minsPlayed} mins` : ""}
                  {p.position ? ` · ${p.position}` : ""}
                </span>
                {p.discipline && <Badge variant="outline" className="text-xs">{p.discipline}</Badge>}
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 ml-auto text-muted-foreground"
                  disabled={removeSaved.isPending}
                  onClick={() => { setOk(null); setErr(null); removeSaved.mutate({ rowId: p.id }); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
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
// Athletic testing upload (trainer's spreadsheet)
// ─────────────────────────────────────────────────────────────────────────────

interface TestingRow {
  playerName: string;
  position: string | null;
  verticalStart: number | null;
  verticalM: number | null;
  verticalTotal: number | null;
  horizontalM: number | null;
  balsomS: number | null;
  split010: number | null;
  split1020: number | null;
  split2030: number | null;
  total30m: number | null;
}

const TESTING_METRIC_KEYS = [
  "verticalStart", "verticalM", "verticalTotal", "horizontalM", "balsomS",
  "split010", "split1020", "split2030", "total30m",
] as const;

/** Normalise a spreadsheet header for tolerant matching: lowercase, letters+digits only. */
function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Header → schema field, keyed by normalised header. Covers the trainer's
// current layout ("Vertical start", "Balsom (s)", "0-10 split", …) plus
// reasonable spelling variations.
const TESTING_HEADER_MAP: Record<string, keyof TestingRow> = {
  player: "playerName", playername: "playerName", name: "playerName",
  position: "position", pos: "position",
  verticalstart: "verticalStart",
  verticalm: "verticalM", vertical: "verticalM", verticalcm: "verticalM",
  verticaltotal: "verticalTotal",
  horizontalm: "horizontalM", horizontal: "horizontalM",
  balsoms: "balsomS", balsom: "balsomS", balsomagility: "balsomS", balsomagilitys: "balsomS",
  "010split": "split010", split010: "split010", "010": "split010", "010m": "split010", "010msplit": "split010",
  "1020split": "split1020", split1020: "split1020", "1020": "split1020", "1020m": "split1020", "1020msplit": "split1020",
  "2030split": "split2030", split2030: "split2030", "2030": "split2030", "2030m": "split2030", "2030msplit": "split2030",
  total30m: "total30m", total30: "total30m", "30mtotal": "total30m", total30ms: "total30m",
};

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function TestingUploadForm({ teamId }: { teamId: number }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [rows, setRows] = useState<TestingRow[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [unmatchedHeaders, setUnmatchedHeaders] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useSaveEntryAthleticTests({ mutation: {
    onSuccess: (res) => {
      setOk(res.replaced > 0
        ? `Saved ${res.saved} players for ${year} (replaced the ${res.replaced} previously saved)`
        : `Saved ${res.saved} players for ${year}`);
      setRows([]); setSkipped([]); setUnmatchedHeaders([]); setFileName(null);
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e) => setErr(errMsg(e)),
  }});

  async function handleFile(file: File) {
    setParsing(true); setOk(null); setErr(null);
    setRows([]); setSkipped([]); setUnmatchedHeaders([]); setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("The file has no sheets in it");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      if (raw.length === 0) throw new Error("No rows found — is the first sheet the results table?");

      const headers = Object.keys(raw[0]);
      const mapping = new Map<string, keyof TestingRow>();
      const unknown: string[] = [];
      for (const h of headers) {
        const field = TESTING_HEADER_MAP[normHeader(h)];
        if (field) mapping.set(h, field);
        else unknown.push(h);
      }
      if (![...mapping.values()].includes("playerName")) {
        throw new Error(`Couldn't find a "Player" column — headers were: ${headers.join(", ")}`);
      }

      const parsed: TestingRow[] = [];
      const skippedNames: string[] = [];
      for (const r of raw) {
        const row: TestingRow = {
          playerName: "", position: null,
          verticalStart: null, verticalM: null, verticalTotal: null, horizontalM: null,
          balsomS: null, split010: null, split1020: null, split2030: null, total30m: null,
        };
        for (const [header, field] of mapping) {
          const v = r[header];
          if (field === "playerName") row.playerName = v == null ? "" : String(v).trim();
          else if (field === "position") row.position = v == null || String(v).trim() === "" ? null : String(v).trim();
          else row[field] = toNum(v);
        }
        if (!row.playerName) continue;
        if (/^averages?$/i.test(row.playerName)) { skippedNames.push(row.playerName); continue; }
        parsed.push(row);
      }
      if (parsed.length === 0) throw new Error("No player rows found in the file");
      setRows(parsed);
      setSkipped(skippedNames);
      setUnmatchedHeaders(unknown);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read that file");
      setFileName(null);
    } finally {
      setParsing(false);
    }
  }

  const missingCounts = useMemo(() => rows.map(r => TESTING_METRIC_KEYS.filter(k => r[k] == null).length), [rows]);
  const fmt = (v: number | null) => (v == null ? "—" : String(v));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload testing results</CardTitle>
          <CardDescription>
            Drop in the spreadsheet exactly as the trainer sends it (xlsx or csv). You'll see every row it read
            before anything is saved. Saving replaces everything already stored for that year, so re-uploading a
            corrected file just works.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[140px_1fr] items-end">
            <Field label="Testing year">
              <Input value={year} onChange={e => setYear(e.target.value)} placeholder="2026" />
            </Field>
            <Field label="Trainer's spreadsheet">
              <Input
                ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
                className="cursor-pointer file:mr-3 file:cursor-pointer"
                onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
              />
            </Field>
          </div>
          {parsing && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Reading {fileName}…</div>}
          <StatusLine ok={ok} err={err} />
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Check what was read — {rows.length} players</CardTitle>
              <CardDescription>
                {fileName}
                {skipped.length > 0 && ` · skipped the "${skipped.join('", "')}" row`}
                {unmatchedHeaders.length > 0 && ` · ignored columns: ${unmatchedHeaders.join(", ")}`}
              </CardDescription>
            </div>
            <Button
              disabled={save.isPending || !/^\d{4}$/.test(year.trim())}
              onClick={() => { setOk(null); setErr(null); save.mutate({ data: { year: year.trim(), teamId, rows } }); }}
            >
              {save.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
              Save {rows.length} players to {year.trim() || "…"}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50 text-muted-foreground">
                    <th className="px-2 py-1.5 text-left font-medium">Player</th>
                    <th className="px-2 py-1.5 text-left font-medium">Position</th>
                    <th className="px-2 py-1.5 text-right font-medium">Vert start</th>
                    <th className="px-2 py-1.5 text-right font-medium">Vert (m)</th>
                    <th className="px-2 py-1.5 text-right font-medium">Vert total</th>
                    <th className="px-2 py-1.5 text-right font-medium">Horiz (m)</th>
                    <th className="px-2 py-1.5 text-right font-medium">Balsom (s)</th>
                    <th className="px-2 py-1.5 text-right font-medium">0-10</th>
                    <th className="px-2 py-1.5 text-right font-medium">10-20</th>
                    <th className="px-2 py-1.5 text-right font-medium">20-30</th>
                    <th className="px-2 py-1.5 text-right font-medium">30m</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-2 py-1.5 font-medium whitespace-nowrap">{r.playerName}</td>
                      <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{r.position ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.verticalStart)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.verticalM)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.verticalTotal)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.horizontalM)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.balsomS)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.split010)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.split1020)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.split2030)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.total30m)}</td>
                      <td className="px-2 py-1.5">
                        {missingCounts[i] > 0 && (
                          <Badge variant="outline" className="text-[10px] text-chart-4 border-chart-4/40">
                            {missingCounts[i]} blank
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GPS match upload (Catapult CSV)
// ─────────────────────────────────────────────────────────────────────────────

interface GpsRow {
  playerName: string;
  splitName: string | null;
  minsPlayed: number | null;
  distanceKm: number | null;
  sprintDistanceM: number | null;
  powerPlays: number | null;
  energyKcal: number | null;
  impacts: number | null;
  hrLoad: number | null;
  timeInRedZoneMin: number | null;
  playerLoad: number | null;
  topSpeedMs: number | null;
  distancePerMinMm: number | null;
  powerScoreWkg: number | null;
  workRatio: number | null;
  hrMaxBpm: number | null;
  maxDecelerationMss: number | null;
  maxAccelerationMss: number | null;
  distanceZone1Km: number | null;
  distanceZone2Km: number | null;
  distanceZone3Km: number | null;
  distanceZone4Km: number | null;
  distanceZone5Km: number | null;
  accelCount34: number | null;
  accelCountOver4: number | null;
  decelCount34: number | null;
  decelCountOver4: number | null;
}

const EMPTY_GPS_ROW: Omit<GpsRow, "playerName" | "splitName"> = {
  minsPlayed: null, distanceKm: null, sprintDistanceM: null, powerPlays: null,
  energyKcal: null, impacts: null, hrLoad: null, timeInRedZoneMin: null,
  playerLoad: null, topSpeedMs: null, distancePerMinMm: null, powerScoreWkg: null,
  workRatio: null, hrMaxBpm: null, maxDecelerationMss: null, maxAccelerationMss: null,
  distanceZone1Km: null, distanceZone2Km: null, distanceZone3Km: null,
  distanceZone4Km: null, distanceZone5Km: null,
  accelCount34: null, accelCountOver4: null, decelCount34: null, decelCountOver4: null,
};

// Catapult export header → row field, keyed by normalised header. The export
// has ~109 columns; everything not listed here is simply ignored.
const GPS_HEADER_MAP: Record<string, keyof GpsRow> = {
  playername: "playerName", player: "playerName", athlete: "playerName", athletename: "playerName",
  splitname: "splitName", split: "splitName",
  minsplayed: "minsPlayed", minutesplayed: "minsPlayed",
  distancekm: "distanceKm", totaldistancekm: "distanceKm",
  sprintdistancem: "sprintDistanceM",
  powerplays: "powerPlays",
  energykcal: "energyKcal",
  impacts: "impacts",
  hrload: "hrLoad",
  timeinredzonemin: "timeInRedZoneMin",
  playerload: "playerLoad",
  topspeedms: "topSpeedMs",
  distanceperminmmin: "distancePerMinMm",
  powerscorewkg: "powerScoreWkg",
  workratio: "workRatio",
  hrmaxbpm: "hrMaxBpm",
  maxdecelerationmss: "maxDecelerationMss",
  maxaccelerationmss: "maxAccelerationMss",
  distanceinspeedzone1km: "distanceZone1Km",
  distanceinspeedzone2km: "distanceZone2Km",
  distanceinspeedzone3km: "distanceZone3Km",
  distanceinspeedzone4km: "distanceZone4Km",
  distanceinspeedzone5km: "distanceZone5Km",
  accelerationszonecount34mss: "accelCount34",
  accelerationszonecount4mss: "accelCountOver4",
  decelerationzonecount34mss: "decelCount34",
  decelerationzonecount4mss: "decelCountOver4",
};

const SQUAD_OPTIONS = [
  { value: "1sts", label: "1sts" },
  { value: "res", label: "Reserves" },
  { value: "18s", label: "U18s" },
  { value: "17s", label: "U17s" },
] as const;

const SPLIT_ORDER: Record<string, number> = { game: 0, "1st.half": 1, "2nd.half": 2 };

/** One parsed file row plus any match details the file itself provided (coach's weekly sheet). */
interface GpsEntry {
  row: GpsRow;
  fileRound: string | null;
  fileOpponent: string | null;
  fileTitle: string | null;
  fileDateDmy: string | null;
}

/** Turn an Excel date (serial number, dd/mm/yyyy or ISO string) into DD/MM/YYYY, or null. */
function excelDateToDmy(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number" && v > 20000 && v < 60000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return `${String(dt.getUTCDate()).padStart(2, "0")}/${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${dt.getUTCFullYear()}`;
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const yr = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${dmy[1].padStart(2, "0")}/${dmy[2].padStart(2, "0")}/${yr}`;
  }
  return null;
}

function GpsUploadForm({ teamId }: { teamId: number }) {
  const [matchDate, setMatchDate] = useState("");
  const [roundCode, setRoundCode] = useState("");
  const [squad, setSquad] = useState<string>("1sts");
  const [opponent, setOpponent] = useState("");
  const [entries, setEntries] = useState<GpsEntry[]>([]);
  const [ignoredSplits, setIgnoredSplits] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const formRound = roundCode.trim() ? `${roundCode.trim()}-${squad}` : "";
  // Coach's weekly sheet carries Round/Opponent/Date columns — when present the
  // file drives the match details (and can hold several matches at once).
  const fileMode = entries.length > 0 && entries[0].fileRound != null;

  const save = useSaveEntryGpsSessions();

  async function handleFile(file: File) {
    setParsing(true); setOk(null); setErr(null);
    setEntries([]); setIgnoredSplits(0); setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("The file has no sheets in it");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
      if (raw.length === 0) throw new Error("No rows found in the file");

      const headers = Object.keys(raw[0]);
      const mapping = new Map<string, keyof GpsRow>();
      let durationHeader: string | null = null;
      let tagsHeader: string | null = null;
      let roundHeader: string | null = null;
      let opponentHeader: string | null = null;
      let titleHeader: string | null = null;
      let dateHeader: string | null = null;
      for (const h of headers) {
        const norm = normHeader(h);
        const field = GPS_HEADER_MAP[norm];
        if (field && ![...mapping.values()].includes(field)) mapping.set(h, field);
        if (norm === "duration") durationHeader = h;
        if (norm === "tags") tagsHeader = h;
        if (norm === "round") roundHeader = h;
        if (norm === "opponent") opponentHeader = h;
        if (norm === "sessiontitle") titleHeader = h;
        if (norm === "date") dateHeader = h;
      }
      if (![...mapping.values()].includes("playerName")) {
        throw new Error("Couldn't find a \"Player Name\" column in this file — is it the Catapult export?");
      }
      if (![...mapping.values()].includes("distanceKm")) {
        throw new Error("Couldn't find a \"Distance (km)\" column in this file — is it the Catapult export?");
      }

      const parsed: GpsEntry[] = [];
      let ignored = 0;
      for (const r of raw) {
        const row: GpsRow = { playerName: "", splitName: null, ...EMPTY_GPS_ROW };
        for (const [header, field] of mapping) {
          const v = r[header];
          if (field === "playerName") row.playerName = v == null ? "" : String(v).trim();
          else if (field === "splitName") row.splitName = v == null || String(v).trim() === "" ? null : String(v).trim();
          else row[field] = toNum(v);
        }
        if (!row.playerName) continue;
        // Skip non-game rows (e.g. training sessions mixed into an export)
        if (tagsHeader != null) {
          const tag = r[tagsHeader] == null ? "" : String(r[tagsHeader]).trim().toLowerCase();
          if (tag !== "" && tag !== "game") { ignored++; continue; }
        }
        // Keep whole-game and half rows; drop thirds/extra-time splits the charts ignore.
        // Store the canonical lowercase literal — downstream chart logic matches exactly.
        const split = (row.splitName ?? "game").toLowerCase();
        if (!(split === "game" || split === "1st.half" || split === "2nd.half")) { ignored++; continue; }
        row.splitName = split;
        // Pre-fill minutes from the Duration column (secs) when the sheet has no Mins column
        if (row.minsPlayed == null && durationHeader != null) {
          const dur = toNum(r[durationHeader]);
          if (dur != null && dur > 0) row.minsPlayed = Math.round((dur / 60) * 100) / 100;
        }
        const fileRound = roundHeader != null && r[roundHeader] != null && String(r[roundHeader]).trim() !== ""
          ? String(r[roundHeader]).trim() : null;
        if (roundHeader != null && fileRound == null) { ignored++; continue; } // sheet has rounds but this row is blank
        parsed.push({
          row,
          fileRound,
          fileOpponent: opponentHeader != null && r[opponentHeader] != null && String(r[opponentHeader]).trim() !== ""
            ? String(r[opponentHeader]).trim() : null,
          fileTitle: titleHeader != null && r[titleHeader] != null && String(r[titleHeader]).trim() !== ""
            ? String(r[titleHeader]).trim() : null,
          fileDateDmy: dateHeader != null ? excelDateToDmy(r[dateHeader]) : null,
        });
      }
      if (parsed.length === 0) throw new Error("No usable game rows found in the file");
      parsed.sort((a, b) =>
        (a.fileRound ?? "").localeCompare(b.fileRound ?? "") ||
        a.row.playerName.localeCompare(b.row.playerName) ||
        (SPLIT_ORDER[a.row.splitName ?? "game"] ?? 9) - (SPLIT_ORDER[b.row.splitName ?? "game"] ?? 9));
      setEntries(parsed);
      setIgnoredSplits(ignored);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read that file");
      setFileName(null);
    } finally {
      setParsing(false);
    }
  }

  const groups = useMemo(() => {
    const m = new Map<string, GpsEntry[]>();
    for (const e of entries) {
      const key = e.fileRound ?? formRound;
      const arr = m.get(key);
      if (arr) arr.push(e); else m.set(key, [e]);
    }
    return m;
  }, [entries, formRound]);

  const playerCount = useMemo(() => new Set(entries.map(e => e.row.playerName)).size, [entries]);
  const needsFormDate = !fileMode || entries.some(e => e.fileDateDmy == null);
  const formDateOk = /^\d{4}-\d{2}-\d{2}$/.test(matchDate);
  const readyToSave = entries.length > 0
    && (fileMode || formRound !== "")
    && (!needsFormDate || formDateOk);

  const setMins = (i: number, v: string) => {
    setEntries(prev => prev.map((e, j) => j === i ? { ...e, row: { ...e.row, minsPlayed: v.trim() === "" ? null : toNum(v) } } : e));
  };

  const onSave = async () => {
    setOk(null); setErr(null); setSaving(true);
    const roundsSaved: string[] = [];
    try {
      const [y, m, d] = formDateOk ? matchDate.split("-") : ["", "", ""];
      const formDmy = formDateOk ? `${d}/${m}/${y}` : null;
      let totalSaved = 0, totalReplaced = 0;
      for (const [round, group] of groups) {
        const dmy = group.find(g => g.fileDateDmy)?.fileDateDmy ?? formDmy;
        if (!dmy) throw new Error(`No match date for ${round} — fill in the date above`);
        const opp = fileMode
          ? group.find(g => g.fileOpponent)?.fileOpponent ?? null
          : opponent.trim() || null;
        const squadLabel = SQUAD_OPTIONS.find(s => s.value === squad)?.label ?? squad;
        const sessionTitle = group.find(g => g.fileTitle)?.fileTitle
          ?? (fileMode
            ? `${dmy.split("/").reverse().join("")}-${round}-${opp ?? "match"}`
            : `${y}${m}${d}-${roundCode.trim()}-${squadLabel}-${opp ?? "match"}`);
        const res = await save.mutateAsync({ data: {
          year: dmy.slice(6), teamId, round, opponent: opp,
          sessionDate: dmy, sessionTitle,
          rows: group.map(g => g.row),
        }});
        totalSaved += res.saved; totalReplaced += res.replaced;
        roundsSaved.push(round);
      }
      setOk(`Saved ${totalSaved} rows for ${roundsSaved.join(" and ")}`
        + (totalReplaced > 0 ? ` (replaced ${totalReplaced} rows previously saved for ${roundsSaved.length > 1 ? "those rounds" : "that round"})` : "")
        + ". New player names? Set their position in the Positions tab.");
      setEntries([]); setIgnoredSplits(0); setFileName(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      // Saves run one round at a time — tell the coach exactly what did and didn't go in
      setErr(roundsSaved.length > 0
        ? `${roundsSaved.join(" and ")} saved fine, but the next one failed — ${errMsg(e)}. Fix the issue and re-upload; already-saved rounds are replaced cleanly.`
        : errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const fmtN = (v: number | null, d = 1) => (v == null ? "—" : v.toFixed(d));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload a match's GPS data</CardTitle>
          <CardDescription>
            Drop in your weekly GPS sheet or the raw Catapult export (csv or xlsx) — the app picks out the
            columns the charts use and ignores the rest. If the file has your Round / Opponent / Date columns
            it reads the match details straight from them (both squads at once is fine); otherwise fill them
            in below. Re-uploading the same round replaces it cleanly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="GPS file (weekly sheet or raw Catapult export)">
            <Input
              ref={fileRef} type="file" accept=".csv,.xlsx,.xls"
              className="cursor-pointer file:mr-3 file:cursor-pointer"
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
            />
          </Field>
          {fileMode ? (
            <div className="text-sm text-muted-foreground">
              Match details read from the file:{" "}
              <span className="text-foreground font-medium">
                {[...groups.entries()].map(([r, g]) =>
                  `${r} v ${g.find(x => x.fileOpponent)?.fileOpponent ?? "?"}${g.find(x => x.fileDateDmy)?.fileDateDmy ? ` (${g.find(x => x.fileDateDmy)?.fileDateDmy})` : ""}`
                ).join(" · ")}
              </span>
              {needsFormDate && " — the file has no date, so set the match date below."}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Match date">
              <Input type="date" value={matchDate} onChange={e => setMatchDate(e.target.value)} disabled={fileMode && !needsFormDate} />
            </Field>
            <Field label="Round (e.g. R13, GF)">
              <Input value={roundCode} onChange={e => setRoundCode(e.target.value)} placeholder="R13" disabled={fileMode} />
            </Field>
            <Field label="Squad">
              <Select value={squad} onValueChange={setSquad} disabled={fileMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SQUAD_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Opponent">
              <Input value={opponent} onChange={e => setOpponent(e.target.value)} placeholder="Majura" disabled={fileMode} />
            </Field>
          </div>
          {parsing && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Reading {fileName}…</div>}
          <StatusLine ok={ok} err={err} />
        </CardContent>
      </Card>

      {entries.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>Check what was read — {playerCount} players, {entries.length} rows</CardTitle>
              <CardDescription>
                {fileName}
                {ignoredSplits > 0 && ` · ignored ${ignoredSplits} non-game rows (training / thirds / extra time)`}
                {" · minutes are pre-filled from the file — adjust any you track differently"}
              </CardDescription>
            </div>
            <Button disabled={saving || !readyToSave} onClick={() => void onSave()}>
              {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
              {fileMode
                ? `Save ${groups.size} ${groups.size === 1 ? "match" : "matches"}`
                : `Save to ${formRound || "…"}`}
            </Button>
          </CardHeader>
          <CardContent>
            {!readyToSave && (
              <p className="mb-3 text-sm text-muted-foreground">
                {fileMode ? "Set the match date above to enable saving." : "Fill in the match date and round above to enable saving."}
              </p>
            )}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50 text-muted-foreground">
                    {fileMode && <th className="px-2 py-1.5 text-left font-medium">Round</th>}
                    <th className="px-2 py-1.5 text-left font-medium">Player</th>
                    <th className="px-2 py-1.5 text-left font-medium">Split</th>
                    <th className="px-2 py-1.5 text-right font-medium">Mins</th>
                    <th className="px-2 py-1.5 text-right font-medium">Dist (km)</th>
                    <th className="px-2 py-1.5 text-right font-medium">HSM (m)</th>
                    <th className="px-2 py-1.5 text-right font-medium">VHS (m)</th>
                    <th className="px-2 py-1.5 text-right font-medium">Top speed (km/h)</th>
                    <th className="px-2 py-1.5 text-right font-medium">Load</th>
                    <th className="px-2 py-1.5 text-right font-medium">Acc &gt;3</th>
                    <th className="px-2 py-1.5 text-right font-medium">Dec &gt;3</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(({ row: r, fileRound }, i) => (
                    <tr key={i} className={`border-b last:border-0 ${r.splitName === "game" ? "" : "text-muted-foreground"}`}>
                      {fileMode && <td className="px-2 py-1.5 whitespace-nowrap">{r.splitName === "game" ? fileRound : ""}</td>}
                      <td className="px-2 py-1.5 font-medium whitespace-nowrap">{r.splitName === "game" ? r.playerName : ""}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{r.splitName}</td>
                      <td className="px-2 py-1">
                        <Input
                          value={r.minsPlayed ?? ""} type="number" step="1" min="0"
                          onChange={e => setMins(i, e.target.value)}
                          className="h-7 w-16 text-right text-xs ml-auto"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtN(r.distanceKm, 2)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtN(r.sprintDistanceM, 0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.distanceZone5Km == null ? "—" : (r.distanceZone5Km * 1000).toFixed(0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.topSpeedMs == null ? "—" : (r.topSpeedMs * 3.6).toFixed(1)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtN(r.playerLoad, 0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.accelCount34 == null && r.accelCountOver4 == null ? "—" : (r.accelCount34 ?? 0) + (r.accelCountOver4 ?? 0)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.decelCount34 == null && r.decelCountOver4 == null ? "—" : (r.decelCount34 ?? 0) + (r.decelCountOver4 ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
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
        <TabsList className="flex w-full flex-wrap h-auto gap-1">
          <TabsTrigger value="match">1 · Match</TabsTrigger>
          <TabsTrigger value="goals">2 · Goals</TabsTrigger>
          <TabsTrigger value="players">3 · Player Stats</TabsTrigger>
          <TabsTrigger value="league">4 · League Setup</TabsTrigger>
          <TabsTrigger value="testing">5 · Testing</TabsTrigger>
          <TabsTrigger value="gps">6 · GPS</TabsTrigger>
          <TabsTrigger value="positions">7 · Positions</TabsTrigger>
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
        <TabsContent value="testing" className="mt-6">
          <TestingUploadForm teamId={teamId} />
        </TabsContent>
        <TabsContent value="gps" className="mt-6">
          <GpsUploadForm teamId={teamId} />
        </TabsContent>
        <TabsContent value="positions" className="mt-6">
          <PositionsForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GPS player positions — drives position-specific averages in player reports
// ─────────────────────────────────────────────────────────────────────────────

const GPS_POSITIONS = ["GK", "Defender", "Midfielder", "Forward"];

function PositionsForm() {
  const queryClient = useQueryClient();

  // Every player name that has ever logged a GPS game (all years)
  const gpsParams = { split: "game" };
  const { data: gpsRows, isLoading: loadingNames } = useListGpsSessions(
    gpsParams,
    { query: { queryKey: getListGpsSessionsQueryKey(gpsParams) } },
  );
  const names = useMemo(
    () => [...new Set((gpsRows ?? []).map(r => r.playerName).filter((n): n is string => !!n && n !== "Unknown"))].sort(),
    [gpsRows]);

  const { data: saved, isLoading: loadingPos } = useListGpsPlayerPositions(
    { query: { queryKey: getListGpsPlayerPositionsQueryKey() } },
  );
  const savedMap = useMemo(() => new Map((saved ?? []).map(p => [p.playerName, p.position])), [saved]);

  // Local edits layered over what's saved; "" = no position
  const [edits, setEdits] = useState<Record<string, string>>({});
  const valueOf = (n: string) => edits[n] ?? savedMap.get(n) ?? "";
  const dirty = names.some(n => (edits[n] ?? savedMap.get(n) ?? "") !== (savedMap.get(n) ?? ""));

  const [message, setMessage] = useState<string | null>(null);
  const save = useSaveGpsPlayerPositions({ mutation: {
    onSuccess: res => {
      setEdits({});
      setMessage(`Saved — ${res.saved} player${res.saved === 1 ? "" : "s"} with a position${res.removed ? `, ${res.removed} cleared` : ""}.`);
      void queryClient.invalidateQueries({ queryKey: getListGpsPlayerPositionsQueryKey() });
    },
    onError: e => setMessage(errMsg(e)),
  }});

  const submit = () => {
    setMessage(null);
    const body = names
      .filter(n => (edits[n] ?? savedMap.get(n) ?? "") !== (savedMap.get(n) ?? ""))
      .map(n => {
        const v = valueOf(n);
        return { playerName: n, position: (v === "" ? null : v) as "GK" | "Defender" | "Midfielder" | "Forward" | null };
      });
    save.mutate({ data: body });
  };

  const unset = names.filter(n => !valueOf(n)).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Player positions</CardTitle>
        <CardDescription>
          Set each GPS-logged player as GK, Defender, Midfielder or Forward. Once set, player reports can show
          position-specific averages — a much fairer comparison than the whole squad.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingNames || loadingPos ? (
          <p className="text-muted-foreground py-8 text-center">Loading players…</p>
        ) : names.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center">No GPS-logged players found.</p>
        ) : (
          <>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {names.map(n => (
                <div key={n} className="flex items-center justify-between gap-2 border-b py-1.5">
                  <span className="text-sm truncate">{n}</span>
                  <Select value={valueOf(n) || "none"} onValueChange={v => setEdits(prev => ({ ...prev, [n]: v === "none" ? "" : v }))}>
                    <SelectTrigger className="w-[130px] max-w-full h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {GPS_POSITIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={submit} disabled={!dirty || save.isPending}>
                {save.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving…</> : "Save positions"}
              </Button>
              <p className="text-sm text-muted-foreground">
                {unset ? `${unset} of ${names.length} players still without a position.` : `All ${names.length} players have a position.`}
              </p>
              {message && <p className="text-sm">{message}</p>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
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
