import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, report } from "@anim/compiler";
import type { ResolvedTimeline, VideoIR } from "@anim/ir";
import { resolve } from "@anim/timeline";
import { FileCache, MockTtsProvider, speakVideo, type TtsProvider } from "@anim/tts";
import { KokoroTtsProvider } from "@anim/tts-kokoro";
import { chromium, type Browser, type Page } from "playwright-core";
import { mixNarration } from "./audio.js";
import { encoder, ffmpeg, write } from "./ffmpeg.js";

const repo = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface Prepared {
  ir: VideoIR;
  timeline: ResolvedTimeline;
}

/** Narration voice by name: "kokoro" (local neural TTS, the default) or "beeps" (instant mock that ticks on every word). */
export function voiceProvider(name = "kokoro", speed = 1): TtsProvider {
  if (name === "beeps") return new MockTtsProvider({ audio: "beeps", speed });
  if (name !== "kokoro") throw new Error("unknown voice " + JSON.stringify(name) + " (kokoro, beeps)");
  return new KokoroTtsProvider({ speed, cacheDir: join(repo, ".cache", "models") });
}

/** DSL text → IR + resolved timeline (narration synthesized and cached). */
export async function prepare(source: string, opts: { provider?: TtsProvider; cacheDir?: string } = {}): Promise<Prepared> {
  const compiled = compile(source);
  if (!compiled.ir) throw new Error(`script has errors:\n${report(compiled.diagnostics)}`);
  const provider = opts.provider ?? new MockTtsProvider({ audio: "beeps" });
  const speech = await speakVideo(compiled.ir, { provider, cache: new FileCache(opts.cacheDir ?? join(repo, ".cache", "tts")) });
  return { ir: compiled.ir, timeline: resolve(compiled.ir, speech) };
}

let bundleCache: string | undefined;

/** Bundles the browser entry (engine + render hook) into one IIFE script, from sources. */
export async function pageBundle(): Promise<string> {
  if (bundleCache) return bundleCache;
  const { build } = await import("vite");
  const { readdirSync } = await import("node:fs");
  const packages = join(repo, "packages");
  const alias = Object.fromEntries(readdirSync(packages).map((n) => [`@anim/${n}`, join(packages, n, "src", "index.ts")]));
  const outDir = join(repo, ".cache", "render");
  await build({
    configFile: false,
    logLevel: "warn",
    resolve: { alias },
    build: {
      outDir,
      emptyOutDir: false,
      minify: false,
      lib: { entry: join(repo, "apps", "render", "src", "page.ts"), formats: ["iife"], name: "AnimRender", fileName: () => "page.js" },
    },
  });
  bundleCache = await readFile(join(outDir, "page.js"), "utf8");
  return bundleCache;
}

/** Self-contained page: stage container, timeline data and the engine bundle. */
export function pageHtml(bundle: string, data: Prepared): string {
  const { width, height } = data.ir.canvas;
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000;overflow:hidden}#stage{position:relative;width:${width}px;height:${height}px}</style></head><body><div id="stage"></div><script>window.__DATA__=${json};window.__FONTS__=${JSON.stringify(FONT_HOST)}</script><script>${bundle.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}

/** Pages load fonts from this made-up origin; requests to it are answered from node_modules/@fontsource. */
const FONT_HOST = "https://fonts.anim.local/";

/** Serves the bundled font files to a page (a setContent page has no origin of its own). */
async function serveFonts(page: Page): Promise<void> {
  await page.route(`${FONT_HOST}**`, async (route) => {
    const [pkg, file] = new URL(route.request().url()).pathname.slice(1).split("/");
    try {
      const body = await readFile(join(repo, "node_modules", "@fontsource", basename(pkg ?? ""), "files", basename(file ?? "")));
      await route.fulfill({ status: 200, contentType: "font/woff2", body });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
}

const CHROME_ARGS = ["--force-color-profile=srgb", "--font-render-hinting=none", "--disable-lcd-text", "--hide-scrollbars", "--disable-gpu-rasterization"];

/** Installed Chrome, else Edge; playwright-core never downloads a browser. */
export async function launch(): Promise<Browser> {
  for (const channel of ["chrome", "msedge"]) {
    try {
      return await chromium.launch({ channel, args: CHROME_ARGS });
    } catch {
      // try the next channel
    }
  }
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH, args: CHROME_ARGS });
  throw new Error("no Chrome or Edge found; set CHROME_PATH");
}

export interface RenderOptions {
  out: string;
  /** Parallel browser pages, each encoding a frame range. */
  workers?: number;
  /** Seconds; render a sub-range of the video. */
  from?: number;
  to?: number;
  /** x264 quality (lower is better). */
  crf?: number;
  /** PNG is lossless; JPEG is faster to capture. */
  imageFormat?: "png" | "jpeg";
  onProgress?: (done: number, total: number) => void;
}

export interface RenderResult {
  out: string;
  frames: number;
  duration: number;
  seconds: number;
}

/**
 * Renders a prepared video to MP4: frames come from the same engine as the
 * live preview, stepped deterministically (frame i shows time i/fps).
 */
export async function renderVideo(data: Prepared, opts: RenderOptions): Promise<RenderResult> {
  const started = performance.now();
  const { fps, duration } = data.timeline;
  const f0 = Math.max(0, Math.round((opts.from ?? 0) * fps));
  const f1 = Math.min(Math.round(duration * fps), Math.round((opts.to ?? duration) * fps));
  const total = f1 - f0;
  if (total <= 0) throw new Error("nothing to render: empty frame range");
  const workers = Math.max(1, Math.min(opts.workers ?? Math.min(4, Math.max(1, availableParallelism() >> 1)), total));
  const tmp = await mkdtemp(join(tmpdir(), "anim-render-"));
  const tmpFile = (name: string) => join(tmp, name);
  const html = pageHtml(await pageBundle(), data);
  const browser = await launch();
  let done = 0;

  try {
    const chunk = Math.ceil(total / workers);
    const ranges = Array.from({ length: workers }, (_, k) => [f0 + k * chunk, Math.min(f1, f0 + (k + 1) * chunk)] as const).filter(([a, b]) => b > a);
    const segments = await Promise.all(
      ranges.map(async ([a, b], k) => {
        const segment = tmpFile(`segment-${k}.mp4`);
        const page = await browser.newPage({ viewport: { width: data.ir.canvas.width, height: data.ir.canvas.height }, deviceScaleFactor: 1 });
        await serveFonts(page);
        await page.setContent(html, { waitUntil: "load" });
        await page.evaluate(() => (window as unknown as { __ready: Promise<boolean> }).__ready);
        const enc = encoder(segment, fps, opts.crf ?? 18);
        for (let i = a; i < b; i++) {
          await page.evaluate((frame) => (window as unknown as { __anim: { frame(i: number): void } }).__anim.frame(frame), i);
          const shot = await page.screenshot({ type: opts.imageFormat ?? "png", ...(opts.imageFormat === "jpeg" && { quality: 92 }) });
          await write(enc.proc.stdin, shot);
          opts.onProgress?.(++done, total);
        }
        enc.proc.stdin.end();
        await enc.done;
        await page.close();
        return segment;
      }),
    );

    await mixNarration(data.timeline.audio, f0 / fps, f1 / fps, tmpFile("narration.wav"), tmpFile);
    await writeFile(tmpFile("segments.txt"), segments.map((s) => `file '${s.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
    await mkdir(dirname(resolvePath(opts.out)), { recursive: true });
    await ffmpeg([
      "-f", "concat", "-safe", "0", "-i", tmpFile("segments.txt"),
      "-i", tmpFile("narration.wav"),
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart",
      opts.out,
    ]);
  } finally {
    await browser.close();
    await rm(tmp, { recursive: true, force: true });
  }
  return { out: opts.out, frames: total, duration: total / fps, seconds: (performance.now() - started) / 1000 };
}

/** Renders single frames to PNG files, e.g. for golden-frame comparisons. */
export async function renderFrames(data: Prepared, frames: number[], outDir: string): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: data.ir.canvas.width, height: data.ir.canvas.height }, deviceScaleFactor: 1 });
    await serveFonts(page);
    await page.setContent(pageHtml(await pageBundle(), data), { waitUntil: "load" });
    await page.evaluate(() => (window as unknown as { __ready: Promise<boolean> }).__ready);
    const files: string[] = [];
    for (const i of frames) {
      await page.evaluate((frame) => (window as unknown as { __anim: { frame(i: number): void } }).__anim.frame(frame), i);
      const file = join(outDir, `frame-${String(i).padStart(5, "0")}.png`);
      await page.screenshot({ path: file, type: "png" });
      files.push(file);
    }
    return files;
  } finally {
    await browser.close();
  }
}
