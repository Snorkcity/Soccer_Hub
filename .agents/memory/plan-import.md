---
name: Old session-plan import
description: Pipeline importing 328 historical .docx session plans into practice_variations + new picture practices
---

Pipeline (tools/plan-import/): `parse_docx.py /tmp/oldplans /tmp/parsed` (block-based: image + heading + 2 tables per drill; heading variants map to parts, missing headings fall back to positional order warmup/introduction/main/endgame) → `import.mjs <files|--all>` (signature via gpt-5.4-mini, colour-agnostic shortlist top-10, gpt-5.4 rerank + strict pairwise confirm, unmatched → new picture practice in chapter "From old plans" with diagram `{img: dataURI}`; typo cleanup preserves coach voice; idempotent per source file).

**Key lessons:**
- Signature colour/dot comparisons are unreliable across renderers — compare sorted group sizes, totals and desc-token overlap, never colours/background.
- Some images still miss recall (grid counted as pitch vs dots); `/tmp/import-overrides.json` maps image-sha → practiceId (dynamic warmup sha 39d18105b5a57086 → practice 30).
- State cache `/tmp/import-state.json`: `sig:<sha>` entries survive decision resets; decision entries keyed by sha (first 16 hex of sha256).
- Old template ghost text ("Team:\nPlayer:", "Warmup" in intensity) must be stripped in the parser, not the cleaner.
- Duplicate "Copy" docx files exist — exclude with `grep -v Copy` for the full run.
- Drizzle sql`` subquery for per-row count silently returned 0 in this stack; use a separate grouped count query merged in JS.

**How to apply:** full run = `node import.mjs --all` (after coach approval); UI = VariationPicker in SessionEditor appears when picked practice has variationCount>0; badge "N past write-ups" in PracticePicker.
