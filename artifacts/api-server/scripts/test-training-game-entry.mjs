// Development-only API regression. Never imports the coach's real CSV.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const { Pool } = createRequire(import.meta.resolve("@workspace/db"))("pg");
if (!process.env.DEV_DATABASE_URL || process.env.NODE_ENV === "production") throw new Error("Development only");
const pool = new Pool({ connectionString: process.env.DEV_DATABASE_URL });
let userId;
const suffix = crypto.randomUUID();
const trainingRound = `TG20990101-test-${suffix}`;
const matchRound = `TEST-${suffix}`;
let leagueId, teamId;
try {
  const { rows: [season] } = await pool.query("SELECT s.league_id FROM seasons s JOIN leagues l ON l.id=s.league_id WHERE l.name='ACT NPLM' AND s.year='2027'");
  const { rows: [team] } = await pool.query("SELECT id FROM teams LIMIT 1");
  leagueId = season.league_id; teamId = team.id;
  const { rows: [user] } = await pool.query(
    "INSERT INTO users(email,name,password_hash,is_superadmin) VALUES($1,'GPS import test',$2,false) RETURNING id",
    [`gps_${suffix}@example.invalid`, crypto.randomBytes(32).toString("hex")]);
  userId = user.id;
  const payload = `${Date.now() + 600000}.${userId}`;
  const cookie = `${payload}.${crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url")}`;
  const grant = async modules => {
    await pool.query("DELETE FROM user_league_access WHERE user_id=$1", [userId]);
    await pool.query("INSERT INTO user_league_access(user_id,league_id,role,modules,season_modules) VALUES($1,$2,'admin',$3,$4)",
      [userId, leagueId, JSON.stringify(modules), JSON.stringify({ "2027": modules })]);
  };
  const save = data => fetch("http://localhost:80/api/entry/gps-sessions", {
    method: "POST", headers: { Cookie: `bufc_session=${cookie}`, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const half = { playerName: `Synthetic-${suffix}`, splitName: "1st.half", minsPlayed: 10, distanceKm: 1.3, topSpeedMs: 8, accelCount34: 7 };
  const data = { leagueId, teamId, year: "2027", round: trainingRound, gameType: "training-game", sessionDate: "01/01/2099",
    sessionTitle: "Synthetic training game", rows: [half, { ...half, splitName: "all", minsPlayed: 90, distanceKm: 9 }] };
  await grant(["data-entry", "gps"]);
  let response = await save(data);
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).saved, 2);
  let result = await pool.query("SELECT split_name,mins_played,distance_km,distance_per_min_mm FROM gps_sessions WHERE league_id=$1 AND round=$2", [leagueId, trainingRound]);
  assert.equal(result.rows.length, 2);
  for (const row of result.rows) {
    assert.equal(+row.mins_played, 10);
    assert.equal(+row.distance_km, 1.3);
    assert.equal(+row.distance_per_min_mm, 130);
  }
  response = await save({ ...data, rows: [{ ...half, splitName: "all" }] });
  assert.equal(response.status, 400);
  result = await pool.query("SELECT count(*) FROM gps_sessions WHERE league_id=$1 AND round=$2", [leagueId, trainingRound]);
  assert.equal(+result.rows[0].count, 2, "invalid replacement leaves saved data intact");
  response = await save(data);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).replaced, 2, "reimport replaces, never duplicates");
  assert.equal((await save({ ...data, round: "R1-1sts" })).status, 400);
  assert.equal((await save({ ...data, gameType: "match" })).status, 400);
  // Legacy match import must keep its supplied all/game values, not derive from halves.
  response = await save({ ...data, gameType: "match", round: matchRound });
  assert.equal(response.status, 200);
  result = await pool.query("SELECT distance_km FROM gps_sessions WHERE league_id=$1 AND round=$2 AND split_name='game'", [leagueId, matchRound]);
  assert.equal(+result.rows[0].distance_km, 9);
  await grant(["season-stats"]);
  assert.equal((await save(data)).status, 403);
  console.log("Passed training totals, actual minutes, campaign scope, safe replacement, reimport, unchanged match import and write-permission checks.");
} finally {
  if (leagueId) await pool.query("DELETE FROM gps_sessions WHERE league_id=$1 AND round=ANY($2)", [leagueId, [trainingRound, matchRound]]);
  if (userId) {
    await pool.query("DELETE FROM user_activity WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM user_league_access WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  }
  await pool.end();
}
