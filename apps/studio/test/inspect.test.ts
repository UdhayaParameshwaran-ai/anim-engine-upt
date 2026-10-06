import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@anim/compiler";
import { resolve } from "@anim/timeline";
import { MockTtsProvider, speakVideo } from "@anim/tts";
import { describe, expect, it } from "vitest";
import { createEvaluator, inspect, lineAt, sceneAt } from "../src/inspect.js";

async function load(file: string) {
  const src = readFileSync(join(import.meta.dirname, "../../../examples", file), "utf8");
  const ir = compile(src).ir!;
  const tl = resolve(ir, await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) }));
  return { src, ir, tl, ev: createEvaluator(tl) };
}

describe("inspector model", () => {
  it("reports where playback is and what drives each element", async () => {
    const { src, ir, tl, ev } = await load("photosynthesis.txt");
    const pop = tl.tracks.find((t) => t.verb === "pop")!;
    const mid = (pop.t0 + pop.t1) / 2;
    const m = inspect(ir, tl, ev, mid);
    const id = pop.target.split("/")[1]!;
    const el = m.elements.find((e) => e.id === id)!;

    expect(m.scene!.id).toBe(pop.target.split("/")[0]);
    expect(m.beat).toBeDefined();
    expect(el.active).toBe(true);
    expect(el.driver!.verb).toBe("pop");
    expect(el.visible).toBe(true);
    // The editor follows the running action's source line.
    expect(lineAt(m)).toBe(pop.line);
    expect(src.split("\n")[pop.line - 1]).toMatch(/\bpop\b/);

    // Before anything is cued, nothing is visible and nothing is running.
    const start = inspect(ir, tl, ev, 0);
    expect(start.elements.every((e) => !e.visible && !e.active)).toBe(true);
  });

  it("tracks moved and scaled boxes for the overlay", async () => {
    const { ir, tl, ev } = await load("photosynthesis.txt");
    const move = tl.tracks.find((t) => t.verb === "move" && (t.prop === "x" || t.prop === "y") && t.from !== t.to)!;
    expect(move).toBeDefined();
    const id = move.target.split("/")[1]!;
    const center = (t: number) => {
      const b = inspect(ir, tl, ev, t).elements.find((e) => e.id === id)!.box;
      return move.prop === "x" ? b.x + b.w / 2 : b.y + b.h / 2;
    };
    expect(center(move.t0)).toBeCloseTo(move.from as number, 3);
    expect(center(move.t1)).toBeCloseTo(move.to as number, 3);
  });

  it("keeps the last scene on screen after the end", async () => {
    const { tl } = await load("cells.txt");
    expect(sceneAt(tl, tl.duration + 5)?.id).toBe(tl.scenes.at(-1)!.id);
    expect(sceneAt(tl, tl.scenes[1]!.t0)?.id).toBe(tl.scenes[1]!.id);
  });
});
