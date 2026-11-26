import { describe, expect, it } from "vitest";
import { CHART, COMPARE, STATS, STEPS, TIMELINE, TITLE, UI, chooseVariant, fitsText, isFamily, motionPool, textLimits, variantChoices, type SceneContent } from "../src/index.js";

const items = (n: number, texts: string[] = ["Jan", "$1"]): SceneContent => ({ items: Array.from({ length: n }, () => texts), slots: {} });
const ids = (r: { pool: { id: string }[] }) => r.pool.map((v) => v.id);

describe("families: what the LLM chooses", () => {
  it("only the sets whose variants differ in meaning have families, and every variant of such a set belongs to one", () => {
    expect([CHART, STATS, COMPARE].map((s) => s.choose)).toEqual(["family", "family", "family"]);
    for (const set of [CHART, STATS, COMPARE]) {
      const known = new Set(set.families!.map((f) => f.id));
      for (const v of set.variants) expect(known.has(v.family ?? ""), `${set.template}:${v.id}`).toBe(true);
      for (const f of set.families!) expect(set.variants.some((v) => v.family === f.id), `${set.template}/${f.id} is empty`).toBe(true);
    }
  });

  it("the three charts are bars, a line and a ring", () => {
    expect(variantChoices(CHART).map((c) => c.id)).toEqual(["bars", "line", "ring"]);
    expect(CHART.variants.filter((v) => v.family === "line").map((v) => v.id)).toEqual(["line-flat", "line-constellation", "line-bars", "line-zoom"]);
  });

  it("steps, title and timeline are chosen by the engine; ui is chosen by variant", () => {
    for (const set of [STEPS, TITLE, TIMELINE]) expect(variantChoices(set), set.template).toEqual([]);
    expect(variantChoices(UI).map((c) => c.id)).toEqual(UI.variants.map((v) => v.id));
  });

  it("knows a family from a variant id", () => {
    expect(isFamily(CHART, "line")).toBe(true);
    expect(isFamily(CHART, "line-flat")).toBe(false);
    expect(isFamily(STEPS, "rail")).toBe(false);
  });
});

describe("motionPool", () => {
  it("a variant id is a pool of one", () => {
    expect(ids(motionPool(CHART, "donut-ticks", items(3)))).toEqual(["donut-ticks"]);
  });

  it("a family is its variants that take this many items", () => {
    // Activity Rings takes five at most.
    expect(ids(motionPool(CHART, "ring", items(5)))).toContain("donut-rings");
    expect(ids(motionPool(CHART, "ring", items(6)))).not.toContain("donut-rings");
    // A line needs three points.
    expect(ids(motionPool(CHART, "line", items(3)))).toHaveLength(4);
    expect(ids(motionPool(CHART, "line", items(2))), "a line with two points has no variant: the pool falls back to the whole family").toHaveLength(4);
  });

  it("a family never leaks into another: bars never draw a ring", () => {
    for (const n of [2, 3, 4, 5, 6]) for (const w of ["bars", "line", "ring"]) expect(motionPool(CHART, w, items(n)).pool.every((v) => v.family === (w === "ring" ? "ring" : w)), `${w} x${n}`).toBe(true);
  });

  it("nothing written, or auto, keeps to the family of the default (bars for a chart), and to everything for a set with no families", () => {
    for (const w of [undefined, "auto"]) expect(motionPool(CHART, w, items(4)).pool.every((v) => v.family === "bars")).toBe(true);
    expect(ids(motionPool(STEPS, undefined, items(4)))).toEqual(STEPS.variants.filter((v) => 4 >= v.items[0] && 4 <= v.items[1]).map((v) => v.id));
  });

  it("drops the variants whose limits the text is over, and says so when none takes it", () => {
    // A 30-character title: morph (20), deck (28) and orbit... cannot; rail (40) can.
    const long = { items: [["x".repeat(30), "detail"], ["B", "C"], ["D", "E"], ["F", "G"]], slots: {} };
    const r = motionPool(STEPS, undefined, long);
    expect(r.fits).toBe(true);
    expect(r.pool.every((v) => v.titleChars >= 30)).toBe(true);
    expect(r.pool.map((v) => v.id)).toContain("rail");
    const tooLong = { items: [["x".repeat(41), "d"], ["B", "C"]], slots: {} };
    expect(motionPool(STEPS, undefined, tooLong).fits).toBe(false);
    expect(motionPool(STEPS, undefined, tooLong).pool.length).toBeGreaterThan(0);
  });

  it("checks the named slots too (a side name, a subtitle)", () => {
    const logo = TITLE.variants.find((v) => v.id === "logo")!;
    expect(fitsText(TITLE, logo, { items: [], slots: { title: "x".repeat(32), subtitle: "ok" } })).toBe(true);
    expect(fitsText(TITLE, logo, { items: [], slots: { title: "x".repeat(33) } })).toBe(false);
    const weight = motionPool(TITLE, undefined, { items: [], slots: { title: "x".repeat(40) } });
    expect(weight.pool.map((v) => v.id)).not.toContain("weight");
    expect(weight.pool.map((v) => v.id)).not.toContain("logo");
  });
});

describe("chooseVariant", () => {
  it("keeps a variant id, and uses the default when nothing is written and it fits", () => {
    expect(chooseVariant(CHART, "bar-led", items(4), 7).id).toBe("bar-led");
    expect(chooseVariant(CHART, undefined, items(4), 7).id).toBe("bar-rise");
    expect(chooseVariant(STEPS, undefined, items(4), 7).id).toBe("rail");
  });

  it("uses another variant when the default does not take the text", () => {
    // No title variant takes 61 characters: it still gets one (the roomiest family of choices), and the validator reports the text.
    expect(chooseVariant(TITLE, undefined, { items: [], slots: { title: "x".repeat(61) } }, 3).id).toBeTruthy();
    expect(chooseVariant(STATS, undefined, { items: [["x".repeat(35), "1"]], slots: {} }, 0).titleChars).toBeGreaterThanOrEqual(35);
  });

  it("a family or auto picks one of its variants, the same one for the same seed, and spreads over the seeds", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const a = chooseVariant(CHART, "line", items(4), seed);
      expect(chooseVariant(CHART, "line", items(4), seed).id).toBe(a.id);
      expect(a.family).toBe("line");
      seen.add(a.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("textLimits", () => {
  it("safe fits every variant of the choice, max fits at least one", () => {
    const all = textLimits(STEPS);
    expect(all.safe).toEqual({ titleChars: Math.min(...STEPS.variants.map((v) => v.titleChars)), detailChars: Math.min(...STEPS.variants.map((v) => v.detailChars)) });
    expect(all.max.titleChars).toBe(40);
    // The bars are roomier than a single variant of them.
    expect(textLimits(CHART, "bars").safe.titleChars).toBeLessThanOrEqual(textLimits(CHART, "bars").max.titleChars);
    expect(textLimits(CHART, "ring").safe.titleChars).toBe(40);
  });
});
