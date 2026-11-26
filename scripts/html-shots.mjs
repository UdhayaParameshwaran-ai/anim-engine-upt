// Contact sheet of designer variants at a copy level: node scripts/html-shots.mjs <level 0-5> <out.png> <set/variant> ... [--fracs 0.5,0.97] [--n max|min]
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "./lib/html-check.mjs";
const here = dirname(fileURLToPath(import.meta.url)), repo = join(here, "..");
const require = createRequire(join(repo, "apps/render/package.json"));
const pnp = join(repo, "node_modules/.pnpm"), sharp = require(join(pnp, readdirSync(pnp).find((d) => d.startsWith("sharp@")), "node_modules/sharp"));
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv.splice(i, 2)[1]; };
const fracs = opt("fracs", "0.5,0.97").split(",").map(Number), nsel = opt("n", "max"), theme = opt("theme", "daylight-clean");
const [level, out, ...want] = argv;
// Same data builders and ranges as the limits sweep (imported by evaluating its exports would run it, so they live here too).
const lim = await import(pathToFileURL(join(here, "lib/html-data.mjs")).href);
const b = await launch(require);
const W = 640, H = 360, tiles = [];
for (const w of want) {
  const [sid, v] = w.split("/"), S = lim.SETS[sid], file = join(repo, "packages/html-templates/designer/phase1", S.dir, `${v}.html`);
  const [dmin, dmax] = lim.rangeOf(sid, v), n = S.codeMax ? (/^\d+$/.test(nsel) ? Number(nsel) : nsel === "min" ? dmin : Math.min(dmax, lim.codeMaxOf(sid, v, S))) : 1;
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(([k, d]) => localStorage.setItem(k, JSON.stringify(d)), [S.key, S.make(n, lim.LEVELS[Number(level)])]);
  await ctx.addInitScript({ path: join(repo, "packages/html-templates/adapt/adapt.js") });
  const p = await ctx.newPage(); let dur = 12;
  for (const f of fracs) {
    await p.goto(pathToFileURL(file).href + `?embed&paused&theme=${theme}&t=${(dur * f).toFixed(2)}`); await p.waitForTimeout(250);
    const m = /\/\s*([\d.]+)s/.exec(await p.evaluate(() => document.querySelector(".time")?.textContent ?? ""));
    if (m && Math.abs(Number(m[1]) - dur) > 0.05) { dur = Number(m[1]); await p.goto(pathToFileURL(file).href + `?embed&paused&theme=${theme}&t=${(dur * f).toFixed(2)}`); await p.waitForTimeout(250); }
    tiles.push({ label: `${w} n=${n} @${(dur * f).toFixed(1)}s`, buf: await sharp(await p.screenshot()).resize(W, H).toBuffer() });
  }
  await ctx.close();
}
await b.close();
const cols = fracs.length, rows = want.length;
await sharp({ create: { width: cols * (W + 6), height: rows * (H + 6), channels: 3, background: "#777" } }).composite(tiles.map((t, i) => ({ input: t.buf, left: (i % cols) * (W + 6), top: Math.floor(i / cols) * (H + 6) }))).png().toFile(out);
console.log(tiles.map((t, i) => `${i}: ${t.label}`).join("\n"));
