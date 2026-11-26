import { CHART, STATS, STEPS } from "@anim/html-templates";
import type { ElementIR, SceneIR } from "@anim/ir";
import { describe, expect, it } from "vitest";
import { compile, report } from "../src/index.js";

/**
 * Scenes drawn by one of the designer's HTML pages (`steps`): nothing of ours is laid out; every declared element is virtual and
 * one page-sized `motion` element hosts the page, with the items' texts as its data.
 */

const STEPS_SCRIPT = [
  'video 1 "Seeds"',
  "theme midnight-luxe",
  "motion cinematic",
  "",
  'scene stages "From seed to tree" template=steps variant=rail',
  'title = title "From seed to tree"',
  's1 = icon:droplet "Water the seed" "Moisture wakes the embryo inside"',
  's2 = icon:sprout "It sprouts" "A root goes down and a shoot goes up"',
  's3 = asset:tree "It grows" "Leaves feed the plant and the trunk thickens"',
  "> {1}Water the seed, {2}it sprouts, {3}and it grows.",
  "1 pop s1",
  "2 pop s2",
  "3 pop s3",
  "",
].join("\n");

function scene(src: string): SceneIR {
  const r = compile(src);
  expect(report(r.diagnostics)).toBe("");
  return r.ir!.scenes[0]!;
}

/** A steps scene with `n` items (and optional extra scene attributes). */
function stepsScene(n: number, id = "stages", attrs = ""): string {
  const ids = Array.from({ length: n }, (_, i) => `s${i + 1}`);
  return [
    'video 1 "T"',
    `scene ${id} "Stages" template=steps ${attrs}`.trimEnd(),
    ...ids.map((s, i) => `${s} = icon:sun "Step ${i + 1}" "What happens in step ${i + 1}"`),
    `> ${ids.map((s, i) => `{${i + 1}}${s}`).join(" ")}.`,
    ...ids.map((s, i) => `${i + 1} pop ${s}`),
    "",
  ].join("\n");
}

const variantOf = (src: string) => scene(src).elements.find((e) => e.kind === "motion")!.params.variant as string;

describe("a steps scene is hosted by the designer's page", () => {
  const s = scene(STEPS_SCRIPT);
  const motion = s.elements.find((e) => e.id === "motion") as ElementIR;

  it("adds one page-sized motion element on the html layer, with the scene's content as data", () => {
    expect(s.elements.filter((e) => e.kind === "motion")).toHaveLength(1);
    expect(motion).toMatchObject({ kind: "motion", layer: "html", box: { x: 0, y: 0, w: 1920, h: 1080 } });
    expect(motion.params).toMatchObject({ template: "steps", variant: "rail", items: "s1,s2,s3" });
    expect(JSON.parse(motion.params.data as string)).toMatchObject({
      heading: "From seed to tree",
      items: [
        { id: "s1", title: "Water the seed", detail: "Moisture wakes the embryo inside", icon: "droplet", kind: "icon" },
        { id: "s2", title: "It sprouts", detail: "A root goes down and a shoot goes up", icon: "sprout", kind: "icon" },
        { id: "s3", title: "It grows", detail: "Leaves feed the plant and the trunk thickens", icon: "tree", kind: "asset" },
      ],
    });
  });

  it("keeps every declared element as a virtual one: zero-size box, nothing drawn", () => {
    const declared = s.elements.filter((e) => e.id !== "motion");
    expect(declared.map((e) => e.id)).toEqual(["title", "s1", "s2", "s3"]);
    for (const e of declared) {
      expect(e.params.virtual, e.id).toBe(true);
      expect(e.box.w, e.id).toBe(0);
      expect(e.box.h, e.id).toBe(0);
    }
    expect(motion.params.virtual).toBeUndefined();
    // No template furniture: the page draws its own numbers, arrows and cards.
    expect(s.elements.filter((e) => ["badge", "panel", "arrow", "line", "chevron", "rule", "kicker"].includes(e.kind))).toEqual([]);
  });

  it("does not fade the page in (the timeline starts it visible): no verb targets it, and the items' verbs follow as written", () => {
    const actions = s.steps[0]!.beats[0]!.actions;
    expect(actions.flatMap((x) => x.calls).filter((c) => c.targets.includes("motion"))).toEqual([]);
    // The scripted verbs on the items still name the items (they only set when each is spoken).
    expect(actions.map((a) => [a.anchor, a.calls[0]!.verb, ...a.calls[0]!.targets])).toEqual([["1", "pop", "s1"], ["2", "pop", "s2"], ["3", "pop", "s3"]]);
  });

  it("takes the detail from the second string of an icon, an asset or a card, and leaves it empty when there is none", () => {
    const mixed = scene('video 1\nscene s template=steps\na = icon:sun "Sun"\nb = card "Moon" "Night"\n> {1}One {2}two.\n1 pop a\n2 pop b\n');
    const data = JSON.parse(mixed.elements.find((e) => e.id === "motion")!.params.data as string);
    expect(data.heading).toBe("");
    expect(data.items.map((i: { title: string; detail: string }) => [i.title, i.detail])).toEqual([["Sun", ""], ["Moon", "Night"]]);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(scene(STEPS_SCRIPT))).toBe(JSON.stringify(scene(STEPS_SCRIPT)));
  });
});

describe("variant choice for a steps scene", () => {
  it("uses the default (rail) when none is named, and a named one when it exists", () => {
    expect(STEPS.defaultVariant).toBe("rail");
    expect(variantOf(stepsScene(3))).toBe("rail");
    for (const v of STEPS.variants) if (v.items[0] <= 4 && v.items[1] >= 4) expect(variantOf(stepsScene(4, "s", `variant=${v.id}`)), v.id).toBe(v.id);
  });

  it("falls back to the default, with a warning, for a variant it does not have", () => {
    const r = compile(stepsScene(3, "s", "variant=zigzag"));
    expect(r.diagnostics.find((d) => d.code === "NAR218")?.message).toMatch(/has no variant `zigzag`/);
    expect(r.ir!.scenes[0]!.elements.find((e) => e.kind === "motion")!.params.variant).toBe("rail");
  });

  it("variant=auto picks a variant whose item range fits, for every item count", () => {
    const fits = (n: number) => STEPS.variants.filter((v) => n >= v.items[0] && n <= v.items[1]).map((v) => v.id);
    for (const n of [2, 3, 4, 5, 6]) {
      for (const id of ["a", "b", "c", "water", "plants", "s1", "s2", "s3", "s4"]) expect(fits(n), `${n} items, scene ${id}`).toContain(variantOf(stepsScene(n, id, "variant=auto")));
    }
    // Orbit needs three items at least: two never get it.
    for (let i = 0; i < 40; i++) expect(variantOf(stepsScene(2, `scene${i}`, "variant=auto"))).not.toBe("orbit");
  });

  it("variant=auto is stable for a scene id, and varies across scenes", () => {
    const pick = (id: string) => variantOf(stepsScene(4, id, "variant=auto"));
    for (const id of ["water", "plants", "x1"]) expect(pick(id)).toBe(pick(id));
    const seen = new Set(Array.from({ length: 30 }, (_, i) => pick(`scene${i}`)));
    expect(seen.size).toBeGreaterThan(2);
  });
});

describe("variant choice by family and by text", () => {
  const chartScene = (attrs: string, label = "Jan", n = 4, id = "c") => {
    const rows = Array.from({ length: n }, (_, i) => `b${i + 1} = label "${i === 0 ? label : `M${i}`}" "$${i + 1}"`);
    return ['video 1 "T"', `scene ${id} "Revenue" template=chart ${attrs}`.trimEnd(), ...rows, `> ${rows.map((_, i) => `{${i + 1}}x`).join(" ")}.`, ...rows.map((_, i) => `${i + 1} pop b${i + 1}`), ""].join("\n");
  };
  const family = (src: string) => CHART.variants.find((v) => v.id === variantOf(src))!.family;

  it("a family names the kind of chart; the motion is picked within it, the same one for the same scene", () => {
    for (const f of ["bars", "line", "ring"]) {
      for (const id of ["a", "b", "revenue", "x9"]) {
        expect(family(chartScene(`variant=${f}`, "Jan", 4, id)), `${f} ${id}`).toBe(f);
        expect(variantOf(chartScene(`variant=${f}`, "Jan", 4, id))).toBe(variantOf(chartScene(`variant=${f}`, "Jan", 4, id)));
      }
    }
  });

  it("with nothing written it is the default (bar-rise); a chart is never a line or a ring by accident", () => {
    expect(variantOf(chartScene(""))).toBe("bar-rise");
    for (let i = 0; i < 30; i++) expect(family(chartScene("variant=auto", "Jan", 4, `s${i}`))).toBe("bars");
  });

  it("a family picks only motions that take the items: a ring with six values is never Activity Rings (five at most)", () => {
    for (let i = 0; i < 40; i++) expect(variantOf(chartScene("variant=ring", "Jan", 6, `s${i}`))).not.toBe("donut-rings");
  });

  it("with no variant written, a text too long for the default moves the scene to a motion of its family that takes it", () => {
    // Odometer (the default) takes a 28-character label; Tape Measure and Liquid Tubes take 40. Swarm (28) would be a different meaning.
    const src = ["video 1", "scene s template=stats", `s1 = icon:user "${"x".repeat(35)}" "21k"`, "> {1}One.", "1 pop s1", ""].join("\n");
    const v = STATS.variants.find((x) => x.id === variantOf(src))!;
    expect(v.family).toBe("figures");
    expect(v.titleChars).toBeGreaterThanOrEqual(35);
    expect(v.id).not.toBe("odometer");
  });
});

describe("a hosted scene that opens a step block right after its declarations", () => {
  it("compiles, with the page and its items, whatever step the first beat is in", () => {
    const src = ['video 1 "T"', 'scene s "Gates" template=steps', 's1 = icon:package "Build" "One package"', 's2 = icon:bug "Test" "Run the tests"', 'step build "Build"', "> {1}Build it, {2}then test it.", "1 pop s1", "2 pop s2", ""].join("\n");
    const r = compile(src);
    expect(report(r.diagnostics)).toBe("");
    const s = r.ir!.scenes[0]!;
    expect(s.steps[0]!.beats).toHaveLength(0);
    expect(s.elements.filter((e) => e.kind === "motion")).toHaveLength(1);
  });
});

describe("what a designed scene asks of its page reaches the page's data", () => {
  const motionData = (src: string) => {
    const r = compile(src);
    expect(report(r.diagnostics)).toBe("");
    return JSON.parse(r.ir!.scenes[0]!.elements.find((e) => e.kind === "motion")!.params.data as string) as { options?: Record<string, unknown>; named?: Record<string, string[]> };
  };

  it("scene attributes (pace, bg, playout, highlight) and a kicker slot", () => {
    const d = motionData(['video 1 "T"', 'scene t "Open" template=title bg=deep playout=true pace=snappy', 'title = title "Hello"', 'kicker = text "Chapter one"', "> Welcome to the first chapter of this explainer.", ""].join("\n"));
    expect(d.options).toEqual({ pace: "snappy", bg: "deep", playout: true });
    expect(d.named).toEqual({ kicker: ["Chapter one"] });
  });

  it("highlight= picks the glowing stat; named cues need no action lines", () => {
    const d = motionData(['video 1 "T"', 'scene s "Users" template=stats highlight=s1', 's1 = icon:user "Q1" "12k"', 's2 = icon:user "Q2" "21k"', "> It began at {s1}twelve thousand and {s2}reached twenty-one.", ""].join("\n"));
    expect(d.options).toEqual({ highlight: "s1" });
  });

  it("nothing asked, nothing sent", () => {
    expect(motionData(stepsScene(2)).options).toBeUndefined();
  });
});
