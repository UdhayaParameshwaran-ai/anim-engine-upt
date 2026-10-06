import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Box, ElementIR, VideoIR } from "@anim/ir";
import { describe, expect, it } from "vitest";
import { compile, report } from "../src/index.js";

const EXAMPLES = join(import.meta.dirname, "../../../examples");
const example = (name: string) => readFileSync(join(EXAMPLES, name), "utf8");

function ir(src: string): VideoIR {
  const r = compile(src);
  expect(report(r.diagnostics)).toBe("");
  return r.ir!;
}

function el(v: VideoIR, scene: string, id: string): ElementIR {
  return v.scenes.find((s) => s.id === scene)!.elements.find((e) => e.id === id)!;
}

const cx = (b: Box) => b.x + b.w / 2;
const cy = (b: Box) => b.y + b.h / 2;

describe("examples", () => {
  for (const file of readdirSync(EXAMPLES).filter((f) => f.endsWith(".txt"))) {
    it(`${file} compiles with no diagnostics, deterministically, inside the canvas`, () => {
      const a = ir(example(file));
      const b = ir(example(file));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      for (const scene of a.scenes) {
        for (const e of scene.elements) {
          expect(e.box.w, e.id).toBeGreaterThan(0);
          expect(e.box.x, e.id).toBeGreaterThanOrEqual(0);
          expect(e.box.y, e.id).toBeGreaterThanOrEqual(0);
          expect(e.box.x + e.box.w, e.id).toBeLessThanOrEqual(a.canvas.width);
          expect(e.box.y + e.box.h, e.id).toBeLessThanOrEqual(a.canvas.height);
        }
      }
    });
  }
});

describe("layout", () => {
  it("keeps free elements off explicitly placed ones", () => {
    const v = ir(example("photosynthesis.txt"));
    const leaf = el(v, "need", "leaf").box;
    for (const id of ["sun", "water", "co2"]) expect(el(v, "need", id).box.y + el(v, "need", id).box.h).toBeLessThanOrEqual(leaf.y);
    expect(cx(el(v, "need", "sun").box)).toBeLessThan(cx(el(v, "need", "water").box));
  });

  it("places relative elements next to their reference", () => {
    const v = ir(example("photosynthesis.txt"));
    const leaf = el(v, "need", "leaf").box;
    const chl = el(v, "need", "chl").box;
    expect(chl.x).toBeGreaterThanOrEqual(leaf.x + leaf.w);
    expect(Math.abs(cy(chl) - cy(leaf))).toBeLessThan(2);
  });

  it("lays out compare left/right with the title on top", () => {
    const v = ir(example("cells.txt"));
    const [t, l, r] = ["title", "left", "right"].map((id) => el(v, "compare", id).box) as [Box, Box, Box];
    expect(cx(l)).toBeLessThan(v.canvas.width / 2);
    expect(cx(r)).toBeGreaterThan(v.canvas.width / 2);
    expect(t.y + t.h).toBeLessThanOrEqual(Math.min(l.y, r.y));
  });

  it("ranks a flowchart top-down with parallel branches side by side", () => {
    const v = ir(example("learn-to-code.txt"));
    const [n1, n2, n3, n4] = ["n1", "n2", "n3", "n4"].map((id) => el(v, "decide", id).box) as [Box, Box, Box, Box];
    expect(n1.y).toBeLessThan(n2.y);
    expect(n2.y).toBe(n3.y);
    expect(n2.x).toBeLessThan(n3.x);
    expect(n4.y).toBeGreaterThan(n2.y);
  });

  it("puts ring items on a circle around the center slot", () => {
    const src = `video 1\nscene s template=hub\ncenter = text "Core"\na = icon:sun\nb = icon:heart\nc = icon:gear\n> {1}Everything {2}connects.\n1 pop center\n2 pop a,b,c /0.1\n`;
    const v = ir(src);
    const c = el(v, "s", "center").box;
    const ds = ["a", "b", "c"].map((id) => Math.hypot(cx(el(v, "s", id).box) - cx(c), cy(el(v, "s", id).box) - cy(c)));
    expect(Math.max(...ds) - Math.min(...ds)).toBeLessThan(2);
    expect(cy(el(v, "s", "a").box)).toBeLessThan(cy(c)); // first item at the top
  });

  it("warns when explicit slots overlap", () => {
    const r = compile(`video 1\nscene s\na = icon:sun @C\nb = icon:heart @C\n> {1}Hi.\n1 pop a,b\n`);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["NAR415"]);
  });
});

describe("lowering", () => {
  it("fills defaults and resolves components with a lockfile", () => {
    const v = ir(example("photosynthesis.txt"));
    expect(v.canvas).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(v.theme).toBe("chalk");
    expect(el(v, "need", "sun").component).toBe("icon:sun");
    expect(v.lock["icon:sun"]).toBe("1.0.0");
    expect(v.lock.arrow).toBe("1");
  });

  it("computes default durations, fit, stagger and move destinations", () => {
    const v = ir(example("photosynthesis.txt"));
    const need = v.scenes[0]!;
    const [b1, b2] = need.steps[0]!.beats as [Extract<(typeof need.steps)[0]["beats"][0], { type: "speech" }>, any];
    const pop = b1.actions[0]!.calls[0]!;
    expect(pop).toMatchObject({ verb: "pop", duration: 0.45, delay: 0, stagger: 0, params: { ease: "spring" } });
    expect(b2.actions[1].calls[0]).toMatchObject({ verb: "draw", targets: ["a1", "a2", "a3"], stagger: 0.15 });

    const inside = need.steps[1]!.beats[0]!;
    expect(inside.actions[0]!.calls.map((c) => c.duration)).toEqual([0.4, "fit"]);

    const output = v.scenes[1]!.steps[0]!.beats[0]!;
    const write = output.actions[0]!.calls[0]!;
    expect(write.duration).toBe(1.2); // explicit
    const move = output.actions[2]!.calls[1]!;
    expect(move.verb).toBe("move");
    expect(move.dest!.x).toBeGreaterThan(v.canvas.width * 0.6);
    expect(move.dest!.y).toBeLessThan(v.canvas.height * 0.4);
  });

  it("carries kept elements into the next scene with their boxes", () => {
    const src = `video 1\nscene a\nx = icon:sun\n> {1}Hi.\n1 pop x\nscene b keep=x\ny = icon:heart @R\n> Still {1}here.\n1 pop y\nend pulse x\n`;
    const v = ir(src);
    expect(el(v, "b", "x").box).toEqual(el(v, "a", "x").box);
  });
});

describe("failure handling", () => {
  it("returns diagnostics and no IR when errors remain", () => {
    const r = compile(`video 1\nscene s template=compare\nleft = icon:sun\n> {1}Hi.\n1 pop left\n`);
    expect(r.ok).toBe(false);
    expect(r.ir).toBeUndefined();
    expect(report(r.diagnostics)).toMatch(/^L2:1 NAR407 error: template `compare` needs a `right` element$/);
  });

  it("keeps compiling past syntax errors when auto-fix can recover", () => {
    const r = compile(`video 1\nscene s\nsun = icon:sun\nnonsense here\n> {1}Hi.\n1 pop sunn\n`);
    expect(r.ok).toBe(false); // the syntax error itself is not fixable
    expect(r.diagnostics.map((d) => d.code)).toEqual(["NAR101", "NAR301"]);
  });

  it("collects raw errors for a repair prompt when auto-fix is off", () => {
    const r = compile(`video 1\nscene s\nsun = icon:sun\n> {1}Hi.\n1 pop sunn\n`, { autofix: false });
    expect(r.ok).toBe(false);
    expect(report(r.diagnostics)).toBe(
      ["L3:1 NAR404 warning: element `sun` is declared but never shown", "L5:3 NAR301 error: `sunn` is not declared (did you mean `sun`?)"].join("\n"),
    );
  });
});
