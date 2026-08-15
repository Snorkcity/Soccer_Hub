// Probe Veo's mes (match event service) API for pass/possession endpoints.
import { veoApiGet, defaultVeoCreds } from "../src/lib/veo";
const matchId = process.argv[2];
const creds = defaultVeoCreds();
if (!creds || !matchId) throw new Error("usage: probe-veo-mes <matchId>");
const paths = [
  "step-events", "match-events", "pass-strings", "passes", "pass-events",
  "possession", "possessions", "possession-location", "ball-possession",
  "field-tilt", "stats", "insights", "heatmap", "pass-location", "analytics",
  "tracking-stats", "team-stats", "ball-tracking", "pass-network",
].map((p) => `/../mes/v2/${matchId}/${p}`);
(async () => {
  for (const p of paths) {
    try {
      const r = await veoApiGet(creds, p);
      const s = JSON.stringify(r);
      console.log("OK ", p.replace(/^\/\.\.\/mes\/v2\/[^/]+\//, ""), s.length, s.slice(0, 400));
    } catch (e) {
      console.log("ERR", p.replace(/^\/\.\.\/mes\/v2\/[^/]+\//, ""), String(e).replace(/^Error: /, "").slice(0, 80));
    }
  }
})();
