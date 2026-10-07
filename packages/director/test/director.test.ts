import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@anim/compiler";
import { describe, expect, it } from "vitest";
import { direct, historyEntry, moodOf, type HistoryEntry } from "../src/index.js";

const EXAMPLES = join(import.meta.dirname, "../../../examples");
const script = readFileSync(join(EXAMPLES, "photosynthesis.txt"), "utf8").replace(/^theme .*\n/m, "");

/** One user making `n` videos on related topics, the director remembering each. */
function session(topics: string[], src = script) {
  const history: HistoryEntry[] = [];
  return topics.map((topic) => {
    const r = direct(src, { topic, history });
    history.push(historyEntry(r.choice, r.script));
    return r;
  });
}

describe("style director", () => {
  it("reads the mood of a topic", () => {
    expect(moodOf("Photosynthesis for kids").name).toBe("kids");
    expect(moodOf("How compound interest grows your savings").name).toBe("finance");
    expect(moodOf("How neural networks learn from data").name).toBe("tech");
    expect(moodOf("The fall of the Roman Empire").name).toBe("history");
    expect(moodOf("Something unusual").name).toBe("general");
  });

  it("is deterministic for the same topic and history", () => {
    const run = () => {
      const { script: out, choice } = direct(script, { topic: "How plants make food" });
      return { out, choice };
    };
    expect(run()).toEqual(run());
  });

  it("keeps a user's videos fresh: no look or motion twice in a row, many looks over a session", () => {
    const runs = session(Array.from({ length: 10 }, (_, i) => `How plants make food, part ${i + 1}`));
    const looks = runs.map((r) => r.choice.theme);
    const motions = runs.map((r) => r.choice.motion);
    for (let i = 1; i < runs.length; i++) {
      expect(looks[i], `video ${i + 1}`).not.toBe(looks[i - 1]);
      expect(motions[i], `video ${i + 1}`).not.toBe(motions[i - 1]);
    }
    expect(new Set(looks).size).toBeGreaterThanOrEqual(6);
    expect(new Set(motions).size).toBeGreaterThanOrEqual(4);
  });

  it("matches looks to the mood", () => {
    const kids = session(Array.from({ length: 6 }, (_, i) => `Fun facts about the moon for kids ${i}`));
    const playfulLooks = new Set(["crayon", "soft-pastel", "bold-pop", "chalk"]);
    expect(kids.filter((r) => playfulLooks.has(r.choice.theme)).length).toBeGreaterThanOrEqual(4);
  });

  it("never changes what the user locked, and keeps the script's own fresh choice", () => {
    const locked = session(["a", "b", "c"].map((t) => `Budget basics ${t}`)).map(() => direct(script, { topic: "Budget basics", lock: { theme: "magazine", motion: "minimal" } }));
    for (const r of locked) expect([r.choice.theme, r.choice.motion]).toEqual(["magazine", "minimal"]);
    const own = direct(`video 1 "X"\ntheme blueprint\n${script.split("\n").slice(1).join("\n")}`, { topic: "Anything" });
    expect(own.choice.theme).toBe("blueprint");
  });

  it("varies arrangements and always produces a valid script", () => {
    const grid = readFileSync(join(EXAMPLES, "vaccines-grid.txt"), "utf8");
    const runs = session(Array.from({ length: 8 }, (_, i) => `Why vaccines work ${i}`), grid);
    expect(runs.some((r) => Object.values(r.choice.scenes).some((s) => s.mirror === "true"))).toBe(true);
    for (const r of runs) {
      const c = compile(r.script);
      expect(c.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
      expect(c.ir!.theme).toBe(r.choice.theme);
      expect(c.ir!.motion).toBe(r.choice.motion);
    }
    const variants = session(Array.from({ length: 6 }, (_, i) => `Layouts ${i}`), readFileSync(join(EXAMPLES, "layout-variants.txt"), "utf8").replace(/ variant=\w+/g, ""));
    const used = new Set(variants.flatMap((r) => Object.entries(r.choice.scenes).map(([id, s]) => `${id}:${s.variant ?? ""}`)));
    expect(used.size).toBeGreaterThan(4);
  });
});
