import type { TrainingGpsSession } from "@workspace/api-client-react";
import { TRAINING_PARTS, trainingPlayerKey, trainingValue } from "@workspace/api-zod";
import { canRate, partRows } from "./shared";

/** Preserve the five practice parts; an absent measurement must never become zero. */
export function playerPartBreakdown(session: TrainingGpsSession | undefined, playerKey: string, metric: string, perMinute: boolean) {
  const pm = perMinute && canRate(metric);
  const rows = session ? partRows(session).filter(r => trainingPlayerKey(r) === playerKey) : [];
  const parts = TRAINING_PARTS.map(part => {
    const row = rows.find(r => r.part === part.id);
    return { ...part, value: row ? trainingValue(row, metric, pm) : null, duration: row?.durationSeconds ?? null };
  });
  const additive = !pm && metric !== "distancePerMinute" && (canRate(metric) || metric === "duration");
  const complete = parts.every(p => p.value != null);
  const total = additive && complete ? parts.reduce((sum, p) => sum + p.value!, 0) : null;
  const valid = parts.filter(p => p.value != null);
  const highest = valid.length ? Math.max(...valid.map(p => p.value!)) : null;
  return {
    parts: parts.map(p => ({ ...p, share: total != null && total > 0 && p.value != null ? p.value / total * 100 : null })),
    additive, complete, total,
    highestParts: highest != null ? valid.filter(p => p.value === highest) : [],
  };
}
