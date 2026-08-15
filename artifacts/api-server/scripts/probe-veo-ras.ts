// Probe Veo's RAS (recording analytics service) on cloudfront — the service the
// web UI's Pass strings / Possession location / Pass location panels load from.
// RAS_URL discovered in app.veo.co page bootstrap (window.VEO_SERVICE_URLS.RAS_URL).
import { veoFetchAbsolute, veoApiGet, defaultVeoCreds } from "../src/lib/veo";

const RAS = "https://dt3kfuz4eo879.cloudfront.net";
const matchId = process.argv[2];
const creds = defaultVeoCreds();
if (!creds || !matchId) throw new Error("usage: probe-veo-ras <matchId>");

(async () => {
  // periods → filters=start,end (video-time seconds) per period
  const periods = await veoApiGet<Array<{ timeframe: [number, number] }>>(creds, `/matches/${matchId}/periods/`);
  const filters = periods.map((p) => `filters=${p.timeframe[0]},${p.timeframe[1]}`).join("&");
  console.log("periods:", JSON.stringify(periods.map((p) => p.timeframe)));

  const urls = [
    `${RAS}/recordings/${matchId}/analytics`,
    `${RAS}/recordings/${matchId}/match-details?${filters}`,
    `${RAS}/recordings/${matchId}/match-details?${filters}&interactiveStrings=true`,
    `${RAS}/recordings/${matchId}/shot-details?${filters}`,
  ];
  for (const u of urls) {
    try {
      const r = await veoFetchAbsolute(creds, u);
      const text = await r.text();
      console.log("\n===", r.status, u.slice(RAS.length));
      console.log(text.length > 12000 ? text.slice(0, 12000) + `…(${text.length} chars)` : text);
    } catch (e) {
      console.log("\nERR", u.slice(RAS.length), String(e).slice(0, 150));
    }
  }
})();
