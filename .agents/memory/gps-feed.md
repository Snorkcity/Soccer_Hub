---
name: GPS feed between leagues
description: Policy for a league (e.g. NPLW Reserves) reading another league's GPS uploads read-only, squad-filtered
---
A league can be configured to have NO GPS uploads of its own and instead read another league's GPS rows at request time, filtered to one squad (squad is parsed from the round suffix). Agreed with the coach: share at read time, never copy rows.

**Why:** the firsts' Catapult uploads already contain the reserves squad's rows; duplicating them would cause double entry and drifting copies. Source-league fixes/re-uploads must flow through automatically.

**How to apply:**
- The feed is strictly read-only: every GPS write path must reject a fed league. Any NEW GPS write route needs the same guard.
- Opponent pairing for a fed league uses the fed league's OWN fixtures, joined by round number only — opponent spellings differ between imports, so loose name agreement adopts the fixture spelling, disagreement keeps the carried name and is surfaced as a mismatch, and **no fixture always clears the opponent** (even a carried one — it came from another competition's upload). Never silently misattribute; the UI shows an explicit "couldn't match" state.
- League-privacy middleware stays untouched: requests only ever name the fed leagueId; the squad-scoped read inside the GPS routes is the sole, deliberate crossover.
- Configuring a feed is superadmin-only (it crosses league-privacy lines) and lives with league setup in Data Entry.
- Alias pooling and positions are global (not league-keyed), so canonical names carry through the feed for free.
