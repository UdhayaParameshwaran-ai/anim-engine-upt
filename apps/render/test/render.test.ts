import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wav } from "@anim/tts";
import { afterAll, describe, expect, it } from "vitest";
import { launch, mixNarration, parseWav, prepare, probe, psnr, renderFrames, renderVideo } from "../src/index.js";

const dir = mkdtempSync(join(tmpdir(), "anim-render-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// Small canvas and low fps keep the browser tests quick.
const SCRIPT = `video 1 "Render test"
theme paper
size 640x360 15

scene s "Test" in=fade
a = icon:sun
b = box "Box"
x = arrow a->b
> Here is the {1}sun and a {2}box.
1 pop a
2 draw b
2 draw x +0.2
> Notice {1 the box}.
1 highlight b fit
`;

const chrome = await launch()
  .then(async (b) => (await b.close(), true))
  .catch(() => false);

describe("narration mix", () => {
  it("places clips at their timeline positions with silence in between", async () => {
    const rate = 1000;
    const src = join(dir, "clip.wav");
    const samples = new Int16Array(rate).fill(1000); // 1 s of constant signal
    await import("node:fs/promises").then((fs) => fs.writeFile(src, wav(1, rate, samples)));
    const out = join(dir, "mix.wav");
    await mixNarration(
      [
        { src, offset: 0, t0: 0.5, duration: 0.25 },
        { src, offset: 0.25, t0: 2, duration: 0.5 },
      ],
      0,
      3,
      out,
      (n) => join(dir, n),
    );
    const pcm = parseWav(new Uint8Array(readFileSync(out)));
    expect(pcm.samples.length).toBe(3000);
    const at = (t: number) => pcm.samples[Math.round(t * rate)];
    expect([at(0.25), at(0.6), at(1.0), at(2.2), at(2.6)]).toEqual([0, 1000, 0, 1000, 0]);
  });
});

describe.skipIf(!chrome)("video export", () => {
  it(
    "renders an MP4 whose frames match the engine's frames",
    async () => {
      const data = await prepare(SCRIPT, { cacheDir: join(dir, "tts") });
      const out = join(dir, "test.mp4");
      const result = await renderVideo(data, { out, workers: 2 });
      const info = await probe(out);
      expect(info.frames).toBe(result.frames);
      expect(info.frames).toBe(Math.round(data.timeline.duration * data.timeline.fps));
      expect(info.duration).toBeCloseTo(data.timeline.duration, 1);
      expect(info.hasAudio).toBe(true);

      // Frame i of the MP4 is the engine's frame i (up to H.264 loss).
      const probes = [5, Math.floor(info.frames / 2), info.frames - 2];
      const stills = await renderFrames(data, probes, join(dir, "stills"));
      for (const [k, i] of probes.entries()) expect(await psnr(out, i, stills[k]!), `frame ${i}`).toBeGreaterThan(32);
    },
    180_000,
  );

  it(
    "is deterministic across browser sessions",
    async () => {
      const data = await prepare(SCRIPT, { cacheDir: join(dir, "tts") });
      const frames = [0, 12, 24, 40];
      const hash = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
      const a = (await renderFrames(data, frames, join(dir, "run-a"))).map(hash);
      const b = (await renderFrames(data, frames, join(dir, "run-b"))).map(hash);
      expect(b).toEqual(a);
      expect(new Set(a).size).toBeGreaterThan(1); // the frames actually change over time
    },
    120_000,
  );
});
