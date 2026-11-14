// Integration checks against the development DB only. No emails or live writes.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const { Pool } = createRequire(import.meta.resolve("@workspace/db"))("pg");

if (!process.env.DEV_DATABASE_URL || process.env.NODE_ENV === "production") {
  throw new Error("Run only in the development workspace with DEV_DATABASE_URL.");
}
const pool = new Pool({ connectionString: process.env.DEV_DATABASE_URL });
const prefix = `training_api_${crypto.randomUUID().slice(0, 8)}`;
const base = "http://localhost:80/api";
const fixture = await fs.readFile("attached_assets/20261109-T-N_1794634643570.csv", "utf8");
const token = id => {
  const payload = `${Date.now() + 3 * 3600000}.${id}`;
  return `${payload}.${crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url")}`;
};
const api = async (path, method = "GET", data, cookie) => {
  const result = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", "User-Agent": "training-internal-test",
      ...(cookie ? { Cookie: `bufc_session=${cookie}` } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const body = await result.json();
  return { status: result.status, body };
};
const users = [], sessions = [];
try {
  const { rows: [league] } = await pool.query("SELECT id,coalesce(focus_club,'Belconnen') AS club FROM leagues WHERE name='ACT NPLM'");
  const { rows: [admin] } = await pool.query("SELECT id FROM users WHERE is_superadmin=true ORDER BY id LIMIT 1");
  assert(league && admin);
  const adminCookie = token(admin.id);
  const { rows: [before] } = await pool.query("SELECT count(*)::int AS count,max(id) AS max_id FROM gps_sessions");
  const body = { leagueId: league.id, year: "2027", csv: fixture.replaceAll("20261109-NPLM-Training", prefix),
    sourceFilename: `${prefix}.csv` };
  const unsigned = await api(`/gps-training?leagueId=${league.id}&year=2027`);
  assert.equal(unsigned.status, 401);
  const preview = await api("/entry/gps-training/preview", "POST", body, adminCookie);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.session.rows.length, 120);
  assert.equal(preview.body.unmatchedNames.length, 0);
  assert.equal(preview.body.ambiguousNames.length, 0);
  assert.equal(preview.body.session.year, "2027");
  assert.equal(preview.body.session.date, "2026-11-09");
  const saved = await api("/entry/gps-training", "POST", body, adminCookie);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  sessions.push(saved.body.id);
  assert.equal(saved.body.version, 1);
  const again = await api("/entry/gps-training", "POST", body, adminCookie);
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(again.body.id, saved.body.id);
  assert.equal(again.body.version, 1, "identical files must be idempotent");
  const changed = { ...body, csv: body.csv.replace("3.2704", "3.2705") };
  assert.equal((await api("/entry/gps-training", "POST", changed, adminCookie)).status, 409);
  assert.equal((await api("/entry/gps-training", "POST", { ...changed, replace: true, expectedVersion: 99 }, adminCookie)).status, 409);
  const replaced = await api("/entry/gps-training", "POST", { ...changed, replace: true, expectedVersion: 1 }, adminCookie);
  assert.equal(replaced.status, 200);
  assert.equal(replaced.body.id, saved.body.id);
  assert.equal(replaced.body.version, 2);
  const plan = { leagueId: league.id, year: "2027", expectedVersion: 2, plannedMinutes: 90,
    scheduledStartTime: null, allowances: [{ part: "main", minMinutes: 20, maxMinutes: 25 }] };
  const planned = await api(`/entry/gps-training/${saved.body.id}/plan`, "PATCH", plan, adminCookie);
  assert.equal(planned.status, 200);
  assert.equal(planned.body.version, 3);
  assert.equal((await api(`/entry/gps-training/${saved.body.id}/plan`, "PATCH", plan, adminCookie)).status, 409);
  const preserved = await api("/entry/gps-training", "POST", { ...body, replace: true, expectedVersion: 3 }, adminCookie);
  assert.equal(preserved.status, 200);
  assert.equal(preserved.body.allowances[0].minMinutes, 20, "re-upload must preserve the coach plan");

  const createUser = async (modules, club = null) => {
    const { rows: [u] } = await pool.query(
      "INSERT INTO users(email,name,password_hash,is_superadmin) VALUES($1,$2,$3,false) RETURNING id",
      [`${prefix}_${users.length}@example.invalid`, "Internal training test", "!disabled-test-login"],
    );
    users.push(u.id);
    await pool.query("INSERT INTO user_league_access(user_id,league_id,role,modules,club) VALUES($1,$2,'viewer',$3::jsonb,$4)",
      [u.id, league.id, JSON.stringify(modules), club]);
    return token(u.id);
  };
  const viewer = await createUser(["gps"]);
  assert.equal((await api(`/gps-training?leagueId=${league.id}&year=2027`, "GET", null, viewer)).status, 200);
  assert.equal((await api("/entry/gps-training", "POST", body, viewer)).status, 403);
  const noGps = await createUser(["season-stats"]);
  assert.equal((await api(`/gps-training?leagueId=${league.id}&year=2027`, "GET", null, noGps)).status, 403);
  const { rows: [other] } = await pool.query("SELECT name FROM clubs WHERE league_id=$1 AND name<>$2 LIMIT 1", [league.id, league.club]);
  assert(other, "An existing other club is needed for isolation checks");
  const outsider = await createUser(["gps", "data-entry"], other.name);
  const hidden = await api(`/gps-training?leagueId=${league.id}&year=2027`, "GET", null, outsider);
  assert.equal(hidden.status, 200);
  assert(!hidden.body.some(s => s.id === saved.body.id), "another club must not see this private session");
  const badPatch = await api(`/entry/gps-training/${saved.body.id}/plan`, "PATCH", { ...plan, expectedVersion: 4 }, outsider);
  assert.equal(badPatch.status, 404, "cross-club session IDs must appear absent");
  const foreignMap = await api("/entry/gps-training/preview", "POST", {
    ...body, playerMappings: [{ sourceName: "J.Smith", rosterId: preview.body.session.rows[0].rosterId }],
  }, outsider);
  assert.equal(foreignMap.status, 400, "roster mapping must stay in this club's context");
  const { rows: [after] } = await pool.query("SELECT count(*)::int AS count,max(id) AS max_id FROM gps_sessions");
  assert.deepEqual(after, before, "training operations must not change match GPS");
  await fs.writeFile("/tmp/training-ui-cookie.json", JSON.stringify({ name: "bufc_session", value: adminCookie }), { mode: 0o600 });
  console.log("PASS: preview, exact roster matching, idempotency, explicit replacement, version conflicts, plan persistence, module permissions, club isolation and unchanged match GPS.");
} finally {
  if (sessions.length) await pool.query("DELETE FROM gps_training_sessions WHERE id=ANY($1::int[]) AND title=$2", [sessions, prefix]);
  if (users.length) await pool.query("DELETE FROM users WHERE id=ANY($1::int[])", [users]);
  await pool.end();
}
