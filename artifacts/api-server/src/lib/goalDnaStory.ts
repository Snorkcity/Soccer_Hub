// Goal DNA match story — the per-goal "today vs our season DNA" badges and the
// short tactical read for the match report. Shared by the team match report
// and the scouting (subject-club) variant; `voice` flips we/our ↔ they/their.
//
// Design (coach-agreed): every goal in THIS match gets a row with a small badge
// placing it against the season DNA (signature / rare / typical / no type yet),
// plus a 2–3 sentence tactical read built from goal minutes + types.

export type DnaCatId = "setPiece" | "frontThird" | "middleThird" | "backThird";

export const dnaCatOfType = (t: string | null | undefined): DnaCatId | null => {
  const s = t?.trim().toUpperCase();
  if (!s) return null;
  if (s.startsWith("SP")) return "setPiece";
  if (s.startsWith("R-FT")) return "frontThird";
  if (s.startsWith("R-MT")) return "middleThird";
  if (s.startsWith("R-BT")) return "backThird";
  return null;
};

const CAT_SHORT: Record<DnaCatId, string> = {
  setPiece: "set piece", frontThird: "front-third regain",
  middleThird: "middle-third regain", backThird: "back-third regain",
};

export interface DnaStoryGoalIn {
  minute: number | null;
  scorer: string | null;
  goalType: string | null;
}

export interface DnaStoryCat {
  id: DnaCatId;
  count: number;
  pct: number | null;
  verdict: "high" | "low" | null;
}

export interface DnaMatchGoalOut {
  side: "scored" | "conceded";
  minute: number | null;
  scorer: string | null;
  goalType: string | null;
  category: string | null;   // human label, e.g. "middle-third regain"
  timing: "DT" | "AT" | null;
  badgeTone: "signature" | "rare" | "typical" | "untyped";
  badgeText: string;
}

interface Voice { our: string; we: string; they: string; their: string }
const VOICES: Record<"team" | "scout", Voice> = {
  team:  { our: "our", we: "we", they: "they", their: "their" },
  scout: { our: "their", we: "they", they: "their opponents", their: "their opponents'" },
};

const ordinal = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

export function buildDnaStory(opts: {
  scored: DnaStoryGoalIn[];
  conceded: DnaStoryGoalIn[];
  catsScored: DnaStoryCat[];
  catsConceded: DnaStoryCat[];
  totalTypedScored: number;
  totalTypedConceded: number;
  voice: "team" | "scout";
}): { matchGoals: DnaMatchGoalOut[]; tacticalRead: string[] } {
  const v = VOICES[opts.voice];

  const badgeFor = (g: DnaStoryGoalIn, side: "scored" | "conceded"): Pick<DnaMatchGoalOut, "badgeTone" | "badgeText"> => {
    const cat = dnaCatOfType(g.goalType);
    if (!cat) return { badgeTone: "untyped", badgeText: "type to be added" };
    const cats = side === "scored" ? opts.catsScored : opts.catsConceded;
    const totalTyped = side === "scored" ? opts.totalTypedScored : opts.totalTypedConceded;
    const c = cats.find(x => x.id === cat);
    if (!c || totalTyped < 12 || c.pct == null) {
      return { badgeTone: "typical", badgeText: `${c?.count ?? 1} this season` };
    }
    // Rarity beats everything — first or second of the whole season this way.
    if (c.count <= 2) {
      const who = side === "scored" ? v.our : v.our;
      return { badgeTone: "rare", badgeText: `only ${who} ${ordinal(c.count)} this season` };
    }
    // Signature = the side's biggest category (prefer over-benchmark), ≥25%.
    const sig = cats.slice().sort((a, b) =>
      (b.verdict === "high" ? 1000 : 0) + b.count - ((a.verdict === "high" ? 1000 : 0) + a.count))[0];
    if (sig && sig.id === cat && c.pct >= 25) {
      return { badgeTone: "signature", badgeText: `${v.our} signature — ${c.pct.toFixed(0)}% of ${side === "scored" ? "goals" : "goals conceded"}` };
    }
    return { badgeTone: "typical", badgeText: `${c.pct.toFixed(0)}% of ${v.our} season ${side === "scored" ? "goals" : "goals conceded"}` };
  };

  const rowOf = (g: DnaStoryGoalIn, side: "scored" | "conceded"): DnaMatchGoalOut => {
    const cat = dnaCatOfType(g.goalType);
    const t = (g.goalType ?? "").trim().toUpperCase();
    return {
      side, minute: g.minute, scorer: g.scorer, goalType: g.goalType,
      category: cat ? CAT_SHORT[cat] : null,
      timing: cat && cat !== "setPiece" ? (t.endsWith("-AT") ? "AT" : t.endsWith("-DT") ? "DT" : null) : null,
      ...badgeFor(g, side),
    };
  };

  const matchGoals = [
    ...opts.scored.map(g => rowOf(g, "scored")),
    ...opts.conceded.map(g => rowOf(g, "conceded")),
  ].sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));

  // ── Tactical read: 2–3 sentences from minutes + types ─────────────────────
  const read: string[] = [];
  const scoredMins = opts.scored.map(g => g.minute).filter((m): m is number => m != null).sort((a, b) => a - b);
  const concededMins = opts.conceded.map(g => g.minute).filter((m): m is number => m != null).sort((a, b) => a - b);

  // 1. Quick response either way (within 10 minutes).
  let gaveBack: number | null = null, hitBack: number | null = null;
  for (const cm of concededMins) {
    const prior = scoredMins.filter(sm => sm <= cm && cm - sm <= 10);
    if (prior.length) gaveBack = Math.min(gaveBack ?? 99, cm - prior[prior.length - 1]);
  }
  for (const sm of scoredMins) {
    const prior = concededMins.filter(cm => cm <= sm && sm - cm <= 10);
    if (prior.length) hitBack = Math.min(hitBack ?? 99, sm - prior[prior.length - 1]);
  }
  if (hitBack != null) read.push(opts.voice === "team"
    ? `We answered within ${Math.max(1, hitBack)} minute${hitBack === 1 ? "" : "s"} of conceding — the response was there.`
    : `They answered within ${Math.max(1, hitBack)} minute${hitBack === 1 ? "" : "s"} of conceding — expect a reaction if you score.`);
  if (gaveBack != null && read.length < 3) read.push(opts.voice === "team"
    ? `We gave one back within ${Math.max(1, gaveBack)} minute${gaveBack === 1 ? "" : "s"} of scoring — the transition moments straight after our goals need attention; think faster, move faster when the ball turns over.`
    : `They conceded within ${Math.max(1, gaveBack)} minute${gaveBack === 1 ? "" : "s"} of scoring — the moments straight after their goals are a window.`);

  // 2. Transition timing across this match's typed regain goals (scored side).
  const regains = opts.scored
    .map(g => ({ cat: dnaCatOfType(g.goalType), t: (g.goalType ?? "").trim().toUpperCase() }))
    .filter(x => x.cat != null && x.cat !== "setPiece");
  if (regains.length >= 2 && read.length < 3) {
    if (regains.every(x => x.t.endsWith("-DT"))) {
      read.push(opts.voice === "team"
        ? `Every regain goal came inside the transition window — we thought faster and moved faster in the seconds after winning the ball, before they could reset.`
        : `Every regain goal came inside the transition window — the seconds after they win the ball are where they hurt you; a slow reset gets punished.`);
    } else if (regains.every(x => x.t.endsWith("-AT"))) {
      read.push(opts.voice === "team"
        ? `Each regain goal came against an organised defence — patient buildup, then the bravery to break the line when the moment arrived.`
        : `Each regain goal came against an organised defence — they stay patient against a set block and break the line when the moment comes; sitting deep won't be enough.`);
    }
  }

  // 3. Timing clusters: one-half scoring, early lead, late goals.
  const allMins = [...scoredMins, ...concededMins];
  if (read.length < 3 && allMins.length >= 2) {
    if (allMins.every(m => m > 45)) read.push(`All the goals came after the break — the first half gave nothing away.`);
    else if (allMins.every(m => m <= 45)) read.push(`Everything was settled by half-time — the second half didn't produce a goal.`);
  }
  if (read.length < 3 && scoredMins.length > 0 && scoredMins[0] <= 15 && (concededMins.length === 0 || scoredMins[0] < concededMins[0])) {
    read.push(opts.voice === "team"
      ? `In front inside ${scoredMins[0]} minute${scoredMins[0] === 1 ? "" : "s"} — the start set the tone.`
      : `They led inside ${scoredMins[0]} minute${scoredMins[0] === 1 ? "" : "s"} — starts matter against this side.`);
  }
  if (read.length < 3 && concededMins.some(m => m >= 80)) {
    read.push(opts.voice === "team"
      ? `Conceded in the final 10 minutes — how we close games out is worth a look.`
      : `They conceded in the final 10 minutes — they can be got at late.`);
  }

  // 4. Set pieces today.
  if (read.length < 3) {
    const spToday = opts.scored.filter(g => dnaCatOfType(g.goalType) === "setPiece").length;
    if (spToday >= 2) read.push(opts.voice === "team"
      ? `${spToday} from set pieces today — the rehearsed stuff keeps paying off.`
      : `${spToday} set-piece goals in this one — dead balls are a live threat.`);
  }

  return { matchGoals, tacticalRead: read.slice(0, 3) };
}
