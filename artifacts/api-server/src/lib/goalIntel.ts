/**
 * Goal Analysis Intelligence — transition-state reads.
 *
 * Marries regain third (FT/MT/BT) with transition state (DT/AT), pass string
 * and build-up lane to describe HOW goals happen, per the coach's Goal
 * Analysis Intelligence Framework:
 *  - same regain third means very different football depending on DT vs AT
 *    (FT-DT = press forced a mistake; FT-AT = broke a low block after buildup)
 *  - transition goals should land within ~2–3 passes or the moment is gone
 *  - language stays hedged and sample-aware ("consistent with…", "may…")
 *
 * Coverage caveat: pass string / lane are only coded for some clubs, so every
 * read checks its own sample before speaking.
 */

export interface IntelGoal {
  goalType: string | null;
  passString: string | null;
  buildupLane: string | null;
  scorer: string | null;
  assist: string | null;
  howPenetrated?: string | null;
  assistType?: string | null;
}

export interface IntelRead {
  w: number;
  tone: "good" | "watch" | "info";
  text: string;
}

interface ParsedGoal {
  origin: "SP" | "FT" | "MT" | "BT" | null;
  trans: "DT" | "AT" | null;
  passes: number | null;
  lane: "left" | "centre" | "right" | null;
  scorer: string | null;
  assist: string | null;
  penetrated: "through" | "around" | "over" | null;
  assistType: string | null;
}

function parseGoal(g: IntelGoal): ParsedGoal {
  const t = g.goalType?.trim().toUpperCase() ?? "";
  const origin = t.startsWith("SP") ? "SP" as const
    : t.startsWith("R-FT") ? "FT" as const
    : t.startsWith("R-MT") ? "MT" as const
    : t.startsWith("R-BT") ? "BT" as const
    : null;
  const trans = origin && origin !== "SP"
    ? (t.endsWith("-DT") ? "DT" as const : t.endsWith("-AT") ? "AT" as const : null)
    : null;
  const p = Number(g.passString);
  const laneRaw = g.buildupLane?.trim().toLowerCase() ?? "";
  const lane = laneRaw.startsWith("l") ? "left" as const
    : laneRaw.startsWith("c") ? "centre" as const
    : laneRaw.startsWith("r") ? "right" as const
    : null;
  return {
    origin, trans,
    passes: g.passString != null && g.passString !== "" && Number.isFinite(p) ? p : null,
    lane,
    scorer: g.scorer && g.scorer !== "OG" ? g.scorer.trim() : null,
    assist: g.assist?.trim() || null,
    penetrated: (() => {
      const p = g.howPenetrated?.trim().toLowerCase() ?? "";
      return p === "through" || p === "around" || p === "over" ? p : null;
    })(),
    assistType: (() => {
      const a = g.assistType?.trim() ?? "";
      return a && a.toLowerCase() !== "error" ? a : null;
    })(),
  };
}

/** Most common non-null value when ≥min are recorded AND it holds ≥ shareMin. */
function topShare<T extends string>(
  vals: (T | null)[], min = 3, shareMin = 0.45,
): { label: T; count: number; total: number } | null {
  const known = vals.filter((v): v is T => v != null);
  if (known.length < min) return null;
  const counts = new Map<T, number>();
  for (const v of known) counts.set(v, (counts.get(v) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top[1] / known.length >= shareMin ? { label: top[0], count: top[1], total: known.length } : null;
}

function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = ns.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Dominant lane when ≥3 goals carry a lane and one lane holds ≥50%. */
function dominantLane(gs: ParsedGoal[]): { lane: string; pct: number } | null {
  const laned = gs.filter(g => g.lane != null);
  if (laned.length < 3) return null;
  const counts = new Map<string, number>();
  for (const g of laned) counts.set(g.lane!, (counts.get(g.lane!) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const pct = (top[1] / laned.length) * 100;
  return pct >= 50 ? { lane: top[0], pct } : null;
}

const laneWord = (lane: string) => (lane === "centre" ? "through the middle" : `down the ${lane}`);

/** Evidence-graded qualifier per the framework's confidence ladder. */
const conf = (n: number) => (n >= 10 ? "a clear pattern" : n >= 6 ? "an emerging pattern" : "early evidence");

/**
 * Transition-intelligence reads for one team's goals.
 *
 * voice "scout": about an upcoming opponent ("they/their") — their strengths
 * are watch, their weaknesses are good.
 * voice "self": about our own team ("we/our") — strengths good, gaps watch.
 */
export function goalIntelReads(
  scoredRaw: IntelGoal[],
  concededRaw: IntelGoal[],
  voice: "scout" | "self",
): IntelRead[] {
  const scored = scoredRaw.map(parseGoal);
  const conceded = concededRaw.map(parseGoal);
  const reads: IntelRead[] = [];
  const scout = voice === "scout";

  const open = scored.filter(g => g.origin != null && g.origin !== "SP" && g.trans != null);
  const openConc = conceded.filter(g => g.origin != null && g.origin !== "SP" && g.trans != null);

  // ── 1. Middle-third regains during transition — the counter threat ────────
  {
    const mtdt = open.filter(g => g.origin === "MT" && g.trans === "DT");
    if (mtdt.length >= 3 && open.length >= 6 && mtdt.length / open.length >= 0.25) {
      const med = median(mtdt.map(g => g.passes).filter((n): n is number => n != null));
      const passBit = med != null && mtdt.filter(g => g.passes != null).length >= 3
        ? ` — typically inside ${Math.round(med)} pass${Math.round(med) === 1 ? "" : "es"}`
        : "";
      const lane = dominantLane(mtdt);
      const laneBit = lane ? `, mostly ${laneWord(lane.lane)}` : "";
      reads.push(scout
        ? { w: 72, tone: "watch", text: `Beware their middle-third regains: ${mtdt.length} of their ${open.length} open-play goals come during transition, before the defence can reset${passBit}${laneBit}. ${conf(mtdt.length) === "a clear pattern" ? "That's a clear pattern" : "The evidence so far is consistent with a real counter threat"} — rest defence and quick reactions after we lose it are non-negotiable.` }
        : { w: 62, tone: "good", text: `Middle-third regains in transition are producing for us — ${mtdt.length} of ${open.length} open-play goals struck before the opponent reorganised${passBit}${laneBit}. That's ${conf(mtdt.length)} of punishing the moment of regain.` });
    }
  }

  // ── 2. Transition efficiency — do DT goals land inside 2–3 passes? ────────
  {
    const dt = open.filter(g => g.trans === "DT" && g.passes != null);
    if (dt.length >= 4) {
      const med = median(dt.map(g => g.passes!))!;
      if (med <= 3) {
        reads.push(scout
          ? { w: 58, tone: "watch", text: `Their transition goals arrive in ~${Math.round(med)} passes — they cash the moment in before you can reorganise. If we lose it, the first three seconds decide everything.` }
          : { w: 52, tone: "good", text: `When we score in transition it's within ~${Math.round(med)} passes — exactly the window before defences reset. That efficiency is the mark of a team that recognises the moment.` });
      } else if (med >= 5) {
        reads.push(scout
          ? { w: 40, tone: "good", text: `Even their transition goals take ~${Math.round(med)} passes — they're slower to strike after a regain, which gives an organised recovery a chance.` }
          : { w: 55, tone: "watch", text: `Our transition goals are taking ~${Math.round(med)} passes on average. The moment after a regain usually lasts 2–3 passes — take longer and the defence is set again. Worth a look at the first pass after we win it.` });
      }
    }
  }

  // ── 3. Front-third regains — DT (press pays) vs AT (low block broken) ─────
  {
    const ftdt = open.filter(g => g.origin === "FT" && g.trans === "DT");
    const ftat = open.filter(g => g.origin === "FT" && g.trans === "AT");
    if (ftdt.length >= 3) {
      reads.push(scout
        ? { w: 60, tone: "watch", text: `${ftdt.length} of their goals start with a front-third regain during transition — consistent with a press that forces mistakes near goal (though opponents playing risky build-up can inflate this). Clean, brave first-phase play or go longer — don't feed the press.` }
        : { w: 58, tone: "good", text: `${ftdt.length} goals have started with a front-third regain in transition — the press is forcing errors close to goal and we're punishing them. That's pressing producing attacking advantage, not just effort.` });
    }
    if (ftat.length >= 3) {
      // Fingerprint of HOW the set defence gets broken — penetration, lane,
      // assist type. Each bit only speaks when its own sample justifies it.
      const pen = topShare(ftat.map(g => g.penetrated));
      const lane = dominantLane(ftat);
      const at = topShare(ftat.map(g => g.assistType?.toLowerCase() ?? null));
      const penWord = (p: string) =>
        p === "through" ? "playing through the block" : p === "around" ? "working it around the block" : "going over the top of the block";
      const atWord = (a: string, n: number) => {
        const nice = a === "cutback" ? "the cutback" : a === "cross" ? "the cross" : a === "through ball" ? "the through ball"
          : a === "inswinger" ? "the inswinging delivery" : a === "outswinger" ? "the outswinging delivery"
          : a === "buildup" ? "patient build-up" : a === "counter" ? "the quick break" : a === "shot" ? "following up shots" : `the ${a}`;
        return `${nice} is the signature final ball (${n} of them)`;
      };
      const bits: string[] = [];
      if (pen) bits.push(`mostly ${penWord(pen.label)} (${pen.count} of ${pen.total} recorded)`);
      if (lane) bits.push(`${lane.lane === "centre" ? "straight through the middle" : `down the ${lane.lane}`}`);
      if (at) bits.push(atWord(at.label, at.count));
      const how = bits.length ? ` When it opens, it opens a particular way: ${bits.join(", ")}.` : "";
      reads.push(scout
        ? { w: 55, tone: "watch", text: `${ftat.length} of their goals came from front-third regains after the defence was set — teams sitting deep against them still get opened up.${how} Sitting off won't be enough; the block has to be active, not just deep.` }
        : { w: 56, tone: "good", text: `${ftat.length} goals from front-third regains after the opponent was organised — consistent with teams sitting in a low block against us, and we're coping well with it: moved around until an opening appeared.${how} That's ${conf(ftat.length)} — in this moment we're scoring, and we know how we're scoring.` });
    }
  }

  // ── 4. Back-third regains after transition — build-up from deep ───────────
  {
    const btat = open.filter(g => g.origin === "BT" && g.trans === "AT");
    if (btat.length >= 3) {
      reads.push(scout
        ? { w: 48, tone: "watch", text: `${btat.length} of their goals were built from their own back third against a set defence — evidence they can progress the full length of the pitch through an organised press. Pressing them high carries risk if the press isn't connected.` }
        : { w: 46, tone: "good", text: `${btat.length} goals built from our own back third against organised opponents — controlled progression through the thirds, not just clearances and hope.` });
    }
  }

  // ── 5. Concession profile — DT (rest defence) vs AT (sustained defending) ─
  {
    if (openConc.length >= 5) {
      const dtc = openConc.filter(g => g.trans === "DT").length;
      const share = (dtc / openConc.length) * 100;
      const sample = `${openConc.filter(g => g.trans === "DT").length} of the ${openConc.length} open-play goals they've conceded with the story recorded`;
      const sampleSelf = `${openConc.filter(g => g.trans === "DT").length} of our ${openConc.length} open-play concessions with the story recorded`;
      const hedge = openConc.length >= 10 ? "" : " — small sample, but worth testing early";
      if (share >= 55) {
        reads.push(scout
          ? { w: openConc.length >= 10 ? 68 : 55, tone: "good", text: `${sample} came during transition, before they could reorganise${hedge}. Rest defence looks like the soft spot: win it and go immediately, the first pass forward hurts them most.` }
          : { w: openConc.length >= 10 ? 70 : 58, tone: "watch", text: `${sampleSelf} came during transition — we're getting hurt in the moments straight after losing the ball${hedge}. Rest defence and the first reaction to a turnover are the areas to look at.` });
      } else if (share <= 30) {
        reads.push(scout
          ? { w: 52, tone: "info", text: `Most of what they concede comes after they're set (${openConc.length - openConc.filter(g => g.trans === "DT").length} of ${openConc.length} recorded) — they don't get countered easily, but sustained pressure and patient movement of their block pays.` }
          : { w: 50, tone: "watch", text: `Most of our recorded open-play concessions come with the defence set — teams are breaking us down even when we're organised. That points at compactness and pressure on the ball, not transition reactions.` });
      }
    }
    // Conceding to front-third regains = build-up vulnerability.
    const ftConc = openConc.filter(g => g.origin === "FT");
    if (ftConc.length >= 3) {
      reads.push(scout
        ? { w: 62, tone: "good", text: `They've conceded ${ftConc.length} goals to front-third regains — losing it playing out and being punished on the spot. A committed press on their build-up is likely to produce chances.` }
        : { w: 64, tone: "watch", text: `We've conceded ${ftConc.length} goals from turnovers in our own defensive third — build-up under pressure is costing us directly. Worth reviewing when to play and when to clear.` });
    }
  }

  // ── 6. Set-piece people — the deliverer and the finisher ──────────────────
  {
    const sp = scored.filter(g => g.origin === "SP");
    if (sp.length >= 4) {
      const count = (vals: (string | null)[]) => {
        const m = new Map<string, number>();
        for (const v of vals) if (v) m.set(v, (m.get(v) ?? 0) + 1);
        return [...m.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
      };
      const topAssist = count(sp.map(g => g.assist));
      const topScorer = count(sp.map(g => g.scorer));
      const bits: string[] = [];
      if (topAssist && topAssist[1] >= 2) bits.push(scout
        ? `${topAssist[0]} delivers most of them (${topAssist[1]} assists) — pressure on the delivery starts the defending`
        : `${topAssist[0]}'s delivery is behind ${topAssist[1]} of them`);
      if (topScorer && topScorer[1] >= 2) bits.push(scout
        ? `${topScorer[0]} is the one attacking them (${topScorer[1]} set-piece goals) — likely strong in the air or reads the flight early; know where they are before the ball comes in`
        : `${topScorer[0]} keeps finishing them (${topScorer[1]}) — good service finding a good header of the ball`);
      if (bits.length) {
        reads.push({
          w: scout ? 56 : 42,
          tone: scout ? "watch" : "good",
          text: (scout
            ? `Set pieces: ${sp.length} goals from dead balls this season. `
            : `Set-piece production has names on it: ${sp.length} dead-ball goals. `) + bits.join("; ") + ".",
        });
      }
    }
  }

  return reads;
}
