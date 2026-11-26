---
name: Hub front-door full-bleed layout
description: How the Hub landing + group pages achieve edge-to-edge hex background inside Shell
---
Shell wraps every page in a centred `mx-auto max-w-7xl` box inside the scroll div. Hub pages (`/` and `/hub/:groupId`) are special-cased in Shell to get a `flex flex-1 flex-col` wrapper instead, and the page root uses `-m-4 md:-m-8 flex-1` so the hex SVG canvas stretches edge-to-edge and full height on any screen.

**Why:** percentage min-heights (`min-h-full`, `min-h-[calc(100%+...)]`) silently fail here — the intermediate wrapper isn't height-stretched, so the hex stopped partway down on tall/wide desktops. Only the flex chain (scroll div `flex flex-col` → wrapper `flex-1` → page `flex-1`) is reliable.

**How to apply:** any future full-bleed page must be added to Shell's full-bleed location check AND use `flex-1` + negative margins on its root. Shared Hub group config (pages, hrefs, descriptions, icons, gating fields, HexPattern, makePageVisible) lives in `src/lib/hubGroups.tsx` — gating must keep mirroring Shell's `itemVisible`.

## Analysis navigation scrolling scope

Keep the viewport-constrained scrolling behaviour for sticky analysis navigation scoped to GPS Insights and Season Stats unless broader layout changes are explicitly intended.

**Why:** a minimum-height-only shell can grow with the charts, leaving no internal scroll range for sticky navigation. Constraining every page at once would also alter unrelated editors and full-bleed Hub layouts.

**How to apply:** verify actual scrolling, not just initial screenshots. Chart jump controls must sit below the navigation's measured wrapped height on phones as well as desktops.
