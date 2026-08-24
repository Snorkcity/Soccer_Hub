---
name: NPLB rolling-sub player evidence
description: Domain limits on defensible player analytics for ACT NPLB U14, U15, U16 and U18.
---

For exact ACT NPLB U14, U15, U16 and U18 leagues, a named Dribl match-card player proves one appearance. Goals, assists, goal contributions and stable-identity borrowing evidence remain usable. Minutes, starts, bench status, substitution timing, per-90 rates, clutch-minute logic and on-field minute-window impact must remain unavailable.

**Why:** These competitions use rolling substitutions, so match cards cannot support precise minute windows or start/sub classifications. Returning derived zeros or estimates would manufacture confidence the source does not provide.

**How to apply:** Give these seasons an explicit appearance-only API/UI profile, deduplicate each imported player-match row once, preserve zero-contribution players, and classify borrowing direction only from stable Dribl identity plus proven home-grade evidence. Keep senior NPLM/NPLW on the full profile.