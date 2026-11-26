import { findTemplate } from "@anim/registry";
import { describe, expect, it } from "vitest";
import { systemPrompt, templateCard } from "../src/index.js";

const card = (name: string) => templateCard(findTemplate(name)!);
const listed = (name: string) => systemPrompt([]).split("\n").find((l) => l.startsWith(`  ${name.padEnd(10)} `)) ?? "";

describe("what the LLM is offered for variant= on a designed template", () => {
  it("a chart is chosen by what the numbers are, and no motion name is offered", () => {
    const c = card("chart");
    for (const f of ["bars", "line", "ring"]) expect(c).toContain(`  ${f} `);
    for (const motion of ["bar-rise", "line-flat", "donut-focus", "Spring Rise"]) expect(c, motion).not.toContain(motion);
    expect(listed("chart")).toContain("variant=bars|line|ring (by meaning)");
    expect(c).toContain("fit every motion");
  });

  it("stats and compare offer their two meanings", () => {
    expect(listed("stats")).toContain("variant=figures|shares");
    expect(listed("compare")).toContain("variant=sides|verdict");
    expect(card("stats")).toContain("shares");
    expect(card("compare")).toContain("verdict");
  });

  it("steps, title and timeline are left to the engine: nothing to choose, only how much text fits", () => {
    for (const name of ["steps", "title", "timeline"]) {
      expect(card(name), name).toContain("leave variant= out; the engine picks the motion");
      expect(listed(name), name).not.toContain("variant=");
      expect(card(name), name).toMatch(/up to \d+.* fit every motion/);
    }
    for (const motion of ["rail", "deck", "curtain", "camera"]) expect(card("steps") + card("title") + card("timeline")).not.toContain(` ${motion} `);
  });

  it("an interaction is chosen by what is done (each is a different thing to show)", () => {
    for (const v of ["prompt", "click", "toggle", "drag", "swipe"]) expect(card("ui")).toContain(`  ${v}`);
    expect(listed("ui")).toContain("variant=prompt|click|toggle|drag|swipe");
  });

  it("the older templates still list their arrangements", () => {
    expect(listed("cards")).toContain("variants: auto|feature|strip");
    expect(card("cards")).toContain("Variants (leave variant= out unless one clearly suits the content");
  });

  it("no example on a designed card names a motion (they name a meaning)", () => {
    for (const name of ["steps", "title", "timeline", "compare", "stats", "chart", "ui"]) {
      const m = /variant=(\S+)/.exec(findTemplate(name)!.guide.example)?.[1];
      if (m) expect(["sides", "figures", "bars", "prompt"], `${name}: ${m}`).toContain(m);
    }
  });
});

describe("quality: a designed template is not asked for motion verbs", () => {
  const HEADER = 'video 1 "T"';
  const scene = (tpl: string, extra = "") => `scene a "A" template=${tpl}\nx1 = icon:sun "Light" "The leaf catches it"\nx2 = icon:droplet "Water" "Roots lift it"\n> First {x1}light, then {x2}water.\n${extra}`;

  it("steps, timeline and compare show their items by cue alone: no Q4 'only makes things appear'", async () => {
    const { qualityIssues } = await import("../src/index.js");
    const cue = (tpl: string, body: string) => qualityIssues(HEADER, `scene a "A" template=${tpl}\n${body}\n> First {x1}light, then {x2}water.\n`).map((q) => q.code);
    expect(cue("steps", 'x1 = icon:sun "Light" "The leaf catches it"\nx2 = icon:droplet "Water" "Roots lift it"')).not.toContain("Q4");
    expect(cue("timeline", 'x1 = label "1796" "First" "Detail"\nx2 = label "1955" "Second" "Detail"')).not.toContain("Q4");
    expect(cue("compare", 'left = label "A"\nright = label "B"\nx1 = icon:sun "Light" "Day"\nx2 = icon:droplet "Water" "Night"')).not.toContain("Q4");
    void scene;
  });

  it("a layout template that only makes things appear still is", async () => {
    const { qualityIssues } = await import("../src/index.js");
    const codes = qualityIssues(HEADER, 'scene a "A" template=cards\nx1 = icon:sun "Light"\nx2 = icon:droplet "Water"\n> First {1}light, then {2}water.\n1 pop x1\n2 pop x2\n').map((q) => q.code);
    expect(codes).toContain("Q4");
  });
});
