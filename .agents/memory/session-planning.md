---
name: Session planning app — vision & domain model
description: The next major BUFC Hub module — coach's slide library → structured practice library → session builder → canvas editor → AI assembly. Naming codes, session structure, PDF format.
---

# Session Planning app (next major module, agreed Jul 2026)

## Vision (coach's words, aligned)
AI must use HER coaching knowledge (500-slide PowerPoint), never invent generic internet drills. Slides → structured data in Postgres. Builder assembles from library by age/numbers/focus/time. Canvas editor stores cones/players/areas as data points (movable/resizable). Saves NEVER overwrite master — new version into coach/club library; adaptations are learning signal. Long-term: modules interconnect into a "football operating system".

## Agreed slice order
1. **Import & Library** — extract ~500 slides (PowerPoint shapes, not images — extractable as data), searchable/filterable cards.
2. **Session Builder + PDF export** — pick practices into 4 parts, Build → PDF (replaces her screenshot→Word→PDF→email workflow). This pair = first real win.
3. **Canvas editor** — live diagrams, master-vs-copy versioning.
4. **AI assembly** — incorporate her "Coach Assistant" custom GPT (her full Belconnen curriculum: development phases, matchdays) as the methodology brain.

## Session structure (fixed, 4 parts)
Warmup (standard, reused; + optional passing activation/ball mastery extra) → Introduction → Main part → End game. Coaches may use 2, 3 or all 4 parts.

## Her session-plan PDF format (samples in .agents/outputs/session-pdfs/, docx template in attached_assets/0_260709-NPLW-S30-D-P*.docx)
- Landscape, 2 pages. Header strip: Date | Session Title | Team | Session# | Theme | Cycle | Location | Time.
- P1: Warmup / Introduction / Main part columns — diagram on top, then Rules/explanation, Coaching messages/Tasks, Progressions, Coaching points, and Players/Size/Timing + Scoring/Intensity strips (= natural per-practice schema).
- P2: End game, pitch-layout diagram (coloured zones = where each part sets up; helps assistants set up), Comments, squad list with availability notes. Extra passing/ballmastery diagram squeezed into middle column white space of p2.
- Roster/availability should eventually pull from the app's player data.

## Naming & curriculum codes (tags for the library)
- Filename: `260709-NPLW-S30-D-P` = date(YYMMDD)-team-S30(S=season/P=preseason/O=offseason + session#)-moment-focus. Moment: D defensive, A attacking, T transition. Focus: P pressing, CB cover/balance, MB midblock, many more.
- Cycle code `4-11-S3` = cycle 4, 11th session of cycle, S3 = periodisation ref (3rd small-sided session). 12 sessions/cycle: 4 big-game, 4 medium-game, 4 small-sided. Periodisation micro/macro underneath.

## Canvas editor shape palette (coach request, Jul 2026)
- Palette when building/editing practices: plain circles (numbered) for generic markers, plus top-down "player" shapes — circle with number + shoulder wings showing facing direction — that must ROTATE ("swivel") to communicate body position. Reference screenshot: attached_assets/image_1784163843232.png. Store rotation as data per shape.

## Multi-coach direction (decided Jul 2026 — parked, revisit later)
- The detailed "Session details" header (session#, cycle code, squad list, etc.) is HER personal workflow — keep it for her login only.
- Other coaches in the club get a SIMPLER session-details form: date, theme, and a couple of other basics. Design generic form first when session planner work resumes; don't extend her bespoke fields further for now.
- **Why:** app's purpose is club-wide — every coach plans sessions; most won't fill her level of detail.

## Status
- Slice 1 (Import & Library) DONE — see practice-library.md.
- Slice 2 (Session Builder + print) DONE Jul 2026: /sessions list + editor + /sessions/:id/print (browser print = PDF export, A4 landscape, 2 pages matching her format; print route renders OUTSIDE the app Shell). Parts stored one row per part (unique session_id+part), part slot = practiceId + 9 free-text fields; squad list is free text "num | pos | name | note" per line (later: pull from player data). PUT part is a partial upsert — only provided keys update.
- Editor draft lesson: per-section drafts must (a) re-sync from server whenever not dirty, and (b) picking a practice while text is dirty must save the dirty text together with practiceId — otherwise edits are silently lost. Both handled; keep this invariant in slice 3.
- Pitch-layout diagram on print p2 deferred; ~102 untitled "Variation" slides grouping deferred.

## Coach-assistant GPT (idea noted Jul 2026 — not started)
- Coach has a custom ChatGPT GPT: a complete football development curriculum (series of documents) used for the Belconnen female program; intended for every club that uses this product.
- Goal: interact with it INSIDE the app (behind club login) instead of the public ChatGPT URL, which she wants to stop sharing — access only for product users.
- Approach when built: can't embed a custom GPT directly; re-implement as in-app chat with her curriculum docs as the knowledge base (RAG or system-prompt docs) using the OpenAI API key that prod will get for the screenshot reader.
