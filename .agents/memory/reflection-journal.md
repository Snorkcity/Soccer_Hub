---
name: Reflection journal module
description: A-diploma reality-journal cycles + standalone coach reflections; pptx export; voice interviews planned
---

## Friday pre-match report (BUILT v1, Jul 2026 — awaiting coach feedback)
- 10-slide deck live: Cover → Lineup (pitch XI + subs) → Our shape BP → Our shape BPO → Their shape (BP+BPO side by side) → Key objectives BP → BPO (theme banner + GK/Def/Mid/Att 2×2 cards, AI-drafted Pep-voice, editable) → Corners for → Corners against → Free kicks.
- Builder at /match-prep (nav "Match Prep"): FORMATIONS slot maps (433/4231/442/343/352), roster from opponent-profile club=Belconnen, draft persisted in localStorage `bufc-matchprep-draft-v1`, POST /journal/prematch-brief (gpt-4o, coach's key, Australian spelling in prompt), client pptx via prematchPptx.ts (green pitch, 7 mowing-stripe bands on navy — coach-requested).
- Coach persona for AI voice: Pep-style — passionate but calm, detail-specific; punchy dot points, never overload players (A-licence feedback).
- e2e tested (browser + libreoffice render of deck). Verify pptx visually: esbuild-bundle prematchPptx.ts for node (blob→Buffer works), soffice→pdftoppm.
- Still to do: print mode (B&W slim, coach ticks pages); club logos (fetch for 6 NPLW clubs, coach approves); coach layout feedback on set-piece slides.
- Monday report considered done at "8/10" — don't polish further unless asked.

## Week Ahead report (BUILT Jul 2026)
- Monday pptx briefing built client-side (weekAheadPptx.ts, journalPptx branding): cover → "last week" (AI review bullets + latest training/match reflection tables) → "this coming week" (last match reflection vs chosen opponent, both clubs' last 3 games from /analytics/opponent-profile with scorers/assists, AI prep pointers).
- Opponent picked manually from /analytics/opponent-clubs (coach chose manual over fixtures; fixtures + auto-Monday generation wanted later — "newspaper waiting Monday").
- POST /journal/week-ahead-brief (coach's own OpenAI key, gpt-4o JSON) takes condensed client-composed text blocks, returns {review[], pointers[]}.
- Last-vs-opponent match reflection found by opponent-name substring in title+content (no opponent field on reflections).
- **Coming next:** Friday "match prep" pptx — coach will share an example of what to include.

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

## Voice interviews (BUILT)
- Coach's chosen UX: fixed questions only (no free-form), spoken aloud (TTS), at most ONE gentle probe per question, ALWAYS an "anything to add, or move on?" confirm gate between questions (protects vs sneezes/noise ending an answer early). Draft lands in the normal editor for review — nothing saves unapproved; saved with source=voice.
- ALL interview OpenAI calls use the coach's own OPENAI_API_KEY direct to api.openai.com (his explicit request) — never the Replit AI proxy. Turn-based: gpt-4o-mini-transcribe → gpt-4o-mini judge (probe/next-vs-continue) → gpt-4o write-up → gpt-4o-mini-tts (voice "ash").
- Client state machine gotchas: monotonic session token (not a boolean) to kill stale async results on close/reopen; confirm-reply containing substance loops back to the confirm gate; model JSON drift handled server-side with safe-parse fallbacks (never 500).

## Voice interviews (original stage-2 notes)
- Coach's core want: voice-to-voice AI reflection interview after training (→ weekly/session reflection) and after matches (→ match report), usable driving home. Questions to be designed WITH coach.
- **Why**: coach's identified block-1 weakness is insufficient reflection; interviews are the habit fix, journal submission is the by-product.
- Dev AI proxy does NOT support OpenAI Realtime API; supported path is turn-based `gpt-audio` via voice-messages SSE + `useVoiceStream` (webm→wav conversion, raised Express body limit). Prod (coach's own OpenAI key) could upgrade to Realtime later.
- Session Planner integration deferred to OFF-SEASON at coach's request (he needs time to conceptualise the planning modules); he'll build session plans manually and drop them into the journal pptx himself for now.
- Coach confirmed he wants AI write-ups "in a language like mine": use his Journal-1 example pptx (attached_assets 0_2026-Scott_Conlon-*) as the writing-style reference for the summarisation prompt — direct, practical coach voice, not corporate.
