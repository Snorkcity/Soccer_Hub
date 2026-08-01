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

**How to apply:** implemented in the match-report `goalDna` block; reuse the same benchmarks, category mapping, and voice anywhere goals-by-type analysis appears (decks, season summaries, opponent profiles).
