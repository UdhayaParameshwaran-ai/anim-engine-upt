// Finds how much copy each designer variant can take before text clips, leaves the frame or overlaps.
//   node scripts/html-limits.mjs [--set steps,stats] [--out packages/html-templates/src/limits.json] [--jobs 6] [--adapt 1]
// For every variant it renders growing copy (levels 0..5) at the smallest and the largest item count, with the adaptive
// overlay on, sampled at settled times. The first level that fails ends the sweep; the level before it is the limit.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inPage, launch } from "./lib/html-check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith("--") ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const ROOT = join(repo, "packages/html-templates/designer/phase1");
const OUT = args.out ?? join(repo, "packages/html-templates/src/limits.json");
const THEME = args.theme ?? "daylight-clean";
const require = createRequire(join(repo, "apps/render/package.json"));

import { LEVELS, SETS, REVIEWED, rangeOf, codeMaxOf } from "./lib/html-data.mjs";
import { readFileSync } from "node:fs";

const apply = (v) => {
  const r = REVIEWED[`${v.set}/${v.variant}`];
  if (!r) return v;
  const L = LEVELS[r.level];
  return { ...v, level: r.level, titleChars: r.labelChars ?? L.title, detailChars: r.labelChars ? null : L.detail, items: { ...v.items, effectiveMax: r.max ?? v.items.effectiveMax }, reviewed: true, provisional: r.provisional ?? false, note: r.note, why: undefined };
};
if (args.merge) {
  const j = JSON.parse(readFileSync(args.merge, "utf8"));
  j.variants = j.variants.map(apply);
  mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(j, null, 1));
  console.log("merged", Object.keys(REVIEWED).length, "reviewed variants into", OUT); process.exit(0);
}
const browser = await launch(require);
const only = args.set?.split(",");
const jobs = [], results = [];
const pool = async (list, size) => { let i = 0; await Promise.all(Array.from({ length: size }, async () => { while (i < list.length) await list[i++](); })); };
const adaptJs = join(repo, "packages/html-templates/adapt/adapt.js");

async function trial(file, S, n, L) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [S.key, S.make(Math.max(n, 1), L)]);
  if (args.adapt !== "0") await ctx.addInitScript({ path: adaptJs });
  const page = await ctx.newPage();
  const seen = new Map();
  let dur = 12;
  for (const frac of [0.5, 0.75, 0.97]) {
    await page.goto(pathToFileURL(file).href + `?embed&paused&theme=${THEME}&t=${(dur * frac).toFixed(2)}`);
    await page.waitForTimeout(220);
    const m = /\/\s*([\d.]+)s/.exec(await page.evaluate(() => document.querySelector(".time")?.textContent ?? ""));
    if (m && Math.abs(Number(m[1]) - dur) > 0.05) { dur = Number(m[1]); await page.goto(pathToFileURL(file).href + `?embed&paused&theme=${THEME}&t=${(dur * frac).toFixed(2)}`); await page.waitForTimeout(220); }
    for (const i of await page.evaluate(inPage)) {
      if ((i.by ?? "").startsWith("od-col") || (/v11-reel|tape-measure/.test(file)) || (file.includes("transitions") && i.kind !== "outside")) continue;
      const k = `${i.kind}:${i.text}`; seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  await ctx.close();
  return [...seen].filter(([, c]) => c >= 2).map(([k]) => k);
}

for (const [sid, S] of Object.entries(SETS)) {
  if (only && !only.includes(sid)) continue;
  const dir = join(ROOT, S.dir);
  const files = readdirSync(dir).filter((f) => /^v\d+.*\.html$/.test(f));
  for (const f of files.filter((x) => !args.only || args.only.split(",").some((o) => x.includes(o)))) jobs.push(async () => {
    const v = f.replace(".html", ""), [dmin, dmax] = rangeOf(sid, v), cmax = codeMaxOf(sid, v, S);
    const nMax = S.codeMax ? Math.min(dmax, cmax) : 0, nMin = S.codeMax ? dmin : 0;
    let passed = -1, why = [];
    for (const L of LEVELS) {
      const bad = [...(await trial(join(dir, f), S, nMax || 1, L)).map((x) => `n=${nMax || 1} ${x}`), ...(nMin && nMin !== nMax ? (await trial(join(dir, f), S, nMin, L)).map((x) => `n=${nMin} ${x}`) : [])];
      if (bad.length) { if (L.k === 0) why = bad.slice(0, 6); break; }
      passed = L.k;
    }
    const L = passed >= 0 ? LEVELS[passed] : null;
    results.push({ set: sid, variant: v, items: { min: dmin, max: dmax, codeMax: cmax || null, effectiveMax: nMax || null }, field: S.field, level: passed, titleChars: L ? L.title : null, detailChars: L ? L.detail : null, why: passed < 0 ? why : undefined, note: passed < 0 ? "fails at the shortest copy" : passed === 5 ? "fits the longest copy tested" : "" });
    console.log(`${sid}/${v}`.padEnd(40), passed < 0 ? "FAILS at level 0" : `level ${passed}  title<=${L.title}  detail<=${L.detail}`);
  });
}
await pool(jobs, Number(args.jobs ?? 6));
await browser.close();
results.forEach((v, i) => { results[i] = apply(v); });
results.sort((a, b) => (a.set + a.variant).localeCompare(b.set + b.variant));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), theme: THEME, adapt: args.adapt !== "0", levels: LEVELS, variants: results }, null, 1));
console.log("wrote", OUT);
