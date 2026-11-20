// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@anim/compiler";
import type { ResolvedTimeline, VideoIR } from "@anim/ir";
import { resolve } from "@anim/timeline";
import { MockTtsProvider, speakVideo } from "@anim/tts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fmtDuration, SceneGrid, sceneCards, thumbTime } from "../src/scene-grid.js";

const EXAMPLES = join(import.meta.dirname, "../../../examples");

async function load(file: string): Promise<{ src: string; ir: VideoIR; tl: ResolvedTimeline }> {
  const src = readFileSync(join(EXAMPLES, file), "utf8");
  const ir = compile(src).ir!;
  const tl = resolve(ir, await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) }));
  return { src, ir, tl };
}

/** The first `n` scenes only: what the Studio has while a generation is still writing the rest. */
function prefix(ir: VideoIR, tl: ResolvedTimeline, n: number): { ir: VideoIR; tl: ResolvedTimeline } {
  const ids = new Set(tl.scenes.slice(0, n).map((s) => s.id));
  const scenes = tl.scenes.slice(0, n);
  return {
    ir: { ...ir, scenes: ir.scenes.filter((s) => ids.has(s.id)) },
    tl: { ...tl, scenes, duration: scenes.at(-1)!.t1, tracks: tl.tracks.filter((t) => ids.has(t.target.split("/")[0]!)) },
  };
}

describe("sceneCards", () => {
  it("lists every scene in order with its title, source line and a thumbnail moment inside it", async () => {
    const { src, ir, tl } = await load("photosynthesis.txt");
    const cards = sceneCards(ir, tl);
    expect(cards.map((c) => c.id)).toEqual(tl.scenes.map((s) => s.id));
    expect(cards.map((c) => c.index)).toEqual(cards.map((_, i) => i + 1));
    const lines = src.split("\n");
    for (const c of cards) {
      const scene = ir.scenes.find((s) => s.id === c.id)!;
      expect(c.title).toBe(scene.title ?? scene.id);
      expect(c.thumbAt).toBeGreaterThanOrEqual(c.t0);
      expect(c.thumbAt).toBeLessThan(c.t1);
      // The line is in the scene: no earlier than its scene line, and before the next scene starts.
      expect(c.line).toBeGreaterThan(0);
      const sceneLine = lines.findIndex((l) => new RegExp(`^\\s*scene\\s+${c.id}\\b`).test(l)) + 1;
      expect(c.line).toBeGreaterThan(sceneLine);
    }
  });

  it("takes the thumbnail once the last beat has played, clear of the transitions", async () => {
    const { tl } = await load("photosynthesis.txt");
    for (const s of tl.scenes) {
      const t = thumbTime(s);
      expect(t).toBeLessThanOrEqual(s.t1 - s.transitionOut.duration);
      if (s.beats.length) expect(t).toBeGreaterThan(s.beats[0]!.t0);
    }
  });

  it("formats durations as m:ss", () => {
    expect(fmtDuration(0)).toBe("0:00");
    expect(fmtDuration(9.6)).toBe("0:10");
    expect(fmtDuration(75)).toBe("1:15");
  });
});

describe("SceneGrid", () => {
  let list: HTMLElement;
  let count: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = `<span id="count"></span><div id="grid"></div>`;
    list = document.getElementById("grid")!;
    count = document.getElementById("count")!;
  });

  it("shows a card with a snapshot per scene, and jumps or opens the source on click", async () => {
    const { ir, tl } = await load("photosynthesis.txt");
    const seek = vi.fn();
    const select = vi.fn();
    const grid = new SceneGrid(list, { seek, select }, count);
    grid.set(ir, tl);
    await grid.ready();

    const cards = [...list.querySelectorAll<HTMLElement>(".sg-card")];
    expect(cards).toHaveLength(tl.scenes.length);
    expect(count.textContent).toBe(`${tl.scenes.length} scenes`);
    for (const card of cards) expect(card.querySelector(".sg-thumb .sg-shot [data-scene]")).toBeTruthy();
    // The offscreen stage is gone once the snapshots are taken.
    expect(document.querySelectorAll("body > div[aria-hidden]")).toHaveLength(0);

    const second = sceneCards(ir, tl)[1]!;
    cards[1]!.querySelector<HTMLElement>(".sg-open")!.click();
    expect(seek).toHaveBeenCalledWith(second.t0);
    expect(cards[1]!.classList.contains("on")).toBe(true);
    expect(cards.filter((c) => c.classList.contains("on"))).toHaveLength(1);

    cards[1]!.querySelector<HTMLElement>(".sg-src")!.click();
    expect(select).toHaveBeenCalledWith(second.line);
    expect(seek).toHaveBeenCalledTimes(1);
  });

  it("keeps the cards it has when the video grows, and draws only the new ones", async () => {
    const { ir, tl } = await load("photosynthesis.txt");
    const grid = new SceneGrid(list, { seek: () => {}, select: () => {} });
    const first = prefix(ir, tl, 1);
    grid.set(first.ir, first.tl);
    await grid.ready();
    const card = list.querySelector<HTMLElement>(".sg-card")!;
    const shot = card.querySelector(".sg-shot");
    expect(shot).toBeTruthy();

    grid.set(ir, tl);
    await grid.ready();
    expect(list.querySelectorAll(".sg-card")).toHaveLength(tl.scenes.length);
    // Same card, same snapshot: nothing flickers for the scene already shown.
    expect(list.querySelector(".sg-card")).toBe(card);
    expect(card.querySelector(".sg-shot")).toBe(shot);
    expect(list.querySelectorAll(".sg-shot")).toHaveLength(tl.scenes.length);
  });

  it("shows two scenes that share an id as two cards, each jumping to its own start", async () => {
    // Generated scripts can repeat an id (cells.txt has two scenes called "compare").
    const { ir, tl } = await load("photosynthesis.txt");
    const [a, b] = tl.scenes;
    const dupTl = { ...tl, scenes: [a!, { ...b!, id: a!.id }] };
    const dupIr = { ...ir, scenes: [ir.scenes[0]!, { ...ir.scenes[1]!, id: a!.id }] };
    // Each card describes its own scene, not the first one with that id.
    expect(sceneCards(dupIr, dupTl).map((c) => c.title)).toEqual([ir.scenes[0]!.title ?? a!.id, ir.scenes[1]!.title ?? b!.id]);
    const seek = vi.fn();
    const grid = new SceneGrid(list, { seek, select: () => {} });
    grid.set(dupIr, dupTl);
    const cards = list.querySelectorAll<HTMLElement>(".sg-card");
    expect(cards).toHaveLength(2);
    cards[1]!.querySelector<HTMLElement>(".sg-open")!.click();
    expect(seek).toHaveBeenLastCalledWith(b!.t0);
    expect([...cards].map((c) => c.classList.contains("on"))).toEqual([false, true]);
    grid.clear();
  });

  it("draws the snapshots an update cut short", async () => {
    const { ir, tl } = await load("photosynthesis.txt");
    const grid = new SceneGrid(list, { seek: () => {}, select: () => {} });
    grid.set(ir, tl);
    // The next scene arrives before the first snapshot run has finished.
    grid.set(ir, tl);
    await grid.ready();
    expect(list.querySelectorAll(".sg-shot")).toHaveLength(tl.scenes.length);
  });

  it("marks the scene being played and clears", async () => {
    const { ir, tl } = await load("photosynthesis.txt");
    const grid = new SceneGrid(list, { seek: () => {}, select: () => {} }, count);
    grid.set(ir, tl);
    grid.setActive(0);
    expect(list.querySelector(".sg-card.on")?.getAttribute("data-scene")).toBe(tl.scenes[0]!.id);
    grid.setActive(undefined);
    expect(list.querySelector(".sg-card.on")).toBeNull();
    grid.clear();
    await grid.ready();
    expect(list.children).toHaveLength(0);
    expect(count.textContent).toBe("");
  });
});
