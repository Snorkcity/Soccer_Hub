export interface VeoPassGrid {
  type?: string;
  values?: number[];
}

export function countSuccessfulFrontThirdPasses(
  grid: VeoPassGrid | null | undefined,
): number | null {
  if (grid?.type !== "18_zone_system" || !Array.isArray(grid.values) || grid.values.length !== 18) return null;
  return grid.values.slice(12).reduce((sum, value) => sum + (Number(value) || 0), 0);
}