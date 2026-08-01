---
name: GPS report PPTX styling
description: Player GPS season report deck — dark theme decision and pptxgenjs gotchas
---

- Coach chose a FULL DARK theme for the player GPS report deck (young players, on-screen viewing, "catchy"): deep-navy page bg, light text, sky/purple chart colours. Keep new report slides dark-themed.
  **Why:** explicit coach preference Aug 2026 after challenging white-on-white pages.
- Speeds show km/h with the m/s equivalent as a smaller grey rich-text run everywhere (tiles, insight bars, tables); charts get a right-hand m/s value axis.
- pptxgenjs secondary value axis needs a series assigned to it: add an invisible (background-coloured) flat line with `secondaryValAxis/secondaryCatAxis: true` plus `valAxes`/`catAxes` arrays, and pin both axis maxima (km/h max and ÷3.6) so scales align. Name that series `" "` (single space) — empty string makes PowerPoint show "Series4" in the legend.
- Visual verification recipe: esbuild-bundle a node test entry calling the generator (pptx.writeFile writes to cwd in node), then `soffice --headless --convert-to pdf` + `pdftoppm -png` and view the pages. Caught white table rows and the Series4 legend leak.
