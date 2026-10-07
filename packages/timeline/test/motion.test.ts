import { compile } from "@anim/compiler";
import type { ResolvedTimeline, Tween } from "@anim/ir";
import { MOTIONS } from "@anim/registry";
import { MockTtsProvider, speakVideo } from "@anim/tts";
import { describe, expect, it } from "vitest";
import { EASES, resolve } from "../src/index.js";

const script = (motion?: string) => `video 1 "M"
${motion ? `motion ${motion}\n` : ""}scene a "A"
layout row
sun = icon:sun "Sun"
box = box "Idea"
> The {1}sun and {2}an idea.
1 pop sun
2 fade box
end pulse sun
`;

async function timeline(motion?: string): Promise<ResolvedTimeline> {
  const ir = compile(script(motion)).ir!;
  return resolve(ir, await speakVideo(ir, { provider: new MockTtsProvider({ audio: false }) }));
}
const tracks = (tl: ResolvedTimeline, target: string, prop: string): Tween[] => tl.tracks.filter((t) => t.target === target && t.prop === prop);

describe("motion personalities", () => {
  it("leave older scripts exactly as they were (standard)", async () => {
    // The `motion` line shifts source line numbers by one; everything else must match.
    const noLines = (tl: ResolvedTimeline) => JSON.stringify(tl, (k, v) => (k === "line" ? undefined : v));
    expect(noLines(await timeline())).toBe(noLines(await timeline("standard")));
  });

  it("make the same script move differently", async () => {
    const playful = await timeline("playful");
    const cinematic = await timeline("cinematic");
    const energetic = await timeline("energetic");

    // fade enters by rising (playful), blurring into focus (cinematic) or sliding in (energetic).
    expect(tracks(playful, "a/box", "y")[0]).toMatchObject({ ease: "back" });
    expect(tracks(playful, "a/box", "y")[0]!.from).toBeGreaterThan(tracks(playful, "a/box", "y")[0]!.to as number);
    expect(tracks(cinematic, "a/box", "blur")[0]).toMatchObject({ from: 12, to: 0, ease: "expo" });
    expect(tracks(energetic, "a/box", "x")[0]!.from).toBeLessThan(tracks(energetic, "a/box", "x")[0]!.to as number);

    // pop starts from the personality's scale with its own ease; pulse peaks at its own size.
    expect(tracks(playful, "a/sun", "scale")[0]).toMatchObject({ from: 0.3, ease: "elastic" });
    expect(tracks(cinematic, "a/sun", "scale")[0]).toMatchObject({ from: 1.08, ease: "expo" });
    expect(Math.max(...tracks(energetic, "a/sun", "scale").map((t) => t.to as number))).toBeCloseTo(1.3);
  });

  it("rescale default durations but never the narration", async () => {
    const std = await timeline();
    const slow = await timeline("cinematic");
    const dur = (tl: ResolvedTimeline) => tracks(tl, "a/box", "opacity").map((t) => t.t1 - t.t0)[0]!;
    expect(dur(slow) / dur(std)).toBeCloseTo(1.5, 1);
    // Speech keeps its pace; only the (slower) transition moves where it starts.
    const pace = (tl: ResolvedTimeline) => tl.words.map((w) => +(w.t0 - tl.words[0]!.t0).toFixed(3));
    expect(pace(slow)).toEqual(pace(std));
  });

  it("only use eases the engine knows, and keep progress properties in range", async () => {
    for (const m of MOTIONS) {
      const tl = await timeline(m.name);
      for (const t of tl.tracks) {
        expect(EASES[t.ease], `${m.name}: ${t.ease}`).toBeDefined();
        if (t.prop === "draw" || t.prop === "reveal" || t.prop === "opacity") expect(["spring", "back", "elastic"]).not.toContain(t.ease);
      }
    }
  });

  it("are checked and auto-fixed like any setting", () => {
    const r = compile(script("playfull"));
    expect(r.diagnostics.find((d) => d.code === "NAR214")?.fixed).toBe("used `playful`");
    expect(r.ir!.motion).toBe("playful");
  });
});

describe("scene transitions and backgrounds", () => {
  const two = (head: string, attrs = ["", ""]) => `video 1 "Two"\n${head}scene a "A"${attrs[0]}\nlayout row\ns = icon:sun "Sun"\n> The {1}sun.\n1 pop s\nscene b "B"${attrs[1]}\nlayout row\nt = icon:sun "Sun"\n> Again the {1}sun.\n1 pop t\n`;
  const ir = (src: string) => compile(src).ir!;

  it("keep the original transitions under the standard personality", () => {
    expect(ir(two("")).scenes.map((s) => [s.transitionIn, s.transitionOut])).toEqual([["fade", "cut"], ["fade", "cut"]]);
  });

  it("play each scene's transition as the previous scene's exit", () => {
    const playful = ir(two("motion playful\n"));
    expect(playful.scenes.map((s) => [s.transitionIn, s.transitionOut])).toEqual([["fade", "iris"], ["cut", "fade"]]);
    // An explicit in= moves to the boundary too; an explicit out= is never overridden.
    expect(ir(two("motion playful\n", ["", " in=wipe"])).scenes[0]!.transitionOut).toBe("wipe");
    expect(ir(two("motion playful\n", [" out=slide", " in=wipe"])).scenes[0]!.transitionOut).toBe("slide");
  });

  it("seed backgrounds from the title unless a seed is given", () => {
    const a = ir(two("bg mesh+grain\n"));
    expect(a.background.kinds).toEqual(["mesh", "grain"]);
    expect(ir(two("bg mesh+grain\n").replace('"Two"', '"Other"')).background.seed).not.toBe(a.background.seed);
    expect(ir(two("bg dots seed=42\n")).background).toEqual({ kinds: ["dots"], seed: 42 });
    expect(ir(two("")).background.kinds).toEqual(["auto"]);
  });

  it("fix unknown backgrounds", () => {
    const r = compile(two("bg meshh+grainn seed=3\n"));
    expect(r.diagnostics.find((d) => d.code === "NAR214")?.fixed).toBe("used `mesh+grain`");
    expect(r.ir!.background).toEqual({ kinds: ["mesh", "grain"], seed: 3 });
  });
});
