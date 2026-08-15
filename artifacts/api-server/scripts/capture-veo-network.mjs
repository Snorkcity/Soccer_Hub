// One-off: drive a headless-browser login to app.veo.co, open a match page,
// and capture every network request the UI makes — hunting the endpoints that
// feed the "Pass strings" / "Possession location" / "Pass location" panels.
// Usage: node scripts/capture-veo-network.mjs <veoMatchId>
import puppeteer from "puppeteer-core";
import { execSync } from "node:child_process";
import fs from "node:fs";

const matchId = process.argv[2];
if (!matchId) throw new Error("usage: capture-veo-network <veoMatchId>");
const email = process.env.VEO_EMAIL;
const password = process.env.VEO_PASSWORD;
if (!email || !password) throw new Error("no VEO creds in env");

const chromium = execSync("which chromium").toString().trim();
const out = [];
const seen = new Set();

const browser = await puppeteer.launch({
  executablePath: chromium,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 2000 });

page.on("response", async (res) => {
  const url = res.url();
  if (!/veo\.co/.test(url)) return;
  if (/\.(js|css|png|jpe?g|svg|woff2?|ico|mp4|ts|m3u8|webp)(\?|$)/.test(url)) return;
  const key = res.request().method() + " " + url.split("?")[0];
  const entry = {
    method: res.request().method(),
    url,
    status: res.status(),
    postData: res.request().postData()?.slice(0, 2000),
  };
  try {
    const ct = res.headers()["content-type"] || "";
    if (/json/.test(ct)) {
      const body = await res.text();
      entry.body = body.length > 4000 ? body.slice(0, 4000) + `…(${body.length})` : body;
    }
  } catch {}
  out.push(entry);
  if (!seen.has(key)) {
    seen.add(key);
    console.log(entry.status, entry.method, url.slice(0, 180));
  }
});

console.log("→ open app.veo.co");
await page.goto("https://app.veo.co/", { waitUntil: "networkidle2", timeout: 60000 });

// If we land logged-out on app.veo.co, click the Login button to reach auth.veo.co.
if (!/auth\.veo\.co/.test(page.url())) {
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll("a,button")];
    const el = els.find((e) => /^(log ?in|sign ?in)$/i.test((e.textContent || "").trim()));
    if (el) { el.click(); return true; }
    return false;
  }).catch(() => "evaluate-raced-navigation");
  console.log("→ clicked login button:", clicked);
  await page.waitForFunction(() => /auth\.veo\.co/.test(location.href), { timeout: 30000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
}

// Login form (auth.veo.co login.html)
if (/auth\.veo\.co/.test(page.url())) {
  console.log("→ logging in at", page.url().split("?")[0]);
  await page.waitForSelector("input[name=username]", { timeout: 30000 });
  await page.type("input[name=username]", email);
  await page.type("input[name=password]", password);
  await Promise.all([
    page.keyboard.press("Enter"),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 }).catch(() => {}),
  ]);
  await new Promise((r) => setTimeout(r, 5000));
}
console.log("→ after login:", page.url());

console.log("→ open match page");
await page.goto(`https://app.veo.co/matches/${matchId}/`, { waitUntil: "networkidle2", timeout: 90000 }).catch((e) => console.log("nav err", String(e)));
await new Promise((r) => setTimeout(r, 8000));
console.log("→ landed:", page.url());

// Dismiss cookie banner if present.
await page.evaluate(() => {
  const el = [...document.querySelectorAll("button")].find((e) => /^continue$/i.test((e.textContent || "").trim()));
  if (el) el.click();
}).catch(() => {});
await new Promise((r) => setTimeout(r, 2000));

// Dump aria-labels / titles of icon buttons+links (tabs are often icon-only).
const icons = await page.evaluate(() =>
  [...document.querySelectorAll("[aria-label],[title],[data-testid]")]
    .map((e) => ({
      tag: e.tagName,
      aria: e.getAttribute("aria-label"),
      title: e.getAttribute("title"),
      tid: e.getAttribute("data-testid"),
      href: e.getAttribute("href"),
    }))
    .filter((x) => x.aria || x.title || x.tid)
);
console.log("ICONS:", JSON.stringify(icons).slice(0, 3000));

// Enumerate all clickable nav so we can see what tabs exist.
const nav = await page.evaluate(() =>
  [...document.querySelectorAll("a,button,[role=tab]")]
    .map((e) => ({ t: (e.textContent || "").trim().slice(0, 40), href: e.getAttribute("href") }))
    .filter((x) => x.t)
);
console.log("NAV:", JSON.stringify(nav));

// Find ANY element containing the panel names anywhere in the DOM, and click
// candidate tab/sidebar toggles that could reveal the stats sidebar.
const findPanels = () => page.evaluate(() => {
  const hits = [];
  for (const e of document.querySelectorAll("*")) {
    const t = (e.textContent || "").trim();
    if (e.children.length === 0 && /pass strings|possession location|pass location/i.test(t)) {
      hits.push({ tag: e.tagName, t: t.slice(0, 60) });
    }
  }
  return hits;
});
console.log("PANEL HITS (initial):", JSON.stringify(await findPanels()));

// Click every icon-ish button in the header/sidebar region and probe again.
const toggles = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll("button, [role=tab]").forEach((e, i) => {
    const label = e.getAttribute("aria-label") || (e.textContent || "").trim();
    if (/stat|analys|insight|event|list|menu|chart|graph/i.test(label) || label === "") out.push({ i, label: label.slice(0, 40) });
  });
  return out;
});
console.log("TOGGLES:", JSON.stringify(toggles).slice(0, 2000));
const prioritised = [
  ...toggles.filter((t) => /chart|stat|analys|graph|insight/i.test(t.label)),
  ...toggles.filter((t) => /list|event/i.test(t.label)),
];
for (const t of prioritised) {
  await page.evaluate((idx) => {
    const els = [...document.querySelectorAll("button, [role=tab]")];
    els[idx]?.click();
  }, t.i).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  const hits = await findPanels().catch(() => []);
  if (hits.length) {
    console.log(`→ PANELS APPEARED after clicking [${t.i}] "${t.label}":`, JSON.stringify(hits));
    // Expand each panel header to trigger its data fetch.
    await page.evaluate(() => {
      for (const e of document.querySelectorAll("*")) {
        const txt = (e.textContent || "").trim();
        if (/^(pass strings|possession location|pass location)$/i.test(txt)) e.closest("button,div")?.click();
      }
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 8000));
    break;
  }
}
// Scroll to force lazy panels.
await page.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 800) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 300));
  }
});
await new Promise((r) => setTimeout(r, 6000));

// Dump visible text so we can confirm the panels rendered.
const text = await page.evaluate(() => document.body.innerText.slice(0, 6000));
fs.writeFileSync("/tmp/veo-page-text.txt", text);
fs.writeFileSync("/tmp/veo-network.json", JSON.stringify(out, null, 2));
await page.screenshot({ path: "/tmp/veo-match.png", fullPage: false });
console.log(`→ captured ${out.length} responses → /tmp/veo-network.json; page text → /tmp/veo-page-text.txt`);
await browser.close();