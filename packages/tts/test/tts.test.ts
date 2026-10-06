import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "@anim/compiler";
import { describe, expect, it } from "vitest";
import { align, FileCache, MemoryCache, MockTtsProvider, sceneText, speakScene, wavDuration, type TtsProvider } from "../src/index.js";

const TEXT = "Plants need sunlight, water, and carbon dioxide. That is all.";

describe("mock provider", () => {
  it("is deterministic and responds to speed", async () => {
    const a = await new MockTtsProvider().synthesize({ text: TEXT, voice: "v", lang: "en" });
    const b = await new MockTtsProvider().synthesize({ text: TEXT, voice: "v", lang: "en" });
    const fast = await new MockTtsProvider({ speed: 1.25 }).synthesize({ text: TEXT, voice: "v", lang: "en" });
    expect(a).toEqual(b);
    expect(fast.duration).toBeLessThan(a.duration);
    expect(wavDuration(a.audio)).toBeCloseTo(a.duration, 3);
  });
});

describe("aligner", () => {
  const timed = (timing: "char" | "word" | "sentence" | "none") => new MockTtsProvider({ timing, audio: false }).synthesize({ text: TEXT, voice: "v", lang: "en" });

  it("gives identical word timings from char and word granularity", async () => {
    const c = await timed("char");
    const w = await timed("word");
    const fromChars = align(TEXT, c.duration, c.timings);
    const fromWords = align(TEXT, w.duration, w.timings);
    expect(fromChars.map((x) => x.text)).toEqual(TEXT.split(" "));
    expect(fromChars.map(({ t0, t1 }) => [t0, t1])).toEqual(fromWords.map(({ t0, t1 }) => [t0, t1]));
    expect(new Set(fromChars.map((x) => x.precision))).toEqual(new Set(["char"]));
  });

  it("interpolates monotonic timings from sentences or nothing", async () => {
    for (const unit of ["sentence", "none"] as const) {
      const r = await timed(unit);
      const words = align(TEXT, r.duration, r.timings);
      expect(words).toHaveLength(10);
      expect(words.every((w) => w.precision === "interpolated")).toBe(true);
      for (let i = 0; i < words.length; i++) {
        expect(words[i]!.t1).toBeGreaterThanOrEqual(words[i]!.t0);
        if (i) expect(words[i]!.t0).toBeGreaterThanOrEqual(words[i - 1]!.t1);
      }
      expect(words[words.length - 1]!.t1).toBeLessThanOrEqual(r.duration);
    }
  });

  it("keeps sentence boundaries when interpolating", async () => {
    const r = await timed("sentence");
    const sentence2 = r.timings!.items[1]!;
    const that = align(TEXT, r.duration, r.timings).find((w) => w.text === "That")!;
    expect(that.t0).toBeCloseTo(sentence2.t0, 4);
  });
});

describe("scene synthesis", () => {
  const ir = compile(`video 1\nscene s\na = icon:sun\n> First {1}one.\n1 pop a\nwait 1\n> Then {1}two.\n1 pulse a\n`).ir!;

  it("joins speech beats and records their ranges", () => {
    const { text, beats } = sceneText(ir.scenes[0]!);
    expect(text).toBe("First one. Then two.");
    expect(beats.map((b) => text.slice(b.start, b.end))).toEqual(["First one.", "Then two."]);
  });

  it("caches by content: the provider is called once per distinct request", async () => {
    let calls = 0;
    const mock = new MockTtsProvider({ audio: false });
    const counting: TtsProvider = { id: mock.id, capabilities: mock.capabilities, synthesize: (r) => (calls++, mock.synthesize(r)) };
    const cache = new MemoryCache();
    const a = await speakScene(ir.scenes[0]!, ir, { provider: counting, cache });
    const b = await speakScene(ir.scenes[0]!, ir, { provider: counting, cache });
    await speakScene(ir.scenes[0]!, { ...ir, voice: "other" }, { provider: counting, cache });
    expect(calls).toBe(2);
    expect(b).toEqual(a);
  });

  it("round-trips through the file cache", async () => {
    const dir = mkdtempSync(join(tmpdir(), "anim-tts-"));
    try {
      const provider = new MockTtsProvider();
      const first = await speakScene(ir.scenes[0]!, ir, { provider, cache: new FileCache(dir) });
      const again = await speakScene(ir.scenes[0]!, ir, { provider: new MockTtsProvider({ speed: 9 }), cache: new FileCache(dir) });
      // A different provider id means a different key, so check the same provider reads from disk:
      const cached = await speakScene(ir.scenes[0]!, ir, { provider, cache: new FileCache(dir) });
      expect(cached).toEqual(first);
      expect(again.duration).toBeLessThan(first.duration);
      expect(first.src).toMatch(/\.wav$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
