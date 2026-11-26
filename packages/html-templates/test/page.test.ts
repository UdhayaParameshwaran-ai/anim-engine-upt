import { describe, expect, it } from "vitest";
import { motionSet, motionVariant, pageData, STEPS, templateUrl, warpTime } from "../src/index.js";

describe("warpTime: scene time to the page's own time", () => {
  // Three items cued at 2s, 5s and 6s of the scene; the page shows them at its own 1s, 3s and 4s.
  const cues = [2, 5, 6];
  const starts = [1, 3, 4];

  it("is the identity when the page has no start times", () => {
    for (const t of [0, 0.5, 3.3, 100]) expect(warpTime(t, cues, null)).toBe(t);
  });

  it("before the first cue runs at the page's own speed, ending at the first item's start", () => {
    expect(warpTime(2, cues, starts)).toBe(1); // the cue lands on the item's start
    expect(warpTime(1.5, cues, starts)).toBeCloseTo(0.5, 10); // slope 1: half a second before the cue
    expect(warpTime(1, cues, starts)).toBeCloseTo(0, 10);
    // It never runs backwards past the page's beginning.
    expect(warpTime(0, cues, starts)).toBe(0);
    expect(warpTime(-3, cues, starts)).toBe(0);
  });

  it("between cues is stretched linearly to fit the narration", () => {
    // 2s..5s of narration play the page's 1s..3s (slope 2/3); 5s..6s play 3s..4s (slope 1).
    expect(warpTime(3.5, cues, starts)).toBeCloseTo(2, 10);
    expect(warpTime(5, cues, starts)).toBeCloseTo(3, 10);
    expect(warpTime(5.5, cues, starts)).toBeCloseTo(3.5, 10);
    expect(warpTime(6, cues, starts)).toBeCloseTo(4, 10);
    // Slower narration than the page: the page is squeezed (slope > 1).
    expect(warpTime(2.5, [2, 3], [1, 5])).toBeCloseTo(3, 10);
  });

  it("after the last cue has slope 1", () => {
    expect(warpTime(7, cues, starts)).toBeCloseTo(5, 10);
    expect(warpTime(106, cues, starts)).toBeCloseTo(104, 10);
  });

  it("is continuous and never decreases", () => {
    let prev = -Infinity;
    for (let t = 0; t <= 9; t += 0.05) {
      const w = warpTime(t, cues, starts);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = w;
    }
  });

  it("skips items whose cue is undefined (the script never shows them)", () => {
    // The second item is never shown: only the first and third make the curve.
    expect(warpTime(2, [2, undefined, 6], starts)).toBe(1);
    expect(warpTime(4, [2, undefined, 6], starts)).toBeCloseTo(2.5, 10); // halfway from 2s/1s to 6s/4s
    expect(warpTime(6, [2, undefined, 6], starts)).toBeCloseTo(4, 10);
    // Nothing shown at all: the page runs at its own speed.
    expect(warpTime(3, [undefined, undefined, undefined], starts)).toBe(3);
    expect(warpTime(3, [], starts)).toBe(3);
  });

  it("ignores cues that would make the page stand still or go back", () => {
    // Two items cued together (a single sentence showing both): the second adds nothing to the curve.
    expect(warpTime(4, [2, 2, 6], [1, 3, 4])).toBeCloseTo(2.5, 10);
    // An item the page shows no later than the one before it is dropped too.
    expect(warpTime(6, [2, 4, 6], [1, 1, 4])).toBeCloseTo(4, 10);
  });
});

describe("pageData: what the designer's page reads", () => {
  const set = STEPS;

  it("gives the steps page its fixed settings, the heading and the items", () => {
    const data = pageData(set, {
      heading: "From seed to tree",
      items: [
        { title: "Water", detail: "Moisture wakes the seed", icon: "droplet", kind: "icon" },
        { title: "Sprout", detail: "A root goes down", icon: "sprout" },
      ],
    });
    expect(data).toEqual({
      pace: "normal",
      motion: "default",
      order: "forward",
      kicker: "",
      heading: "From seed to tree",
      items: [
        { title: "Water", detail: "Moisture wakes the seed", icon: "droplet" },
        { title: "Sprout", detail: "A root goes down", icon: "sprout" },
      ],
    });
  });

  it("falls back to a star for an item with no icon (a card, a placeholder) and drops the kind", () => {
    const data = pageData(set, { heading: "", items: [{ title: "Wall", detail: "", icon: "", kind: "card" }] }) as { items: Record<string, unknown>[] };
    expect(data.items).toEqual([{ title: "Wall", detail: "", icon: "star" }]);
  });

  it("gives the heading and items alone for another template's set", () => {
    const other = { ...set, template: "other" };
    expect(pageData(other, { heading: "H", items: [{ title: "A", detail: "B", icon: "sun" }] })).toEqual({ heading: "H", items: [{ title: "A", detail: "B", icon: "sun" }] });
  });
});

describe("the steps set", () => {
  it("names its variants, and falls back to the default for an unknown one", () => {
    expect(motionSet("steps")).toBe(STEPS);
    expect(motionSet("nothing")).toBeUndefined();
    expect(STEPS.variants.map((v) => v.id)).toEqual(["rail", "deck", "accordion", "path", "stack", "domino", "orbit", "dolly", "morph"]);
    expect(motionVariant(STEPS, "deck").id).toBe("deck");
    expect(motionVariant(STEPS, "zigzag").id).toBe("rail");
    expect(motionVariant(STEPS, undefined).id).toBe("rail");
  });

  it("builds the page url under a base, with the theme", () => {
    const rail = motionVariant(STEPS, "rail");
    expect(templateUrl("https://tpl.anim.local/", STEPS, rail, "daylight-clean")).toBe("https://tpl.anim.local/phase1/process-steps-motion/v3-number-rail.html?embed&paused&theme=daylight-clean");
  });

  it("has measured limits for every variant, and item ranges inside 2 to 6", () => {
    for (const v of STEPS.variants) {
      expect(v.titleChars, v.id).toBeGreaterThan(0);
      expect(v.detailChars, v.id).toBeGreaterThan(0);
      expect(v.items[0], v.id).toBeGreaterThanOrEqual(2);
      expect(v.items[1], v.id).toBeLessThanOrEqual(6);
    }
  });
});
