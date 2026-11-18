// Counts for one eval arm: validity, repairs, tokens, scenes by template, trace scenes, warnings.
//   node scripts/eval/stats.mjs <arm> [<arm> ...]
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const { compile } = await import(pathToFileURL(join(root, "packages/compiler/dist/index.js")).href);
for (const arm of process.argv.slice(2)) {
  const dir = join(root, "out/eval", arm);
  const s = { videos: 0, ok: 0, errors: 0, repairs: 0, tokens: 0, scenes: 0, trace: 0, videosWithTrace: 0, grid: 0 };
  const warns = {}, tpl = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".txt"))) {
    const t = f.slice(0, -4);
    s.videos++;
    const log = readFileSync(join(dir, `${t}.log`), "utf8");
    const m = /: (ok|has errors)[^\n]*?(\d+) LLM call\(s\), (\d+) repair\(s\), (\d+)\+(\d+) tokens/.exec(log);
    if (m) { s.ok += m[1] === "ok" ? 1 : 0; s.repairs += +m[3]; s.tokens += +m[4] + +m[5]; }
    const { script, diagnostics } = compile(readFileSync(join(dir, f), "utf8"));
    s.errors += diagnostics.filter((d) => d.severity === "error").length;
    for (const d of diagnostics.filter((d) => d.severity === "warning")) warns[d.code] = (warns[d.code] || 0) + 1;
    let tr = 0;
    for (const sc of script.scenes) {
      s.scenes++;
      const n = sc.attrs.template ?? (sc.attrs.grid ? "grid" : "free");
      tpl[n] = (tpl[n] || 0) + 1;
      if (sc.attrs.grid) s.grid++;
      if (n === "trace") tr++;
    }
    s.trace += tr; s.videosWithTrace += tr ? 1 : 0;
  }
  console.log(`\n== ${arm}: ${JSON.stringify(s)}`);
  console.log(` per video: ${(s.tokens / s.videos / 1000).toFixed(0)}k tokens, ${(s.repairs / s.videos).toFixed(1)} repairs`);
  console.log(` warnings ${JSON.stringify(warns)}`);
  console.log(` templates ${JSON.stringify(Object.fromEntries(Object.entries(tpl).sort((a, b) => b[1] - a[1])))}`);
}
