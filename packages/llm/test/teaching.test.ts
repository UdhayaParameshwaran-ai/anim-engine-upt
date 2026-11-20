import { AssetLibrary } from "@anim/registry";
import { describe, expect, it } from "vitest";
import { findMethod, LEVELS, METHODS, methodCatalogue, outlinePrompt, outlineSystemPrompt, sanitizeSettings, sceneKindOf, sceneSystemPrompt, teachingOf, USE_CASES } from "../src/index.js";

const PLAN = `video 1 "CORS"
# usecase: protocol
# question: why does the browser hide a reply the server sent?
# example: shop.example.com fetches api.bank.com
# outcome: the viewer can say who blocks the read
# method: socratic · why: most people think the server refuses the request
scene intro "Does the page see it?" template=title
# shape: intro · role: problem · goal: the page, the server, the 200 reply
# beat: question · device: prediction
scene origin "Same origin or not" template=anatomy
# shape: format · role: idea · goal: scheme, host, port
# beat: evidence · link: but the browser compares origins first
scene exchange "One blocked read" template=exchange
# shape: interaction · role: example · goal: the request, the reply, the block
# beat: evidence · via: causal · link: so follow one request
scene fixes "Which side changes" template=compare
# shape: compare · role: misconception · goal: frontend vs server fix
# beat: follow-up · device: misconception · link: but the error shows in the frontend
scene ending "A different port" template=exchange
# shape: interaction · role: takeaway · goal: port 8443
# beat: conclusion · link: so the rule settles a new case`;

describe("teaching methods", () => {
  it("every use case defaults to a known method, and every switch names one", () => {
    for (const u of USE_CASES) {
      expect(findMethod(u.method), u.name).toBeDefined();
      for (const word of (u.switch ?? "").split(/[\s;,]+/)) if (/^[a-z]+-[a-z-]+$|^(feynman|socratic|contrastive|causal|discovery|analogical)$/.test(word)) expect(findMethod(word), `${u.name}: ${word}`).toBeDefined();
    }
  });

  it("use cases plan the pictures, not the order of the telling", () => {
    for (const u of USE_CASES) expect(u.plan, u.name).not.toMatch(/\brecap\b|\bthen a verdict\b|headline number first/i);
  });

  it("the eight methods of the research, each with beats", () => {
    expect(METHODS.map((m) => m.name)).toEqual(["feynman", "socratic", "worked-example", "contrastive", "causal", "problem-based", "discovery", "analogical"]);
    for (const m of METHODS) expect(m.beats.length, m.name).toBeGreaterThanOrEqual(4);
  });

  it("offers practitioners no everyday comparisons or discovery games", () => {
    expect(methodCatalogue("practitioner")).not.toMatch(/^\s+analogical|^\s+discovery/m);
    expect(methodCatalogue("new")).toMatch(/^\s+analogical/m);
  });
});

describe("teaching plan checks", () => {
  it("accepts a plan that follows its method", () => {
    const t = teachingOf(PLAN, "familiar", "causal");
    expect(t.problems).toEqual([]);
    expect(t.method?.name).toBe("socratic");
    expect(t.scenes.map((s) => s.beat)).toEqual(["question", "evidence", "evidence", "follow-up", "conclusion"]);
    expect(t.scenes[2]).toMatchObject({ via: "causal", link: "so follow one request" });
    expect(t.scenes[0]!.devices).toEqual(["prediction"]);
  });

  it("names a missing or unknown method", () => {
    expect(teachingOf(PLAN.replace(/^# method:.*$/m, "")).problems).toContain("no # method: line");
    expect(teachingOf(PLAN.replace("# method: socratic", "# method: storytelling")).problems[0]).toMatch(/unknown method `storytelling`/);
  });

  it("asks why when the plan leaves the use case's default", () => {
    expect(teachingOf(PLAN.replace(" · why: most people think the server refuses the request", ""), "familiar", "causal").problems.join()).toMatch(/replaces the use case's default `causal` without a why/);
  });

  it("catches beats that are unknown, out of order, or do not open and close the method", () => {
    expect(teachingOf(PLAN.replace("# beat: evidence · link: but", "# beat: steps · link: but")).problems.join()).toMatch(/beat `steps` is not a beat of socratic/);
    expect(teachingOf(PLAN.replace("# beat: follow-up", "# beat: question")).problems.join()).toMatch(/out of order/);
    expect(teachingOf(PLAN.replace("# beat: conclusion", "# beat: follow-up")).problems.join()).toMatch(/socratic ends with `conclusion`/);
  });

  it("a question opening belongs to methods that open with one", () => {
    const causal = PLAN.replace("# method: socratic", "# method: causal")
      .replace("# beat: question", "# beat: condition")
      .replace("# beat: evidence · link: but", "# beat: trigger · link: but")
      .replace("# beat: evidence · via: causal", "# beat: mechanism")
      .replace("# beat: follow-up", "# beat: mechanism")
      .replace("# beat: conclusion", "# beat: consequence");
    expect(teachingOf(causal).problems).toEqual(["the first scene opens with a prediction, but causal opens with the starting situation"]);
    expect(teachingOf(causal.replace("device: prediction", "device: question")).problems).toEqual(["the first scene opens with a question, but causal opens with the starting situation"]);
    expect(teachingOf(causal.replace(" · device: prediction", "")).problems).toEqual([]);
  });

  it("reads none as nothing, and names the method a stray beat belongs to", () => {
    const t = teachingOf(PLAN.replace("# beat: evidence · link: but", "# beat: evidence · via: none · device: none · link: but"));
    expect(t.problems).toEqual([]);
    expect(t.scenes[1]!.devices).toEqual([]);
    expect(t.scenes[1]!.via).toBeUndefined();
    // Borrowing the main method borrows nothing; words after a device name are a note about it.
    const noted = teachingOf(PLAN.replace("# beat: evidence · link: but", "# beat: evidence · via: socratic · device: prediction, which origin wins? · link: but"));
    expect(noted.problems).toEqual([]);
    expect(noted.scenes[1]).toMatchObject({ devices: ["prediction"] });
    expect(noted.scenes[1]!.via).toBeUndefined();
    expect(teachingOf(PLAN.replace("device: prediction", "device: suspense, and more")).problems.join()).toMatch(/unknown device suspense/);
    expect(teachingOf(PLAN.replace("# beat: follow-up", "# beat: mapping")).problems.join()).toMatch(/beat `mapping` is not a beat of socratic .*it is analogical's: keep a socratic beat and write · via: analogical/);
  });

  it("checks the scene count against the planned range", () => {
    expect(teachingOf(PLAN, "familiar", undefined, { min: 4, max: 6 }).problems).toEqual([]);
    expect(teachingOf(PLAN, "familiar", undefined, { min: 6, max: 8 }).problems).toContain("5 scenes; the plan asked for 6–8");
  });

  it("checks the method against the audience level, the devices, the links and the ending", () => {
    const analog = teachingOf(PLAN.replace("# method: socratic", "# method: analogical"), "practitioner");
    expect(analog.problems.join()).toMatch(/does not suit the practitioner audience/);
    expect(teachingOf(PLAN.replace("device: prediction", "device: suspense")).problems.join()).toMatch(/unknown device suspense/);
    expect(teachingOf(PLAN.replace(" · link: so the rule settles a new case", "")).problems).toContain("scene ending: no link: saying how it follows from the scene before");
    expect(teachingOf(PLAN.replace("# beat: conclusion · link", "# beat: conclusion · device: recap · link")).problems).toContain("the last scene is a recap; end the way the method ends");
  });
});

describe("audience level", () => {
  const assets = new AssetLibrary().all();
  it("is an input with a default, never a planner decision", () => {
    expect(sanitizeSettings({ level: "practitioner" })).toEqual({ level: "practitioner" });
    expect(sanitizeSettings({ level: "expert" })).toEqual({});
    expect(outlinePrompt("dns", { min: 3, max: 4 })).toContain("Audience level: familiar.");
    expect(outlinePrompt("dns", { min: 3, max: 4 }, {}, undefined, { level: "new" })).toContain("Audience level: new.");
    const sys = outlineSystemPrompt(assets, "tech", { level: "practitioner" });
    expect(sys).toContain("AUDIENCE LEVEL: practitioner");
    expect(sys).toContain("never write it in the plan");
    expect(sys).not.toMatch(/^\s+analogical\s/m);
    expect(sys).toContain("Methods this audience often needs: problem-based, worked-example, contrastive.");
    expect(outlineSystemPrompt(assets, "tech", {})).not.toContain("Methods this audience often needs");
  });

  it("reaches every scene writer as vocabulary, sentence and depth rules", () => {
    const kind = sceneKindOf('scene s "S" template=exchange');
    expect(sceneSystemPrompt(kind, assets)).toContain("AUDIENCE LEVEL: familiar");
    expect(sceneSystemPrompt(kind, assets, false, undefined, { level: "new" })).toMatch(/AUDIENCE LEVEL: new[\s\S]*Vocabulary: accessible/);
  });
});
