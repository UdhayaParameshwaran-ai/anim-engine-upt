#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { report } from "@anim/compiler";
import { clientFromEnv, type ProviderName } from "./client.js";
import { generate } from "./generate.js";

/**
 *   generate "<topic>" [-o out/topic.txt] [--provider=openrouter|groq[,..]] [--model=<id>]
 *            [--single] [--scenes=2-4] [--style=director|llm] [--render [--voice=kokoro|beeps]] [--verbose]
 */
const args = process.argv.slice(2);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const oi = args.indexOf("-o");
const topic = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "-o").join(" ").trim();
if (!topic) {
  console.error('usage: generate "<topic>" [-o out.txt] [--provider=openrouter,groq] [--model=<id>] [--single] [--scenes=2-4] [--render] [--verbose]');
  process.exit(2);
}
if (existsSync(".env")) process.loadEnvFile(".env");

const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "video";
const out = oi >= 0 ? args[oi + 1]! : `out/${slug}.txt`;
const [min, max] = (value("scenes") ?? "2-4").split("-").map(Number);
let client;
try {
  client = clientFromEnv({
    ...(value("provider") && { providers: value("provider")!.split(",") as ProviderName[] }),
    ...(value("model") && { model: value("model")! }),
  });
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
}
const verbose = args.includes("--verbose");

// A fresh look per video, remembering past ones (`--style=llm` keeps the LLM's own style lines).
const { Director, StyleHistory } = await import("@anim/director");
const store = new StyleHistory(".cache/style-history.json");
const director = value("style") === "llm" ? undefined : new Director({ topic, history: await store.get("cli") });

console.error(`generating with ${client.name}…`);
const started = performance.now();
const result = await generate(topic, {
  client,
  ...(director && { director }),
  mode: args.includes("--single") ? "single" : "outline",
  scenes: { min: min ?? 2, max: max ?? min ?? 4 },
  onScene: (_, i) => console.error(`  scene ${i + 1} ready`),
  onLog: (m) => verbose && console.error(`  ${m.replace(/\n/g, "\n    ")}`),
});

await mkdir(dirname(out), { recursive: true });
await writeFile(out, result.script);
if (director && result.ok) {
  await store.add("cli", director.entry());
  const c = director.choice;
  console.error(`style: ${c.theme} · ${c.motion} · bg ${c.bg} (mood: ${c.mood})`);
}
if (result.diagnostics.length) console.error(report(result.diagnostics));
console.error(
  `wrote ${out}: ${result.ok ? "ok" : "has errors"} · ${result.calls} LLM call(s), ${result.repairs} repair(s), ` +
    `${result.usage.prompt}+${result.usage.completion} tokens, ${((performance.now() - started) / 1000).toFixed(1)}s`,
);
if (!result.ok) process.exit(1);

if (args.includes("--render")) {
  const { prepare, renderVideo, voiceProvider } = await import("@anim/render");
  const mp4 = out.replace(/\.[^.]+$/, "") + ".mp4";
  const data = await prepare(result.script, { provider: voiceProvider(value("voice")) });
  const r = await renderVideo(data, { out: mp4 });
  console.error(`rendered ${mp4}: ${r.duration.toFixed(1)}s in ${r.seconds.toFixed(1)}s`);
}
