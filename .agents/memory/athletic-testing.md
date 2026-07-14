---
name: Athletic testing feature
description: Testing page (6 tabs) + trainer-xlsx upload in Data Entry; conventions for percentiles, positions, replace-semantics saves
---

## Data flow
- Trainer sends an xlsx each testing round (headers like "Player", "Vertical start", "Balsom (s)", "0-10 split", "Position"). Data Entry → Testing tab parses it **client-side** (dynamic `import("xlsx")`, tolerant header normalisation) and previews rows before saving.
- POST /entry/athletic-tests is **replace-semantics per year+teamId** (transactional delete+insert), so re-uploading a corrected sheet just works. Server skips "Averages" rows and 400s on duplicate player names (case-insensitive).
- playerId link is best-effort by exact lowercase name vs players table; charts key off playerName, not playerId.

## Conventions (be consistent with these)
- Rows named "Averages"/"Unknown" are excluded from all charts client-side (`isRealPlayer`).
- Percentile convention: 100 = best; ties count ("at least as good as X% of the rest"), joint-best all score 100.
- Positions in testing data are full words ("Defender", "Goalkeeper") — `getPosGroup` handles both words and codes (CB/DM/…). Don't regress to codes-only.
- Time metrics (Balsom, splits, 30m) are lower-is-better; improvement deltas are normalised so positive always = got better.
- Testing page fetches ALL years for the team once and filters client-side; year list is derived from data, never hardcoded.

## Coaching-notes feature
Player profile tab generates plain-language game notes from squad-percentile thresholds (top third = strength, bottom third = caution), using the coach's own football correlations: explosive 0-10 → trust in stop-start 1v1s; fast 20-30 → push ball past and outrun; high vertical → key set-piece areas; Balsom → tight-turning duels. Keep this coach voice if editing.

**Why:** the coach uses these outputs verbatim with players (Feedback Mode is intentionally anonymous — grey bars, no names, selected player green).
