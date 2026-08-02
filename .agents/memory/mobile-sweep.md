---
name: Headless mobile overflow sweep
description: How to audit the whole authenticated site at phone width for horizontal overflow/overlap
---

# Headless mobile overflow sweep

The Screenshot tool can't log in, so authenticated mobile checks use puppeteer-core + nix chromium:

1. `installSystemDependencies(["chromium"])` + `pnpm add -w -D puppeteer-core`; launch with `executablePath: $(which chromium)`, `--no-sandbox`.
2. Log in via curl (`POST /api/auth/login`, superadmin email + ADMIN_PASSWORD secret) and pass the `bufc_session` cookie value to `page.setCookie`.
3. Viewport 390×844, visit every route, and evaluate: flag elements whose rect extends past `clientWidth`, **skipping** any element with a scrollable (`overflow-x auto/scroll`) or `overflow hidden` ancestor — `truncate` containers otherwise produce false positives (spans measure wide but are clipped with ellipsis, not overlapping).
4. Radix only mounts the active tab panel — click every `[role="tab"]` (re-query after each click; nested tab sets appear later) and re-measure per tab.
5. Full-page screenshots + `magick -crop 390x1600+0+N` crops for visual spot-checks of long pages.

**Why:** one-off DOM-measure sweep catches squeezes across all pages/tabs in minutes; docScrollW alone misses clipped-but-fine cases and flags truncation falsely.

**How to apply:** rerun after big UI additions; all TabsLists already use `h-auto flex-wrap` or `grid grid-cols-2 sm:grid-cols-4`; chart-card headers with side toggles should be `flex-col gap-2 sm:flex-row` so the description doesn't collapse to a sliver column.
