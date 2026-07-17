---
name: Practice library (Session Planning slice 1)
description: How the 446-slide PowerPoint drill library is stored, served, and rendered in the app
---

- Source deck extracted offline by `tools/extract-practices/extract.py` (run with `/tmp/pdfenv/bin/python`; needs pillow) → JSON snapshot committed at `lib/db/src/data/practices.json`. Re-extractions must re-run the seed.
- `practices` table: one row per slide (446; 404 kind='practice'), created by idempotent startup migration. Seed = `lib/db/src/seedPractices.ts`, upsert by `ordinal`; **needs_review is deliberately never overwritten** so coach flags survive re-imports.
- No tsx runner in the workspace — run seeds by bundling with api-server's esbuild into `lib/db/.seedPractices.bundle.mjs` (pg external) then `node` it; /tmp won't resolve pg.
- API: GET `/library/practices` (kind defaults to `practice`; `kind=all` returns everything; chapter/sectionCode filters), PATCH `/library/practices/:id/flag`. Global session middleware already covers auth (reads any session, writes admin) — no per-route guards needed.
- Diagram JSON `{bg, canvas, shapes}` rendered client-side by `PracticeDiagram.tsx` (SVG). Gotchas encoded there: per-colour `<marker>` defs (SVG `context-stroke` unusable in Chrome), manual word-wrap for paragraphs (SVG text doesn't wrap), grid perf via `content-visibility:auto`.
- Untitled consecutive slides are variations of the previous practice; UI labels them "Variation (slide N)". ~102 of them — proper grouping/inherited titles is an open slice-2 question.
- Extractor gotchas fixed after v1: `slide_rels` needs the `ppt/` prefix on the .rels path (silently returned {} → every picture classified generic "image" squares); pie/chord/arc need avLst adj1/adj2 (÷60000 = degrees, 0°=3 o'clock clockwise, matches SVG y-down) or halves render as quarters; trapezoid slant = adj × **min(w,h)** (PowerPoint uses shortest side), not ×w — goals looked wrong otherwise. delta===0 sweep must render as a full ellipse (SVG arc with identical endpoints draws nothing).
- Orval gotcha (again): runtime zod schemas are named from operationIds (e.g. `ListLibraryPracticesResponse`), and custom schema names must not collide with those generated names or api-zod re-exports break.
- **Why:** slice 1 of the session-planning module; slices 2–4 (builder+PDF, canvas editor, AI assembly) will build on this table and renderer.
