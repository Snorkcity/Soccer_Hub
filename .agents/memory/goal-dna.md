---
name: Goal DNA framework
description: The coach's core goals-by-type analysis framework, benchmark shares, and interpretation language — powers the match report Goal DNA card.
---

# Goal DNA — the coach's core analysis framework

Scott calls this "the gold" of the whole app — the reason the project started. Any new analytics/report feature touching goals should speak this language.

## Goal type codes (goals.goal_type / league_goals.goal_type)
- `SP-C/P/F/T` — set pieces (corner / penalty / free kick / throw-in)
- `R-{FT|MT|BT}-{DT|AT}` — regain third (Front/Middle/Back) × transition timing:
  - **DT (during transition)** = struck before the opponent reset at the turnover
  - **AT (after transition)** = the defence was set and organised and still got broken down

## Interpretation (scored; mirror for conceded)
- **FT regain**: opponent plays out under pressure / vulnerable to the press (conceded: we're vulnerable playing out — mitigate)
- **MT regain**: fairly standard, light touch on per-goal insight; DT = they didn't reset quickly, AT = worked through a set defence
- **BT regain**: played through them from deep — they're easy to play through OR our possession play is genuinely good (conceded: too much space between our lines)
- **Set piece**: rehearsed strength (conceded: organisation/marking review)

## Benchmark season mix (share of typed goals)
- Set pieces **27%** (band 23–31)
- Middle-third regains (DT+AT) **48–50%** (band 44–54)
- Front-third **~12%**, Back-third **~12%** (bands 8–16)
- Above/below band = strength to exploit (scored high / conceded low) or weakness to mitigate (conceded high / scored low). Verdicts gated on ≥12 typed goals.

## Insight voice — selective, not exhaustive
Coach's direction: don't comment on every goal — the analyst reads the charts; insights should find "something to remember". Per-match Goal DNA lines fire only for signature patterns (side's dominant/over-benchmark category) or rarities (≤2 all season). Future direction: a full pass to align all app insight wording with the coaching language in the Coach Assistant curriculum docs ("coach packs") — do when Scott says the time is right.

**How to apply:** implemented in the match-report `goalDna` block; reuse the same benchmarks, category mapping, and voice anywhere goals-by-type analysis appears (decks, season summaries, opponent profiles).

## Match report presentation (coach-agreed redesign, Aug 2026)
The Goal DNA card leads with THIS match: per-goal rows (minute, scorer, category, DT/AT read) each badged vs season DNA (signature ≥25% & biggest cat / rare ≤2 season / typical / untyped), plus a 2–3 sentence tactical read from minutes+types (response-within-10-min, all-DT/all-AT regains, half clusters, early lead, late concessions, set-piece counts). Season bars stay as compact context. Shared server helper builds both team and scout voices; fields are OPTIONAL in the schema so pre-existing saved reports (jsonb) still parse and render the legacy lines. Scouting semantics flip everywhere incl. per-goal row icons/deck arrows.

## Parked next: "week ahead" (Monday) report inputs
Once match/scout report content is settled, Scott wants the Monday match-prep report generation to also consider (a) the previous meeting vs that opponent and (b) our own previous match report, on top of what it already uses.
