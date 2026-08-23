const SYDNEY_TIME_ZONE = "Australia/Sydney";

export interface AutoLinkVeoRow {
  id: number;
  opponent: string | null;
  title: string | null;
  startsAt: string | null;
  matchId: number | null;
}

export interface AutoLinkHubMatch {
  id: number;
  matchDate: string | null;
  opponent: string;
}

export interface AutoLinkPlan {
  links: Array<{ veoId: number; matchId: number }>;
  ambiguous: number;
  unmatched: number;
}

const sydneyDateFormatter = new Intl.DateTimeFormat("en-AU", {
  timeZone: SYDNEY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Convert a Veo recording start instant to its Australia/Sydney calendar date.
 * Comparing this YYYY-MM-DD value, rather than elapsed UTC time, keeps linking
 * correct across both daylight-saving transitions.
 */
export function sydneyCalendarDate(startsAt: string | null | undefined): string | null {
  if (!startsAt) return null;
  const instant = new Date(startsAt);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = new Map(
    sydneyDateFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = parts.get("year");
  const month = parts.get("month");
  const day = parts.get("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

/** Normalise the date-only values stored by Hub/Dribl without timezone parsing. */
export function hubCalendarDate(matchDate: string | null | undefined): string | null {
  const match = (matchDate ?? "").trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\D|$)/);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function normName(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

// Loose opponent-name match: exact after normalisation, or one contains the
// other (min 4 chars so "fc"/"utd" fragments don't false-positive).
export function opponentsMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = normName(left);
  const b = normName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.includes(a)) return true;
  if (b.length >= 4 && a.includes(b)) return true;
  return false;
}

/**
 * Build a conservative auto-link plan for one league.
 *
 * Date is always the primary identity. Opponent metadata and the recording
 * title are considered only when multiple unclaimed fixtures share that exact
 * Sydney date. Existing links reserve their fixture and are never changed.
 */
export function planExactDateAutoLinks(
  veoRows: readonly AutoLinkVeoRow[],
  hubMatches: readonly AutoLinkHubMatch[],
): AutoLinkPlan {
  const taken = new Set(
    veoRows.map((row) => row.matchId).filter((matchId): matchId is number => matchId != null),
  );
  const links: AutoLinkPlan["links"] = [];
  let ambiguous = 0;
  let unmatched = 0;

  for (const veo of [...veoRows].sort((a, b) => a.id - b.id)) {
    if (veo.matchId != null) continue;
    const recordingDate = sydneyCalendarDate(veo.startsAt);
    if (!recordingDate) {
      unmatched++;
      continue;
    }

    const candidates = hubMatches.filter(
      (fixture) =>
        !taken.has(fixture.id) &&
        hubCalendarDate(fixture.matchDate) === recordingDate,
    );

    let pick: AutoLinkHubMatch | null = null;
    if (candidates.length === 1) {
      pick = candidates[0];
    } else if (candidates.length > 1) {
      const byOpponent = candidates.filter((fixture) =>
        opponentsMatch(veo.opponent, fixture.opponent),
      );
      if (byOpponent.length === 1) {
        pick = byOpponent[0];
      } else {
        const titleCandidates = byOpponent.length > 1 ? byOpponent : candidates;
        const byTitle = titleCandidates.filter((fixture) =>
          opponentsMatch(veo.title, fixture.opponent),
        );
        if (byTitle.length === 1) pick = byTitle[0];
      }
      if (!pick) {
        ambiguous++;
        continue;
      }
    } else {
      unmatched++;
      continue;
    }

    links.push({ veoId: veo.id, matchId: pick.id });
    taken.add(pick.id);
  }

  return { links, ambiguous, unmatched };
}