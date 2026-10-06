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
