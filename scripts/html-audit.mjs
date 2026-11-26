// Stress-tests the designer's HTML templates: every variant x data case x theme, sampled at several times, checking
// that text is not clipped, does not leave the frame and does not overlap other text.
//   node scripts/html-audit.mjs [--set steps] [--case long] [--theme daylight-clean] [--sheets out/html-audit] [--root <dir>]
// Prints a table (variant x case -> issues) and writes the details to <sheets>/report.json.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const ROOT = args.root ?? join(repo, "packages/html-templates/designer/phase1");
const OUT = args.sheets ?? join(repo, "out/html-audit");
const THEMES = (args.theme ?? "daylight-clean,aurora-night").split(",");
const TIMES = [3, 6, 9, 12, 16];
const require = createRequire(join(repo, "apps/render/package.json"));
const { chromium } = require("playwright-core");

// ── Data ────────────────────────────────────────────────────────────────────
const T = { short: "Validate token", mid: "The gateway validates the token", long: "Authentication tokens are validated against the identity provider first" };
const D = { short: "Checks the signature", mid: "It checks the signature and the expiry time of the token", long: "The gateway checks the signature, the expiry time and the audience claim, then forwards the request to the matching internal service over a private link" };
const icons = ["send", "search", "shield", "clock", "check", "user", "star", "key"];
const N = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const itemsOf = (n, t, d) => N(n, (i) => ({ title: n > 1 && t === "short" ? `${T.short} ${i + 1}` : t === "short" ? T.short : T[t], detail: D[d], icon: icons[i % icons.length] }));
const shell = (items, extra = {}) => ({ pace: "normal", motion: "default", order: "forward", kicker: "How it works", heading: "From request to response", items, ...extra });
const NUM = { short: "42", mid: "1,234", long: "1,234,567" };
const statItems = (n, t) => N(n, (i) => ({ label: t === "long" ? `Primary cluster in region ${i + 1} of the platform` : `Region ${i + 1}`, value: NUM[t], prefix: t === "long" ? "$" : "", suffix: t === "long" ? " req/s" : "k", delta: i ? String(10 + i) : "", deltaLabel: i ? "vs last" : "", icon: "user", highlight: i === n - 1 }));
const SETS = {
  steps: { dir: "process-steps-motion", key: "process-steps-data-v1", min: 2, max: 6, make: (n, t) => shell(itemsOf(n, t, t)) },
  comparison: { dir: "comparison-motion", key: "comparison-data-v1", min: 2, max: 6, make: (n, t) => shell([{ title: "Server sessions", detail: "Signed tokens" }, ...itemsOf(n - 1, t, t).map((x) => ({ title: x.detail, detail: x.detail, icon: x.icon }))]) },
  interaction: { dir: "interaction-motion", key: "interaction-kit-data-v1", min: 2, max: 6, make: (n, t) => shell(itemsOf(n, t, t)) },
  bar: { dir: "charts/bar", key: "chart-bar-v1", min: 2, max: 6, make: (n, t) => shell(N(n, (i) => ({ title: t === "long" ? `Product line number ${i + 1}` : `Q${i + 1}`, detail: `$${20 + i * 7}k` }))) },
  line: { dir: "charts/line", key: "chart-line-v1", min: 3, max: 6, make: (n, t) => shell(N(n, (i) => ({ title: t === "long" ? `Week ${i + 1} of the launch` : `W${i + 1}`, detail: `${12 + i * 5}k` }))) },
  donut: { dir: "charts/donut", key: "chart-donut-v1", min: 2, max: 5, make: (n, t) => shell(N(n, (i) => ({ title: t === "long" ? `Traffic from channel ${i + 1}` : `Ch ${i + 1}`, detail: `${40 - i * 6}%` }))) },
  stats: { dir: "stats-motion", key: "stats-data-v2", min: 2, max: 6, make: (n, t) => ({ pace: "normal", motion: "rise", order: "forward", kicker: "Load", heading: "Requests handled per second", items: statItems(n, t) }) },
  timeline: { dir: "timeline-component", key: "timeline-component-data-v1", min: 2, max: 8, make: (n, t) => ({ kicker: "History", heading: "A long history", pace: "normal", motion: "default", order: "forward", items: N(n, (i) => ({ date: String(2019 + i), title: T[t], detail: D[t], image: "" })) }) },
  titles: { dir: "titles", key: "titles-data-v1", min: 0, max: 0, make: (n, t) => ({ pace: "normal", bg: "auto", playout: false, kicker: t === "long" ? "Episode 01 · Distributed systems and storage" : "Episode 01", title: t === "long" ? "How consistent hashing keeps data in place when servers join or leave a very large cluster" : t === "mid" ? "How consistent hashing works" : "Hashing", subtitle: D[t], byline: "Dr. A. Rao · 2026", brand: "Tandemloop", icon: "shield" }) },
  transitions: { dir: "transitions", key: "transitions-data-v1", min: 0, max: 0, make: (n, t) => ({ pace: "normal", dir: "left", hold: 1.0, a: { title: T[t], subtitle: D[t], tint: "base" }, b: { title: T[t] + " again", subtitle: D[t], tint: "deep" } }) },
  text: { dir: "text-motion", key: "text-motion-data-v3", min: 1, max: 10, make: (n, t) => ({ wpm: 150, words: "narration", caps: "off", scheme: "auto", lines: N(n, (i) => ({ text: i % 3 === 2 ? (t === "long" ? "1,234,567" : "95%") : t === "long" ? D.long : T.mid, p: i % 3 === 2 ? 3 : i % 3 === 0 ? 1 : 2, cut: i === 5 })) }) },
};
const CASES = { min: (s) => [s.min || 1, "short"], nominal: (s) => [Math.max(s.min, Math.min(4, s.max || 4)), "mid"], long: (s) => [Math.max(s.min, Math.min(4, s.max || 4)), "long"], max: (s) => [s.max || 4, "mid"], "max-long": (s) => [s.max || 4, "long"] };

import { inPage } from "./lib/html-check.mjs";

// ── Run ──────────────────────────────────────────────────────────────────────
let browser;
for (const ch of ["chrome", "msedge"]) { try { browser = await chromium.launch({ channel: ch }); break; } catch { /* next */ } }
if (!browser) throw new Error("no Chrome or Edge found");
mkdirSync(OUT, { recursive: true });
const only = args.set?.split(","), onlyCase = args.case?.split(",");
const report = [], jobs = [];
const pool = async (list, size) => { let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < list.length) await list[i++](); })); };
for (const [sid, S] of Object.entries(SETS)) {
  if (only && !only.includes(sid)) continue;
  const dir = join(ROOT, S.dir);
  const files = readdirSync(dir).filter((f) => /^v\d+.*\.html$/.test(f)).sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)) || a.localeCompare(b));
  for (const f of files) for (const [cname, cf] of Object.entries(CASES)) {
    if (onlyCase && !onlyCase.includes(cname)) continue;
    if (!S.max && !["nominal", "long"].includes(cname)) continue;
    const [n, t] = cf(S);
    const data = S.make(n, t);
    for (const theme of THEMES) jobs.push(async () => {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
      await ctx.addInitScript(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [S.key, data]);
      if (args.adapt) await ctx.addInitScript({ path: join(repo, "packages/html-templates/adapt/adapt.js") });
      const page = await ctx.newPage(); const errs = [];
      page.on("pageerror", (e) => errs.push(String(e).slice(0, 100)));
      const seen = new Map();
      // Effects that clip or overlap on purpose: a rolling odometer, a tape that runs off the frame, two scenes mid-transition, the reel.
      const ignorable = (i) => (i.by ?? "").startsWith("od-col") || sid === "transitions" && i.kind !== "outside" || f.includes("v11-reel") || f.includes("tape-measure") && /^[−-]?[d,.]+[a-z]?$/i.test(i.text);
      for (const tm of TIMES) {
        await page.goto(pathToFileURL(join(dir, f)).href + `?embed&paused&theme=${theme}&t=${tm}`);
        await page.waitForTimeout(250);
        for (const i of (await page.evaluate(inPage)).filter((x) => !ignorable(x))) { const k = `${i.kind}:${i.text}`; if (!seen.has(k)) seen.set(k, { ...i, t: tm, n: 1 }); else seen.get(k).n++; }
        if (args.sheets && (tm === 9 || tm === 16) && seen.size) { const d = join(OUT, `${sid}-${f.replace(".html", "")}`); mkdirSync(d, { recursive: true }); await page.screenshot({ path: join(d, `${cname}-${theme}-t${tm}.png`) }); }
      }
      report.push({ set: sid, variant: f.replace(".html", ""), case: cname, theme, n, issues: [...seen.values()].filter((x) => x.n >= 2), errors: errs });
      await ctx.close();
    });
  }
}
await pool(jobs, Number(args.jobs ?? 6));
await browser.close();
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
// Summary: one row per variant, one column per case; each cell is the number of distinct issues (worst theme).
const rows = new Map();
for (const r of report) { const k = `${r.set}/${r.variant}`; const row = rows.get(k) ?? {}; row[r.case] = Math.max(row[r.case] ?? 0, r.issues.length + r.errors.length); rows.set(k, row); }
const cols = ["min", "nominal", "long", "max", "max-long"];
console.log(["variant".padEnd(44), ...cols.map((c) => c.padStart(8))].join(" "));
let total = 0;
for (const [k, row] of rows) { console.log([k.padEnd(44), ...cols.map((c) => (row[c] === undefined ? "-" : String(row[c])).padStart(8))].join(" ")); total += Object.values(row).reduce((a, b) => a + b, 0); }
console.log("total issues:", total, "| runs:", report.length, "| page errors:", report.reduce((a, r) => a + r.errors.length, 0));
