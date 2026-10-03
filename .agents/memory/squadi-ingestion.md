---
name: Squadi source caveats
description: Public Squadi data access and completion-status pitfalls observed while investigating Northern NSW women's results.
---

Northern NSW ("NNSW") uses Squadi and is distinct from Football NSW ("NSW") on Dribl; do not treat the contained NSW acronym as the same federation. Check access per endpoint rather than treating the entire competition as public or private.

**Why:** The Northern NSW public division catalogue, fixtures and ladder were readable through web fetch, while shell requests returned an AWS load-balancer HTTP 403. Public-named goal-event and match-summary endpoints returned an explicit login requirement through web fetch.

**How to apply:** Distinguish a transport rejection from an authentication response. Do not assume publicly visible results grant access to detailed player records, and do not manufacture unavailable goal or lineup details.

Completed Squadi fixture entries are not necessarily played games. Exclude byes explicitly, and examine result status as well as match status.

**Why:** The public feed includes Bye fixtures with ENDED status and 0–0 scores. Genuine completed matches can also have matchEnded=false despite matchStatus=ENDED and resultStatus=FINAL.

**How to apply:** Validate participating teams, published result status, finals flags and penalty-shootout fields before mapping fixtures into Hub matches or ladder calculations. Do not use matchEnded alone, and never count byes as draws.

For Northern NSW women's first grade, use Maitland FC as the league's default focus club.

**Why:** The user selected Maitland FC for this league.

**How to apply:** Keep this choice specific to Northern NSW first grade; it does not change the focus club for other leagues.

Cross-check Squadi finals flags against the published stage name; retain shootouts separately from match goals.

**Why:** In the reviewed 2026 Northern NSW feed, both semi-finals have isFinals=false despite the published Semi Finals stage. The Lake Macquarie–Broadmeadow semi-final is 1–1 with a 4–5 shootout, not a 5–6 match score. The published ladder totals for the top two clubs also include the grand-final result, unlike a regular-season-only table.

**How to apply:** Exclude all identified finals from the Hub ladder, not just fixtures flagged isFinals. Explain why a regular-season-only ladder may differ from Squadi's published totals. Keep native source IDs and shootout results in the reviewed import record.