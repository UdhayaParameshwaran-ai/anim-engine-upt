import { STEPS } from "@anim/html-templates";
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
    expect(JSON.parse(motion.params.data as string)).toEqual({
      heading: "From seed to tree",
      items: [
        { title: "Water the seed", detail: "Moisture wakes the embryo inside", icon: "droplet", kind: "icon" },
        { title: "It sprouts", detail: "A root goes down and a shoot goes up", icon: "sprout", kind: "icon" },
        { title: "It grows", detail: "Leaves feed the plant and the trunk thickens", icon: "tree", kind: "asset" },
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

  it("shows the page with a fade at the scene start, before any item is cued", () => {
    const actions = s.steps[0]!.beats[0]!.actions;
    const first = actions[0]!;
    expect(first.anchor).toBe("start");
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0]).toMatchObject({ verb: "fade", targets: ["motion"], delay: 0 });
    // The scripted verbs on the items follow and still name the items (they only set when each is spoken).
    expect(actions.slice(1).map((a) => [a.anchor, a.calls[0]!.verb, ...a.calls[0]!.targets])).toEqual([["1", "pop", "s1"], ["2", "pop", "s2"], ["3", "pop", "s3"]]);
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
