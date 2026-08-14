// One-off probe: does Veo expose pass-strings / possession-location data
// (visible in the coach's Veo web UI) via the internal API?
import { veoApiGet, defaultVeoCreds } from "../src/lib/veo";

const matchId = process.argv[2];
if (!matchId) throw new Error("usage: probe-veo-pass <veoMatchId>");
const creds = defaultVeoCreds();
if (!creds) throw new Error("no VEO creds");

const paths = [
  `/matches/${matchId}/pass-strings/`,
  `/matches/${matchId}/passes/`,
  `/matches/${matchId}/possession/`,
  `/matches/${matchId}/possession-location/`,
  `/matches/${matchId}/possessions/`,
  `/matches/${matchId}/analytics/`,
  `/matches/${matchId}/insights/`,
  `/matches/${matchId}/stats/?fields=all`,
  `/matches/${matchId}/advanced-stats/`,
  `/matches/${matchId}/heatmap/`,
  `/matches/${matchId}/zones/`,
];

(async () => {
  for (const p of paths) {
    try {
      const r = await veoApiGet(creds, p);
      const s = JSON.stringify(r);
      console.log("OK ", p, s.length > 600 ? s.slice(0, 600) + "…(" + s.length + " chars)" : s);
    } catch (e) {
      console.log("ERR", p, String(e).slice(0, 120));
    }
  }
})();
