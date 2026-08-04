---
name: Weighted insight candidates
description: The match-report pattern for auto-generated insights/badges — weighted candidate pools with mandatory concern candidates.
---

# Weighted insight candidates

Rule: any auto-generated insight surface (badges, comments, one-liners) is built as a POOL of candidate angles, each with a weight for how striking it is; the top N are shown so the mix varies game to game. Every pool MUST include negative/concern candidates (tone "watch", rendered amber) alongside the positives.

**Why:** the coach explicitly wants concerns surfaced — "all good news usually means we don't look for things to fix." A one-off pattern (season-worst, repeat leak, opponent tormentor) matters more than a routine positive.

**How to apply:** when adding insight logic to any report, mirror the match-report Goal story badges: candidate kinds deduped (best per kind), weighted sort, slice N; concerns weighted so they can displace mild positives, but marquee positives (hat-trick) still headline. Tied season extremes must compare against raw min/max values, not competition rank (rank === outOf misses joint-worst).

Badge shape carries optional `tone: "watch"`; optional new response fields stay OUT of the OpenAPI `required` list (saved-jsonb back-compat).
