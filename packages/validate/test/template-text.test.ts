import { parse } from "@anim/dsl";
import { STEPS } from "@anim/html-templates";
import { describe, expect, it } from "vitest";
import { validate, ValidateCodes as C } from "../src/index.js";

/** Validates a steps scene whose items are `icon:sun "<title>" "<detail>"`. */
function steps(items: { title?: string; detail?: string }[], attrs = "") {
  const decl = items.map((it, i) => `s${i + 1} = icon:sun "${it.title ?? "Step"}"${it.detail !== undefined ? ` "${it.detail}"` : ""}`);
  const src = `video 1\nscene s template=steps ${attrs}\n${decl.join("\n")}\n> ${items.map((_, i) => `{${i + 1}}x`).join(" ")}.\n${items.map((_, i) => `${i + 1} pop s${i + 1}`).join("\n")}\n`;
  const parsed = parse(src);
  expect(parsed.diagnostics).toEqual([]);
  const r = validate(parsed.script);
  return { ...r, text: r.diagnostics.filter((d) => d.code === C.TemplateText) };
}

const chars = (n: number) => "x".repeat(n);
const two = (item: { title?: string; detail?: string }) => [item, { title: "Other", detail: "Fine" }];

describe("NAR616: text that does not fit the page", () => {
  it("is an error for a title or a detail over the limit, and names the limit", () => {
    const long = steps(two({ title: chars(41), detail: chars(101) }));
    expect(long.ok).toBe(false);
    expect(long.text.map((d) => d.severity)).toEqual(["error", "error"]);
    expect(long.text[0]!.message).toBe("`s1`: the first string is 41 characters; no motion that fits this scene takes more than 40. Shorten it");
    expect(long.text[1]!.message).toBe("`s1`: the second string is 101 characters; no motion that fits this scene takes more than 100. Shorten it");
  });

  it("does not fire at the limit", () => {
    const edge = steps(two({ title: chars(40), detail: chars(100) }));
    expect(edge.text).toEqual([]);
    expect(edge.diagnostics).toEqual([]);
    expect(edge.ok).toBe(true);
  });

  it("is checked once per item, and only the long one is reported", () => {
    const r = steps([{ title: chars(41) }, { title: "Short" }, { title: chars(50) }]);
    expect(r.text.map((d) => d.message.split(":")[0])).toEqual(["`s1`", "`s3`"]);
  });

  it("uses the limits of the named variant, the numbers measured for it", () => {
    for (const v of STEPS.variants) {
      const ok = steps(two({ title: chars(v.titleChars), detail: chars(v.detailChars) }), `variant=${v.id}`);
      expect(ok.text, `${v.id} at its limits`).toEqual([]);
      const over = steps(two({ title: chars(v.titleChars + 1), detail: chars(v.detailChars + 1) }), `variant=${v.id}`);
      expect(over.text.map((d) => d.message), `${v.id} over its limits`).toEqual([
        `\`s1\`: the first string is ${v.titleChars + 1} characters; \`${v.id}\` takes at most ${v.titleChars}. Shorten it`,
        `\`s1\`: the second string is ${v.detailChars + 1} characters; \`${v.id}\` takes at most ${v.detailChars}. Shorten it`,
      ]);
    }
    // Spot checks of the numbers themselves: morph is the tightest, rail the roomiest.
    expect(STEPS.variants.map((v) => [v.id, v.titleChars, v.detailChars]).filter(([id]) => id === "morph" || id === "rail" || id === "deck")).toEqual([["rail", 40, 100], ["deck", 28, 66], ["morph", 20, 48]]);
  });

  it("with no variant or variant=auto, a text is fine when any variant that takes this many items takes it (the Director and the compiler pick one)", () => {
    // Four items: every variant takes them. morph takes only 20, rail takes 40: 21 to 40 is fine, 41 is too long for all.
    for (const attrs of ["", "variant=auto"]) {
      const four = (title: string) => steps([{ title }, { title: "B" }, { title: "C" }, { title: "D" }], attrs);
      expect(four(chars(21)).text, attrs).toEqual([]);
      expect(four(chars(40)).text, attrs).toEqual([]);
      expect(four(chars(41)).text.map((d) => d.message), attrs).toEqual(["`s1`: the first string is 41 characters; no motion that fits this scene takes more than 40. Shorten it"]);
    }
  });

  it("is not raised for other templates", () => {
    const r = validate(parse(`video 1\nscene s template=cards\na = icon:sun "${chars(80)}"\nb = icon:gear "Two"\n> {1}x {2}y.\n1 pop a\n2 pop b\n`).script);
    expect(r.diagnostics.filter((d) => d.code === C.TemplateText)).toEqual([]);
  });
});

describe("a detail line on icon and asset", () => {
  const scene = (a: string, b: string) => validate(parse(`video 1\nscene s template=steps\ns1 = ${a}\ns2 = ${b}\n> {1}One {2}two.\n1 pop s1\n2 pop s2\n`).script);

  it("is accepted as a second quoted string, with no diagnostics", () => {
    const r = scene('icon:send "Inject" "A harmless piece enters the arm"', 'asset:leaf "Absorb" "The leaf takes in light"');
    expect(r.diagnostics).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("is accepted as a third string too (stats: a value and a change)", () => {
    const r = scene('icon:send "A" "B" "C"', 'asset:leaf "X" "Y" "Z"');
    expect(r.diagnostics.map((d) => d.code)).not.toContain(C.TextCount);
  });

  it("is rejected as a fourth string (NAR208): three are read at most", () => {
    for (const [a, b] of [['icon:send "A" "B" "C" "D"', 'asset:leaf "X"'], ['icon:send "A"', 'asset:leaf "X" "Y" "Z" "W"']] as const) {
      const r = scene(a, b);
      expect(r.diagnostics.map((d) => d.code), `${a} / ${b}`).toContain(C.TextCount);
    }
  });

  it("is still one string at most for a kind without room for a detail (a box)", () => {
    const r = validate(parse(`video 1\nscene s template=steps\ns1 = box "A" "B"\n> {1}One.\n1 pop s1\n`).script);
    expect(r.diagnostics.map((d) => d.code)).toContain(C.TextCount);
  });
});

/** The other hosted templates: one scene each, to check the limit per string position and per named slot. */
function hosted(template: string, body: string, narrate: string, attrs = "") {
  const parsed = parse(`video 1\nscene s template=${template} ${attrs}\n${body}\n> ${narrate}\n`);
  expect(parsed.diagnostics).toEqual([]);
  const r = validate(parsed.script);
  return { ...r, text: r.diagnostics.filter((d) => d.code === C.TemplateText) };
}
const msgs = (r: { text: { message: string }[] }) => r.text.map((d) => d.message);

describe("NAR616 for the other hosted templates", () => {
  it("compare: a row point over the limit is an error, at the limit it is not (and the side names have their own)", () => {
    const row = (a: number, b: number) => hosted("compare", `left = label "Old"\nright = label "New"\nr1 = icon:database "${chars(a)}" "${chars(b)}"`, "{1}One.\n1 pop r1", "variant=flip");
    expect(row(48, 48).text).toEqual([]);
    expect(msgs(row(49, 48))).toEqual(["`r1`: the first string is 49 characters; `flip` takes at most 48. Shorten it"]);
    expect(msgs(row(48, 49))).toEqual(["`r1`: the second string is 49 characters; `flip` takes at most 48. Shorten it"]);
    const side = (n: number) => hosted("compare", `left = label "${chars(n)}"\nright = label "New"\nr1 = icon:database "a" "b"`, "{1}One.\n1 pop r1");
    expect(side(24).text).toEqual([]);
    expect(msgs(side(25))).toEqual(["`left`: 25 characters; no motion that fits this scene takes more than 24. Shorten it"]);
  });

  it("title: a headline over the limit is an error, at the limit it is not; the subtitle has its own limit", () => {
    const head = (n: number, sub = "Sub") => hosted("title", `title = title "${chars(n)}"\nsubtitle = text "${sub}"`, "{1}Hello.\n1 write title", "variant=logo");
    expect(head(32).text).toEqual([]);
    expect(msgs(head(33))).toEqual(["`title`: 33 characters; `logo` takes at most 32. Shorten it"]);
    expect(head(10, chars(48)).text).toEqual([]);
    expect(msgs(head(10, chars(49)))).toEqual(["`subtitle`: 49 characters; `logo` takes at most 48. Shorten it"]);
    // With no variant written, the roomiest motion counts (rise takes min(round(1.6 x measured), 60)): the Director and the compiler pick one that fits.
    expect(hosted("title", `title = title "${chars(60)}"`, "{1}Hello.\n1 write title").text).toEqual([]);
    expect(msgs(hosted("title", `title = title "${chars(61)}"`, "{1}Hello.\n1 write title"))).toEqual(["`title`: 61 characters; no motion that fits this scene takes more than 60. Shorten it"]);
  });

  it("timeline: a date, a title and a detail each have a limit by position", () => {
    const ev = (a: number, b: number, c: number) => hosted("timeline", `t1 = label "${chars(a)}" "${chars(b)}" "${chars(c)}"\nt2 = label "2000" "B" "C"`, "{1}One {2}two.\n1 pop t1\n2 pop t2", "variant=ribbon");
    expect(ev(12, 20, 48).text).toEqual([]);
    expect(msgs(ev(13, 20, 48))).toEqual(["`t1`: the first string is 13 characters; `ribbon` takes at most 12. Shorten it"]);
    expect(msgs(ev(12, 21, 48))).toEqual(["`t1`: the second string is 21 characters; `ribbon` takes at most 20. Shorten it"]);
    expect(msgs(ev(12, 20, 49))).toEqual(["`t1`: the third string is 49 characters; `ribbon` takes at most 48. Shorten it"]);
  });

  it("chart: a label over the limit is an error, at the limit it is not; the value has its own", () => {
    const bar = (label: number, value: number) => hosted("chart", `b1 = label "${chars(label)}" "${chars(value)}"\nb2 = label "B" "2"`, "{1}One {2}two.\n1 pop b1\n2 pop b2", "variant=bar-wipe");
    expect(bar(14, 12).text).toEqual([]);
    expect(msgs(bar(15, 12))).toEqual(["`b1`: the first string is 15 characters; `bar-wipe` takes at most 14. Shorten it"]);
    expect(msgs(bar(14, 13))).toEqual(["`b1`: the second string is 13 characters; `bar-wipe` takes at most 12. Shorten it"]);
  });

  it("stats: a label, a value and a change each have a limit by position", () => {
    const s = (a: number, b: number, c: number) => hosted("stats", `s1 = icon:user "${chars(a)}" "${chars(b)}" "${chars(c)}"`, "{1}One.\n1 pop s1", "variant=odometer");
    expect(s(28, 12, 28).text).toEqual([]);
    expect(msgs(s(29, 13, 29))).toEqual([
      "`s1`: the first string is 29 characters; `odometer` takes at most 28. Shorten it",
      "`s1`: the second string is 13 characters; `odometer` takes at most 12. Shorten it",
      "`s1`: the third string is 29 characters; `odometer` takes at most 28. Shorten it",
    ]);
  });

  it("ui: a control label and its text are checked like a step's title and detail", () => {
    const q = (a: number, b: number) => hosted("ui", `q1 = icon:send "${chars(a)}" "${chars(b)}"`, "{1}One.\n1 pop q1", "variant=drag");
    expect(q(12, 30).text).toEqual([]);
    expect(msgs(q(13, 31))).toEqual([
      "`q1`: the first string is 13 characters; `drag` takes at most 12. Shorten it",
      "`q1`: the second string is 31 characters; `drag` takes at most 30. Shorten it",
    ]);
  });
});

describe("variant= on a designed template: a family, or nothing", () => {
  const chart = (attrs: string, label = "Jan") => hosted("chart", `b1 = label "${label}" "$1"\nb2 = label "B" "2"\nb3 = label "C" "3"`, "{1}One {2}two {3}three.\n1 pop b1\n2 pop b2\n3 pop b3", attrs);
  const knob = (r: { diagnostics: { code: string; message: string }[] }) => r.diagnostics.filter((d) => d.code === C.BadLayoutKnob).map((d) => d.message);

  it("accepts a family name, and a variant id", () => {
    for (const attrs of ["variant=bars", "variant=line", "variant=ring", "variant=bar-rise", "variant=auto", ""]) expect(knob(chart(attrs)), attrs).toEqual([]);
  });

  it("names the families to choose between when the name is wrong", () => {
    expect(knob(chart("variant=pie"))).toEqual(["template `chart` has no variant `pie` (choose between: bars, line, ring, auto)"]);
  });

  it("checks the text against the variants of the family only", () => {
    // bar-wipe takes 14 characters but the other bars take 24: a 20-character label is fine for bars, and for a ring.
    expect(chart("variant=bars", chars(20)).text).toEqual([]);
    expect(chart("variant=ring", chars(24)).text).toEqual([]);
    expect(msgs(chart("variant=ring", chars(25)))).toEqual(["`b1`: the first string is 25 characters; no motion that fits this scene takes more than 24. Shorten it"]);
  });

  it("with nothing written, the family of the default (bars) is the scope", () => {
    expect(chart("", chars(24)).text).toEqual([]);
  });
});

describe("a hosted scene needs no cue for the elements that fill its slots (the page draws them)", () => {
  const diags = (src: string) => validate(parse(src).script).diagnostics;

  it("compare: left, right and title are never 'declared but never shown' and need no cue", () => {
    const src = `video 1\nscene s template=compare\ntitle = title "T"\nleft = label "Old"\nright = label "New"\nr1 = icon:database "a" "b"\n> {1}One.\n1 pop r1\n`;
    expect(diags(src)).toEqual([]);
  });

  it("title: subtitle, kicker, byline and brand need no cue either", () => {
    const src = `video 1\nscene s template=title\ntitle = title "T"\nsubtitle = text "S"\nkicker = text "K"\nbyline = text "B"\nbrand = text "Br"\n> {1}Hello.\n1 write title\n`;
    expect(diags(src)).toEqual([]);
  });

  it("an item that no verb shows is still reported (only slot elements are exempt)", () => {
    const src = `video 1\nscene s template=steps\ns1 = icon:sun "A" "B"\ns2 = icon:sun "C" "D"\n> {1}One.\n1 pop s1\n`;
    expect(diags(src).map((d) => d.code)).toEqual([C.NeverShown]);
  });
});

describe("NAR617: an item without the strings its page reads, and attributes a designed template ignores", () => {
  const strings = (r: { diagnostics: { code: string; message: string }[] }) => r.diagnostics.filter((d) => d.code === C.TemplateStrings).map((d) => d.message);

  it("a compare row needs both points; a carried-over element with one string is the usual cause", () => {
    const r = hosted("compare", `left = label "REST"\nright = label "GraphQL"\nclient = icon:smartphone "Mobile app"\nr1 = icon:database "a" "b"`, "{1}One.\n1 pop r1");
    expect(strings(r)).toEqual(["`client`: a compare row needs 2 strings (point, point); it has 1. Every element that is not a slot (title, left, right) is an item: carry nothing over into this scene"]);
    expect(r.ok).toBe(false);
  });

  it("each template names what it needs", () => {
    expect(strings(hosted("chart", `b1 = label "Jan"\nb2 = label "Feb" "2"`, "{1}One {2}two.\n1 pop b1\n2 pop b2"))).toHaveLength(1);
    expect(strings(hosted("stats", `s1 = icon:user "Users"`, "{1}One.\n1 pop s1"))).toHaveLength(1);
    expect(strings(hosted("timeline", `t1 = label "1969"\nt2 = label "1971" "Email"`, "{1}One {2}two.\n1 pop t1\n2 pop t2"))).toHaveLength(1);
    expect(strings(hosted("ui", `q1 = icon:send "Send"`, "{1}One.\n1 pop q1"))).toHaveLength(1);
  });

  it("allows what is optional: a step without a detail, a timeline event without one, a title with only a headline", () => {
    expect(strings(hosted("steps", `s1 = icon:sun "Step"\ns2 = icon:sun "Two"`, "{1}One {2}two.\n1 pop s1\n2 pop s2"))).toEqual([]);
    expect(strings(hosted("timeline", `t1 = label "1969" "Net"\nt2 = label "1971" "Email"`, "{1}One {2}two.\n1 pop t1\n2 pop t2"))).toEqual([]);
    expect(strings(hosted("title", `title = title "Hello"`, "{1}Hi.\n1 write title"))).toEqual([]);
  });

  it("warns about carry, keep, emphasis, density, mirror and frame, and drops them", () => {
    const r = hosted("compare", `left = label "A"\nright = label "B"\nr1 = icon:database "a" "b"`, "{1}One.\n1 pop r1", "emphasis=last density=airy");
    const knobs = r.diagnostics.filter((d) => d.code === C.BadLayoutKnob).map((d) => d.message);
    expect(knobs).toEqual(["`emphasis=` does nothing in `compare`: the designer's page draws the whole scene", "`density=` does nothing in `compare`: the designer's page draws the whole scene"]);
  });

  it("is not raised for other templates", () => {
    const r = validate(parse(`video 1\nscene s template=cards emphasis=first\na = icon:sun "One"\nb = icon:gear "Two"\n> {1}x {2}y.\n1 pop a\n2 pop b\n`).script);
    expect(r.diagnostics.filter((d) => d.code === C.TemplateStrings)).toEqual([]);
  });
});
