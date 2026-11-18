import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Codes, parse, Parser, print, type Scene, type SpeechBeat } from "../src/index.js";

const EXAMPLES = join(import.meta.dirname, "../../../examples");

function stripSpans<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (k, val) => (k === "span" ? undefined : val)));
}

function speech(src: string): SpeechBeat {
  const { script, diagnostics } = parse(`video 1\nscene s\n${src}\n`);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return script.scenes[0]!.steps[0]!.beats[0] as SpeechBeat;
}

describe("examples", () => {
  for (const file of readdirSync(EXAMPLES).filter((f) => f.endsWith(".txt"))) {
    const src = readFileSync(join(EXAMPLES, file), "utf8");

    it(`${file} parses without diagnostics`, () => {
      expect(parse(src).diagnostics).toEqual([]);
    });

    it(`${file} round-trips through the printer`, () => {
      const a = parse(src).script;
      const printed = print(a);
      const b = parse(printed);
      expect(b.diagnostics).toEqual([]);
      expect(stripSpans(b.script)).toEqual(stripSpans(a));
      expect(print(b.script)).toBe(printed);
    });

    it(`${file} parses identically when streamed in small chunks`, () => {
      const p = new Parser();
      for (let i = 0; i < src.length; i += 7) p.feed(src.slice(i, i + 7));
      expect(p.end()).toEqual(parse(src));
    });
  }
});

describe("narration cues", () => {
  it("strips markers so the text is exactly what TTS speaks", () => {
    const b = speech("> Plants need {1}sunlight and {2 carbon dioxide}.");
    expect(b.text).toBe("Plants need sunlight and carbon dioxide.");
  });

  it("anchors a point cue at the start of the next word", () => {
    const b = speech("> Plants need {1} sunlight.");
    expect(b.text.slice(b.cues[0]!.start)).toMatch(/^sunlight/);
  });

  it("gives a span cue the offsets of its words", () => {
    const b = speech("> All three flow into the {1 green leaf}.");
    const c = b.cues[0]!;
    expect(b.text.slice(c.start, c.end)).toBe("green leaf");
  });

  it("handles a point cue directly before a span cue", () => {
    const b = speech("> See {1}{2 this part} here.");
    expect(b.cues.map((c) => [c.id, c.start, c.end])).toEqual([
      ["1", 4, undefined],
      ["2", 4, 13],
    ]);
  });

  it("supports escaped braces", () => {
    const b = speech("> A set \\{a, b\\} has {1}two items.");
    expect(b.text).toBe("A set {a, b} has two items.");
    expect(b.text.slice(b.cues[0]!.start)).toMatch(/^two/);
  });

  it("warns about a point cue with no following word", () => {
    const { diagnostics, script } = parse("video 1\nscene s\n> The end.{1}\n");
    expect(diagnostics.map((d) => d.code)).toEqual([Codes.TrailingPointCue]);
    const b = script.scenes[0]!.steps[0]!.beats[0] as SpeechBeat;
    expect(b.cues[0]!.start).toBe(b.text.length);
  });

  it("reports unclosed and duplicate cues", () => {
    expect(parse("video 1\nscene s\n> A {1 broken.\n").diagnostics.map((d) => d.code)).toEqual([Codes.UnclosedCue]);
    expect(parse("video 1\nscene s\n> {1}a {1}b\n").diagnostics.map((d) => d.code)).toEqual([Codes.DuplicateCue]);
  });
});

describe("actions", () => {
  it("parses targets, args and then-chains", () => {
    const b = speech("> x {1}y z\n1 draw a1,a2,a3 /0.15 then highlight leaf fit color=warn +0.2 0.8s");
    expect(stripSpans(b.actions)).toEqual([
      {
        anchor: "1",
        calls: [
          { verb: "draw", targets: ["a1", "a2", "a3"], args: { stagger: 0.15, params: {} } },
          { verb: "highlight", targets: ["leaf"], args: { fit: true, delay: 0.2, duration: 0.8, params: { color: "warn" } } },
        ],
      },
    ]);
  });

  it("parses destinations, relations, parts and focus reset", () => {
    const b = speech("> x {1}y\n1 move oxy @TR\n1 move a @right-of:b\n1 highlight list.2\n1 focus reset\nend pulse *");
    const calls = b.actions.map((a) => stripSpans(a.calls[0]!));
    expect(calls[0]!.args.place).toEqual({ kind: "slot", slot: "TR" });
    expect(calls[1]!.args.place).toEqual({ kind: "relative", relation: "right-of", ref: "b" });
    expect(calls[2]!.targets).toEqual(["list.2"]);
    expect(calls[3]!.targets).toEqual(["reset"]);
    expect(b.actions[4]!.anchor).toBe("end");
    expect(calls[4]!.targets).toEqual(["*"]);
  });

  it("allows a target-less verb", () => {
    const b = speech("> x {1}y\n1 clear 0.5");
    expect(stripSpans(b.actions[0]!.calls[0]!)).toEqual({ verb: "clear", targets: [], args: { duration: 0.5, params: {} } });
  });

  it("rejects actions before any beat and bad arguments", () => {
    expect(parse("video 1\nscene s\n1 pop sun\n").diagnostics.map((d) => d.code)).toEqual([Codes.ActionWithoutBeat]);
    expect(parse("video 1\nscene s\n> {1}a\n1 pop sun ???\n").diagnostics.map((d) => d.code)).toEqual([Codes.BadArgument]);
  });
});

describe("declarations", () => {
  const scene = (body: string): Scene => {
    const r = parse(`video 1\nscene s template=flow\n${body}\n`);
    expect(r.diagnostics).toEqual([]);
    return r.script.scenes[0]!;
  };

  it("parses kind, name, version, texts, attrs and placement", () => {
    const el = stripSpans(scene('sug = icon:cube@2 "glucose" size=lg @L').steps[0]!.elements[0]!);
    expect(el).toEqual({ id: "sug", kind: "icon", name: "cube", version: "2", texts: ["glucose"], attrs: { size: "lg" }, place: { kind: "slot", slot: "L" } });
  });

  it("parses arrows and graph edges with or without spaces", () => {
    const els = scene('a1 = arrow sun->leaf\na2 = arrow sun -> leaf "light"\ne1 = n1 -> n2 "yes"\ne2 = n2->n3').steps[0]!.elements;
    expect(els.map((e) => [e.kind, e.link, e.texts])).toEqual([
      ["arrow", { from: "sun", to: "leaf" }, []],
      ["arrow", { from: "sun", to: "leaf" }, ["light"]],
      ["edge", { from: "n1", to: "n2" }, ["yes"]],
      ["edge", { from: "n2", to: "n3" }, []],
    ]);
  });

  it("keeps scene attributes including template", () => {
    const { script } = parse('video 1\nscene a "Title" template=compare in=fade keep=x,y\n');
    expect(script.scenes[0]!.attrs).toEqual({ template: "compare", in: "fade", keep: "x,y" });
    expect(script.scenes[0]!.title).toBe("Title");
  });
});

describe("structure and recovery", () => {
  it("requires the header", () => {
    expect(parse("scene s\n> hi\n").diagnostics.map((d) => d.code)).toEqual([Codes.MissingHeader]);
    expect(parse("video 2\n").diagnostics.map((d) => d.code)).toEqual([Codes.UnsupportedVersion]);
  });

  it("rejects statements outside a scene", () => {
    expect(parse("video 1\nsun = icon:sun\n").diagnostics.map((d) => d.code)).toEqual([Codes.OutsideScene]);
  });

  it("keeps parsing after a bad line and reports its position", () => {
    const { script, diagnostics } = parse("video 1\nscene s\nbogus line here\n> Still {1}fine.\n1 pop a\n");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.span.line).toBe(3);
    expect((script.scenes[0]!.steps[0]!.beats[0] as SpeechBeat).actions).toHaveLength(1);
  });

  it("splits steps and drops an empty implicit step", () => {
    const { script } = parse("video 1\nscene s\nstep one\n> a\nstep two \"Two\"\nfocus x\n> b\n");
    const steps = script.scenes[0]!.steps;
    expect(steps.map((s) => [s.id, s.title, s.implicit, s.focus?.name])).toEqual([
      ["one", undefined, false, undefined],
      ["two", "Two", false, "x"],
    ]);
  });

  it("rejects focus after a beat", () => {
    expect(parse("video 1\nscene s\n> a\nfocus x\n").diagnostics.map((d) => d.code)).toEqual([Codes.MisplacedFocus]);
  });

  it("emits each scene as soon as it completes", () => {
    const seen: string[] = [];
    const p = new Parser({ onScene: (s) => seen.push(s.id) });
    p.feed("video 1\nscene a\n> one\nscene b\n");
    expect(seen).toEqual(["a"]);
    p.feed("> two\n");
    p.end();
    expect(seen).toEqual(["a", "b"]);
  });
});

describe("state lines", () => {
  const SRC = [
    'video 1 "T"',
    'scene part "Partition" template=trace check=partition',
    "arr = row",
    "> We partition around {1}four, then {2}swap.",
    "1 arr: 7 2* 9 1 4 | s=0 j=1 p=4",
    "2 arr: b:2+ 7 \"fib(3)\" 1 4~",
    "> {1}Empty now.",
    "1 arr:",
    "",
  ].join("\n");

  it("reads a snapshot into a state call on the collection", () => {
    const { script, diagnostics } = parse(SRC);
    expect(diagnostics).toEqual([]);
    const beat = script.scenes[0]!.steps[0]!.beats[0] as SpeechBeat;
    const [first, second] = beat.actions;
    expect(first!.anchor).toBe("1");
    expect(first!.calls[0]).toMatchObject({ verb: "state", targets: ["arr"] });
    expect(first!.calls[0]!.state!.items.map((i) => i.value)).toEqual(["7", "2", "9", "1", "4"]);
    expect(first!.calls[0]!.state!.items[1]!.mark).toBe("*");
    expect(first!.calls[0]!.state!.pointers).toEqual([{ name: "s", at: "0" }, { name: "j", at: "1" }, { name: "p", at: "4" }]);
    expect(second!.calls[0]!.state!.items[0]).toEqual({ id: "b", value: "2", mark: "+" });
    expect(second!.calls[0]!.state!.items[2]).toEqual({ value: "fib(3)" });
    const empty = (script.scenes[0]!.steps[0]!.beats[1] as SpeechBeat).actions[0]!.calls[0]!;
    expect(empty.state).toEqual({ items: [], pointers: [] });
  });

  it("prints state lines back exactly", () => {
    const printed = print(parse(SRC).script);
    expect(printed).toContain("1 arr: 7 2* 9 1 4 | s=0 j=1 p=4");
    expect(printed).toContain('2 arr: b:2+ 7 "fib(3)" 1 4~');
    expect(printed).toContain("1 arr:\n");
    expect(print(parse(printed).script)).toBe(printed);
  });

  it("reports a malformed pointer", () => {
    const { diagnostics } = parse(SRC.replace("p=4", "p"));
    expect(diagnostics.map((d) => d.code)).toContain(Codes.BadArgument);
  });
});

describe("state line marks", () => {
  it("attaches a mark that touches a quoted value, and leaves a spaced one as a value", () => {
    const body = (line: string) => parse(`video 1 "T"\nscene s template=trace\nr = row\n> A {1}row.\n${line}\n`).script.scenes[0]!.steps[0]!.beats[0]!.actions[0]!.calls[0]!.state!.items;
    expect(body('1 r: "20:25"* "fact(4)"+ 7')).toEqual([{ value: "20:25", mark: "*" }, { value: "fact(4)", mark: "+" }, { value: "7" }]);
    expect(body('1 r: "a" *').map((i) => i.value)).toEqual(["a", "*"]);
  });
});

describe("state chains and links", () => {
  const read = (line: string) => parse(`video 1 "T"\nscene s template=trace\nl = list\n> A {1}list.\n${line}\n`).script.scenes[0]!.steps[0]!.beats[0]!.actions[0]!.calls[0]!.state!;
  it("reads a detached chain, labelled buckets and extra links", () => {
    const a = read("1 l: a:3 b:8 c:15 / d:10 | head=a d->c");
    expect(a.items.map((i) => [i.id ?? i.value, i.chain ?? 0])).toEqual([["a", 0], ["b", 0], ["c", 0], ["d", 1]]);
    expect(a.chains).toEqual([{}, {}]);
    expect(a.links).toEqual([{ from: "d", to: "c" }]);
    expect(a.pointers).toEqual([{ name: "head", at: "a" }]);
    const b = read("1 l: 2: 12 7 4: 9");
    expect(b.chains).toEqual([{}, { label: "2" }, { label: "4" }]);
    expect(b.items.map((i) => [i.value, i.chain])).toEqual([["12", 1], ["7", 1], ["9", 2]]);
    expect(read("1 l: 3: 5").items[0]!.chain).toBe(1);
  });
  it("prints chains and links back exactly", () => {
    const src = 'video 1 "T"\nscene s template=trace\nl = list\n> A {1}list.\n1 l: a:3 b:8 / d:10 | head=a d->b\n> And {1}buckets.\n1 l: 2: 12 7 4: 9\n';
    const printed = print(parse(src).script);
    expect(printed).toContain("1 l: a:3 b:8 / d:10 | head=a d->b");
    expect(printed).toContain("1 l: 2: 12 7 4: 9");
    expect(print(parse(printed).script)).toBe(printed);
  });
});

describe("quoted text keeps unknown backslashes", () => {
  it("a Windows path survives, while an escaped quote, backslash and \n still work", () => {
    const src = String.raw`video 1
scene s "S"
t = body "C:\Users\me say \"hi\" a\b"
`;
    const { script } = parse(src);
    const el = script.scenes[0]!.steps[0]!.elements.find((e) => e.id === "t")!;
    expect(el.texts[0]).toBe(String.raw`C:\Users\me say "hi" a\b`);
    expect(print(parse(print(script)).script)).toBe(print(script));
  });
});
