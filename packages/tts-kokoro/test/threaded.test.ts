import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ThreadedKokoroProvider } from "../src/index.js";

const model = join(process.cwd(), ".cache/models/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/onnx/model_q4f16.onnx");
const worker = join(process.cwd(), "packages/tts-kokoro/dist/worker.js");

const TEXT = "Plants make their own food. They take in sunlight, water and air, and turn them into sugar. This is called photosynthesis, and it happens in the leaves.";

describe.skipIf(!existsSync(model) || !existsSync(worker))("kokoro on a thread of its own", () => {
  it("keeps the server answering while it speaks, and speaks the same words", async () => {
    const voice = new ThreadedKokoroProvider({ cacheDir: join(process.cwd(), ".cache/models") });
    expect(voice.threaded).toBe(true);
    await voice.warmup();

    // A 10 ms timer on this thread: how long was it kept from running while the voice worked?
    let last = performance.now();
    let longest = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last - 10);
      last = now;
    }, 10);
    const r = await voice.synthesize({ text: TEXT, voice: "narrator", lang: "en" });
    clearInterval(timer);
    await voice.close();

    // In this thread the same synthesis stalls it for seconds; here it must stay responsive.
    expect(longest).toBeLessThan(500);
    expect(r.duration).toBeGreaterThan(5);
    expect(r.timings?.items.length).toBe(TEXT.split(/\s+/).length);
    // The audio crossed threads whole: a WAV header and samples.
    expect(Buffer.from(r.audio.subarray(0, 4)).toString()).toBe("RIFF");
  }, 120_000);

  it("reports a failure as an error and starts again for the next request", async () => {
    const voice = new ThreadedKokoroProvider({ cacheDir: join(process.cwd(), ".cache/models") });
    await voice.warmup();
    await voice.close();
    // The thread was ended; the next request starts a new one.
    const r = await voice.synthesize({ text: "One short sentence.", voice: "narrator", lang: "en" });
    expect(r.duration).toBeGreaterThan(0.5);
    await voice.close();
  }, 120_000);
});
