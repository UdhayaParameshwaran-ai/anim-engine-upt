#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { compile, report } from "./compile.js";

/**
 *   check <file> [--ir] [--fixed] [--no-fix] [--timeline[=out.json]] [--speed=<n>]
 *
 * Prints diagnostics; exits 1 on unfixed errors. --ir prints the VideoIR,
 * --fixed prints the auto-fixed script, --no-fix disables auto-fixes.
 * --timeline synthesizes narration with the mock TTS and resolves the
 * timeline (summary to stderr, JSON to the given file); --speed changes
 * the mock speaking rate.
 */
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (name: string) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name: string) => flag(name)?.split("=")[1];
if (!file) {
  console.error("usage: check <file> [--ir] [--fixed] [--no-fix] [--timeline[=out.json]] [--speed=<n>]");
  process.exit(2);
}

const result = compile(readFileSync(file, "utf8"), { autofix: !flag("no-fix") });
if (result.diagnostics.length) console.error(report(result.diagnostics));
if (flag("fixed")) {
  const { print } = await import("@anim/dsl");
  process.stdout.write(print(result.script));
}
if (flag("ir") && result.ir) console.log(JSON.stringify(result.ir, null, 2));

if (flag("timeline") && result.ir) {
  const { MockTtsProvider, speakVideo } = await import("@anim/tts");
  const { resolve } = await import("@anim/timeline");
  const speech = await speakVideo(result.ir, { provider: new MockTtsProvider({ audio: false, speed: Number(value("speed") ?? 1) }) });
  const tl = resolve(result.ir, speech);
  for (const s of tl.scenes) {
    const holds = s.beats.filter((b) => b.hold > 0).length;
    console.error(`  scene ${s.id.padEnd(12)} ${fmt(s.t0)} → ${fmt(s.t1)}  ${s.beats.length} beat(s)${holds ? `, ${holds} hold(s)` : ""}`);
  }
  for (const r of tl.report) console.error(`  ${r.line ? `L${r.line} ` : ""}${r.code} ${r.severity}: ${r.message}`);
  console.error(`  timeline: ${fmt(tl.duration)}, ${tl.tracks.length} tweens, ${tl.cues.length} cues, ${tl.audio.length} audio clips`);
  const out = value("timeline");
  if (out) writeFileSync(out, JSON.stringify(tl, null, 2));
}

const errors = result.diagnostics.filter((d) => d.severity === "error" && !d.fixed).length;
const warnings = result.diagnostics.length - errors;
console.error(`${file}: ${result.ok ? "ok" : "failed"} (${errors} error(s), ${warnings} warning(s)/fix(es))`);
process.exit(result.ok ? 0 : 1);

function fmt(t: number): string {
  return `${t.toFixed(2)}s`;
}
