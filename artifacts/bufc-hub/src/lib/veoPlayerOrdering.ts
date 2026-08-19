export type VeoPlayerTeamSide = "own" | "opponent" | "unassigned";

const TEAM_SIDE_RANK: Record<VeoPlayerTeamSide, number> = {
  own: 0,
  opponent: 1,
  unassigned: 2,
};

/** Primary table ordering; callers retain their selected metric as the tiebreak. */
export function compareVeoPlayerTeamSide(
  a: { team: { side: VeoPlayerTeamSide } },
  b: { team: { side: VeoPlayerTeamSide } },
): number {
  return TEAM_SIDE_RANK[a.team.side] - TEAM_SIDE_RANK[b.team.side];
}