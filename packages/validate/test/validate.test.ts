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

describe("carry", () => {
  const A = 'video 1\nscene a\nx = icon:sun "Sun"\ny = icon:moon "Moon"\n> {1}Hi {2}there.\n1 pop x\n2 pop y\n';

  it("accepts a carried element that is declared again, and treats it as already on screen", () => {
    const src = A + 'scene b carry=x\nx = icon:sun "Sun"\n> {1}Still x.\n1 pulse x\n';
    expect(validate(parse(src).script).diagnostics).toEqual([]);
  });

  it("removes the target of an enter verb on a carried element (it is already on screen)", () => {
    const src = A + 'scene b carry=x\nx = icon:sun "Sun"\n> {1}Still x.\n1 pop x then pulse x\n';
    const r = validate(parse(src).script);
    expect(r.diagnostics.map((d) => d.code)).toEqual([C.AlreadyVisible]);
    const b = print(r.script).slice(print(r.script).indexOf("scene b"));
    expect(b).toContain("1 pulse x");
    expect(b).not.toContain("pop x");
  });

  it("drops carry ids the previous scene did not declare, but not for a scene checked on its own", () => {
    const src = A + 'scene b carry=x,z\nx = icon:sun "Sun"\nz = icon:star "Star"\n> {1}Both.\n1 pulse x then pop z\n';
    const r = validate(parse(src).script);
    expect(r.diagnostics.map((d) => d.code)).toContain(C.BadKeep);
    expect(print(r.script)).toContain("carry=x");
    expect(print(r.script)).not.toContain("carry=x,z");
    const alone = 'video 1\nscene b carry=x\nx = icon:sun "Sun"\n> {1}Still x.\n1 pulse x\n';
    expect(validate(parse(alone).script).diagnostics).toEqual([]);
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

  it("replaces an invented icon name with the picture that means it, not just the closest spelling", () => {
    // A typo: the closest name.
    expect(check("a = icon:databse\n> {1}Hi.\n1 pop a").printed).toContain("a = icon:database");
    // A word for a thing: the icon that shows it.
    expect(check("a = icon:kubernetes\n> {1}Hi.\n1 pop a").printed).toContain("a = icon:container");
    expect(check("a = icon:message-broker\n> {1}Hi.\n1 pop a").printed).toContain("a = icon:queue-pop-in");
    // Nothing means it: a labeled placeholder, never a loosely related picture.
    expect(check("a = icon:quasar\n> {1}Hi.\n1 pop a").printed).toContain('a = placeholder "quasar"');
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
    const r = check('left = label "Old"\nr1 = icon:sun "a" "b"\n> {1}Hi.\n1 pop r1', { scene: "template=comprae in=swirl" });
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

  it("moves a connector behind the endpoint that appears last", () => {
    const r = check("a = icon:sun\nb = icon:heart\nx = arrow a->b\n> {1}Hi {2}there.\n1 draw x\n2 pop a,b");
    expect(r.diagnostics[0]!.fixed).toContain("moved `x`");
    expect(r.printed).toMatch(/2 pop a,b then draw x/);
    expect(r.printed).not.toMatch(/1 draw x/);
  });

  it("keeps several moved connectors in their order, and lets send follow a draw", () => {
    const r = check("a = icon:sun\nb = icon:heart\nc = icon:moon\nx = arrow a->c\ny = arrow b->c\n> {1}Hi {2}there.\n1 pop a,b\n1 draw x then draw y\n2 pop c");
    expect(r.printed).toMatch(/2 pop c then draw x then draw y/);
    const s = check("a = icon:sun\nb = icon:heart\nx = arrow a->b\n> {1}Hi {2}there.\n1 pop a\n1 draw x then send x\n2 pop b");
    expect(s.printed).toMatch(/2 pop b then draw x then send x/);
    expect(s.codes.filter((c) => c === C.AlreadyVisible)).toEqual([]);
  });

  it("leaves a connector alone when an end never appears later", () => {
    const r = check("a = icon:sun\nb = icon:heart\nx = arrow a->b\n> {1}Hi {2}there.\n1 pop a\n1 draw x");
    expect(r.diagnostics.find((d) => d.code === C.DanglingConnector)?.fixed).toBeUndefined();
  });

  it("replaces a label shown where another visible label sits, instead of stacking them", () => {
    const r = check('a = icon:sun\nx = label "score" @above:a\ny = label "weight" @above:a\n> {1}Hi {2}there.\n1 pop a then fade x\n2 fade y');
    expect(r.codes).toContain(C.SamePlace);
    expect(r.printed).toMatch(/2 hide x then fade y/);
    // Labels in different places are left alone.
    const ok = check('a = icon:sun\nx = label "score" @above:a\ny = label "weight" @below:a\n> {1}Hi {2}there.\n1 pop a then fade x\n2 fade y');
    expect(ok.codes).not.toContain(C.SamePlace);
  });

  it("warns on long beats", () => {
    const r = check(`a = icon:sun\n> {1}${"word ".repeat(45)}\n1 pop a`);
    expect(r.codes).toEqual([C.BeatTooLong]);
  });
});

describe("audit fixes", () => {
  it("reads `grid` and shape names as template aliases, with a fixed warning", () => {
    const grid = check("a = icon:sun \"A\"\nb = icon:wind \"B\"\n> {1}One and {2}two.\n1 pop a\n2 pop b", { scene: "template=grid" });
    expect(grid.diagnostics.map((d) => [d.code, d.severity, d.fixed])).toEqual([[C.UnknownTemplate, "warning", "used `cards`"]]);
    expect(grid.printed).toContain("template=cards");
    const shape = check("a = icon:sun \"A\"\nb = icon:wind \"B\"\nc = icon:cloud \"C\"\n> {1}One, {2}two, {3}three.\n1 pop a\n2 pop b\n3 pop c", { scene: "template=sequence" });
    expect(shape.printed).toContain("template=steps");
  });

  it("adds cues the narration never marked instead of dropping the actions", () => {
    const r = check("a = icon:sun \"A\"\nb = icon:wind \"B\"\n> The sun rises over the hills and the wind starts to blow.\n1 pop a\n2 pop b");
    expect(r.diagnostics.map((d) => d.fixed)).toEqual(["added cue {1} to the narration", "added cue {2} to the narration"]);
    expect(r.printed).toMatch(/> The sun .*\{1\}.*\{2\}/);
    expect(r.printed).toContain("1 pop a");
    expect(r.printed).toContain("2 pop b");
    expect(validate(parse(r.printed).script).diagnostics).toEqual([]);
  });

  it("never puts an added cue inside a span cue", () => {
    const r = check("a = icon:sun \"A\"\nb = icon:wind \"B\"\n> First {1 the bright sun} then more words follow here.\n1 pop a\n2 pop b");
    expect(parse(r.printed).diagnostics).toEqual([]);
    expect(r.printed).toMatch(/\{1 the bright sun\} then .*\{2\}/);
  });
});

describe("carry kinds", () => {
  it("drops a carried id that is a different kind of element in this scene", () => {
    const src = 'video 1\nscene a\nx = icon:sun "Sun"\n> {1}Hi.\n1 pop x\nscene b carry=x\nx = box "Sun"\n> {1}Still.\n1 pulse x\n';
    const r = validate(parse(src).script);
    expect(r.diagnostics.map((d) => d.code)).toContain(C.BadKeep);
    expect(print(r.script)).not.toContain("carry=");
  });
});

describe("zoom into an element", () => {
  const A = 'video 1\nscene a\nx = icon:sun "Sun"\n> {1}Hi.\n1 pop x\n';
  it("accepts in=into:<id> for an element of the previous scene, and falls back to auto for any other", () => {
    expect(validate(parse(A + 'scene b in=into:x\ny = icon:moon "Moon"\n> {1}Next.\n1 pop y\n').script).diagnostics).toEqual([]);
    const r = validate(parse(A + 'scene b in=into:nope\ny = icon:moon "Moon"\n> {1}Next.\n1 pop y\n').script);
    expect(r.diagnostics.map((d) => d.code)).toEqual([C.BadKeep]);
    expect(print(r.script)).toContain("in=auto");
  });
});

describe("gitgraph strays", () => {
  it("warns about a commit no line joins", () => {
    const src = `video 1 "G"

scene g "History" template=gitgraph
main = zone "main"
c1 = circle "init"
c2 = circle "login"
note = icon:camera "Snapshot"
l1 = line c1->c2
> The {1}commits and a {2}note.
1 pop c1,c2 then draw l1
2 pop note
`;
    const r = validate(parse(src).script, {});
    expect(r.diagnostics.some((d) => d.message.includes("`note` is not joined"))).toBe(true);
    expect(r.diagnostics.some((d) => d.message.includes("`c1` is not joined"))).toBe(false);
  });
});

describe("trace scenes", () => {
  const T = { scene: 'template=trace check=partition' };
  const ok = ["arr = row", "> Here is {1}the row.", "1 arr: 7 2 9 1 4* | p=4", "> {1}Two comes first.", "1 arr: 2 7 9 1 4 | p=4"].join("\n");

  it("accepts a trace scene without diagnostics", () => {
    const r = check(ok, T);
    expect(r.diagnostics).toEqual([]);
  });

  it("needs template=trace for state lines", () => {
    const r = check(ok, { scene: "template=cards" });
    expect(r.codes).toContain(C.TraceNoTemplate);
  });

  it("rejects a state line for something that is not declared", () => {
    const r = check(["arr = row", "> Here is {1}the row.", "1 arr: 1 2", "> {1}Then.", "1 other: 1 2"].join("\n"), T);
    expect(r.codes).toContain(C.UndeclaredElement);
  });

  it("rejects a state line for an element that is not a collection", () => {
    const r = check(["arr = row", "sun = icon:sun", "> Here is {1}the row.", "1 arr: 1 2", "> {1}Then.", "1 sun: 1 2"].join("\n"), T);
    expect(r.diagnostics.find((d) => d.code === C.TraceNoTemplate)?.message).toContain("`sun:`");
  });

  it("checks pointers against the cells", () => {
    const r = check(["arr = row", "> Look {1}here.", "1 arr: 1 2 3 | i=7"].join("\n"), T);
    expect(r.codes).toContain(C.TracePointer);
    expect(check(["arr = row", "> Look {1}here.", "1 arr: 1 2 3 | i=3"].join("\n"), T).codes).not.toContain(C.TracePointer);
  });

  it("holds a stack to its top and a queue to its ends", () => {
    const stack = check(["s = stack", "> A {1}stack.", "1 s: 1 2 3", "> {1}Change the bottom.", "1 s: 9 2 3"].join("\n"), T);
    expect(stack.codes).toContain(C.TraceStack);
    expect(check(["s = stack", "> A {1}stack.", "1 s: 1 2 3", "> {1}Pop one.", "1 s: 1 2"].join("\n"), T).codes).not.toContain(C.TraceStack);
    const queue = check(["q = queue", "> A {1}queue.", "1 q: 1 2 3", "> {1}Skip one.", "1 q: 1 3"].join("\n"), T);
    expect(queue.codes).toContain(C.TraceQueue);
    expect(check(["q = queue", "> A {1}queue.", "1 q: 1 2 3", "> {1}Serve one, add one.", "1 q: 2 3 4"].join("\n"), T).codes).not.toContain(C.TraceQueue);
  });

  it("keeps the values of a sort the same", () => {
    const r = check(["arr = row", "> Start {1}here.", "1 arr: 3 1 2", "> {1}Then.", "1 arr: 1 2 4"].join("\n"), T);
    expect(r.diagnostics.find((d) => d.code === C.TraceConserved)?.message).toContain("lost or gained");
  });

  it("makes 'sorted' true when it is said", () => {
    const bad = check(["arr = row", "> Start {1}here.", "1 arr: 3 1 2", "> Now {1}the row is sorted.", "1 arr: 3 1 2"].join("\n"), T);
    expect(bad.codes).toContain(C.TraceClaim);
    const good = check(["arr = row", "> Start {1}here.", "1 arr: 3 1 2", "> Now {1}the row is sorted.", "1 arr: 1 2 3"].join("\n"), T);
    expect(good.codes).not.toContain(C.TraceClaim);
    // "not sorted yet" is not a claim.
    expect(check(["arr = row", "> Start {1}here.", "1 arr: 3 1 2", "> {1}The row is not sorted yet.", "1 arr: 3 1 2"].join("\n"), T).codes).not.toContain(C.TraceClaim);
  });

  it("removes a verb that moves cells, the states say it", () => {
    const r = check(["arr = row", "> Start {1}here.", "1 arr: 3 1 2", "> {1}Swap them.", "1 swap arr", "1 arr: 1 3 2"].join("\n"), T);
    expect(r.diagnostics.find((d) => d.code === C.TraceVerb)?.fixed).toContain("removed");
    expect(r.printed).not.toMatch(/swap arr/);
  });

  it("warns when too much changes at once", () => {
    const r = check(["arr = row", "> Start {1}here.", "1 arr: 1 2 3 4 5 6", "> {1}All new.", "1 arr: 7 8 9 10 11 12"].join("\n"), { scene: "template=trace" });
    expect(r.codes).toContain(C.TraceBusy);
  });

  it("shows the collection with its first state: nothing is reported as never shown", () => {
    expect(check(ok, T).codes).not.toContain(C.NeverShown);
  });
});

describe("trace items", () => {
  it("attaches a mark that was written as a cell of its own", () => {
    const r = check(['s = stack', '> Calls {1}pile up.', '1 s: "fact(4)" "*"', '> {1}Deeper.', '1 s: "fact(4)" "~" "fact(3)" "*"'].join("\n"), { scene: "template=trace" });
    expect(r.diagnostics.filter((d) => d.code === C.TraceItem).every((d) => d.fixed?.includes("attached"))).toBe(true);
    expect(r.printed).toContain('1 s: "fact(4)"*');
    expect(r.printed).toContain('1 s: "fact(4)"~ "fact(3)"*');
  });
});

describe("narration that is really an action", () => {
  it("is an error, so the repair loop rewrites it instead of speaking it", () => {
    const r = check("t = title \"T\"\n> start write title\n> Real sentence {1}here.\n1 write t", { autofix: false });
    expect(r.codes).toContain(C.NarrationIsAction);
    expect(check("t = title \"T\"\n> We start writing {1}the title.\n1 write t").codes).not.toContain(C.NarrationIsAction);
  });
});

describe("trace links and nodes", () => {
  const T = { scene: "template=trace" };
  it("checks that a link joins named cells of that state", () => {
    const ok = check(["l = chain", "> A {1}list.", "1 l: a:3 b:8 | d->b"].join("\n"), T);
    expect(ok.diagnostics.find((d) => d.code === C.TraceLink)?.message).toContain("`d`");
    expect(check(["l = chain", "> A {1}list.", "1 l: a:3 b:8 | a->b"].join("\n"), T).codes).not.toContain(C.TraceLink);
  });
  it("lists only nodes of the graph or tree, and needs its edges", () => {
    expect(check(['g = graph "A-B"', "> Nodes {1}here.", "1 g: A B Z"].join("\n"), T).diagnostics.find((d) => d.code === C.TraceLink)?.message).toContain("`Z`");
    expect(check(["t = tree", "> Nodes {1}here.", "1 t: A"].join("\n"), T).codes).toContain(C.TraceLink);
    expect(check(['t = tree "R>A R>B"', "> Nodes {1}here.", "1 t: R A"].join("\n"), T).codes).not.toContain(C.TraceLink);
  });
});

describe("trace plots and rings", () => {
  const T = { scene: "template=trace" };
  it("needs a curve the plot can draw and numeric points", () => {
    expect(check(['p = plot "(x-3)^2"', "> A {1}point.", "1 p: 4"].join("\n"), T).codes).not.toContain(C.TraceLink);
    expect(check(['p = plot "drop table"', "> A {1}point.", "1 p: 4"].join("\n"), T).codes).toContain(C.TraceLink);
    expect(check(['p = plot "x^2"', "> A {1}point.", "1 p: a"].join("\n"), T).codes).toContain(C.TraceLink);
  });
  it("needs ring items named with an angle", () => {
    expect(check(["r = ring", "> A {1}ring.", "1 r: A:40 B:150"].join("\n"), T).codes).not.toContain(C.TraceLink);
    expect(check(["r = ring", "> A {1}ring.", "1 r: A:400"].join("\n"), T).codes).toContain(C.TraceLink);
    expect(check(["r = ring", "> A {1}ring.", "1 r: 40"].join("\n"), T).codes).toContain(C.TraceLink);
  });
});

describe("trace lanes and networks", () => {
  const T = { scene: "template=trace" };
  it("lane segments are label:start-end with start before end", () => {
    expect(check(["t = lanes", "> A {1}lane.", "1 t: a: x:0-2"].join("\n"), T).codes).not.toContain(C.TraceLink);
    expect(check(["t = lanes", "> A {1}lane.", "1 t: a: x:5-2"].join("\n"), T).codes).toContain(C.TraceLink);
    expect(check(["t = lanes", "> A {1}lane.", "1 t: a: x:soon"].join("\n"), T).codes).toContain(C.TraceLink);
  });
  it("a network lists only its own nodes and needs sizes", () => {
    expect(check(['n = net "2 3 1"', "> A {1}net.", "1 n: x1 a3 y1"].join("\n"), T).codes).not.toContain(C.TraceLink);
    expect(check(['n = net "2 3 1"', "> A {1}net.", "1 n: x9"].join("\n"), T).codes).toContain(C.TraceLink);
    expect(check(["n = net", "> A {1}net.", "1 n: x1"].join("\n"), T).codes).toContain(C.TraceLink);
  });
});

describe("count needs a number", () => {
  it("counting an element with no digit in its text is an error; a stat is fine", () => {
    const base = (decl: string) => ["scene s", decl, "> A {1}number.", "1 fade r then count r from=0 to=5"].join("\n");
    expect(check(base('r = label "Request"')).codes).toContain(C.TargetRule);
    expect(check(base('r = stat "0" "hits"')).codes).not.toContain(C.TargetRule);
  });
  it("list widgets reject | between items", () => {
    expect(check(['r = proscons "a|b" "c"', "> A {1}list.", "1 fade r"].join("\n"), { scene: "template=grid" }).codes.length).toBeGreaterThan(0);
  });
});

describe("NAR613 trace without states", () => {
  it("a trace scene with collections and no state line is an error", () => {
    const body = ["r = row", "> A {1}row.", "1 fade r"].join("\n");
    expect(check(body, { scene: "template=trace" }).codes).toContain(C.TraceEmpty);
    expect(check(["r = row", "> A {1}row.", "1 r: 1 2 3"].join("\n"), { scene: "template=trace" }).codes).not.toContain(C.TraceEmpty);
  });
});
