// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@anim/compiler";
import type { ResolvedTimeline, VideoIR } from "@anim/ir";
import { resolve } from "@anim/timeline";
import { MockTtsProvider, speakVideo } from "@anim/tts";
import { beforeEach, describe, expect, it } from "vitest";
import { exposeForRender, Player, Stage } from "../src/index.js";

const EXAMPLES = join(import.meta.dirname, "../../../examples");

async function load(file: string): Promise<{ ir: VideoIR; tl: ResolvedTimeline }> {
  const ir = compile(readFileSync(join(EXAMPLES, file), "utf8")).ir!;
  const speech = await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) });
  return { ir, tl: resolve(ir, speech) };
}

let container: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.append(container);
});

const node = (stage: Stage, scene: string, id: string) => stage.root.querySelector(`[data-scene="${scene}"] [data-id="${id}"]`) as SVGGElement & HTMLElement;
const visible = (n: Element) => (n as HTMLElement).style.visibility !== "hidden" && (n as HTMLElement).style.opacity !== "0";
const firstTween = (tl: ResolvedTimeline, target: string, prop: string) => tl.tracks.find((t) => t.target === target && t.prop === prop)!;

describe("stage", () => {
  it("builds one layer per scene and one node per element", async () => {
    const { ir, tl } = await load("photosynthesis.txt");
    const stage = new Stage(container, ir, tl, { autoFit: false });
    for (const scene of ir.scenes) {
      for (const el of scene.elements) expect(node(stage, scene.id, el.id), `${scene.id}/${el.id}`).toBeTruthy();
    }
    expect(stage.root.querySelectorAll("[data-scene]")).toHaveLength(ir.scenes.length * 2); // svg + html layer
  });

  it("shows elements when their cue is spoken, not before", async () => {
    const { ir, tl } = await load("photosynthesis.txt");
    const stage = new Stage(container, ir, tl, { autoFit: false });
    const pop = firstTween(tl, "need/sun", "scale");
    stage.render(pop.t0 - 0.05);
    expect(visible(node(stage, "need", "sun"))).toBe(false);
    stage.render(pop.t1 + 0.01);
    expect(visible(node(stage, "need", "sun"))).toBe(true);
    expect(node(stage, "need", "sun").getAttribute("transform")).toMatch(/scale\(1\)$/);
  });

  it("renders only the active scene", async () => {
    const { ir, tl } = await load("photosynthesis.txt");
    const stage = new Stage(container, ir, tl, { autoFit: false });
    const [a, b] = tl.scenes;
    stage.render((a!.t0 + a!.t1) / 2);
    expect((stage.root.querySelector('g[data-scene="need"]') as SVGGElement).style.display).toBe("");
    expect((stage.root.querySelector('g[data-scene="output"]') as SVGGElement).style.display).toBe("none");
    stage.render((b!.t0 + b!.t1) / 2);
    expect((stage.root.querySelector('g[data-scene="need"]') as SVGGElement).style.display).toBe("none");
  });

  it("produces the same DOM for a time regardless of how it was reached", async () => {
    const { ir, tl } = await load("photosynthesis.txt");
    const stage = new Stage(container, ir, tl, { autoFit: false });
    const probes = [0.5, 2.3, 4.1, 7.77, 11.2, 15.5, tl.duration - 0.2];
    const fresh = probes.map((t) => {
      const s = new Stage(document.createElement("div"), ir, tl, { autoFit: false });
      s.render(t);
      return s.root.innerHTML;
    });
    // Play forward frame by frame, then seek backwards through the same times.
    for (let f = 0; f <= tl.duration * tl.fps; f += 3) stage.render(f / tl.fps);
    for (const [i, t] of [...probes.entries()].reverse()) {
      stage.render(t);
      expect(stage.root.innerHTML, `t=${t}`).toBe(fresh[i]);
    }
  });

  it("draws strokes progressively and reveals text character by character", async () => {
    const { ir, tl } = await load("photosynthesis.txt");
    const stage = new Stage(container, ir, tl, { autoFit: false });
    const draw = firstTween(tl, "need/leaf", "draw");
    stage.render((draw.t0 + draw.t1) / 2);
    const offsets = [...node(stage, "need", "leaf").querySelectorAll("[data-d]")].map((s) => Number(s.getAttribute("stroke-dashoffset")));
    expect(offsets.every((o) => o > 0 && o < 1)).toBe(true);

    const write = tl.tracks.find((t) => t.target === "need/chl" && t.prop === "reveal" && t.t1 > t.t0)!;
    stage.render((write.t0 + write.t1) / 2);
    const chars = [...node(stage, "need", "chl").querySelectorAll("tspan tspan")];
    const shown = chars.filter((c) => (c as SVGElement).style.opacity !== "0").length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(chars.length);
  });

  it("routes connectors between their endpoints' current boxes", async () => {
    const { ir, tl } = await load("learn-to-code.txt");
    const stage = new Stage(container, ir, tl, { autoFit: false });
    stage.render(tl.duration - 0.1);
    const d = node(stage, "decide", "e1").querySelector("path")!.getAttribute("d")!;
    const [, x0, y0, x1, y1] = d.match(/M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)/)!.map(Number) as number[];
    const n1 = ir.scenes[0]!.elements.find((e) => e.id === "n1")!.box;
    const n2 = ir.scenes[0]!.elements.find((e) => e.id === "n2")!.box;
    expect(y0).toBeGreaterThanOrEqual(n1.y + n1.h); // leaves n1 at its bottom edge
    expect(y1!).toBeLessThanOrEqual(n2.y); // stops above n2
    expect(Math.abs(x1! - (n2.x + n2.w / 2))).toBeLessThan(n2.w / 2);
    void x0;
  });

  it("zooms the camera for a focus step", async () => {
    const { ir, tl } = await load("photosynthesis.txt");
    const stage = new Stage(container, ir, tl, { autoFit: false });
    const cam = firstTween(tl, "need/camera", "camera");
    stage.render(cam.t1 + 0.1);
    const scale = Number((stage.root.querySelector("svg > g") as SVGGElement).style.transform.match(/scale\(([\d.]+)\)/)![1]);
    expect(scale).toBeGreaterThan(1.2);
  });

  it("renders HTML-layer cards and wipes them in", async () => {
    const { ir, tl } = await load("cells.txt");
    const stage = new Stage(container, ir, tl, { autoFit: false });
    const card = node(stage, "recap", "s1");
    expect(card.tagName).toBe("DIV");
    expect(card.textContent).toContain("Plants only");
    stage.render(tl.duration - 0.1);
    expect(visible(card)).toBe(true);
    expect(card.style.transform).toMatch(/^translate\(/);
  });

  it("exposes a frame-stepping hook for the video renderer", async () => {
    const { ir, tl } = await load("cells.txt");
    const stage = new Stage(container, ir, tl, { autoFit: false });
    const box: Record<string, unknown> = {};
    const hook = exposeForRender(stage, box);
    expect(box.__anim).toBe(hook);
    expect(hook.frames).toBe(Math.round(tl.duration * tl.fps));
    hook.frame(hook.frames - 1);
    expect(stage.currentTime).toBeCloseTo((hook.frames - 1) / tl.fps, 6);
  });
});

describe("live player", () => {
  const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
  const twoScenes = () => readFileSync(join(EXAMPLES, "photosynthesis.txt"), "utf8");
  async function timelines() {
    const src = twoScenes();
    const cut = src.indexOf("\nscene ", src.indexOf("\nscene ") + 1);
    const build = async (text: string) => {
      const ir = compile(text).ir!;
      return { ir, tl: resolve(ir, await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) })) };
    };
    return [await build(src.slice(0, cut + 1)), await build(src)] as const;
  }

  it("holds at the end of a growing timeline and resumes when it is extended", async () => {
    const [part, full] = await timelines();
    const waits: boolean[] = [];
    let ended = false;
    const stage = new Stage(container, part.ir, part.tl, { autoFit: false });
    const player = new Player(stage, part.tl, { live: true, onWait: (w) => waits.push(w), onEnd: () => (ended = true) });
    player.seek(part.tl.duration - 0.03);
    player.play();
    await sleep(120);
    expect(player.isWaiting).toBe(true);
    expect(player.isPlaying).toBe(true); // still "playing" from the user's point of view
    expect(player.time).toBeCloseTo(part.tl.duration, 6);
    expect(ended).toBe(false);

    stage.destroy();
    const bigger = new Stage(container, full.ir, full.tl, { autoFit: false });
    await player.extend(bigger, full.tl, true);
    expect(player.isWaiting).toBe(false);
    await sleep(60);
    expect(player.time).toBeGreaterThan(part.tl.duration);
    expect(bigger.currentTime).toBeGreaterThan(part.tl.duration);
    expect(waits).toEqual([true, false]);

    // Final timeline: reaching the end now ends playback.
    player.seek(full.tl.duration - 0.03);
    await sleep(120);
    expect(ended).toBe(true);
    expect(player.isPlaying).toBe(false);
    player.pause();
  });

  it("ends a waiting player when the stream is closed", async () => {
    const [part] = await timelines();
    let ended = false;
    const stage = new Stage(container, part.ir, part.tl, { autoFit: false });
    const player = new Player(stage, part.tl, { live: true, onEnd: () => (ended = true) });
    player.seek(part.tl.duration - 0.02);
    player.play();
    await sleep(100);
    expect(player.isWaiting).toBe(true);
    player.finish();
    expect(ended).toBe(true);
    expect(player.isPlaying).toBe(false);
  });
});
