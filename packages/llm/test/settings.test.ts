import { TEMPLATES } from "@anim/registry";
import { describe, expect, it } from "vitest";
import { effectiveSpec, outlinePrompt, planningAdvice, sanitizeSettings, sceneKindOf, sceneSystemPrompt, STORY_HINTS, systemPrompt } from "../src/index.js";

describe("prompt settings", () => {
  it("keeps only known, bounded fields", () => {
    const s = sanitizeSettings({ audience: "  beginners ", scenes: { min: 5, max: 400 }, maxWords: 2, sentences: { min: 0, max: 3 }, bogus: 1, length: "huge", motionHints: { tree: "walk it", "Bad Name": "x" } });
    expect(s).toEqual({ audience: "beginners", scenes: { min: 5, max: 30 }, motionHints: { tree: "walk it" } });
    expect(sanitizeSettings("nope")).toEqual({});
  });

  it("changes nothing when nothing is set", () => {
    expect(systemPrompt([], undefined, {})).toBe(systemPrompt([]));
    expect(sceneSystemPrompt(sceneKindOf(undefined), [], false, undefined, {})).toBe(sceneSystemPrompt(sceneKindOf(undefined), []));
    expect(outlinePrompt("dns", { min: 2, max: 4 }, undefined, {}, undefined, {})).toBe(outlinePrompt("dns", { min: 2, max: 4 }));
  });

  it("adds the house style to planning and to scene calls", () => {
    const s = sanitizeSettings({ audience: "backend developers", tone: "dry", language: "Hindi", notes: "Say Acme, never ACME." });
    const ask = outlinePrompt("dns", { min: 2, max: 4 }, undefined, {}, undefined, s);
    expect(ask).toContain("Audience: backend developers");
    expect(ask).toContain("Say Acme, never ACME.");
    const sys = sceneSystemPrompt(sceneKindOf(undefined), [], false, undefined, s);
    expect(sys).toContain("in Hindi");
    expect(sys).toContain("Tone of the narration: dry");
  });

  it("sets the narration rules and ranges", () => {
    const s = sanitizeSettings({ maxWords: 12, sentences: { min: 5, max: 8 }, scenes: { min: 7, max: 7 } });
    const spec = effectiveSpec(s, "short");
    expect(spec.scenes).toEqual({ min: 7, max: 7 });
    const sys = systemPrompt([], spec, s);
    expect(sys).toContain("at most 12 words. 5–8 sentences per scene");
    expect(outlinePrompt("dns", spec.scenes, undefined, {}, spec, s)).toContain("7–7 scenes");
  });

  it("replaces or silences the planning advice", () => {
    const deep = effectiveSpec({}, "deep");
    expect(planningAdvice(deep, {})).toContain("No filler");
    expect(planningAdvice(deep, { planningAdvice: "Be playful." })).toBe("Be playful.");
    expect(planningAdvice(deep, sanitizeSettings({ planningAdvice: " " }))).toBe("");
  });

  it("swaps a template's motion hint and adds a note", () => {
    const kind = sceneKindOf('scene t "T" template=tree');
    const base = sceneSystemPrompt(kind, []);
    expect(base).toContain(STORY_HINTS.tree!);
    const mine = sceneSystemPrompt(kind, [], false, undefined, sanitizeSettings({ motionHints: { tree: "- My tree hint." }, templateNotes: { tree: "Max 5 nodes." } }));
    expect(mine).toContain("- My tree hint.");
    expect(mine).not.toContain(STORY_HINTS.tree!);
    expect(mine).toContain("For this template: Max 5 nodes.");
    expect(sceneSystemPrompt(kind, [], false, undefined, sanitizeSettings({ motionHints: { tree: " " } }))).not.toContain(STORY_HINTS.tree!);
  });
});

import { AssetLibrary } from "@anim/registry";
import { canvasChoicePrompt, canvasOutlinePrompt, chooseSystemPrompt, defaultPrompts, fullPrompt, PROMPT_IDS, repairPrompt, scenePrompt, SLOT_INFO, storyArc } from "../src/index.js";

describe("whole prompts", () => {
  const assets = new AssetLibrary().all();
  const d = defaultPrompts(assets);
  const own = (id: (typeof PROMPT_IDS)[number]) => sanitizeSettings({ prompts: { [id]: d[id].text } });

  it("offers no single-pass prompts, and ignores them if sent", () => {
    expect(Object.keys(d)).not.toContain("single.system");
    expect(sanitizeSettings({ prompts: { "single.system": "x", "single.user": "y" } })).toEqual({});
  });

  it("shows every default with its slots", () => {
    for (const id of PROMPT_IDS) expect(d[id].text.length).toBeGreaterThan(20);
    expect(d["scene.system"].slots).toEqual(expect.arrayContaining(["verbs", "pictures", "template_rules", "elements", "max_words"]));
    expect(d["scene.system"].text).toContain("{{verbs}}");
    expect(d["scene.system"].text).not.toContain("  hide ");
    // Every slot has a description for the Studio.
    for (const id of PROMPT_IDS) for (const n of d[id].slots) expect(SLOT_INFO[n], `${id}: {{${n}}}`).toBeDefined();
  });

  it("an unedited default text builds exactly the built-in prompt", () => {
    const arc = storyArc("dns");
    const kind = sceneKindOf('scene s "S" template=tree');
    expect(sceneSystemPrompt(kind, assets, false, undefined, own("scene.system"))).toBe(sceneSystemPrompt(kind, assets));
    expect(sceneSystemPrompt(sceneKindOf('scene s "S" grid=L2-01'), assets, false, undefined, own("scene.system"))).toBe(sceneSystemPrompt(sceneKindOf('scene s "S" grid=L2-01'), assets));
    expect(outlinePrompt("dns", { min: 3, max: 5 }, arc, { templates: ["tree"] }, undefined, own("outline.user"))).toBe(outlinePrompt("dns", { min: 3, max: 5 }, arc, { templates: ["tree"] }));
    expect(canvasOutlinePrompt("dns", { min: 4, max: 6 }, {}, own("canvas.outline"))).toBe(canvasOutlinePrompt("dns", { min: 4, max: 6 }));
    expect(scenePrompt("scene s \"S\" template=tree", "s", "said", false, own("scene.user"))).toBe(scenePrompt("scene s \"S\" template=tree", "s", "said"));
    expect(canvasChoicePrompt("dns", own("choose.user"))).toBe(canvasChoicePrompt("dns"));
    expect(repairPrompt("a", "b", "errors", own("repair"))).toBe(repairPrompt("a", "b"));
    expect(repairPrompt("a", "b", "quality", own("improve"))).toBe(repairPrompt("a", "b", "quality"));
    expect(chooseSystemPrompt(own("choose.system"))).toBe(chooseSystemPrompt());
  });

  it("uses the person's text and fills in its slots", () => {
    const mine = sanitizeSettings({ prompts: { "outline.user": "Plan {{scenes}} scenes about {{topic}}. Be brief.", "scene.system": "Scene writer. Verbs:\n{{verbs}}" } });
    expect(outlinePrompt("dns", { min: 3, max: 5 }, undefined, {}, undefined, mine)).toBe("Plan 3–5 scenes about dns. Be brief.");
    const sys = sceneSystemPrompt(sceneKindOf('scene s "S" template=tree'), assets, false, undefined, mine);
    expect(sys.startsWith("Scene writer. Verbs:\n")).toBe(true);
    expect(sys).toContain("pop");
    expect(sys).not.toContain("RULES");
  });

  it("keeps an unknown slot as written, and clearing a prompt is the default", () => {
    const typo = sanitizeSettings({ prompts: { "choose.user": "About {{topik}}: {{topic}}" } });
    expect(canvasChoicePrompt("dns", typo)).toBe("About {{topik}}: dns");
    expect(sanitizeSettings({ prompts: { "choose.user": "   ", nope: "x" } })).toEqual({});
  });

  it("house style is a slot, so a prompt can leave it out", () => {
    const style = { audience: "kids" };
    expect(outlinePrompt("dns", { min: 2, max: 4 }, undefined, {}, undefined, sanitizeSettings(style))).toContain("Audience: kids");
    const without = sanitizeSettings({ ...style, prompts: { "outline.user": "Plan {{scenes}} scenes about {{topic}}." } });
    expect(outlinePrompt("dns", { min: 2, max: 4 }, undefined, {}, undefined, without)).not.toContain("kids");
  });
});

describe("recent looks", () => {
  it("the plan request names the looks and motions to vary", () => {
    const ask = outlinePrompt("dns", { min: 2, max: 4 }, undefined, { looks: ["chalk", "dark"], motions: ["minimal"] });
    expect(ask).toContain("looks chalk, dark");
    expect(ask).toContain("motions minimal");
    expect(outlinePrompt("dns", { min: 2, max: 4 })).not.toContain("recent videos used");
  });
});

describe("motion hints", () => {
  it("every template and the grid pages have one", () => {
    for (const t of TEMPLATES) expect(STORY_HINTS[t.name], t.name).toMatch(/^- /);
    expect(STORY_HINTS.grid).toMatch(/^- /);
  });

  it("a grid page scene gets the grid hint, and it can be replaced", () => {
    const kind = sceneKindOf('scene s "S" grid=L2-01');
    expect(sceneSystemPrompt(kind, [])).toContain(STORY_HINTS.grid!);
    const mine = sceneSystemPrompt(kind, [], false, undefined, sanitizeSettings({ motionHints: { grid: "- Numbers only." } }));
    expect(mine).toContain("- Numbers only.");
    expect(mine).not.toContain(STORY_HINTS.grid!);
  });
});
