import { existsSync } from "node:fs";
import { join } from "node:path";
import { align } from "@anim/tts";
import { describe, expect, it } from "vitest";
import { PiperTtsProvider, splitSentences } from "../src/index.js";

const dir = join(import.meta.dirname, "../../../.cache/piper");

describe("piper", () => {
  it("splits narration into sentences with their positions", () => {
    const text = "A bill starts as an idea. Then it goes to committee! Does it pass? Mostly not";
    const s = splitSentences(text);
    expect(s.map((x) => x.text)).toEqual(["A bill starts as an idea.", "Then it goes to committee!", "Does it pass?", "Mostly not"]);
    for (const x of s) expect(text.slice(x.start, x.end)).toBe(x.text);
  });

  it.skipIf(!existsSync(join(dir, "en_US-lessac-medium.onnx")))("speaks each sentence and times it, faster than real time", async () => {
    const p = new PiperTtsProvider({ dir });
    const text = "Water rises from the sea. It cools into clouds. Then it falls as rain.";
    const t0 = performance.now();
    const r = await p.synthesize({ text, voice: "x", lang: "en-us" });
    const took = (performance.now() - t0) / 1000;
    expect(r.duration).toBeGreaterThan(2);
    expect(took).toBeLessThan(r.duration);
    expect(r.timings?.unit).toBe("sentence");
    expect(r.timings?.items).toHaveLength(3);
    const words = align(text, r.duration, r.timings);
    expect(words).toHaveLength(14);
    expect(words.at(-1)!.t1).toBeLessThanOrEqual(r.duration + 0.01);
  });
});
