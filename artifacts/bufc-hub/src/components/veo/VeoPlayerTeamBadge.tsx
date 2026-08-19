import type { VeoPlayerTeam } from "@workspace/api-client-react";

const TEAM_BADGE_STYLES: Record<VeoPlayerTeam["side"], string> = {
  own: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  opponent: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  unassigned: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

export function teamLabel(team: VeoPlayerTeam): string {
  if (team.side === "unassigned") return "Unassigned";
  return team.teamName || (team.side === "own" ? "Our team" : "Opponent");
}

export function VeoPlayerTeamBadge({
  team,
  compact = false,
}: {
  team: VeoPlayerTeam;
  compact?: boolean;
}) {
  const detail = team.attributionStatus === "official_squad"
    ? "Assigned by an exact shirt match in this match's official squads"
    : team.attributionStatus === "source"
      ? "Assigned by Veo's team evidence"
      : "No safe team assignment was available";

  return (
    <span
      title={detail}
      className={`inline-flex w-fit items-center rounded-full border font-semibold ${TEAM_BADGE_STYLES[team.side]} ${
        compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-1 text-[11px]"
      }`}
    >
      {teamLabel(team)}
    </span>
  );
}