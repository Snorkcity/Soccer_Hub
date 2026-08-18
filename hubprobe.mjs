import puppeteer from "puppeteer-core";

const CHROMIUM = "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
const W = Number(process.env.SHOT_W || 2560);
const H = Number(process.env.SHOT_H || 1400);

const res = await fetch("http://localhost:8080/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "scott@gameinsights.com.au", password: process.env.ADMIN_PASSWORD }),
});
const [name, value] = res.headers.get("set-cookie").split(";")[0].split("=");

const browser = await puppeteer.launch({ executablePath: CHROMIUM, args: ["--no-sandbox", `--window-size=${W},${H}`] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.setCookie({ name, value, domain: "localhost", path: "/" });
await page.goto("http://localhost:80/", { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 1500));
const info = await page.evaluate(() => {
  const svg = document.querySelector('#hub-hex')?.closest('svg');
  const wrap = svg?.parentElement;
  return {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    bodyH: document.body.scrollHeight,
    wrapClass: wrap?.className, wrapParentClass: wrap?.parentElement?.className, title: document.title, url: location.href, wrapRect: wrap ? wrap.getBoundingClientRect().toJSON() : null,
    svgRect: svg ? svg.getBoundingClientRect().toJSON() : null,
  };
});
console.log(JSON.stringify(info, null, 1)); await page.screenshot({ path: 'screenshots/hub-probe.png' });
await browser.close();
