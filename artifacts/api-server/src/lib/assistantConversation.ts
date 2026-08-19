export type AssistantTurnMode =
  | "recommendation"
  | "match-plan"
  | "half-time-talk"
  | "pre-match-warm-up"
  | "full-session"
  | "exact-session"
  | "general";

export interface AssistantCurriculumCandidate {
  score: number;
  docTitle: string;
  heading: string;
  headingPath: string;
  content: string;
}

export interface AssistantCurriculumCoverage {
  supported: boolean;
  reason: "not-required" | "exact" | "covered" | "needs-topic" | "weak-match";
  topScore: number | null;
  subjectTerms: string[];
  matchedTerms: string[];
}

const FACTUAL_METRIC_PATTERN =
  "(?:appearance|appearances|assist|assists|average|averages|data|distance|draw|draws|evidence|form|goal|goals|loss|losses|match|matches|minute|minutes|pass|passes|passing|percentage|percent|possession|rank|ranking|report|reports|result|results|score|scoreline|scorelines|shot|shots|sprint|sprints|start|starts|stat|statistics|stats|total|trend|trends|win|wins|xg)";
const FACTUAL_TIME_UNIT_PATTERN =
  "(?:game|games|match|matches|round|rounds|season|seasons|week|weeks)";
const FACTUAL_ACTION_PATTERN =
  "(?:assist|assisted|concede|conceded|draw|drawn|have|make|made|play|played|record|recorded|score|scored|start|started|win|won)";
const PRIVATE_EVIDENCE_SOURCE_PATTERN =
  "(?:deck|decks|evidence|hub|journal|journals|note|notes|reflection|reflections|report|reports|veo)";

function escapeAssistantRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isSoleExactSessionRequest(text: string): boolean {
  const trimmed = text.trim();
  const withoutTrailingPunctuation = trimmed.replace(/[?!.]+$/, "");
  if (
    withoutTrailingPunctuation.length === 0
    || /[,;:!?\n]/.test(withoutTrailingPunctuation)
    || /\b(?:also|and|but|plus|then)\b/i.test(withoutTrailingPunctuation)
  ) {
    return false;
  }

  let normalised = normaliseWords(withoutTrailingPunctuation);
  if (
    !/\bcycle \d+\b/.test(normalised)
    || !/\bweek \d+\b/.test(normalised)
    || !/\bsession \d+\b/.test(normalised)
  ) {
    return false;
  }

  normalised = normalised
    .replace(/\bu(?:11|12|13|14|15|16)\b/g, " ")
    .replace(/\bunder (?:11|12|13|14|15|16)\b/g, " ")
    .replace(/\b(?:11|12|13|14|15|16)s\b/g, " ")
    .replace(/\bcycle \d+\b/g, " ")
    .replace(/\bweek \d+\b/g, " ")
    .replace(/\bsession \d+\b/g, " ")
    .replace(/\b(?:find|for|from|get|give|load|me|open|plan|plans|please|pull|show|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalised.length === 0;
}

export function isSolePreMatchWarmUpRequest(
  text: string,
  opponent?: string | null,
): boolean {
  const trimmed = text.trim();
  const withoutTrailingPunctuation = trimmed.replace(/[?!.]+$/, "");
  if (
    withoutTrailingPunctuation.length === 0
    || /[,;:!?\n]/.test(withoutTrailingPunctuation)
    || /\b(?:also|and|but|plus|then)\b/i.test(withoutTrailingPunctuation)
  ) {
    return false;
  }

  const normalised = normaliseWords(withoutTrailingPunctuation);
  const age = "(?:u(?:11|12|13|14|15|16)|under (?:11|12|13|14|15|16)|(?:11|12|13|14|15|16)s)";
  const warmUp = "(?:(?:pre match|prematch) warm up)";
  const core = `(?:${age} (?:coach pack )?${warmUp}|${warmUp}(?: for)? ${age})`;
  const prefix = "(?:(?:find|give me|load|pick|show me|what is) (?:a |the )?)?";
  const normalisedOpponent = normaliseWords(opponent ?? "");
  const opponentSuffix = normalisedOpponent
    ? `(?: (?:against|v|versus) ${escapeAssistantRegex(normalisedOpponent)})?`
    : "";
  return new RegExp(`^(?:please )?${prefix}${core}${opponentSuffix}(?: please)?$`).test(normalised);
}

function isAmbiguousBareTopicRequest(text: string): boolean {
  const normalised = normaliseWords(text);
  return /^(?:show me|tell me about) [a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)?$/.test(normalised);
}

function isVerifiedFactualEvidenceOnly(
  text: string,
  opponent?: string | null,
): boolean {
  const trimmed = text.trim();
  const withoutTrailingPunctuation = trimmed.replace(/[?!.]+$/, "");
  if (
    withoutTrailingPunctuation.length === 0
    || withoutTrailingPunctuation.length > 240
    || /[,;:!?\n]/.test(withoutTrailingPunctuation)
    || /\b(?:also|and|but|plus|then)\b/i.test(withoutTrailingPunctuation)
  ) {
    return false;
  }

  const normalised = normaliseWords(withoutTrailingPunctuation);
  const contexts = [
    `(?:last|latest|previous|recent|this|current) ${FACTUAL_TIME_UNIT_PATTERN}`,
    `(?:in|during|over|from|for|at|on) (?:the )?(?:(?:last|latest|previous|recent|this|current) )?(?:\\d+ )?${FACTUAL_TIME_UNIT_PATTERN}`,
    "at home",
    "away",
  ];
  const normalisedOpponent = normaliseWords(opponent ?? "");
  if (normalisedOpponent) {
    contexts.push(`(?:against|versus|v) ${escapeAssistantRegex(normalisedOpponent)}`);
  }
  const optionalContext = `(?: (?:${contexts.join("|")}))?`;
  const metricPhrase =
    `(?:the |our |their |my )?(?:(?:average|current|latest|top|total) )?${FACTUAL_METRIC_PATTERN}(?: (?:average|percentage|percent|rank|ranking|total|trend))?`;

  const strictFactualPatterns = [
    new RegExp(
      `^how (?:many|much) ${FACTUAL_METRIC_PATTERN}(?: (?:did|do|does) (?:we|they|our team|their team) ${FACTUAL_ACTION_PATTERN})?${optionalContext}$`,
    ),
    new RegExp(`^what (?:is|are|was|were) ${metricPhrase}${optionalContext}$`),
    new RegExp(
      `^what (?:did|does) (?:my |our |the )?(?:(?:last|latest|recent) )?${PRIVATE_EVIDENCE_SOURCE_PATTERN} (?:mention|record|say|show)(?: about (?:the )?(?:(?:last|latest|previous|recent|this) )?(?:form|game|match|performance|results|round|score|season|training))?$`,
    ),
    new RegExp(
      `^what (?:has|have) (?:my |our |the )?(?:(?:last|latest|recent) )?${PRIVATE_EVIDENCE_SOURCE_PATTERN} (?:mentioned|recorded|said|shown)(?: about (?:the )?(?:(?:last|latest|previous|recent|this) )?(?:form|game|match|performance|results|round|score|season|training))?$`,
    ),
    new RegExp(
      `^who (?:has|had) (?:the )?(?:most|least|highest|lowest) ${FACTUAL_METRIC_PATTERN}${optionalContext}$`,
    ),
    new RegExp(
      `^who (?:assisted|played|scored|started)(?: (?:the )?(?:most|least|highest|lowest) ${FACTUAL_METRIC_PATTERN})?${optionalContext}$`,
    ),
    new RegExp(
      `^(?:show me|list|summari(?:s|z)e) (?:the )?(?:data|evidence|numbers|results|stats|statistics)(?: (?:about|for) ${metricPhrase})?${optionalContext}$`,
    ),
    new RegExp(
      `^show me ${metricPhrase} (?:data|numbers|stats|statistics|percentage|percent|trend)${optionalContext}$`,
    ),
    new RegExp(
      `^give me (?:the )?(?:data|evidence|numbers|results|stats|statistics)${optionalContext}$`,
    ),
  ];

  return strictFactualPatterns.some((pattern) => pattern.test(normalised));
}

/**
 * Recorded-data questions can be answered from verified Hub/Veo context alone.
 * Any request for coaching content or application needs approved curriculum.
 */
export function requiresAssistantCurriculum(
  mode: AssistantTurnMode,
  text: string,
  opponent?: string | null,
): boolean {
  if (mode !== "general") return true;
  return !isVerifiedFactualEvidenceOnly(text, opponent);
}

const CURRICULUM_QUERY_STOP_WORDS = new Set([
  "about", "adult", "adults", "after", "against", "all", "also", "and", "another",
  "approved", "around", "based", "before", "belco", "belconnen", "best", "build",
  "can", "coach", "coaching", "complete", "content", "create", "current", "curriculum",
  "design", "detailed", "did", "do", "does", "drill", "football", "for", "from", "full",
  "are", "game", "give", "had", "has", "have", "help", "how", "improve", "into",
  "is", "match", "me", "my", "new",
  "next", "not", "official", "one", "only", "our", "plan", "player", "players", "please",
  "practice", "practices", "pre", "prepare", "recommend", "run", "senior", "seniors",
  "score", "scored", "scoring", "session", "sessions", "should", "show", "suggest",
  "team", "the", "theme", "themes",
  "this", "through", "time", "talk", "training", "up", "use", "versus", "want",
  "warm", "was", "way", "ways", "week", "were", "what", "when", "which", "win",
  "winning", "wins", "with", "would", "write", "yet", "us",
]);

function stemCurriculumWord(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith("ing")) {
    let base = word.slice(0, -3);
    if (base.length > 2 && base.at(-1) === base.at(-2)) base = base.slice(0, -1);
    if (base.endsWith("v")) base += "e";
    return base;
  }
  if (word.length > 4 && word.endsWith("ed")) {
    let base = word.slice(0, -2);
    if (base.length > 2 && base.at(-1) === base.at(-2)) base = base.slice(0, -1);
    return base;
  }
  if (word.length > 4 && /(sses|ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function curriculumWords(text: string): string[] {
  return normaliseWords(text)
    .split(" ")
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word))
    .map(stemCurriculumWord);
}

function curriculumSubjectTerms(text: string, opponent?: string | null): string[] {
  const opponentTerms = new Set(curriculumWords(opponent ?? ""));
  return [...new Set(
    curriculumWords(text).filter((term) =>
      !CURRICULUM_QUERY_STOP_WORDS.has(term)
      && !opponentTerms.has(term)
      && !/^u(?:11|12|13|14|15|16)$/.test(term)
    ),
  )];
}

/**
 * Conservative, deterministic retrieval gate. A chat completion is not called
 * for coaching requests unless the retrieved approved text covers the coach's
 * subject terms. This intentionally prefers an honest curriculum gap over a
 * plausible-but-invented answer.
 */
export function assessAssistantCurriculumCoverage(args: {
  mode: AssistantTurnMode;
  text: string;
  currentTurnText?: string;
  continuationTopicText?: string | null;
  opponent?: string | null;
  candidates: AssistantCurriculumCandidate[];
  exactMatchFound: boolean;
  hasCoachingEvidence: boolean;
}): AssistantCurriculumCoverage {
  const authorizationText = args.currentTurnText ?? args.text;
  if (!requiresAssistantCurriculum(args.mode, authorizationText, args.opponent)) {
    return {
      supported: true,
      reason: "not-required",
      topScore: args.candidates[0]?.score ?? null,
      subjectTerms: [],
      matchedTerms: [],
    };
  }
  if (
    args.mode === "general"
    && isAmbiguousBareTopicRequest(authorizationText)
  ) {
    return {
      supported: false,
      reason: "needs-topic",
      topScore: args.candidates[0]?.score ?? null,
      subjectTerms: [],
      matchedTerms: [],
    };
  }
  if (
    args.exactMatchFound
    && (
      (
        args.mode === "pre-match-warm-up"
        && isSolePreMatchWarmUpRequest(authorizationText, args.opponent)
      )
      || isSoleExactSessionRequest(authorizationText)
    )
  ) {
    return {
      supported: true,
      reason: "exact",
      topScore: args.candidates[0]?.score ?? null,
      subjectTerms: [],
      matchedTerms: [],
    };
  }

  const topScore = args.candidates[0]?.score ?? null;
  const continuationTopicText =
    args.mode === "full-session"
    && isSessionExpansionReply(authorizationText)
    && args.continuationTopicText?.trim()
    && requiresAssistantCurriculum("general", args.continuationTopicText, args.opponent)
    && !isAmbiguousBareTopicRequest(args.continuationTopicText)
      ? args.continuationTopicText
      : null;
  const subjectTerms = curriculumSubjectTerms(
    continuationTopicText ?? authorizationText,
    args.opponent,
  );
  if (subjectTerms.length === 0) {
    const contextCanChooseTheme =
      args.hasCoachingEvidence
      && (args.mode === "recommendation"
        || args.mode === "match-plan"
        || args.mode === "half-time-talk"
        || (args.mode === "full-session" && continuationTopicText != null))
      && topScore != null
      && topScore >= 0.48;
    return {
      supported: contextCanChooseTheme,
      reason: contextCanChooseTheme ? "covered" : "needs-topic",
      topScore,
      subjectTerms,
      matchedTerms: [],
    };
  }

  const vocabulary = new Set(
    args.candidates
      .slice(0, 12)
      .flatMap((candidate) =>
        curriculumWords(
          `${candidate.docTitle} ${candidate.heading} ${candidate.headingPath} ${candidate.content}`,
        )
      ),
  );
  const matchedTerms = subjectTerms.filter((term) => vocabulary.has(term));
  const lexicalCoverage = matchedTerms.length / subjectTerms.length;
  const supported = topScore != null && topScore >= 0.42 && lexicalCoverage >= 0.75;
  return {
    supported,
    reason: supported ? "covered" : "weak-match",
    topScore,
    subjectTerms,
    matchedTerms,
  };
}

export const ASSISTANT_PAGE_KEYS = [
  "home",
  "group-home",
  "season-stats",
  "football-match-report",
  "season-report",
  "gps-insights",
  "veo-season-team",
  "veo-season-players",
  "veo-match-team",
  "veo-match-players",
  "athletic-testing",
  "practice-library",
  "diagram-review",
  "session-builder",
  "session-editor",
  "reflection-journal",
  "reflection-cycle",
  "match-prep",
  "coach-assistant",
  "data-entry",
  "user-management",
  "account",
] as const;

export type AssistantPageKey = (typeof ASSISTANT_PAGE_KEYS)[number];

const ASSISTANT_PAGE_LABELS: Record<AssistantPageKey, string> = {
  "home": "the Hub home screen",
  "group-home": "a Hub module landing screen",
  "season-stats": "Season Stats",
  "football-match-report": "the Football Match Report inside Season Stats",
  "season-report": "the Season Report",
  "gps-insights": "GPS Insights",
  "veo-season-team": "Veo Insights — Season, Team view",
  "veo-season-players": "Veo Insights — Season, Players view",
  "veo-match-team": "Veo Insights — Match, Team view",
  "veo-match-players": "Veo Insights — Match, Players view",
  "athletic-testing": "Athletic Testing",
  "practice-library": "the Practice Library",
  "diagram-review": "Practice Diagram Review",
  "session-builder": "the Session Builder",
  "session-editor": "a saved session editor",
  "reflection-journal": "the Reflection Journal",
  "reflection-cycle": "a Reflection Journal cycle",
  "match-prep": "Match Prep",
  "coach-assistant": "the full Coach Assistant page",
  "data-entry": "Data Entry",
  "user-management": "User Management",
  "account": "My Account",
};

export function assistantPageInstruction(page: AssistantPageKey | undefined): string {
  if (!page) return "";
  return `## Current Hub screen
The user is currently viewing ${ASSISTANT_PAGE_LABELS[page]}. Assume their question relates to this screen and its active filters or selected match unless they clearly say otherwise. Use the screen as conversational orientation only: cite values only when they are present in the verified Hub/Veo context below, and never invent data merely because the screen normally contains it.`;
}

export interface AssistantTurnLimits {
  contextCharBudget: number;
  contextChunkLimit: number;
  maxCompletionTokens: number;
}

const STANDARD_ASSISTANT_TURN_LIMITS: AssistantTurnLimits = {
  contextCharBudget: 60_000,
  contextChunkLimit: 14,
  maxCompletionTokens: 8_192,
};

const CONFIRMED_FULL_SESSION_LIMITS: AssistantTurnLimits = {
  contextCharBudget: 24_000,
  contextChunkLimit: 6,
  maxCompletionTokens: 6_000,
};

/**
 * A short confirmation carries the previous question forward, so it needs a
 * focused evidence set rather than the broad exploration budget. Exact named
 * curriculum sessions deliberately keep the original limits.
 */
export function assistantTurnLimits(mode: AssistantTurnMode): AssistantTurnLimits {
  return mode === "full-session"
    ? CONFIRMED_FULL_SESSION_LIMITS
    : STANDARD_ASSISTANT_TURN_LIMITS;
}

export const ASSISTANT_FULL_SESSION_PERFORMANCE_TARGETS = {
  retrievalMs: 6_000,
  firstTokenMs: 8_000,
  totalMs: 25_000,
} as const;

export interface AssistantFullSessionTimings {
  retrievalMs: number;
  // End-to-end from request arrival, not merely from the upstream model call.
  firstTokenMs: number | null;
  totalMs: number;
}

export function assessAssistantFullSessionPerformance(
  timings: AssistantFullSessionTimings,
): {
  retrieval: boolean;
  firstToken: boolean;
  total: boolean;
  all: boolean;
} {
  const result = {
    retrieval: timings.retrievalMs <= ASSISTANT_FULL_SESSION_PERFORMANCE_TARGETS.retrievalMs,
    firstToken: timings.firstTokenMs != null
      && timings.firstTokenMs <= ASSISTANT_FULL_SESSION_PERFORMANCE_TARGETS.firstTokenMs,
    total: timings.totalMs <= ASSISTANT_FULL_SESSION_PERFORMANCE_TARGETS.totalMs,
  };
  return { ...result, all: result.retrieval && result.firstToken && result.total };
}

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
function isSessionExpansionReply(text: string): boolean {
  const user = normaliseWords(text);
  return /^(?:yes|yes please|yep|yeah|please|do it|go ahead|sounds good|lets do it|(?:build|show|run) (?:it|that|the session|the full session)|turn (?:it|that) into (?:a )?(?:full )?session)$/.test(user);
}

export function isSessionExpansionFollowUp(
  lastUserMessage: string,
  previousAssistantMessage: string,
): boolean {
  if (!isSessionExpansionReply(lastUserMessage)) return false;
  const previous = normaliseWords(previousAssistantMessage);
  return /\b(want|would you like|shall i|can i)\b.*\b(full|complete|detailed|build|session)\b/.test(previous)
    || /\bturn (this|that|it) into\b.*\bsession\b/.test(previous);
}

export function detectAssistantTurnMode(
  lastUserMessage: string,
  exactSessionFound: boolean,
  previousAssistantMessage = "",
): AssistantTurnMode {
  if (exactSessionFound) return "exact-session";

  const user = normaliseWords(lastUserMessage);
  const previous = normaliseWords(previousAssistantMessage);
  if (isSessionExpansionFollowUp(user, previous)) return "full-session";

  const previousAskedWarmUpAge = /\bwhich age group is this for\b/.test(previous);
  const userIdentifiedAge =
    /\b(u ?(?:11|12|13|14|15|16)|under ?(?:11|12|13|14|15|16)|(?:11|12|13|14|15|16)s|adult|senior)\b/.test(user);
  if (previousAskedWarmUpAge && userIdentifiedAge) return "pre-match-warm-up";

  const halfTimePatterns = [
    /\bhalf time\b.*\b(talk|team talk|message|words|say)\b/,
    /\b(talk|team talk|message|words|say)\b.*\bhalf time\b/,
    /\bhalftime\b.*\b(talk|message|words|say)\b/,
  ];
  if (halfTimePatterns.some((pattern) => pattern.test(user))) return "half-time-talk";

  const warmUpPatterns = [
    /\b(pre match|prematch)\b.*\b(warm up|activation)\b/,
    /\b(warm up|activation)\b.*\b(pre match|prematch|before (the )?(match|game))\b/,
  ];
  if (warmUpPatterns.some((pattern) => pattern.test(user))) return "pre-match-warm-up";

  const matchPlanPatterns = [
    /\b(match plan|game plan)\b/,
    /\b(plan|approach)\b.*\b(for|into)\b.*\b(match|game)\b/,
    /\bhow should we (play|approach|set up)\b/,
  ];
  if (matchPlanPatterns.some((pattern) => pattern.test(user))) return "match-plan";

  const recommendationPatterns = [
    /\bwhat (session|sessions|training|theme|focus).*\b(could|should|would|recommend|suggest)\b/,
    /\bwhat (could|should|would).*\b(session|sessions|training|work on|focus on)\b/,
    /\b(session|training) ideas?\b/,
    /\bwhat should we (work on|focus on|train)\b/,
    /\bprepare for\b/,
    /\bbased on\b.*\b(form|results|reflections|last game|recent games)\b/,
    /\b(?:give|show|tell) (?:me|us)\b.*\b(?:approach|idea|option|strategy|way)\b.*\b(?:beat|improve|succeed|win)\b/,
    /\bwhat\b.*\b(?:approach|strategy|way)\b.*\b(?:beat|improve|succeed|win)\b/,
    /\bshow (?:me|us)\b.*\bhow\b.*\b(?:beat|improve|succeed|win)\b/,
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
  if (mode === "match-plan") {
    return `## Response mode for THIS turn: concise match plan
The coach has asked for an evidence-led match plan${opponent ? ` against ${opponent}` : ""}.
- If no opponent can be confidently identified, ask one short clarification rather than guessing.
- Lead with ONE match priority, then give concise In possession, Out of possession, Transition/set-piece and Game-state actions only where the supplied evidence supports them.
- Separate Official Hub/Dribl facts, coach-authored intent, Veo estimates and your Coaching interpretation. Do not turn an estimate into an official fact.
- Keep it practical and brief enough to deliver to staff and players. Do not turn it into a training session.`;
  }
  if (mode === "half-time-talk") {
    return `## Response mode for THIS turn: concise half-time team talk
- A half-time talk needs the CURRENT score and what the coach is seeing in THIS match.
- Use a recorded half-time score or current event only when it is explicitly present in the selected match context or the coach's message. A previous game's half-time score is not live context.
- If the current score or observed game state is missing, ask ONE focused question covering both: "What's the score, and what are you seeing?"
- When the live state is known, write a short spoken team talk: acknowledge the state, give no more than THREE specific actions, and finish with one clear final line.
- Never invent injuries, fatigue, attendance, workload, weather, pitch conditions, tactical causes or live events.`;
  }
  if (mode === "pre-match-warm-up") {
    return `## Response mode for THIS turn: opponent-specific pre-match warm-up
Use exactly ONE canonical Coach Pack match-day warm-up supplied below that best prepares the team for the evidence-led match priority${opponent ? ` against ${opponent}` : ""}.
- The Coach Pack warm-up is age-group specific. If exactly one age group is not known, ask "Which age group is this for?" rather than choosing a routine.
- Preserve the selected routine's timing, sequence, coaching detail and outcomes exactly. Do not merge routines or invent an "official" variation.
- Briefly explain why this routine fits using only supplied team/opponent evidence, with provenance labels kept clear.
- If player availability/limitations, space, equipment, conditions or available time are essential to run it safely and are not known, ask ONE focused logistics question instead of guessing.
- This is one pre-match warm-up, not a full training session.`;
  }
  if (mode === "exact-session") {
    return `## Response mode for THIS turn: exact curriculum session
The coach named an exact curriculum session. Deliver the complete selected session using the non-negotiable 3–4-part format and content-preservation rules.`;
  }
  if (mode === "full-session") {
    return `## Response mode for THIS turn: full session requested
The coach explicitly asked to build or run the session. Deliver the complete session using the non-negotiable 3–4-part format and content-preservation rules.
- Use the literal section headings "Warm-Up", "1st Part", "2nd Part", and "3rd Part". Do not omit the separate Warm-Up, including for older or senior teams.`;
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
  if (
    mode === "recommendation"
    || mode === "match-plan"
    || mode === "half-time-talk"
    || mode === "pre-match-warm-up"
    || mode === "full-session"
  ) return true;
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