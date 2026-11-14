export type SpeedUnit = "km/h" | "m/s";

/** Analysis values stay in km/h; convert only at the presentation boundary. */
export function displaySpeed(value: number | null | undefined, unit: SpeedUnit): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return unit === "m/s" ? value / 3.6 : value;
}
