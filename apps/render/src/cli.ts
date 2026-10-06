#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { MockTtsProvider } from "@anim/tts";
import { prepare, renderVideo } from "./render.js";

/**
 *   render <script> [-o out.mp4] [--workers=N] [--from=s] [--to=s] [--crf=18] [--jpeg] [--speed=1]
 */
const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-o");
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const num = (name: string) => (value(name) !== undefined ? Number(value(name)) : undefined);
if (!file) {
  console.error("usage: render <script> [-o out.mp4] [--workers=N] [--from=s] [--to=s] [--crf=18] [--jpeg] [--speed=1]");
  process.exit(2);
}
const oi = args.indexOf("-o");
const out = oi >= 0 ? args[oi + 1]! : `out/${basename(file).replace(/\.[^.]+$/, "")}.mp4`;

const data = await prepare(await readFile(file, "utf8"), { provider: new MockTtsProvider({ audio: "beeps", speed: num("speed") ?? 1 }) });
console.error(`${file}: ${data.timeline.duration.toFixed(2)}s at ${data.timeline.fps} fps, ${data.ir.canvas.width}×${data.ir.canvas.height}`);

let last = -1;
const result = await renderVideo(data, {
  out,
  ...(num("workers") !== undefined && { workers: num("workers")! }),
  ...(num("from") !== undefined && { from: num("from")! }),
  ...(num("to") !== undefined && { to: num("to")! }),
  ...(num("crf") !== undefined && { crf: num("crf")! }),
  ...(args.includes("--jpeg") && { imageFormat: "jpeg" as const }),
  onProgress: (done, total) => {
    const pct = Math.floor((done / total) * 100);
    if (pct !== last && pct % 5 === 0) process.stderr.write(`\r  rendering ${pct}% (${done}/${total} frames)`);
    last = pct;
  },
});
process.stderr.write("\n");
console.error(`wrote ${result.out}: ${result.frames} frames, ${result.duration.toFixed(2)}s of video in ${result.seconds.toFixed(1)}s (${(result.frames / result.seconds).toFixed(1)} fps)`);
