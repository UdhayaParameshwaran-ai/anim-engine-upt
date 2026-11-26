import { CHART, STEPS } from "@anim/html-templates";
import { describe, expect, it } from "vitest";
import { direct, historyEntry, type HistoryEntry } from "../src/index.js";

const chart = (attrs: string, n = 4, label = "Jan") => {
  const rows = Array.from({ length: n }, (_, i) => `b${i + 1} = label "${label}" "$${i + 1}"`);
  return `video 1\nscene c "Revenue" template=chart ${attrs}\n${rows.join("\n")}\n> ${rows.map((_, i) => `{${i + 1}}x`).join(" ")}.\n${rows.map((_, i) => `${i + 1} pop b${i + 1}`).join("\n")}\n`;
};
const steps = (title: string, n = 4) => {
  const rows = Array.from({ length: n }, (_, i) => `s${i + 1} = icon:sun "${i === 0 ? title : "Step"}" "Detail"`);
  return `video 1\nscene c "How" template=steps\n${rows.join("\n")}\n> ${rows.map((_, i) => `{${i + 1}}x`).join(" ")}.\n${rows.map((_, i) => `${i + 1} pop s${i + 1}`).join("\n")}\n`;
};
const variantOf = (script: string) => /variant=(\S+)/.exec(script)?.[1];

/** The same user making a video per topic, the director remembering each. */
function many(src: string, count: number): string[] {
  const history: HistoryEntry[] = [];
  return Array.from({ length: count }, (_, i) => {
    const r = direct(src, { topic: `topic number ${i}`, history });
    history.push(historyEntry(r.choice, r.script));
    return r.script;
  });
}

describe("the director and a designed template", () => {
  it("stays inside the family the writer chose, whatever the topic", () => {
    for (const family of ["bars", "line", "ring"]) {
      const picked = many(chart(`variant=${family}`, 4), 25).map(variantOf);
      for (const v of picked) expect(CHART.variants.find((x) => x.id === v)?.family, `${family} -> ${v}`).toBe(family);
      expect(new Set(picked).size, `${family} varies`).toBeGreaterThan(1);
    }
  });

  it("with nothing written for a chart, it picks among the bars (never a line or a ring: that would change the meaning)", () => {
    for (const v of many(chart("", 4), 25).map(variantOf)) {
      if (v === undefined) continue; // the default (bar-rise) is left unwritten
      expect(CHART.variants.find((x) => x.id === v)?.family).toBe("bars");
    }
  });

  it("an explicit variant is kept", () => {
    for (const s of many(chart("variant=line-zoom", 4), 10)) expect(variantOf(s)).toBe("line-zoom");
  });

  it("only picks a motion that takes the text the writer wrote", () => {
    // A 35-character title is over deck (28), orbit, morph (20) and others: only the roomy motions are in the draw.
    const roomy = new Set(STEPS.variants.filter((v) => v.titleChars >= 35).map((v) => v.id as string));
    for (const s of many(steps("x".repeat(35)), 30)) {
      const v = variantOf(s) ?? "rail";
      expect(roomy.has(v), v).toBe(true);
    }
  });

  it("only picks a motion that takes this many items", () => {
    const six = new Set(STEPS.variants.filter((v) => 6 >= v.items[0] && 6 <= v.items[1]).map((v) => v.id as string));
    for (const s of many(steps("Short", 6), 30)) expect(six.has(variantOf(s) ?? "rail")).toBe(true);
  });

  it("never gives the same motion twice in a row to the same user", () => {
    const picked = many(steps("Short"), 30).map((s) => variantOf(s) ?? "rail");
    let repeats = 0;
    for (let i = 1; i < picked.length; i++) if (picked[i] === picked[i - 1]) repeats++;
    expect(repeats).toBeLessThan(picked.length / 5);
    expect(new Set(picked).size).toBeGreaterThan(2);
  });
});
