---
name: Goal Analysis Intelligence Framework
description: The coach's authoritative framework for interpreting goal data — voice, confidence ladder, insight template. Lean on it for ALL automated insight/report sentences.
---

# Goal Analysis Intelligence Framework

Source doc: `attached_assets/Pasted--Goal-Analysis-Intelligence-Framework-*.txt` (written by the coach with his football consultant). Treat as the house style for every automated insight, scouting line, and report sentence.

## Core rules
- **Confidence ladder** (grade language by sample): Observation (limited evidence) → Emerging pattern (repeated, worth attention) → Strong evidence (clearly above benchmark, consistent) → Established identity (persisted across substantial sample).
- **Hedged voice**: prefer "consistent with…", "the available evidence suggests…", "may indicate…". No definitive claims unless evidence is strong. Never label a player from a handful of goals.
- **Alternative explanation is mandatory thinking**: e.g. front-third regain goals may reflect pressing OR opponents who play risky build-up. Say whether a pattern is the scorer's strength, the conceder's weakness, or both.
- **Insight template** (full-form insights): Evidence → Comparison (benchmark) → Football meaning → Alternative explanation → Confidence → Coaching implication → Video review question ("what to check on footage").
- Distinguish isolated events from repeatable patterns; middle-third regains alone mean little — combine with transition state (DT/AT), pass count, channel, final action.
- DT vs AT is central: same regain location = very different football depending on whether the defence was organised.

## Interpretation vocabulary (per dimension)
The source doc has rich "may demonstrate…" lists per category (corners, FKs, pens, each regain third, DT/AT, pass count, channel L/C/R, final-pass cross/cut-back/through-ball, first-touch vs after-touch, footedness, scoring location, partnerships, team/opponent identities). Read the doc when writing new insight copy — don't invent alternative wording.

## Data coverage (as of Aug 2026)
DT/AT is recorded for every typed open-play goal (SP goals have no DT/AT). The goals/league_goals tables ALSO carry passString, buildupLane (Left/Centre/Right), howPenetrated, assistType, firstTimeFinish, finishType — so sections 5–8 of the framework ARE buildable. Coverage is per-club: Belconnen/Croatia/Olympic/Wanderers well coded; several clubs have goal types only (no pass/lane). Every read must check its own sample and show counts, not just percentages (a "100%" off 5 goals over-claims).

## Coach's key interpretations (use verbatim spirit)
- MT-DT + low pass string = counter threat: "beware their middle-third regains — they score before you're organised, in 2–3 passes[, down the right]".
- Transition goals should land within ~2–3 passes; longer = the moment is gone, defence resets.
- FT-DT = press forced a mistake/tackle near goal. FT-AT = opponent was probably in a low block (organised in their back third) and had to be moved around in buildup before penetration — very different stories from the same third.
- Set pieces above benchmark → profile the people: usual SP assister (delivery) and usual SP scorers (aerial/reads the flight).

## Implementation pointer
`artifacts/api-server/src/lib/goalIntel.ts` — shared goalIntelReads(scored, conceded, "scout"|"self") used by opponent-match-report and season-report. Extend there for new surfaces.

## Naming rule
**Never say "16+" in user-facing copy** (ambiguous — sounds like adults). Say "senior-readiness markers", "the coach pack standards", or "the club's success measures". Applies to Season Report cards and anywhere the coach-pack language surfaces.
