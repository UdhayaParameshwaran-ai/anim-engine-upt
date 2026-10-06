import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";

/** ffmpeg binary: $FFMPEG_PATH, then one on PATH, then the pinned ffmpeg-static build. */
export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) return "ffmpeg";
  const bundled = createRequire(import.meta.url)("ffmpeg-static") as string | null;
  if (!bundled) throw new Error("ffmpeg not found: install it, set FFMPEG_PATH, or reinstall ffmpeg-static");
  return bundled;
}

/** Runs ffmpeg to completion; resolves with stderr (where ffmpeg reports), rejects on failure. */
export function ffmpeg(args: string[]): Promise<string> {
  return new Promise((ok, fail) => {
    const p = spawn(ffmpegPath(), ["-hide_banner", "-y", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", fail);
    p.on("close", (code) => (code === 0 ? ok(err) : fail(new Error(`ffmpeg exited ${code}:\n${err.slice(-2000)}`))));
  });
}

/**
 * Starts an H.264 encoder that reads still images (PNG/JPEG) from stdin.
 * yuv420p keeps the output playable everywhere.
 */
export function encoder(out: string, fps: number, crf: number): { proc: ChildProcessWithoutNullStreams; done: Promise<void> } {
  const proc = spawn(ffmpegPath(), [
    "-hide_banner", "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-r", String(fps), out,
  ]);
  let err = "";
  proc.stderr.on("data", (d) => (err += d));
  const done = new Promise<void>((ok, fail) => {
    proc.on("error", fail);
    proc.on("close", (code) => (code === 0 ? ok() : fail(new Error(`encoder exited ${code}: ${err.slice(-2000)}`))));
  });
  return { proc, done };
}

/** Writes to a stream, waiting for drain so frames never pile up in memory. */
export function write(stream: NodeJS.WritableStream, data: Uint8Array): Promise<void> {
  return new Promise((ok, fail) => {
    if (stream.write(data, (e) => e && fail(e))) ok();
    else stream.once("drain", ok);
  });
}

export interface MediaInfo {
  duration: number;
  frames: number;
  hasAudio: boolean;
}

/** Probes a video with ffmpeg alone (ffmpeg-static ships no ffprobe): exact frame count by decoding. */
export async function probe(file: string): Promise<MediaInfo> {
  const log = await ffmpeg(["-i", file, "-map", "0:v:0", "-f", "null", "-"]);
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
  const frames = [...log.matchAll(/frame=\s*(\d+)/g)].pop();
  return {
    duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
    frames: frames ? Number(frames[1]) : 0,
    hasAudio: /Stream #\d+:\d+.*Audio:/.test(log),
  };
}

/** PSNR (dB) between frame `index` of a video and a still image. */
export async function psnr(video: string, index: number, image: string): Promise<number> {
  const log = await ffmpeg([
    "-i", video, "-i", image,
    "-lavfi", `[0:v]select=eq(n\\,${index}),setpts=PTS-STARTPTS,format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]psnr`,
    "-frames:v", "1", "-f", "null", "-",
  ]);
  const m = /average:([\d.]+|inf)/.exec(log);
  if (!m) throw new Error(`no PSNR in ffmpeg output:\n${log.slice(-1000)}`);
  return m[1] === "inf" ? Infinity : Number(m[1]);
}
