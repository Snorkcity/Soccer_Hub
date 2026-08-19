export type AssistantTurnMode = "recommendation" | "full-session" | "exact-session" | "general";

const GENERIC_CLUB_WORDS = new Set([
  "canberra",
  "city",
  "club",
  "fc",
  "football",
  "the",
  "united",
  "women",
  "womens",
]);

function normaliseWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

/**
 * Resolve only names that are already recorded for the league. Full club names
 * win; a short name (for example "Croatia") is accepted only when it identifies
 * one recorded opponent unambiguously.
 */
export function resolveAssistantOpponent(
  text: string,
  recordedOpponents: string[],
  preferredOpponent?: string | null,
): string | null {
  const canonical = [...new Map(
    recordedOpponents
      .map((name) => [normaliseWords(name), name.trim()] as const)
      .filter(([key, name]) => Boolean(key && name)),
  ).entries()].map(([key, name]) => ({ key, name }));

  if (preferredOpponent?.trim()) {
    const preferredKey = normaliseWords(preferredOpponent);
    return canonical.find((candidate) => candidate.key === preferredKey)?.name
      ?? preferredOpponent.trim();
  }

  const haystack = normaliseWords(text);
  if (!haystack) return null;

  const fullMatches = canonical
    .filter((candidate) => containsPhrase(haystack, candidate.key))
    .sort((a, b) => b.key.length - a.key.length);
  if (fullMatches.length > 0) {
    // "Canberra Croatia" may also match a recorded short name "Croatia".
    // Keep only maximal phrases; two unrelated maximal names means the coach
    // named more than one opponent and must clarify.
    const maximal = fullMatches.filter((candidate) =>
      !fullMatches.some((other) =>
        other.key !== candidate.key && containsPhrase(other.key, candidate.key)
      )
    );
    return maximal.length === 1 ? maximal[0].name : null;
  }

  const aliases = new Map<string, Set<string>>();
  for (const candidate of canonical) {
    for (const token of candidate.key.split(" ")) {
      if (token.length < 4 || GENERIC_CLUB_WORDS.has(token)) continue;
      const names = aliases.get(token) ?? new Set<string>();
      names.add(candidate.name);
      aliases.set(token, names);
    }
  }
  const aliasMatches = new Set<string>();
  for (const token of haystack.split(" ")) {
    const matches = aliases.get(token);
    if (matches?.size === 1) aliasMatches.add([...matches][0]);
  }
  return aliasMatches.size === 1 ? [...aliasMatches][0] : null;
}

/**
 * Broad "what should we work on?" questions stay conversational. A detailed
 * session is reserved for an exact curriculum reference or an explicit build/
 * run request, including a short affirmative reply to the Assistant's offer.
 */
export function detectAssistantTurnMode(
  lastUserMessage: string,
  exactSessionFound: boolean,
  previousAssistantMessage = "",
): AssistantTurnMode {
  if (exactSessionFound) return "exact-session";

  const user = normaliseWords(lastUserMessage);
  const previous = normaliseWords(previousAssistantMessage);
  const isAffirmative = /^(yes|yes please|yep|yeah|please|do it|go ahead|sounds good|lets do it)$/.test(user);
  const previousOfferedSession =
    /\b(want|would you like|shall i|can i)\b.*\b(full|complete|detailed|build|session)\b/.test(previous)
    || /\bturn (this|that|it) into\b.*\bsession\b/.test(previous);
  if (isAffirmative && previousOfferedSession) return "full-session";

  const recommendationPatterns = [
    /\bwhat (session|sessions|training|theme|focus).*\b(could|should|would|recommend|suggest)\b/,
    /\bwhat (could|should|would).*\b(session|sessions|training|work on|focus on)\b/,
    /\b(session|training) ideas?\b/,
    /\bwhat should we (work on|focus on|train)\b/,
    /\bprepare for\b/,
    /\bbased on\b.*\b(form|results|reflections|last game|recent games)\b/,
  ];
  if (recommendationPatterns.some((pattern) => pattern.test(user))) return "recommendation";

  const explicitFullPatterns = [
    /\b(build|create|write|plan|give me|show me|put together|lay out)\b.*\b(full |complete |detailed )?(training )?session\b/,
    /\b(full|complete|detailed)\b.*\b(session|session plan|session outline)\b/,
    /\bhelp me run\b.*\b(session|practice)\b/,
    /\bhow (should|do) i run\b.*\b(session|practice)\b/,
  ];
  if (explicitFullPatterns.some((pattern) => pattern.test(user))) return "full-session";

  return "general";
}

export function assistantTurnInstruction(
  mode: AssistantTurnMode,
  opponent: string | null,
): string {
  if (mode === "recommendation") {
    return `## Response mode for THIS turn: conversational recommendation
The coach is exploring what to work on${opponent ? ` against ${opponent}` : ""}; they have NOT asked for a complete session yet.
- Start with ONE recommended training theme in 1–2 sentences.
- Give a small evidence-based "Why now" overview using only the coaching context supplied below. Keep source labels clear.
- Offer at most TWO session directions/components, without dimensions, player numbers, full rules, or a 3–4-part session dump.
- Keep the answer under about 180 words, then ask whether they want you to turn the preferred direction into the full session.
- If an opponent cannot be confidently identified, ask one short clarification rather than guessing.`;
  }
  if (mode === "exact-session") {
    return `## Response mode for THIS turn: exact curriculum session
The coach named an exact curriculum session. Deliver the complete selected session using the non-negotiable 3–4-part format and content-preservation rules.`;
  }
  if (mode === "full-session") {
    return `## Response mode for THIS turn: full session requested
The coach explicitly asked to build or run the session. Deliver the complete session using the non-negotiable 3–4-part format and content-preservation rules.`;
  }
  return `## Response mode for THIS turn: normal coaching conversation
Answer the question directly. Do not turn the reply into a complete session unless the coach explicitly asks to build or run one.`;
}

/**
 * Avoid shipping private league evidence to the model for unrelated framework
 * navigation. Recommendation/full-session turns need it; ordinary turns only
 * do when the coach actually refers to team, match or evidence context.
 */
export function shouldLoadAssistantCoachingEvidence(
  mode: AssistantTurnMode,
  conversationText: string,
): boolean {
  if (mode === "exact-session") return false;
  if (mode === "recommendation" || mode === "full-session") return true;
  const text = normaliseWords(conversationText);
  return /\b(against|form|last game|last match|last meeting|match report|opponent|reflection|results|scouting|team trend|veo|week ahead)\b/.test(text);
}

export interface RecordedLeagueResult {
  matchDate: string | null;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number | null;
  awayGoals: number | null;
}

export function recentResultLines(
  rows: RecordedLeagueResult[],
  club: string,
  limit = 3,
): string[] {
  const clubKey = normaliseWords(club);
  return rows
    .filter((row) => {
      const involved =
        normaliseWords(row.homeTeam) === clubKey || normaliseWords(row.awayTeam) === clubKey;
      return involved && row.homeGoals != null && row.awayGoals != null;
    })
    .sort((a, b) => (b.matchDate ?? "").localeCompare(a.matchDate ?? ""))
    .slice(0, limit)
    .map((row) => {
      const home = normaliseWords(row.homeTeam) === clubKey;
      const scored = home ? row.homeGoals! : row.awayGoals!;
      const conceded = home ? row.awayGoals! : row.homeGoals!;
      const opponent = home ? row.awayTeam : row.homeTeam;
      const result = scored > conceded ? "W" : scored < conceded ? "L" : "D";
      return `${row.matchDate ?? "date not recorded"} — ${result} ${scored}–${conceded} v ${opponent} (${home ? "home" : "away"})`;
    });
}