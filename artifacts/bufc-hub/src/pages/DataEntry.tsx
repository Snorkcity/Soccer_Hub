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
  useSaveEntryPlayerStats,
  useExtractPlayersFromImage,
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
import { Lock, LogOut, CheckCircle2, AlertTriangle, Trash2, Plus, Upload, Loader2, ScanText } from "lucide-react";

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
      setHomeGoals(""); setAwayGoals(""); setHalfScore(""); setRound("");
      setMatchIdEdited(false);
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
          <Field label="Match ID" className="col-span-2">
            <Input value={matchId} onChange={e => { setMatchId(e.target.value); setMatchIdEdited(true); }} placeholder="R14-BEL-CRO" />
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

        {isBelconnen && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
            <p className="text-sm font-medium">Belconnen match details <span className="text-muted-foreground font-normal">(all optional — add Veo numbers later if you like)</span></p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <VocabInput label="Venue" value={venue} onChange={setVenue} options={options?.venues ?? []} listId="dl-venues" />
              <Field label="Half-time score">
                <Input value={halfScore} onChange={e => setHalfScore(e.target.value)} placeholder="e.g. 1-0" />
              </Field>
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
                ...(isBelconnen ? {
                  venue: venue.trim() || null,
                  halfScore: halfScore.trim() || null,
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
  const DEPTH = 30; // yards shown
  const W = 300, H = 240;
  const sx = (x: number) => (x / 100) * W;
  const sy = (y: number) => (y / DEPTH) * H;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        Where from? Click the pitch (goal at the top){goalX != null && goalY != null ? ` — across ${goalX}, ${goalY} yds out` : ""}
      </Label>
      <svg
        viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[340px] rounded-md border bg-chart-3/5 cursor-crosshair select-none"
        onClick={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 100;
          const y = ((e.clientY - rect.top) / rect.height) * DEPTH;
          onPick(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
        }}
      >
        {/* goal line + goal mouth */}
        <line x1={0} y1={1} x2={W} y2={1} stroke="currentColor" strokeOpacity={0.5} strokeWidth={2} />
        <rect x={sx(45)} y={0} width={sx(10)} height={5} fill="currentColor" fillOpacity={0.65} />
        {/* 6-yard box (goal area: 20yd wide → 40..60) */}
        <rect x={sx(40)} y={0} width={sx(20)} height={sy(6)} fill="none" stroke="currentColor" strokeOpacity={0.35} />
        {/* 18-yard box (44yd wide → 28..72) */}
        <rect x={sx(28)} y={0} width={sx(44)} height={sy(18)} fill="none" stroke="currentColor" strokeOpacity={0.35} />
        {/* penalty spot */}
        <circle cx={sx(50)} cy={sy(12)} r={2.5} fill="currentColor" fillOpacity={0.45} />
        {/* depth guides */}
        {[10, 20].map(y => (
          <g key={y}>
            <line x1={0} y1={sy(y)} x2={W} y2={sy(y)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={4} y={sy(y) - 3} fontSize={8} fill="currentColor" fillOpacity={0.4}>{y} yds</text>
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

  const create = useCreateEntryGoal({ mutation: {
    onSuccess: (res) => {
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
            <Button
              variant="outline"
              onClick={() => setRows(rs => [...rs, { playerName: "", minsPlayed: 90, position: null, discipline: null, started: true, appearance: true }])}
            >
              <Plus className="h-4 w-4 mr-2" />Add row
            </Button>
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
                    <td className="py-1.5 pr-2 w-20">
                      <Input className="h-8" value={r.position ?? ""} onChange={e => update(i, { position: e.target.value || null })} />
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
    if (seasons && seasons.length > 0 && seasonId == null) setSeasonId(seasons[0].id);
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

  const clubNames = useMemo(() => (clubs ?? []).map(c => c.name).sort(), [clubs]);
  const season = seasons?.find(s => s.id === seasonId);

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
        <TabsList className="grid w-full grid-cols-3 h-auto md:h-10">
          <TabsTrigger value="match">1 · Match</TabsTrigger>
          <TabsTrigger value="goals">2 · Goals</TabsTrigger>
          <TabsTrigger value="players">3 · Player Stats</TabsTrigger>
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
