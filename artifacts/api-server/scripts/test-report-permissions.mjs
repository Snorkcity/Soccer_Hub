// Development-only API checks; temporary account is removed even on failure.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const { Pool } = createRequire(import.meta.resolve("@workspace/db"))("pg");
if (!process.env.DEV_DATABASE_URL || process.env.NODE_ENV === "production") throw new Error("Development only");
const pool = new Pool({ connectionString: process.env.DEV_DATABASE_URL });
let userId;
try {
  const { rows: [season] } = await pool.query("SELECT id, league_id, year FROM seasons ORDER BY id LIMIT 1");
  const { rows: [other] } = await pool.query("SELECT id, year FROM seasons WHERE league_id=$1 AND year<>$2 LIMIT 1", [season.league_id, season.year]);
  const { rows: [team] } = await pool.query("SELECT id FROM teams ORDER BY id LIMIT 1");
  const { rows: [user] } = await pool.query(
    "INSERT INTO users (email,name,password_hash,is_superadmin) VALUES ($1,'Permission test',$2,false) RETURNING id",
    [`permission_${crypto.randomUUID()}@example.invalid`, crypto.randomBytes(32).toString("hex")]);
  userId = user.id;
  const payload = `${Date.now() + 600_000}.${userId}`;
  const cookie = `${payload}.${crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url")}`;
  const get = path => fetch(`http://localhost:80/api${path}`, { headers: { Cookie: `bufc_session=${cookie}` } });
  const grant = async (modules, restricted = false) => {
    await pool.query("DELETE FROM user_league_access WHERE user_id=$1", [userId]);
    await pool.query(
      "INSERT INTO user_league_access (user_id,league_id,role,modules,season_modules) VALUES ($1,$2,'viewer',$3,$4)",
      [userId, season.league_id, JSON.stringify(modules), restricted ? JSON.stringify({ [season.year]: modules }) : null]);
  };
  const report = id => `/analytics/season-report?teamId=${team.id}&seasonId=${id}`;
  const veo = `/veo/matches?leagueId=${season.league_id}&seasonId=${season.id}`;
  await grant(["season-stats"]);
  assert.equal((await get(report(season.id))).status, 403, "Stats alone cannot read Season Report");
  assert.equal((await get(veo)).status, 403, "Stats alone cannot read Veo");
  await grant(["season-report"], true);
  assert.equal((await get(report(season.id))).status, 200, "Report-only campaign grant works");
  if (other) assert.equal((await get(report(other.id))).status, 403, "Report grant cannot cross campaign");
  await grant(["veo"], true);
  assert.equal((await get(veo)).status, 200, "Veo-only campaign grant works");
  assert.equal((await get(report(season.id))).status, 403, "Veo does not grant Season Report");
  console.log("Passed independent Report/Veo API permission checks and campaign isolation");
} finally {
  if (userId) {
    await pool.query("DELETE FROM user_league_access WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  }
  await pool.end();
}
