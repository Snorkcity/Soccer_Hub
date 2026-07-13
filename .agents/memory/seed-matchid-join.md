---
name: Seed match-ID join across CSVs
description: Belconnen goals + player-stats link to matches by Match ID string; a typo in team-based CSV silently drops that game's detail.
---

# Seed match-ID join across CSVs

The BUFC seed (`lib/db/src/seed.ts`) builds the Belconnen-only `matches` table from the
**team-based** CSV, then keys a `matchIdMap` on the team-based `Match ID`. Both
`goals` (from **league-based** CSV) and `player_stats` (from **player-based** CSV) are
imported ONLY for rows whose `Match ID` exists in that map (`matchIdMap.has(mid)`).

**Consequence / rule:** the `Match ID` string must be byte-identical across team-based,
league-based, and player-based for a given fixture. If team-based has a typo'd ID
(e.g. `R13-BEL-TUG` for a game that is actually vs Majura, `R13-BEL-MAJ` everywhere
else), the match row still imports (opponent + score come from team-based columns, not
the ID), but its goal detail and player-stat rows are **silently dropped** — the game
shows a scoreline yet contributes nothing to any goal-detail/goal-map/player chart.

**Why:** this exact typo made the 28/06/2026 Belconnen 10-0 vs Majura game appear in the
matches list (GS=10) but with zero goal rows and zero player rows. league-based (10 goal
rows) and player-based (31 rows) both used the correct `R13-BEL-MAJ`.

**How to apply:** when a game's aggregate score exists but its goal/player detail is
missing, suspect a `Match ID` mismatch first. Cross-check the ID across all three CSVs
(`grep -c "<ID>" *.csv`); the odd-one-out is the typo. Fix the source CSV and re-seed.
Re-seeding reassigns teamId/seasonId (volatile) — never hardcode them.

## Player-name mismatches (Scorer/Assist vs Player Name)

The same class of bug hits player names: a `Scorer`/`Assist` in league-based can be
spelled differently from the `Player Name` in player-based (which carries the minutes),
so goal/assist attribution can't join to minutes and the player shows 0 mins.

**Fix location:** a `NAME_FIXUPS` map in `seed.ts` maps each known typo → the roster
(player-based) spelling, applied via `canonName()` to scorer/assist in BOTH the team
`goals` and `league_goals` insert blocks. **Why the seed map, not the raw CSV:**
corrections survive a fresh data re-upload and are self-documenting. **Gotcha:** those
two scorer/assist blocks have different indentation — edit both (a single replace_all
with one indentation misses one).

**"OG" = own goal**, not a player — excluded from the opponent-players endpoint's player
aggregation, not name-mapped.

**EJ is a transfer, NOT a typo (do not "fix"):** EJ scored/assisted for Croatia
(league-based `Scorer Team`=Croatia), then transferred to Belconnen mid-2026. The user
relabeled all EJ player-based rows Croatia→Belconnen, so her minutes live under Belconnen.
Consequence: she shows on Croatia's Opponent Insights with 0 mins. **User decision
(2026): leave exactly as-is** — she keeps her Croatia goals, 0 mins is acceptable. Her
Belconnen minutes only count in real Belconnen matches because the endpoint resolves each
match by which teams actually played (her Croatia-match rows relabeled Belconnen are
ignored for matches Belconnen wasn't in).

**Sibling / same-surname disambiguation (roadmap):** 2026 data mixes bare surnames with
initialed siblings for the same family (Babic/A.Babic/L.Babic, Nikias/D.Nikias/S.Nikias,
Singers/M.Singers/V.Singers, Cerne/A.Cerne/N.Cerne, DeMarco/N.DeMarco/S.DeMarco) — a bare
surname is ambiguous. The bare entries still self-match this season (no broken joins), so
no code change was made. **Plan from 2027:** switch to `Initial.Surname` (`J.Bloggs`) in
BOTH sheets; siblings then disambiguate naturally with no special app logic, provided both
sheets use identical spelling. If they ever diverge, reconcile via NAME_FIXUPS.
