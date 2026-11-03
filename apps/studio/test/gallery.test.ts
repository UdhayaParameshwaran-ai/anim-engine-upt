import { compile } from "@anim/compiler";
import { COMPOSE_PATTERNS, GRID_ELEMENTS, GRID_LAYOUTS, TEMPLATES } from "@anim/registry";
import { describe, expect, it } from "vitest";
import { composeGroup, elementGroup, gridGroup, templateGroup, type Group } from "../src/gallery-cases.js";

const all = (g: Group) => g.sections.flatMap((s) => s.cases);

describe("gallery", () => {
  const groups = [templateGroup("typical"), templateGroup("min"), templateGroup("max"), gridGroup(), elementGroup(), composeGroup()];

  it("covers every template variant, grid layout, element and compose pattern", () => {
    expect(all(groups[0]!).length).toBe(TEMPLATES.reduce((n, t) => n + t.variants.length, 0));
    expect(all(groups[3]!).length).toBe(GRID_LAYOUTS.length);
    expect(all(groups[4]!).length).toBe(GRID_ELEMENTS.length);
    expect(all(groups[5]!).length).toBe(COMPOSE_PATTERNS.length);
  });

  it("only shows examples that compile without errors or fixes", () => {
    const problems: string[] = [];
    for (const g of groups)
      for (const c of all(g)) {
        const r = compile(c.script);
        const bad = r.diagnostics.filter((d) => d.severity === "error" || d.fixed);
        if (!r.ok || bad.length) problems.push(`${g.id}/${c.id}: ${bad.map((d) => `${d.code} ${d.message}`).join("; ") || "failed"}`);
      }
    expect(problems).toEqual([]);
  });
});
