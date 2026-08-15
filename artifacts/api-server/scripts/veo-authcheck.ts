import { veoApiGet, defaultVeoCreds } from "../src/lib/veo";
const creds = defaultVeoCreds();
if (!creds) throw new Error("no creds");
(async () => {
  try {
    const u = await veoApiGet<Record<string, unknown>>(creds, "/user/");
    console.log("AUTH OK — user keys:", Object.keys(u).join(","));
  } catch (e) {
    console.log("AUTH FAILED:", String(e).slice(0, 200));
  }
})();
