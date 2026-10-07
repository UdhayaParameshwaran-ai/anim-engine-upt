import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { compile, report } from "@anim/compiler";
import type { ResolvedTimeline, Tween, VideoIR } from "@anim/ir";
import { MockTtsProvider, speakVideo, type MockOptions } from "@anim/tts";
import { describe, expect, it } from "vitest";
import { createEvaluator, resolve, TimelineCodes } from "../src/index.js";

const EXAMPLES = join(import.meta.dirname, "../../../examples");
const examples = readdirSync(EXAMPLES).filter((f) => f.endsWith(".txt"));

async function build(src: string, tts: MockOptions = {}): Promise<{ ir: VideoIR; tl: ResolvedTimeline }> {
  const c = compile(src);
  expect(report(c.diagnostics.filter((d) => d.severity === "error" && !d.fixed))).toBe("");
  const speech = await speakVideo(c.ir!, { provider: new MockTtsProvider({ audio: false, ...tts }) });
  return { ir: c.ir!, tl: resolve(c.ir!, speech) };
}

const scene = (body: string) => `video 1\nscene s\n${body}\n`;
const halfFrame = (tl: ResolvedTimeline) => 0.5 / tl.fps + 1e-9;
const tweens = (tl: ResolvedTimeline, target: string, prop?: string) => tl.tracks.filter((t) => t.target === target && (!prop || t.prop === prop));

describe("narration stays the master clock", () => {
  for (const file of examples) {
    it(`${file}: every cue lands on its word at any speaking speed`, async () => {
      const src = readFileSync(join(EXAMPLES, file), "utf8");
      const durations: number[] = [];
      for (const speed of [0.8, 1, 1.3]) {
        const { tl } = await build(src, { speed });
        durations.push(tl.duration);
        for (const cue of tl.cues) {
          const words = tl.words.filter((w) => w.scene === cue.scene);
          expect(words.some((w) => Math.abs(w.t0 - cue.t) <= halfFrame(tl)), `cue ${cue.scene}:${cue.id} @${cue.t}`).toBe(true);
          if (cue.tEnd !== undefined) expect(words.some((w) => Math.abs(w.t1 - cue.tEnd!) <= halfFrame(tl))).toBe(true);
        }
      }
      expect(durations[0]).toBeGreaterThan(durations[1]!);
      expect(durations[1]).toBeGreaterThan(durations[2]!);
    });
  }

  it("starts each cued action exactly on its word when narration gets longer", async () => {
    const src = readFileSync(join(EXAMPLES, "photosynthesis.txt"), "utf8");
    for (const speed of [1, 1 / 1.2]) {
      const { tl } = await build(src, { speed });
      const word = (text: string) => tl.words.find((w) => w.text === text)!;
      const firstTween = (target: string) => tweens(tl, target).sort((a, b) => a.t0 - b.t0)[0]!;
      expect(Math.abs(firstTween("need/sun").t0 - word("sunlight,").t0)).toBeLessThanOrEqual(halfFrame(tl));
      expect(Math.abs(firstTween("need/water").t0 - word("water,").t0)).toBeLessThanOrEqual(halfFrame(tl));
      expect(Math.abs(firstTween("need/co2").t0 - word("carbon").t0)).toBeLessThanOrEqual(halfFrame(tl));
    }
  });
});

describe("determinism and quantization", () => {
  for (const file of examples) {
    it(`${file}: identical output on every run, all times on frame boundaries`, async () => {
      const src = readFileSync(join(EXAMPLES, file), "utf8");
      const a = (await build(src)).tl;
      const b = (await build(src)).tl;
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const onGrid = (t: number) => Math.abs(t * a.fps - Math.round(t * a.fps)) < 1e-6;
      for (const tw of a.tracks) expect(onGrid(tw.t0) && onGrid(tw.t1), `${tw.target} ${tw.prop}`).toBe(true);
      for (const s of a.scenes) expect(onGrid(s.t0) && onGrid(s.t1)).toBe(true);
      for (const c of a.audio) expect(onGrid(c.t0)).toBe(true);
    });
  }

  it("bakes from-values so evaluation is continuous across handoffs", async () => {
    const src = readFileSync(join(EXAMPLES, "photosynthesis.txt"), "utf8");
    const { tl } = await build(src);
    const ev = createEvaluator(tl);
    const forced = new Set(["pop", "draw", "write"]);
    for (const tw of tl.tracks) {
      if (forced.has(tw.verb) || tw.t0 === 0) continue;
      const before = ev.valueAt(tw.target, tw.prop, tw.t0 - 1e-6);
      expect(tw.from, `${tw.target}.${tw.prop} @${tw.t0} (${tw.verb})`).toEqual(before);
    }
  });
});

describe("timing rules", () => {
  it("inserts silence only when an end-anchored action needs it", async () => {
    const { tl } = await build(scene("a = icon:sun\n> Look at {1}this.\n1 pop a\nend pulse a 2\n> And {1}then.\n1 hide a"));
    const [b1, b2] = tl.scenes[0]!.beats as [ResolvedTimeline["scenes"][0]["beats"][0], ResolvedTimeline["scenes"][0]["beats"][0]];
    expect(b1.hold).toBeGreaterThan(1.5);
    expect(b2.t0).toBe(b1.t1);
    expect(b2.t0).toBeGreaterThanOrEqual(b1.speechEnd + 2);
    expect(tl.report.map((r) => r.code)).toContain(TimelineCodes.HoldInserted);
    // The audio is split at the beat boundary and the second clip is shifted by the hold.
    expect(tl.audio).toHaveLength(2);
    expect(tl.audio[1]!.t0).toBe(b2.t0);
  });

  it("never inserts silence for actions that overrun mid-sentence", async () => {
    const { tl } = await build(scene("a = icon:sun\n> Look at {1}this one.\n1 pop a 3\n> Next.\nend pulse a 0.2"));
    expect(tl.scenes[0]!.beats[0]!.hold).toBe(0);
  });

  it("stretches fit highlights over exactly the spoken span", async () => {
    const { tl } = await build(scene("a = icon:sun\n> Here is {1 the shining sun} today.\nstart pop a\n1 highlight a fit"));
    const cue = tl.cues.find((c) => c.id === "1")!;
    const tint = tweens(tl, "s/a", "tint").sort((x, y) => x.t0 - y.t0);
    expect(tint[0]!.t0).toBe(cue.t);
    expect(tint[tint.length - 1]!.t1).toBe(cue.tEnd);
  });

  it("ends until= actions on the named cue and chains then-calls", async () => {
    const { tl } = await build(scene("a = icon:sun\nb = icon:heart\n> First {1}this, then {2}that.\n1 pop a until=2 then pop b"));
    const c2 = tl.cues.find((c) => c.id === "2")!;
    const popA = tweens(tl, "s/a", "scale")[0]!;
    const popB = tweens(tl, "s/b", "scale")[0]!;
    expect(popA.t1).toBe(c2.t);
    expect(popB.t0).toBe(popA.t1);
  });

  it("staggers multiple targets", async () => {
    const { tl } = await build(scene("a = icon:sun\nb = icon:heart\nc = icon:gear\n> All {1}three.\n1 pop a,b,c /0.2"));
    const starts = ["a", "b", "c"].map((id) => tweens(tl, `s/${id}`, "opacity")[0]!.t0);
    expect(starts[1]! - starts[0]!).toBeCloseTo(0.2, 1);
    expect(starts[2]! - starts[1]!).toBeCloseTo(0.2, 1);
  });

  it("reveals text word by word with write sync=true", async () => {
    const { tl } = await build(scene('t = text "energy is conserved"\n> Remember: {1 energy is conserved}.\n1 write t sync=true'));
    const reveal = tweens(tl, "s/t", "reveal").filter((t) => t.t1 > t.t0);
    expect(reveal).toHaveLength(3);
    const spoken = tl.words.filter((w) => ["energy", "is", "conserved."].includes(w.text));
    reveal.forEach((r, k) => expect(Math.abs(r.t0 - spoken[k]!.t0)).toBeLessThanOrEqual(halfFrame(tl)));
    expect(reveal[2]!.to).toBe(1);
  });

  it("warns when a later action cuts an earlier one short", async () => {
    const { tl } = await build(scene("a = icon:sun\n> Move {1}here and {2}there.\nstart pop a\n1 move a @L 3\n2 move a @R"));
    expect(tl.report.map((r) => r.code)).toContain(TimelineCodes.Overridden);
  });

  it("reports interpolated timing when the provider only gives sentences", async () => {
    const { tl } = await build(readFileSync(join(EXAMPLES, "cells.txt"), "utf8"), { timing: "sentence" });
    expect(tl.report.some((r) => r.code === TimelineCodes.LowPrecision)).toBe(true);
    expect(tl.cues.every((c) => c.precision === "interpolated")).toBe(true);
  });
});

describe("scenes", () => {
  it("lays scenes end to end with transitions, focus and kept elements", async () => {
    const src = `video 1\nscene a\nx = icon:sun\n> {1}Hi.\n1 pop x\nend move x @R\nstep zoom\nfocus x\n> Closer.\nscene b keep=x in=slide\ny = icon:heart @L\n> Still {1}here.\n1 pop y\n`;
    const { tl } = await build(src);
    const [a, b] = tl.scenes as [ResolvedTimeline["scenes"][0], ResolvedTimeline["scenes"][0]];
    expect(b.t0).toBe(a.t1);
    expect(b.transitionIn).toEqual({ type: "slide", duration: 0.6 });
    const cam = tweens(tl, "a/camera", "camera")[0]!;
    expect(cam.t0).toBe(a.steps[1]!.t0);
    expect((cam.to as { w: number }).w).toBeLessThan(1920);
    // x carries its moved position and visibility into scene b.
    const ev = createEvaluator(tl);
    expect(tl.initial["b/x"]).toEqual({ ...tl.initial["b/x"], opacity: 1, x: ev.valueAt("a/x", "x", a.t1) });
  });

  it("fails loudly when a scene has no synthesized speech", async () => {
    const c = compile(scene("a = icon:sun\n> {1}Hi.\n1 pop a"));
    expect(() => resolve(c.ir!, [])).toThrow(/no synthesized speech/);
  });

  for (const file of examples.filter((f) => readFileSync(join(EXAMPLES, f), "utf8").match(/^scene /gm)!.length > 1)) {
    it(`${file}: appending scenes never moves earlier ones (progressive playback)`, async () => {
      const src = readFileSync(join(EXAMPLES, file), "utf8");
      const cut = src.indexOf("\nscene ", src.indexOf("\nscene ") + 1);
      const [prefix, full] = [await build(src.slice(0, cut + 1)), await build(src)];
      const first = prefix.tl.scenes.map((s) => s.id);
      const mine = (tl: ResolvedTimeline) => ({
        // The last scene's closing fade may become a boundary transition; its timing must not change.
        scenes: tl.scenes.filter((s) => first.includes(s.id)).map((s) => ({ ...s, transitionOut: { ...s.transitionOut, type: "" } })),
        tracks: tl.tracks.filter((t) => first.includes(t.target.split("/")[0]!)),
        cues: tl.cues.filter((c) => first.includes(c.scene)),
        audio: tl.audio.slice(0, prefix.tl.audio.length),
      });
      expect(mine(full.tl)).toEqual(mine(prefix.tl));
      expect(full.tl.duration).toBeGreaterThan(prefix.tl.duration);
    });
  }

  it("exposes tracks sorted by start time", async () => {
    const { tl } = await build(readFileSync(join(EXAMPLES, "learn-to-code.txt"), "utf8"));
    const sorted = [...tl.tracks].sort((x: Tween, y: Tween) => x.t0 - y.t0);
    expect(tl.tracks.map((t) => t.t0)).toEqual(sorted.map((t) => t.t0));
  });
});
