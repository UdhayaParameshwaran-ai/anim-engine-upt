import { parse, print } from "@anim/dsl";
import { describe, expect, it } from "vitest";
import { validate, ValidateCodes as C } from "../src/index.js";

/** A steps scene: three items and the narration given. */
const scene = (narration: string, extra = "", attrs = "") =>
  `video 1\nscene s "Water" template=steps ${attrs}\ntitle = title "The water cycle"\ns1 = icon:droplet "Evaporate" "The sun lifts water"\ns2 = icon:cloud "Condense" "Vapour cools"\ns3 = icon:bolt "Storm" "Clouds charge"\n> ${narration}\n${extra}`;
const NAMED = "The sun {s1}lifts water, then it {s2}cools into clouds, and a {s3}storm builds.";

const check = (src: string) => {
  const parsed = parse(src);
  expect(parsed.diagnostics).toEqual([]);
  return validate(parsed.script);
};

describe("a designed template is cued by the narration: a cue named after an item shows it", () => {
  it("needs no action lines: no diagnostics, nothing about unused cues or elements never shown", () => {
    const r = check(scene(NAMED));
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("is invisible in the script: the actions it makes are never printed back", () => {
    const r = check(scene(NAMED));
    const printed = print(r.script);
    expect(printed).toContain("{s1}");
    expect(printed).not.toMatch(/\bfade\b/);
    expect(printed).not.toMatch(/\bpop\b/);
    // And printing then validating again changes nothing (the script is the same text).
    expect(print(check(printed).script)).toBe(printed);
  });

  it("an item nothing cues is an error that says how to cue it", () => {
    const r = check(scene("The sun {s1}lifts water, then it {s2}cools into clouds."));
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => [d.code, d.severity, d.message])).toEqual([
      [C.NeverShown, "error", "`s3` is never cued: name it in the sentence that says it, in braces right before the words, like `{s3}the runner builds it`"],
    ]);
  });

  it("a numbered cue names no item: the item is still uncued and the cue has no action", () => {
    const r = check(scene("The sun {1}lifts water, then it {s2}cools, and a {s3}storm builds."));
    expect(r.diagnostics.map((d) => d.code).sort()).toEqual([C.NeverShown, C.UnusedCue].sort());
  });

  it("an item cued twice is shown at its first cue", () => {
    const r = check(scene("The sun {s1}lifts water, then it {s2}cools. A {s3}storm builds.\n> And again {s1}the sun lifts water."));
    expect(r.diagnostics).toEqual([]);
    const beats = r.script.scenes[0]!.steps.flatMap((st) => st.beats);
    const made = beats.flatMap((b) => b.actions).filter((a) => a.implicit && a.calls[0]!.targets[0] === "s1");
    expect(made).toHaveLength(1);
  });

  it("an explicit action on an item (the older way) still works and is not doubled", () => {
    const r = check(scene("The sun {s1}lifts water, then it {s2}cools, and a {s3}storm builds.", "s1 pop s1\n"));
    expect(r.diagnostics).toEqual([]);
    const made = r.script.scenes[0]!.steps.flatMap((st) => st.beats).flatMap((b) => b.actions).filter((a) => a.implicit);
    expect(made.map((a) => a.calls[0]!.targets[0]).sort()).toEqual(["s2", "s3"]);
    expect(print(r.script)).toContain("s1 pop s1");
  });

  it("the slots need no cue: title, subtitle, side names", () => {
    const r = check(`video 1\nscene t "Open" template=title\ntitle = title "Hello"\nsubtitle = text "A start"\n> Welcome to this short explainer.\n`);
    expect(r.diagnostics).toEqual([]);
  });

  it("does not touch the older templates: a cue there still needs its action", () => {
    const r = check(`video 1\nscene s "Parts" template=cards\nc1 = icon:sun "Sun"\nc2 = icon:cloud "Cloud"\n> {c1}The sun and {c2}the cloud.\n`);
    expect(r.diagnostics.map((d) => d.code)).toContain(C.UnusedCue);
  });
});

describe("the page options a scene can ask for", () => {
  const knobs = (src: string) => check(src).diagnostics.filter((d) => d.code === C.BadLayoutKnob).map((d) => d.message);

  it("accepts pace, kicker, bg and highlight where their page uses them", () => {
    expect(knobs(scene(NAMED, "", "pace=snappy"))).toEqual([]);
    expect(knobs(`video 1\nscene t "Open" template=title bg=deep pace=relaxed\ntitle = title "Hello"\n> Welcome.\n`)).toEqual([]);
    expect(knobs(`video 1\nscene s "Users" template=stats highlight=s2\ntitle = title "Users"\ns1 = icon:user "Q1" "12k"\ns2 = icon:user "Q2" "21k"\n> It began at {s1}twelve thousand and {s2}reached twenty-one.\n`)).toEqual([]);
  });

  it("names the values when one is wrong", () => {
    expect(knobs(scene(NAMED, "", "pace=quick"))).toEqual(["pace= takes relaxed, normal, snappy, not `quick`"]);
    expect(knobs(`video 1\nscene t "Open" template=title bg=blue\ntitle = title "Hello"\n> Welcome.\n`)).toEqual(["bg= takes auto, base, tint, deep, not `blue`"]);
  });

  it("says where an option does not apply, and drops it", () => {
    expect(knobs(scene(NAMED, "", "bg=deep"))).toEqual(["`bg=` is for `title`; `steps` ignores it"]);
    expect(knobs(scene(NAMED, "", "highlight=s1"))).toEqual(["`highlight=` is for `stats`; `steps` ignores it"]);
    expect(knobs(`video 1\nscene s "Parts" template=cards pace=snappy\nc1 = icon:sun "Sun"\nc2 = icon:cloud "Cloud"\n> {1}The sun and {2}the cloud.\n1 pop c1\n2 pop c2\n`)[0]).toMatch(/`pace=` is for .*`cards` ignores it/);
  });

  it("highlight= takes the id of one of the stats", () => {
    expect(knobs(`video 1\nscene s "Users" template=stats highlight=zz\ntitle = title "Users"\ns1 = icon:user "Q1" "12k"\ns2 = icon:user "Q2" "21k"\n> It began at {s1}twelve thousand and {s2}reached twenty-one.\n`)).toEqual(["highlight= takes the id of one of the stats (s1, s2), not `zz`"]);
  });

  it("there is no enter= or order=: the pages only use them for the timeline's arrows", () => {
    const r = check(scene(NAMED, "", "enter=left"));
    expect(r.diagnostics.map((d) => d.code)).toContain(C.UnknownSceneAttr);
  });

  it("there is no playout=: a page never leaves by itself, the scene's transition takes it away", () => {
    const r = check(`video 1\nscene t "Open" template=title playout=true\ntitle = title "Hello"\n> Welcome.\n`);
    expect(r.diagnostics.map((d) => d.code)).toContain(C.UnknownSceneAttr);
  });

  it("a stats scene can say what its numbers measure: metric, yaxis and xaxis are slots, with limits", () => {
    const stats = (extra: string) => `video 1\nscene s "Users" template=stats variant=comet\ntitle = title "Users"\n${extra}s1 = icon:user "Q1" "12k"\ns2 = icon:user "Q2" "21k"\n> It began at {s1}twelve thousand and {s2}reached twenty-one.\n`;
    expect(check(stats('metric = text "Users per quarter"\nyaxis = text "Users (thousands)"\nxaxis = text "Quarter"\n')).diagnostics).toEqual([]);
    const long = check(stats(`yaxis = text "${"y".repeat(41)}"\n`));
    expect(long.diagnostics.map((d) => d.code)).toEqual([C.TemplateText]);
  });

  it("a kicker is a slot: optional, up to 40 characters", () => {
    expect(check(scene(NAMED).replace("title = title", 'kicker = text "How it works"\ntitle = title')).diagnostics).toEqual([]);
    const long = check(scene(NAMED).replace("title = title", `kicker = text "${"x".repeat(41)}"\ntitle = title`));
    expect(long.diagnostics.map((d) => d.code)).toEqual([C.TemplateText]);
  });
});

describe("verbs that have nothing to act on in a designed template are dropped", () => {
  it("mark, shake, visit, pulse and the like are removed with a warning; pop and fade (cues in older scripts) stay", () => {
    const r = check(scene("The sun {s1}lifts water, then it {s2}cools, and a {s3}storm builds.", "s1 pop s1\ns2 mark s2 as=fail\ns3 shake s3\n"));
    const gone = r.diagnostics.filter((d) => d.code === C.TemplateVerb);
    expect(gone.map((d) => [d.severity, d.fixed])).toEqual([["warning", "removed the line"], ["warning", "removed the line"]]);
    expect(gone[0]!.message).toContain("`mark` has nothing to act on in `steps`");
    const verbs = r.script.scenes[0]!.steps.flatMap((st) => st.beats).flatMap((b) => b.actions).filter((a) => !a.implicit).flatMap((a) => a.calls.map((c) => c.verb));
    expect(verbs).toEqual(["pop"]);
    expect(print(r.script)).not.toMatch(/\bmark\b|\bshake\b/);
  });

  it("a layout template keeps its verbs", () => {
    const r = check(`video 1\nscene s "Parts" template=cards\nc1 = icon:sun "Sun"\nc2 = icon:cloud "Cloud"\n> {1}The sun and {2}the cloud.\n1 pop c1 then mark c1 as=ok\n2 pop c2\n`);
    expect(r.diagnostics.map((d) => d.code)).not.toContain(C.TemplateVerb);
  });
});
