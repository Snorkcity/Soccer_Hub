---
name: Recharts v2 radar radius-domain gotcha
description: PolarRadiusAxis `domain` is silently ignored when the axis renders no ticks; the shape mis-scales to a huge auto domain.
---

# Recharts v2 RadarChart — `domain` needs rendered ticks

In recharts v2 (`recharts@2.x`), a `<PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />`
is **silently ignored** — the radar auto-scales to a much larger domain, so a normalized
0–100 series collapses into a tiny blob near the centre while the `PolarGrid` polygon stays full size.

**Fix:** the radius axis must actually render ticks for the domain to take effect. Give it
`angle`, `tickCount`, and a visible `tick` object:

```tsx
<PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={5}
  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} />
```

**Why:** with `tick={false}` recharts treats the axis as inactive and falls back to auto-domain.
Symptom is deceptive — the data reaching `<Radar dataKey="value">` is correct (verified via a
temporary `console.log`), and there is no console warning; only the scale is wrong.

**How to apply:** any normalized radar (spokes as % of a max). Keep the ticks but style them muted —
they double as a "% of best" legend. `isAnimationActive={false}` also avoids a mount-time scale flicker.
