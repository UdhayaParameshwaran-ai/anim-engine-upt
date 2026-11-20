import { AssetLibrary } from "@anim/registry";
import { describe, expect, it } from "vitest";
import { applyDecision, arcBrief, decidePrompt, findMethod, qualityIssues, METHODS, methodCatalogue, outlinePrompt, outlineSystemPrompt, parseDecision, sanitizeSettings, sceneKindOf, sceneSystemPrompt, skeleton, teachingOf, USE_CASES } from "../src/index.js";

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

describe("decide, then fill", () => {
  const range = { min: 4, max: 6 };
  it("spreads a method's beats over the scenes: one each when the range allows, extra scenes to the middle beats", () => {
    expect(skeleton(findMethod("causal")!, range)).toEqual(["condition", "trigger", "mechanism", "consequence"]);
    expect(skeleton(findMethod("socratic")!, range)).toEqual(["question", "prediction", "evidence", "follow-up", "conclusion"]);
    const long = skeleton(findMethod("causal")!, { min: 7, max: 9 });
    expect(long).toHaveLength(7);
    expect(long[0]).toBe("condition");
    expect(long.at(-1)).toBe("consequence");
    expect(long.filter((b) => b === "consequence")).toHaveLength(1);
    expect(skeleton(findMethod("socratic")!, { min: 3, max: 3 })).toEqual(["question", "prediction", "conclusion"]);
  });

  it("reads the decision, falling back to the use case's usual method for the level", () => {
    const d = parseDecision("# usecase: protocol\n# method: socratic · why: most think the server refuses", "familiar", range, USE_CASES);
    expect(d).toMatchObject({ usecase: "protocol", why: "most think the server refuses", slots: ["question", "prediction", "evidence", "follow-up", "conclusion"] });
    expect(d!.method.name).toBe("socratic");
    expect(parseDecision("# usecase: concept", "practitioner", range, USE_CASES)!.method.name).toBe("problem-based");
    expect(parseDecision("# usecase: concept", "new", range, USE_CASES)!.method.name).toBe("analogical");
    // A method that does not suit the level, or a reply that names nothing, gets the usual method.
    expect(parseDecision("# usecase: concept\n# method: analogical", "practitioner", range, USE_CASES)!.method.name).toBe("problem-based");
    expect(parseDecision("no idea", "familiar", range, USE_CASES, "algorithm")).toMatchObject({ usecase: "algorithm", why: "the usual method for this kind of video and audience" });
    expect(parseDecision("no idea", "familiar", range, USE_CASES)).toBeUndefined();
  });

  it("holds a written plan to the decision: lines, beats by position, no recap ending", () => {
    const d = parseDecision("# usecase: protocol\n# method: socratic · why: the wrong idea", "familiar", range, USE_CASES)!;
    const written = PLAN.replace("# usecase: protocol", "# usecase: concept")
      .replace("# beat: evidence · link: but", "# beat: mapping · link: but")
      .replace(/# beat: conclusion · link: so the rule settles a new case/, "# beat: limits · device: recap, contrast · link: so the rule settles a new case")
      .replace("# beat: question · device: prediction\n", "");
    const held = applyDecision(written, d);
    expect(held).toContain("# usecase: protocol\n# method: socratic · why: the wrong idea");
    expect(held).not.toContain("# usecase: concept");
    const t = teachingOf(held, "familiar", "causal", range);
    expect(t.scenes.map((s) => s.beat)).toEqual(["question", "prediction", "evidence", "follow-up", "conclusion"]);
    expect(t.scenes[4]!.devices).toEqual(["contrast"]);
    expect(t.scenes[2]).toMatchObject({ via: "causal", link: "so follow one request" });
    expect(t.problems).toEqual([]);
  });

  it("keeps a question out of an opening whose method opens otherwise", () => {
    const causal = parseDecision("# usecase: protocol\n# method: causal", "familiar", range, USE_CASES)!;
    const held = applyDecision(PLAN.replace("# beat: question · device: prediction", "# beat: question · device: question, analogy · link: none"), causal);
    const t = teachingOf(held, "familiar", "causal", range);
    expect(t.scenes[0]).toMatchObject({ beat: "condition", devices: ["analogy"] });
    expect(t.problems).toEqual([]);
    // Socratic opens with a question, so its prediction stays.
    const socratic = parseDecision("# usecase: protocol\n# method: socratic", "familiar", range, USE_CASES)!;
    expect(teachingOf(applyDecision(PLAN, socratic)).scenes[0]!.devices).toEqual(["prediction"]);
  });

  it("the decision call is small and knows the level's usual methods", () => {
    const ask = decidePrompt("How a Bloom filter works", { level: "practitioner" });
    expect(ask).toContain("AUDIENCE LEVEL: practitioner");
    expect(ask).toMatch(/concept[^\n]*\n\s+→ method: problem-based/);
    expect(ask).not.toContain("problem-based (or problem-based");
    expect(ask).not.toMatch(/^\s+analogical\s/m);
    expect(ask).not.toContain("pictures:");
    expect(ask.length).toBeLessThan(6000);
    const plan = outlinePrompt("How a Bloom filter works", range, {}, undefined, {}, parseDecision("# usecase: concept", "familiar", range, USE_CASES)!);
    expect(plan).toContain("THE TEACHING PLAN IS DECIDED: use case concept, method feynman");
    expect(plan).toContain("exactly 4 scenes");
    expect(plan).toContain("  1. familiar (the video opens with a familiar starting point");
    expect(plan).not.toContain("Likely use case");
  });
});

describe("scene writers follow the arc", () => {
  const plan = teachingOf(PLAN);
  it("tells each scene its beat's job, how it joins the scene before, and what to leave for the next", () => {
    const intro = arcBrief(plan, "intro");
    expect(intro).toContain("the video teaches by socratic: question → prediction → evidence → follow-up → conclusion");
    expect(intro).toContain("This scene's beat is question: Put one concrete question to the viewer and leave it open");
    expect(intro).toContain("It opens the video: start with a question to the viewer");
    expect(intro).not.toContain("Do not open with a question");
    expect(intro).toContain("prediction: ask the viewer what will happen, in a sentence of its own, then write `wait 1.5`");
    expect(intro).toContain("Leave the next scene its part (evidence");
    const exchange = arcBrief(plan, "exchange");
    expect(exchange).toContain("picks up where the scene before left off: so follow one request");
    expect(exchange).toContain("It borrows causal for that");
    const ending = arcBrief(plan, "ending");
    expect(ending).toContain("It is the last scene: end with the conclusion the questions led to. No recap");
    expect(arcBrief(plan, "nope")).toBe("");
    // A method that opens otherwise says so.
    expect(arcBrief(teachingOf(PLAN.replace("# method: socratic", "# method: causal")), "intro")).toContain("Do not open with a question to the viewer.");
  });
});

describe("narration checks against the arc (Q11–Q14)", () => {
  const H = 'video 1 "x"';
  const scene = (said: string[], extra = "") => `scene s "S" template=steps\na = icon:sun "Sun"\n${said.map((l, i) => `> ${i === 0 ? "{1}" : ""}${l}`).join("\n")}\n1 pop a${extra}`;
  const arc = { first: false, last: false, method: "causal", opens: "the starting situation", opensWithQuestion: false, devices: [] as string[] };
  const codes = (text: string, a: Parameters<typeof qualityIssues>[4]) => qualityIssues(H, text, undefined, undefined, a).map((q) => q.code);
  it("Q11: a question in the opening, when the method opens otherwise", () => {
    expect(codes(scene(["Your page asks another site for data.", "Does it get the reply?"]), { ...arc, first: true })).toContain("Q11");
    expect(codes(scene(["Your page asks another site for data.", "Does it get the reply?"]), { ...arc, first: true, method: "socratic", opensWithQuestion: true })).not.toContain("Q11");
  });
  it("Q12: a scene that restarts cold", () => {
    const previous = scene(["The browser sends the request with an Origin header.", "The server answers with the balance."]);
    expect(codes(scene(["An origin is a scheme, a host and a port."]), { ...arc, previous })).toContain("Q12");
    expect(codes(scene(["So the browser checks the answer before the page sees it."]), { ...arc, previous })).not.toContain("Q12");
    expect(codes(scene(["The server answers, yet the balance never reaches the page."]), { ...arc, previous })).not.toContain("Q12");
    expect(codes(scene(["An origin decides who may read it."]), { ...arc, previous, link: "the origin decides who may read the reply" })).not.toContain("Q12");
  });
  it("Q13: a planned prediction needs a question and a pause", () => {
    const a = { ...arc, devices: ["prediction"] };
    expect(codes(scene(["So the server answers.", "Will the page see it?"]), a)).toContain("Q13");
    expect(codes(scene(["So the server answers.", "Will the page see it?"]).replace("\n1 pop a", "\nwait 1.5\n1 pop a"), a)).not.toContain("Q13");
  });
  it("Q14: an ending that repeats earlier lines", () => {
    const earlier = scene(["So the browser checks the origin of every reply.", "The browser hides the reply from the page."]);
    expect(codes(scene(["So the browser checks the origin of every reply.", "The browser hides the reply from the page."]), { ...arc, last: true, earlier })).toContain("Q14");
    expect(codes(scene(["So a page on another port gets nothing until the server names it."]), { ...arc, last: true, earlier })).not.toContain("Q14");
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
    // The level changes the usual method of a use case: concepts are taught to practitioners from a problem.
    expect(sys).toMatch(/concept[^\n]*\n[^\n]*\n\s+→ method: problem-based/);
    expect(outlineSystemPrompt(assets, "tech", {})).toMatch(/concept[^\n]*\n[^\n]*\n\s+→ method: feynman/);
  });

  it("reaches every scene writer as vocabulary, sentence and depth rules", () => {
    const kind = sceneKindOf('scene s "S" template=exchange');
    expect(sceneSystemPrompt(kind, assets)).toContain("AUDIENCE LEVEL: familiar");
    expect(sceneSystemPrompt(kind, assets, false, undefined, { level: "new" })).toMatch(/AUDIENCE LEVEL: new[\s\S]*Vocabulary: accessible/);
  });
});
