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
  return loadSource(readFileSync(join(EXAMPLES, file), "utf8"));
}

async function loadSource(src: string): Promise<{ ir: VideoIR; tl: ResolvedTimeline }> {
  const ir = compile(src).ir!;
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
    expect((stage.root.querySelector('[data-scene-frame="need"]') as HTMLElement).style.display).toBe("");
    expect((stage.root.querySelector('[data-scene-frame="output"]') as HTMLElement).style.display).toBe("none");
    stage.render((b!.t0 + b!.t1) / 2);
    expect((stage.root.querySelector('[data-scene-frame="need"]') as HTMLElement).style.display).toBe("none");
  });

  it("shows both scenes while the designer's transition runs between them, and only the new one after it", async () => {
    const { ir, tl } = await load("photosynthesis.txt");
    const stage = new Stage(container, ir, tl, { autoFit: false });
    const [a, b] = tl.scenes;
    const frame = (id: string) => stage.root.querySelector(`[data-scene-frame="${id}"]`) as HTMLElement;
    expect(a!.transitionOut.type).toBe("push");
    // At the boundary the push is under way: the new scene comes in from the right over the old one, which is still there.
    stage.render(a!.t1);
    expect(frame(a!.id).style.display).toBe("");
    expect(frame(b!.id).style.display).toBe("");
    expect(frame(b!.id).style.transform).toMatch(/^translate\(\d/);
    expect(frame(b!.id).style.zIndex).toBe("1");
    stage.render(b!.t0 + b!.transitionIn.duration + 0.05);
    expect(frame(a!.id).style.display).toBe("none");
    expect(frame(b!.id).style.transform).toBe("");
    // the video ends on the look's background: the last scene has defocused away
    stage.render(tl.duration);
    expect(frame(b!.id).style.opacity).toBe("0");
  });

  describe("extend: scenes arrive while the video plays", () => {
    const SRC = (n: number) => {
      const scenes = ["a", "b", "c"].slice(0, n).map((id, i) => `scene ${id} "${id}"\nx${i} = icon:sun "Sun"\nt${i} = text "Words ${i}"\n> A {1}sun ${i}.\n1 pop x${i}\n1 fade t${i}\n`);
      return `video 1\n${scenes.join("\n")}`;
    };
    const normal = (stage: Stage) => stage.root.innerHTML.replace(/anim-mark-\d+/g, "mark");

    it("adds the new scenes to the stage that is playing: the scenes already there keep their layers, and the picture is the one a new stage would draw", async () => {
      const first = await loadSource(SRC(1));
      const full = await loadSource(SRC(3));
      const stage = new Stage(container, first.ir, first.tl, { autoFit: false });
      const layerA = stage.root.querySelector('div[data-scene="a"]');
      const sunA = node(stage, "a", "x0");
      const mid = (full.tl.scenes[0]!.t0 + full.tl.scenes[0]!.t1) / 2;
      stage.render(mid);

      expect(stage.extend(full.ir, full.tl)).toBe(true);
      expect(stage.duration).toBe(full.tl.duration);
      // not rebuilt: the very same nodes (a designer page in them would not reload)
      expect(stage.root.querySelector('div[data-scene="a"]')).toBe(layerA);
      expect(node(stage, "a", "x0")).toBe(sunA);
      expect(stage.root.querySelector('div[data-scene="c"]')).toBeTruthy();

      const fresh = new Stage(document.createElement("div"), full.ir, full.tl, { autoFit: false });
      for (const t of [mid, full.tl.scenes[1]!.t0 + 0.6, full.tl.scenes[2]!.t1 - 0.3]) {
        stage.render(t);
        fresh.render(t);
        expect(normal(stage), `at ${t}`).toBe(normal(fresh));
      }
    });

    it("can be extended again and again", async () => {
      const [one, two, three] = [await loadSource(SRC(1)), await loadSource(SRC(2)), await loadSource(SRC(3))];
      const stage = new Stage(container, one.ir, one.tl, { autoFit: false });
      expect(stage.extend(two.ir, two.tl)).toBe(true);
      expect(stage.extend(three.ir, three.tl)).toBe(true);
      expect(stage.root.querySelectorAll("div[data-scene]").length).toBe(3);
    });

    it("says no when a scene that was already there changed, or the look did: the caller builds a new stage", async () => {
      const first = await loadSource(SRC(1));
      const rewritten = await loadSource(SRC(2).replace('t0 = text "Words 0"', 't0 = text "Other words"'));
      expect(new Stage(container, first.ir, first.tl, { autoFit: false }).extend(rewritten.ir, rewritten.tl)).toBe(false);
      const other = await loadSource(SRC(2).replace("video 1", "video 1\ntheme chalk"));
      expect(new Stage(container, first.ir, first.tl, { autoFit: false }).extend(other.ir, other.tl)).toBe(false);
    });
  });

  it("keeps a waiting hosted page laid out: hidden, never display:none, or weight/reel/logo titles measure nothing", async () => {
    // The page fixes its letter widths on its first frame. An iframe under `display: none` has no layout, so that frame would
    // lock every width at zero (the weight title piled its letters in one spot, the reel title never showed).
    const { ir, tl } = await loadSource(`video 1\nscene a "A" template=title variant=rise\ntitle = title "First"\n> One.\n\nscene b "B" template=title variant=weight\ntitle = title "Gravity"\n> Two.\n\nscene c "C" template=cards\nx = icon:sun "Sun"\n> A {1}sun.\n1 pop x\n`);
    const stage = new Stage(container, ir, tl, { autoFit: false });
    const layer = (id: string) => stage.root.querySelector(`[data-scene-frame="${id}"]`) as HTMLElement;
    stage.render((tl.scenes[0]!.t0 + tl.scenes[0]!.t1) / 2);
    expect(layer("a").style.visibility).toBe("");
    expect(layer("b").style.display).toBe("");
    expect(layer("b").style.visibility).toBe("hidden");
    // A scene that draws no page is removed as before.
    expect(layer("c").style.display).toBe("none");
    stage.render((tl.scenes[1]!.t0 + tl.scenes[1]!.t1) / 2);
    expect(layer("b").style.visibility).toBe("");
    expect(layer("a").style.visibility).toBe("hidden");
  });

  it("produces the same DOM for a time regardless of how it was reached", async () => {
    const { ir, tl } = await load("photosynthesis.txt");
    const stage = new Stage(container, ir, tl, { autoFit: false });
    const probes = [0.5, 2.3, 4.1, 7.77, 11.2, 15.5, tl.duration - 0.2];
    const fresh = probes.map((t) => {
      const s = new Stage(document.createElement("div"), ir, tl, { autoFit: false });
      s.render(t);
      return s.root.innerHTML.replace(/anim-mark-\d+/g, "mark");
    });
    // Play forward frame by frame, then seek backwards through the same times.
    for (let f = 0; f <= tl.duration * tl.fps; f += 3) stage.render(f / tl.fps);
    for (const [i, t] of [...probes.entries()].reverse()) {
      stage.render(t);
      // (each stage numbers its filters, which are the stage's own and the same on every frame)
      expect(stage.root.innerHTML.replace(/anim-mark-\d+/g, "mark"), `t=${t}`).toBe(fresh[i]);
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
    // (cells.txt's recap is a `steps` scene, drawn by an HTML page; a cards template still builds each card as a DOM node.)
    const { ir, tl } = await loadSource('video 1\nscene recap "Recap" template=cards\ns1 = card "Wall" "Plants only"\ns2 = card "Chloroplasts" "Plants only"\ns3 = card "Membrane" "Both"\n> Remember: the {1}wall and the {2}chloroplasts belong to plants, but {3}both have a membrane.\n1 pop s1\n2 pop s2\n3 pop s3 then pulse s3\n');
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
  // (`steps` is drawn by an HTML page now; a timeline still has its axis behind the items and a dot above each.)
  const LINE = 'video 1\nscene s "Order" template=timeline\na = icon:sun "One"\nb = icon:gear "Two"\n> {1}First, then {2}second.\n1 pop a\n2 pop b\n';

  it("draws connector labels above the nodes, shown and hidden with their connector", async () => {
    const { stage, tl } = await stageOf('video 1\nscene s "Flow" template=flow\na = node "Start"\nb = node "End"\ne = a -> b "next step"\n> {1}From start {2}to end.\n1 pop a,b\n2 draw e\n');
    const layer = stage.root.querySelector('[data-scene="s"] [data-layer="labels"]')!;
    expect(layer).not.toBeNull();
    // The label layer is the last thing in the scene, above every node.
    expect(layer.parentElement!.lastElementChild).toBe(layer);
    const label = layer.querySelector("text") as SVGTextElement;
    expect(label.textContent).toBe("next step");
    const draw = firstTween(tl, "s/e", "opacity");
    stage.render(draw.t0 - 0.05);
    expect(label.style.visibility).toBe("hidden");
    stage.render(tl.duration - 0.05);
    expect(label.style.visibility).toBe("");
    expect(Number(label.style.opacity)).toBeGreaterThan(0.9);
  });

  it("glows a highlighted picture but never its label text", async () => {
    const { stage, tl } = await stageOf(CARDS + "> {1}Look at this one.\n1 visit a\n");
    const v = tl.tracks.find((t) => t.target === "s/a" && t.prop === "tint" && t.to === 1)!;
    stage.render(v.t1 + 0.05);
    const a = node(stage, "s", "a");
    const kids = [...a.children] as SVGElement[];
    const picture = kids.find((k) => k.tagName.toLowerCase() !== "text")!;
    const label = kids.find((k) => k.tagName.toLowerCase() === "text")!;
    expect(picture.style.filter).toContain("drop-shadow");
    expect(label.style.filter ?? "").toBe("");
    expect(a.style.filter ?? "").not.toContain("drop-shadow");
  });

  it("draws panels behind the items and badges above them, each shown with its item", async () => {
    const { stage, tl } = await stageOf(LINE);
    const order = [...stage.root.querySelectorAll('[data-scene="s"] [data-kind]')].map((n) => n.getAttribute("data-kind"));
    // The axis first, then the items, then their dots.
    expect(order.indexOf("rule")).toBeLessThan(order.indexOf("icon"));
    expect(order.lastIndexOf("icon")).toBeLessThan(order.indexOf("badge"));
    const second = firstTween(tl, "s/b", "opacity");
    const badge = [...stage.root.querySelectorAll('[data-scene="s"] [data-kind="badge"]')][1] as SVGGElement & HTMLElement;
    stage.render(second.t0 - 0.05);
    expect(visible(badge)).toBe(false);
    stage.render(second.t1 + 1);
    expect(visible(badge)).toBe(true);

    const cards = await stageOf(CARDS);
    const kinds = [...cards.stage.root.querySelectorAll('[data-scene="s"] [data-kind]')].map((n) => n.getAttribute("data-kind"));
    expect(kinds.filter((k) => k === "panel")).toHaveLength(2);
    expect(kinds.lastIndexOf("panel")).toBeLessThan(kinds.indexOf("icon"));
  });

  it("draws icons in the look's own style, colored from its palette", async () => {
    const backing = (stage: Stage, id: string) => node(stage, "s", id).querySelector("g > circle[data-solid], g > rect[data-solid]");
    const paper = await stageOf(CARDS, "paper");
    expect(backing(paper.stage, "a")!.tagName).toBe("circle");
    // Item 1 takes the accent, item 2 the next palette color, which is never the look's ok-green.
    expect(backing(paper.stage, "a")!.getAttribute("fill")).toContain(THEMES.paper!.accent);
    expect(backing(paper.stage, "b")!.getAttribute("fill")).not.toContain(THEMES.paper!.good);
    expect(backing(paper.stage, "b")!.getAttribute("fill")).not.toBe(backing(paper.stage, "a")!.getAttribute("fill"));
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
    // Each item has its own color, and none of them is the ok-green or the fail-red.
    expect(dots[0]).toBe(THEMES.paper!.accent);
    expect(new Set(dots).size).toBe(3);
    for (const d of dots) expect([THEMES.paper!.good, THEMES.paper!.warn]).not.toContain(d);
  });
});

describe("tech elements", () => {
  async function stageOf(src: string): Promise<{ stage: Stage; tl: ResolvedTimeline }> {
    const ir = compile(src).ir!;
    const speech = await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) });
    const tl = resolve(ir, speech);
    return { stage: new Stage(container, ir, tl, { autoFit: false }), tl };
  }

  it("moves a packet along a connector while it is sent, and hides it afterwards", async () => {
    const { stage, tl } = await stageOf('video 1\nscene s "Call" template=exchange\na = icon:globe "Browser"\nb = icon:server "Server"\nm1 = arrow a->b "GET /"\n> The {1}browser asks the {2}server.\n1 pop a,b\n2 send m1\n');
    const send = tl.tracks.find((t) => t.target === "s/m1" && t.meta?.send)!;
    const token = node(stage, "s", "m1").querySelector("circle")!;
    stage.render((send.t0 + send.t1) / 2);
    expect(token.getAttribute("opacity")).toBe("1");
    const mid = Number(token.getAttribute("cx"));
    stage.render(send.t0 + (send.t1 - send.t0) * 0.9);
    expect(Number(token.getAttribute("cx"))).toBeGreaterThan(mid);
    stage.render(send.t1 + 0.5);
    expect(token.getAttribute("opacity")).toBe("0");
  });

  it("draws code as a dark panel whose lines type in and can be highlighted", async () => {
    const { stage, tl } = await stageOf('video 1\nscene s "Code" template=code\ncode = code "const a = 1;\\nreturn a;" lang=js\n> First {1}a constant, {2 then we return it}.\n1 write code.1\n2 highlight code.2 fit\n');
    const lines = node(stage, "s", "code").querySelectorAll("[data-part]");
    expect(lines).toHaveLength(2);
    const hl = tl.tracks.find((t) => t.target === "s/code.2" && t.prop === "tint")!;
    stage.render(hl.t0 + 0.3);
    expect(Number(lines[1]!.querySelector("[data-bar]")!.getAttribute("opacity"))).toBeGreaterThan(0.2);
    // "const" is a keyword: colored differently from the variable name.
    const spans = [...lines[0]!.querySelectorAll("tspan")];
    expect(spans[0]!.getAttribute("fill")).not.toBe(spans[6]!.getAttribute("fill"));
  });
});

describe("value verbs", () => {
  async function stageOf(src: string): Promise<{ stage: Stage; tl: ResolvedTimeline }> {
    const ir = compile(src).ir!;
    const speech = await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) });
    const tl = resolve(ir, speech);
    return { stage: new Stage(container, ir, tl, { autoFit: false }), tl };
  }
  // Wrapped text is one tspan per line: compare without spaces.
  const textOf = (n: Element) => (n.querySelector("text")?.textContent ?? "").replace(/\s+/g, "");
  const HEAD = 'video 1\nscene s "V" template=cards\nstatus = box "200 OK"\nhits = box "0"\nold = box "v1"\n';

  it("set changes an element's text in place, from the peak of its bump on (also when seeking back)", async () => {
    const { stage, tl } = await stageOf(`${HEAD}> {1}A status, then {2}it changes.\n1 pop status\n2 set status to="404 Not Found"\n`);
    const bump = tl.tracks.find((t) => t.target === "s/status" && t.meta?.set !== undefined)!;
    const n = node(stage, "s", "status");
    stage.render(bump.t0 - 0.05);
    expect(textOf(n)).toBe("200OK");
    stage.render(bump.t1 + 0.05);
    expect(textOf(n)).toBe("404NotFound");
    stage.render(bump.t0 - 0.05);
    expect(textOf(n)).toBe("200OK");
  });

  it("count runs a number up in the element's text and ends on the final value", async () => {
    const { stage, tl } = await stageOf(`${HEAD}> {1}A counter, then {2}it counts.\n1 pop hits\n2 count hits from=0 to=100 suffix=" ms"\n`);
    const c = tl.tracks.find((t) => t.target === "s/hits" && t.prop === "count")!;
    const n = node(stage, "s", "hits");
    stage.render(c.t0 + (c.t1 - c.t0) * 0.3);
    const mid = parseInt(textOf(n), 10);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);
    stage.render(c.t1 + 0.1);
    expect(textOf(n)).toBe("100ms");
  });

  it("strike draws a line across the element and dims it", async () => {
    const { stage, tl } = await stageOf(`${HEAD}> {1}An option, then {2}it is struck out.\n1 pop old\n2 strike old\n`);
    const s = tl.tracks.find((t) => t.target === "s/old" && t.prop === "strike")!;
    const line = node(stage, "s", "old").querySelector("line")!;
    stage.render(s.t0 - 0.05);
    expect(line.style.opacity).toBe("0");
    stage.render(s.t1 + 0.05);
    expect(line.style.opacity).toBe("1");
    expect(line.getAttribute("stroke-dashoffset")).toBe("0");
  });
});

describe("decor kits", () => {
  async function connectorOf(kit: string): Promise<SVGPathElement> {
    const ir = compile(`video 1\ntheme light\nkit ${kit}\nscene s "C" template=exchange\na = icon:globe "A"\nb = icon:server "B"\nm1 = arrow a->b "GET"\n> {1}Hi {2}there.\n1 pop a,b\n2 draw m1\n`).ir!;
    const speech = await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) });
    const stage = new Stage(container, ir, resolve(ir, speech), { autoFit: false });
    return node(stage, "s", "m1").querySelector("path")! as unknown as SVGPathElement;
  }

  it("draws connectors dashed, thick or dotted by kit (dashes in path-length units)", async () => {
    const plain = await connectorOf("plain");
    const dashed = await connectorOf("dashed");
    const bold = await connectorOf("bold");
    const soft = await connectorOf("soft");
    expect(plain.getAttribute("data-dash")).toBeNull();
    expect(dashed.getAttribute("data-dash")).toBe("0.025 0.02");
    expect(Number(bold.getAttribute("stroke-width"))).toBeGreaterThan(Number(soft.getAttribute("stroke-width")) * 0.9);
    expect(soft.getAttribute("stroke-linecap")).toBe("round");
    expect(soft.getAttribute("data-dash")).toBe("0.002 0.022");
  });
});

describe("code panels", () => {
  async function stageOf(src: string): Promise<{ stage: Stage; tl: ResolvedTimeline }> {
    const ir = compile(src).ir!;
    const speech = await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) });
    const tl = resolve(ir, speech);
    return { stage: new Stage(container, ir, tl, { autoFit: false }), tl };
  }
  const SRC = (code: string, extra = "", actions = "1 fade code\n") => `video 1\nscene s "Code" template=code\ncode = ${code}${extra}\n> {1}One, {2}two, {3}three.\n${actions}`;
  const LONG = 'code "a = 1\\nb = 2\\nc = 3\\nd = 4"';
  const bar = (stage: Stage, i: number) => Number(node(stage, "s", "code").querySelectorAll("[data-part]")[i]!.querySelector("[data-bar]")!.getAttribute("opacity"));
  const partOpacity = (stage: Stage, i: number) => Number((node(stage, "s", "code").querySelectorAll("[data-part]")[i] as SVGElement).style.opacity || 1);

  it("picks a look that suits the snippet unless one is named", async () => {
    const el = async (src: string) => (await stageOf(src)).stage;
    const fill = async (src: string) => node(await el(src), "s", "code").querySelector("rect")!.getAttribute("fill");
    expect(await fill(SRC('terminal "$ ls\\nfile"'))).toBe("#080b08");
    expect(await fill(SRC(LONG, " lang=py", "1 fade code\n"))).toBe("#0f1623");
    expect(await fill(SRC(LONG, " lang=py look=light"))).toBe("#fbfbfc");
    // A config file gets a tab with its file name; a few lines get a card without a title bar.
    expect(node(await el(SRC(LONG, " lang=yaml")), "s", "code").textContent).toContain("main.yaml");
    expect(node(await el(SRC(LONG, " lang=yaml file=ci.yml")), "s", "code").textContent).toContain("ci.yml");
    expect(node(await el(SRC('code "a = 1\\nb = 2"', " lang=py")), "s", "code").querySelectorAll("circle")).toHaveLength(0);
    expect(node(await el(SRC(LONG, " lang=py")), "s", "code").querySelectorAll("circle")).toHaveLength(3);
  });

  it("crosses a line out in red and signs it; a line marked ok gets a green plus", async () => {
    const { stage, tl } = await stageOf(SRC(LONG, " lang=py", "1 fade code then strike code.2\n2 mark code.3 as=ok\n"));
    const tw = tl.tracks.find((t) => t.target === "s/code.2" && t.prop === "strike")!;
    expect(tw).toBeDefined();
    stage.render(tw.t1 + 0.1);
    const parts = node(stage, "s", "code").querySelectorAll("[data-part]");
    expect(parts[1]!.querySelector("[data-sign]")!.textContent).toBe("−");
    expect(Number(parts[1]!.querySelector("[data-strike]")!.getAttribute("width"))).toBeGreaterThan(20);
    const ok = tl.tracks.find((t) => t.target === "s/code.3" && t.prop === "tint")!;
    stage.render(ok.t1 + 0.1);
    expect(parts[2]!.querySelector("[data-sign]")!.textContent).toBe("+");
    expect(bar(stage, 2)).toBeGreaterThan(0.2);
  });

  it("lights one line at a time: visiting the next releases the last", async () => {
    const { stage, tl } = await stageOf(SRC(LONG, " lang=py", "1 fade code\n1 visit code.1\n2 visit code.3\n"));
    const second = tl.tracks.find((t) => t.target === "s/code.3" && t.prop === "tint" && t.to === 1)!;
    stage.render(second.t1 + 0.4);
    expect(bar(stage, 0)).toBeLessThan(0.02);
    expect(bar(stage, 2)).toBeGreaterThan(0.2);
    expect(node(stage, "s", "code").querySelectorAll("[data-part]")[2]!.querySelector("[data-sign]")!.textContent).toBe("▶");
  });

  it("a walk-through keeps the other lines dim", async () => {
    const { stage, tl } = await stageOf(SRC(LONG, " lang=py anim=walk", "1 fade code then visit code.2\n"));
    const v = tl.tracks.find((t) => t.target === "s/code.2" && t.prop === "tint")!;
    stage.render(v.t1 + 0.2);
    expect(partOpacity(stage, 1)).toBeCloseTo(1, 1);
    expect(partOpacity(stage, 0)).toBeLessThan(0.5);
  });

  it("types with a caret after the last typed character, or brings whole lines in with anim=lines", async () => {
    const typed = await stageOf(SRC('code "ab cd"', " lang=py", "1 write code.1\n"));
    const w = typed.tl.tracks.find((t) => t.target === "s/code.1" && t.prop === "reveal")!;
    typed.stage.render((w.t0 + w.t1) / 2);
    const part = node(typed.stage, "s", "code").querySelector("[data-part]")!;
    expect(Number(part.querySelector("[data-caret]")!.getAttribute("opacity"))).toBeGreaterThan(0.5);
    const whole = await stageOf(SRC('code "ab cd"', " lang=py anim=lines", "1 write code.1\n"));
    const w2 = whole.tl.tracks.find((t) => t.target === "s/code.1" && t.prop === "reveal")!;
    whole.stage.render(w2.t0 + (w2.t1 - w2.t0) * 0.3);
    const shown = [...node(whole.stage, "s", "code").querySelectorAll("[data-part] tspan")].filter((t) => (t as SVGElement).style.opacity === "1");
    expect(shown.length).toBe(4);
    expect(node(whole.stage, "s", "code").querySelector("[data-caret]")!.getAttribute("opacity")).toBe("0");
  });
});
