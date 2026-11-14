// Development-only permission regression checks. No live writes or email sends.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
const { Pool } = createRequire(import.meta.resolve("@workspace/db"))("pg");
if (!process.env.DEV_DATABASE_URL || process.env.NODE_ENV === "production") throw new Error("Development workspace only");
const pool = new Pool({ connectionString: process.env.DEV_DATABASE_URL });
const fixturePath = "generated-artifacts/tests/season-access-browser.json";
const hash = password => {
  const salt = crypto.randomBytes(16);
  return `scrypt:${salt.toString("base64url")}:${crypto.scryptSync(password, salt, 64).toString("base64url")}`;
};
const token = id => {
  const payload = `${Date.now() + 3600000}.${id}`;
  return `${payload}.${crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url")}`;
};
const api = async (cookie, path, method = "GET", data) => {
  const response = await fetch(`http://localhost:80/api${path}`, { method,
    headers: { "Content-Type": "application/json", "User-Agent": "internal-season-access-test", Cookie: `bufc_session=${cookie}` },
    ...(data ? { body: JSON.stringify(data) } : {}) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
if (process.argv.includes("--cleanup-browser-fixture")) {
  const f = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  try {
    for (const u of [f.admin, f.target]) await pool.query("DELETE FROM users WHERE id=$1 AND email=$2", [u.id, u.email]);
    await fs.unlink(fixturePath);
    console.log("Removed only the temporary browser-test accounts and credential fixture.");
  } finally { await pool.end(); }
} else {
  const users = [];
  let kept = false;
  try {
    const { rows: [league] } = await pool.query("SELECT id FROM leagues WHERE name='ACT NPLM'");
    const { rows: campaigns } = await pool.query("SELECT id,year FROM seasons WHERE league_id=$1", [league.id]);
    const year2027 = campaigns.find(s => s.year === "2027"), year2026 = campaigns.find(s => s.year === "2026");
    assert(year2026 && year2027, "Requires both existing NPLM campaigns; never creates or changes campaigns");
    const suffix = crypto.randomUUID();
    const password = crypto.randomBytes(24).toString("base64url");
    const { rows: [admin] } = await pool.query(
      "INSERT INTO users(email,name,password_hash,is_superadmin) VALUES($1,'Internal access UI test',$2,true) RETURNING id,email",
      [`access_admin_${suffix}@example.invalid`, hash(password)]);
    users.push(admin.id);
    const adminCookie = token(admin.id);
    const targetEmail = `access_target_${suffix}@example.invalid`;
    const initialGrant = { leagueId: league.id, role: "viewer", modules: ["gps"], seasonModules: { "2027": ["gps"] } };
    const created = await api(adminCookie, "/auth/users", "POST", {
      email: targetEmail, name: "Internal campaign access test", password, isSuperadmin: false, leagues: [initialGrant],
    });
    assert.equal(created.status, 201);
    const target = { id: created.body.id, email: targetEmail };
    users.push(target.id);
    const viewer = token(target.id);
    assert.deepEqual(created.body.leagues[0].seasonModules, initialGrant.seasonModules);
    const visible = await api(viewer, "/seasons");
    assert.equal(visible.status, 200);
    assert(visible.body.some(s => s.id === year2027.id));
    assert(visible.body.every(s => s.leagueId === league.id && s.year === "2027"));
    for (const path of [
      `/gps-training?leagueId=${league.id}&year=2027`, `/gps-sessions?leagueId=${league.id}&year=2027`,
      `/gps-development?leagueId=${league.id}&year=2027`, `/matches?seasonId=${year2027.id}`,
    ]) assert.equal((await api(viewer, path)).status, 200, path);
    for (const path of [
      `/gps-training?leagueId=${league.id}&year=2026`, `/gps-training?leagueId=${league.id}&year=2028`,
      `/gps-training?leagueId=${league.id}`, `/gps-sessions?leagueId=${league.id}&year=2026`,
      `/matches?seasonId=${year2026.id}`, `/matches?leagueId=${league.id}&year=2027`,
      `/match-prep/reports?leagueId=${league.id}&year=2027`, `/gps-match-reports?leagueId=${league.id}&year=2027`,
      `/match-reports?leagueId=${league.id}&year=2027`, `/journal/cycles?leagueId=${league.id}&year=2027`,
    ]) assert.equal((await api(viewer, path)).status, 403, path);
    const development = await api(viewer, `/gps-development?leagueId=${league.id}&year=2027`);
    assert(development.body.years.every(y => y === "2027"));
    const { rows: [foreign] } = await pool.query("SELECT id FROM matches WHERE season_id <> $1 LIMIT 1", [year2027.id]);
    if (foreign) assert.equal((await api(viewer, `/matches/${foreign.id}?seasonId=${year2027.id}`)).status, 403, "A query parameter cannot relabel a row's campaign");
    const mixed = { "2026": ["season-stats", "data-entry"], "2027": ["gps", "testing"] };
    assert.equal((await api(adminCookie, `/auth/users/${target.id}`, "PATCH", {
      leagues: [{ ...initialGrant, seasonModules: mixed }],
    })).status, 200);
    const athletic = await api(viewer, `/athletic-tests?leagueId=${league.id}`);
    assert.equal(athletic.status, 200, "Testing can discover years through a server-filtered list");
    assert(athletic.body.every(r => r.year === "2027"), "A yearless list must not leak other campaigns");
    assert.equal((await api(viewer, `/athletic-tests?leagueId=${league.id}&year=2026`)).status, 403);
    assert.equal((await api(viewer, `/gps-training?leagueId=${league.id}&year=2026`)).status, 403, "GPS is not granted in 2026");
    assert.equal((await api(viewer, "/entry/gps-training/preview", "POST", { leagueId: league.id, year: "2027", csv: "invalid", sourceFilename: "test.csv" })).status, 403,
      "Data Entry in 2026 does not grant training writes in 2027");
    assert.equal((await api(adminCookie, `/auth/users/${target.id}`, "PATCH", {
      name: "Must not be applied", leagues: [{ ...initialGrant, seasonModules: { "9999": ["gps"] } }],
    })).status, 400);
    const unchanged = await api(viewer, "/auth/me");
    assert.notEqual(unchanged.body.user.name, "Must not be applied");
    assert.deepEqual(unchanged.body.user.leagues[0].seasonModules, mixed);
    const { seasonModules: _ignored, ...oldClientGrant } = initialGrant;
    assert.equal((await api(adminCookie, `/auth/users/${target.id}`, "PATCH", { leagues: [oldClientGrant] })).status, 200);
    assert.deepEqual((await api(viewer, "/auth/me")).body.user.leagues[0].seasonModules, mixed, "An older client must not broaden an existing restricted grant");
    assert.equal((await api(adminCookie, `/auth/users/${target.id}`, "PATCH", {
      leagues: [initialGrant, initialGrant],
    })).status, 400);
    // Leave a legacy all-seasons test target only when a browser run is requested.
    assert.equal((await api(adminCookie, `/auth/users/${target.id}`, "PATCH", {
      leagues: [{ ...initialGrant, seasonModules: null }],
    })).status, 200);
    assert.equal((await api(viewer, `/gps-sessions?leagueId=${league.id}&year=2026`)).status, 200, "Existing all-seasons accounts keep access");
    if (process.argv.includes("--keep-browser-fixture")) {
      await fs.mkdir("generated-artifacts/tests", { recursive: true });
      await fs.writeFile(fixturePath, JSON.stringify({ admin: { ...admin, password }, target, leagueId: league.id,
        season2026: year2026.id, season2027: year2027.id }), { mode: 0o600 });
      kept = true;
    }
    console.log("Passed campaign access, module separation, forged-scope, safe update and legacy compatibility API checks.");
    if (kept) console.log("Temporary browser-test fixture is ready in the ignored tests directory.");
  } finally {
    if (!kept) for (const id of users.reverse()) await pool.query("DELETE FROM users WHERE id=$1", [id]);
    await pool.end();
  }
}
