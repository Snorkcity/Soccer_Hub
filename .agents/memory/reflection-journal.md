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

## Periodisation
- Coach's codes: `cycle-session-phase` e.g. 03-01-B2; phases B1–B4, M1–M4, S1–S4 = big/medium/small game fortnights (Raymond Verheijen philosophy, adapted to amateur env). 6-week cycle = 12 sessions = 3 fortnights.
- Captured as jsonb fields in weekly_planner (`phaseCode`, shown as badge on week card) + weekly_review (`periodisationReflection`). Voice interview should ask about phase tracking.
- Club curriculum ch.5 ("belconnen-player_devlopment_curriculum" docx in attached_assets) is the source language: U16+ = "Dutch Rhythm (Verheijen-Inspired)", 6-week blocks big→medium→small game rotation, "the field is the fitness"; U10–15 = Croatian rhythm (3–5wk cycles); end-of-block review checks principle transfer + adjusts game-type ratios not ideas. Journal hints quote this. Full doc suite (framework, coach packs, session plans) is the future Coach Assistant library.

## Voice interviews (stage 2 — NOT built)
- Coach's core want: voice-to-voice AI reflection interview after training (→ weekly/session reflection) and after matches (→ match report), usable driving home. Questions to be designed WITH coach.
- **Why**: coach's identified block-1 weakness is insufficient reflection; interviews are the habit fix, journal submission is the by-product.
- Dev AI proxy does NOT support OpenAI Realtime API; supported path is turn-based `gpt-audio` via voice-messages SSE + `useVoiceStream` (webm→wav conversion, raised Express body limit). Prod (coach's own OpenAI key) could upgrade to Realtime later.
- Session Planner integration deferred to OFF-SEASON at coach's request (he needs time to conceptualise the planning modules); he'll build session plans manually and drop them into the journal pptx himself for now.
- Coach confirmed he wants AI write-ups "in a language like mine": use his Journal-1 example pptx (attached_assets 0_2026-Scott_Conlon-*) as the writing-style reference for the summarisation prompt — direct, practical coach voice, not corporate.
