---
name: Reflection journal module
description: A-diploma reality-journal cycles + standalone coach reflections; pptx export; voice interviews planned
---

## Shape
- `journal_cycles` (flexible weeksCount 1–12; coach runs 6-week/12-session/6-game cycles; 3-contact coaches run 4-week) + `journal_entries` (cycle blocks keyed by (cycleId, weekNo, kind) partial-unique WHERE cycle_id IS NOT NULL; standalone reflections have cycleId NULL).
- Content is jsonb field-id→text; field ids/labels defined ONLY client-side in `journalFields.ts` — renaming an id orphans stored data (needs migration).
- Cycle kinds mirror the course template slides: weekly_planner, weekly_review, game_preview, game_tactics, game_analysis. Standalone: session_reflection, match_reflection.
- pptx export is client-side (pptxgenjs, same brand constants as GPS/testing reports); template pptx & coach's block-1 example live in attached_assets (0_Reflections_*, 0_2026-Scott_Conlon-*). Course template is generic Office theme — club branding is deliberate ("content is marked, style is ours").
- Cycle-entry upsert MUST stay atomic ON CONFLICT with `targetWhere: cycle_id IS NOT NULL` (partial index requires targetWhere or the upsert misses).

## Voice interviews (stage 2 — NOT built)
- Coach's core want: voice-to-voice AI reflection interview after training (→ weekly/session reflection) and after matches (→ match report), usable driving home. Questions to be designed WITH coach.
- **Why**: coach's identified block-1 weakness is insufficient reflection; interviews are the habit fix, journal submission is the by-product.
- Dev AI proxy does NOT support OpenAI Realtime API; supported path is turn-based `gpt-audio` via voice-messages SSE + `useVoiceStream` (webm→wav conversion, raised Express body limit). Prod (coach's own OpenAI key) could upgrade to Realtime later.
- Session Planner integration ("pull sessions into journal") agreed as future work, manual for now.
