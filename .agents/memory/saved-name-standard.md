---
name: Saved-name standard for reports/documents
description: Coach's agreed format for every saved-item list row (briefings, decks, reflections, future docs)
---

Every saved report/document list row uses one format (agreed 27 Jul 2026):

`<bold: Doc Type — R# v Opponent | weekday>` `<muted: · d Month yyyy (game/entry date)>` `<muted text-xs: · saved d MMM>`

Examples:
- Match Prep — R16 v Wanderers · 26 July 2026 · saved 25 July
- Week Ahead — R17 v Tuggeranong · 2 August 2026 · saved 27 Jul
- Training Reflection — Thursday · 28 July 2026 · saved 28 Jul
- Match Reflection — R16 v Wanderers · 25 July 2026 · saved 26 Jul

**Why:** coach wants all "saved X" areas consistent and not misleading about which game/week they cover.
**How to apply:** any NEW saving/reporting feature must store round + game date in its data and render rows in this style; legacy rows without structured data keep their old titles.
