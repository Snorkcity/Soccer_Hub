// Development-only regression checks. Uses a synthetic account and roster row.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const { Pool } = createRequire(import.meta.resolve("@workspace/db"))("pg");
if (!process.env.DEV_DATABASE_URL || process.env.NODE_ENV === "production") throw new Error("Development only");
const pool = new Pool({ connectionString: process.env.DEV_DATABASE_URL });
let userId;
const created = [];
try {
  const { rows: [season] } = await pool.query(
    "SELECT s.id,s.league_id,s.year FROM seasons s JOIN leagues l ON l.id=s.league_id WHERE l.name='ACT NPLM' AND s.year='2027'");
  assert.ok(season, "A development NPLM 2027 campaign is needed");
  const { rows: [other] } = await pool.query("SELECT id FROM seasons WHERE id<>$1 LIMIT 1", [season.id]);
  const { rows: [user] } = await pool.query(
    "INSERT INTO users(email,name,password_hash,is_superadmin) VALUES($1,'Squad API test',$2,false) RETURNING id",
    [`squad_${crypto.randomUUID()}@example.invalid`, crypto.randomBytes(32).toString("hex")]);
  userId = user.id;
  const payload = `${Date.now() + 600_000}.${userId}`;
  const cookie = `${payload}.${crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url")}`;
  const call = (method, path, data) => fetch(`http://localhost:80/api${path}`, {
    method, headers: { Cookie: `bufc_session=${cookie}`, "Content-Type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const grant = async modules => {
    await pool.query("DELETE FROM user_league_access WHERE user_id=$1", [userId]);
    await pool.query(
      "INSERT INTO user_league_access(user_id,league_id,role,modules,season_modules) VALUES($1,$2,'viewer',$3,$4)",
      [userId, season.league_id, JSON.stringify(modules), JSON.stringify({ [season.year]: modules })]);
  };
  await grant(["data-entry"]);
  const data = { seasonId: season.id, playerName: `SquadTest-${crypto.randomUUID()}`, squad: "1sts", positionCode: "CB" };
  let response = await call("POST", "/entry/season-roster", data);
  assert.equal(response.status, 200, await response.clone().text());
  const { id } = await response.json(); created.push(id);
  response = await call("GET", `/season-roster?leagueId=${season.league_id}&year=${season.year}`);
  assert.equal(response.status, 200);
  assert.ok((await response.json()).some(r => r.id === id && r.playerName === data.playerName));
  assert.equal((await call("POST", "/entry/season-roster", { ...data, playerName: data.playerName.toLowerCase() })).status, 409);
  assert.equal((await call("POST", "/entry/season-roster", { ...data, id, positionCode: "FB" })).status, 200);
  if (other) {
    assert.equal((await call("POST", "/entry/season-roster", { ...data, id, seasonId: other.id })).status, 403);
    assert.equal((await call("DELETE", "/entry/season-roster", { id, seasonId: other.id })).status, 403);
  }
  await grant(["gps"]);
  assert.equal((await call("POST", "/entry/season-roster", { ...data, id })).status, 403);
  assert.equal((await call("DELETE", "/entry/season-roster", { id, seasonId: season.id })).status, 403);
  await grant(["data-entry"]);
  assert.equal((await call("DELETE", "/entry/season-roster", { id, seasonId: season.id })).status, 204);
  assert.equal((await call("DELETE", "/entry/season-roster", { id, seasonId: season.id })).status, 404);
  console.log("Passed squad add/edit/remove, duplicate-name protection, Data Entry-only access and campaign isolation.");
} finally {
  for (const id of created) await pool.query("DELETE FROM season_roster WHERE id=$1", [id]);
  if (userId) {
    await pool.query("DELETE FROM user_activity WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM user_league_access WHERE user_id=$1", [userId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
  }
  await pool.end();
}
