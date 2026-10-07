import { existsSync } from "node:fs";
import { join } from "node:path";
import { align, wavDuration } from "@anim/tts";
import { describe, expect, it } from "vitest";
import { KokoroTtsProvider, splitPhonemes } from "../src/index.js";

describe("phoneme split", () => {
  it("gives linked and reduced forms back to their words", () => {
    // espeak, phrase vs words: "of the" links into one chunk, "a" reduces to ɐ.
    const phrase = "ɐ hˈɑːɹmləs pˈiːs ʌvðə dʒˈɜːm";
    const refs = ["ˈeɪ", "hˈɑːɹmləs", "pˈiːs", "ˈʌv", "ðˈə", "dʒˈɜːm"];
    expect(splitPhonemes(phrase, refs)).toEqual(["ɐ", "hˈɑːɹmləs", "pˈiːs", "ʌv", "ðə", "dʒˈɜːm"]);
  });

  it("keeps the spaces inside a word that is several spoken words", () => {
    const phrase = "ɪn nˈaɪntiːnhˈʌndɹɪd fˈɪfti fˈaɪv";
    expect(splitPhonemes(phrase, ["ˈɪn", "nˈaɪntiːnhˈʌndɹɪd fˈɪfti fˈaɪv"])).toEqual(["ɪn", "nˈaɪntiːnhˈʌndɹɪd fˈɪfti fˈaɪv"]);
  });

  it("never loses or reorders sounds", () => {
    const phrase = "ðˈɛn ðə skˈaɪ tˈɜːnz blˈuː";
    const out = splitPhonemes(phrase, ["ðˈɛn", "ðˈə", "skˈaɪ", "tˈɜːnz", "blˈuː"]);
    expect(out.join(" ")).toBe(phrase);
  });
});

// Runs only where the model has been downloaded (it is ~150 MB).
const model = join(process.cwd(), ".cache/models/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/onnx/model_q4f16.onnx");

describe.skipIf(!existsSync(model))("kokoro provider", () => {
  it("speaks with word timings that follow the text", { timeout: 120_000 }, async () => {
    const text = "Plants need sunlight, water, and carbon dioxide. That is all.";
    const r = await new KokoroTtsProvider().synthesize({ text, voice: "narrator", lang: "en" });
    expect(r.sampleRate).toBe(24000);
    expect(wavDuration(r.audio)).toBeCloseTo(r.duration, 2);
    expect(r.duration).toBeGreaterThan(2);
    expect(r.duration).toBeLessThan(8);

    const words = align(text, r.duration, r.timings);
    expect(words.map((w) => w.text)).toEqual(text.split(" "));
    expect(words.every((w) => w.precision === "word")).toBe(true);
    for (let i = 1; i < words.length; i++) expect(words[i]!.t0).toBeGreaterThanOrEqual(words[i - 1]!.t1);
    // The sentence break is a real pause.
    const all = words.findIndex((w) => w.text === "That");
    expect(words[all]!.t0 - words[all - 1]!.t1).toBeGreaterThan(0.1);
  });
});
