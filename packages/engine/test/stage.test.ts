// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@anim/compiler";
import type { ResolvedTimeline, VideoIR } from "@anim/ir";
import { resolve } from "@anim/timeline";
import { MockTtsProvider, speakVideo } from "@anim/tts";
import { beforeEach, describe, expect, it } from "vitest";
import { exposeForRender, fontFace, Player, Stage, THEMES } from "../src/index.js";
import { countUp } from "../src/widgets.js";

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
    const scale = Number((stage.root.querySelector("[data-camera]") as SVGGElement).style.transform.match(/scale\(([\d.]+)\)/)![1]);
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

describe("grid elements", () => {
  it("count up keeping prefix, suffix and formatting", () => {
    expect(countUp("94M", 0.5)).toBe("47M");
    expect(countUp("$1,250.50", 0.2)).toBe("$250.10");
    expect(countUp("<100", 1)).toBe("<100");
    expect(countUp("n/a", 0.3)).toBe("n/a");
  });

  it("render every rule-book element mid-motion identically however the time is reached", { timeout: 30_000 }, async () => {
    const { ir, tl } = await load("rulebook-gallery.txt");
    const kinds = new Set(ir.scenes.flatMap((s) => s.elements.map((e) => e.kind)));
    for (const k of ["multistat", "gauge", "scorecard", "progress", "body", "quote", "callout", "proscons", "bullets", "numbered", "checklist", "chart", "comparison", "timeline", "funnel", "flowchart", "cycle", "matrix", "image", "avatar", "logo", "map", "video"]) {
      expect(kinds, k).toContain(k);
    }
    // Halfway through every draw: the signature motion is mid-flight.
    const probes = tl.tracks.filter((t) => t.prop === "draw").map((t) => (t.t0 + t.t1) / 2);
    const html = (s: Stage) => s.root.innerHTML.replace(/anim-mark-\d+/g, "anim-mark");
    const fresh = probes.map((t) => {
      const s = new Stage(document.createElement("div"), ir, tl, { autoFit: false });
      s.render(t);
      return html(s);
    });
    const stage = new Stage(container, ir, tl, { autoFit: false });
    for (let f = 0; f <= tl.duration * tl.fps; f += 7) stage.render(f / tl.fps);
    for (const [i, t] of [...probes.entries()].reverse()) {
      stage.render(t);
      expect(html(stage), `t=${t}`).toBe(fresh[i]);
    }
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

describe("looks", () => {
  it("render every example in every look, with the look's fonts declared", { timeout: 60_000 }, async () => {
    const files = ["photosynthesis.txt", "cells.txt", "vaccines-grid.txt", "rulebook-gallery.txt"];
    for (const file of files) {
      const { ir, tl } = await load(file);
      for (const name of Object.keys(THEMES)) {
        const div = document.createElement("div");
        const stage = new Stage(div, ir, tl, { autoFit: false, theme: name, fontBase: "/f/" });
        stage.render(tl.duration * 0.6);
        expect(stage.root.style.background, `${file} in ${name}`).toBeTruthy();
        const css = stage.root.querySelector("style")!.textContent!;
        for (const face of THEMES[name]!.faces) expect(css, `${name} declares ${face}`).toContain(fontFace(face)!.path);
        stage.destroy();
      }
    }
  });

  it("draw a personality's blur entrance as a CSS filter", async () => {
    const src = readFileSync(join(EXAMPLES, "photosynthesis.txt"), "utf8").replace(/^theme .*$/m, "theme tech-neon\nmotion cinematic");
    const ir = compile(src).ir!;
    const tl = resolve(ir, await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) }));
    const blur = tl.tracks.find((t) => t.prop === "blur" && t.t1 > t.t0)!;
    const stage = new Stage(container, ir, tl, { autoFit: false });
    const [scene, id] = blur.target.split("/");
    stage.render((blur.t0 + blur.t1) / 2);
    expect(node(stage, scene!, id!).style.filter).toMatch(/blur\([\d.]+px\)/);
    stage.render(blur.t1 + 0.05);
    expect(node(stage, scene!, id!).style.filter).not.toMatch(/blur/);
  });
});

describe("wipe", () => {
  it("wipe text in with a clip path, never a cover painted in the background color", async () => {
    const { ir, tl } = await load("rulebook-gallery.txt");
    const stage = new Stage(container, ir, tl, { autoFit: false, theme: "soft-pastel" });
    const body = node(stage, "words", "quote");
    expect(body.querySelector("clipPath")).toBeTruthy();
    expect([...body.querySelectorAll("rect")].some((r) => r.getAttribute("fill") === stage.theme.bg)).toBe(false);
  });
});

describe("template structure and looks", () => {
  async function stageOf(src: string, theme?: string): Promise<{ stage: Stage; ir: VideoIR; tl: ResolvedTimeline }> {
    const ir = compile(src).ir!;
    const speech = await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) });
    const tl = resolve(ir, speech);
    return { stage: new Stage(container, ir, tl, { autoFit: false, ...(theme && { theme }) }), ir, tl };
  }
  const CARDS = 'video 1\nscene s "Kinds" template=cards\na = icon:sun "Solar"\nb = icon:wind "Wind"\n> {1}Two kinds.\n1 pop a,b /0.2\n';
  const STEPS = 'video 1\nscene s "Order" template=steps\na = icon:sun "One"\nb = icon:gear "Two"\n> {1}First, then {2}second.\n1 pop a\n2 pop b\n';

  it("draws panels behind the items and badges above them, each shown with its item", async () => {
    const { stage, tl } = await stageOf(STEPS);
    const order = [...stage.root.querySelectorAll('[data-scene="s"] [data-kind]')].map((n) => n.getAttribute("data-kind"));
    // Connectors first, then the items, then their number badges.
    expect(order.indexOf("arrow")).toBeLessThan(order.indexOf("icon"));
    expect(order.lastIndexOf("icon")).toBeLessThan(order.indexOf("badge"));
    const second = firstTween(tl, "s/b", "opacity");
    const badge = [...stage.root.querySelectorAll('[data-scene="s"] [data-kind="badge"]')].find((n) => n.textContent === "2") as SVGGElement & HTMLElement;
    stage.render(second.t0 - 0.05);
    expect(visible(badge)).toBe(false);
    stage.render(second.t1 + 1);
    expect(visible(badge)).toBe(true);
    expect(badge.textContent).toBe("2");

    const cards = await stageOf(CARDS);
    const kinds = [...cards.stage.root.querySelectorAll('[data-scene="s"] [data-kind]')].map((n) => n.getAttribute("data-kind"));
    expect(kinds.filter((k) => k === "panel")).toHaveLength(2);
    expect(kinds.lastIndexOf("panel")).toBeLessThan(kinds.indexOf("icon"));
  });

  it("draws icons in the look's own style, colored from its palette", async () => {
    const backing = (stage: Stage, id: string) => node(stage, "s", id).querySelector("g > circle[data-solid], g > rect[data-solid]");
    const paper = await stageOf(CARDS, "paper");
    expect(backing(paper.stage, "a")!.tagName).toBe("circle");
    // Item 1 takes the accent, item 2 the next palette color.
    expect(backing(paper.stage, "a")!.getAttribute("fill")).toContain(THEMES.paper!.accent);
    expect(backing(paper.stage, "b")!.getAttribute("fill")).toContain(THEMES.paper!.good);
    document.body.innerHTML = "";
    document.body.append(container = document.createElement("div"));
    const blueprint = await stageOf(CARDS, "blueprint");
    expect(backing(blueprint.stage, "a")!.tagName).toBe("rect");
    expect(backing(blueprint.stage, "a")!.getAttribute("stroke")).toBe(THEMES.blueprint!.fg);
    document.body.innerHTML = "";
    document.body.append(container = document.createElement("div"));
    // Hand-drawn looks keep plain line art, in the item's color.
    const chalk = await stageOf(CARDS, "chalk");
    expect(backing(chalk.stage, "a")).toBeNull();
    expect(node(chalk.stage, "s", "a").querySelector("g[stroke]")!.getAttribute("stroke")).toBe(THEMES.chalk!.accent);
  });

  it("keeps an icon and its label together in a tall slot", async () => {
    const { stage, ir } = await stageOf('video 1\nscene s "Page" grid=L2-01\ntitle = title "Page"\np = bullets "One;Two"\ni = icon:check "Done"\n> {1}A page.\n1 draw p\n1 pop i\n');
    const box = ir.scenes[0]!.elements.find((e) => e.id === "i")!.box;
    const label = node(stage, "s", "i").querySelector("text")!;
    const y = Number(/translate\(0 ([-\d.]+)\)/.exec(label.getAttribute("transform")!)![1]);
    // Right under the icon, not at the bottom of the slot.
    expect(y).toBeLessThan(box.h / 2 - 100);
  });
});

describe("life between cues", () => {
  async function stageOf(src: string): Promise<{ stage: Stage; tl: ResolvedTimeline }> {
    const ir = compile(src).ir!;
    const speech = await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) });
    const tl = resolve(ir, speech);
    return { stage: new Stage(container, ir, tl, { autoFit: false }), tl };
  }
  const y = (n: Element) => Number(/translate\([-\d.]+ ([-\d.]+)\)/.exec(n.getAttribute("transform")!)![1]);

  it("lets pictures float once they have appeared, and holds them still under the minimal personality", async () => {
    const src = (motion: string) => `video 1\nmotion ${motion}\nscene s\nx = icon:sun "Sun"\nt = text "Words"\n> A {1}sun, and then a long quiet stretch of narration follows it.\n1 pop x\n1 fade t\n`;
    const { stage, tl } = await stageOf(src("playful"));
    const shown = firstTween(tl, "s/x", "opacity").t1;
    const ys = [1.2, 1.9, 2.6].map((dt) => (stage.render(shown + dt), y(node(stage, "s", "x"))));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
    // Text holds still, and a frame is the same however its time was reached.
    const texts = [1.2, 2.6].map((dt) => (stage.render(shown + dt), y(node(stage, "s", "t"))));
    expect(texts[0]).toBe(texts[1]);
    stage.render(shown + 1.9);
    expect(y(node(stage, "s", "x"))).toBe(ys[1]);
    document.body.innerHTML = "";
    document.body.append((container = document.createElement("div")));
    const calm = await stageOf(src("minimal"));
    const at = firstTween(calm.tl, "s/x", "opacity").t1;
    const still = [1.2, 2.6].map((dt) => (calm.stage.render(at + dt), y(node(calm.stage, "s", "x"))));
    expect(still[0]).toBe(still[1]);
  });

  it("draws list pages as row cards with a marker in each item's color", async () => {
    const { stage } = await stageOf('video 1\ntheme paper\nscene s "Page" grid=L1-01\np = bullets "One thing;Another thing;A third"\n> {1}Three things.\n1 draw p\n');
    const rows = node(stage, "s", "p").querySelectorAll("rect");
    expect(rows).toHaveLength(3);
    const dots = [...node(stage, "s", "p").querySelectorAll("circle")].map((c) => c.getAttribute("fill"));
    expect(dots).toEqual([THEMES.paper!.accent, THEMES.paper!.good, THEMES.paper!.warn]);
  });
});
