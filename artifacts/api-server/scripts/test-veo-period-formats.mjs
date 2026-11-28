// Development-only API regression. Synthetic rows are removed in finally.
// CHECK_TABLET=1 also captures the three-period Match view at tablet width.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs/promises";

const root = path.resolve(import.meta.dirname, "../../..");
const require = createRequire(path.join(root, "lib/db/package.json"));
const { Client } = require("pg");
const db = new Client({ connectionString: process.env.DEV_DATABASE_URL });
const unique = `synthetic-periods-${crypto.randomUUID()}`;
let userId, matchId, recordingId, browser;
try {
  await db.connect();
  const { rows: [campaign] } = await db.query(
    "SELECT s.id,s.league_id FROM seasons s JOIN leagues l ON l.id=s.league_id WHERE l.name='ACT NPLM' AND s.year='2027' LIMIT 1",
  );
  assert.ok(campaign);
  const { rows: [team] } = await db.query("SELECT id FROM teams LIMIT 1");
  const { rows: [user] } = await db.query(
    "INSERT INTO users(email,name,password_hash,is_superadmin) VALUES($1,'Synthetic period format check',$2,true) RETURNING id",
    [`${unique}@example.invalid`, crypto.randomBytes(32).toString("hex")],
  );
  userId = user.id;
  const { rows: [match] } = await db.query(
    "INSERT INTO matches(match_id,opponent,team_id,season_id) VALUES($1,'Synthetic opponent',$2,$3) RETURNING id",
    [unique, team.id, campaign.id],
  );
  matchId = match.id;
  const { rows: [recording] } = await db.query(
    `INSERT INTO veo_matches(league_id,veo_match_id,title,opponent,match_id,starts_at,confirmed_source)
     VALUES($1,$2,'Synthetic three-period check','Synthetic opponent',$3,'2099-01-01T03:00:00Z',$4::jsonb) RETURNING id`,
    [campaign.league_id, unique, matchId, JSON.stringify({ campaignYear: "2027", clubSlug: "synthetic", teamSlug: "synthetic", teamId: "synthetic" })],
  );
  recordingId = recording.id;
  const payload = `${Date.now() + 600_000}.${userId}`;
  const session = `${payload}.${crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url")}`;
  const base = [
    ...Array.from({ length: 12 }, (_, i) => ({ period_id: 1, period_time_ms: (i + 1) * 60_000, event_type: "FootballShot", team: "Own" })),
    ...Array.from({ length: 12 }, (_, i) => ({ period_id: 2, period_time_ms: (i + 1) * 60_000, event_type: "FootballShot", team: "Opponent" })),
  ];
  for (const [durations, expectedMinutes] of [
    [[1800, 1826, 1165], 79.85],
    [[2820, 2880], 90],
    [[2820, 2880, 900, 900], 120],
  ]) {
    let recordingOffset = 14;
    const periods = durations.map(duration => {
      const timeframe = [recordingOffset, recordingOffset + duration];
      recordingOffset += duration + 500;
      return { duration, timeframe, own_side: "left" };
    });
    const events = [...base,
      { period_id: durations.length, period_time_ms: durations.at(-1) * 1000, event_type: "FootballGoal", team: "Own" },
      { period_id: durations.length, period_time_ms: 60_000, event_type: "FootballCornerKick", team: "Own" },
    ];
    await db.query("UPDATE veo_matches SET periods=$1::jsonb,events=$2::jsonb,has_events=true WHERE id=$3", [
      JSON.stringify(periods), JSON.stringify(events), recordingId,
    ]);
    const response = await fetch(`http://127.0.0.1:80/api/veo/report-stats?leagueId=${campaign.league_id}&matchRowId=${matchId}`, {
      headers: { cookie: `bufc_session=${session}` },
    });
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.matchMinutes, expectedMinutes);
    assert.deepEqual(report.periodMinutes, durations.map(s => s / 60));
    assert.deepEqual(report.shots, { us: 13, them: 12 });
    assert.equal(report.timeline.find(e => e.type === "goal").min, expectedMinutes);
    assert.equal(report.tilt.at(-1).min, expectedMinutes);
    if (durations.length === 3) {
      assert.equal(report.tiltHalfAt, null);
      assert.ok(report.findings.every(f => f.kind !== "halves"));
      if (process.env.CHECK_TABLET === "1") {
        const { default: puppeteer } = await import("puppeteer-core");
        browser = await puppeteer.launch({
          executablePath: "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium",
          headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
        });
        const page = await browser.newPage();
        const errors = [];
        page.on("pageerror", e => errors.push(e.message));
        await page.setViewport({ width: 768, height: 1024, isMobile: true, hasTouch: true });
        await page.setCookie({ name: "bufc_session", value: session, domain: "127.0.0.1", path: "/" });
        await page.evaluateOnNewDocument(c => {
          localStorage.setItem("bufc.activeLeagueId", String(c.league_id));
          localStorage.setItem("bufc.activeCampaignYear", "2027");
          localStorage.setItem("bufc.seasonByLeague", JSON.stringify({ [c.league_id]: c.id }));
        }, campaign);
        await page.goto("http://127.0.0.1:80/veo", { waitUntil: "networkidle2" });
        await page.waitForFunction(() => [...document.querySelectorAll("button")].some(b => b.textContent.trim() === "Match"));
        await page.evaluate(() => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Match")?.click());
        const note = await page.waitForSelector('[data-testid="veo-three-period-note"]');
        assert.match(await note.evaluate(e => e.textContent), /79:51 played/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        await note.evaluate(e => e.scrollIntoView({ block: "start" }));
        await fs.mkdir(path.join(root, "generated-artifacts/tablet"), { recursive: true });
        await page.screenshot({ path: path.join(root, "generated-artifacts/tablet/veo-three-periods.jpg") });
        assert.deepEqual(errors, []);
      }
    } else {
      assert.equal(report.tiltHalfAt, durations.length === 4 ? 45 : 47);
    }
    console.log(`${durations.length}-period report: totals, final event and ${expectedMinutes}-minute clock passed`);
  }
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser?.close();
  if (recordingId) await db.query("DELETE FROM veo_matches WHERE id=$1", [recordingId]);
  if (matchId) await db.query("DELETE FROM matches WHERE id=$1", [matchId]);
  if (userId) {
    await db.query("DELETE FROM user_activity WHERE user_id=$1", [userId]);
    await db.query("DELETE FROM user_league_access WHERE user_id=$1", [userId]);
    await db.query("DELETE FROM users WHERE id=$1", [userId]);
  }
  await db.end();
}
