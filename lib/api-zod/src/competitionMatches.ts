export type DriblCompetitionStage = {
  kind: "round" | "finals" | "unknown";
  code: string | null;
  label: string;
  round: number | null;
  countsTowardLadder: boolean;
};

const REGULAR_MATCH_RE = /^R([1-9]\d*)(?:-|$)/i;
const FINALS_CODE_RE = /^(?:FW[1-9]\d*G[1-9]\d*|QF[1-9]\d*|EF[1-9]\d*|SF[1-9]\d*|PF[1-9]\d*|GF[1-9]\d*|F[1-9]\d*)(?:-|$)/i;

const numberedFinal = (
  code: string,
  label: string,
  game: string | undefined,
): DriblCompetitionStage => ({
  kind: "finals",
  code: `${code}${game ? Number(game) : 1}`,
  label: `${label}${game ? ` · Game ${Number(game)}` : ""}`,
  round: null,
  countsTowardLadder: false,
});

function classifyDriblStageLabel(raw: string | null | undefined): DriblCompetitionStage {
  const value = raw?.trim().replace(/\s+/g, " ") ?? "";
  let match = /^finals?\s*([1-9]\d*)\s*#\s*([1-9]\d*)$/i.exec(value);
  if (match) {
    const week = Number(match[1]);
    const game = Number(match[2]);
    return {
      kind: "finals",
      code: `FW${week}G${game}`,
      label: `Finals Week ${week} · Game ${game}`,
      round: null,
      countsTowardLadder: false,
    };
  }

  match = /^grand[\s-]*finals?(?:\s*(?:#|game)\s*([1-9]\d*))?$/i.exec(value);
  if (match) return numberedFinal("GF", "Grand Final", match[1]);
  match = /^preliminary[\s-]*finals?(?:\s*(?:#|game)\s*([1-9]\d*))?$/i.exec(value);
  if (match) return numberedFinal("PF", "Preliminary Final", match[1]);
  match = /^qualifying[\s-]*finals?(?:\s*(?:#|game)\s*([1-9]\d*))?$/i.exec(value);
  if (match) return numberedFinal("QF", "Qualifying Final", match[1]);
  match = /^elimination[\s-]*finals?(?:\s*(?:#|game)\s*([1-9]\d*))?$/i.exec(value);
  if (match) return numberedFinal("EF", "Elimination Final", match[1]);
  match = /^semi[\s-]*finals?(?:\s*(?:#|game)\s*([1-9]\d*))?$/i.exec(value);
  if (match) return numberedFinal("SF", "Semi-final", match[1]);
  match = /^finals?(?:\s*(?:#|game)\s*([1-9]\d*))?$/i.exec(value);
  if (match) return numberedFinal("F", "Final", match[1]);

  match = /^(?:round|r)\s*0*([1-9]\d*)$/i.exec(value);
  const roundText = match?.[1] ?? (/^[1-9]\d*$/.test(value) ? value : null);
  if (roundText) {
    const round = Number(roundText);
    return {
      kind: "round",
      code: `R${round}`,
      label: `Round ${round}`,
      round,
      countsTowardLadder: true,
    };
  }

  return {
    kind: "unknown",
    code: null,
    label: value || "Unlabelled stage",
    round: null,
    countsTowardLadder: false,
  };
}

/**
 * Classify a Dribl fixture stage. The fixture's machine-oriented `round` is
 * authoritative when it is a verified finals code; `full_round` remains the
 * coach-facing label and backward-compatible fallback.
 *
 * A finals-looking native code that we have not verified is deliberately
 * blocked rather than guessed from its display label.
 */
export function classifyDriblCompetitionStage(
  fixtureRoundOrFullRound: string | null | undefined,
  fullRound?: string | null,
): DriblCompetitionStage {
  if (fullRound === undefined) return classifyDriblStageLabel(fixtureRoundOrFullRound);

  const fixtureRound = fixtureRoundOrFullRound?.trim() ?? "";
  const visibleLabel = fullRound?.trim().replace(/\s+/g, " ") ?? "";
  // Verified in the live 2026 Capital NPLM feed: Finals Round 1 currently
  // contains four fixtures, F1#1 through F1#4.
  const liveFinals = /^F1#([1-4])$/i.exec(fixtureRound);
  if (liveFinals) {
    const game = Number(liveFinals[1]);
    return {
      kind: "finals",
      code: `FW1G${game}`,
      label: `Finals Week 1 · Game ${game}`,
      round: null,
      countsTowardLadder: false,
    };
  }

  if (fixtureRound) {
    const nativeStage = classifyDriblStageLabel(fixtureRound);
    if (nativeStage.kind === "round") return nativeStage;
    return {
      kind: "unknown",
      code: null,
      label: visibleLabel || fixtureRound || "Unlabelled stage",
      round: null,
      countsTowardLadder: false,
    };
  }

  return classifyDriblStageLabel(visibleLabel);
}

export function isRegularSeasonMatchId(matchId: string | null | undefined): boolean {
  return REGULAR_MATCH_RE.test(matchId?.trim() ?? "");
}

export function regularSeasonRound(matchId: string | null | undefined): number | null {
  const match = REGULAR_MATCH_RE.exec(matchId?.trim() ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * The fixture code used to join football fixtures to GPS session round tags.
 * It supports both genuine rounds and the stable non-round finals codes.
 */
export function fixtureCode(value: string | null | undefined): string | null {
  const input = value?.trim() ?? "";
  const regular = REGULAR_MATCH_RE.exec(input);
  if (regular) return `R${Number(regular[1])}`;
  const finals = FINALS_CODE_RE.exec(input);
  return finals ? finals[0].replace(/-$/, "").toUpperCase() : null;
}
