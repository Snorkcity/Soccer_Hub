// CLI Veo sync: runs the same sync + auto-link code as the /entry/veo-sync and
// /entry/veo-auto-link routes, against whatever DATABASE_URL is set — used for
// dev refreshes and (with PROD_DATABASE_URL) coach-approved prod pulls.
// Run per .agents/memory/esbuild-script-runner.md.
//
// usage: veo-sync-cli [leagueId ...]   (default: every league with a Veo slug)
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { syncVeoLeagueOnce, autoLinkVeoLeague } from "../src/routes/veo";

(async () => {
  let leagueIds = process.argv.slice(2).map(Number).filter(Number.isFinite);
  if (leagueIds.length === 0) {
    const rows = await db.execute(sql`SELECT id, name FROM leagues WHERE veo_team_slug IS NOT NULL ORDER BY id`);
    leagueIds = rows.rows.map((r) => Number((r as { id: number }).id));
    console.log("leagues with Veo mapping:", rows.rows);
  }
  for (const leagueId of leagueIds) {
    console.log(`\n── league ${leagueId} ──`);
    for (let pass = 1; pass <= 30; pass++) {
      const r = await syncVeoLeagueOnce(leagueId, 20);
      if ("error" in r) { console.log("ERROR:", r.error); break; }
      console.log(`pass ${pass}: total=${r.totalMatches} fetched=${r.fetched} remaining=${r.remaining} done=${r.done}`);
      if (r.done) break;
      if (r.fetched === 0 && r.remaining > 0 && pass > 3) {
        console.log("no progress — stopping (failed matches will retry on next run)");
        break;
      }
    }
    const link = await autoLinkVeoLeague(leagueId);
    console.log("auto-link:", link);
  }
  process.exit(0);
})();
