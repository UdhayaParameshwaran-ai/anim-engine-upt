import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse, print, type SpeechBeat } from "@anim/dsl";
import { describe, expect, it } from "vitest";
import { closest, validate, ValidateCodes as C } from "../src/index.js";

const EXAMPLES = join(import.meta.dirname, "../../../examples");

/** Parses `body` inside a header + scene and validates it. */
function check(body: string, opts: { autofix?: boolean; scene?: string } = {}) {
  const src = `video 1\nscene s ${opts.scene ?? ""}\n${body}\n`;
  const parsed = parse(src);
  expect(parsed.diagnostics).toEqual([]);
  const r = validate(parsed.script, { autofix: opts.autofix ?? true });
  return { ...r, codes: r.diagnostics.map((d) => d.code), printed: print(r.script) };
}

describe("examples", () => {
  for (const file of readdirSync(EXAMPLES).filter((f) => f.endsWith(".txt"))) {
    it(`${file} validates with no diagnostics`, () => {
      const r = validate(parse(readFileSync(join(EXAMPLES, file), "utf8")).script);
      expect(r.diagnostics).toEqual([]);
      expect(r.ok).toBe(true);
    });
  }
});

describe("fuzzy matching", () => {
  it("finds a unique close match and refuses ambiguous ones", () => {
    expect(closest("hilight", ["highlight", "hide"])).toBe("highlight");
    expect(closest("ab", ["ac", "ad"])).toBeUndefined();
    expect(closest("zzzz", ["highlight"])).toBeUndefined();
  });
});

describe("references", () => {
  it("fixes a misspelled element id", () => {
    const r = check("sun = icon:sun\n> Look at the {1}sun.\n1 pop sunn");
    expect(r.codes).toEqual([C.UndeclaredElement]);
    expect(r.diagnostics[0]!.message).toContain("did you mean `sun`");
    expect(r.printed).toContain("1 pop sun\n");
    expect(r.ok).toBe(true);
  });

  it("reports but does not fix when autofix is off, and leaves the input untouched", () => {
    const src = "video 1\nscene s\nsun = icon:sun\n> Look at the {1}sun.\n1 pop sunn\n";
    const parsed = parse(src).script;
    const r = validate(parsed, { autofix: false });
    expect(r.ok).toBe(false);
    expect(r.diagnostics[0]!.fixed).toBeUndefined();
    expect(print(parsed)).toBe(print(parse(src).script));
  });

  it("drops actions on unknown cues", () => {
    const r = check("sun = icon:sun\n> Look at the {1}sun.\n1 pop sun\n2 pulse sun");
    expect(r.codes).toEqual([C.UnknownCue]);
    expect(r.printed).not.toContain("2 pulse");
  });

  it("re-anchors actions numbered across the scene onto the beat's unused cues", () => {
    // What a model wrote: cues restart at {1}, anchors keep counting.
    const r = check("sun = icon:sun\nsky = icon:cloud\n> The {1}sun rises.\n1 pop sun\n> Then the {1}sky {2 turns blue}.\n2 pop sky\n3 highlight sky fit\n4 pulse sun");
    const anchors = r.diagnostics.filter((d) => d.code === C.UnknownCue);
    expect(anchors.map((d) => d.fixed)).toEqual(["anchored on cue `1`", "removed the action"]);
    expect(r.printed).toContain("1 highlight sky");
    expect(r.printed).toContain("2 pop sky");
    expect(r.printed).not.toContain("pulse sun");

    const shifted = check("sky = icon:cloud\nsun = icon:sun\n> First the {1}sky.\n2 pop sky\n> Then the {1}sun {2 sets slowly}.\n3 pop sun\n4 highlight sun fit");
    expect(shifted.diagnostics.filter((d) => d.code === C.UnknownCue).map((d) => d.fixed)).toEqual(["anchored on cue `1`", "anchored on cue `1`", "anchored on cue `2`"]);
    expect(shifted.codes).toEqual([C.UnknownCue, C.UnknownCue, C.UnknownCue]);
  });

  it("flags elements used before the step that declares them", () => {
    const r = check("a = icon:sun\n> One {1}thing.\n1 pop a,b\nstep two\nb = icon:heart\n> Two {1}things.\n1 pop b");
    expect(r.codes).toEqual([C.UndeclaredElement]);
    expect(r.diagnostics[0]!.message).toContain("later step");
  });

  it("checks connector endpoints", () => {
    const r = check("a = icon:sun\nx = arrow a->nowhere\n> {1}Hi.\n1 pop a");
    expect(r.codes).toContain(C.BadLinkEndpoint);
    expect(r.printed).not.toContain("x = arrow");
  });

  it("warns about cues with no action", () => {
    const r = check("a = icon:sun\n> {1}One {2}two.\n1 pop a");
    expect(r.codes).toEqual([C.UnusedCue]);
  });

  it("checks parts of assets and lists", () => {
    const r = check('c = asset:cell.plant\nl = list "a; b"\n> {1}Look.\n1 pop c,l\nend highlight c.wall\nend highlight c.tail\nend highlight l.3');
    expect(r.codes).toEqual([C.UnknownPart, C.UnknownPart]);
    expect(r.printed).toContain("end highlight c\n");
  });

  it("validates keep against the previous scene", () => {
    const src = "video 1\nscene a\nx = icon:sun\n> {1}Hi.\n1 pop x\nscene b keep=x,y\n> {1}Still x.\n1 pulse x\n";
    const r = validate(parse(src).script);
    expect(r.diagnostics.map((d) => d.code)).toEqual([C.BadKeep]);
  });
});

describe("schema", () => {
  it("fixes misspelled verbs and drops unknown ones", () => {
    const r = check("a = icon:sun\n> {1}Hi there.\n1 pop a then hilight a\nend explode a");
    expect(r.codes).toEqual([C.UnknownVerb, C.UnknownVerb]);
    expect(r.printed).toContain("1 pop a then highlight a\n");
    expect(r.printed).not.toContain("explode");
  });

  it("replaces unknown kinds and assets with placeholders", () => {
    const r = check('a = gizmo "Thing"\nb = icon:quasar\n> {1}Hi.\n1 pop a,b');
    expect(r.codes).toEqual([C.UnknownKind, C.UnknownAsset]);
    expect(r.printed).toContain('a = placeholder "Thing"');
    expect(r.printed).toContain('b = placeholder "quasar"');
  });

  it("resolves asset synonyms to canonical names", () => {
    const r = check("a = icon:sunlight\n> {1}Hi.\n1 pop a");
    expect(r.codes).toEqual([C.UnknownAsset]);
    expect(r.diagnostics[0]!.severity).toBe("warning");
    expect(r.printed).toContain("a = icon:sun");
  });

  it("validates verb parameters", () => {
    const r = check("a = icon:sun\n> {1}Hi.\n1 pop a\nend highlight a style=sparkle color=accent wobble=3");
    expect(r.codes).toEqual([C.BadParamValue, C.UnknownParam]);
    expect(r.printed).toContain("end highlight a color=accent\n");
  });

  it("requires a destination for move and a span cue for fit", () => {
    const r = check("a = icon:sun\n> {1}Hi.\n1 pop a\nend move a\nend highlight a fit");
    expect(r.codes).toEqual([C.MissingDestination, C.FitNeedsSpan]);
  });

  it("checks until= points at a later cue", () => {
    const r = check("a = icon:sun\n> {1}One {2}two.\n2 pop a\n2 highlight a until=1");
    expect(r.codes).toContain(C.BadUntil);
  });

  it("checks templates, layouts and transitions", () => {
    const r = check("left = icon:sun\n> {1}Hi.\n1 pop left", { scene: "template=comprae in=wipe" });
    expect(r.codes).toEqual([C.UnknownTemplate, C.UnknownTransition, C.TemplateSlot]);
    expect(r.printed).toContain("template=compare");
    expect(r.ok).toBe(false); // missing `right` slot can't be auto-fixed
  });

  it("checks template item counts and kinds", () => {
    const r = check("a = icon:sun\nb = arrow a->a2\na2 = icon:heart\n> {1}Hi.\n1 pop a,a2", { scene: "template=cycle" });
    expect(r.codes).toEqual([C.TemplateSlot, C.NeverShown]);
    expect(r.diagnostics[0]!.severity).toBe("warning");
  });
});

describe("semantics", () => {
  it("inserts an enter before emphasis on a hidden element", () => {
    const r = check("a = icon:sun\n> Look at {1 the sun}.\n1 highlight a fit");
    expect(r.codes).toEqual([C.NotVisible]);
    const beat = r.script.scenes[0]!.steps[0]!.beats[0] as SpeechBeat;
    expect(beat.actions.map((a) => a.calls.map((c) => c.verb))).toEqual([["fade"], ["highlight"]]);
  });

  it("inserts the enter inside a chain when needed", () => {
    const r = check("a = icon:sun\nb = icon:heart\n> {1}Look.\n1 pop a then pulse b");
    expect(r.printed).toContain("1 pop a then fade b then pulse b\n");
  });

  it("follows narration order, not line order", () => {
    const r = check("a = icon:sun\n> {1}First {2}second.\n2 pulse a\n1 pop a");
    expect(r.codes).toEqual([]);
  });

  it("drops hiding something that is not visible", () => {
    const r = check("a = icon:sun\nb = icon:heart\n> {1}Hi.\n1 pop a\nend hide b");
    expect(r.codes).toEqual([C.HideHidden, C.NeverShown]);
    expect(r.printed).not.toContain("hide");
  });

  it("requires narration in every scene", () => {
    const r = check("wait 1");
    expect(r.codes).toEqual([C.NoNarration]);
    expect(r.ok).toBe(false);
  });

  it("warns when a connector appears before its endpoints", () => {
    const r = check("a = icon:sun\nb = icon:heart\nx = arrow a->b\n> {1}Hi {2}there.\n1 draw x\n2 pop a,b");
    expect(r.codes).toEqual([C.DanglingConnector]);
  });

  it("warns on long beats", () => {
    const r = check(`a = icon:sun\n> {1}${"word ".repeat(45)}\n1 pop a`);
    expect(r.codes).toEqual([C.BeatTooLong]);
  });
});
