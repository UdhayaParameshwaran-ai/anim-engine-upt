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

  it("puts ring items on an ellipse around the center slot", () => {
    const src = `video 1\nscene s template=hub\ncenter = text "Core"\na = icon:sun\nb = icon:heart\nc = icon:gear\n> {1}Everything {2}connects.\n1 pop center\n2 pop a,b,c /0.1\n`;
    const v = ir(src);
    const c = el(v, "s", "center").box;
    const [a, b, d] = ["a", "b", "c"].map((id) => el(v, "s", id).box) as [Box, Box, Box];
    // First item straight above the center; the other two mirror each other below it.
    expect(Math.abs(cx(a) - cx(c))).toBeLessThan(2);
    expect(cy(a)).toBeLessThan(cy(c));
    expect(Math.abs(cy(b) - cy(d))).toBeLessThan(2);
    expect(Math.abs(cx(b) - cx(c) - (cx(c) - cx(d)))).toBeLessThan(2);
    // Wider than tall, to use a 16:9 frame.
    expect(cx(b) - cx(c)).toBeGreaterThan(cy(c) - cy(a));
  });

  it("draws a template's own structure and shows it with the elements it belongs to", () => {
    const hub = ir(`video 1\nscene s template=hub\ncenter = text "Core"\na = icon:sun "Sun"\nb = icon:heart "Heart"\nc = icon:gear "Gear"\n> {1}Everything {2}connects.\n1 pop center\n2 pop a,b,c /0.1\n`).scenes[0]!;
    const spokes = hub.elements.filter((e) => e.kind === "line" && e.params.auto);
    expect(spokes.map((e) => e.link)).toEqual([{ from: "center", to: "a" }, { from: "center", to: "b" }, { from: "center", to: "c" }]);
    // Each spoke is drawn on the cue that shows its item, just after the item starts to appear.
    const beat = hub.steps[0]!.beats[0]!;
    const shown = beat.actions.filter((x) => x.calls[0]!.targets[0]!.startsWith("__"));
    expect(shown.map((x) => [x.anchor, x.calls[0]!.verb, x.calls[0]!.delay])).toEqual([["2", "draw", 0.12], ["2", "draw", 0.22], ["2", "draw", 0.32]]);
    // Items take the palette in turn and enter from the center outward.
    expect(hub.elements.find((e) => e.id === "b")!.params).toMatchObject({ hue: 1 });
    expect(Number(hub.elements.find((e) => e.id === "a")!.params.enterDy)).toBeGreaterThan(0);

    // Declared connectors are not doubled; a loop without any gets its arrows, closing with the last item.
    const loop = (arrows: string) => ir(`video 1\nscene s template=cycle\na = icon:sun\nb = icon:heart\nc = icon:gear\n${arrows}> {1}Round and {2}round.\n1 pop a,b\n2 pop c\n${arrows ? "2 draw x1\n" : ""}`).scenes[0]!;
    expect(loop("").elements.filter((e) => e.params.auto).map((e) => `${e.kind} ${e.link!.from}->${e.link!.to}`)).toEqual(["arrow a->b", "arrow b->c", "arrow c->a"]);
    expect(loop("x1 = arrow a->b\n").elements.filter((e) => e.params.auto)).toEqual([]);

    // Steps are numbered; cards sit on panels of one size; compare gets a "vs".
    const steps = ir(`video 1\nscene s template=steps\na = icon:sun "One"\nb = icon:heart "Two"\n> {1}First, {2}second.\n1 pop a\n2 pop b\n`).scenes[0]!;
    expect(steps.elements.filter((e) => e.kind === "badge").map((e) => e.texts[0])).toEqual(["1", "2"]);
    const cards = ir(`video 1\nscene s template=cards\na = icon:sun "One"\nb = asset:leaf "Two"\nc = icon:gear "Three"\n> {1}Three things.\n1 pop a,b,c\n`).scenes[0]!;
    const panels = cards.elements.filter((e) => e.kind === "panel").map((e) => `${e.box.w}x${e.box.h}`);
    expect(panels).toHaveLength(3);
    expect(new Set(panels).size).toBe(1);

    // Nothing is drawn for an element that is never shown.
    const src = `video 1\nscene s template=hub\ncenter = text "Core"\na = icon:sun\nb = icon:heart\n> {1}Only one.\n1 pop center,a\n`;
    const partial = compile(src, { autofix: false }).ir!.scenes[0]!;
    expect(partial.elements.filter((e) => e.params.auto).map((e) => e.link!.to)).toEqual(["a"]);
    // With auto-fix the forgotten element fades in after the first sentence, and its spoke with it.
    const fixed = compile(src);
    expect(report(fixed.diagnostics)).toContain("NAR404 warning: element `b` is declared but never shown [fixed: added `end fade b` to the first sentence]");
    expect(fixed.ir!.scenes[0]!.elements.filter((e) => e.params.auto).map((e) => e.link!.to)).toEqual(["a", "b"]);
  });

  it("lets pictures fill a roomy cell, with labels that scale along", () => {
    const one = ir(`video 1\nscene s template=steps\na = icon:sun "Sun"\nb = icon:heart "Heart"\n> {1}Two.\n1 pop a,b\n`).scenes[0]!;
    const a = one.elements.find((e) => e.id === "a")!;
    expect(a.box.w).toBeGreaterThan(280); // 200 at natural size
    expect(a.params.labelFont).toBeGreaterThan(34);
    // Six items leave no room to grow.
    const many = ir(`video 1\nscene s template=steps\n${"abcdef".split("").map((c) => `${c} = icon:sun "Sun"`).join("\n")}\n> {1}Six.\n1 pop a,b,c,d,e,f\n`).scenes[0]!;
    expect(many.elements.find((e) => e.id === "a")!.box.w).toBeLessThanOrEqual(260);
  });

  it("warns when explicit slots overlap", () => {
    const r = compile(`video 1\nscene s\na = icon:sun @C\nb = icon:heart @C\n> {1}Hi.\n1 pop a,b\n`);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["NAR415"]);
  });
});

describe("flow templates", () => {
  const right = (b: Box) => b.x + b.w;
  const bottom = (b: Box) => b.y + b.h;
  const scene = (attrs: string, body: string) => {
    const ids = body.split("\n").map((l) => l.split(" = ")[0]!.trim());
    return `video 1 "x"\nscene s "S" ${attrs}\n${body}\n> Go {1}now.\n1 fade ${ids.join(",")}\n`;
  };
  const flow = (attrs: string, decl: string[]) => {
    const v = ir(scene(attrs, decl.join("\n")));
    return (id: string) => el(v, "s", id).box;
  };
  const three = ['a = icon:sun "A"', 'b = icon:droplet "B"', 'c = icon:wind "C"'];

  it("converge: inputs on one side or around, the result opposite", () => {
    let box = flow("template=converge variant=left", [...three, 'result = asset:leaf "Leaf"', "x = arrow a->result"]);
    for (const id of ["a", "b", "c"]) expect(right(box(id))).toBeLessThan(box("result").x);
    expect(cy(box("a"))).toBeLessThan(cy(box("b")));
    box = flow("template=converge variant=top", [...three, 'result = asset:leaf "Leaf"']);
    for (const id of ["a", "b", "c"]) expect(bottom(box(id))).toBeLessThan(box("result").y);
    box = flow("template=converge variant=around", [...three, 'result = asset:leaf "Leaf"']);
    const r = box("result");
    for (const id of ["a", "b", "c"]) expect(Math.hypot(cx(box(id)) - cx(r), cy(box(id)) - cy(r))).toBeGreaterThan(r.w / 2);
  });

  it("diverge: the source first, outputs after it", () => {
    let box = flow("template=diverge variant=right", ['source = icon:bolt "Power"', ...three]);
    for (const id of ["a", "b", "c"]) expect(box(id).x).toBeGreaterThan(right(box("source")));
    box = flow("template=diverge variant=bottom", ['source = icon:bolt "Power"', ...three]);
    for (const id of ["a", "b", "c"]) expect(box(id).y).toBeGreaterThan(bottom(box("source")));
  });

  it("process: items declared before it are inputs, after it outputs", () => {
    const decl = ['a = icon:sun "A"', 'b = icon:droplet "B"', 'process = asset:leaf "P"', 'c = icon:cube "C"', "x = arrow a->process", "y = arrow process->c"];
    let box = flow("template=process variant=across", decl);
    for (const id of ["a", "b"]) expect(right(box(id))).toBeLessThan(box("process").x);
    expect(box("c").x).toBeGreaterThan(right(box("process")));
    box = flow("template=process variant=down", decl);
    for (const id of ["a", "b"]) expect(bottom(box(id))).toBeLessThan(box("process").y);
    expect(box("c").y).toBeGreaterThan(bottom(box("process")));
    box = flow("template=process variant=equation", decl);
    expect(right(box("b"))).toBeLessThan(box("process").x);
    expect(box("c").x).toBeGreaterThan(right(box("process")));
    expect(Math.abs(cy(box("a")) - cy(box("c")))).toBeLessThan(2); // one line
  });

  it("process: warns when every item is on one side, and splits them in half", () => {
    const r = compile(scene("template=process variant=across", ['process = asset:leaf "P"', ...three].join("\n")));
    expect(r.diagnostics.map((d) => d.message)).toContain("declare inputs before `process` and outputs after it; the items were split in half");
    const box = (id: string) => el(r.ir!, "s", id).box;
    expect(right(box("a"))).toBeLessThan(box("process").x);
    expect(box("c").x).toBeGreaterThan(right(box("process")));
  });

  it("the photosynthesis example uses them without diagnostics", () => {
    const v = ir(example("photosynthesis-templates.txt"));
    expect(v.scenes.map((sc) => sc.id)).toEqual(["need", "make", "uses"]);
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
  it("lowers an unknown icon or asset to a placeholder even without auto-fix", () => {
    for (const kind of ["icon:zzqqxx", "asset:sun.ray"]) {
      const src = `video 1 "x"
scene a "A" template=steps
m = ${kind} "Peak"
n = icon:sun "Sun"
> Hi {1}there and {2}here.
1 pop m
2 pop n
`;
      for (const autofix of [false, true]) {
        const r = compile(src, { autofix });
        expect(r.diagnostics.map((d) => d.code)).toContain("NAR306");
        expect(r.ir!.scenes[0]!.elements.find((e) => e.id === "m")).toMatchObject({ kind: "placeholder", texts: ["Peak"] });
      }
    }
  });

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

describe("layout polish", () => {
  const scene = (src: string) => compile(src).ir!.scenes[0]!;

  it("writes a one-line process as an equation: plus signs, one arrow in, one arrow out", () => {
    const s = scene('video 1\nscene s template=process variant=equation\na = icon:sun "Light"\nb = icon:droplet "Water"\nprocess = asset:leaf "Leaf"\nc = icon:cube "Sugar"\nd = icon:wind "Oxygen"\n> {1}In and {2}out.\n1 pop a,b then fade process\n2 pop c,d\n');
    const auto = s.elements.filter((e) => e.params.auto);
    expect(auto.filter((e) => e.kind === "badge").map((e) => e.texts[0])).toEqual(["+", "+"]);
    // No arrow from the far input: it would run through the near one.
    expect(auto.filter((e) => e.kind === "arrow").map((e) => `${e.link!.from}->${e.link!.to}`)).toEqual(["b->process", "process->c"]);
  });

  it("gives every labelled picture of a scene the same label size, never below the natural one", () => {
    const s = scene('video 1\nscene s template=process\na = icon:sun "Light"\nb = icon:droplet "Water"\nc = icon:cloud "Air"\nprocess = asset:leaf "Photosynthesis"\nd = icon:cube "Sugar"\n> {1}In and {2}out.\n1 pop a,b,c then fade process\n2 pop d\n');
    const fonts = s.elements.filter((e) => e.params.labelFont !== undefined).map((e) => e.params.labelFont as number);
    expect(fonts).toHaveLength(5);
    expect(new Set(fonts).size).toBe(1);
    expect(fonts[0]).toBeGreaterThanOrEqual(34);
  });

  it("staggers several elements entering on one cue unless the script sets its own stagger", () => {
    const calls = (line: string) => scene(`video 1\nscene s template=cards\na = icon:sun\nb = icon:heart\nc = icon:gear\n> {1}Three.\n${line}\n`).steps[0]!.beats[0]!.actions[0]!.calls[0]!;
    expect(calls("1 pop a,b,c").stagger).toBe(0.14);
    expect(calls("1 pop a,b,c /0.3").stagger).toBe(0.3);
    expect(calls("1 pop a").stagger).toBe(0);
  });

  it("keeps room for the arrows of a loop and the spokes of a hub", () => {
    const gap = (s: ReturnType<typeof scene>, from: string, to: string) => {
      const a = s.elements.find((e) => e.id === from)!.box;
      const b = s.elements.find((e) => e.id === to)!.box;
      // Distance between the two boxes along the larger axis.
      return Math.max(Math.abs(cx(a) - cx(b)) - (a.w + b.w) / 2, Math.abs(cy(a) - cy(b)) - (a.h + b.h) / 2);
    };
    const ids = ["a", "b", "c", "d", "e"];
    const loop = scene(`video 1\nscene s template=cycle\n${ids.map((id) => `${id} = icon:sun "Stage ${id}"`).join("\n")}\n> {1}Round.\n1 pop a,b,c,d,e\n`);
    ids.forEach((id, i) => expect(gap(loop, id, ids[(i + 1) % 5]!), id).toBeGreaterThan(60));
    const hub = scene(`video 1\nscene s template=hub\ncenter = icon:gear "Core"\n${ids.map((id) => `${id} = icon:sun "Part ${id}"`).join("\n")}\n> {1}Parts.\n1 pop center,a,b,c,d,e\n`);
    for (const id of ids) expect(gap(hub, "center", id), id).toBeGreaterThan(40);
  });
});
