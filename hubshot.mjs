import puppeteer from "puppeteer-core";

const CHROMIUM = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const WIDTH = Number(process.env.SHOT_W || 1440);
const HEIGHT = Number(process.env.SHOT_H || 1200);
const URL = process.env.SHOT_URL || "http://localhost:80/";
const OUT = process.env.SHOT_OUT || "screenshots/hub-frontdoor.png";

const res = await fetch("http://localhost:8080/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "scott@gameinsights.com.au", password: process.env.ADMIN_PASSWORD }),
});
const setCookie = res.headers.get("set-cookie");
if (!setCookie) throw new Error("login failed: " + res.status);
const [name, value] = setCookie.split(";")[0].split("=");

const browser = await puppeteer.launch({ executablePath: CHROMIUM, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT });
await page.setCookie({ name, value, domain: "localhost", path: "/" });
await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: OUT });
await browser.close();
console.log("done", OUT);
