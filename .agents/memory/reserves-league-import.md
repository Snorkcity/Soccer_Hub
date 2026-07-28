---
name: Reserves league import & per-league focus club
description: How the ACT NPLW Reserve 2026 season was imported and how the focus club is now resolved per league
---

## Focus club is per-league now
- `leagues.focus_club` (nullable text) names the club string used in that league's data ("Belconnen" for both ACT NPLW and ACT NPLW Reserves — reserves data is mapped to plain club names at import). Fallback when null: "Belconnen".
- `artifacts/api-server/src/lib/focusClub.ts` → `focusClubForSeason(seasonId)` (cached). analytics.ts and entry.ts resolve it per handler; never hardcode "Belconnen" in new endpoints. The athletic-tests players list (year+team scoped, no seasonId) still uses the literal deliberately.
- **Why:** every future league (mens NPL, other clubs as customers) has its own focus-club spelling in the source data.

## Reserves import
- `lib/db/src/importReserves.ts` + CSVs in `lib/db/src/data/reserves-2026/` (converted from Luke's xlsx). Additive + idempotent: wipes only its own team+season / season scope, never firsts. Run by esbuild-bundling from artifacts/api-server (no tsx runner).
- Reserves matches hang off the SAME "Belconnen" analytics team as the firsts (one entry in the team dropdown; the season picker distinguishes firsts vs reserves). The import deletes any legacy separate reserves team rows. Luke's "-Res" club spellings are mapped to plain display names (Belconnen, Croatia, ...) via CLUB_MAP at import time; league renamed "ACT NPLW Reserves", season label "2026 Season" (dropdown convention "League · Label").
- Players are keyed name+club (players.club → DB column `country`); same surname at two clubs must not share a player row.

## Excel score-corruption gotcha
- Google-Sheets/Excel exports can turn score strings like "1-4" into date serials (46026). Symptom: ladder points wildly low, full_score showing 5-digit numbers. Fix used: decode serial → month-day and verify against per-match goal tallies (scorerTeam counts; half-time = minutes ≤45). Check every future sheet import for this.

## Known data quirks (reserves 2026, flagged to coach)
- R7-MAJ-BELR has NO player-based rows (BUFC's own R7 minutes missing — coach will add later on prod via Data Entry).
- Resolved per coach: R8 Moss rows split into Ab.Moss (80) / Am.Moss (10); Tahli = Milin (fixup); Emily assist removed from CSV.
- Name fixups applied in importReserves.ts: Millin→Milin, Mcrae→McRae, Pavier-Jones→Pavier-jones.
- R16 in league data has only 2 fixtures; no BUFC R16 yet.
