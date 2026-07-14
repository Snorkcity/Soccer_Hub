/**
 * One-off backfill: accel/decel zone counts (>3 m/s²) from the original GPS CSVs
 * into gps_sessions. Idempotent — safe to re-run. Match key mirrors the seed:
 * (year, player_name, session_date, split_name, round, session_title).
 *
 * Run: pnpm exec tsx lib/db/src/backfillAccelCounts.ts   (uses DEV_DATABASE_URL / DATABASE_URL via lib/db)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { sql } from "drizzle-orm";
import { db } from "./index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../../attached_assets");

const str = (v: string | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

async function main() {
  const gpsFiles = [
    { file: fs.readdirSync(root).find(f => f.startsWith("stats_2024")), year: "2024" },
    { file: fs.readdirSync(root).find(f => f.startsWith("stats_2025")), year: "2025" },
    { file: fs.readdirSync(root).find(f => f.startsWith("individual_stats")), year: "2026" },
  ];

  let totalUpdated = 0;
  for (const { file, year } of gpsFiles) {
    if (!file) { console.log(`No GPS file for ${year}, skipping`); continue; }
    const rows: Record<string, string>[] = parse(fs.readFileSync(path.join(root, file), "utf8"), {
      columns: true, skip_empty_lines: true,
    });

    const values = rows.map(row => ({
      playerName: str(row["Player Name"]) ?? "Unknown",
      sessionDate: str(row["Date"]),
      splitName: str(row["Split Name"]),
      round: str(row["Round"]),
      sessionTitle: str(row["Session Title"]),
      a34: str(row["Accelerations Zone Count: 3 - 4 m/s/s"]),
      a4: str(row["Accelerations Zone Count: > 4 m/s/s"]),
      d34: str(row["Deceleration Zone Count: 3 - 4 m/s/s"]),
      d4: str(row["Deceleration Zone Count: > 4 m/s/s"]),
    })).filter(v =>
      (v.a34 != null || v.a4 != null || v.d34 != null || v.d4 != null)
      // Rows with no date AND no round have no usable identity — a blank-key
      // tuple would match every other blank row and spray its values across them.
      && (v.sessionDate != null || v.round != null));

    const chunkSize = 300;
    let updated = 0;
    for (let i = 0; i < values.length; i += chunkSize) {
      const chunk = values.slice(i, i + chunkSize);
      const tuples = sql.join(
        chunk.map(v => sql`(${v.playerName}, ${v.sessionDate}, ${v.splitName}, ${v.round}, ${v.sessionTitle}, ${v.a34}::numeric, ${v.a4}::numeric, ${v.d34}::numeric, ${v.d4}::numeric)`),
        sql`, `,
      );
      const res = await db.execute(sql`
        UPDATE gps_sessions g SET
          accel_count_3_4 = v.a34,
          accel_count_over_4 = v.a4,
          decel_count_3_4 = v.d34,
          decel_count_over_4 = v.d4
        FROM (VALUES ${tuples}) AS v(player_name, session_date, split_name, round, session_title, a34, a4, d34, d4)
        WHERE g.year = ${year}
          AND g.player_name = v.player_name
          AND g.session_date IS NOT DISTINCT FROM v.session_date
          AND g.split_name IS NOT DISTINCT FROM v.split_name
          AND g.round IS NOT DISTINCT FROM v.round
          AND g.session_title IS NOT DISTINCT FROM v.session_title
      `);
      updated += res.rowCount ?? 0;
    }
    console.log(`${year}: ${values.length} CSV rows with counts → ${updated} DB rows updated`);
    totalUpdated += updated;
  }
  console.log(`Done. Total rows updated: ${totalUpdated}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
