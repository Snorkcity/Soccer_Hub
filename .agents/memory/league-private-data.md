---
name: League-private coaching data
description: League and club ownership rules for private coaching evidence in multi-club accounts.
---

**Rule:** private coaching records and AI evidence are isolated by both the authenticated club and league. Ownership is resolved by the server, never accepted on trust from the client.

**Why:** one league may contain accounts for several clubs. League-only checks can expose one club's coach-authored reflections, plans, reports, or physical-performance data to another club.

**How to apply:** verify ownership for collections and individual records, inherit server-resolved ownership for derived or synchronised data, and make cross-scope records appear absent rather than revealing that they exist. AI helpers must enforce the same boundary themselves instead of relying only on their caller.

League switching must never surface another league's private prep, reflection, GPS, or testing data.

**Coach-confirmed convention:** within a club's program, physical-performance data lives under the firsts league. Reserves coaches who need it receive access to that league rather than copying or moving the records.
