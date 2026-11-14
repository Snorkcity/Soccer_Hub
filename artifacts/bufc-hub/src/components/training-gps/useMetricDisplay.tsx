import { useState } from "react";
import { fmtMetric, metricUnit } from "./shared";
import { displaySpeed, type SpeedUnit } from "./speedDisplay";

/** Unit changes affect presentation only, never the source values, rankings or drill-down keys. */
export function useMetricDisplay(metric: string, pm: boolean) {
  const [speedUnit, setSpeedUnit] = useState<SpeedUnit>("km/h");
  const value = (v: number | null | undefined) => metric === "speed" ? displaySpeed(v, speedUnit) : v ?? null;
  const format = (v: number | null | undefined) => metric === "speed"
    ? v == null ? "—" : `${v.toFixed(1)} ${speedUnit}`
    : fmtMetric(metric, v, pm);
  const control = (
    <div role="group" aria-label="Top speed units" className="inline-flex rounded-md border border-input p-0.5">
      {(["km/h", "m/s"] as const).map(unit => (
        <button key={unit} type="button" aria-pressed={speedUnit === unit} onClick={() => setSpeedUnit(unit)}
          className={`min-h-8 rounded px-2 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${speedUnit === unit ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
          {unit}
        </button>
      ))}
    </div>
  );
  return { value, format, control, unit: metric === "speed" ? speedUnit : metricUnit(metric, pm) };
}
