import { compile } from "@anim/compiler";
import { describe, expect, it } from "vitest";
import { motionGroup } from "../src/gallery-motions.js";

const cases = motionGroup().sections.flatMap((s) => s.cases);

describe("motion gallery", () => {
  it("shows every story verb on a tile", () => {
    const text = cases.map((c) => c.script).join("\n");
    for (const verb of ["send", "stream", "visit", "mark", "shake", "drop", "lift", "swap", "set", "count", "strike", "clone", "merge", "frame"]) {
      // As a verb: after an action number or "then", before its targets.
      expect(text.split("\n").some((l) => new RegExp(`^(\\d+ |.* then )?${verb} `).test(l) || l.includes(` then ${verb} `) || l.includes(` ${verb} `)), verb).toBe(true);
    }
    for (const attr of ["carry=", "in=into:", "frame=close", "emphasis=last", "kit "]) expect(text, attr).toContain(attr);
  });

  it("only shows examples that compile without any diagnostics", () => {
    const problems: string[] = [];
    for (const c of cases) {
      const r = compile(c.script, { variants: "exact" });
      const bad = r.diagnostics;
      if (!r.ok || bad.length) problems.push(`${c.id}: ${bad.map((d) => `${d.code} ${d.message}`).join("; ") || "failed"}`);
    }
    expect(problems).toEqual([]);
  });
});
