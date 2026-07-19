import { useEffect, useMemo, useState } from "react";
import {
  useListTeams,
  useListSeasons,
  useGetOpponentClubs,
  getGetOpponentClubsQueryKey,
  useGetOpponentProfile,
  getGetOpponentProfileQueryKey,
  getOpponentProfile,
  createPrematchBrief,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { FileDown, CalendarIcon, Loader2, Sparkles } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parse, isValid } from "date-fns";
import type { PitchPlayer, SetPieceGroup, UnitObjectives } from "@/lib/prematchPptx";
import WeekAheadCard from "@/components/WeekAheadCard";

// ── Formations ────────────────────────────────────────────────────────────
// px 0–1 across (0 = left touchline), py 0–1 down (0 = attacking goal).
interface Slot { id: string; num: string; role: string; px: number; py: number }

const FORMATIONS: Record<string, Slot[]> = {
  "433": [
    { id: "gk", num: "1", role: "GK", px: 0.5, py: 0.93 },
    { id: "rb", num: "2", role: "RB", px: 0.85, py: 0.72 },
    { id: "rcb", num: "5", role: "CB", px: 0.63, py: 0.79 },
    { id: "lcb", num: "4", role: "CB", px: 0.37, py: 0.79 },
    { id: "lb", num: "3", role: "LB", px: 0.15, py: 0.72 },
    { id: "dm", num: "6", role: "6", px: 0.5, py: 0.58 },
    { id: "rcm", num: "8", role: "8", px: 0.68, py: 0.44 },
    { id: "lcm", num: "10", role: "10", px: 0.32, py: 0.44 },
    { id: "rw", num: "7", role: "RW", px: 0.85, py: 0.24 },
    { id: "st", num: "9", role: "ST", px: 0.5, py: 0.15 },
    { id: "lw", num: "11", role: "LW", px: 0.15, py: 0.24 },
  ],
  "4231": [
    { id: "gk", num: "1", role: "GK", px: 0.5, py: 0.93 },
    { id: "rb", num: "2", role: "RB", px: 0.85, py: 0.72 },
    { id: "rcb", num: "5", role: "CB", px: 0.63, py: 0.79 },
    { id: "lcb", num: "4", role: "CB", px: 0.37, py: 0.79 },
    { id: "lb", num: "3", role: "LB", px: 0.15, py: 0.72 },
    { id: "rdm", num: "6", role: "6", px: 0.62, py: 0.56 },
    { id: "ldm", num: "8", role: "8", px: 0.38, py: 0.56 },
    { id: "ram", num: "7", role: "RW", px: 0.85, py: 0.32 },
    { id: "cam", num: "10", role: "10", px: 0.5, py: 0.36 },
    { id: "lam", num: "11", role: "LW", px: 0.15, py: 0.32 },
    { id: "st", num: "9", role: "ST", px: 0.5, py: 0.14 },
  ],
  "442": [
    { id: "gk", num: "1", role: "GK", px: 0.5, py: 0.93 },
    { id: "rb", num: "2", role: "RB", px: 0.85, py: 0.66 },
    { id: "rcb", num: "5", role: "CB", px: 0.63, py: 0.73 },
    { id: "lcb", num: "4", role: "CB", px: 0.37, py: 0.73 },
    { id: "lb", num: "3", role: "LB", px: 0.15, py: 0.66 },
    { id: "rm", num: "7", role: "RM", px: 0.85, py: 0.4 },
    { id: "rcm", num: "8", role: "CM", px: 0.62, py: 0.45 },
    { id: "lcm", num: "6", role: "CM", px: 0.38, py: 0.45 },
    { id: "lm", num: "11", role: "LM", px: 0.15, py: 0.4 },
    { id: "rs", num: "9", role: "ST", px: 0.6, py: 0.18 },
    { id: "ls", num: "10", role: "ST", px: 0.4, py: 0.18 },
  ],
  "343": [
    { id: "gk", num: "1", role: "GK", px: 0.5, py: 0.93 },
    { id: "rcb", num: "5", role: "CB", px: 0.72, py: 0.71 },
    { id: "ccb", num: "4", role: "CB", px: 0.5, py: 0.75 },
    { id: "lcb", num: "3", role: "CB", px: 0.28, py: 0.71 },
    { id: "rwb", num: "2", role: "WB", px: 0.9, py: 0.46 },
    { id: "rcm", num: "8", role: "8", px: 0.62, py: 0.49 },
    { id: "lcm", num: "6", role: "6", px: 0.38, py: 0.49 },
    { id: "lwb", num: "11", role: "WB", px: 0.1, py: 0.46 },
    { id: "rw", num: "7", role: "W", px: 0.8, py: 0.25 },
    { id: "st", num: "9", role: "S", px: 0.5, py: 0.15 },
    { id: "lw", num: "10", role: "W", px: 0.2, py: 0.25 },
  ],
  "352": [
    { id: "gk", num: "1", role: "GK", px: 0.5, py: 0.93 },
    { id: "rcb", num: "5", role: "CB", px: 0.72, py: 0.71 },
    { id: "ccb", num: "4", role: "CB", px: 0.5, py: 0.75 },
    { id: "lcb", num: "3", role: "CB", px: 0.28, py: 0.71 },
    { id: "rwb", num: "2", role: "WB", px: 0.9, py: 0.43 },
    { id: "rcm", num: "8", role: "8", px: 0.66, py: 0.45 },
    { id: "dm", num: "6", role: "6", px: 0.5, py: 0.55 },
    { id: "lcm", num: "10", role: "10", px: 0.34, py: 0.45 },
    { id: "lwb", num: "11", role: "WB", px: 0.1, py: 0.43 },
    { id: "rs", num: "9", role: "ST", px: 0.6, py: 0.16 },
    { id: "ls", num: "7", role: "ST", px: 0.4, py: 0.16 },
  ],
};

// Default set-piece diagram spots (box view, goal at top) per role, in order.
const CORNERS_FOR_SPOTS: Record<string, Array<[number, number]>> = {
  Taker: [[0.965, 0.03]],
  "Attack the goal": [[0.42, 0.24], [0.54, 0.28], [0.62, 0.2], [0.48, 0.36]],
  "Near post": [[0.42, 0.12]],
  "Edge of box": [[0.5, 0.55], [0.62, 0.52]],
  "Stay back": [[0.35, 0.85], [0.65, 0.85]],
};
const CORNERS_AGAINST_SPOTS: Record<string, Array<[number, number]>> = {
  "Man marking": [[0.45, 0.22], [0.55, 0.25], [0.5, 0.32], [0.6, 0.3], [0.4, 0.3]],
  "Near post": [[0.435, 0.045]],
  "Far post": [[0.565, 0.045]],
  "Edge of box / halfway": [[0.5, 0.58], [0.64, 0.55]],
};

const SHORT = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase() : name.slice(0, 2);
};

const lines = (t: string): string[] => t.split("\n").map((l) => l.trim()).filter(Boolean);

const emptyObjectives = (): UnitObjectives => ({ theme: "", gk: [], defenders: [], midfielders: [], attackers: [] });

interface Draft {
  opponent: string;
  round: string;
  matchDate: string;
  formation: string;
  theirFormation: string;
  xi: Record<string, string>; // slotId -> player name
  subs: string[];
  ourBpNotes: string;
  ourBpoNotes: string;
  theirBpNotes: string;
  theirBpoNotes: string;
  gamePlan: string;
  bp: UnitObjectives;
  bpo: UnitObjectives;
  spFor: Record<string, string[]>;
  spAgainst: Record<string, string[]>;
  fkWide: string;
  fkCentral: string;
}

const DRAFT_KEY = "bufc-matchprep-draft-v1";

const blankDraft = (): Draft => ({
  opponent: "", round: "", matchDate: "", formation: "433", theirFormation: "433",
  xi: {}, subs: [],
  ourBpNotes: "", ourBpoNotes: "", theirBpNotes: "", theirBpoNotes: "",
  gamePlan: "", bp: emptyObjectives(), bpo: emptyObjectives(),
  spFor: {}, spAgainst: {}, fkWide: "", fkCentral: "",
});

function MatchDatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const parsed = value ? parse(value, "d MMMM yyyy", new Date()) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-start font-normal">
          <CalendarIcon className="mr-2 h-4 w-4 opacity-60" />
          {value || <span className="text-muted-foreground">Pick a date</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          weekStartsOn={1}
          selected={selected}
          defaultMonth={selected}
          onSelect={(day) => {
            if (day) onChange(format(day, "d MMMM yyyy"));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...blankDraft(), ...JSON.parse(raw) };
  } catch { /* corrupted draft — start fresh */ }
  return blankDraft();
}

export default function MatchPrep() {
  const { toast } = useToast();
  const [d, setD] = useState<Draft>(loadDraft);
  const [drafting, setDrafting] = useState(false);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  }, [d]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const { data: teams } = useListTeams({ query: { queryKey: ["listTeams"] } });
  const { data: seasons } = useListSeasons({ query: { queryKey: ["listSeasons"] } });
  const teamId = (teams?.find((t) => t.analyticsEnabled && t.gender === "female") ?? teams?.[0])?.id;
  const seasonId = (seasons?.find((s) => s.isActive) ?? seasons?.[0])?.id;
  const clubsParams = { teamId: teamId ?? 0, seasonId: seasonId ?? 0 };
  const { data: oppClubs } = useGetOpponentClubs(clubsParams, {
    query: { queryKey: getGetOpponentClubsQueryKey(clubsParams), enabled: teamId != null && seasonId != null },
  });
  const belcoParams = { teamId: teamId ?? 0, seasonId: seasonId ?? 0, club: "Belconnen" };
  const { data: belco } = useGetOpponentProfile(belcoParams, {
    query: { queryKey: getGetOpponentProfileQueryKey(belcoParams), enabled: teamId != null && seasonId != null },
  });
  const roster = useMemo(
    () => (belco?.players ?? []).map((p) => p.playerName).sort((a, b) => a.localeCompare(b)),
    [belco],
  );

  const slots = FORMATIONS[d.formation] ?? FORMATIONS["433"];
  const xiNames = slots.map((s) => d.xi[s.id]).filter(Boolean) as string[];
  const picked = new Set([...xiNames, ...d.subs]);
  const squad = [...xiNames, ...d.subs];

  // ── AI objectives ──
  async function draftObjectives() {
    if (!d.opponent || teamId == null || seasonId == null) return;
    setDrafting(true);
    try {
      let scoutText = "";
      try {
        const prof = await getOpponentProfile({ teamId, seasonId, club: d.opponent });
        const rec = prof.record;
        const scorers = prof.topScorers.slice(0, 3).map((s) => `${s.scorer} (${s.goals})`).join(", ");
        scoutText = [
          `Season record: ${rec.won}W ${rec.drawn}D ${rec.lost}L, ${rec.goalsFor} scored / ${rec.goalsAgainst} conceded.`,
          scorers ? `Top scorers: ${scorers}.` : "",
          d.theirFormation ? `They likely play a ${d.theirFormation}.` : "",
        ].filter(Boolean).join("\n");
      } catch { /* scout data optional */ }
      const brief = await createPrematchBrief({
        opponent: d.opponent,
        formation: d.formation,
        gamePlanNotes: d.gamePlan || undefined,
        scoutText: scoutText || undefined,
      });
      setD((p) => ({ ...p, bp: brief.bp, bpo: brief.bpo }));
      toast({ title: "Objectives drafted", description: "Edit any line before downloading the deck." });
    } catch (e) {
      toast({ title: "Couldn't draft objectives", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setDrafting(false);
    }
  }

  // ── Build deck ──
  async function download() {
    if (!d.opponent) { toast({ title: "Pick an opponent first", variant: "destructive" }); return; }
    setBuilding(true);
    try {
      const lineup: PitchPlayer[] = slots.map((s) => ({
        px: s.px, py: s.py, label: s.num,
        name: d.xi[s.id] || s.role,
      }));
      const theirSlots = FORMATIONS[d.theirFormation] ?? FORMATIONS["433"];
      const theirPlayers: PitchPlayer[] = theirSlots.map((s) => ({ px: s.px, py: s.py, label: s.num, color: "B54A4A" }));

      const spPlayers = (
        roles: Record<string, string[]>,
        spots: Record<string, Array<[number, number]>>,
        skip: string[] = [],
      ): PitchPlayer[] => {
        const out: PitchPlayer[] = [];
        for (const [role, players] of Object.entries(roles)) {
          if (skip.includes(role)) continue;
          const coords = spots[role] ?? [];
          players.forEach((name, i) => {
            const c = coords[i] ?? coords[coords.length - 1];
            if (!c) return;
            out.push({ px: c[0] + (i >= coords.length ? 0.05 * (i - coords.length + 1) : 0), py: c[1], label: SHORT(name), name });
          });
        }
        return out;
      };

      const groups = (roles: Record<string, string[]>, order: string[]): SetPieceGroup[] =>
        order.map((role) => ({ role, players: roles[role] ?? [] })).filter((g) => g.players.length);

      const fk: SetPieceGroup[] = [
        { role: "Wide free kicks — takers", players: lines(d.fkWide) },
        { role: "Central free kicks — takers", players: lines(d.fkCentral) },
      ].filter((g) => g.players.length);

      const { buildPrematchDeck } = await import("@/lib/prematchPptx");
      const blob = await buildPrematchDeck({
        round: d.round || "Match",
        opponent: d.opponent,
        matchDate: d.matchDate || "",
        generatedOn: new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }),
        formationName: d.formation,
        lineup,
        subs: d.subs,
        ourBp: { players: lineup, notes: lines(d.ourBpNotes) },
        ourBpo: { players: lineup, notes: lines(d.ourBpoNotes) },
        theirBp: { players: theirPlayers, notes: lines(d.theirBpNotes) },
        theirBpo: { players: theirPlayers, notes: lines(d.theirBpoNotes) },
        theirFormationName: d.theirFormation,
        objectivesBp: d.bp,
        objectivesBpo: d.bpo,
        cornersFor: {
          groups: groups(d.spFor, Object.keys(CORNERS_FOR_SPOTS)),
          players: spPlayers(d.spFor, CORNERS_FOR_SPOTS, ["Stay back", "Taker"]).concat(
            (d.spFor["Taker"] ?? []).slice(0, 1).map((name) => ({ px: 0.965, py: 0.03, label: SHORT(name), name })),
          ),
        },
        cornersAgainst: {
          groups: groups(d.spAgainst, Object.keys(CORNERS_AGAINST_SPOTS)),
          players: spPlayers(d.spAgainst, CORNERS_AGAINST_SPOTS),
        },
        freeKicks: fk,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Match prep — ${d.round || "game"} v ${d.opponent}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Couldn't build the deck", description: e instanceof Error ? e.message : "Try again.", variant: "destructive" });
    } finally {
      setBuilding(false);
    }
  }

  // ── UI helpers ──
  const PlayerSelect = ({ value, onChange, exclude }: { value: string; onChange: (v: string) => void; exclude?: Set<string> }) => (
    <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
      <SelectTrigger className="h-9"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">—</SelectItem>
        {roster.map((n) => (
          <SelectItem key={n} value={n} disabled={exclude?.has(n) && n !== value}>{n}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const MultiPick = ({ pool, value, onChange, max }: { pool: string[]; value: string[]; onChange: (v: string[]) => void; max?: number }) => (
    <div className="flex flex-wrap gap-1.5">
      {pool.map((n) => {
        const on = value.includes(n);
        return (
          <button
            key={n}
            type="button"
            onClick={() => {
              if (on) onChange(value.filter((v) => v !== n));
              else if (!max || value.length < max) onChange([...value, n]);
            }}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${on ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:border-primary/50"}`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );

  const spRole = (store: "spFor" | "spAgainst", role: string, max?: number) => (
    <div key={role} className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{role}{max ? ` (up to ${max})` : ""}</Label>
      <MultiPick pool={squad} value={d[store][role] ?? []} onChange={(v) => set(store, { ...d[store], [role]: v })} max={max} />
    </div>
  );

  const objEditor = (key: "bp" | "bpo", title: string) => {
    const o = d[key];
    const setObj = (patch: Partial<UnitObjectives>) => set(key, { ...o, ...patch });
    const unit = (label: string, k: "gk" | "defenders" | "midfielders" | "attackers") => (
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{label} — one point per line</Label>
        <Textarea
          rows={2}
          value={o[k].join("\n")}
          onChange={(e) => setObj({ [k]: e.target.value.split("\n") } as Partial<UnitObjectives>)}
          onBlur={(e) => setObj({ [k]: lines(e.target.value) } as Partial<UnitObjectives>)}
        />
      </div>
    );
    return (
      <div className="space-y-3">
        <h4 className="font-semibold text-sm">{title}</h4>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Theme line</Label>
          <Input value={o.theme} onChange={(e) => setObj({ theme: e.target.value })} placeholder="e.g. Control the tempo. Keep them under pressure." />
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {unit("GK", "gk")}
          {unit("Defenders", "defenders")}
          {unit("Midfielders", "midfielders")}
          {unit("Attackers", "attackers")}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Match Prep</h1>
          <p className="text-sm text-muted-foreground">Friday pre-match deck — for the players, the night before the game. Your picks save automatically on this device.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setD(blankDraft())}>Start fresh</Button>
          <Button onClick={download} disabled={building || !d.opponent}>
            {building ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
            Download deck
          </Button>
        </div>
      </div>

      {/* Match details */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">1 · Match</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label>Opponent</Label>
            <Select value={d.opponent} onValueChange={(v) => set("opponent", v)}>
              <SelectTrigger><SelectValue placeholder="Pick opponent" /></SelectTrigger>
              <SelectContent>
                {(oppClubs ?? []).filter((c) => c !== "Belconnen").map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Round</Label>
            <Input value={d.round} onChange={(e) => set("round", e.target.value)} placeholder="e.g. R16" />
          </div>
          <div className="space-y-1.5">
            <Label>Match date</Label>
            <MatchDatePicker value={d.matchDate} onChange={(v) => set("matchDate", v)} />
          </div>
          <div className="space-y-1.5">
            <Label>Our formation</Label>
            <Select value={d.formation} onValueChange={(v) => set("formation", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.keys(FORMATIONS).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Lineup */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">2 · Starting XI & subs</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
          <div
            className="relative mx-auto w-full min-w-[440px] max-w-2xl rounded-md border border-white/20 overflow-hidden"
            style={{
              aspectRatio: "4 / 3.4",
              background:
                "repeating-linear-gradient(to right, #3e8e54 0, #3e8e54 14.28%, #46995c 14.28%, #46995c 28.56%)",
            }}
          >
            {/* halfway line + centre circle */}
            <div className="absolute left-0 right-0 top-1/2 h-px bg-white/50" />
            <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/50" />
            {/* penalty boxes */}
            <div className="absolute left-1/2 top-0 h-[13%] w-[44%] -translate-x-1/2 border border-t-0 border-white/50" />
            <div className="absolute left-1/2 bottom-0 h-[13%] w-[44%] -translate-x-1/2 border border-b-0 border-white/50" />
            {slots.map((s) => (
              <div
                key={s.id}
                className="absolute flex w-[120px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
                style={{ left: `clamp(62px, ${s.px * 100}%, calc(100% - 62px))`, top: `${s.py * 100}%` }}
              >
                <span className="rounded-full bg-slate-900/80 px-1.5 py-px text-[10px] font-bold text-sky-200">
                  {s.num} · {s.role}
                </span>
                <PlayerSelect value={d.xi[s.id] ?? ""} onChange={(v) => set("xi", { ...d.xi, [s.id]: v })} exclude={picked} />
              </div>
            ))}
          </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Subs</Label>
            <MultiPick pool={roster.filter((n) => !xiNames.includes(n))} value={d.subs} onChange={(v) => set("subs", v)} />
          </div>
        </CardContent>
      </Card>

      {/* Shapes */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">3 · Shapes — one point per line</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Our shape — with the ball</Label>
            <Textarea rows={3} value={d.ourBpNotes} onChange={(e) => set("ourBpNotes", e.target.value)} placeholder={"8 plays a little deeper to help buildup\nWingers give width"} />
          </div>
          <div className="space-y-1.5">
            <Label>Our shape — without the ball</Label>
            <Textarea rows={3} value={d.ourBpoNotes} onChange={(e) => set("ourBpoNotes", e.target.value)} placeholder={"We move from 433 to 442\nWingers tuck in to join midfield"} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Their shape — with the ball</Label>
              <Select value={d.theirFormation} onValueChange={(v) => set("theirFormation", v)}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(FORMATIONS).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Textarea rows={3} value={d.theirBpNotes} onChange={(e) => set("theirBpNotes", e.target.value)} placeholder={"Outside centre backs happy to advance\nBoth forwards run in behind"} />
          </div>
          <div className="space-y-1.5">
            <Label>Their shape — without the ball</Label>
            <Textarea rows={3} value={d.theirBpoNotes} onChange={(e) => set("theirBpoNotes", e.target.value)} placeholder={"Back 4 not always organised\nBig spaces between the lines"} />
          </div>
        </CardContent>
      </Card>

      {/* Objectives */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">4 · Key objectives</CardTitle>
            <Button variant="outline" size="sm" onClick={draftObjectives} disabled={drafting || !d.opponent}>
              {drafting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Draft with AI
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>Your game plan notes (feeds the AI draft)</Label>
            <Textarea rows={3} value={d.gamePlan} onChange={(e) => set("gamePlan", e.target.value)} placeholder={"e.g. They are direct and quick — we control the tempo, keep the ball, be patient. Watch their no. 12 in behind."} />
          </div>
          {objEditor("bp", "With the ball (BP)")}
          {objEditor("bpo", "Without the ball (BPO)")}
        </CardContent>
      </Card>

      {/* Set pieces */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">5 · Set pieces</CardTitle></CardHeader>
        <CardContent className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Corners — for</h4>
            {spRole("spFor", "Taker", 2)}
            {spRole("spFor", "Attack the goal", 4)}
            {spRole("spFor", "Near post", 1)}
            {spRole("spFor", "Edge of box", 2)}
            {spRole("spFor", "Stay back", 2)}
          </div>
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Corners — against</h4>
            {spRole("spAgainst", "Man marking", 5)}
            {spRole("spAgainst", "Near post", 1)}
            {spRole("spAgainst", "Far post", 1)}
            {spRole("spAgainst", "Edge of box / halfway", 2)}
            <h4 className="font-semibold text-sm pt-2">Free kicks</h4>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Wide takers — one per line</Label>
              <Textarea rows={2} value={d.fkWide} onChange={(e) => set("fkWide", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Central takers — one per line</Label>
              <Textarea rows={2} value={d.fkCentral} onChange={(e) => set("fkCentral", e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Week Ahead — the Monday briefing lives here too: both are prep. */}
      <div className="space-y-2 pt-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileDown className="h-5 w-5 text-primary" /> Week Ahead report
        </h2>
        <WeekAheadCard />
      </div>
    </div>
  );
}
