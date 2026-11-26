---
name: Match Prep saved reports
description: How Monday briefings and Friday decks persist, and the our-shape remap rule
---
- Saved reports live in `match_prep_reports` (kind 'monday'|'friday', jsonb `data`); CRUD under `/match-prep/reports`, admin-gated like all writes.
- Friday deck `data` is the whole client Draft; Monday `data` = {opponent, weekOf, review[], pointers[]} — games/snapshots are recomputed live at download, only the AI-drafted text persists.
- "Copy to new" continuity rule: keep shapes/roles/set pieces, clear opponent/round/date.
- **Why:** coach wants week-to-week continuity; most roles don't change.
- Editor keeps a localStorage draft too; a baseline-JSON compare guards open/start-fresh with a confirm() so a saved deck can't silently wipe unsaved work.
- Match Prep for the NPLM program must offer both the firsts and U23 campaign squads before their first match.
  **Why:** the coach selects players across those squads for preseason friendlies; match appearances are not a complete selection list.
  **How to apply:** use the explicitly shared season rosters, not players inferred solely from recorded games. Never include unrelated competitions.
- Browser drafts with no reliable owner must not be automatically assigned to the currently viewed team.
  **Why:** a legacy shared draft showed 2026 NPLW set-piece selections while the coach was preparing the 2027 men's team.
  **How to apply:** isolate all draft state by account, club, competition and campaign; retain unowned legacy drafts without importing them into another context.
- Our BP/BPO shape pickers remap the XI across formations BY INDEX — every FORMATIONS array must stay 11 slots ordered GK→def→mid→att or the remap silently mis-assigns.

**Week Ahead flow decision (Jul 2026):** no in-app editing of the AI-drafted briefing — "Draft with AI" saves straight to the list; downloads happen from saved rows. **Why:** coach wants AI to own the wording; coaches tweak in PowerPoint if needed. Streamlining for coaches beats in-app editing. Don't re-add textareas without being asked.

**Printable game-day sheets:** Friday deck ends with B/W "team talk" (parts 3+4 content, shrink-to-fit) and "game day" slides — comments/trends + kickoff countdown now sits bottom-right of the TEAM TALK page (fixed 10-year routine offsets: changeroom 10, shots 14, passing 25, warmup 40, talk 55, blank 60, go in 65, arrive 75 mins before KO; countdown column prints near-white F2F2F2 like the coach's "invisible" numbers) + 3 grey scribble shape boxes (top one filled with XI). Draft fields kickoff ("HH:mm") and commentsTrends are strings; coerce non-strings on load for old saves.

**Shape boxes are real tables:** game-day print sheet's 3 grey boxes are 5×7 PPTX tables (header cell = formation, XI grouped into pitch-lines by exact py — merge closest lines if >6 — one row per line, edge players px≤0.2/≥0.8 forced to edge columns, GK in the goal cell; goal = black posts+bottom, open top so the coach can edit them in PowerPoint after download.
