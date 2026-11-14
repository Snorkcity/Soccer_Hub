import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import type { TrainingGpsRow, TrainingGpsSession, TrainingGpsPlayerMapping } from "@workspace/api-zod";
import { TRAINING_PARTS, trainingPlayerKey } from "@workspace/api-zod";

export interface TrainingRosterMember {
  id: number; playerName: string; squad: string; positionCode: string;
}
const key = (s: string) => s.trim().toLocaleLowerCase().replace(/[\s.]+/g, "");
const partMap: Record<string, TrainingGpsRow["part"]> = {
  all: "recording", game: "recording", warmup: "warmup", "warm-up": "warmup",
  "1stthird": "passing", passingactivation: "passing",
  "2ndthird": "technical", technicalactivation: "technical",
  "3rdthird": "main", mainpart: "main",
  split2: "end", endgame: "end", "end-game": "end", endpart: "end",
};
const numericFields: Record<string, string> = {
  sprintM: "Sprint Distance (m)", playerLoad: "Player Load", topSpeedMs: "Top Speed (m/s)",
  powerPlays: "Power Plays", maxAccel: "Max Acceleration (m/s/s)", maxDecel: "Max Deceleration (m/s/s)",
  accel01: "Accelerations Zone Count: 0 - 1 m/s/s",
  accel12: "Accelerations Zone Count: 1 - 2 m/s/s",
  accel23: "Accelerations Zone Count: 2 - 3 m/s/s",
  accel34: "Accelerations Zone Count: 3 - 4 m/s/s",
  accelOver4: "Accelerations Zone Count: > 4 m/s/s",
  decel01: "Deceleration Zone Count: 0 - 1 m/s/s",
  decel12: "Deceleration Zone Count: 1 - 2 m/s/s",
  decel23: "Deceleration Zone Count: 2 - 3 m/s/s",
  decel34: "Deceleration Zone Count: 3 - 4 m/s/s",
  decelOver4: "Deceleration Zone Count: > 4 m/s/s",
  hrLoad: "Hr Load", hrMax: "Hr Max (bpm)",
};

function numeric(value: string | undefined, label: string): number | null {
  if (value == null || !value.trim()) return null;
  const n = Number(value.trim());
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric value in ${label}.`);
  return n;
}

const origin = Date.UTC(1899, 11, 30);
function date(value: string): string {
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) {
    const serial = Number(v);
    if (serial < 36526 || serial > 109574) throw new Error("Session date is outside the supported range.");
    return new Date(origin + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
  }
  let iso = v;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (dmy) iso = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || !Number.isFinite(Date.parse(iso)) ||
      new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) {
    throw new Error("Use a valid Catapult date, ISO date or DD/MM/YYYY date.");
  }
  return iso;
}

function clock(value: string | undefined, sessionDate: string): number | null {
  if (!value?.trim()) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = Number(v), day = (Date.parse(`${sessionDate}T00:00:00Z`) - origin) / 86400000;
    const seconds = (n >= 1 ? n - day : n) * 86400;
    if (seconds < 0 || seconds > 172800) throw new Error("Split clock is outside the session date.");
    return seconds;
  }
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(v);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || Number(m[3] ?? 0) >= 60) {
    throw new Error("Invalid split start/end time.");
  }
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

export function parseTrainingCsv(
  csv: string,
  scope: { leagueId: number; year: string; sourceFilename?: string },
  roster: TrainingRosterMember[] = [],
  mappings: TrainingGpsPlayerMapping[] = [],
) {
  if (Buffer.byteLength(csv) > 5_000_000) throw new Error("Training CSV must be under5MB.");
  let records: Record<string, string>[];
  try {
    records = parse(csv, {
      bom: true, columns: (headers: string[]) => {
        const clean = headers.map(s => s.trim().replace(/\s+/g, " "));
        if (new Set(clean).size !== clean.length) throw new Error("Duplicate CSV column.");
        return clean;
      },
      skip_empty_lines: true, trim: true, max_record_size: 100000,
    });
  } catch {
    throw new Error("Could not read this CSV. Check its header, quoting and column counts.");
  }
  if (!records.length || records.length > 10000) throw new Error("CSV must contain1–10000 player/part rows.");
  for (const col of ["Date", "Session Title", "Player Name", "Split Name", "Duration"]) {
    if (!(col in records[0])) throw new Error(`Missing Catapult column: ${col}.`);
  }
  const rawDates = new Set(records.map(r => date(r.Date)));
  const titles = new Set(records.map(r => r["Session Title"].trim()));
  if (rawDates.size !== 1 || titles.size !== 1) throw new Error("Upload one training session per CSV (one date and title).");
  const sessionDate = [...rawDates][0], title = [...titles][0];
  if (!title || title.length > 300) throw new Error("A session title of1–300 characters is required.");
  const byName = new Map<string, TrainingRosterMember[]>();
  for (const member of roster) byName.set(key(member.playerName), [...(byName.get(key(member.playerName)) ?? []), member]);
  const mappingMap = new Map<string, number>();
  for (const mapping of mappings) {
    if (mappingMap.has(mapping.sourceName)) throw new Error("Choose only one roster mapping for each source name.");
    if (!records.some(r => r["Player Name"].trim() === mapping.sourceName)) throw new Error("A player mapping does not belong to this CSV.");
    if (!roster.some(r => r.id === mapping.rosterId)) throw new Error("A mapped player is not in this campaign's GPS roster.");
    mappingMap.set(mapping.sourceName, mapping.rosterId);
  }
  const unknown = new Set<string>(), ambiguous = new Set<string>();
  const warnings = new Set<string>([
    "Session totals include only the five selected parts. The untrimmed all recording is retained separately.",
    "HSM uses the Hub's existing Catapult >18 km/h sprint-distance definition; VHSM uses zone5 (>25 km/h). CSV zone boundaries are not declared; confirm the device profile if settings change. HSM includes VHSM—do not add them.",
    "Time in parts includes their breaks and coaching stoppages; it is not continuous moving time.",
  ]);
  const rows: TrainingGpsRow[] = records.map(r => {
    const sourceName = r["Player Name"].trim();
    if (!sourceName || sourceName.length > 120) throw new Error("Every row needs a valid player name.");
    const part = partMap[key(r["Split Name"])];
    if (!part) throw new Error(`Unsupported training part: ${r["Split Name"]}.`);
    const tags = r.Tags?.trim().toLowerCase();
    if (tags && !tags.split(/[,; ]+/).includes("training")) throw new Error("This CSV is not tagged as training. Use match GPS ingestion for match files.");
    const durationSeconds = numeric(r.Duration, "Duration");
    if (durationSeconds != null && (durationSeconds <= 0 || durationSeconds > 43200)) {
      throw new Error("Recorded participation must be positive and under12hours.");
    }
    const startSeconds = clock(r["Split Start Time"], sessionDate);
    const endSeconds = clock(r["Split End Time"], sessionDate);
    if (startSeconds != null && endSeconds != null && endSeconds <= startSeconds) throw new Error("A split ends before it starts.");
    if (durationSeconds != null && startSeconds != null && endSeconds != null && durationSeconds > endSeconds - startSeconds + 2) {
      throw new Error("Recorded participation exceeds the marked split length.");
    }
    let member: TrainingRosterMember | undefined;
    if (mappingMap.has(sourceName)) member = roster.find(x => x.id === mappingMap.get(sourceName));
    else {
      const matches = byName.get(key(sourceName)) ?? [];
      if (matches.length === 1) member = matches[0];
      else if (matches.length > 1) ambiguous.add(sourceName);
      else unknown.add(sourceName);
    }
    const metrics: Record<string, number | null> = {};
    for (const [metric, header] of Object.entries(numericFields)) {
      metrics[metric] = numeric(r[header.replace(/\s+/g, " ")], header);
      if (metric === "maxDecel" && metrics[metric] != null) metrics[metric] = Math.abs(metrics[metric]!);
      if (metrics[metric] != null && metrics[metric]! < 0) throw new Error(`Negative value in ${header}.`);
    }
    const km = numeric(r["Distance (km)"], "Distance (km)");
    if (km != null && km < 0) throw new Error("Distance cannot be negative.");
    metrics.distanceM = km == null ? null : km * 1000;
    for (let i = 1; i <= 5; i++) {
      const zone = numeric(r[`Distance in Speed Zone ${i} (km)`], `Speed zone${i}`);
      if (zone != null && zone < 0) throw new Error("Speed-zone distance cannot be negative.");
      metrics[`speedZone${i}M`] = zone == null ? null : zone * 1000;
    }
    metrics.hsmM = metrics.sprintM;
    metrics.vhsmM = metrics.speedZone5M;
    if (metrics.topSpeedMs != null && metrics.topSpeedMs > 15) {
      warnings.add("An implausible maximum speed (>54 km/h) was excluded from speed summaries; verify the source recording.");
      metrics.topSpeedMs = null;
    }
    return {
      playerName: member?.playerName ?? sourceName, sourceName, rosterId: member?.id ?? null,
      squad: member?.squad ?? null, positionCode: member?.positionCode ?? null,
      part, sourceSplit: r["Split Name"], startSeconds, endSeconds, durationSeconds, metrics,
    };
  });
  const seen = new Set<string>();
  for (const row of rows) {
    const pair = `${trainingPlayerKey(row)}:${row.part}`;
    if (seen.has(pair)) throw new Error(`Duplicate player/part after mapping: ${row.playerName}, ${row.sourceSplit}.`);
    seen.add(pair);
  }
  const people = [...new Set(rows.map(trainingPlayerKey))];
  for (const person of people) {
    const selected = rows.filter(r => trainingPlayerKey(r) === person && r.part !== "recording");
    if (!selected.length) throw new Error("Every player needs at least one selected training part.");
    const sorted = selected.filter(r => r.startSeconds != null && r.endSeconds != null)
      .sort((a, b) => a.startSeconds! - b.startSeconds!);
    if (sorted.some((r, i) => i > 0 && r.startSeconds! < sorted[i - 1].endSeconds! - .01)) {
      throw new Error("Selected parts overlap for a player; correct the Catapult cuts before importing.");
    }
    const missing = TRAINING_PARTS.filter(p => !selected.some(r => r.part === p.id));
    if (missing.length) warnings.add("Some players have missing parts. Their selected-part totals are partial, not complete sessions.");
  }
  if (rows.every(r => !r.metrics.hrLoad) && rows.every(r => (r.metrics.hrMax ?? 0) < 40)) {
    warnings.add("Heart-rate values are absent or implausible. No heart-rate conclusions are provided.");
  }
  if (unknown.size || ambiguous.size) warnings.add("Some source names need an explicit roster choice, or confirmation to keep them unassigned.");
  const session: TrainingGpsSession = {
    id: null, leagueId: scope.leagueId, year: scope.year, date: sessionDate, title,
    sourceFilename: (scope.sourceFilename ?? "Catapult training.csv").replace(/[\x00-\x1f]/g, "").slice(0, 200),
    sourceHash: createHash("sha256").update(csv.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim()).digest("hex"),
    version: 1, plannedMinutes: 90, scheduledStartTime: null, allowances: [], rows,
    warnings: [...warnings],
  };
  return { session, unmatchedNames: [...unknown], ambiguousNames: [...ambiguous] };
}
