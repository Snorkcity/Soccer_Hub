---
name: Shared position→unit mapping
description: Where the canonical position-code→unit mapping lives and how unit analytics resolve a player's unit
---

- The canonical position-code (GK/LB/CM/…) → unit (GK/Defender/Midfielder/Forward) mapping is a hand-written module in `@workspace/api-zod` (`positionUnits.ts`, exported from the package index). It sits beside the orval-generated files because api-zod is the only workspace package BOTH the api-server and the web app depend on. Orval's `clean: true` only wipes the `generated/` dir, so hand-written siblings are safe.
- **How to apply:** anything needing units (server analytics, Data Entry, future charts) imports `POSITION_CODES` / `unitForPosition` / `asUnit` from `@workspace/api-zod` — never redeclare the map locally.
- Unit resolution rule (unit-breakdown analytics + Data Entry display): prefer the per-game position code on the stat row; fall back to the assigned GPS position (gps_player_positions, stored as unit names already); else "Unassigned". Name matching between short stat names and fuller GPS names is whole-word based.
- Goal/assist unit credit uses the unit the player occupied in THAT match (per match+playerName), not their season role.
