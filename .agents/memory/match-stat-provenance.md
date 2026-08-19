---
name: Match-stat provenance
description: Rules for distinguishing official/manual match statistics from Veo backfills.
---

Each persisted possession, shots and passes value carries its own source: `official`, `veo`, or `unknown`.

**Why:** A match can have a mixture of coach-recorded facts and camera-derived estimates. Inferring the origin of older values is unsafe, while overwriting a coach's official entry during a Veo refresh silently damages the record.

**How to apply:** New manual values are official; Veo fills blank values and may refresh only Veo/unknown values. Migrate pre-existing values to unknown. Show the source beside every individual stat in assistant, live report, and exported report copy; derived values show the sources of their inputs.