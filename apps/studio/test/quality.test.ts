import { compile } from "@anim/compiler";
import { TEMPLATES, variantGuide, type TemplateManifest } from "@anim/registry";
import { describe, expect, it } from "vitest";
import { templateScript } from "../src/gallery-cases.js";

/**
 * The template quality matrix: every template × variant × item count ×
 * label length, measured by the layout engine instead of by eye.
 */

const UNFIT = new Set(["NAR413", "NAR414", "NAR415"]);

/** Item counts a template allows (flow: node counts). Templates without items have one case. */
function allowed(t: TemplateManifest): number[] {
  const [lo, hi] = t.items ? [t.items.min, t.items.max] : t.graph ? [3, 8] : [0, 0];
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** Item counts a variant promises to lay out cleanly (its card's range, within the template's). */
function promised(t: TemplateManifest, v: string): number[] {
  const r = variantGuide(t, v).items;
  return allowed(t).filter((n) => !r || (n >= r[0] && n <= r[1]));
}

function unfit(script: string, variants: "fit" | "exact"): string[] {
  const r = compile(script, { variants });
  if (!r.ok) return r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code} ${d.message}`);
  return r.diagnostics.filter((d) => UNFIT.has(d.code)).map((d) => `${d.code} ${d.message}`);
}

describe("template cards", () => {
  it("describe every template and every variant", () => {
    for (const t of TEMPLATES) {
      expect(t.guide.useWhen, t.name).toBeTruthy();
      expect(t.guide.avoidWhen, t.name).toBeTruthy();
      for (const v of t.variants) expect(t.guide.variants[v]?.when, `${t.name}:${v}`).toBeTruthy();
      for (const v of Object.keys(t.guide.variants)) expect(t.variants, `${t.name}: card lists unknown variant ${v}`).toContain(v);
    }
  });

  it("have examples that use their template and compile without any diagnostics", () => {
    for (const t of TEMPLATES) {
      expect(t.guide.example, t.name).toMatch(new RegExp(`template=${t.name}\\b`));
      const r = compile(`video 1 "Example"\n\n${t.guide.example}\n`);
      expect(r.diagnostics.map((d) => `${d.code} ${d.message}`), t.name).toEqual([]);
    }
  });
});

describe("fit-based variants", () => {
  const grid = TEMPLATES.find((t) => t.name === "cards")!;
  const steps = TEMPLATES.find((t) => t.name === "steps")!;
  const variantOf = (script: string, variants: "fit" | "exact" = "fit") => {
    const r = compile(script, { variants });
    return { r, used: r.ir!.scenes[0]!.elements.find((e) => e.id === "i1")!.box };
  };

  it("keep a named variant that fits", () => {
    const r = compile(templateScript(steps, "column", 3));
    expect(r.diagnostics).toEqual([]);
  });

  it("replace a named variant that crowds its content, and say so", () => {
    const script = templateScript(steps, "column", 6);
    expect(unfit(script, "exact").length).toBeGreaterThan(0);
    const r = compile(script);
    const switched = r.diagnostics.find((d) => d.code === "NAR416");
    expect(switched?.message).toMatch(/variant `column` does not fit/);
    expect(switched?.fixed).toMatch(/^variant=/);
    expect(r.diagnostics.filter((d) => UNFIT.has(d.code))).toEqual([]);
  });

  it("replace the template default silently when it crowds the content", () => {
    const script = templateScript(steps, "column", 6).replace(" variant=column", "");
    const r = compile(script);
    expect(r.diagnostics.filter((d) => UNFIT.has(d.code) || d.code === "NAR416")).toEqual([]);
  });

  it("variant=auto picks a clean variant, the same one every time", () => {
    for (const n of [2, 5, 9]) {
      const script = templateScript(grid, "auto", n);
      const a = variantOf(script);
      expect(a.r.diagnostics.filter((d) => UNFIT.has(d.code))).toEqual([]);
      expect(variantOf(script).used).toEqual(a.used);
    }
  });

  it("variants: exact keeps the named variant even when it crowds", () => {
    expect(unfit(templateScript(steps, "column", 6), "exact").length).toBeGreaterThan(0);
  });
});

describe("template quality", () => {
  it("every variant lays out cleanly for every item count its card promises (typical labels)", () => {
    const problems: string[] = [];
    for (const t of TEMPLATES)
      for (const v of t.variants)
        for (const n of promised(t, v)) {
          const bad = unfit(templateScript(t, v, n), "exact");
          if (bad.length) problems.push(`${t.name}:${v} ×${n}: ${bad.join("; ")}`);
        }
    expect(problems).toEqual([]);
  });

  it("with fit-based variants, every allowed item count renders cleanly (typical labels)", () => {
    const problems: string[] = [];
    for (const t of TEMPLATES)
      for (const n of allowed(t)) {
        const bad = unfit(templateScript(t, "auto", n), "fit");
        if (bad.length) problems.push(`${t.name} ×${n}: ${bad.join("; ")}`);
      }
    expect(problems).toEqual([]);
  });

  it("with fit-based variants, long labels render cleanly at typical item counts", () => {
    const problems: string[] = [];
    for (const t of TEMPLATES) {
      const counts = allowed(t);
      const n = counts[Math.floor((counts.length - 1) / 2)]!;
      const bad = unfit(templateScript(t, "auto", n, true), "fit");
      if (bad.length) problems.push(`${t.name} ×${n}: ${bad.join("; ")}`);
    }
    expect(problems).toEqual([]);
  });
});

describe("audit regressions", () => {
  it("fits seven dated events with long labels on a timeline", () => {
    const events = ["1969 · ARPANET sends first message", "1983 · TCP/IP becomes standard", "1991 · World Wide Web opens", "2000s · Broadband and mobile spread", "2007 · Smartphones put it in pockets", "2010s · Cloud computing everywhere", "Today · Billions online all day"];
    const decl = events.map((e, i) => `t${i + 1} = box "${e}"`).join("\n");
    const script = `video 1 "T"\n\nscene t "History" template=timeline\n${decl}\n> ${events.map((_, i) => `{${i + 1}}step`).join(" then ")}.\n${events.map((_, i) => `${i + 1} pop t${i + 1}`).join("\n")}\n`;
    expect(unfit(script, "fit")).toEqual([]);
  });
});
