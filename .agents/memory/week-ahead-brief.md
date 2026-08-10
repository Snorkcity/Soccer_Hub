---
name: Week Ahead brief server context
description: Monday briefing now pulls last-meeting facts + latest Friday deck server-side; coach OpenAI key credit gotcha.
---

- POST /journal/week-ahead-brief accepts optional `seasonId`/`leagueId`; the server then adds two prompt sections itself: headline facts from the most recent played league meeting vs the opponent (league_matches/league_goals, Goal DNA category labels via `dnaCatLabel`) and a condensed summary of the latest saved Friday pre-match deck whose game date has passed. Both degrade to nothing when absent (first meeting / no deck).
- The deterministic fact lines are also returned as `lastMeeting` in the response, saved into the monday report jsonb, and rendered as a "What happened last time" slide in the Week Ahead PPTX.
- **Why:** the coach wanted the Monday prep continuous with what actually happened, not just season aggregates; deterministic facts also survive AI-model drift.
- **Wider context (Aug 2026, coach directive):** the brief must not over-weight the latest week — client sends ~3 weeks of reflections (22-day window, cap 10, fallback latest 4) and `prevMeetingPrepText` (trainings ≤10 days before the last match-reflection vs that opponent); server adds the Friday deck from the previous meeting vs that opponent (opponent match falls back to jsonb `data.opponent` for old rows) and the opponentScoutFingerprint. Prompt asks for recurring-theme review bullets plus a `trainingFocus` array (2-4, each naming its evidence: their strength/weakness recently or last meeting, our recent struggle, or what worked last time) rendered as a "Training — suggested focus" PPTX slide.
- **Gotcha (Aug 2026):** the coach's own OPENAI_API_KEY had zero credits — all journal AI endpoints (which deliberately bypass the Replit proxy) return 429 insufficient_quota. Not a code bug; test DB-side helpers directly (they're exported from journalInterview.ts) instead of burning a round trip on the AI call.

## U16+ language bank is the app's register
Coach directive: report/brief language should draw on the U16+/senior phase curriculum (app serves U18s and above). The U16+ Coach Pack "Language Bank" chunk in lib/db/src/data/curriculum.json is the canonical source of cues ("lose it — close it", "fast brain, calm feet", "control the tempo — accelerate or secure", "dominate transitions through anticipation, not reaction"). The week-ahead-brief system prompt embeds these; use the same register in any future generated-language feature.
