export const GPS_POSITIONS = ["GK", "Defender", "Midfielder", "Forward"] as const;
export type GpsPosition = (typeof GPS_POSITIONS)[number];
export type GpsRole = "CB" | "FB" | "DM" | "AM" | "B2B" | "9" | "Winger";

export const GPS_POSITION_ROLES: Record<GpsPosition, readonly { value: GpsRole; label: string }[]> = {
  GK: [],
  Defender: [
    { value: "CB", label: "CB — Centre back" },
    { value: "FB", label: "FB — Full back" },
  ],
  Midfielder: [
    { value: "DM", label: "DM / 6" },
    { value: "B2B", label: "B2B / 8" },
    { value: "AM", label: "AM / 10" },
  ],
  Forward: [
    { value: "9", label: "9 — Striker" },
    { value: "Winger", label: "Winger" },
  ],
};

export function isGpsRoleForPosition(position: string | null | undefined, role: string): boolean {
  return GPS_POSITIONS.some(p => p === position && GPS_POSITION_ROLES[p].some(r => r.value === role));
}