// Proves the hosting approach: a designer page in an iframe, fed our data, seeked to exact times, offline.
//   node scripts/html-host-test.mjs [set/variant] [theme]
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "./lib/html-check.mjs";

const here = dirname(fileURLToPath(import.meta.url)), repo = join(here, "..");
const require = createRequire(join(repo, "apps/render/package.json"));
const { respond, TEMPLATE_ORIGIN } = await import(pathToFileURL(join(repo, "packages/html-templates/src/files.mjs")).href);
const { SETS, LEVELS } = await import(pathToFileURL(join(here, "lib/html-data.mjs")).href);
const [which = "steps/v2-card-deck", theme = "daylight-clean"] = process.argv.slice(2);
const [sid, variant] = which.split("/"), S = SETS[sid];
const data = S.make(4, LEVELS[1]);

const browser = await launch(require);
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const blocked = [];
await ctx.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith("about:") || url.startsWith("data:")) return route.continue();
  const r = respond(url);
  if (!r) { blocked.push(url); return route.abort(); }
  return route.fulfill({ status: r.status, contentType: r.type, body: r.body });
});
const page = await ctx.newPage();
await page.setContent(`<body style="margin:0;background:#000"><iframe id="f" width="1920" height="1080" style="border:0;display:block"></iframe></body>`);
await page.evaluate((src) => { document.getElementById("f").src = src; }, `${TEMPLATE_ORIGIN}/phase1/${S.dir}/${variant}.html?embed&paused&theme=${theme}#${encodeURIComponent(JSON.stringify({ key: S.key, data }))}`);
const frame = await (await page.waitForSelector("#f")).contentFrame();
await frame.waitForFunction(() => window.__tpl, null, { timeout: 15000 });
await frame.evaluate(() => window.__tpl.ready);
const info = await frame.evaluate(() => ({ duration: window.__tpl.duration(), starts: window.__tpl.starts(4, "normal"), font: getComputedStyle(document.body).fontFamily, fontsOk: document.fonts.check('700 40px "Inter"') }));
console.log("config key:", await frame.evaluate(() => window.__tpl.config.key), "| stage text:", JSON.stringify(await frame.evaluate(() => document.querySelector(".stage")?.innerText.replace(/\s+/g, " ").slice(0, 90))));
console.log("storage read:", JSON.stringify(await frame.evaluate((k) => (localStorage.getItem(k) || "null").slice(0, 80), S.key)));
console.log("duration", info.duration, "| starts", JSON.stringify(info.starts), "| Inter loaded:", info.fontsOk);

const sig = async (t) => { await frame.evaluate((x) => window.__tpl.seek(x), t); return createHash("md5").update(await page.screenshot()).digest("hex").slice(0, 10); };
const order = [0.5, 3, 6, 3, 0.5, info.duration * 0.97, 6];
const seen = new Map(), rows = [];
for (const t of order) { const h = await sig(t); rows.push(`t=${t.toFixed(2)} ${h}`); if (seen.has(t) && seen.get(t) !== h) rows.push(`  !! t=${t} differs from its first showing`); seen.set(t, seen.get(t) ?? h); }
console.log(rows.join("\n"));
const stable = [...seen.keys()].every((t) => order.filter((x) => x === t).every(async () => true));
await page.screenshot({ path: join(repo, "out/html-audit/host-test.png") });
console.log("requests refused (should be none):", blocked.length ? blocked.slice(0, 5) : "none");
await browser.close();
