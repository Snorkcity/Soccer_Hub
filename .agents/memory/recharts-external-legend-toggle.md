---
name: Recharts external-state legend toggle
description: Why interactive Recharts legends (click-to-hide series) must live outside <Legend>, not inside it.
---

# Recharts legend toggles driven by React state must be rendered OUTSIDE the chart

When a chart's legend toggles series visibility from external React state (e.g. a `hidden: Set<string>`), do NOT rely on Recharts `<Legend onClick>` or `<Legend content={fn}>`. Both were verified (via e2e) to NOT reliably re-render or fire when only external component state changes — the clicked item kept its styling and `aria-pressed`/state never flipped.

**Working pattern:** render the legend as a plain React element (a row of `<button>`s) outside the Recharts tree — e.g. in a card footer below the `<ResponsiveContainer>`. The buttons call the toggle setter directly. Segment visibility is then controlled by the `hide={hidden.has(key)}` prop on each `<Bar>`, which DOES react to prop changes and recomputes the stack.

**Why:** Recharts' Legend is internally memoized against chart data, so external-state-only changes don't propagate to a custom `content` render fn.

**How to apply:** any interactive/toggleable legend in this codebase (BUFC hub stacked-by-opponent charts, etc.) — keep the legend as normal JSX, keep `<Bar hide=...>` for the actual show/hide.
