import { compile, report } from "@anim/compiler";
import { MockTtsProvider, speakVideo } from "@anim/tts";
import { describe, expect, it } from "vitest";
import { resolve } from "../src/index.js";

/** A designed-template scene: the narration names each item where it is said, and there are no action lines. */
const SCRIPT = [
  'video 1 "T"',
  'scene gates "Gates" template=steps',
  's1 = icon:package "Build" "One package"',
  's2 = icon:bug "Test" "Run the tests"',
  'step build "Build"',
  "> With the commit checked out, the runner starts by {s1}building it into one package.",
  'step test "Test"',
  "> Because that build passed, the runner now {s2}runs every test against it.",
  "",
].join("\n");

async function build(src: string) {
  const c = compile(src);
  expect(report(c.diagnostics)).toBe("");
  return resolve(c.ir!, await speakVideo(c.ir!, { provider: new MockTtsProvider({ audio: false }) }));
}

describe("a scene drawn by a designer's page", () => {
  it("has the page on screen from the scene's first frame: it starts visible and nothing fades it in", async () => {
    const tl = await build(SCRIPT);
    expect(tl.initial["gates/motion"]?.opacity).toBe(1);
    expect(tl.tracks.filter((t) => t.target === "gates/motion" && t.prop === "opacity")).toEqual([]);
  });

  it("shows each item at the cue the narration names it with, in the order spoken", async () => {
    const tl = await build(SCRIPT);
    const at = (id: string) => tl.tracks.filter((t) => t.target === `gates/${id}` && t.prop === "opacity" && t.to === 1).map((t) => t.t0);
    for (const id of ["s1", "s2"]) {
      expect(tl.initial[`gates/${id}`]?.opacity, id).toBe(0);
      expect(at(id), id).toHaveLength(1);
    }
    const [c1, c2] = [at("s1")[0]!, at("s2")[0]!];
    expect(c2).toBeGreaterThan(c1);
    // The cue is where the word is spoken: the second sentence starts after the first has been said.
    const words = tl.words.filter((w) => w.scene === "gates");
    expect(words.some((w) => Math.abs(w.t0 - c1) < 0.05)).toBe(true);
    expect(words.some((w) => Math.abs(w.t0 - c2) < 0.05)).toBe(true);
  });

  it("works the same with the older action lines (`1 pop s1`): the time is the cue's", async () => {
    const named = await build(SCRIPT);
    const old = await build(SCRIPT.replace("{s1}", "{1}").replace("{s2}", "{1}").replace('step test "Test"', '1 pop s1\nstep test "Test"') + "1 pop s2\n");
    const first = (tl: typeof named) => tl.tracks.filter((t) => t.target === "gates/s1" && t.prop === "opacity" && t.to === 1)[0]!.t0;
    expect(first(old)).toBeCloseTo(first(named), 5);
  });
});
