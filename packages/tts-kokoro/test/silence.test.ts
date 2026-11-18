import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { audible, KokoroTtsProvider } from "../src/index.js";

describe("audible", () => {
  it("tells speech from silence and from NaN", () => {
    expect(audible(Float32Array.from([0, 0.2, -0.3, 0.1]))).toBe(true);
    expect(audible(new Float32Array(1000))).toBe(false);
    expect(audible(Float32Array.from([0.2, Number.NaN, 0.1]))).toBe(false);
    expect(audible(Float32Array.from([0.2, Number.POSITIVE_INFINITY]))).toBe(false);
    // Hiss far below speech is not speech.
    expect(audible(Float32Array.from([1e-5, -1e-5]))).toBe(false);
  });

  it("is what a NaN chunk looks like once written as 16-bit audio: silence", () => {
    // Why the check exists: NaN becomes 0 in an Int16Array, so a failed chunk used to play as silence.
    const pcm = Int16Array.from([Math.max(-32768, Math.min(32767, Math.round(Number.NaN * 32767)))]);
    expect(pcm[0]).toBe(0);
  });
});

const model = join(process.cwd(), ".cache/models/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/onnx/model_q4f16.onnx");

/**
 * Narration of a lock-free queue video. With the 4-bit weights this passage came back as 22 seconds of NaN,
 * i.e. silence, while its timings looked normal: the speech "went missing in the middle" of the video.
 */
const PASSAGE =
  "and the failure simply means someone else won. So B rereads the queue and moves forward to node seven. Tail still points at five, one step behind the real end. Whichever thread notices runs CAS on tail, expecting five, with seven, and tail moves to seven. Now B's CAS on seven's next succeeds, and node nine is linked.";

describe.skipIf(!existsSync(model))("kokoro on a passage the 4-bit weights fail on", () => {
  it("still speaks every second of it", async () => {
    const r = await new KokoroTtsProvider().synthesize({ text: PASSAGE, voice: "narrator", lang: "en" });
    const pcm = new Int16Array(r.audio.buffer.slice(r.audio.byteOffset + 44, r.audio.byteOffset + r.audio.byteLength));
    // No stretch of a second or more that is exactly zero.
    let run = 0;
    let longest = 0;
    for (const v of pcm) {
      run = v === 0 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(longest / r.sampleRate).toBeLessThan(1);
    expect(r.duration).toBeGreaterThan(15);
  }, 120_000);
});
