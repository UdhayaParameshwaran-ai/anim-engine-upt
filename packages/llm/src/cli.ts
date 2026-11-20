#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { report } from "@anim/compiler";
import { clientFromEnv, type ProviderName } from "./client.js";
import { isLength } from "./length.js";
import { sanitizeSettings } from "./settings.js";
import { isLevel, LEVELS } from "./teaching.js";
import { generate, type CallTrace } from "./generate.js";

/**
 *   generate "<topic>" [-o out/topic.txt] [--provider=openrouter|gemini|anthropic|claude[,..]] [--model=<id>]
 *            [--single] [--scenes=2-4] [--length=short|standard|long|deep] [--level=new|familiar|practitioner] [--settings=prompts.json] [--domain=tech] [--style=director|llm] [--render [--voice=kokoro|piper|beeps]] [--verbose]
 */
const args = process.argv.slice(2);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const oi = args.indexOf("-o");
const topic = args.filter((a, i) => !a.startsWith("-") && args[i - 1] !== "-o").join(" ").trim();
if (!topic) {
  console.error('usage: generate "<topic>" [-o out.txt] [--provider=openrouter,gemini,claude,...] [--model=<id>] [--single] [--scenes=2-4] [--render] [--verbose]');
  process.exit(2);
}
if (existsSync(".env")) process.loadEnvFile(".env");

const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "video";
const out = oi >= 0 ? args[oi + 1]! : `out/${slug}.txt`;
const scenesArg = value("scenes");
const [min, max] = (scenesArg ?? "").split("-").map(Number);
const length = value("length");
if (length && !isLength(length)) {
  console.error(`--length must be short, standard, long or deep (got ${length})`);
  process.exit(2);
}
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
const settingsFile = value("settings");
const level = value("level");
if (level && !isLevel(level)) {
  console.error(`--level must be ${LEVELS.join(", ")} (got ${level})`);
  process.exit(2);
}
// --level wins over a level in the settings file; unset, the pipeline uses familiar.
const settings = { ...(settingsFile ? sanitizeSettings(JSON.parse(readFileSync(settingsFile, "utf8"))) : {}), ...(level && isLevel(level) && { level }) };
const verbose = args.includes("--verbose");

// A fresh look per video, remembering past ones (`--style=llm` keeps the LLM's own style lines).
const { Director, StyleHistory } = await import("@anim/director");
const store = new StyleHistory(".cache/style-history.json");
const director = value("style") === "llm" ? undefined : new Director({ topic, history: await store.get("cli"), respectScript: "always" });

console.error(`generating with ${client.name}…`);
const started = performance.now();
const result = await generate(topic, {
  client,
  ...(director && { director }),
  mode: args.includes("--single") ? "single" : "outline",
  ...(value("domain") === "tech" && { domain: "tech" as const }),
  ...(args.includes("--canvas") && { canvas: true }),
  ...(value("canvas") === "auto" && { canvas: "auto" as const }),
  ...(length && isLength(length) && { length }),
  ...((settingsFile || level) && { settings }),
  // An explicit --scenes wins over the length preset.
  ...(scenesArg && min && { scenes: { min, max: max ?? min } }),
  onScene: (_, i) => console.error(`  scene ${i + 1} ready`),
  onLog: (m) => verbose && console.error(`  ${m.replace(/\n/g, "\n    ")}`),
});

await mkdir(dirname(out), { recursive: true });
await writeFile(out, result.script);
// Every call with its prompt, reply, timing, tokens and validation, for later inspection.
const traceFile = out.replace(/\.[^.]+$/, "") + ".trace.json";
await writeFile(traceFile, JSON.stringify({ topic, provider: client.name, ok: result.ok, ms: result.ms, usage: result.usage, calls: result.trace }, null, 2));
console.error(callTable(result.trace));
console.error(`trace: ${traceFile}`);
if (director && result.ok) {
  await store.add("cli", director.entry());
  const c = director.choice;
  console.error(`style: ${c.theme} · ${c.motion} (mood: ${c.mood})`);
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

/** One line per LLM call: step, scene, tokens, time and how its reply validated. */
function callTable(calls: CallTrace[]): string {
  const rows = calls.map((c) => {
    const step = `${c.kind}${c.attempt ? ` ${c.attempt}` : ""}`;
    const est = c.estimated ? "~" : "";
    const check = c.check ? (c.check.errors ? `${c.check.errors} err` : "valid") : "";
    return [
      String(c.id).padStart(2),
      step.padEnd(9),
      (c.scene ?? "-").padEnd(12),
      `${est}${c.usage?.prompt ?? 0}`.padStart(7),
      `${est}${c.usage?.completion ?? 0}`.padStart(6),
      `${((c.ms ?? 0) / 1000).toFixed(1)}s`.padStart(7),
      check.padEnd(6),
      c.error ? `FAILED ${c.error.slice(0, 60)}` : (c.verdict ?? ""),
    ].join("  ");
  });
  return ["  #  step       scene             in     out     time  check   result", ...rows].map((l) => `  ${l}`).join("\n");
}
