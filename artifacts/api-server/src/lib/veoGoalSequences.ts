import type { MesEventRow } from "./veo";

/**
 * Conservative reconstruction of the action immediately before a Veo goal.
 * This is deliberately independent of Dribl/Hub goal records: Veo observations
 * are suggestions and must never be presented as official assists.
 */
export type SequenceZone = "attacking" | "middle" | "defensive" | "unknown";
export type SequenceConfidence = "high" | "medium" | "low" | "unavailable";

export interface GoalSequencePass {
  passerJersey: string | null;
  receiverJersey: string | null;
  origin: { x: number | null; z: number | null; zone: SequenceZone };
  destination: { x: number | null; z: number | null; zone: SequenceZone };
  videoTimeMs: number | null;
}

export interface GoalSequenceAction {
  eventType: string;
  team: "Own" | "Opponent";
  jersey: string | null;
  videoTimeMs: number | null;
  outcome: string | null;
  x: number | null;
  z: number | null;
}

export interface VeoGoalSequence {
  goalTimeMs: number | null;
  /** Time within the Veo period; unlike videoTimeMs this excludes recording offsets. */
  goalPeriodTimeMs: number | null;
  periodId: number | null;
  scoringTeam: "Own" | "Opponent" | null;
  scorerJersey: string | null;
  scoringShot: {
    found: boolean;
    outcome: string | null;
    x: number | null;
    z: number | null;
    restart: boolean;
    direct: boolean;
  };
  passes: GoalSequencePass[];
  completedPassCount: number;
  sequenceStartZone: SequenceZone;
  finalPassOriginZone: SequenceZone;
  finalPasserJersey: string | null;
  /** Observation only. This is not an official assist. */
  assistSuggestionJersey: string | null;
  lastActionOwn: GoalSequenceAction | null;
  lastActionOpponent: GoalSequenceAction | null;
  confidence: SequenceConfidence;
  reasons: string[];
}

export interface GoalSequenceUnavailable {
  available: false;
  reason: string;
}

export interface GoalSequenceResult {
  available: boolean;
  goals: VeoGoalSequence[];
  unavailableReason?: string;
}

type TimedEvent = MesEventRow & { _time: number | null; _index: number };

const text = (v: unknown): string | null => typeof v === "string" || typeof v === "number" ? String(v) : null;
const finite = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const normalType = (v: unknown): string => String(v ?? "").replace(/[_\-\s]/g, "").toLowerCase();
const isOwn = (e: MesEventRow): boolean => String(e.team ?? "").trim().toLowerCase() === "own";
const side = (e: MesEventRow): "Own" | "Opponent" => isOwn(e) ? "Own" : "Opponent";
const jersey = (v: unknown): string | null => {
  const s = text(v)?.trim() ?? "";
  return s ? s.replace(/^0+(?=\d)/, "") : null;
};

function eventTime(e: MesEventRow): number | null {
  const video = finite(e.videoTimeMs);
  if (video != null) return video;
  const period = finite(e.periodId);
  const within = finite(e.periodTimeMs);
  // Period-relative time is still useful within a goal's period. Do not invent
  // a match-wide offset when no period duration is available.
  return within != null ? within + (period != null ? period * 1e9 : 0) : null;
}

function attrs(e: MesEventRow): Record<string, unknown> {
  const raw = e.attributes;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (Array.isArray(raw)) {
    const out: Record<string, unknown> = {};
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const key = text(o.label ?? o.name ?? o.key);
      if (key) out[key] = o.value ?? o.val ?? o.content;
    }
    return out;
  }
  return {};
}

function attrNumber(e: MesEventRow, key: string): number | null {
  const value = attrs(e)[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function eventPeriod(e: MesEventRow): number | null {
  return finite(e.periodId);
}

export function zoneForX(x: unknown): SequenceZone {
  const n = finite(x);
  if (n == null || n < 0 || n > 1) return "unknown";
  if (n <= 1 / 3) return "attacking";
  if (n <= 2 / 3) return "middle";
  return "defensive";
}

function isPass(e: MesEventRow): boolean {
  const t = normalType(e.eventType);
  return t.includes("pass") && !t.includes("bypass");
}
function completed(e: MesEventRow): boolean {
  return String(e.outcome ?? "").trim() === "1";
}
function restart(e: MesEventRow): boolean {
  const t = normalType(e.eventType);
  return t.includes("corner") || t.includes("freekick") || t.includes("penalty") ||
    t.includes("throwin") || t.includes("goalkick") || t.includes("kickoff") ||
    t.includes("outofplay") || t.includes("restart");
}
function controlledOpponent(e: MesEventRow): boolean {
  if (isOwn(e)) return false;
  const t = normalType(e.eventType);
  return isPass(e) || t.includes("tackle") || t.includes("interception") ||
    t.includes("recovery") || t.includes("dribble") || t.includes("clearance");
}
function meaningful(e: MesEventRow): boolean {
  const t = normalType(e.eventType);
  return Boolean(text(e.eventType)) && !t.includes("tracking") && t !== "footballshot" && t !== "footballgoal";
}

function action(e: TimedEvent): GoalSequenceAction {
  return {
    eventType: text(e.eventType) ?? "unknown",
    team: side(e),
    jersey: jersey(e.playerJersey),
    videoTimeMs: finite(e.videoTimeMs) ?? e._time,
    outcome: text(e.outcome),
    x: finite(e.x),
    z: finite(e.z),
  };
}

function passOf(e: TimedEvent): GoalSequencePass {
  const a = attrs(e);
  const receiver = jersey(a.receiver_jersey ?? a.receiverJersey);
  const dx = attrNumber(e, "receiver_x");
  const dz = attrNumber(e, "receiver_z");
  return {
    passerJersey: jersey(e.playerJersey),
    receiverJersey: receiver,
    origin: { x: finite(e.x), z: finite(e.z), zone: zoneForX(e.x) },
    destination: { x: dx, z: dz, zone: zoneForX(dx) },
    videoTimeMs: finite(e.videoTimeMs) ?? e._time,
  };
}

function samePeriod(a: MesEventRow, b: MesEventRow): boolean {
  const pa = eventPeriod(a), pb = eventPeriod(b);
  return pa == null || pb == null || pa === pb;
}

/**
 * Reconstruct all FootballGoal events from a complete Analytics 2 matchEvents
 * source. Partial bundles are intentionally unavailable: classic Veo events
 * do not contain enough evidence for this feature.
 */
export function reconstructVeoGoalSequences(
  events: MesEventRow[] | null | undefined,
  status: "complete" | "partial" | "unavailable" | "error" = "complete",
): GoalSequenceResult {
  if (status !== "complete") return { available: false, goals: [], unavailableReason: "Rich Analytics 2 action feed is unavailable." };
  if (!Array.isArray(events)) return { available: false, goals: [], unavailableReason: "Rich Analytics 2 action feed is unavailable." };

  const timeline: TimedEvent[] = events
    .filter((e): e is MesEventRow => Boolean(e && typeof e === "object"))
    .map((e, i) => ({ ...e, _time: eventTime(e), _index: i }))
    .sort((a, b) => (a._time == null ? Number.MAX_SAFE_INTEGER : a._time) - (b._time == null ? Number.MAX_SAFE_INTEGER : b._time) || a._index - b._index);
  const goals = timeline.filter((e) => normalType(e.eventType) === "footballgoal");
  return {
    available: true,
    goals: goals.map((goal) => reconstructGoal(goal, timeline)),
  };
}

function reconstructGoal(goal: TimedEvent, timeline: TimedEvent[]): VeoGoalSequence {
  const before = timeline.filter((e) => e._index !== goal._index && samePeriod(e, goal) && (goal._time == null || e._time == null || e._time <= goal._time));
  const shot = [...before].reverse().find((e) =>
    normalType(e.eventType) === "footballshot" && completed(e) &&
    (goal._time == null || e._time == null || goal._time - e._time <= 15_000) &&
    (String(e.team ?? "").trim().toLowerCase() === String(goal.team ?? "").trim().toLowerCase() || !goal.team),
  );
  const scoringTeam = shot ? side(shot) : text(goal.team)?.trim().toLowerCase() === "own" ? "Own" : goal.team ? "Opponent" : null;
  const restartEvent = shot && [...before].reverse().find((e) =>
    side(e) === side(shot) && restart(e) &&
    (shot._time == null || e._time == null || shot._time - e._time <= 10_000),
  );
  const precedingRestart = Boolean(restartEvent && shot && !timeline.some((e) =>
    e._index !== restartEvent._index &&
    e._index !== shot._index &&
    samePeriod(e, shot) &&
    e._index > restartEvent._index &&
    e._index < shot._index &&
    meaningful(e),
  ));
  const scoringShot = {
    found: Boolean(shot),
    outcome: shot ? text(shot.outcome) : null,
    x: shot ? finite(shot.x) : finite(goal.x),
    z: shot ? finite(shot.z) : finite(goal.z),
    restart: Boolean(shot && (restart(shot) || precedingRestart)),
    direct: false,
  };
  const reasons: string[] = [];
  if (!shot) reasons.push("No completed scoring shot could be linked immediately before the goal.");
  const anchorTime = shot?._time ?? goal._time;
  const anchorPass = [...before].reverse().find((e) =>
    scoringTeam != null && side(e) === scoringTeam &&
    isPass(e) && completed(e) && (anchorTime == null || e._time == null || e._time <= anchorTime),
  );
  const passes: GoalSequencePass[] = [];
  let breakReason: string | null = null;
  let previousTime = anchorTime;
  if (anchorPass) {
    const anchorPassIndex = timeline.findIndex((e) => e._index === anchorPass._index);
    const betweenAnchorAndGoal = timeline.slice(anchorPassIndex + 1).filter((e) =>
      samePeriod(e, goal) && (anchorTime == null || e._time == null || e._time <= anchorTime),
    );
    const forwardBoundary = betweenAnchorAndGoal.find((e) =>
      controlledOpponent(e) || (side(e) === scoringTeam && isPass(e) && !completed(e)) || restart(e),
    );
    if (forwardBoundary) {
      breakReason = controlledOpponent(forwardBoundary)
        ? "Opponent controlled possession or an interception/tackle interrupted the sequence."
        : restart(forwardBoundary)
          ? "Restart or out-of-play boundary ended the possession."
          : "An unsuccessful same-team pass ended the possession.";
    }
    for (let i = anchorPassIndex; i >= 0 && !forwardBoundary; i--) {
      const candidate = timeline[i];
      if (!samePeriod(candidate, goal) || (candidate._time != null && anchorTime != null && candidate._time > anchorTime)) continue;
      if (side(candidate) !== scoringTeam) {
        if (controlledOpponent(candidate)) {
          breakReason = "Opponent controlled possession or an interception/tackle interrupted the sequence.";
          break;
        }
        continue;
      }
      if (!isPass(candidate)) {
        if (restart(candidate)) {
          breakReason = restart(candidate) ? "Restart or out-of-play boundary ended the possession." : "Possession changed or an unsuccessful action interrupted the sequence.";
          break;
        }
        continue;
      }
      if (!completed(candidate)) {
        breakReason = "An unsuccessful same-team pass ended the possession.";
        break;
      }
      if (previousTime != null && candidate._time != null && previousTime - candidate._time > 8_000) {
        breakReason = "A large unexplained time gap ended the sequence.";
        break;
      }
      passes.unshift(passOf(candidate));
      previousTime = candidate._time;
    }
  }
  if (passes.length === 0) {
    if (shot && scoringShot.restart) reasons.push("Goal followed a restart/direct set piece; no passing sequence inferred.");
    else reasons.push("No completed same-team pass with receiver evidence was found before the shot.");
  }
  if (breakReason) reasons.push(breakReason);
  const first = passes[0], last = passes[passes.length - 1];
  const beforeScoringShot = shot
    ? before.filter((e) =>
        e._index !== shot._index &&
        (shot._time != null && e._time != null ? e._time < shot._time : e._index < shot._index),
      )
    : before;
  const finalActionOwn = [...beforeScoringShot].reverse().find((e) => meaningful(e) && side(e) === "Own") ?? null;
  const finalActionOpponent = [...beforeScoringShot].reverse().find((e) => meaningful(e) && side(e) === "Opponent") ?? null;
  const scorer = jersey(shot?.playerJersey ?? goal.playerJersey);
  scoringShot.direct = Boolean(shot && scoringShot.restart && passes.length === 0);
  if (scoringShot.direct) reasons.push("Treat as direct/unassisted observation; Veo does not establish an official assist.");
  else if (shot && passes.length === 0) reasons.push("No completed pass sequence was found; assist status is unassisted or unknown, not a direct-set-piece claim.");
  const hasReceiver = passes.some((p) => p.receiverJersey != null);
  const confidence: SequenceConfidence = !shot ? "low" : passes.length > 0 && hasReceiver && !breakReason ? "high" : passes.length > 0 ? "medium" : "low";
  if (!hasReceiver && passes.length > 0) reasons.push("Receiver jersey attributes were missing or ambiguous.");
  return {
    goalTimeMs: finite(goal.videoTimeMs) ?? goal._time,
    goalPeriodTimeMs: finite(goal.periodTimeMs),
    periodId: eventPeriod(goal),
    scoringTeam,
    scorerJersey: scorer,
    scoringShot,
    passes,
    completedPassCount: passes.length,
    sequenceStartZone: first?.origin.zone ?? "unknown",
    finalPassOriginZone: last?.origin.zone ?? "unknown",
    finalPasserJersey: last?.passerJersey ?? null,
    // This is only the final passer's jersey as an assist suggestion. It is
    // intentionally not an official assist attribution.
    assistSuggestionJersey: last?.passerJersey ?? null,
    lastActionOwn: finalActionOwn ? action(finalActionOwn) : null,
    lastActionOpponent: finalActionOpponent ? action(finalActionOpponent) : null,
    confidence,
    reasons,
  };
}

export function aggregateVeoGoalSequences(goals: VeoGoalSequence[]) {
  const distribution = (values: string[]) => values.reduce<Record<string, number>>((out, value) => {
    out[value] = (out[value] ?? 0) + 1;
    return out;
  }, {});
  const forSide = (sideName: "Own" | "Opponent") => {
    const subset = goals.filter((goal) => goal.scoringTeam === sideName);
    return {
      goals: subset.length,
      passCount: distribution(subset.map((g) => g.completedPassCount >= 4 ? "4+" : String(g.completedPassCount))),
      sequenceStartZone: distribution(subset.map((g) => g.sequenceStartZone)),
      finalPassOriginZone: distribution(subset.map((g) => g.finalPassOriginZone)),
    };
  };
  return {
    goals: goals.length,
    passCount: distribution(goals.map((g) => g.completedPassCount >= 4 ? "4+" : String(g.completedPassCount))),
    sequenceStartZone: distribution(goals.map((g) => g.sequenceStartZone)),
    finalPassOriginZone: distribution(goals.map((g) => g.finalPassOriginZone)),
    own: forSide("Own"),
    opponent: forSide("Opponent"),
  };
}