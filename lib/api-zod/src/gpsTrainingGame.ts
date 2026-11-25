import { canonicalGpsSplit } from "./gps";

/** Reserved, non-fixture round code: keeps training games distinct from R#/cup fixtures. */
export function trainingGameRound(isoDate: string, squad: string): string {
  return `TG${isoDate.replaceAll("-", "")}-${squad}`;
}

export function isTrainingGameRound(round: string | null | undefined): boolean {
  return /^TG\d{8}-/i.test(round ?? "");
}

/** Source `all` is deliberately discarded; every whole-game value comes from the trimmed half. */
export function trainingGameRows<T extends {
  playerName: string;
  splitName?: string | null;
  minsPlayed?: number | null;
  distanceKm?: number | null;
  distancePerMinMm?: number | null;
}>(rows: readonly T[]): T[] {
  const players = new Map<string, T[]>();
  for (const row of rows) {
    const name = row.playerName.trim();
    if (!name) continue;
    const group = players.get(name) ?? [];
    group.push(row);
    players.set(name, group);
  }
  if (!players.size) throw new Error("No player rows to save");
  return [...players.entries()].flatMap(([playerName, group]) => {
    if (group.some(r => {
      const split = canonicalGpsSplit(r.splitName);
      return split !== "game" && split !== "1st.half";
    })) throw new Error(`${playerName}: training games accept only 1st.half and optional all/game rows`);
    const halves = group.filter(r => canonicalGpsSplit(r.splitName) === "1st.half");
    if (halves.length !== 1) throw new Error(`${playerName}: expected exactly one trimmed 1st.half row`);
    const half = halves[0];
    if (half.minsPlayed == null || !Number.isFinite(half.minsPlayed) || half.minsPlayed <= 0) {
      throw new Error(`${playerName}: the first half needs positive actual playing minutes`);
    }
    const trimmed = {
      ...half, playerName,
      // Recompute when distance is available, including a genuine zero.
      distancePerMinMm: half.distanceKm == null
        ? half.distancePerMinMm
        : half.distanceKm * 1000 / half.minsPlayed,
    };
    return [
      { ...trimmed, splitName: "game" },
      { ...trimmed, splitName: "1st.half" },
    ] as T[];
  });
}
