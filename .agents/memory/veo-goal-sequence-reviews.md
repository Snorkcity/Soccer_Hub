---
name: Veo goal-sequence reviews
description: Durable evidence and threshold rules for camera-derived goal sequence review.
---

Keep coach review evidence separate from both raw Veo observations and saved Hub goal details. A review records independent correct, incorrect, or unclear judgments for scorer, final passer, sequence length, and zone.

**Why:** one ambiguous field must not discard useful evidence from the other fields, and neither source should be rewritten merely to support model evaluation.

**How to apply:** calculate accuracy only from explicit reviews, exclude unclear judgments from the accuracy denominator, and change reconstruction thresholds only after the reviewed sample supports the change. Never auto-tune from unreviewed detections.