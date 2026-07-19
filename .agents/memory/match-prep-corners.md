---
name: Match Prep corner set pieces
description: Data model and rules for the corner set-piece pitch pickers and deck rendering on /match-prep
---

- Corner roles stored as `Record<role, string[]>` in draft stores (spFor, spFor2, spAgainst, spAgainstZonal); pitch-picker writes per-spot by index and may leave `""` placeholders — always `.filter(Boolean)` before deck groups/dots or migrations.
- Two coordinate maps per setup: `*_SPOTS` = precise deck coords; `UI_SPOTS` = spread-out on-screen picker positions (so dropdowns don't overlap). Keep role names/spot counts in sync between them.
- Taker model: takers live in `d.spTakers` (shared by both corners-for variations). BOTH takers always pinned at their corners (right one gets the ball) AND they still pick a role — they appear twice on the diagram deliberately (coach: pins show who takes; role spot shows where they stand when not taking).
- Role rename gotcha: corners-for "Near post" became "Far post"; old drafts are migrated at load AND at deck time (placeholder-aware length checks).
- **Why:** coach wants the deck diagram and role cards to never contradict each other, and each player in exactly one spot per pitch.
