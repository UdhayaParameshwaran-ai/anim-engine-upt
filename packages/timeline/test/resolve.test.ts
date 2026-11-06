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
      // A microsecond before a springy tween ends it is still a hair off its end value.
      if (typeof before === "number") expect(tw.from as number, `${tw.target}.${tw.prop} @${tw.t0} (${tw.verb})`).toBeCloseTo(before, 6);
      else expect(tw.from, `${tw.target}.${tw.prop} @${tw.t0} (${tw.verb})`).toEqual(before);
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

describe("template motion", () => {
  const HUB = (motion: string) => `video 1\nmotion ${motion}\nscene s template=hub\ncenter = text "Core"\na = icon:sun "Sun"\nb = icon:heart "Heart"\nc = icon:gear "Gear"\n> {1}Everything {2}connects.\n1 pop center\n2 pop a,b,c /0.1\n`;

  it("brings template items in from the direction their template gives them", async () => {
    const { tl } = await build(HUB("playful"));
    // The top item of a hub starts nearer the center (lower on screen) and moves out to its place.
    const y = tl.tracks.find((t) => t.target === "s/a" && t.prop === "y")!;
    expect(y.from as number).toBeGreaterThan(y.to as number);
    expect(Math.round((y.from as number) - (y.to as number))).toBe(80);
    // Quiet personalities enter in place.
    const calm = await build(HUB("minimal"));
    expect(calm.tl.tracks.filter((t) => t.target === "s/a" && (t.prop === "x" || t.prop === "y"))).toEqual([]);
  });

  it("pushes the camera in slowly for cinematic scenes, unless the script moves it", async () => {
    const { tl } = await build(HUB("cinematic"));
    const cam = tl.tracks.filter((t) => t.prop === "camera");
    expect(cam).toHaveLength(1);
    expect(cam[0]).toMatchObject({ target: "s/camera", t0: tl.scenes[0]!.t0, t1: tl.scenes[0]!.t1, to: { w: 1920 * 0.95 } });
    const plain = await build(HUB("minimal"));
    expect(plain.tl.tracks.filter((t) => t.prop === "camera")).toEqual([]);
    const focused = await build(HUB("cinematic") + "end focus a\n");
    expect(focused.tl.tracks.filter((t) => t.prop === "camera").map((t) => t.verb)).toEqual(["focus"]);
  });

  it("moves the camera in on one scene and back out on the next", async () => {
    const two = `video 1\nmotion corporate\nscene a\nx = icon:sun\n> {1}One.\n1 pop x\nscene b\ny = icon:sun\n> {1}Two.\n1 pop y\n`;
    const { tl } = await build(two);
    const [first, second] = tl.tracks.filter((t) => t.prop === "camera");
    expect((first!.to as { w: number }).w).toBeLessThan(1920);
    expect((second!.from as { w: number }).w).toBeLessThan(1920);
    expect((second!.to as { w: number }).w).toBe(1920);
  });

  it("lifts a highlighted element a little while it is talked about", async () => {
    const { tl } = await build('video 1\nscene s\nx = icon:sun\n> A {1}sun that {2 shines brightly}.\n1 pop x\n2 highlight x fit\n');
    const lift = tl.tracks.filter((t) => t.target === "s/x" && t.prop === "scale" && t.verb === "highlight");
    expect(lift.map((t) => Math.round((t.to as number) * 100) / 100)).toEqual([1.06, 1]);
  });

  it("shows a list revealed item by item, although the list itself was never entered", async () => {
    const { tl } = await build('video 1\nscene s "Page" grid=L1-01\np = bullets "One;Two"\n> {1}First.\n1 draw p.1\n> {1}Second.\n1 draw p.2\n');
    const ev = createEvaluator(tl);
    const first = tl.tracks.find((t) => t.target === "s/p.1" && t.prop === "opacity")!;
    const second = tl.tracks.find((t) => t.target === "s/p.2" && t.prop === "opacity")!;
    expect(ev.valueAt("s/p", "opacity", first.t0 - 0.01)).toBe(0);
    expect(ev.valueAt("s/p", "opacity", first.t0 + 0.01)).toBe(1);
    // The second item waits for its own turn.
    expect(ev.valueAt("s/p.2", "opacity", first.t0 + 0.01)).toBe(0);
    expect(ev.valueAt("s/p.2", "opacity", second.t0 + 0.01)).toBe(1);
  });
});

describe("send", () => {
  const SRC = 'video 1\nscene s "Call" template=exchange\na = icon:globe "Browser"\nb = icon:server "Server"\nm1 = arrow a->b "GET /"\n> The {1}browser and {2}server.\n1 pop a\n2 pop b\n> It {1}sends a request {2}and again.\n1 send m1\n2 send m1\n';

  it("draws a connector that isn't shown yet while its packet travels, and only moves the packet when it is", async () => {
    const { tl } = await build(SRC);
    const draws = tl.tracks.filter((t) => t.target === "s/m1" && t.prop === "draw");
    expect(draws).toHaveLength(1);
    const sends = tl.tracks.filter((t) => t.target === "s/m1" && t.prop === "reveal" && t.meta?.send);
    expect(sends).toHaveLength(2);
    expect(draws[0]!.t0).toBe(sends[0]!.t0);
    expect(sends[1]!.meta).toMatchObject({ send: true, back: false });
  });
});

describe("story motions", () => {
  const HEAD = 'video 1\nscene s "Call" template=exchange\na = icon:globe "Browser"\nb = icon:server "Server"\nm1 = arrow a->b "GET /"\n> The {1}browser and {2}server.\n1 pop a\n2 pop b\n';

  it("send fail=true stops the packet halfway; wait=<s> pauses it there and goes on", async () => {
    const failed = await build(`${HEAD}> It {1}fails.\n1 send m1 fail=true\n`);
    const legs = failed.tl.tracks.filter((t) => t.target === "s/m1" && t.prop === "reveal" && t.meta?.send);
    expect(legs.every((t) => t.meta?.fail === true)).toBe(true);
    expect(Math.max(...legs.map((t) => t.to as number))).toBeCloseTo(0.55);
    const waited = await build(`${HEAD}> It {1}waits.\n1 send m1 wait=1\n`);
    const ws = waited.tl.tracks.filter((t) => t.target === "s/m1" && t.prop === "reveal" && t.meta?.send);
    expect(ws.map((t) => t.to)).toEqual([0.5, 0.5, 1]);
  });

  it("stream sends several packets in a row", async () => {
    const { tl } = await build(`${HEAD}> Traffic {1}flows.\n1 stream m1 count=4\n`);
    const legs = tl.tracks.filter((t) => t.target === "s/m1" && t.prop === "reveal" && t.meta?.send);
    expect(legs).toHaveLength(4);
    expect(legs.every((t) => t.from === 0 && t.to === 1)).toBe(true);
  });

  it("visit moves one ring from element to element; mark leaves a status tint that stays", async () => {
    const { tl } = await build(`${HEAD}> {1}The search starts at the browser and then goes on to the {2}server for a good while, and ends {3}here.\n1 visit a\n2 visit b\n3 mark b as=fail\n`);
    const ev = createEvaluator(tl);
    const on = tl.tracks.find((t) => t.target === "s/a" && t.prop === "tint" && t.to === 1)!;
    const off = tl.tracks.find((t) => t.target === "s/a" && t.prop === "tint" && t.to === 0)!;
    expect(ev.valueAt("s/a", "tint", on.t1 + 0.01)).toBe(1);
    expect(ev.valueAt("s/a", "tint", off.t1 + 0.01)).toBe(0);
    const bad = tl.tracks.filter((t) => t.target === "s/b" && t.prop === "tint").pop()!;
    expect(bad.meta).toMatchObject({ color: "warn" });
    expect(ev.valueAt("s/b", "tint", tl.duration)).toBe(1);
  });

  it("swap trades two elements' places along arcs", async () => {
    const { tl } = await build(`${HEAD}> {1}They swap.\n1 swap a,b\n`);
    const ev = createEvaluator(tl);
    const [ax, bx] = [ev.valueAt("s/a", "x", 0) as number, ev.valueAt("s/b", "x", 0) as number];
    expect(ev.valueAt("s/a", "x", tl.duration)).toBeCloseTo(bx);
    expect(ev.valueAt("s/b", "x", tl.duration)).toBeCloseTo(ax);
  });

  it("drop and lift enter from above and leave upward; shake returns to where it was", async () => {
    const { tl } = await build(`${HEAD}> {1}Drop {2}shake {3}lift.\n1 shake a\n2 lift b\n`);
    const ev = createEvaluator(tl);
    const x0 = ev.valueAt("s/a", "x", tl.tracks.find((t) => t.verb === "shake")!.t0 - 0.01);
    expect(ev.valueAt("s/a", "x", tl.duration)).toBeCloseTo(x0 as number);
    expect(ev.valueAt("s/b", "opacity", tl.duration)).toBe(0);
  });

  it("frame points the camera at the group", async () => {
    const { tl } = await build(`${HEAD}> {1}Look.\n1 frame a,b\n`);
    const cam = tl.tracks.find((t) => t.target === "s/camera" && t.verb === "frame" && t.prop === "camera")!;
    expect(cam).toBeTruthy();
    expect((cam.to as { w: number }).w).toBeLessThanOrEqual(1920);
  });
});
