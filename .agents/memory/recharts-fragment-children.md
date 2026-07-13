---
name: Recharts Fragment children gotcha
description: Recharts does not discover Bar/Line/axis components wrapped in a React Fragment; they must be direct children of the chart.
---

Recharts (BarChart/LineChart/etc.) discovers its `<Bar>`, `<XAxis>`, `<YAxis>`, `<Tooltip>` children by scanning the chart's **direct** children. It does **not** recurse into a React Fragment (`<>...</>`).

If you wrap conditional `<Bar>`s in a Fragment — e.g. `{cond ? (<><Tooltip/><Bar/><Bar/></>) : (...)}` — Recharts never sees those Bars. Symptom: the axes/gridlines/x-axis category labels still render (they are direct children), but there are **no bars and the value axis shows no ticks** (empty [0,0] domain because no series was found to derive it from). No console error.

**Why:** Recharts iterates children with `React.Children`, which treats a Fragment as one opaque element and does not flatten it.

**How to apply:** Put `<Bar>`/axis/tooltip elements as direct children of the chart. Conditionals are fine as long as they resolve to a bare element, `null`/`false`, or an **array** (from `.map`) — all of which Recharts handles. Just never a Fragment. E.g. `{cond && <Bar dataKey="starts" .../>}` and `{!cond && <Bar dataKey="value" .../>}` instead of ternary-wrapped fragments.
