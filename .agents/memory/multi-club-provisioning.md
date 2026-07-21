---
name: Multi-club module provisioning
description: Future clubs get a subset of features; GPS + athletic testing are optional add-ons chosen at club creation
---

# Multi-club module provisioning

**Rule:** when the app is extended to other clubs, the GPS add-on and the athletic testing app are NOT part of the base offering — future clubs get only the other elements (match/goal analytics, etc.). Which modules a club has is decided ("provisioned") at club-creation time.

**Why:** coach stated this directly (July 2026): "future clubs that use this won't have the GPS add-on or testing app… we can work out what they are provisioned at creation when we get to that step."

**How to apply:** when building any multi-club/onboarding flow, include a per-club feature/module flag set at creation; gate GPS Insights and Athletic Testing UI + endpoints behind it. Belconnen keeps everything. Don't design GPS/testing features assuming they're universal.

**Branding:** each purchasing club gets its own hub name (e.g. "AFC Hub", "SUFC Hub") plus its own colour scheme; the radar-shield logo family (filled = app icon, outline = splash mark) stays constant across clubs, re-skinnable in colour. Set at provisioning: club short code drives app title, manifest name, and PWA icon colours.
