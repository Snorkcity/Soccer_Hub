import React, { Fragment, useState, useMemo, useEffect, useRef } from "react";
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
  useGetGoalVocab,
  getGetGoalVocabQueryKey,
  useSaveGoalVocab,
  type GoalVocabResponse,
  useCreateEntryMatch,
  useListMatches,
  getListMatchesQueryKey,
  useUpdateMatch,
  type Match,
  useCreateEntryGoal,
  useGetGoalTally,
  getGetGoalTallyQueryKey,
  useListEntryGoals,
  getListEntryGoalsQueryKey,
  useDeleteEntryGoal,
  useUpdateEntryGoal,
  useGetPlayerTally,
  getGetPlayerTallyQueryKey,
  useSaveEntryPlayerStats,
  useListEntryPlayerStats,
  getListEntryPlayerStatsQueryKey,
  useDeleteEntryPlayerStat,
  useUpdateEntryPlayerStat,
  useDeleteEntryPlayerStats,
  useExtractPlayersFromImage,
  useSaveEntryAthleticTests,
  useSaveEntryGpsSessions,
  useListEntryGpsUploads,
  getListEntryGpsUploadsQueryKey,
  useUpdateEntryGpsUpload,
  useDeleteEntryGpsUpload,
  useListEntryGpsFixtures,
  getListEntryGpsFixturesQueryKey,
  useListGpsSessions,
  getListGpsSessionsQueryKey,
  useListGpsPlayerPositions,
  getListGpsPlayerPositionsQueryKey,
  useSaveGpsPlayerPositions,
  useListGpsPlayerEmails,
  getListGpsPlayerEmailsQueryKey,
  useSaveGpsPlayerEmails,
  useListLeagues,
  useCreateLeague,
  useUpdateLeague,
  type LeagueInfo,
  useCreateSeason,
  useCreateClub,
  useExtractClubsFromLeague,
  useCopyClubsFromLeague,
  useFillClubBranding,
  useUpdateClub,
  getDriblPreview,
  getDriblConfig,
  assembleDriblPreview,
  type DriblPreviewResponse,
  type DriblRawFixture,
  type DriblRawLineup,
  type DriblRawMatchCentre,
  getListLeaguesQueryKey,
  getListSeasonsQueryKey,
  getGetClubsQueryKey,
  type LeagueMatchInfo,
  type EntryGoalListItem,
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
import { Textarea } from "@/components/ui/textarea";
import { Lock, LogOut, CheckCircle2, AlertTriangle, Trash2, Pencil, Plus, Upload, Loader2, ScanText, X, ChevronUp, ChevronDown } from "lucide-react";
import { useLeagueModules } from "@/hooks/useLeagueModules";
import { NoAccess } from "@/components/NoAccess";

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

const DEFAULT_GOAL_VOCAB: GoalVocabResponse = {
  goalTypes: ["R-FT-DT", "R-FT-AT", "R-MT-DT", "R-MT-AT", "R-BT-DT", "R-BT-AT", "SP-P", "SP-C", "SP-T", "SP-F"],
  assistTypes: ["Inswinger", "Outswinger", "Cross", "Cutback", "Through ball", "Pass", "Error", "Shot"],
  howPenetrated: ["Through", "Around", "Over"],
  buildupLanes: ["Left", "Centre", "Right"],
  finishTypes: ["Right Foot", "Left Foot", "Head"],
  sources: ["Buildup", "Counter", "Press", "Direct"],
};

/** Inswinger/Outswinger only make sense on dead-ball crosses: corners and free kicks. */
const SET_PIECE_CROSS_TYPES = new Set(["SP-C", "SP-F"]);
const SWINGER_ASSIST_TYPES = new Set(["Inswinger", "Outswinger"]);
/** Locked dropdown: fixed option list; a legacy value on an old goal stays selectable so editing never wipes it. */
function LockedSelect({ label, value, onChange, options, className }: {
  label: string; value: string; onChange: (v: string) => void;
  options: readonly string[]; className?: string;
}) {
  const opts = value && !options.includes(value) ? [value, ...options] : [...options];
  return (
    <Field label={label} className={className}>
      <Select value={value || "__none__"} onValueChange={v => onChange(v === "__none__" ? "" : v)}>
        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">—</SelectItem>
          {opts.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>
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

  // Auto-build the Match ID from round + clubs unless the coach typed their
  // own. Codes are made unique within the league's club set (Sydney Uni vs
  // Sydney Olympic would otherwise both be SYD).
  const codes = useMemo(() => clubCodesFor(clubs), [clubs]);
  useEffect(() => {
    if (matchIdEdited) return;
    if (homeTeam && awayTeam) {
      setMatchId(`${round ? `R${round}` : "R?"}-${codes[homeTeam] ?? "?"}-${codes[awayTeam] ?? "?"}`);
    }
  }, [round, homeTeam, awayTeam, matchIdEdited, codes]);

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
// Edit match stats — fill in possession/shots/passes on an existing Belconnen
// match (e.g. Dribl-imported games) without re-entering the whole match.
// ─────────────────────────────────────────────────────────────────────────────

function MatchStatsEditor({ teamId, seasonId }: { teamId: number; seasonId: number }) {
  const queryClient = useQueryClient();
  const listParams = { teamId, seasonId };
  const { data: matches } = useListMatches(listParams, {
    query: { queryKey: getListMatchesQueryKey(listParams) },
  });
  const sorted = useMemo(
    () => [...(matches ?? [])].sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? "")),
    [matches],
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected: Match | undefined = sorted.find(m => m.id === selectedId);

  const [possession, setPossession] = useState("");
  const [shots, setShots] = useState("");
  const [oppShots, setOppShots] = useState("");
  const [passes, setPasses] = useState("");
  const [oppPasses, setOppPasses] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Pre-fill from the selected match so existing values can be tweaked.
  useEffect(() => {
    setOk(null); setErr(null);
    setPossession(selected?.possession != null ? String(selected.possession) : "");
    setShots(selected?.shots != null ? String(selected.shots) : "");
    setOppShots(selected?.oppShots != null ? String(selected.oppShots) : "");
    setPasses(selected?.passes != null ? String(selected.passes) : "");
    setOppPasses(selected?.oppPasses != null ? String(selected.oppPasses) : "");
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useUpdateMatch({ mutation: {
    onSuccess: () => {
      setOk("Saved — the Match Report tab will pick these up straight away.");
      // Refresh anything built from match rows (match list + match report).
      void queryClient.invalidateQueries({ queryKey: ["/api/matches"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/analytics/match-report"] });
    },
    onError: (e) => setErr(errMsg(e)),
  }});

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const missing = (m: Match) => m.possession == null || m.shots == null || m.passes == null || m.oppShots == null || m.oppPasses == null;
  const label = (m: Match) => {
    const round = /^R(\d+)/i.exec(m.matchId)?.[0] ?? m.matchId;
    return `${round} v ${m.opponent}${m.fullScore ? ` (${m.fullScore})` : ""}${m.matchDate ? ` — ${m.matchDate}` : ""}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Veo stats to a saved match</CardTitle>
        <CardDescription>
          Pick a match that's already in (e.g. synced from Dribl) and fill in possession, shots and passes —
          no need to re-enter the match. Missing numbers hide their tiles on the Match Report tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Match">
          <Select value={selectedId != null ? String(selectedId) : ""} onValueChange={v => setSelectedId(Number(v))}>
            <SelectTrigger className="max-w-md"><SelectValue placeholder="Choose a match" /></SelectTrigger>
            <SelectContent>
              {sorted.map(m => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {label(m)}{missing(m) ? "  ·  stats missing" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {selected && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Field label="Possession %">
                <Input type="number" min={0} max={100} step="0.1" value={possession} onChange={e => setPossession(e.target.value)} />
              </Field>
              <Field label="Our shots">
                <Input type="number" min={0} value={shots} onChange={e => setShots(e.target.value)} />
              </Field>
              <Field label="Their shots">
                <Input type="number" min={0} value={oppShots} onChange={e => setOppShots(e.target.value)} />
              </Field>
              <Field label="Our passes">
                <Input type="number" min={0} value={passes} onChange={e => setPasses(e.target.value)} />
              </Field>
              <Field label="Their passes">
                <Input type="number" min={0} value={oppPasses} onChange={e => setOppPasses(e.target.value)} />
              </Field>
            </div>
            <div className="flex items-center gap-3">
              <Button
                disabled={update.isPending}
                onClick={() => {
                  setOk(null); setErr(null);
                  update.mutate({ id: selected.id, data: {
                    possession: num(possession),
                    shots: num(shots), oppShots: num(oppShots),
                    passes: num(passes), oppPasses: num(oppPasses),
                  }});
                }}
              >
                {update.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save stats"}
              </Button>
              <StatusLine ok={ok} err={err} />
            </div>
          </>
        )}
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

function GoalForm({ teamId, seasonId, fixtures }: {
  teamId: number; seasonId: number; fixtures: LeagueMatchInfo[];
}) {
  const { data: vocabData } = useGetGoalVocab({ query: { queryKey: getGetGoalVocabQueryKey() } });
  const vocab = vocabData ?? DEFAULT_GOAL_VOCAB;
  const [matchId, setMatchId] = useState("");
  const [scorerTeam, setScorerTeam] = useState("");
  const [minute, setMinute] = useState("");
  const [scorer, setScorer] = useState("");
  const [assist, setAssist] = useState("");
  const [scorerNum, setScorerNum] = useState("");
  const [assistNum, setAssistNum] = useState("");
  const [goalType, setGoalType] = useState("");
  const [assistType, setAssistType] = useState("");
  const [howPenetrated, setHowPenetrated] = useState("");
  const [buildupLane, setBuildupLane] = useState("");
  const [finishType, setFinishType] = useState("");
  const [firstTime, setFirstTime] = useState(false);
  const [passString, setPassString] = useState("");
  const [source, setSource] = useState("");
  // Remembers a Source value WE auto-picked (Buildup on 6+ passes) so we only
  // ever overwrite/clear our own auto-pick, never the coach's manual choice.
  const sourceAutoRef = useRef<string | null>(null);
  const [goalX, setGoalX] = useState<number | null>(null);
  const [goalY, setGoalY] = useState<number | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const fixture = fixtures.find(f => f.matchId === matchId);
  useEffect(() => { setScorerTeam(""); }, [matchId]);
  useEffect(() => { setScorerNum(""); setAssistNum(""); }, [matchId, scorerTeam]);

  // Match sheet for the scoring team — lets the analyst enter a shirt number
  // and have the name populate, for leagues where the names aren't familiar.
  const { data: sheetPlayers } = useListEntryPlayerStats(
    { seasonId, matchId, club: scorerTeam },
    { query: { enabled: !!matchId && !!scorerTeam, queryKey: getListEntryPlayerStatsQueryKey({ seasonId, matchId, club: scorerTeam }) } },
  );
  const sheetHasNumbers = (sheetPlayers?.rows ?? []).some(r => r.shirtNumber);
  const nameByNumber = (num: string): string | null => {
    const n = num.trim();
    if (!n) return null;
    const hit = (sheetPlayers?.rows ?? []).find(r => (r.shirtNumber ?? "").trim() === n);
    return hit?.playerName ?? null;
  };
  // Track names WE auto-filled so an unmatched number never leaves a stale
  // player behind (hand-typed names are left alone).
  const scorerAutoRef = useRef<string | null>(null);
  const assistAutoRef = useRef<string | null>(null);
  const onNumChange = (
    raw: string,
    setNum: (v: string) => void,
    setName: (v: string) => void,
    currentName: string,
    autoRef: React.MutableRefObject<string | null>,
  ) => {
    const num = raw.replace(/[^0-9]/g, "");
    setNum(num);
    const name = nameByNumber(num);
    if (name) {
      setName(name);
      autoRef.current = name;
    } else if (autoRef.current && currentName === autoRef.current) {
      setName("");
      autoRef.current = null;
    }
  };
  // If a number was typed before the match sheet finished loading, resolve it
  // once the sheet arrives.
  useEffect(() => {
    const s = nameByNumber(scorerNum);
    if (s) { setScorer(s); scorerAutoRef.current = s; }
    const a = nameByNumber(assistNum);
    if (a) { setAssist(a); assistAutoRef.current = a; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetPlayers]);

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

  const clearDetail = () => {
    setMinute(""); setScorer(""); setAssist(""); setGoalType(""); setAssistType("");
    setHowPenetrated(""); setBuildupLane(""); setFinishType(""); setFirstTime(false);
    setPassString(""); setGoalX(null); setGoalY(null);
    setSource(""); sourceAutoRef.current = null;
    setScorerNum(""); setAssistNum("");
    scorerAutoRef.current = null; assistAutoRef.current = null;
  };

  // Inswinger/Outswinger are dead-ball crosses — only offered on corner (SP-C)
  // and free-kick (SP-F) goal types. Clearing happens only when the COACH
  // changes goal type (see onGoalTypeChange), never when an old goal loads,
  // so legacy data survives unrelated edits.
  const isSetPieceCross = SET_PIECE_CROSS_TYPES.has(goalType);
  const assistTypeOptions = isSetPieceCross
    ? vocab.assistTypes
    : vocab.assistTypes.filter(o => !SWINGER_ASSIST_TYPES.has(o));
  const onGoalTypeChange = (v: string) => {
    setGoalType(v);
    if (!SET_PIECE_CROSS_TYPES.has(v) && SWINGER_ASSIST_TYPES.has(assistType)) setAssistType("");
  };

  // Buildup goals are 6+ passes: auto-pick Source when the pass string says so,
  // but only overwrite/clear our own auto-pick, never a manual choice.
  useEffect(() => {
    const n = Number(passString);
    const isBuildup = passString.trim() !== "" && Number.isFinite(n) && n >= 6;
    if (isBuildup) {
      if (source === "" || source === sourceAutoRef.current) {
        sourceAutoRef.current = "Buildup";
        setSource("Buildup");
      }
    } else if (sourceAutoRef.current != null && source === sourceAutoRef.current) {
      sourceAutoRef.current = null;
      setSource("");
    }
  }, [passString, source]);

  const create = useCreateEntryGoal({ mutation: {
    onSuccess: (res) => {
      invalidateGoalQueries();
      setOk(`Goal saved${res.belconnenGoalId != null ? " (Belconnen copy written too)" : ""} — ready for the next one`);
      // keep match + scorer team selected for rapid entry; clear the goal detail
      clearDetail();
    },
    onError: (e) => setErr(errMsg(e)),
  }});

  // Edit mode: load a logged goal into the form, then save updates it in place.
  // Switching fixture is a full edit cancel — stale detail must not leak into
  // a create for the new match.
  const [editingGoalId, setEditingGoalId] = useState<number | null>(null);
  useEffect(() => { setEditingGoalId(null); clearDetail(); }, [matchId]); // eslint-disable-line react-hooks/exhaustive-deps
  const startGoalEdit = (g: EntryGoalListItem) => {
    setOk(null); setErr(null);
    setEditingGoalId(g.id);
    setScorerTeam(g.scorerTeam ?? "");
    setMinute(g.minuteScored == null ? "" : String(g.minuteScored));
    setScorer(g.scorer ?? "");
    setAssist(g.assist ?? "");
    setGoalType(g.goalType ?? "");
    setAssistType(g.assistType ?? "");
    setHowPenetrated(g.howPenetrated ?? "");
    setBuildupLane(g.buildupLane ?? "");
    setFinishType(g.finishType ?? "");
    setFirstTime(g.firstTimeFinish === true);
    setPassString(g.passString ?? "");
    setSource(g.source ?? ""); sourceAutoRef.current = null;
    setGoalX(g.goalX == null ? null : Number(g.goalX));
    setGoalY(g.goalY == null ? null : Number(g.goalY));
  };
  const cancelGoalEdit = () => { setEditingGoalId(null); clearDetail(); };
  const update = useUpdateEntryGoal({ mutation: {
    onSuccess: (res) => {
      invalidateGoalQueries();
      setEditingGoalId(null);
      clearDetail();
      setOk(`Goal updated${res.belconnenUpdated ? " (Belconnen copy updated too)" : ""}`);
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
                {!g.goalType && !g.assistType && !g.finishType && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">details to add</Badge>
                )}
                {editingGoalId === g.id && <Badge className="text-xs">editing below</Badge>}
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 ml-auto text-muted-foreground"
                  disabled={update.isPending}
                  onClick={() => startGoalEdit(g)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  disabled={removeGoal.isPending}
                  onClick={() => { setOk(null); setErr(null); if (editingGoalId === g.id) cancelGoalEdit(); removeGoal.mutate({ goalId: g.id }); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Field label="Minute" className="w-20 shrink-0">
            <Input type="number" min={0} max={130} value={minute} onChange={e => setMinute(e.target.value)} />
          </Field>
          <Field label="Scorer" className="flex-1 min-w-[220px] basis-full sm:basis-auto">
            <div className="flex gap-1.5">
              {sheetHasNumbers && (
                <Input
                  className={`w-14 shrink-0 ${scorerNum && !nameByNumber(scorerNum) ? "border-chart-4" : ""}`}
                  value={scorerNum} inputMode="numeric" placeholder="#"
                  title="Shirt number — fills the name from the match sheet"
                  onChange={e => onNumChange(e.target.value, setScorerNum, setScorer, scorer, scorerAutoRef)}
                />
              )}
              <Input className="min-w-0" value={scorer} onChange={e => { setScorer(e.target.value); setScorerNum(""); scorerAutoRef.current = null; }} placeholder="J.Bloggs (or Own Goal)" />
            </div>
          </Field>
          <Field label="Assist" className="flex-1 min-w-[220px] basis-full sm:basis-auto">
            <div className="flex gap-1.5">
              {sheetHasNumbers && (
                <Input
                  className={`w-14 shrink-0 ${assistNum && !nameByNumber(assistNum) ? "border-chart-4" : ""}`}
                  value={assistNum} inputMode="numeric" placeholder="#"
                  title="Shirt number — fills the name from the match sheet"
                  onChange={e => onNumChange(e.target.value, setAssistNum, setAssist, assist, assistAutoRef)}
                />
              )}
              <Input className="min-w-0" value={assist} onChange={e => { setAssist(e.target.value); setAssistNum(""); assistAutoRef.current = null; }} placeholder="Blank if none" />
            </div>
          </Field>
        </div>

        <div className="flex flex-wrap gap-3">
          <LockedSelect label="Goal type" value={goalType} onChange={onGoalTypeChange} options={vocab.goalTypes} className="w-[7.5rem] shrink-0" />
          <LockedSelect label="Assist type" value={assistType} onChange={setAssistType} options={assistTypeOptions} className="w-36 shrink-0" />
          <LockedSelect label="Source" value={source} onChange={v => { setSource(v); sourceAutoRef.current = null; }} options={vocab.sources} className="w-28 shrink-0" />
          <LockedSelect label="How penetrated" value={howPenetrated} onChange={setHowPenetrated} options={vocab.howPenetrated} className="w-[7.75rem] shrink-0" />
          <LockedSelect label="Buildup lane" value={buildupLane} onChange={setBuildupLane} options={vocab.buildupLanes} className="w-28 shrink-0" />
          <LockedSelect label="Finish" value={finishType} onChange={setFinishType} options={vocab.finishTypes} className="w-32 shrink-0" />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Pass string" className="w-24 shrink-0">
            <Input type="number" min={0} value={passString} onChange={e => setPassString(e.target.value)} title="Passes in buildup" />
          </Field>
          <label className="flex items-center gap-2 text-sm cursor-pointer pb-2.5">
            <Checkbox checked={firstTime} onCheckedChange={v => setFirstTime(v === true)} />
            First-time finish
          </label>
        </div>

        <GoalSpotPicker goalX={goalX} goalY={goalY} onPick={(x, y) => { setGoalX(x); setGoalY(y); }} />

        <div className="flex items-center gap-3">
          <Button
            disabled={!fixture || !scorerTeam || create.isPending || update.isPending}
            onClick={() => {
              setOk(null); setErr(null);
              const detail = {
                scorerTeam,
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
                source: source.trim() || null,
                goalX, goalY,
              };
              if (editingGoalId != null) update.mutate({ goalId: editingGoalId, data: detail });
              else create.mutate({ data: { teamId, seasonId, matchId, ...detail } });
            }}
          >
            {(create.isPending || update.isPending) ? <Loader2 className="h-4 w-4 animate-spin" /> : editingGoalId != null ? "Update goal" : "Save goal"}
          </Button>
          {editingGoalId != null && (
            <Button variant="ghost" onClick={cancelGoalEdit}>Cancel edit</Button>
          )}
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

// Position codes + the shared position→unit mapping (same units as the GPS
// Positions tab) — shared with the API server via @workspace/api-zod.
import { POSITION_CODES as POSITIONS, unitForPosition, clubCodesFor } from "@workspace/api-zod";
const unitFor = (pos: string): string | null => unitForPosition(pos);

function PlayersForm({ teamId, seasonId, leagueId, fixtures }: {
  teamId: number; seasonId: number; leagueId: number; fixtures: LeagueMatchInfo[];
}) {
  const [matchId, setMatchId] = useState("");
  const [club, setClub] = useState("");
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Screenshot-read rows replace the whole saved sheet on save; hand-added
  // rows on top of an already-saved sheet are appended instead.
  const [rowsFromExtract, setRowsFromExtract] = useState(false);
  const fixture = fixtures.find(f => f.matchId === matchId);
  useEffect(() => { setClub(""); setRows([]); setWarnings([]); setOk(null); setErr(null); setRowsFromExtract(false); }, [matchId]);

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

  // Assigned positions from the Positions tab — used as the default shown when a
  // row has no per-game position recorded (a player may play a different role in
  // any one game; editing the row overrides the default for that game only).
  const { data: assignedPositions } = useListGpsPlayerPositions(
    { query: { queryKey: getListGpsPlayerPositionsQueryKey() } },
  );
  const assignedPositionFor = (statName: string): string | null => {
    if (!assignedPositions?.length) return null;
    const norm = (s: string) => s.toLowerCase().trim();
    const target = norm(statName);
    if (!target) return null;
    const hit = assignedPositions.find(a => {
      const full = norm(a.playerName);
      if (full === target) return true;
      // Stats rows use short names (e.g. "Ailish"); GPS names can be fuller — match on a whole word.
      return full.split(/[^a-z']+/).includes(target);
    });
    return hit?.position ?? null;
  };

  // Inline edit of a saved row (fix a name the sync brought in wrong, etc.)
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editShirt, setEditShirt] = useState("");
  const [editMins, setEditMins] = useState("");
  const [editPos, setEditPos] = useState("__none__");
  const [origPos, setOrigPos] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<"started" | "bench" | "unused">("started");
  const startEdit = (p: { id: number; playerName: string; shirtNumber: string | null; minsPlayed: number | null; position: string | null; started: boolean; appearance: boolean }) => {
    setEditingId(p.id);
    setEditName(p.playerName);
    setEditShirt(p.shirtNumber ?? "");
    setEditMins(p.minsPlayed == null ? "" : String(p.minsPlayed));
    setEditPos(p.position ?? "__none__");
    setOrigPos(p.position ?? null);
    setEditStatus(p.started ? "started" : p.appearance ? "bench" : "unused");
  };
  const updateSaved = useUpdateEntryPlayerStat({ mutation: {
    onSuccess: (res) => {
      invalidatePlayerQueries();
      setEditingId(null);
      setOk(`Player updated${res.belconnenUpdated ? " (Belconnen copy updated too)" : ""}`);
    },
    onError: (e) => setErr(errMsg(e)),
  }});
  const saveEdit = () => {
    if (editingId == null || !editName.trim()) return;
    setOk(null); setErr(null);
    updateSaved.mutate({ rowId: editingId, data: {
      playerName: editName.trim(),
      shirtNumber: editShirt.trim() || null,
      minsPlayed: editMins.trim() === "" ? null : Number(editMins),
      // Only send position when it actually changed — older saved rows can carry
      // free-text positions the edit schema would reject if re-submitted as-is.
      ...((editPos === "__none__" ? null : editPos) !== origPos
        ? { position: editPos === "__none__" ? null : editPos }
        : {}),
      started: editStatus === "started",
      appearance: editStatus !== "unused",
    }});
  };

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
      setRowsFromExtract(true);
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
      setRows([]); setWarnings([]); setClub(""); setRowsFromExtract(false);
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
      extract.mutate({ data: { imageBase64: dataUrl, club: club || null, leagueId: leagueId || null } });
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
              editingId === p.id ? (
                <div key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm bg-muted/30">
                  <Input
                    value={editShirt} onChange={e => setEditShirt(e.target.value.replace(/[^0-9]/g, ""))}
                    className="h-8 w-14 text-sm" placeholder="#" inputMode="numeric"
                  />
                  <Input
                    value={editName} onChange={e => setEditName(e.target.value)}
                    className="h-8 w-44 text-sm" placeholder="Player name" autoFocus
                    onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                  />
                  <Input
                    value={editMins} onChange={e => setEditMins(e.target.value.replace(/[^0-9]/g, ""))}
                    className="h-8 w-20 text-sm" placeholder="Mins" inputMode="numeric"
                  />
                  <Select value={editPos} onValueChange={setEditPos}>
                    <SelectTrigger className="h-8 w-28 text-sm"><SelectValue placeholder="Pos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No pos</SelectItem>
                      {origPos && !POSITIONS.includes(origPos as (typeof POSITIONS)[number]) && (
                        <SelectItem value={origPos}>{origPos}</SelectItem>
                      )}
                      {POSITIONS.map(pos => <SelectItem key={pos} value={pos}>{pos}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={editStatus} onValueChange={v => setEditStatus(v as typeof editStatus)}>
                    <SelectTrigger className="h-8 w-32 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="started">Started</SelectItem>
                      <SelectItem value="bench">Off bench</SelectItem>
                      <SelectItem value="unused">Didn't play</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="flex items-center gap-1.5 ml-auto">
                    <Button size="sm" className="h-8 text-xs" disabled={updateSaved.isPending || !editName.trim()} onClick={saveEdit}>
                      {updateSaved.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
                  </span>
                </div>
              ) : (
              <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                <span className="font-medium">{p.shirtNumber ? <span className="text-muted-foreground mr-1">#{p.shirtNumber}</span> : null}{p.playerName}</span>
                <span className="text-xs text-muted-foreground">
                  {p.started ? "started" : p.appearance ? "off bench" : "didn't play"}
                  {p.minsPlayed != null ? ` · ${p.minsPlayed} mins` : ""}
                  {p.position
                    ? (() => { const u = unitFor(p.position); return u && u !== p.position ? ` · ${p.position} (${u})` : ` · ${p.position}`; })()
                    : (() => { const d = assignedPositionFor(p.playerName); return d ? ` · ${d} (usual)` : ""; })()}
                </span>
                {p.discipline && <Badge variant="outline" className="text-xs">{p.discipline}</Badge>}
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 ml-auto text-muted-foreground"
                  disabled={updateSaved.isPending}
                  onClick={() => { setOk(null); setErr(null); startEdit(p); }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  disabled={removeSaved.isPending}
                  onClick={() => { setOk(null); setErr(null); removeSaved.mutate({ rowId: p.id }); }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              )
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
              onClick={() => setRows(rs => [...rs, { playerName: "", shirtNumber: null, minsPlayed: 90, position: null, discipline: null, started: true, appearance: true }])}
            >
              <Plus className="h-4 w-4 mr-2" />Add row
            </Button>
            {rows.length > 0 && (
              <Button
                variant="outline"
                onClick={() => { setRows([]); setWarnings([]); setOk(null); setErr(null); setRowsFromExtract(false); }}
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
                  <th className="text-left py-2 pr-2 font-medium">#</th>
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
                    <td className="py-1.5 pr-2 w-14">
                      <Input className="h-8" value={r.shirtNumber ?? ""} inputMode="numeric" onChange={e => update(i, { shirtNumber: e.target.value.replace(/[^0-9]/g, "") || null })} placeholder="#" />
                    </td>
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
              // Hand-added rows on top of an already-saved sheet: append (only
              // same-named players are replaced). Screenshot reads keep the
              // old behaviour — re-saving replaces the whole sheet.
              const append = !rowsFromExtract && (savedPlayers?.rows.length ?? 0) > 0;
              save.mutate({ data: { teamId, seasonId, matchId, club, rows, ...(append ? { append: true } : {}) } });
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

interface ReviewClub {
  name: string;
  fullName: string | null;
  primaryColor: string;
  logoUrl: string | null;
  logoBroken?: boolean;
}

/** AI club finder: ladder screenshot or league name → editable review table → bulk save. */
function ClubFinder({ leagueId, existingNames, onSaved }: {
  leagueId: number | null; existingNames: string[]; onSaved: (added: number) => void;
}) {
  const [clubs, setClubs] = useState<ReviewClub[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Clear the review table when the coach switches league
  useEffect(() => { setClubs([]); setWarnings([]); setOk(null); setErr(null); }, [leagueId]);

  const extract = useExtractClubsFromLeague({ mutation: {
    onSuccess: (res) => {
      setClubs(res.clubs.map(c => ({ name: c.name, fullName: c.fullName ?? null, primaryColor: c.primaryColor, logoUrl: c.logoUrl ?? null })));
      setWarnings(res.warnings);
      setOk(`Found ${res.clubs.length} clubs — check names, colours and logos, then save`);
    },
    onError: (e) => setErr(errMsg(e)),
  }});

  const createClub = useCreateClub();

  const busy = extract.isPending || saving;
  const existing = new Set(existingNames.map(n => n.toLowerCase()));

  const runExtract = (imageBase64: string | null) => {
    if (leagueId == null) return;
    setOk(null); setErr(null); setClubs([]); setWarnings([]);
    extract.mutate({ data: { leagueId, imageBase64, leagueName: null } });
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => runExtract(reader.result as string);
    reader.readAsDataURL(file);
  };

  const update = (i: number, patch: Partial<ReviewClub>) =>
    setClubs(cs => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const saveAll = async () => {
    if (leagueId == null) return;
    setOk(null); setErr(null); setSaving(true);
    let added = 0;
    const failed: string[] = [];
    for (const c of clubs) {
      if (!c.name.trim() || existing.has(c.name.trim().toLowerCase())) continue;
      try {
        await createClub.mutateAsync({ data: {
          leagueId,
          name: c.name.trim(),
          primaryColor: c.primaryColor,
          logoUrl: c.logoUrl?.trim() || null,
        }});
        added += 1;
      } catch (e) {
        failed.push(`${c.name}: ${errMsg(e)}`);
      }
    }
    setSaving(false);
    if (failed.length > 0) setErr(`Saved ${added}, but some failed — ${failed.join("; ")}`);
    else { setOk(`Added ${added} clubs to the league`); setClubs([]); setWarnings([]); }
    onSaved(added);
  };

  const skippedCount = clubs.filter(c => existing.has(c.name.trim().toLowerCase())).length;
  const toSaveCount = clubs.filter(c => c.name.trim() && !existing.has(c.name.trim().toLowerCase())).length;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ScanText className="h-4 w-4 text-primary shrink-0" />
        <p className="text-sm font-medium">Set up clubs automatically</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Upload a ladder or fixture screenshot and AI reads off the club list — or let it search from the
        league name alone. It fills in each club's real colours and logo for you to check before saving.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
        />
        <Button variant="outline" size="sm" disabled={leagueId == null || busy} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4 mr-1.5" />Read a ladder screenshot
        </Button>
        <Button variant="outline" size="sm" disabled={leagueId == null || busy} onClick={() => runExtract(null)}>
          <ScanText className="h-4 w-4 mr-1.5" />Find clubs from the league name
        </Button>
        {extract.isPending && <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Working it out…</span>}
        {leagueId == null && <span className="text-xs text-muted-foreground">Pick a league first</span>}
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-chart-4"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />{w}</div>
          ))}
        </div>
      )}

      {clubs.length > 0 && (
        <div className="space-y-2">
          <div className="rounded-md border bg-background divide-y divide-border/40">
            {clubs.map((c, i) => {
              const isDup = existing.has(c.name.trim().toLowerCase());
              return (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="h-8 w-8 shrink-0 rounded border bg-muted/40 flex items-center justify-center overflow-hidden">
                    {c.logoUrl && !c.logoBroken ? (
                      <img
                        src={c.logoUrl} alt="" className="h-full w-full object-contain"
                        onError={() => update(i, { logoBroken: true })}
                      />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: c.primaryColor }} />
                    )}
                  </span>
                  <div className="grid flex-1 gap-1.5 sm:grid-cols-[minmax(120px,1fr)_64px_minmax(160px,1.4fr)] items-center">
                    <div>
                      <Input
                        value={c.name} onChange={e => update(i, { name: e.target.value })}
                        className={`h-8 ${isDup ? "border-chart-4" : ""}`} placeholder="Short name"
                      />
                      {c.fullName && <p className="text-[11px] text-muted-foreground truncate mt-0.5">{c.fullName}</p>}
                      {isDup && <p className="text-[11px] text-chart-4 mt-0.5">Already in this league — will be skipped</p>}
                    </div>
                    <Input
                      type="color" value={c.primaryColor}
                      onChange={e => update(i, { primaryColor: e.target.value })}
                      className="h-8 p-1 cursor-pointer"
                    />
                    <Input
                      value={c.logoUrl ?? ""} onChange={e => update(i, { logoUrl: e.target.value || null, logoBroken: false })}
                      className="h-8 text-xs" placeholder="Logo URL (optional)"
                    />
                  </div>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground"
                    onClick={() => setClubs(cs => cs.filter((_, j) => j !== i))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={busy || toSaveCount === 0} onClick={() => void saveAll()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Plus className="h-4 w-4 mr-1.5" />}
              Add {toSaveCount} club{toSaveCount === 1 ? "" : "s"}
            </Button>
            {skippedCount > 0 && <span className="text-xs text-muted-foreground">{skippedCount} already in the league</span>}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setClubs([]); setWarnings([]); setOk(null); setErr(null); }}>Clear</Button>
          </div>
        </div>
      )}
      <StatusLine ok={ok} err={err} />
    </div>
  );
}

interface BrandingRow {
  clubId: number;
  name: string;
  currentColor: string;
  currentLogoUrl: string | null;
  primaryColor: string;
  logoUrl: string | null;
  include: boolean;
  logoBroken?: boolean;
}
function LeagueSetupCard() {
  const queryClient = useQueryClient();
  const { isSuperadmin } = useLeagueModules();
  const { data: leagues } = useListLeagues();
  const { data: seasons } = useListSeasons();
  const { data: clubs } = useGetClubs();

  const [leagueName, setLeagueName] = useState("");
  const [leagueRegion, setLeagueRegion] = useState("");
  const [seasonLeagueId, setSeasonLeagueId] = useState("");
  const [seasonYear, setSeasonYear] = useState(String(new Date().getFullYear()));
  const [seasonActive, setSeasonActive] = useState(false);
  const [clubLeagueId, setClubLeagueId] = useState("");
  const [copySourceLeagueId, setCopySourceLeagueId] = useState("");
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
  const copyClubs = useCopyClubsFromLeague({ mutation: {
    onSuccess: (r) => {
      setMsg({ ok: true, text: `Copied clubs across — ${r.added} added, ${r.updated} updated (colours & logos refreshed).` });
      setCopySourceLeagueId("");
      invalidate();
    },
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
          </div>
          {clubLeagueId && (leagues ?? []).length > 1 && (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-3">
              <p className="text-sm font-medium">Copy clubs from another league <span className="text-muted-foreground font-normal">(names, colours & logos — adds or refreshes, never removes)</span></p>
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] items-end">
                <div className="space-y-1.5">
                  <Label>Copy from</Label>
                  <Select value={copySourceLeagueId} onValueChange={setCopySourceLeagueId}>
                    <SelectTrigger><SelectValue placeholder="Select league to copy from" /></SelectTrigger>
                    <SelectContent>
                      {(leagues ?? []).filter(l => String(l.id) !== clubLeagueId).map(l => {
                        const n = (clubs ?? []).filter(c => c.leagueId === l.id).length;
                        return <SelectItem key={l.id} value={String(l.id)}>{l.name} ({n} club{n === 1 ? "" : "s"})</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="secondary"
                  disabled={!copySourceLeagueId || copyClubs.isPending}
                  onClick={() => {
                    setMsg(null);
                    copyClubs.mutate({ data: { leagueId: Number(clubLeagueId), sourceLeagueId: Number(copySourceLeagueId) } });
                  }}
                >
                  {copyClubs.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
                  Copy clubs
                </Button>
              </div>
            </div>
          )}
          <ClubFinder
            leagueId={clubLeagueId ? Number(clubLeagueId) : null}
            existingNames={(clubs ?? []).filter(c => String(c.leagueId) === clubLeagueId).map(c => c.name)}
            onSaved={() => invalidate()}
          />
          <ClubBrandingFixer
            leagueId={clubLeagueId ? Number(clubLeagueId) : null}
            clubCount={(clubs ?? []).filter(c => String(c.leagueId) === clubLeagueId).length}
            onSaved={() => invalidate()}
          />
          <div className="grid gap-4 sm:grid-cols-[1fr_90px_auto] items-end">
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

      <GoalVocabCard />

      {isSuperadmin && <GpsFeedCard leagues={leagues ?? []} onSaved={invalidate} setMsg={setMsg} />}

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
                      {c.logoUrl ? (
                        <img src={c.logoUrl} alt="" className="h-4 w-4 object-contain" />
                      ) : (
                        <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: c.primaryColor }} />
                      )}
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

/**
 * Goal-coding vocabulary editor: the Goals-tab dropdown lists (goal type,
 * assist type, how penetrated, buildup lane, finish). One global house
 * standard — add / remove / reorder options per field, then save. Old goals
 * keep any retired value selectable (LockedSelect handles legacy values).
 */
const VOCAB_FIELD_META: Array<{ key: keyof GoalVocabResponse; label: string }> = [
  { key: "goalTypes", label: "Goal type" },
  { key: "assistTypes", label: "Assist type" },
  { key: "sources", label: "Source" },
  { key: "howPenetrated", label: "How penetrated" },
  { key: "buildupLanes", label: "Buildup lane" },
  { key: "finishTypes", label: "Finish" },
];
/**
 * GPS data feed (superadmin only): point a league's GPS reads at another
 * league's uploads, filtered to one squad — e.g. the Reserves league reads the
 * reserves rows already inside the NPLW Catapult uploads. Read-only share: no
 * rows are copied, and fixes/re-uploads in the source league flow through.
 */
const FEED_SQUADS = ["Reserves", "1sts", "17s / 18s"];

function GpsFeedCard({ leagues, onSaved, setMsg }: {
  leagues: LeagueInfo[];
  onSaved: () => void;
  setMsg: (m: { ok: boolean; text: string } | null) => void;
}) {
  const [leagueId, setLeagueId] = useState("");
  const selected = leagues.find(l => String(l.id) === leagueId);
  const [sourceId, setSourceId] = useState("");
  const [squad, setSquad] = useState("Reserves");
  useEffect(() => {
    setSourceId(selected?.gpsSourceLeagueId != null ? String(selected.gpsSourceLeagueId) : "");
    setSquad(selected?.gpsSourceSquad ?? "Reserves");
  }, [selected?.id, selected?.gpsSourceLeagueId, selected?.gpsSourceSquad]);

  const update = useUpdateLeague({ mutation: {
    onSuccess: (l) => {
      setMsg({ ok: true, text: l.gpsSourceLeagueId != null
        ? `"${l.name}" now reads GPS data from ${leagues.find(x => x.id === l.gpsSourceLeagueId)?.name ?? "the source league"} (${l.gpsSourceSquad} squad) — no re-uploading needed.`
        : `GPS feed removed — "${l.name}" is back to its own GPS uploads.` });
      onSaved();
    },
    onError: (e) => setMsg({ ok: false, text: errMsg(e) }),
  }});

  return (
    <Card>
      <CardHeader>
        <CardTitle>GPS data feed</CardTitle>
        <CardDescription>
          Let a league show GPS numbers that were already uploaded in another league — e.g. the Reserves
          league reads the reserves rows inside the firsts' Catapult uploads. Nothing is copied: fixes and
          re-uploads in the source league appear here automatically, and the fed league stays read-only.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_140px_auto_auto] items-end">
        <div className="space-y-1.5">
          <Label>League</Label>
          <Select value={leagueId} onValueChange={setLeagueId}>
            <SelectTrigger><SelectValue placeholder="Select league" /></SelectTrigger>
            <SelectContent>
              {leagues.map(l => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name}{l.gpsSourceLeagueId != null ? " · fed" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Reads GPS data from</Label>
          <Select value={sourceId} onValueChange={setSourceId} disabled={!leagueId}>
            <SelectTrigger><SelectValue placeholder="Source league" /></SelectTrigger>
            <SelectContent>
              {leagues.filter(l => String(l.id) !== leagueId && l.gpsSourceLeagueId == null).map(l => (
                <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Squad</Label>
          <Select value={squad} onValueChange={setSquad} disabled={!leagueId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{FEED_SQUADS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button
          disabled={!leagueId || !sourceId || update.isPending}
          onClick={() => {
            setMsg(null);
            update.mutate({ id: Number(leagueId), data: { gpsSourceLeagueId: Number(sourceId), gpsSourceSquad: squad } });
          }}
        >
          {update.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
          Save feed
        </Button>
        <Button
          variant="outline"
          disabled={!leagueId || selected?.gpsSourceLeagueId == null || update.isPending}
          onClick={() => {
            setMsg(null);
            update.mutate({ id: Number(leagueId), data: { gpsSourceLeagueId: null, gpsSourceSquad: null } });
          }}
        >
          Remove feed
        </Button>
      </CardContent>
    </Card>
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

function TestingUploadForm({ teamId, leagueId }: { teamId: number; leagueId: number }) {
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
              onClick={() => { setOk(null); setErr(null); save.mutate({ data: { leagueId, year: year.trim(), teamId, rows } }); }}
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

function GpsUploadForm({ teamId, leagueId }: { teamId: number; leagueId: number }) {
  const [matchDate, setMatchDate] = useState("");
  const [roundCode, setRoundCode] = useState("");
  const [squad, setSquad] = useState<string>("1sts");
  const [opponent, setOpponent] = useState("");
  const [fixtureKey, setFixtureKey] = useState("");
  const [entries, setEntries] = useState<GpsEntry[]>([]);
  const [ignoredSplits, setIgnoredSplits] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
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

  // Known fixtures (this league's + its fed reserves league's) — picking one
  // fills date/round/squad/opponent so the round code always matches a real game.
  const { data: gpsFixtures } = useListEntryGpsFixtures(
    { leagueId },
    { query: { queryKey: getListEntryGpsFixturesQueryKey({ leagueId }) } },
  );
  const squadValueOf = (label: string) =>
    label === "Reserves" ? "res" : label === "17s / 18s" ? "18s" : "1sts";
  const pickFixture = (key: string) => {
    setFixtureKey(key);
    const f = gpsFixtures?.[Number(key)];
    if (!f) return;
    setMatchDate(f.matchDateIso ?? "");
    setRoundCode(f.round);
    setSquad(squadValueOf(f.squad));
    setOpponent(f.opponent);
  };

  async function handleFile(file: File) {
    await parseInput(() => file.arrayBuffer(), file.name);
  }

  async function handlePaste(text: string) {
    await parseInput(async () => text, "pasted rows");
  }

  async function parseInput(getData: () => Promise<string | ArrayBuffer>, label: string) {
    setParsing(true); setOk(null); setErr(null);
    setEntries([]); setIgnoredSplits(0); setFileName(label);
    try {
      const XLSX = await import("xlsx");
      const data = await getData();
      const wb = typeof data === "string"
        ? XLSX.read(data, { type: "string" })
        : XLSX.read(data, { type: "array" });
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
        // Raw Catapult exports call the whole-match split "all" — treat it as "game".
        let split = (row.splitName ?? "game").toLowerCase();
        if (split === "all") split = "game";
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
          leagueId, year: dmy.slice(6), teamId, round, opponent: opp,
          sessionDate: dmy, sessionTitle,
          rows: group.map(g => g.row),
        }});
        totalSaved += res.saved; totalReplaced += res.replaced;
        roundsSaved.push(round);
      }
      setOk(`Saved ${totalSaved} rows for ${roundsSaved.join(" and ")}`
        + (totalReplaced > 0 ? ` (replaced ${totalReplaced} rows previously saved for ${roundsSaved.length > 1 ? "those rounds" : "that round"})` : "")
        + ". New player names? Set their position in the Positions tab.");
      setEntries([]); setIgnoredSplits(0); setFileName(null); setPasteText("");
      setMatchDate(""); setRoundCode(""); setSquad("1sts"); setOpponent(""); setFixtureKey("");
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
          <Field label="…or paste one game's rows (copied from Excel or the CSV, header row included)">
            <div className="space-y-2">
              <Textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder={"Player Name\tSplit Name\tDistance (km)\t…"}
                rows={4}
                className="font-mono text-xs"
              />
              <Button
                type="button" variant="secondary" size="sm"
                disabled={parsing || pasteText.trim() === ""}
                onClick={() => void handlePaste(pasteText)}
              >
                Read pasted rows
              </Button>
            </div>
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
          {!fileMode && (gpsFixtures?.length ?? 0) > 0 && (
            <Field label="Link to a game (fills the four fields below — or fill them in by hand)">
              <Select value={fixtureKey} onValueChange={pickFixture}>
                <SelectTrigger><SelectValue placeholder="Pick the game this GPS data is from…" /></SelectTrigger>
                <SelectContent>
                  {gpsFixtures?.map((f, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {f.round} v {f.opponent}
                      {f.squad !== "1sts" ? ` (${f.squad})` : ""}
                      {f.matchDate ? ` — ${f.matchDate}` : ""} · {f.year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Match date">
              <Input type="date" value={matchDate} onChange={e => { setMatchDate(e.target.value); setFixtureKey(""); }} disabled={fileMode && !needsFormDate} />
            </Field>
            <Field label="Round (e.g. R13, GF)">
              <Input value={roundCode} onChange={e => { setRoundCode(e.target.value); setFixtureKey(""); }} placeholder="R13" disabled={fileMode} />
            </Field>
            <Field label="Squad">
              <Select value={squad} onValueChange={v => { setSquad(v); setFixtureKey(""); }} disabled={fileMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SQUAD_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Opponent">
              <Input value={opponent} onChange={e => { setOpponent(e.target.value); setFixtureKey(""); }} placeholder="Majura" disabled={fileMode} />
            </Field>
          </div>
          {parsing && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Reading {fileName}…</div>}
          <StatusLine ok={ok} err={err} />
        </CardContent>
      </Card>

      {entries.length === 0 && <GpsUploadsManager leagueId={leagueId} />}

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

// ── Saved GPS uploads — see, fix or delete a bad upload ─────────────────────
// One row per (year, round, team) batch — the same unit the replace-on-upload
// works on. Fixing details rewrites every row in the batch; deleting removes it.
function GpsUploadsManager({ leagueId }: { leagueId: number }) {
  const queryClient = useQueryClient();
  const [editKey, setEditKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [eOpponent, setEOpponent] = useState("");
  const [eDate, setEDate] = useState("");
  const [eTitle, setETitle] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { data: uploads, isLoading } = useListEntryGpsUploads(
    { leagueId },
    { query: { queryKey: getListEntryGpsUploadsQueryKey({ leagueId }), enabled: leagueId > 0 } },
  );
  const update = useUpdateEntryGpsUpload();
  const del = useDeleteEntryGpsUpload();

  const refresh = () => {
    // GPS rows feed lots of screens — refetch everything rather than chase every key.
    void queryClient.invalidateQueries();
  };

  type U = NonNullable<typeof uploads>[number];
  const keyOf = (u: U) => `${u.year}|${u.round}|${u.teamId}`;

  const startEdit = (u: U) => {
    setEditKey(keyOf(u)); setConfirmKey(null); setOk(null); setErr(null);
    setEOpponent(u.opponent ?? ""); setEDate(u.sessionDate ?? ""); setETitle(u.sessionTitle ?? "");
  };

  const saveEdit = async (u: U) => {
    setOk(null); setErr(null);
    try {
      await update.mutateAsync({ data: {
        leagueId, year: u.year, round: u.round, teamId: u.teamId,
        opponent: eOpponent.trim() || null,
        sessionDate: eDate.trim() || null,
        sessionTitle: eTitle.trim() || null,
      }});
      setOk(`${u.round} updated`);
      setEditKey(null);
      refresh();
    } catch (e) { setErr(errMsg(e)); }
  };

  const doDelete = async (u: U) => {
    setOk(null); setErr(null);
    try {
      const res = await del.mutateAsync({ params: { leagueId, year: u.year, round: u.round, teamId: u.teamId } });
      setOk(`${u.round} deleted (${res.deleted} rows removed)`);
      setConfirmKey(null);
      refresh();
    } catch (e) { setErr(errMsg(e)); }
  };

  if (leagueId <= 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Saved uploads</CardTitle>
        <CardDescription>
          Every GPS upload saved for this league. If one went in wrong you can fix its match details here,
          or delete it outright — deleting removes that round's GPS data for good (re-uploading the CSV
          brings it back). Bad numbers in the file? Just re-upload the corrected CSV for the same round —
          it replaces the old rows cleanly.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading uploads…</div>}
        {!isLoading && (uploads?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">No GPS uploads saved yet.</p>
        )}
        {(uploads?.length ?? 0) > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50 text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">Round</th>
                  <th className="px-2 py-1.5 text-left font-medium">Squad</th>
                  <th className="px-2 py-1.5 text-left font-medium">Opponent</th>
                  <th className="px-2 py-1.5 text-left font-medium">Date</th>
                  <th className="px-2 py-1.5 text-left font-medium">Year</th>
                  <th className="px-2 py-1.5 text-right font-medium">Players</th>
                  <th className="px-2 py-1.5 text-right font-medium">Rows</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {uploads!.map(u => {
                  const k = keyOf(u);
                  const editing = editKey === k;
                  return (
                    <Fragment key={k}>
                      <tr className="border-b last:border-0">
                        <td className="px-2 py-1.5 font-medium whitespace-nowrap">{u.round}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{u.squad}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{u.opponent ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{u.sessionDate ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-2 py-1.5">{u.year}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{u.players}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{u.rows}</td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center justify-end gap-1.5">
                            {confirmKey === k ? (
                              <>
                                <span className="text-destructive whitespace-nowrap">Delete {u.round}?</span>
                                <Button size="sm" variant="destructive" className="h-6 px-2 text-xs" disabled={del.isPending} onClick={() => void doDelete(u)}>
                                  {del.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, delete"}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setConfirmKey(null)}>Keep</Button>
                              </>
                            ) : (
                              <>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Fix match details" onClick={() => (editing ? setEditKey(null) : startEdit(u))}>
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive" title="Delete this upload" onClick={() => { setConfirmKey(k); setEditKey(null); }}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                      {editing && (
                        <tr className="border-b last:border-0 bg-muted/30">
                          <td colSpan={8} className="px-2 py-2">
                            <div className="flex flex-wrap items-end gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Opponent</Label>
                                <Input value={eOpponent} onChange={e => setEOpponent(e.target.value)} className="h-7 w-40 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Date (dd/mm/yyyy)</Label>
                                <Input value={eDate} onChange={e => setEDate(e.target.value)} placeholder="25/07/2026" className="h-7 w-32 text-xs" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Session title</Label>
                                <Input value={eTitle} onChange={e => setETitle(e.target.value)} className="h-7 w-56 text-xs" />
                              </div>
                              <div className="flex gap-1.5">
                                <Button size="sm" className="h-7 px-3 text-xs" disabled={update.isPending} onClick={() => void saveEdit(u)}>
                                  {update.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditKey(null)}>Cancel</Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <StatusLine ok={ok} err={err} />
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Dribl sync — pull results (and goal scorers/minutes) straight from Dribl
// ─────────────────────────────────────────────────────────────────────────────

function DriblSyncCard({ teamId, seasonId, leagueId, onSaved }: {
  teamId: number; seasonId: number; leagueId: number; onSaved: () => void;
}) {
  const [preview, setPreview] = useState<DriblPreviewResponse | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [showAlreadyIn, setShowAlreadyIn] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Games where a previous sync found no published team sheet are skipped on
  // re-syncs (that's what keeps them fast); this forces a one-off re-check.
  const [recheckNoLineups, setRecheckNoLineups] = useState(false);
  // First sync on a league with no clubs yet: the server offers club names
  // pulled from the Dribl fixture list; the coach reviews/edits, then creates.
  const [clubDrafts, setClubDrafts] = useState<string[] | null>(null);
  const [creatingClubs, setCreatingClubs] = useState(false);
  const createClubMut = useCreateClub();

  // The browser talks to Dribl directly when the server is blocked by
  // Cloudflare (hosting IPs score badly; home connections are fine, and
  // mc-api.dribl.com sends Access-Control-Allow-Origin: *).
  const driblJson = async (path: string, params: Record<string, string>): Promise<any> => {
    const url = new URL(`https://mc-api.dribl.com/api${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`Dribl ${path} responded ${r.status}`);
    return r.json();
  };

  const browserSync = async (recheck: boolean): Promise<DriblPreviewResponse> => {
    setPhase("Server can't reach Dribl — fetching from your browser instead…");
    const cfg = await getDriblConfig({ seasonId });
    const tenantSlug = cfg.driblTenantSlug || "capital";
    const tenant: string = (await driblJson("/tenants", { slug: tenantSlug }))?.data?.id;
    if (!tenant) throw new Error(`Couldn't find the ${tenantSlug} federation on Dribl`);
    const seasonList: Array<{ id: string; title: string; year: number; is_current: boolean }> =
      (await driblJson("/list/seasons", { tenant }))?.data ?? [];
    const yearSeasons = seasonList.filter(s => String(s.year) === cfg.driblYear);
    const driblSeason = yearSeasons.find(s => s.is_current) ?? yearSeasons[yearSeasons.length - 1];
    if (!driblSeason) throw new Error(`Dribl has no ${cfg.driblYear} season for this federation`);
    const comps: Array<{ id: string; name?: string; title?: string }> =
      (await driblJson("/list/competitions", { tenant }))?.data ?? [];
    const competition = comps.find(c => (c.name ?? c.title) === cfg.driblCompetition);
    if (!competition) throw new Error(`Dribl has no "${cfg.driblCompetition}" competition`);

    const fixtures: DriblRawFixture[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 80; page++) {
      setPhase(`Reading fixtures from Dribl… (page ${page + 1})`);
      const params: Record<string, string> = { tenant, season: driblSeason.id, competition: competition.id, date_range: "all" };
      if (cursor) params.cursor = cursor;
      const data = await driblJson("/fixtures", params);
      const rows = data?.data ?? [];
      if (rows.length === 0) break;
      for (const row of rows) {
        const a = row.attributes ?? {};
        if (a.league_name === cfg.driblLeague && !a.bye_flag) {
          fixtures.push({
            fullRound: String(a.full_round ?? ""), date: String(a.date ?? ""), status: String(a.status ?? ""),
            homeTeamName: String(a.home_team_name ?? ""), awayTeamName: String(a.away_team_name ?? ""),
            homeScore: a.home_score ?? null, awayScore: a.away_score ?? null,
            homeScoreHt: a.home_score_half ?? null, awayScoreHt: a.away_score_half ?? null,
            matchHashId: String(a.match_hash_id ?? ""),
          });
        }
      }
      cursor = data?.meta?.next_cursor ?? null;
      if (!cursor) break;
    }

    let result = await assembleDriblPreview({ seasonId, driblSeason: driblSeason.title, fixtures, recheckNoLineups: recheck });
    if (result.needDetail.length > 0) {
      const matchCentres: DriblRawMatchCentre[] = [];
      for (let i = 0; i < result.needDetail.length; i++) {
        setPhase(`Reading match detail ${i + 1} of ${result.needDetail.length}…`);
        const hash = result.needDetail[i];
        try {
          const a = (await driblJson(`/matchcentre/${hash}`, { tenant }))?.data?.attributes ?? {};
          matchCentres.push({
            matchHashId: hash,
            homeScoreHt: a.home_score_ht ?? null,
            awayScoreHt: a.away_score_ht ?? null,
            homeTeamHashId: String(a.home_team_hash_id ?? ""),
            awayTeamHashId: String(a.away_team_hash_id ?? ""),
            ftFirstHalf: typeof a.ft_first_half_duration === "number" ? a.ft_first_half_duration : null,
            ftSecondHalf: typeof a.ft_second_half_duration === "number" ? a.ft_second_half_duration : null,
            events: (a.match_events ?? [])
              .filter((ev: any) => ev.type === "goal")
              .map((ev: any) => ({
                teamId: String(ev.team_id ?? ""),
                minute: typeof ev.minute === "number" ? ev.minute : null,
                ownGoal: Boolean(ev.own_goal),
                penalty: Boolean(ev.penalty_kick),
                name: String(ev.name ?? ""),
              })),
            subs: (a.match_events ?? [])
              .filter((ev: any) => ev.type === "sub")
              .map((ev: any) => ({
                teamId: String(ev.team_id ?? ""),
                minute: typeof ev.minute === "number" ? ev.minute : null,
                outName: String(ev.out_name ?? ""), inName: String(ev.in_name ?? ""),
                outJersey: String(ev.out_jersey ?? ""), inJersey: String(ev.in_jersey ?? ""),
              })),
          });
        } catch {
          // skip — that match imports as scoreline only
        }
      }
      result = await assembleDriblPreview({ seasonId, driblSeason: driblSeason.title, fixtures, matchCentres, recheckNoLineups: recheck });

      // Third pass: fetch line-ups for teams that still need player rows.
      if (result.needLineups.length > 0) {
        const lineups: DriblRawLineup[] = [];
        for (let i = 0; i < result.needLineups.length; i++) {
          setPhase(`Reading line-up ${i + 1} of ${result.needLineups.length}…`);
          const need = result.needLineups[i];
          try {
            const lu = await driblJson(`/matchcentre-match-members/match/${need.match}/team/${need.team}`, { tenant });
            const rows = Array.isArray(lu) ? lu : lu?.data ?? [];
            lineups.push({
              matchHashId: need.match,
              teamHashId: need.team,
              players: rows.map((r: any) => {
                const a = r?.attributes ?? r ?? {};
                return {
                  firstName: String(a.first_name ?? ""), lastName: String(a.last_name ?? ""),
                  jersey: String(a.jersey ?? ""),
                  starting: Boolean(a.starting), playing: Boolean(a.playing),
                  isGoalkeeper: Boolean(a.is_goalkeeper), roleSlug: String(a.role_slug ?? "player"),
                };
              }),
            });
          } catch {
            // skip — that team imports without player rows
          }
        }
        result = await assembleDriblPreview({ seasonId, driblSeason: driblSeason.title, fixtures, matchCentres, lineups, recheckNoLineups: recheck });
      }
    }
    return result;
  };

  const fetchPreview = async (recheck = recheckNoLineups) => {
    setIsFetching(true); setPreviewError(null); setOk(null); setErr(null); setPhase(null);
    try {
      let result: DriblPreviewResponse;
      try {
        // Omit the flag entirely when false — query-string "false" is not a
        // JSON boolean and must never be misread as true server-side.
        result = await getDriblPreview(recheck ? { seasonId, recheckNoLineups: true } : { seasonId });
      } catch {
        result = await browserSync(recheck);
      }
      setPreview(result);
      setDeselected(new Set());
      setClubDrafts(result.suggestedClubs?.length ? [...result.suggestedClubs] : null);
    } catch (e) {
      setPreviewError(errMsg(e));
    } finally {
      setIsFetching(false); setPhase(null);
    }
  };
  const refetch = () => { void fetchPreview(); };
  const recheckSkipped = () => { setRecheckNoLineups(true); void fetchPreview(true); };

  const createMatch = useCreateEntryMatch();
  const createGoal = useCreateEntryGoal();
  const savePlayerStats = useSaveEntryPlayerStats();

  // Create the reviewed club list, then immediately re-fetch so the same sync
  // can now match every fixture against the freshly created clubs.
  const createSuggestedClubs = async () => {
    // Dedupe case-insensitively — "Croatia" and "croatia" would create two DB
    // rows that fixture matching can't tell apart.
    const seen = new Set<string>();
    const names = (clubDrafts ?? []).map(n => n.trim().replace(/\s+/g, " ")).filter(n => {
      const key = n.toLowerCase();
      if (!n || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (names.length === 0 || !leagueId) return;
    setCreatingClubs(true); setErr(null); setOk(null);
    let added = 0;
    const failures: string[] = [];
    const failedNames: string[] = [];
    for (const name of names) {
      try {
        await createClubMut.mutateAsync({ data: { leagueId, name } });
        added++;
      } catch (e) {
        // "Already exists" counts as done — a retry after a partial failure
        // must not trip over the clubs it created last time.
        const msg = errMsg(e);
        if (/already exists/i.test(msg)) { added++; continue; }
        failures.push(`${name}: ${msg}`);
        failedNames.push(name);
      }
    }
    setCreatingClubs(false);
    if (failures.length > 0) {
      // Keep only the failed ones in the list so a retry doesn't resubmit successes.
      setClubDrafts(failedNames);
      setErr(failures.slice(0, 4).join(" · ") + (failures.length > 4 ? ` (+${failures.length - 4} more)` : ""));
      return;
    }
    setOk(`Created ${added} club${added === 1 ? "" : "s"} — fetching results…`);
    setClubDrafts(null);
    onSaved();
    void fetchPreview();
  };

  const importable = useMemo(
    () => (preview?.matches ?? []).filter(m => (!m.exists || m.goalsOnly || m.statsOnly) && m.unmatched.length === 0),
    [preview],
  );
  const selectedMatches = importable.filter(m => !deselected.has(m.matchId));

  const toggle = (matchId: string) => {
    setDeselected(prev => {
      const next = new Set(prev);
      if (next.has(matchId)) next.delete(matchId); else next.add(matchId);
      return next;
    });
  };

  const runImport = async () => {
    setImporting(true); setOk(null); setErr(null);
    let savedMatches = 0, savedGoals = 0, savedSheets = 0;
    const failures: string[] = [];
    for (const m of selectedMatches) {
      setProgress(`Saving ${m.matchId} (${savedMatches + 1} of ${selectedMatches.length})…`);
      try {
        if (!m.goalsOnly && !m.statsOnly) {
          await createMatch.mutateAsync({ data: {
            teamId, seasonId,
            matchId: m.matchId, matchDate: m.matchDate,
            homeTeam: m.homeTeam, awayTeam: m.awayTeam,
            homeGoals: m.homeGoals, awayGoals: m.awayGoals,
            halfScore: m.halfScore,
          } });
        }
        savedMatches++;
        for (const g of m.goals) {
          try {
            await createGoal.mutateAsync({ data: {
              teamId, seasonId,
              matchId: m.matchId,
              scorerTeam: g.scorerTeam,
              scorer: g.scorer,
              minuteScored: g.minute,
              goalType: g.penalty ? "SP-P" : null,
            } });
            savedGoals++;
          } catch (e) {
            failures.push(`${m.matchId} goal ${g.scorer} ${g.minute ?? "?"}′: ${errMsg(e)}`);
          }
        }
        for (const ps of m.playerStats) {
          if (ps.exists || ps.rows.length === 0) continue;
          try {
            await savePlayerStats.mutateAsync({ data: {
              teamId, seasonId,
              matchId: m.matchId,
              club: ps.club,
              ifMissing: true,
              rows: ps.rows.map(r => ({
                playerName: r.playerName,
                shirtNumber: r.shirtNumber ?? null,
                minsPlayed: r.minsPlayed,
                position: r.position,
                started: r.started,
                appearance: r.appearance,
              })),
            } });
            savedSheets++;
          } catch (e) {
            failures.push(`${m.matchId} line-up ${ps.club}: ${errMsg(e)}`);
          }
        }
      } catch (e) {
        failures.push(`${m.matchId}: ${errMsg(e)}`);
      }
    }
    setProgress(null); setImporting(false);
    onSaved();
    void refetch();
    if (failures.length === 0) {
      setOk(`Imported ${savedMatches} match${savedMatches === 1 ? "" : "es"}, ${savedGoals} goal${savedGoals === 1 ? "" : "s"} and ${savedSheets} line-up${savedSheets === 1 ? "" : "s"} from Dribl`);
    } else {
      setOk(savedMatches > 0 ? `Imported ${savedMatches} matches / ${savedGoals} goals — but some rows failed` : null);
      setErr(failures.slice(0, 5).join(" · ") + (failures.length > 5 ? ` (+${failures.length - 5} more)` : ""));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync from Dribl</CardTitle>
        <CardDescription>
          Pulls every completed result for this league straight from Dribl — score, half-time score, date and round —
          and pre-fills goal scorers and minutes where Dribl has them. You add the goal detail (build-up, location)
          on the Goals tab afterwards. Games already recorded are skipped, so it's always safe to re-sync.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!preview && !isFetching && !previewError ? (
          <Button onClick={() => void fetchPreview()}>
            <Upload className="h-4 w-4 mr-1.5" />Fetch results from Dribl
          </Button>
        ) : isFetching ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />{phase ?? "Reading the Dribl match centre — this takes a moment…"}
          </div>
        ) : previewError ? (
          <div className="space-y-3">
            <StatusLine ok={null} err={previewError} />
            <Button variant="outline" onClick={() => void fetchPreview()}>Try again</Button>
          </div>
        ) : preview ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary">{preview.driblLeague} · {preview.driblSeason}</Badge>
              <span>{preview.matches.length} completed games on Dribl · {importable.length} new</span>
              {preview.matches.some(m => m.exists && !m.goalsOnly && !m.statsOnly) && (
                <button
                  type="button"
                  className="text-xs underline underline-offset-2 hover:text-foreground"
                  onClick={() => setShowAlreadyIn(v => !v)}
                >
                  {showAlreadyIn
                    ? "hide the ones already in"
                    : `show ${preview.matches.filter(m => m.exists && !m.goalsOnly && !m.statsOnly).length} already in`}
                </button>
              )}
              <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={importing}>Refresh</Button>
            </div>

            {preview.skippedNoLineups > 0 && (
              <p className="text-xs text-muted-foreground">
                Skipped {preview.skippedNoLineups} team sheet{preview.skippedNoLineups === 1 ? "" : "s"} Dribl never
                published (remembered from earlier syncs, so re-syncs stay fast).{" "}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={recheckSkipped}
                  disabled={importing || isFetching}
                >
                  Check them again
                </button>
              </p>
            )}

            {clubDrafts ? (
              <div className="space-y-3">
                <p className="text-sm">
                  This league has no clubs yet. Here are the teams Dribl lists for it — check the names
                  (edit or blank out any you don't want), then create them to run the sync.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {clubDrafts.map((name, i) => (
                    <Input
                      key={i}
                      value={name}
                      disabled={creatingClubs}
                      onChange={e => setClubDrafts(prev => prev?.map((v, j) => (j === i ? e.target.value : v)) ?? prev)}
                    />
                  ))}
                </div>
                <Button
                  onClick={() => void createSuggestedClubs()}
                  disabled={creatingClubs || clubDrafts.every(n => !n.trim())}
                >
                  {creatingClubs
                    ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Creating clubs…</>
                    : `Create ${new Set(clubDrafts.map(n => n.trim()).filter(Boolean)).size} clubs and sync`}
                </Button>
              </div>
            ) : preview.matches.length === 0 ? (
              <p className="text-sm text-muted-foreground">Dribl has no completed results for this season yet.</p>
            ) : (
              <div className="border rounded-md divide-y max-h-96 overflow-y-auto">
                {preview.matches.filter(m => showAlreadyIn || !m.exists || m.goalsOnly || m.statsOnly || m.unmatched.length > 0).map(m => {
                  const canImport = (!m.exists || m.goalsOnly || m.statsOnly) && m.unmatched.length === 0;
                  return (
                    <div key={`${m.matchId}-${m.driblHome}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <Checkbox
                        checked={canImport && !deselected.has(m.matchId)}
                        disabled={!canImport || importing}
                        onCheckedChange={() => toggle(m.matchId)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          R{m.round} · {m.homeTeam || m.driblHome} {m.homeGoals}–{m.awayGoals} {m.awayTeam || m.driblAway}
                          {m.halfScore && <span className="text-muted-foreground font-normal"> (HT {m.halfScore})</span>}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {m.matchDate} · {m.matchId}
                          {m.goals.length > 0 && ` · ${m.goals.length} goal${m.goals.length === 1 ? "" : "s"} with scorer + minute`}
                          {m.playerStats.length > 0 && ` · line-ups: ${m.playerStats.map(ps => `${ps.club} ${ps.rows.length}`).join(", ")}`}
                        </div>
                      </div>
                      {m.unmatched.length > 0 ? (
                        <Badge variant="outline" className="shrink-0 text-chart-4 border-chart-4" title={m.unmatched.join("; ")}>
                          {m.unmatched.some(u => u.startsWith("Match ID clash")) ? "match ID clash" : "unknown club — add it in League Setup"}
                        </Badge>
                      ) : m.exists && m.goalsOnly ? (
                        <Badge variant="outline" className="shrink-0">
                          match in — {m.goals.length} goal{m.goals.length === 1 ? "" : "s"}{m.playerStats.length > 0 ? " + line-ups" : ""} missing
                        </Badge>
                      ) : m.exists && m.statsOnly ? (
                        <Badge variant="outline" className="shrink-0">match in — line-ups missing</Badge>
                      ) : m.exists ? (
                        <Badge variant="outline" className="shrink-0">already in</Badge>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {importable.length > 0 && (
              <Button onClick={() => void runImport()} disabled={importing || selectedMatches.length === 0}>
                {importing
                  ? (<><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />{progress ?? "Importing…"}</>)
                  : (<><Plus className="h-4 w-4 mr-1.5" />Import {selectedMatches.length} match{selectedMatches.length === 1 ? "" : "es"}</>)}
              </Button>
            )}
          </div>
        ) : null}
        <StatusLine ok={ok} err={err} />
      </CardContent>
    </Card>
  );
}

function EntryWorkspace() {
  const queryClient = useQueryClient();
  const { data: teams } = useListTeams();
  const { data: allSeasons } = useListSeasons();
  const { data: clubs } = useGetClubs();
  const { hasModule } = useLeagueModules();
  // Only offer seasons of leagues where the user has the data-entry module.
  const seasons = useMemo(
    () => (allSeasons ?? []).filter(s => hasModule(s.leagueId, "data-entry")),
    [allSeasons, hasModule],
  );

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
  // Dribl sync is wired up for NPLM (Capital Football runs it on Dribl)
  const driblAvailable = /NPLM|NPLW/i.test(season?.leagueName ?? "");
  // Only offer clubs that belong to the selected season's league
  const clubNames = useMemo(
    () => (clubs ?? []).filter(c => season && c.leagueId === season.leagueId).map(c => c.name).sort(),
    [clubs, season],
  );

  // No season belongs to a league where the user has data-entry access.
  if (allSeasons && seasons.length === 0) return <NoAccess />;

  if (!isReady) return <p className="text-muted-foreground text-center py-16">Loading…</p>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Data Entry</h1>
          <p className="text-muted-foreground">Record fixtures, goals and player minutes — everything flows straight into the charts.</p>
        </div>
        <div className="flex items-center gap-2">
          {seasons.length > 1 ? (
            <Select value={seasonId != null ? String(seasonId) : ""} onValueChange={v => setSeasonId(Number(v))}>
              <SelectTrigger className="w-[240px] max-w-full"><SelectValue placeholder="Select League · Season" /></SelectTrigger>
              <SelectContent>
                {seasons.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.leagueName} · {s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            season && <Badge variant="secondary">{season.leagueName} · {season.label}</Badge>
          )}
          <Button variant="ghost" size="sm" onClick={() => logout.mutate()} className="text-muted-foreground">
            <LogOut className="h-4 w-4 mr-1.5" />Log out
          </Button>
        </div>
      </div>

      <Tabs defaultValue="match" className="w-full">
        <TabsList className="flex w-full flex-wrap h-auto gap-1">
          {driblAvailable && <TabsTrigger value="dribl">Dribl Sync</TabsTrigger>}
          <TabsTrigger value="match">1 · Match</TabsTrigger>
          <TabsTrigger value="goals">2 · Goals</TabsTrigger>
          <TabsTrigger value="players">3 · Player Stats</TabsTrigger>
          <TabsTrigger value="league">4 · League Setup</TabsTrigger>
          <TabsTrigger value="testing">5 · Testing</TabsTrigger>
          <TabsTrigger value="gps">6 · GPS</TabsTrigger>
          <TabsTrigger value="positions">7 · Positions</TabsTrigger>
          <TabsTrigger value="emails">8 · Emails</TabsTrigger>
        </TabsList>

        {driblAvailable && (
          // forceMount: an in-flight sync (browser-fallback fetch loop + import
          // posts) lives in this component's state, so unmounting on a tab
          // switch would kill it. Keep it mounted and just hide it.
          <TabsContent value="dribl" forceMount className="mt-6 data-[state=inactive]:hidden">
            <DriblSyncCard
              teamId={teamId} seasonId={seasonId} leagueId={season?.leagueId ?? 0}
              onSaved={() => { void queryClient.invalidateQueries({ queryKey: getListLeagueMatchesQueryKey({ seasonId }) }); }}
            />
          </TabsContent>
        )}
        <TabsContent value="match" className="mt-6">
          <div className="space-y-6">
            <MatchForm
              teamId={teamId} seasonId={seasonId} clubs={clubNames} options={options}
              onSaved={() => { void queryClient.invalidateQueries({ queryKey: getListLeagueMatchesQueryKey({ seasonId }) }); }}
            />
            <MatchStatsEditor teamId={teamId} seasonId={seasonId} />
          </div>
        </TabsContent>
        <TabsContent value="goals" className="mt-6">
          <GoalForm teamId={teamId} seasonId={seasonId} fixtures={fixtures ?? []} />
        </TabsContent>
        <TabsContent value="league" className="mt-6">
          <LeagueSetupCard />
        </TabsContent>
        <TabsContent value="players" className="mt-6">
          <PlayersForm teamId={teamId} seasonId={seasonId} leagueId={season?.leagueId ?? 0} fixtures={fixtures ?? []} />
        </TabsContent>
        <TabsContent value="testing" className="mt-6">
          <TestingUploadForm teamId={teamId} leagueId={season?.leagueId ?? 0} />
        </TabsContent>
        <TabsContent value="gps" className="mt-6">
          <GpsUploadForm teamId={teamId} leagueId={season?.leagueId ?? 0} />
        </TabsContent>
        <TabsContent value="positions" className="mt-6">
          <PositionsForm leagueId={season?.leagueId ?? 0} />
        </TabsContent>
        <TabsContent value="emails" className="mt-6">
          <EmailsForm leagueId={season?.leagueId ?? 0} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GPS player positions — drives position-specific averages in player reports
// ─────────────────────────────────────────────────────────────────────────────

const GPS_POSITIONS = ["GK", "Defender", "Midfielder", "Forward"];

function PositionsForm({ leagueId }: { leagueId: number }) {
  const queryClient = useQueryClient();

  // Every player name that has ever logged a GPS game (all years)
  const gpsParams = { leagueId, split: "game" };
  const { data: gpsRows, isLoading: loadingNames } = useListGpsSessions(
    gpsParams,
    { query: { enabled: leagueId > 0, queryKey: getListGpsSessionsQueryKey(gpsParams) } },
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

// ─────────────────────────────────────────────────────────────────────────────
// GPS player emails — admin-only (mostly minors' addresses); one place to
// add/fix/clear addresses without opening a send dialog
// ─────────────────────────────────────────────────────────────────────────────

function EmailsForm({ leagueId }: { leagueId: number }) {
  const queryClient = useQueryClient();

  // Every player name that has ever logged a GPS game (all years)
  const gpsParams = { leagueId, split: "game" };
  const { data: gpsRows, isLoading: loadingNames } = useListGpsSessions(
    gpsParams,
    { query: { enabled: leagueId > 0, queryKey: getListGpsSessionsQueryKey(gpsParams) } },
  );
  const names = useMemo(
    () => [...new Set((gpsRows ?? []).map(r => r.playerName).filter((n): n is string => !!n && n !== "Unknown"))].sort(),
    [gpsRows]);

  const { data: saved, isLoading: loadingEmails } = useListGpsPlayerEmails(
    { query: { queryKey: getListGpsPlayerEmailsQueryKey() } },
  );
  const savedMap = useMemo(() => new Map((saved ?? []).map(e => [e.playerName, e.email])), [saved]);

  // Local edits layered over what's saved; "" = no email
  const [edits, setEdits] = useState<Record<string, string>>({});
  const valueOf = (n: string) => edits[n] ?? savedMap.get(n) ?? "";
  const changed = (n: string) => (edits[n] ?? savedMap.get(n) ?? "").trim() !== (savedMap.get(n) ?? "");
  const dirty = names.some(changed);
  const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const invalid = names.filter(n => { const v = valueOf(n).trim(); return v !== "" && !looksLikeEmail(v); });

  const [message, setMessage] = useState<string | null>(null);
  const save = useSaveGpsPlayerEmails({ mutation: {
    onSuccess: res => {
      setEdits({});
      setMessage(`Saved — ${res.saved} address${res.saved === 1 ? "" : "es"}${res.removed ? `, ${res.removed} cleared` : ""}.`);
      void queryClient.invalidateQueries({ queryKey: getListGpsPlayerEmailsQueryKey() });
    },
    onError: e => setMessage(errMsg(e)),
  }});

  const submit = () => {
    setMessage(null);
    const body = names
      .filter(changed)
      .map(n => ({ playerName: n, email: valueOf(n).trim() || null }));
    save.mutate({ data: body });
  };

  const missing = names.filter(n => !valueOf(n).trim()).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Player emails</CardTitle>
        <CardDescription>
          The addresses used by the "Email reports" buttons on GPS Insights and Testing. Admin-only — clear a
          field and save to remove an address. Players without one are highlighted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadingNames || loadingEmails ? (
          <p className="text-muted-foreground py-8 text-center">Loading players…</p>
        ) : names.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center">No GPS-logged players found.</p>
        ) : (
          <>
            <div className="grid gap-x-6 gap-y-2 lg:grid-cols-2">
              {names.map(n => {
                const v = valueOf(n);
                const bad = v.trim() !== "" && !looksLikeEmail(v.trim());
                return (
                  <div key={n} className="flex items-center gap-2 border-b py-1.5">
                    <span className={`text-sm truncate w-36 shrink-0 ${!v.trim() ? "text-amber-600 dark:text-amber-500 font-medium" : ""}`}>{n}</span>
                    <Input
                      type="email"
                      value={v}
                      placeholder="No email saved"
                      onChange={e => setEdits(prev => ({ ...prev, [n]: e.target.value }))}
                      className={`h-8 text-xs ${bad ? "border-destructive" : !v.trim() ? "border-amber-500/50" : ""}`}
                    />
                    {v.trim() !== "" && (
                      <Button
                        variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground shrink-0"
                        title={`Clear ${n}'s email`}
                        onClick={() => setEdits(prev => ({ ...prev, [n]: "" }))}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={submit} disabled={!dirty || invalid.length > 0 || save.isPending}>
                {save.isPending ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Saving…</> : "Save emails"}
              </Button>
              <p className="text-sm text-muted-foreground">
                {invalid.length > 0
                  ? `${invalid.length} address${invalid.length === 1 ? " doesn't" : "es don't"} look valid — fix before saving.`
                  : missing
                    ? `${missing} of ${names.length} players still without an email.`
                    : `All ${names.length} players have an email.`}
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

/** Fill in logos/colours for a league's EXISTING clubs — lookup, review, then PATCH each. */
function ClubBrandingFixer({ leagueId, clubCount, onSaved }: {
  leagueId: number | null; clubCount: number; onSaved: () => void;
}) {
  const [rows, setRows] = useState<BrandingRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setRows([]); setWarnings([]); setOk(null); setErr(null); }, [leagueId]);

  const lookup = useFillClubBranding({ mutation: {
    onSuccess: (res) => {
      const mapped = res.suggestions.map(s => {
        const primaryColor = s.primaryColor ?? s.currentColor;
        const logoUrl = s.logoUrl ?? s.currentLogoUrl ?? null;
        const changed = primaryColor !== s.currentColor || logoUrl !== (s.currentLogoUrl ?? null);
        return {
          clubId: s.clubId, name: s.name,
          currentColor: s.currentColor, currentLogoUrl: s.currentLogoUrl ?? null,
          primaryColor, logoUrl, include: changed,
        };
      });
      setRows(mapped);
      setWarnings(res.warnings);
      const changed = mapped.filter(r => r.include).length;
      setOk(changed > 0
        ? `Found updates for ${changed} of ${mapped.length} clubs — check them, then save`
        : "Nothing new found — every club already matches what the lookup suggests");
    },
    onError: (e) => setErr(errMsg(e)),
  }});

  const updateClub = useUpdateClub();
  const busy = lookup.isPending || saving;

  const update = (i: number, patch: Partial<BrandingRow>) =>
    setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const rowChanged = (r: BrandingRow) =>
    r.primaryColor !== r.currentColor || (r.logoUrl?.trim() || null) !== r.currentLogoUrl;
  const toSave = rows.filter(r => r.include && rowChanged(r));

  const saveAll = async () => {
    setOk(null); setErr(null); setSaving(true);
    let updated = 0;
    const failed: string[] = [];
    for (const r of toSave) {
      try {
        await updateClub.mutateAsync({ clubId: r.clubId, data: {
          primaryColor: r.primaryColor,
          logoUrl: r.logoUrl?.trim() || null,
        }});
        updated += 1;
      } catch (e) {
        failed.push(`${r.name}: ${errMsg(e)}`);
      }
    }
    setSaving(false);
    if (failed.length > 0) setErr(`Updated ${updated}, but some failed — ${failed.join("; ")}`);
    else { setOk(`Updated ${updated} club${updated === 1 ? "" : "s"}`); setRows([]); setWarnings([]); }
    onSaved();
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ScanText className="h-4 w-4 text-primary shrink-0" />
        <p className="text-sm font-medium">Fill in missing logos &amp; colours</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Runs the same lookup against the clubs already saved in this league, so you can add logos or fix
        colours without deleting and re-adding anything. Nothing changes until you save.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline" size="sm" disabled={leagueId == null || clubCount === 0 || busy}
          onClick={() => {
            if (leagueId == null) return;
            setOk(null); setErr(null); setRows([]); setWarnings([]);
            lookup.mutate({ data: { leagueId } });
          }}
        >
          <ScanText className="h-4 w-4 mr-1.5" />Look up logos &amp; colours
        </Button>
        {lookup.isPending && <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Checking each club…</span>}
        {leagueId == null && <span className="text-xs text-muted-foreground">Pick a league first</span>}
        {leagueId != null && clubCount === 0 && <span className="text-xs text-muted-foreground">No clubs in this league yet</span>}
      </div>

      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-chart-4"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />{w}</div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          <div className="rounded-md border bg-background divide-y divide-border/40">
            {rows.map((r, i) => {
              const changed = rowChanged(r);
              return (
                <div key={r.clubId} className="flex items-center gap-2 px-2 py-1.5">
                  <Checkbox
                    checked={r.include && changed} disabled={!changed}
                    onCheckedChange={v => update(i, { include: v === true })}
                  />
                  <span className="h-8 w-8 shrink-0 rounded border bg-muted/40 flex items-center justify-center overflow-hidden">
                    {r.logoUrl && !r.logoBroken ? (
                      <img
                        src={r.logoUrl} alt="" className="h-full w-full object-contain"
                        onError={() => update(i, { logoBroken: true })}
                      />
                    ) : (
                      <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: r.primaryColor }} />
                    )}
                  </span>
                  <div className="grid flex-1 gap-1.5 sm:grid-cols-[minmax(120px,1fr)_64px_minmax(160px,1.4fr)] items-center">
                    <div>
                      <p className="text-sm font-medium truncate">{r.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {changed ? "Has an update" : "Already up to date"}
                        {r.primaryColor !== r.currentColor && (
                          <> — colour <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: r.currentColor }} /> → <span className="inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: r.primaryColor }} /></>
                        )}
                      </p>
                    </div>
                    <Input
                      type="color" value={r.primaryColor}
                      onChange={e => update(i, { primaryColor: e.target.value })}
                      className="h-8 p-1 cursor-pointer"
                    />
                    <Input
                      value={r.logoUrl ?? ""} onChange={e => update(i, { logoUrl: e.target.value || null, logoBroken: false })}
                      className="h-8 text-xs" placeholder="Logo URL (optional)"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={busy || toSave.length === 0} onClick={() => void saveAll()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
              Save {toSave.length} update{toSave.length === 1 ? "" : "s"}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setRows([]); setWarnings([]); setOk(null); setErr(null); }}>Clear</Button>
          </div>
        </div>
      )}
      <StatusLine ok={ok} err={err} />
    </div>
  );
}

function GoalVocabCard() {
  const queryClient = useQueryClient();
  const { data: vocab } = useGetGoalVocab({ query: { queryKey: getGetGoalVocabQueryKey() } });

  const [lists, setLists] = useState<GoalVocabResponse | null>(null);
  const [newValue, setNewValue] = useState<Record<string, string>>({});
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Load the saved lists into local edit state once (and after each save).
  useEffect(() => {
    if (vocab && lists === null) setLists(vocab);
  }, [vocab, lists]);

  const save = useSaveGoalVocab({ mutation: {
    onSuccess: (saved) => {
      setOk("Saved — the Goals tab dropdowns use these lists straight away.");
      setLists(saved);
      queryClient.setQueryData(getGetGoalVocabQueryKey(), saved);
    },
    onError: (e) => setErr(errMsg(e)),
  }});

  if (!lists) return null;

  const setField = (key: keyof GoalVocabResponse, next: string[]) =>
    setLists({ ...lists, [key]: next });
  const move = (key: keyof GoalVocabResponse, i: number, dir: -1 | 1) => {
    const next = [...lists[key]];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setField(key, next);
  };
  const addOption = (key: keyof GoalVocabResponse) => {
    const v = (newValue[key] ?? "").trim();
    if (!v || lists[key].includes(v)) return;
    setField(key, [...lists[key], v]);
    setNewValue({ ...newValue, [key]: "" });
  };
  const dirty = vocab != null && JSON.stringify(lists) !== JSON.stringify(vocab);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Goal-coding dropdowns</CardTitle>
        <CardDescription>
          The option lists behind the Goals-tab dropdowns — one house standard shared by every league.
          Add, remove or reorder, then save. Removing an option never touches old goals: a retired value
          stays selectable on the goal that already uses it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {VOCAB_FIELD_META.map(({ key, label }) => (
            <div key={key} className="space-y-2">
              <Label className="text-xs text-muted-foreground">{label}</Label>
              <div className="rounded-md border border-border/60 divide-y divide-border/40">
                {lists[key].map((opt, i) => (
                  <div key={opt} className="flex items-center gap-1 px-2 py-1 text-sm">
                    <span className="truncate flex-1">{opt}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" disabled={i === 0} onClick={() => move(key, i, -1)}>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" disabled={i === lists[key].length - 1} onClick={() => move(key, i, 1)}>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground"
                      disabled={lists[key].length <= 1}
                      onClick={() => setField(key, lists[key].filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5">
                <Input
                  className="h-8 text-sm" placeholder="Add an option"
                  value={newValue[key] ?? ""}
                  onChange={e => setNewValue({ ...newValue, [key]: e.target.value })}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addOption(key); } }}
                />
                <Button variant="secondary" size="sm" className="h-8" disabled={!(newValue[key] ?? "").trim()} onClick={() => addOption(key)}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button
            disabled={!dirty || save.isPending}
            onClick={() => { setOk(null); setErr(null); save.mutate({ data: lists }); }}
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save dropdown lists"}
          </Button>
          {dirty && !save.isPending && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          <StatusLine ok={ok} err={err} />
        </div>
      </CardContent>
    </Card>
  );
}
