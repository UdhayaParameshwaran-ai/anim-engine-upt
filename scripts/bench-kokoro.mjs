// How fast and how heavy is Kokoro on this machine?
//   pnpm build && node scripts/bench-kokoro.mjs [script.txt] [q4f16|q8] [threads]
// Speaks the first scene with narration of the script (default examples/photosynthesis.txt) twice, and prints the
// speed against real time, the CPU time used (cores busy), memory, and how often the 8-bit weights had to redo a
// chunk. Run it when nothing else is using the machine: timings on a busy one swing several times over, while CPU
// time and memory are steady. Try threads 2, 4, 6 and all (0) to see what suits a machine it shares.
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "../packages/compiler/dist/index.js";
import { sceneText } from "../packages/tts/dist/index.js";
import { KokoroTtsProvider } from "../packages/tts-kokoro/dist/index.js";

const repo = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const [file = join(repo, "examples/photosynthesis.txt"), dtype = "q4f16", threads = "0"] = process.argv.slice(2);
const { ir } = compile(readFileSync(file, "utf8"));
const text = ir.scenes.map((s) => sceneText(s).text).find((t) => t.trim());
if (!text) throw new Error("the script has no narration");
const k = new KokoroTtsProvider({ cacheDir: join(repo, ".cache", "models"), dtype, ...(Number(threads) && { threads: Number(threads) }) });
const t0 = performance.now();
await k.warmup();
// On an Apple-silicon Mac the arch must be arm64: an x64 Node under Rosetta runs the model several times slower.
console.log(`node ${process.version} ${process.platform}/${process.arch} · ${cpus().length} logical cpus · ${dtype} · threads ${Number(threads) || "all"}`);
console.log(`model loaded in ${((performance.now() - t0) / 1000).toFixed(1)}s; ${text.split(/\s+/).length} words`);
for (const run of [1, 2]) {
  const cpu0 = process.cpuUsage();
  const start = performance.now();
  const r = await k.synthesize({ text, voice: ir.voice, lang: ir.lang });
  const wall = (performance.now() - start) / 1000;
  const cpu = process.cpuUsage(cpu0);
  const used = (cpu.user + cpu.system) / 1e6;
  console.log(
    `run ${run}: ${r.duration.toFixed(1)}s of speech in ${wall.toFixed(1)}s (${(r.duration / wall).toFixed(2)}x real time) · cpu ${used.toFixed(0)}s (${(used / wall).toFixed(1)} cores busy) · rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB · 8-bit redos ${k.fallbacks}`,
  );
}
