import { SCENE_TRANSITIONS } from "@anim/registry";
import { describe, expect, it } from "vitest";
import { crossLook, type SceneLook } from "../src/transitions.js";

const O = { width: 1920, height: 1080, accent: "#0071e3", cool: "#0a84ff" };
/** A transform that leaves the frame where it is: nothing but no-ops, or a cube's push back and forward around turns that cancel out. */
const resting = (t: string) => {
  const rest = t
    .replace(/translate\(-?0px, -?0px\)|scale\(1\)|rotate[XY]\(-?0deg\)|perspective\([\d.]+px\)/g, "")
    .replace(/rotate([XY])\((-?90)deg\) rotate\1\((-?90)deg\)/g, (m, _a, x, y) => (Number(x) + Number(y) === 0 ? "" : m))
    .replace(/translateZ\(-([\d.]+)px\)\s*translateZ\(\1px\)/g, "")
    .trim();
  return rest === "";
};
const asItself = (l: SceneLook) => {
  expect(l.visible).toBe(true);
  expect(l.opacity).toBeGreaterThan(0.999);
  expect(l.clip).toBe("");
  expect(l.filter).toBe("");
  expect(resting(l.transform), l.transform).toBe(true);
  expect(resting(l.inner), l.inner).toBe(true);
  expect(l.innerFilter).toBe("");
};
const nothingDrawn = (p: number, name: string) => {
  const ov = crossLook(name, p, O).overlays;
  expect([ov.edge, ov.ring, ov.seam, ov.panel, ov.sheen].every((x) => x.length === 0)).toBe(true);
  expect(ov.ripple).toBe(0);
};

describe("the designer's scene transitions", () => {
  for (const { name } of SCENE_TRANSITIONS) {
    it(`${name}: starts on the old scene as it was and ends on the new one as it is, with none of its own pieces left`, () => {
      asItself(crossLook(name, 0, O).a);
      asItself(crossLook(name, 1, O).b);
      nothingDrawn(0, name);
      nothingDrawn(1, name);
    });
  }

  it("covers the old scene halfway through: the panel hides the change behind a block of colour", () => {
    const mid = crossLook("panel", 0.5, O);
    expect(mid.overlays.panel.find(([k]) => k === "clip-path")![1]).toMatch(/inset\(0(%| )/);
    // the scene changes behind it
    expect(crossLook("panel", 0.45, O).a.visible).toBe(true);
    expect(crossLook("panel", 0.55, O).b.visible).toBe(true);
  });

  it("brings the new scene in from the right and moves the old one left, as the designer's default direction does", () => {
    const push = crossLook("push", 0.3, O);
    expect(push.b.transform).toMatch(/^translate\(\d/);
    expect(push.a.transform).toMatch(/^translate\(-\d/);
    expect(push.b.top).toBe(true);
    // slats open strip by strip; the first strips to open are on the right
    const slats = crossLook("slats", 0.15, O).b.clip;
    expect(slats).toMatch(/^path\('M1/);
  });

  it("scales its pieces with the canvas", () => {
    const wide = crossLook("iris", 0.4, O).overlays.ring.find(([k]) => k === "width")![1];
    const small = crossLook("iris", 0.4, { ...O, width: 960, height: 540 }).overlays.ring.find(([k]) => k === "width")![1];
    expect(parseFloat(small)).toBeCloseTo(parseFloat(wide) / 2, 0);
  });
});
