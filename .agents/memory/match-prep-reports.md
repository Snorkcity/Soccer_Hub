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
