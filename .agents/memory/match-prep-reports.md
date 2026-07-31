---
name: Match Prep saved reports
description: How Monday briefings and Friday decks persist, and the our-shape remap rule
---
- Saved reports live in `match_prep_reports` (kind 'monday'|'friday', jsonb `data`); CRUD under `/match-prep/reports`, admin-gated like all writes.
- Friday deck `data` is the whole client Draft; Monday `data` = {opponent, weekOf, review[], pointers[]} — games/snapshots are recomputed live at download, only the AI-drafted text persists.
- "Copy to new" continuity rule: keep shapes/roles/set pieces, clear opponent/round/date.
- **Why:** coach wants week-to-week continuity; most roles don't change.
- Editor keeps a localStorage draft too; a baseline-JSON compare guards open/start-fresh with a confirm() so a saved deck can't silently wipe unsaved work.
- Our BP/BPO shape pickers remap the XI across formations BY INDEX — every FORMATIONS array must stay 11 slots ordered GK→def→mid→att or the remap silently mis-assigns.

**Week Ahead flow decision (Jul 2026):** no in-app editing of the AI-drafted briefing — "Draft with AI" saves straight to the list; downloads happen from saved rows. **Why:** coach wants AI to own the wording; coaches tweak in PowerPoint if needed. Streamlining for coaches beats in-app editing. Don't re-add textareas without being asked.

**Printable game-day sheets:** Friday deck ends with B/W "team talk" (parts 3+4 content, shrink-to-fit) and "game day" slides — comments/trends + kickoff countdown (fixed 10-year routine offsets: changeroom 10, shots 14, passing 25, warmup 40, talk 55, blank 60, go in 65, arrive 75 mins before KO; countdown column prints near-white F2F2F2 like the coach's "invisible" numbers) + 3 grey scribble shape boxes (top one filled with XI). Draft fields kickoff ("HH:mm") and commentsTrends are strings; coerce non-strings on load for old saves.
