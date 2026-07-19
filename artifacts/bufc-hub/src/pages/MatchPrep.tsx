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
  "451": [
    { id: "gk", num: "1", role: "GK", px: 0.5, py: 0.93 },
    { id: "rb", num: "2", role: "RB", px: 0.85, py: 0.72 },
    { id: "rcb", num: "5", role: "CB", px: 0.63, py: 0.79 },
    { id: "lcb", num: "4", role: "CB", px: 0.37, py: 0.79 },
    { id: "lb", num: "3", role: "LB", px: 0.15, py: 0.72 },
    { id: "dm", num: "6", role: "6", px: 0.5, py: 0.58 },
    { id: "rcm", num: "8", role: "8", px: 0.68, py: 0.44 },
    { id: "lcm", num: "10", role: "10", px: 0.32, py: 0.44 },
    { id: "rw", num: "7", role: "RM", px: 0.85, py: 0.36 },
    { id: "st", num: "9", role: "ST", px: 0.5, py: 0.15 },
    { id: "lw", num: "11", role: "LM", px: 0.15, py: 0.36 },
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
// Takers pin to their own corner and may double up in other roles (they're in the
// picture when the corner comes from the other side).
const TAKER_R = "Taker — right";
const TAKER_L = "Taker — left";
const CORNERS_FOR_SPOTS: Record<string, Array<[number, number]>> = {
  "Attack the goal": [[0.4, 0.3], [0.46, 0.3], [0.52, 0.3], [0.43, 0.42], [0.49, 0.42]], // front three pushed on, two just behind
  "Far post": [[0.34, 0.1]],
  "Closer to corner taker": [[0.74, 0.45]],
  "Edge of box": [[0.5, 0.55], [0.62, 0.52]],
  "Stay back": [[0.6, 0.82], [0.48, 0.94]], // staggered on the way back to halfway
};
// Crowd the keeper — 4 around the keeper, far post cover, a runner from just inside
// the 18-yard box straight to the far post, one outside the box, two back at halfway.
const CORNERS_FOR2_SPOTS: Record<string, Array<[number, number]>> = {
  // Tight 2×2 around the six-yard box, right in the keeper's space.
  "Crowd the keeper": [[0.465, 0.06], [0.535, 0.06], [0.47, 0.148], [0.53, 0.148]],
  "Far post": [[0.34, 0.1]], // same spot as the standard routine
  "Runner to far post": [[0.5, 0.31]], // just inside the 18-yard box
  "Outside the box": [[0.5, 0.58]],
  Halfway: [[0.6, 0.82], [0.48, 0.94]], // staggered, same as standard's stay back
};
const CORNERS_AGAINST_SPOTS: Record<string, Array<[number, number]>> = {
  // Tight "Olympic rings" cluster — 3 over 2 — so they read as one marking group.
  "Man marking": [[0.43, 0.23], [0.5, 0.23], [0.57, 0.23], [0.465, 0.295], [0.535, 0.295]],
  "Near post": [[0.435, 0.045]],
  "Far post": [[0.565, 0.045]],
  "First defender": [[0.58, 0.14]], // in line with the right-sided post
  "Edge of box": [[0.5, 0.58]],
  Halfway: [[0.5, 0.94]],
};
// Zonal setup — 4 in the zone, 1 in front of them on the 6-yard line, posts, floater, edge of box, halfway.
const CORNERS_AGAINST_ZONAL_SPOTS: Record<string, Array<[number, number]>> = {
  "Zone (4)": [[0.41, 0.142], [0.47, 0.14], [0.53, 0.142], [0.59, 0.14]],
  "Front of zone": [[0.5, 0.242]],
  "Near post": [[0.435, 0.045]],
  "Far post": [[0.565, 0.045]],
  Floater: [[0.6, 0.3]],
  "Edge of box": [[0.5, 0.56]],
  Halfway: [[0.5, 0.94]],
};

// Short role code shown under each picker circle (e.g. "Attack the goal" → AG).
const ABBR = (role: string) =>
  role.replace(/\(.*?\)/g, "").split(/[\s—-]+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 2);

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
  theirFormationBpo: string;
  xi: Record<string, string>; // slotId -> player name
  subs: string[];
  ourBpNotes: string;
  ourBpoNotes: string;
  theirBpNotes: string;
  theirBpoNotes: string;
  gamePlan: string;
  bp: UnitObjectives;
  bpo: UnitObjectives;
  spTakers: Record<string, string[]>; // corner takers, shared by both corners-for variations
  spFor: Record<string, string[]>;
  spFor2: Record<string, string[]>;
  spAgainst: Record<string, string[]>;
  spAgainstZonal: Record<string, string[]>;
  spAgainstMode: "man" | "zonal";
  fkWide: string;
  fkCentral: string;
}

const DRAFT_KEY = "bufc-matchprep-draft-v1";

const blankDraft = (): Draft => ({
  opponent: "", round: "", matchDate: "", formation: "433", theirFormation: "433", theirFormationBpo: "433",
  xi: {}, subs: [],
  ourBpNotes: "", ourBpoNotes: "", theirBpNotes: "", theirBpoNotes: "",
  gamePlan: "", bp: emptyObjectives(), bpo: emptyObjectives(),
  spTakers: {}, spFor: {}, spFor2: {}, spAgainst: {}, spAgainstZonal: {}, spAgainstMode: "man", fkWide: "", fkCentral: "",
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
    if (raw) {
      const d: Draft = { ...blankDraft(), ...JSON.parse(raw) };
      // Old drafts named the corners-for role "Near post" — carry the pick over to "Far post".
      if (d.spFor?.["Near post"]?.filter(Boolean).length && !d.spFor["Far post"]?.filter(Boolean).length) {
        d.spFor = { ...d.spFor, "Far post": d.spFor["Near post"] };
      }
      return d;
    }
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
  const xiSet = new Set(xiNames);
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
      const theirBpoSlots = FORMATIONS[d.theirFormationBpo] ?? theirSlots;
      const theirBpoPlayers: PitchPlayer[] = theirBpoSlots.map((s) => ({ px: s.px, py: s.py, label: s.num, color: "B54A4A" }));

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
            if (!name) return; // empty pitch-picker slot
            const c = coords[i] ?? coords[coords.length - 1];
            if (!c) return;
            out.push({ px: c[0] + (i >= coords.length ? 0.05 * (i - coords.length + 1) : 0), py: c[1], label: SHORT(name), name });
          });
        }
        return out;
      };

      // Diagram shows a right-sided corner: the right taker is always at the right
      // corner (next to the ball) and never at a role spot. The left taker draws at
      // her role spot when she's been given one; otherwise she waits in the left corner.
      const takR = ((d.spTakers ?? {})[TAKER_R] ?? [])[0];
      const takL = ((d.spTakers ?? {})[TAKER_L] ?? [])[0];
      const takerPins = (): PitchPlayer[] => {
        const pins: PitchPlayer[] = [];
        if (takR) pins.push({ px: 0.99, py: 0.012, label: SHORT(takR), name: takR });
        if (takL) pins.push({ px: 0.01, py: 0.012, label: SHORT(takL), name: takL });
        return pins;
      };
      const takerGroups: SetPieceGroup[] = [TAKER_R, TAKER_L]
        .map((role) => ({ role, players: (d.spTakers ?? {})[role] ?? [] }))
        .filter((g) => g.players.length);

      const groups = (roles: Record<string, string[]>, order: string[]): SetPieceGroup[] =>
        order.map((role) => ({ role, players: (roles[role] ?? []).filter(Boolean) })).filter((g) => g.players.length);

      // Belt and braces for drafts saved under the old "Near post" role name —
      // treat it as "Far post" at deck time even if the load-time migration was missed.
      const spForRoles: Record<string, string[]> =
        (d.spFor?.["Near post"]?.filter(Boolean).length && !d.spFor["Far post"]?.filter(Boolean).length)
          ? { ...d.spFor, "Far post": d.spFor["Near post"] }
          : (d.spFor ?? {});

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
        theirBpo: { players: theirBpoPlayers, notes: lines(d.theirBpoNotes) },
        theirFormationName: d.theirFormation,
        theirFormationBpoName: d.theirFormationBpo,
        objectivesBp: d.bp,
        objectivesBpo: d.bpo,
        cornersFor: {
          groups: takerGroups.concat(groups(spForRoles, Object.keys(CORNERS_FOR_SPOTS))),
          players: spPlayers(spForRoles, CORNERS_FOR_SPOTS).concat(takerPins()),
        },
        cornersFor2: {
          groups: takerGroups.concat(groups(d.spFor2, Object.keys(CORNERS_FOR2_SPOTS))),
          players: spPlayers(d.spFor2, CORNERS_FOR2_SPOTS).concat(takerPins()),
        },
        cornersAgainst: {
          groups: d.spAgainstMode === "zonal"
            ? groups(d.spAgainstZonal, Object.keys(CORNERS_AGAINST_ZONAL_SPOTS))
            : groups(d.spAgainst, Object.keys(CORNERS_AGAINST_SPOTS)),
          players: (d.spAgainstMode === "zonal"
            // Zone players draw in navy on the slide — they ARE the zone.
            ? spPlayers(d.spAgainstZonal, CORNERS_AGAINST_ZONAL_SPOTS).map((p) => {
                const zone = [...(d.spAgainstZonal["Zone (4)"] ?? []), ...(d.spAgainstZonal["Front of zone"] ?? [])].filter(Boolean);
                return p.name && zone.includes(p.name) ? { ...p, color: "172554" } : p;
              })
            : spPlayers(d.spAgainst, CORNERS_AGAINST_SPOTS)
          ).concat([{ px: 0.99, py: 0.012, label: "OP", name: "Their taker", color: "B54A4A" }]),
        },
        cornersAgainstLabel: d.spAgainstMode === "zonal" ? "Corners — against — zonal" : "Corners — against — man marking",
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
  const PlayerSelect = ({ value, onChange, exclude, circle, options, title, navy }: {
    value: string; onChange: (v: string) => void; exclude?: Set<string>;
    circle?: boolean; options?: string[]; title?: string; navy?: boolean;
  }) => (
    <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
      <SelectTrigger
        title={title}
        className={circle
          ? `h-8 w-8 shrink-0 justify-center rounded-full border p-0 text-[10px] font-bold [&>svg]:hidden ${value ? `border-white ${navy ? "bg-blue-950" : "bg-sky-500"} text-white` : `border-dashed border-white/70 ${navy ? "bg-blue-950/60" : "bg-white/15"} text-white/90`}`
          : "h-9"}
      >
        {circle
          ? <span>{value ? SHORT(value) : "+"}</span>
          : <SelectValue placeholder="—" />}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">—</SelectItem>
        {(options ?? roster).map((n) => (
          <SelectItem key={n} value={n} disabled={exclude?.has(n) && n !== value}>{n}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  // `exempt` names (the corner takers) don't count toward `max` — one of them takes,
  // the other joins a role, so they ride along on top of the role's normal quota.
  const MultiPick = ({ pool, value, onChange, max, starters, taken, exempt }: { pool: string[]; value: string[]; onChange: (v: string[]) => void; max?: number; starters?: Set<string>; taken?: Set<string>; exempt?: Set<string> }) => (
    <div className="flex flex-wrap gap-1.5">
      {pool.map((n) => {
        const on = value.includes(n);
        const starting = starters?.has(n) ?? false;
        // Already used in another role of this set piece — greyed out with a strike so you can't double up.
        const used = !on && (taken?.has(n) ?? false);
        const cls = used
          ? "bg-muted/40 text-muted-foreground/50 border-dashed border-border line-through cursor-not-allowed"
          : on
            ? starting
              ? "bg-emerald-500 text-white border-emerald-500"
              : "bg-primary text-primary-foreground border-primary"
            : starting
              ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/60 hover:border-emerald-400"
              : "bg-background text-muted-foreground border-border hover:border-primary/50";
        return (
          <button
            key={n}
            type="button"
            disabled={used}
            onClick={() => {
              if (on) onChange(value.filter((v) => v !== n));
              else if (!max || exempt?.has(n) || value.filter((v) => !exempt?.has(v)).length < max) onChange([...value, n]);
            }}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${cls}`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );

  // Pitch-based picker for the corner set pieces — a dropdown at each spot so the
  // coach can see where each player is standing (attacking goal at the top).
  const CornerPitch = ({ store, spots }: { store: "spFor" | "spFor2" | "spAgainst" | "spAgainstZonal"; spots: Record<string, Array<[number, number]>> }) => {
    const roles = d[store] ?? {};
    // Only starters can hold a corner role — they're the ones on the pitch.
    const starters = roster.filter((n) => xiSet.has(n));
    // Everyone — takers included — can only stand in one spot per pitch.
    const assigned = new Set(
      Object.entries(roles)
        .filter(([r]) => r in spots)
        .flatMap(([, ns]) => ns)
        .filter(Boolean),
    );
    // Takers still pick a role — the corner pins just show who's taking, while
    // their role spot shows where they stand when they're not taking.
    const setSpot = (role: string, i: number, v: string) => {
      const arr = [...(roles[role] ?? [])];
      while (arr.length <= i) arr.push("");
      arr[i] = v;
      set(store, { ...roles, [role]: arr });
    };
    const takR = ((d.spTakers ?? {})[TAKER_R] ?? [])[0];
    // On the attacking pitches, the takers are picked right in the corners.
    const showTakers = store === "spFor" || store === "spFor2";
    const takers = d.spTakers ?? {};
    const setTaker = (role: string, v: string) => set("spTakers", { ...takers, [role]: v ? [v] : [] });
    const takerSpots: Array<[string, string, string]> = [
      [TAKER_L, "TL", "18px"],
      [TAKER_R, "TR", "calc(100% - 18px)"],
    ];
    return (
      <div className="overflow-x-auto">
        <div
          className="relative mx-auto w-full min-w-[420px] max-w-xl rounded-md border border-white/20 overflow-hidden"
          style={{
            aspectRatio: "4 / 2.5",
            background:
              "repeating-linear-gradient(to right, #3e8e54 0, #3e8e54 14.28%, #46995c 14.28%, #46995c 28.56%)",
          }}
        >
          {/* goal + boxes at the top, halfway line at the bottom */}
          <div className="absolute left-1/2 top-0 h-1.5 w-[16%] -translate-x-1/2 bg-white/90" />
          <div className="absolute left-1/2 top-0 h-[34.7%] w-[62%] -translate-x-1/2 border border-t-0 border-white/50" />
          <div className="absolute left-1/2 top-0 h-[11.8%] w-[28%] -translate-x-1/2 border border-t-0 border-white/50" />
          <div className="absolute left-0 right-0 bottom-0 h-px bg-white/50" />
          {/* top half of the centre circle poking up from the halfway line */}
          <div className="absolute bottom-0 left-1/2 aspect-square w-[27%] -translate-x-1/2 translate-y-1/2 rounded-full border border-white/50" />
          {/* ball in the right corner */}
          <div className="absolute right-[42px] top-[15px] h-2.5 w-2.5 rounded-full bg-white shadow" title={takR ? `Taker: ${takR}` : "Corner taker"} />
          {showTakers &&
            takerSpots.map(([role, code, left]) => {
              const current = (takers[role] ?? [])[0] ?? "";
              return (
                <div
                  key={role}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                  style={{ left, top: "20px" }}
                >
                  <PlayerSelect
                    circle
                    title={`${role}${current ? ` — ${current}` : ""}`}
                    value={current}
                    onChange={(v) => setTaker(role, v)}
                    exclude={new Set()}
                    options={starters}
                  />
                  <span className="pointer-events-none mt-px rounded bg-slate-900/70 px-1 text-[8px] font-bold leading-3 text-amber-200">
                    {code}
                  </span>
                </div>
              );
            })}
          {Object.entries(spots).map(([role, coords]) =>
            coords.map((c, i) => {
              const current = (roles[role] ?? [])[i] ?? "";
              const exclude = new Set([...assigned].filter((n) => n !== current));
              const label = `${ABBR(role)}${coords.length > 1 ? i + 1 : ""}`;
              return (
                <div
                  key={`${role}-${i}`}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                  style={{
                    left: `clamp(18px, ${c[0] * 100}%, calc(100% - 18px))`,
                    top: `clamp(20px, ${c[1] * 100}%, calc(100% - 26px))`,
                  }}
                >
                  <PlayerSelect
                    circle
                    navy={store === "spAgainstZonal" && (role === "Zone (4)" || role === "Front of zone")}
                    title={`${role}${coords.length > 1 ? ` ${i + 1}` : ""}${current ? ` — ${current}` : ""}`}
                    value={current}
                    onChange={(v) => setSpot(role, i, v)}
                    exclude={exclude}
                    options={starters}
                  />
                  <span className="pointer-events-none mt-px rounded bg-slate-900/70 px-1 text-[8px] font-bold leading-3 text-sky-200">
                    {label}
                  </span>
                </div>
              );
            }),
          )}
        </div>
        {/* legend for the role codes */}
        <div className="mx-auto mt-1 flex max-w-xl flex-wrap gap-x-3 gap-y-0.5 px-1 text-[10px] text-slate-400">
          {showTakers && (
            <>
              <span><span className="font-bold text-amber-300">TL</span> Taker — left</span>
              <span><span className="font-bold text-amber-300">TR</span> Taker — right</span>
            </>
          )}
          {Object.keys(spots).map((role) => (
            <span key={role}><span className="font-bold text-sky-300">{ABBR(role)}</span> {role}</span>
          ))}
        </div>
      </div>
    );
  };

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
      <div>
        <h1 className="text-2xl font-bold">Match Prep</h1>
        <p className="text-sm text-muted-foreground">Monday briefing and Friday pre-match deck. Your picks save automatically on this device.</p>
      </div>

      {/* Week Ahead — Monday briefing first: it starts the week. */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileDown className="h-5 w-5 text-primary" /> Week Ahead / Last Week Review report
        </h2>
        <WeekAheadCard />
      </div>

      {/* Deck actions live with the deck heading so they can't be mistaken for the report above. */}
      <div className="flex items-center justify-between gap-3 flex-wrap pt-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <FileDown className="h-5 w-5 text-primary" /> Friday pre-match deck
        </h2>
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
            <Label>Our shape — BP</Label>
            <Textarea rows={3} value={d.ourBpNotes} onChange={(e) => set("ourBpNotes", e.target.value)} placeholder={"8 plays a little deeper to help buildup\nWingers give width"} />
          </div>
          <div className="space-y-1.5">
            <Label>Our shape — BPO</Label>
            <Textarea rows={3} value={d.ourBpoNotes} onChange={(e) => set("ourBpoNotes", e.target.value)} placeholder={"We move from 433 to 442\nWingers tuck in to join midfield"} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Their shape — BP</Label>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Their formation</span>
                <Select value={d.theirFormation} onValueChange={(v) => set("theirFormation", v)}>
                  <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.keys(FORMATIONS).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <Textarea rows={3} value={d.theirBpNotes} onChange={(e) => set("theirBpNotes", e.target.value)} placeholder={"Outside centre backs happy to advance\nBoth forwards run in behind"} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Their shape — BPO</Label>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Their formation</span>
                <Select value={d.theirFormationBpo} onValueChange={(v) => set("theirFormationBpo", v)}>
                  <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.keys(FORMATIONS).map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
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
          {objEditor("bp", "BP")}
          {objEditor("bpo", "BPO")}
        </CardContent>
      </Card>

      {/* Set pieces */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">5 · Set pieces</CardTitle></CardHeader>
        <CardContent className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h4 className="font-semibold text-sm">Corners — for · standard</h4>
            <CornerPitch store="spFor" spots={CORNERS_FOR_SPOTS} />
            <h4 className="font-semibold text-sm pt-2">Corners — for · variation 2 — crowd the keeper</h4>
            <CornerPitch store="spFor2" spots={CORNERS_FOR2_SPOTS} />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h4 className="font-semibold text-sm">Corners — against</h4>
              <div className="flex gap-1">
                {(["man", "zonal"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => set("spAgainstMode", m)}
                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                      d.spAgainstMode === m
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50"
                    }`}
                  >
                    {m === "man" ? "Man marking" : "Zonal"}
                  </button>
                ))}
              </div>
            </div>
            {d.spAgainstMode === "man" ? (
              <CornerPitch store="spAgainst" spots={CORNERS_AGAINST_SPOTS} />
            ) : (
              <CornerPitch store="spAgainstZonal" spots={CORNERS_AGAINST_ZONAL_SPOTS} />
            )}
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

      {/* Bottom download — saves scrolling back up after filling everything in. */}
      <div className="flex justify-end">
        <Button onClick={download} disabled={building || !d.opponent}>
          {building ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
          Download deck
        </Button>
      </div>
    </div>
  );
}
