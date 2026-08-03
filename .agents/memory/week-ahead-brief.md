---
name: Week Ahead brief server context
description: Monday briefing now pulls last-meeting facts + latest Friday deck server-side; coach OpenAI key credit gotcha.
---

- POST /journal/week-ahead-brief accepts optional `seasonId`/`leagueId`; the server then adds two prompt sections itself: headline facts from the most recent played league meeting vs the opponent (league_matches/league_goals, Goal DNA category labels via `dnaCatLabel`) and a condensed summary of the latest saved Friday pre-match deck whose game date has passed. Both degrade to nothing when absent (first meeting / no deck).
- The deterministic fact lines are also returned as `lastMeeting` in the response, saved into the monday report jsonb, and rendered as a "What happened last time" slide in the Week Ahead PPTX.
- **Why:** the coach wanted the Monday prep continuous with what actually happened, not just season aggregates; deterministic facts also survive AI-model drift.
- **Gotcha (Aug 2026):** the coach's own OPENAI_API_KEY had zero credits — all journal AI endpoints (which deliberately bypass the Replit proxy) return 429 insufficient_quota. Not a code bug; test DB-side helpers directly (they're exported from journalInterview.ts) instead of burning a round trip on the AI call.
