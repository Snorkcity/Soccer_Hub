// Runs against the development preview only. No real recordings are imported.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const require = createRequire(path.join(root, "lib/db/package.json"));
const { Client } = require("pg");
const db = new Client({ connectionString: process.env.DEV_DATABASE_URL });
const syntheticId = `synthetic-veo-${crypto.randomUUID()}`;
let userId;
const output = path.join(root, "generated-artifacts/tests/veo-discovery-helper.mjs");
await build({
  entryPoints: [path.join(root, "artifacts/api-server/src/lib/veoDiscovery.ts")],
  outfile: output, bundle: true, platform: "node", format: "esm", logLevel: "silent",
});
const { signRecording } = await import(pathToFileURL(output).href);
try {
  await db.connect();
  const { rows: campaigns } = await db.query(
    "SELECT s.id,s.league_id,s.year FROM seasons s JOIN leagues l ON l.id=s.league_id WHERE l.name IN ('ACT NPLM','ACT NPLM U23') ORDER BY s.year DESC",
  );
  const target = campaigns.find(c => c.year === "2027");
  assert.ok(target, "A men's 2027 development campaign is needed");
  const { rows: [user] } = await db.query(
    "INSERT INTO users(email,name,password_hash,is_superadmin) VALUES($1,'Synthetic Veo API check',$2,true) RETURNING id",
    [`veo-check-${crypto.randomUUID()}@example.invalid`, crypto.randomBytes(32).toString("hex")],
  );
  userId = user.id;
  const payload = `${Date.now() + 600_000}.${userId}`;
  const cookie = `bufc_session=${payload}.${crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url")}`;
  async function request(endpoint, body, authenticated = true) {
    const response = await fetch(`http://127.0.0.1:80/api${endpoint}`, {
      method: body ? "POST" : "GET",
      headers: { ...(authenticated ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }
  const scope = { leagueId: target.league_id, seasonId: target.id };
  const value = {
    userId, ...scope, expiresAt: Date.now() + 600_000,
    recordingId: syntheticId, title: "Synthetic Veo confirmation check",
    startsAt: "2026-11-28T03:00:00Z",
    clubSlug: "synthetic-club", teamSlug: "synthetic-team", teamId: "synthetic-team-id",
  };
  const token = signRecording(value, process.env.SESSION_SECRET);
  assert.ok([401, 403].includes((await request("/entry/veo-import", { ...scope, token }, false)).status));
  assert.equal((await request("/entry/veo-import", { ...scope, token: `${token}tampered` })).status, 400);
  const wrongCampaign = campaigns.find(c => c.id !== target.id);
  if (wrongCampaign) assert.ok([400, 403].includes((await request("/entry/veo-import", { ...scope, seasonId: wrongCampaign.id, token })).status));
  const { rows: [foreignMatch] } = await db.query(
    "SELECT id FROM matches WHERE season_id <> $1 LIMIT 1", [target.id],
  );
  if (foreignMatch) assert.equal((await request("/entry/veo-import", { ...scope, token, matchId: foreignMatch.id })).status, 400);
  const first = await request("/entry/veo-import", { ...scope, token, matchId: null });
  assert.equal(first.status, 200);
  assert.ok(first.data.veoId);
  assert.equal((await request("/entry/veo-import", { ...scope, token })).status, 409);
  if (wrongCampaign) {
    const otherScope = { leagueId: wrongCampaign.league_id, seasonId: wrongCampaign.id };
    const otherToken = signRecording({ ...value, ...otherScope }, process.env.SESSION_SECRET);
    assert.equal((await request("/entry/veo-import", { ...otherScope, token: otherToken })).status, 409);
  }
  const { rows: [saved] } = await db.query(
    "SELECT league_id,match_id,confirmed_source FROM veo_matches WHERE veo_match_id=$1", [syntheticId],
  );
  assert.equal(saved.league_id, target.league_id);
  assert.equal(saved.match_id, null);
  assert.equal(saved.confirmed_source.campaignYear, "2027");
  assert.equal(saved.confirmed_source.teamId, value.teamId);
  const list = await request(`/veo/matches?leagueId=${target.league_id}`);
  assert.equal(list.status, 200);
  assert.equal(list.data.matches.find(r => r.veoMatchId === syntheticId)?.campaignYear, "2027");
  if (process.env.CHECK_LIVE_VEO_DISCOVERY === "1") {
    const discovered = await request("/entry/veo-discover", scope);
    assert.equal(discovered.status, 200);
    assert.equal(discovered.data.campaignYear, "2027");
    assert.ok(discovered.data.sourcesChecked.includes("moir"));
    console.log(JSON.stringify({
      checkedSources: discovered.data.sourcesChecked,
      recordingsAvailable: discovered.data.recordings.length,
      warnings: discovered.data.warnings,
      recentMoirRecordings: discovered.data.recordings.filter(r => r.source === "moir" && r.startsAt?.startsWith("2026-11-28")).length,
    }));
  }
  console.log("PASS: authentication, tamper/expiry scope, cross-campaign fixture rejection, no-fixture import, duplicates and persisted source/campaign.");
} finally {
  await db.query("DELETE FROM veo_matches WHERE veo_match_id=$1", [syntheticId]);
  if (userId) {
    await db.query("DELETE FROM user_activity WHERE user_id=$1", [userId]);
    await db.query("DELETE FROM user_league_access WHERE user_id=$1", [userId]);
    await db.query("DELETE FROM users WHERE id=$1", [userId]);
  }
  await db.end();
}
