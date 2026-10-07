import type { Box } from "@anim/ir";
import { describe, expect, it } from "vitest";
import { EXTRA_VARIANTS, findGridLayout, findTemplate, frameMode, GRID_ELEMENTS, GRID_LAYOUTS, slotRects } from "@anim/registry";
import { compile, report, VARIANT_PLUGINS } from "../src/index.js";

const grid = (layout: string, body: string, narration = "> Look {1}here.\n1 draw s1") => `video 1 "Grid"\nscene a "A" grid=${layout}\n${body}\n${narration}\n`;
const codes = (src: string, autofix = false) => compile(src, { autofix }).diagnostics.map((d) => d.code);

describe("rule book geometry", () => {
  it("has the 27 approved layouts and every element in the rule book data", () => {
    expect(GRID_LAYOUTS).toHaveLength(27);
    expect(GRID_ELEMENTS).toHaveLength(32); // the page says 34; its data lists 32
    expect(new Set(GRID_LAYOUTS.map((l) => l.code)).size).toBe(27);
  });

  it("cuts the content area on a 12-column grid with 96 px margins and 32 px gaps", () => {
    const [big, top, bottom] = slotRects(findGridLayout("L3-02")!, frameMode("sub", true));
    expect(big).toEqual({ x: 96, y: 230, w: 995, h: 750 });
    expect(top).toEqual({ x: 1123, y: 230, w: 701, h: 359 });
    expect(bottom!.y).toBe(230 + 359 + 32);
    expect(top!.x + top!.w).toBe(1920 - 96);
  });
});

describe("grid scenes", () => {
  const SRC = grid(
    "L3-02",
    `title = title "Numbers"\nsubtitle = text "and what they mean"\ns1 = chart:bar data=1,2,3 labels=A,B,C\ns2 = stat "95%" "covered"\ns3 = callout "Herd immunity starts here."\nfoot = footer "Source: WHO"`,
    "> First {1}the chart, then {2}the number, then {3}the point.\n1 draw s1\n2 draw s2\n3 draw s3\nstart fade title,subtitle,foot",
  );

  it("fills slots in reading order and frames the page", () => {
    const { ir, diagnostics } = compile(SRC);
    expect(report(diagnostics)).toBe("");
    const box = (id: string) => ir!.scenes[0]!.elements.find((e) => e.id === id)!.box;
    const rects = slotRects(findGridLayout("L3-02")!, frameMode("sub", true));
    expect([box("s1"), box("s2"), box("s3")]).toEqual(rects);
    expect(box("title")).toMatchObject({ x: 96, y: 96 });
    expect(box("foot").y).toBeGreaterThan(rects[0]!.y + rects[0]!.h);
    expect(ir!.theme).toBe("editorial");
    const foot = ir!.scenes[0]!.elements.find((e) => e.id === "foot")!;
    expect(foot.params).toMatchObject({ page: 1, brand: "Grid" });
  });

  it("gives the content area back when there is no header or footer", () => {
    const { ir } = compile(grid("L1-01", `s1 = body "Just a paragraph."`));
    expect(ir!.scenes[0]!.elements[0]!.box).toEqual({ x: 96, y: 96, w: 1728, h: 888 });
  });

  it("R2: fixes a mistyped layout code", () => {
    const r = compile(grid("L3-2", `s1 = body "a"\ns2 = stat "1" "b"\ns3 = bullets "c;d"`, "> {1}Go.\n1 draw s1,s2,s3"));
    expect(r.diagnostics.find((d) => d.code === "NAR420")?.fixed).toMatch(/L3-0/);
    expect(r.ok).toBe(true);
  });

  it("R3: switches to a layout with one slot per element", () => {
    const r = compile(grid("L4-01", `s1 = body "a"\ns2 = stat "1" "b"`, "> {1}Go.\n1 draw s1,s2"));
    const d = r.diagnostics.find((x) => x.code === "NAR421")!;
    expect(d.fixed).toMatch(/L2-/);
    expect(r.script.scenes[0]!.attrs.grid).toMatch(/^L2-/);
  });

  it("R4: moves to a layout where every element fits", () => {
    // A table needs 640 px; the three columns of L3-01 are 555 px wide.
    const src = grid("L3-01", `s1 = table "A|B;1|2"\ns2 = stat "1" "x"\ns3 = bullets "a;b"`, "> {1}Go.\n1 draw s1,s2,s3");
    expect(codes(src)).toContain("NAR423");
    const fixed = compile(src);
    const layout = findGridLayout(fixed.script.scenes[0]!.attrs.grid!)!;
    expect(layout.slots).toHaveLength(3);
    expect(slotRects(layout, frameMode("none", false))[0]!.w).toBeGreaterThanOrEqual(640);
  });

  it("R5/R6/R7: small elements stay small, something carries the page, limits hold", () => {
    expect(codes(grid("L1-01", `s1 = icon:sun`, "> {1}Sun.\n1 pop s1"))).toEqual(expect.arrayContaining(["NAR425", "NAR424"]));
    expect(codes(grid("L2-01", `s1 = callout "a"\ns2 = callout "b"`, "> {1}Go.\n1 draw s1,s2"))).toEqual(expect.arrayContaining(["NAR426", "NAR424"]));
    // An icon in the big slot of L3-02 is moved by choosing a layout where slot 1 isn't the largest.
    const r = compile(grid("L3-02", `s1 = icon:sun "Sun"\ns2 = chart:bar data=1,2\ns3 = body "text"`, "> {1}Go.\n1 pop s1\n1 draw s2,s3"));
    expect(r.diagnostics.find((d) => d.code === "NAR425")?.fixed).toBeTruthy();
  });

  it("R10: warns about text over the limits", () => {
    const words = Array.from({ length: 70 }, (_, i) => `w${i}`).join(" ");
    expect(codes(grid("L1-01", `s1 = body "${words}"`))).toContain("NAR428");
  });

  it("R11: reorders declarations to match the animation order", () => {
    const r = compile(grid("L2-01", `s1 = body "first declared"\ns2 = stat "9" "shown first"`, "> {1}Number, {2}then text.\n1 draw s2\n2 draw s1"));
    expect(r.diagnostics.find((d) => d.code === "NAR429")?.fixed).toBeTruthy();
    expect(r.script.scenes[0]!.steps[0]!.elements.map((e) => e.id)).toEqual(["s2", "s1"]);
    expect(r.ir!.scenes[0]!.elements.find((e) => e.id === "s2")!.box.x).toBe(96);
  });

  it("rejects mixing grid= and template=, and non-grid elements in slots", () => {
    const src = `video 1\nscene a grid=L2-01 template=steps\ns1 = text "x"\ns2 = node "y"\n> {1}Go.\n1 draw s1,s2\n`;
    expect(codes(src)).toEqual(expect.arrayContaining(["NAR430", "NAR422"]));
    expect(compile(src).script.scenes[0]!.steps[0]!.elements[0]!.kind).toBe("body"); // text → body
  });
});

describe("layout variants and knobs", () => {
  const steps = (attrs: string) => `video 1 "V"\nscene s "S" template=steps ${attrs}\na = box "A"\nb = box "B"\nc = box "C"\n> {1}One, {2}two, {3}three.\n1 fade a\n2 fade b\n3 fade c\n`;
  const boxes = (src: string) => {
    const r = compile(src);
    expect(report(r.diagnostics.filter((d) => d.severity === "error"))).toBe("");
    return Object.fromEntries(r.ir!.scenes[0]!.elements.map((e) => [e.id, e.box]));
  };

  it("arrange the same template differently", () => {
    const row = boxes(steps(""));
    const zig = boxes(steps("variant=zigzag"));
    const col = boxes(steps("variant=column"));
    const stairs = boxes(steps("variant=staircase"));
    expect(new Set([row.a!.y, row.b!.y, row.c!.y]).size).toBe(1);
    expect(zig.b!.y).toBeGreaterThan(zig.a!.y);
    expect(zig.c!.y).toBe(zig.a!.y);
    expect(col.b!.y).toBeGreaterThan(col.a!.y);
    expect(col.a!.x).toBe(col.b!.x);
    expect(stairs.a!.y).toBeGreaterThan(stairs.b!.y);
    expect(stairs.b!.y).toBeGreaterThan(stairs.c!.y);
  });

  it("give the emphasized element more room and space things by density", () => {
    const even = boxes(steps("variant=zigzag"));
    const big = boxes(steps("variant=zigzag emphasis=b"));
    expect(big.b!.x - big.a!.x).toBeGreaterThan(even.b!.x - even.a!.x);
    const airy = boxes(steps("density=airy"));
    const tight = boxes(steps("density=tight"));
    expect(tight.a!.w).toBeGreaterThanOrEqual(airy.a!.w);
  });

  it("mirror any layout, grid pages included", () => {
    const plain = boxes(steps(""));
    const flipped = boxes(steps("mirror=true"));
    expect(flipped.a!.x).toBe(1920 - plain.a!.x - plain.a!.w);
    const page = (m: string) => boxes(`video 1 "G"\nscene a "A" grid=L2-01 ${m}\ns1 = body "Left"\ns2 = stat "9" "right"\n> {1}Go {2}now.\n1 draw s1\n2 draw s2\n`);
    expect(page("mirror=true").s1!.x).toBeGreaterThan(page("").s1!.x);
  });

  it("pick a stable variant for variant=auto", () => {
    expect(boxes(steps("variant=auto"))).toEqual(boxes(steps("variant=auto")));
  });

  it("left-align headlines in the left title variant", () => {
    const r = compile(`video 1 "T"\nscene t "T" template=title variant=left\ntitle = title "Hello"\n> {1}Hello.\n1 write title\n`);
    expect(r.ir!.scenes[0]!.elements[0]!.params.align).toBe("left");
  });

  it("fix bad knobs (NAR218)", () => {
    const r = compile(steps("variant=zigzg density=airyy emphasis=nobody mirror=yes"));
    const fixes = r.diagnostics.filter((d) => d.code === "NAR218").map((d) => d.fixed);
    expect(fixes).toEqual(["used `zigzag`", "ignored", "used `airy`", "ignored"]);
  });
});

describe("composition by intent (compose=)", () => {
  const scene = (attrs: string) => `video 1 "C"\nscene c "C" ${attrs}\nhero = asset:leaf "Leaf"\na = icon:sun "Sun"\nb = icon:droplet "Water"\nc = icon:wind "Air"\n> The {1}leaf, {2}sun, {3}water and {4}air.\n1 draw hero\n2 pop a\n3 pop b\n4 pop c\n`;
  const solved = (attrs: string) => {
    const r = compile(scene(attrs));
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    return Object.fromEntries(r.ir!.scenes[0]!.elements.map((e) => [e.id, e.box]));
  };
  const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  for (const pattern of ["auto", "hero-left", "hero-right", "hero-top", "hero-center", "columns", "rows", "pyramid", "z"]) {
    it(`${pattern}: everything inside the page, nothing overlapping`, () => {
      const boxes = Object.values(solved(`compose=${pattern}`));
      for (const b of boxes) {
        expect(b.x).toBeGreaterThanOrEqual(90);
        expect(b.y).toBeGreaterThanOrEqual(70);
        expect(b.x + b.w).toBeLessThanOrEqual(1920 - 90);
        expect(b.y + b.h).toBeLessThanOrEqual(1080 - 70);
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i]!, boxes[j]!)).toBe(false);
    });
  }

  it("makes the hero the biggest and puts it where the pattern says", () => {
    const left = solved("compose=hero-left");
    const area = (b: Box) => b.w * b.h;
    for (const id of ["a", "b", "c"]) expect(area(left.hero!)).toBeGreaterThan(area(left[id]!));
    for (const id of ["a", "b", "c"]) expect(left.hero!.x).toBeLessThan(left[id]!.x);
    const right = solved("compose=hero-right");
    for (const id of ["a", "b", "c"]) expect(right.hero!.x).toBeGreaterThan(right[id]!.x);
    const top = solved("compose=hero-top");
    for (const id of ["a", "b", "c"]) expect(top.hero!.y).toBeLessThan(top[id]!.y);
    // emphasis picks a different hero
    const sun = solved("compose=hero-left emphasis=a");
    expect(area(sun.a!)).toBeGreaterThan(area(sun.b!));
  });

  it("spaces supporting items evenly", () => {
    const top = solved("compose=hero-top");
    const gaps = [top.b!.x - (top.a!.x + top.a!.w), top.c!.x - (top.b!.x + top.b!.w)];
    expect(Math.abs(gaps[0]! - gaps[1]!)).toBeLessThanOrEqual(2);
  });

  it("is deterministic and rejects compose next to a template", () => {
    expect(solved("compose=auto")).toEqual(solved("compose=auto"));
    const r = compile(scene("template=steps compose=hero-left"));
    expect(r.diagnostics.find((d) => d.code === "NAR218")?.message).toMatch(/compose= replaces a template/);
    expect(compile(scene("compose=hero-lft")).diagnostics.find((d) => d.code === "NAR218")?.fixed).toBe("used `hero-left`");
  });
});

describe("authored variants (pnpm variant)", () => {
  const src = (variant: string) => `video 1 "A"\nscene s "S" template=steps variant=${variant}\na = box "A"\nb = box "B"\nc = box "C"\n> {1}One, {2}two, {3}three.\n1 fade a\n2 fade b\n3 fade c\n`;

  it("offers approved variants like built-in ones (steps:arch arches up in the middle)", () => {
    expect(findTemplate("steps")!.variants).toContain("arch");
    const r = compile(src("arch"));
    expect(r.diagnostics).toEqual([]);
    const [a, b, c] = ["a", "b", "c"].map((id) => r.ir!.scenes[0]!.elements.find((e) => e.id === id)!.box);
    expect(b!.y).toBeLessThan(a!.y);
    expect(b!.y).toBeLessThan(c!.y);
  });

  it("keeps drafts out unless drafts are allowed", () => {
    EXTRA_VARIANTS.push({ template: "steps", name: "test-draft", summary: "test", status: "draft" });
    VARIANT_PLUGINS["steps:test-draft"] = (c) => c.items.forEach((e, i) => c.put(e, c.colCells(c.area, c.items.length)[i]!));
    try {
      const blocked = compile(src("test-draft"));
      expect(blocked.diagnostics.find((d) => d.code === "NAR218")?.message).toMatch(/draft that hasn't been approved/);
      const allowed = compile(src("test-draft"), { drafts: true });
      expect(allowed.diagnostics).toEqual([]);
      const boxes = allowed.ir!.scenes[0]!.elements.map((e) => e.box);
      expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y); // the plugin's column layout ran
    } finally {
      EXTRA_VARIANTS.pop();
      delete VARIANT_PLUGINS["steps:test-draft"];
    }
  });
});
