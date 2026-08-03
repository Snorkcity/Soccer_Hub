// Goal DNA — "today's goals vs the season DNA" block, shared by the team
// Match Report and the Opponent Insights Scouting Report. Renders the
// per-goal rows (minute, scorer, category, badge) and the 2–3 sentence
// tactical read. Older saved reports won't have these fields — callers
// guard and fall back to the legacy matchLines rendering.
import { Sparkles, AlertTriangle, Compass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { MatchReportGoalDnaGoal } from "@workspace/api-client-react";

export function GoalDnaStoryBlock({ matchGoals, tacticalRead, scouting }: {
  matchGoals: MatchReportGoalDnaGoal[];
  tacticalRead: string[];
  scouting?: boolean;
}) {
  const badgeClass = (g: MatchReportGoalDnaGoal) => {
    const goodSide = scouting ? g.side === "conceded" : g.side === "scored";
    switch (g.badgeTone) {
      case "signature":
        return goodSide
          ? "border-green-500/40 bg-green-500/10 text-green-600"
          : "border-red-500/40 bg-red-500/10 text-red-500";
      case "rare":
        return "border-sky-500/40 bg-sky-500/10 text-sky-600";
      case "untyped":
        return "border-dashed text-muted-foreground";
      default:
        return "text-muted-foreground";
    }
  };
  return (
    <div className="space-y-3">
      {matchGoals.length > 0 && (
        <div className="rounded-md border border-border/60 divide-y divide-border/40">
          <p className="px-3 py-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
            {scouting ? "The goals in this game" : "Today's goals vs our season DNA"}
          </p>
          {matchGoals.map((g, i) => (
            <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 text-sm">
              <span className="w-9 shrink-0 font-mono text-muted-foreground">{g.minute != null ? `${g.minute}'` : "—"}</span>
              {/* Scouting flip: THEIR goal = threat (amber), their concession = our opening (green) */}
              {(scouting ? g.side === "conceded" : g.side === "scored")
                ? <Sparkles className="h-3.5 w-3.5 shrink-0 text-green-500" />
                : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
              <span className="font-medium">{g.scorer ?? (g.side === "scored" ? "Scored" : "Conceded")}</span>
              {g.category && (
                <span className="text-xs text-muted-foreground">
                  {g.category}
                  {g.timing && <> · {g.timing === "DT" ? "before they reset" : "vs a set defence"}</>}
                </span>
              )}
              {g.goalType && <span className="hidden sm:inline font-mono text-[10px] text-muted-foreground/70">{g.goalType}</span>}
              <Badge variant="outline" className={`ml-auto text-[10px] ${badgeClass(g)}`}>{g.badgeText}</Badge>
            </div>
          ))}
        </div>
      )}
      {tacticalRead.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
          <Compass className="h-4 w-4 mt-0.5 shrink-0 text-violet-500" />
          <span>{tacticalRead.join(" ")}</span>
        </div>
      )}
    </div>
  );
}
