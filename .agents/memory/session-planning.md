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

## Status — AI generation (Jul 2026)
- **Form slice DONE:** "Generate with AI" on Sessions page (admin only) → POST /sessions/generate. Practices (Warmup/Activations/Main Part/End Games chapters) embedded on boot (jsonb col on practices, direct OPENAI_API_KEY needed); theme embedded → top-k candidates per chapter → one LLM JSON call picks intro/main/endgame + writes part text fields; ids validated against candidate pools with fallback; warmup = lowest-ordinal Warmup slide; activation slot left empty (passing-activation pool comes later from coach uploads).
- **Diagram Review tool DONE:** /library/review (admin) — drag-a-box crop stored as review_crop jsonb (canvas coords, applied via SVG viewBox everywhere incl. session print), part pills (warmup/introduction/main/endgame/unusable) + coach's sub-category tags (Activations A1–A8, Main Part MP1–MP11, End Games small/medium/big). Generator: unusable never picked, tagged practices locked to their part, unreviewed still eligible; tags shown to the LLM and outrank wording. syncPracticeLibrary ON CONFLICT does NOT touch review columns — reviews survive re-seeds.
- Next slices: chat-side generation in the Coach Assistant (coach chose BOTH form and chat); paste-in new diagrams as image practices with tags (coach requested).

## Status
- Slice 1 (Import & Library) DONE — see practice-library.md.
- Slice 2 (Session Builder + print) DONE Jul 2026: /sessions list + editor + /sessions/:id/print (browser print = PDF export, A4 landscape, 2 pages matching her format; print route renders OUTSIDE the app Shell). Parts stored one row per part (unique session_id+part), part slot = practiceId + 9 free-text fields; squad list is free text "num | pos | name | note" per line (later: pull from player data). PUT part is a partial upsert — only provided keys update.
- Editor draft lesson: per-section drafts must (a) re-sync from server whenever not dirty, and (b) picking a practice while text is dirty must save the dirty text together with practiceId — otherwise edits are silently lost. Both handled; keep this invariant in slice 3.
- Pitch-layout diagram on print p2 deferred; ~102 untitled "Variation" slides grouping deferred.

## Development phases & AI scope (coach, Jul 2026)
- The 5 years of uploaded sessions + curriculum are ALL senior / 16+ phase. The two earlier learning phases focus differently: phase 1 = individual skill development; middle phase = intro to collective play (3v3, 4v4 small formats).
- **How to apply:** AI session generation should target senior/16+ first — that's the data we have, and senior coaches are the expected first customers. Don't let it fake younger-phase sessions from senior material; earlier phases need their own curriculum content later.

## AI session assembly recipe (coach, Jul 2026)
- **Gold standard:** the 2025 and 2026 seasons' sessions.
- Coaching messages run consistently from Introduction → Main part (same theme thread).
- Generated session must contain:
  1. **Dynamic warmup** — the standard warmup image with cones and players (fixed, reused).
  2. **Passing activation** — cycled from a pool coach will grow to ~10–12; does NOT need to match the session's coaching messages.
  3. **Introduction (technical activation)** — the coaching-messages box under the diagram doubles as TAGS for what's being trained; the rules box can be matched/aligned to a library session the assistant knows.
  4. **Main part** — usually same messages as the Introduction; has rules (pairable with the ask), plus size etc. → enough data to generate a diagram or match the uploaded plan's diagram.
  5. **End game** — ask the coach whether it's a small/medium/big-game cycle (or "what's your plan/size for the big game"); a matching diagram likely already exists in the library.
- Matching strategy implied: use the rules + coaching-message text of intro/main practices as the pairing key against library practices, not just titles.
- **Mix and match intro/main:** the same main part need not always pair with its original intro — different intro setups share very similar messages with some mains; recombining over time adds variety. Match on message similarity, not on original session pairing.
- Passing activations: coach will upload separately when needed (added ~2 since the first pptx import).
- Auto-pairing agreed: agent does a first automated matching pass, coach reviews a tick/fix list — not manual from scratch.
- **Build scope agreed (Jul 2026):** start with 16+ / professional development phase (includes seniors). Tactical learning phase possible later — its coaching messages live in 'coach plan' docs, rules/shape/player numbers in 'session plan' docs. Technical (youngest) phase parked — skill practices won't fit current diagram style.

## Coach-assistant GPT (idea noted Jul 2026 — not started)
- Coach has a custom ChatGPT GPT: a complete football development curriculum (series of documents) used for the Belconnen female program; intended for every club that uses this product.
- Goal: interact with it INSIDE the app (behind club login) instead of the public ChatGPT URL, which she wants to stop sharing — access only for product users.
- Approach when built: can't embed a custom GPT directly; re-implement as in-app chat with her curriculum docs as the knowledge base (RAG or system-prompt docs) using the OpenAI API key that prod will get for the screenshot reader.
- Coach-assistant UX requirements (Jul 2026): must be as easy as the ChatGPT window for coaches to ASK, and as easy as ChatGPT's knowledge-file upload for coach to UPDATE the curriculum docs (he updates the backend regularly). Present options before building. Mobile-first: many coaches will use it on phones — phone UI must feel professional. Doc management: coach picked the admin upload-page option (drag in Word/PDF, list, replace/remove).
- Curriculum docs restyle-on-import (agreed Jul 2026): coach WANTS the docs restructured for easy AI reference during import. He already heavily rewrote them for his GPT (GPT "doesn't read documents like readings") — expect retrieval-oriented, non-prose formatting; further restyle with his sign-off. Answer-quality benchmark: compare against his custom GPT on his 2–3 example questions.
