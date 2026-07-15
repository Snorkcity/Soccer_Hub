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

## Status
Waiting on the 500-slide file: it's a **.pptm** her upload form rejected — she's renaming to .pptx. Word template + 3 sample PDFs already in attached_assets.
