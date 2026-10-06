import { describe, expect, it } from "vitest";
import { findGridLayout, frameMode, GRID_ELEMENTS, GRID_LAYOUTS, slotRects } from "@anim/registry";
import { compile, report } from "../src/index.js";

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
