import { describe, expect, it } from "vitest";
import { qualityIssues, unspeakable } from "../src/quality.js";

describe("narration a voice cannot say well", () => {
  it("finds addresses, paths and ids", () => {
    expect(unspeakable("Open https://www.example.com/docs and read it.")).toContain("https://www.example.com/docs");
    expect(unspeakable("Go to docs.example.io for more.")).toBe("docs.example.io");
    expect(unspeakable("Mail me@site.com now.")).toBe("me@site.com");
    expect(unspeakable("It lives in /etc/nginx/nginx.conf on the server.")).toBe("/etc/nginx/nginx.conf");
    expect(unspeakable("Commit a1f3c9e fixed the rounding.")).toBe("a1f3c9e");
  });

  it("leaves what the voice reads well: numbers, units, acronyms, ordinary words", () => {
    for (const ok of ["In 1957 the first satellite flew, at about 60% of the budget.", "A 5MB file over HTTP/2 costs $18M.", "The cache hit rate is 99.9 percent, which is deadbeef-free.", "It runs on S3 and EC2 in us-east-1."]) {
      expect(unspeakable(ok), ok).toBeUndefined();
    }
  });

  it("is reported once per scene with the way to fix it", () => {
    const scene = 'scene a "A" template=cards\nc1 = icon:sun "Sun"\nc2 = icon:cloud "Cloud"\n> {1}The sun and {2}the cloud, see https://example.com/docs and a1f3c9e.\n1 pop c1\n2 pop c2\n';
    const q18 = qualityIssues("video 1", scene).filter((i) => i.code === "Q18");
    expect(q18).toHaveLength(1);
    expect(q18[0]!.message).toContain("letter by letter");
  });
});

describe("a designed page is empty until its first item is named", () => {
  const scene = (narration: string) => `scene s "Tea" template=steps\ntitle = title "Tea"\ns1 = icon:flame "Boil" "Fill the kettle"\ns2 = icon:cup-soda "Warm" "Warm the cup"\n${narration}\n`;
  const q19 = (n: string) => qualityIssues("video 1", scene(n)).filter((i) => i.code === "Q19");

  it("is fine when the first item is named in the first or second sentence", () => {
    expect(q19("> First, {s1}boil the water.\n> Then {s2}warm the cup.")).toHaveLength(0);
    expect(q19("> A good cup of tea needs the right order.\n> First, {s1}boil the water, then {s2}warm the cup.")).toHaveLength(0);
  });

  it("is reported when the first item comes in the third sentence or later", () => {
    const issues = q19("> Tea is simple.\n> But the order matters a lot.\n> First, {s1}boil the water, then {s2}warm the cup.");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("sentence 3");
  });

  it("does not apply to the older templates", () => {
    const old = 'scene s "Parts" template=cards\nc1 = icon:sun "Sun"\nc2 = icon:cloud "Cloud"\n> Intro one.\n> Intro two.\n> Intro three.\n> {1}The sun and {2}the cloud.\n1 pop c1\n2 pop c2\n';
    expect(qualityIssues("video 1", old).filter((i) => i.code === "Q19")).toHaveLength(0);
  });
});
