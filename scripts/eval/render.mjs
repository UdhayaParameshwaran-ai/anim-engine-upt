// Renders what a reviewer looks at: 9 frames per scene (evenly over the scene) and the narration of every scene.
//   node scripts/eval/render.mjs <arm> [topic ...]        (all topics of the arm when none are named)
// Reads out/eval/<arm>/<topic>.txt and writes out/eval/<arm>/review/<topic>/{narration.md,scenes.txt,<scene>-f/}.
// Contact sheets are made afterwards by sheets.cjs (sharp and the renderer don't share a process well).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { prepare, renderFrames } = await imp("apps/render/dist/index.js");
const { compile } = await imp("packages/compiler/dist/index.js");

const [arm, ...named] = process.argv.slice(2);
if (!arm) throw new Error("usage: render.mjs <arm> [topic ...]");
const armDir = join(root, "out/eval", arm);
const topics = named.length ? named : readdirSync(armDir).filter((f) => f.endsWith(".txt")).map((f) => f.slice(0, -4));
for (const t of topics) {
  const dir = join(armDir, "review", t);
  if (existsSync(join(dir, "done"))) continue;
  mkdirSync(dir, { recursive: true });
  const src = readFileSync(join(armDir, `${t}.txt`), "utf8");
  const { script } = compile(src);
  const said = script.scenes
    .map((sc) => `## scene ${sc.id} (${sc.attrs.template ? `template=${sc.attrs.template}` : `grid=${sc.attrs.grid}`}) "${sc.title ?? ""}"\n` + sc.steps.map((st) => `${st.id ? `  [step ${st.id}]\n` : ""}${st.beats.filter((b) => b.type === "speech").map((b) => `  > ${b.text}`).join("\n")}`).join("\n"))
    .join("\n\n");
  writeFileSync(join(dir, "narration.md"), said);
  let data;
  try {
    data = await prepare(src);
  } catch (e) {
    writeFileSync(join(dir, "FAILED.txt"), String(e?.message ?? e).split("\n").slice(0, 6).join("\n"));
    writeFileSync(join(dir, "scenes.txt"), "");
    writeFileSync(join(dir, "done"), "");
    console.log("FAILED to compile", t);
    continue;
  }
  const fps = data.timeline.fps ?? 30;
  for (const sc of data.timeline.scenes) {
    const d = sc.t1 - sc.transitionOut.duration - sc.t0;
    const frames = Array.from({ length: 9 }, (_, i) => Math.round((sc.t0 + d * (0.04 + (0.95 * i) / 8)) * fps));
    const fdir = join(dir, `${sc.id}-f`);
    mkdirSync(fdir, { recursive: true });
    const pngs = await renderFrames(data, frames, fdir);
    writeFileSync(join(fdir, "list.json"), JSON.stringify({ pngs }));
  }
  writeFileSync(join(dir, "scenes.txt"), data.timeline.scenes.map((s) => s.id).join(" "));
  writeFileSync(join(dir, "done"), "");
  console.log("rendered", t);
}
