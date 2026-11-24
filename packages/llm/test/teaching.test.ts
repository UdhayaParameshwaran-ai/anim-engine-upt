import { AssetLibrary } from "@anim/registry";
import { describe, expect, it } from "vitest";
import { applyDecision, arcBrief, arcFor, decidePrompt, findMethod, fitSlots, INTENTS, METHODS, methodCatalogue, methodFor, outlinePrompt, outlineSystemPrompt, parseDecision, parseSlot, qualityIssues, sanitizeSettings, sceneKindOf, sceneSystemPrompt, slotLabel, teachingOf, USE_CASES } from "../src/index.js";

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
# beat: prediction · link: but the browser compares origins first
scene exchange "One blocked read" template=exchange
# shape: interaction · role: example · goal: the request, the reply, the block
# beat: evidence · via: causal · link: so follow one request
scene fixes "Which side changes" template=compare
# shape: compare · role: misconception · goal: frontend vs server fix
# beat: follow-up · device: misconception · link: but the error shows in the frontend
scene ending "A different port" template=exchange
# shape: interaction · role: takeaway · goal: port 8443
# beat: conclusion · link: so the rule settles a new case`;

const LENGTHS = { short: { min: 2, max: 2 }, standard: { min: 2, max: 4 }, long: { min: 6, max: 9 }, deep: { min: 10, max: 14 } } as const;

describe("teaching methods", () => {
  it("use cases plan the pictures, not the order of the telling or the method", () => {
    for (const u of USE_CASES) {
      expect(u.plan, u.name).not.toMatch(/\brecap\b|\bthen a verdict\b|headline number first/i);
      expect(u, u.name).not.toHaveProperty("method");
    }
  });

  it("the eight methods of the research, each with beats, jobs, pictures and arcs made of its own beats", () => {
    expect(METHODS.map((m) => m.name)).toEqual(["feynman", "socratic", "worked-example", "contrastive", "causal", "problem-based", "discovery", "analogical"]);
    for (const m of METHODS) {
      expect(m.beats.length, m.name).toBeGreaterThanOrEqual(4);
      for (const b of m.beats) {
        expect(m.jobs[b], `${m.name}: ${b}`).toBeTruthy();
        expect(m.pictures[b], `${m.name}: ${b}`).toBeTruthy();
      }
      for (const b of [...m.core, ...m.cycle]) expect(m.beats, `${m.name}: ${b}`).toContain(b);
      for (const slot of [...m.arcs.short, ...m.arcs.standard, ...m.arcs.long]) for (const b of parseSlot(slot).beats) expect(m.beats, `${m.name}: ${slot}`).toContain(b);
    }
  });

  it("offers practitioners no everyday comparisons; discovery suits every level", () => {
    expect(methodCatalogue("practitioner")).not.toMatch(/^\s+analogical/m);
    expect(methodCatalogue("practitioner")).toMatch(/^\s+discovery/m);
    expect(methodCatalogue("new")).toMatch(/^\s+analogical/m);
  });
});

describe("arcs per length", () => {
  it("every method keeps its core beats, opens and ends its own way, and fits every length's scene count", () => {
    for (const m of METHODS) {
      for (const [length, range] of Object.entries(LENGTHS)) {
        const arc = arcFor(m, length, range);
        const at = `${m.name} ${length}`;
        expect(arc.length, at).toBeGreaterThanOrEqual(range.min);
        expect(arc.length, at).toBeLessThanOrEqual(range.max);
        const used = new Set(arc.flatMap((s) => parseSlot(s).beats));
        for (const b of m.core) expect(used.has(b), `${at} keeps ${b}`).toBe(true);
        expect(parseSlot(arc[0]!).beats, at).toContain(m.beats[0]);
        expect(parseSlot(arc.at(-1)!).beats, at).toContain(m.beats.at(-1));
        for (const s of arc) expect(parseSlot(s).beats.length, `${at}: ${s}`).toBeLessThanOrEqual(3);
        // First rounds keep the method's order; later rounds only repeat the cycle.
        const order = arc.filter((s) => parseSlot(s).round === 1).flatMap((s) => parseSlot(s).beats.map((b) => m.beats.indexOf(b)));
        expect(order, at).toEqual([...order].sort((a, b) => a - b));
        for (const s of arc.filter((x) => parseSlot(x).round > 1)) for (const b of parseSlot(s).beats) expect(m.cycle, `${at}: ${s}`).toContain(b);
      }
    }
  });

  it("merges beats for a short video instead of dropping them, and grows the cycle for a long one", () => {
    const socratic = findMethod("socratic")!;
    expect(arcFor(socratic, "short").map(slotLabel)).toEqual(["question + prediction", "evidence + conclusion"]);
    expect(arcFor(socratic, "standard")).toContain("evidence");
    expect(arcFor(findMethod("causal")!, "long").filter((s) => parseSlot(s).beats.includes("mechanism"))).toHaveLength(3);
    // A range set by hand takes the written arc that fits it.
    expect(arcFor(socratic, "standard", { min: 4, max: 6 })).toEqual([...socratic.arcs.standard]);
    expect(arcFor(socratic, "standard", { min: 6, max: 8 })).toEqual([...socratic.arcs.long]);
    expect(arcFor(socratic, "standard", { min: 3, max: 3 })).toHaveLength(4);
  });

  it("reads and writes slots: merged beats and later rounds", () => {
    expect(parseSlot("question+prediction")).toEqual({ beats: ["question", "prediction"], round: 1 });
    expect(parseSlot("evidence:2")).toEqual({ beats: ["evidence"], round: 2 });
    expect(parseSlot("evidence (round 2)")).toEqual({ beats: ["evidence"], round: 2 });
    expect(slotLabel("reasoning+result+apply")).toBe("reasoning + result + apply");
    expect(slotLabel("steps:2")).toBe("steps (round 2)");
  });
});

describe("the method follows from what the learner asks", () => {
  it("maps every intent to a method, by use case and level", () => {
    for (const i of Object.keys(INTENTS) as (keyof typeof INTENTS)[]) expect(findMethod(INTENTS[i].method), i).toBeDefined();
    expect(methodFor("how", "algorithm").name).toBe("worked-example");
    expect(methodFor("how", "protocol").name).toBe("causal");
    expect(methodFor("how", "comparison").name).toBe("contrastive");
    expect(methodFor("predict", "system", "practitioner").name).toBe("discovery");
    expect(methodFor("fix", "system").name).toBe("problem-based");
    expect(methodFor("believe", "concept").name).toBe("socratic");
    expect(methodFor("what", "concept", "new").name).toBe("analogical");
    expect(methodFor("what", "concept", "practitioner").name).toBe("feynman");
    expect(methodFor("how", "concept", "new").name).toBe("analogical");
    expect(methodFor("how", "protocol", "new").name).toBe("causal");
    expect(methodFor(undefined, "algorithm").name).toBe("worked-example");
  });

  it("reads the decision: use case, intent, misconception; the method and arc follow", () => {
    const d = parseDecision("# usecase: protocol\n# intent: believe · why: most think the server refuses\n# misconception: the server blocks the request\n# length: none", "familiar", "standard", LENGTHS.standard, USE_CASES)!;
    expect(d).toMatchObject({ usecase: "protocol", intent: "believe", why: "most think the server refuses", misconception: "the server blocks the request", slots: ["question", "prediction", "evidence", "follow-up+conclusion"] });
    expect(d.method.name).toBe("socratic");
    expect(parseDecision("# usecase: algorithm\n# intent: how\n# misconception: none", "familiar", "short", LENGTHS.short, USE_CASES)).toMatchObject({ intent: "how", slots: ["problem+steps", "reasoning+result+apply"] });
    expect(parseDecision("# usecase: algorithm\n# misconception: none", "familiar", "standard", undefined, USE_CASES)!.misconception).toBeUndefined();
    // An unknown intent reads as "how"; an unknown use case falls back, or there is no decision.
    expect(parseDecision("# usecase: concept\n# intent: wonder", "familiar", "standard", undefined, USE_CASES)!.intent).toBe("how");
    expect(parseDecision("no idea", "familiar", "standard", undefined, USE_CASES, "algorithm")).toMatchObject({ usecase: "algorithm", intent: "how" });
    expect(parseDecision("no idea", "familiar", "standard", undefined, USE_CASES)).toBeUndefined();
  });

  it("the decision call is small: use cases without pictures, intents instead of methods", () => {
    const ask = decidePrompt("How a Bloom filter works", { level: "practitioner" });
    expect(ask).toContain("AUDIENCE LEVEL: practitioner");
    expect(ask).toContain("WHAT THE LEARNER ASKS");
    expect(ask).toMatch(/^\s+predict\s/m);
    expect(ask).toContain("# intent: <intent>");
    expect(ask).toContain("# misconception:");
    expect(ask).not.toContain("pictures:");
    expect(ask).not.toContain("→ method:");
    expect(ask.length).toBeLessThan(6000);
  });
});

describe("teaching plan checks", () => {
  it("accepts a plan that follows its method", () => {
    const t = teachingOf(PLAN, "familiar");
    expect(t.problems).toEqual([]);
    expect(t.method?.name).toBe("socratic");
    expect(t.scenes.map((s) => s.beat)).toEqual(["question", "prediction", "evidence", "follow-up", "conclusion"]);
    expect(t.scenes[2]).toMatchObject({ via: "causal", link: "so follow one request" });
    expect(t.scenes[0]!.devices).toEqual(["prediction"]);
  });

  it("names a missing or unknown method", () => {
    expect(teachingOf(PLAN.replace(/^# method:.*$/m, "")).problems).toContain("no # method: line");
    expect(teachingOf(PLAN.replace("# method: socratic", "# method: storytelling")).problems[0]).toMatch(/unknown method `storytelling`/);
  });

  it("catches beats that are unknown, out of order, missing from the core, or do not open and close the method", () => {
    expect(teachingOf(PLAN.replace("# beat: prediction · link: but", "# beat: steps · link: but")).problems.join()).toMatch(/beat `steps` is not a beat of socratic/);
    expect(teachingOf(PLAN.replace("# beat: follow-up", "# beat: question")).problems.join()).toMatch(/out of order/);
    expect(teachingOf(PLAN.replace("# beat: conclusion", "# beat: follow-up")).problems.join()).toMatch(/socratic ends with `conclusion`/);
    expect(teachingOf(PLAN.replace("# beat: evidence · via", "# beat: follow-up · via")).problems.join()).toMatch(/socratic is not taught without evidence/);
  });

  it("reads merged slots and later rounds", () => {
    const merged = PLAN.replace("# beat: follow-up · device: misconception · link: but the error shows in the frontend\n", "# beat: evidence (round 2) · link: but the error shows in the frontend\n").replace("# beat: conclusion", "# beat: follow-up + conclusion");
    const t = teachingOf(merged);
    expect(t.scenes[3]).toMatchObject({ beats: ["evidence"], round: 2 });
    expect(t.scenes[4]!.beats).toEqual(["follow-up", "conclusion"]);
    expect(t.problems).toEqual([]);
    expect(teachingOf(merged.replace("evidence (round 2)", "question (round 2)")).problems.join()).toMatch(/repeats only follow-up → evidence/);
  });

  it("a question opening belongs to methods that open with one", () => {
    const causal = PLAN.replace("# method: socratic", "# method: causal")
      .replace("# beat: question", "# beat: condition")
      .replace("# beat: prediction · link: but", "# beat: trigger · link: but")
      .replace("# beat: evidence · via: causal", "# beat: mechanism")
      .replace("# beat: follow-up", "# beat: mechanism")
      .replace("# beat: conclusion", "# beat: consequence");
    expect(teachingOf(causal).problems).toEqual(["the first scene opens with a prediction, but causal opens with the starting situation"]);
    expect(teachingOf(causal.replace("device: prediction", "device: question")).problems).toEqual(["the first scene opens with a question, but causal opens with the starting situation"]);
    expect(teachingOf(causal.replace(" · device: prediction", "")).problems).toEqual([]);
  });

  it("reads none as nothing, and names the method a stray beat belongs to", () => {
    const t = teachingOf(PLAN.replace("# beat: prediction · link: but", "# beat: prediction · via: none · device: none · link: but"));
    expect(t.problems).toEqual([]);
    expect(t.scenes[1]!.devices).toEqual([]);
    expect(t.scenes[1]!.via).toBeUndefined();
    // Borrowing the main method borrows nothing; words after a device name are a note about it.
    const noted = teachingOf(PLAN.replace("# beat: prediction · link: but", "# beat: prediction · via: socratic · device: prediction, which origin wins? · link: but"));
    expect(noted.problems).toEqual([]);
    expect(noted.scenes[1]).toMatchObject({ devices: ["prediction"] });
    expect(noted.scenes[1]!.via).toBeUndefined();
    expect(teachingOf(PLAN.replace("device: prediction", "device: suspense, and more")).problems.join()).toMatch(/unknown device suspense/);
    expect(teachingOf(PLAN.replace("# beat: follow-up", "# beat: mapping")).problems.join()).toMatch(/beat `mapping` is not a beat of socratic .*it is analogical's: keep a socratic beat and write · via: analogical/);
  });

  it("checks the scene count against the planned range", () => {
    expect(teachingOf(PLAN, "familiar", { min: 4, max: 6 }).problems).toEqual([]);
    expect(teachingOf(PLAN, "familiar", { min: 6, max: 8 }).problems).toContain("5 scenes; the plan asked for 6–8");
  });

  it("checks the method against the audience level, the devices, the links and the ending", () => {
    const analog = teachingOf(PLAN.replace("# method: socratic", "# method: analogical"), "practitioner");
    expect(analog.problems.join()).toMatch(/does not suit the practitioner audience/);
    expect(teachingOf(PLAN.replace(" · link: so the rule settles a new case", "")).problems).toContain("scene ending: no link: saying how it follows from the scene before");
    expect(teachingOf(PLAN.replace("# beat: conclusion · link", "# beat: conclusion · device: recap · link")).problems).toContain("the last scene is a recap; end the way the method ends");
  });
});

describe("decide, then fill", () => {
  const decide = (reply: string, length = "standard") => parseDecision(reply, "familiar", length, LENGTHS[length as keyof typeof LENGTHS], USE_CASES)!;

  it("holds a written plan to the decision: lines, slots by position, no recap ending", () => {
    const d = decide("# usecase: protocol\n# intent: believe · why: the wrong idea\n# misconception: the server refuses", "long");
    const written = PLAN.replace("# usecase: protocol", "# usecase: concept")
      .replace("# beat: prediction · link: but", "# beat: mapping · link: but")
      .replace(/# beat: conclusion · link: so the rule settles a new case/, "# beat: limits · device: recap, contrast · link: so the rule settles a new case")
      .replace("# beat: question · device: prediction\n", "")
      .replace('scene ending "A different port"', 'scene again "Once more" template=exchange\n# beat: evidence · link: so again\nscene ending "A different port"');
    const held = applyDecision(written, d);
    expect(held).toContain("# usecase: protocol\n# method: socratic · intent: believe · why: the wrong idea\n# misconception: the server refuses");
    expect(held).not.toContain("# usecase: concept");
    expect(held).toContain("# beat: evidence (round 2)");
    const t = teachingOf(held, "familiar", LENGTHS.long);
    expect(t.scenes.map((s) => slotLabel(`${s.beats.join("+")}${s.round ? `:${s.round}` : ""}`))).toEqual(["question", "prediction", "evidence", "follow-up", "evidence (round 2)", "conclusion"]);
    expect(t.scenes[5]!.devices).toEqual(["contrast"]);
    expect(t).toMatchObject({ intent: "believe", misconception: "the server refuses" });
    expect(t.problems).toEqual([]);
  });

  it("fits the slots to the scenes a plan wrote: splits a merged slot, merges small neighbours, never repeats a beat", () => {
    const worked = findMethod("worked-example")!;
    expect(fitSlots(["problem", "steps", "reasoning+result", "apply"], 5, worked)).toEqual(["problem", "steps", "reasoning", "result", "apply"]);
    expect(fitSlots(["problem", "steps", "reasoning+result", "apply"], 3, worked)).toEqual(["problem+steps", "reasoning+result", "apply"]);
    expect(fitSlots(["problem+steps", "reasoning+result+apply"], 3, worked)).toEqual(["problem+steps", "reasoning", "result+apply"]);
    expect(fitSlots(["condition", "trigger", "mechanism", "consequence"], 5, findMethod("causal")!)).toEqual(["condition", "trigger", "mechanism", "mechanism:2", "consequence"]);
    // A plan of five scenes for a four-slot decision gets five different slots, by position.
    const five = PLAN.replace("# usecase: protocol", "# usecase: algorithm");
    const t = teachingOf(applyDecision(five, decide("# usecase: algorithm\n# intent: how")));
    expect(t.scenes.map((s) => s.beats.join("+"))).toEqual(["problem", "steps", "reasoning", "result", "apply"]);
  });

  it("keeps a question out of an opening whose method opens otherwise", () => {
    const causal = decide("# usecase: protocol\n# intent: how");
    const held = applyDecision(PLAN.replace("# beat: question · device: prediction", "# beat: question · device: question, analogy · link: none"), causal);
    const t = teachingOf(held, "familiar");
    expect(t.scenes[0]).toMatchObject({ beat: "condition", devices: ["analogy"] });
    // Socratic opens with a question, so its prediction stays.
    expect(teachingOf(applyDecision(PLAN, decide("# usecase: protocol\n# intent: believe"))).scenes[0]!.devices).toEqual(["prediction"]);
  });

  it("the plan request lists each slot with its jobs and pictures; a decided plan's system prompt drops the method menu", () => {
    const plan = outlinePrompt("How a Bloom filter works", LENGTHS.short, {}, undefined, {}, decide("# usecase: algorithm\n# intent: how\n# misconception: a yes means the item was added", "short"));
    expect(plan).toContain("THE TEACHING PLAN IS DECIDED: use case algorithm, method worked-example");
    expect(plan).toContain("The wrong idea to bring out: a yes means the item was added");
    expect(plan).toContain("exactly 2 scenes");
    expect(plan).toContain("  1. problem + steps (the video opens with the concrete problem to solve)");
    expect(plan).toMatch(/steps: Solve it on the real values[^\n]*Picture: the same data changing step by step\./);
    expect(plan).not.toContain("Likely use case");
    const assets = new AssetLibrary().all();
    expect(outlineSystemPrompt(assets, "tech", {}, true)).not.toContain("METHODS (one for the whole video");
    expect(outlineSystemPrompt(assets, "tech", {})).toContain("METHODS (one for the whole video");
  });
});

describe("scene writers follow the arc", () => {
  const plan = teachingOf(PLAN);
  it("tells each scene its beats' jobs and pictures, how it carries on from the scene before, and what to leave for the next", () => {
    const intro = arcBrief(plan, "intro");
    expect(intro).toContain("the video teaches by socratic: question → prediction → evidence → follow-up → conclusion");
    expect(intro).toContain("This scene's beat is question: Put one concrete question about the example to the viewer");
    expect(intro).toContain("Picture: the example, stopped just before the outcome.");
    expect(intro).toContain("It opens the video: start with a question to the viewer");
    expect(intro).not.toContain("Do not open with a question");
    expect(intro).toContain("prediction: ask the viewer what will happen, in a sentence of its own, then write `wait 1.5`");
    expect(intro).toContain("Leave the next scene its part (prediction");
    const origin = arcBrief(plan, "origin");
    expect(origin).toContain("The scene before already put its question to the viewer: do not ask it again");
    const exchange = arcBrief(plan, "exchange");
    expect(exchange).toContain("carries on from the scene before (the idea to pick up, not words to say: so follow one request)");
    expect(exchange).toContain("never mention scenes, beats or the plan");
    expect(exchange).toContain("Names and numbers already said in earlier scenes are fixed");
    expect(exchange).toContain("It borrows causal for that");
    const ending = arcBrief(plan, "ending");
    expect(ending).toContain("It is the last scene: end with the conclusion the questions led to. No recap");
    expect(arcBrief(plan, "nope")).toBe("");
    // A method that opens otherwise says so.
    expect(arcBrief(teachingOf(PLAN.replace("# method: socratic", "# method: causal")), "intro")).toContain("Do not open with a question to the viewer.");
  });

  it("gives a merged slot every job in order, a later round what it adds, and the misconception where it is brought out", () => {
    const merged = teachingOf(PLAN.replace("# beat: question · device: prediction", "# beat: question + prediction").replace("# beat: evidence · via: causal", "# beat: evidence (round 2)").replace("# method: socratic · why: most people think the server refuses the request", "# method: socratic · why: x\n# misconception: the server refuses it"));
    const intro = arcBrief(merged, "intro");
    expect(intro).toContain("This scene carries 2 beats, in this order:\n  - question:");
    expect(intro).toContain("  - prediction: Say the guess most people make");
    expect(intro).toContain("The wrong idea to bring out: the server refuses it");
    expect(arcBrief(merged, "exchange")).toContain("This is round 2 of evidence: a new question that challenges an assumption");
  });
});

describe("narration checks against the arc (Q11–Q17)", () => {
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
  it("Q15: the plan's words spoken aloud", () => {
    expect(codes(scene(["The gap showed that shared bits cause false yeses."]), arc)).toContain("Q15");
    expect(codes(scene(["Node B's reply is pending, and the next scene shows what it sends."]), arc)).toContain("Q15");
    expect(codes(scene(["So the gap between the two copies grows with every write."]), arc)).not.toContain("Q15");
  });
  it("Q16: asking the viewer again what the scene before asked", () => {
    const previous = scene(["Client B asks Node 2 for the balance.", "So what should Node 2 answer?"]);
    expect(codes(scene(["So what should Node 2 answer here?", "Here are the usual guesses."]), { ...arc, previous })).toContain("Q16");
    expect(codes(scene(["So which of these guesses would you pick?", "Most people pick the third."]), { ...arc, previous })).not.toContain("Q16");
  });
  it("Q17: a core scene written as a sentence or two", () => {
    expect(codes(scene(["So the root points at A, and we follow its links."]), { ...arc, core: true })).toContain("Q17");
    expect(codes(scene(["So the root points at A.", "A is marked.", "B is marked next."]), { ...arc, core: true })).not.toContain("Q17");
    expect(codes(scene(["So the root points at A."]), arc)).not.toContain("Q17");
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
    // The level changes how much is shown, not the use case's pictures.
    expect(sys).toContain("leave one for the viewer to finish");
    expect(sys).not.toContain("→ method:");
  });

  it("reaches every scene writer as vocabulary, sentence and depth rules", () => {
    const kind = sceneKindOf('scene s "S" template=exchange');
    expect(sceneSystemPrompt(kind, assets)).toContain("AUDIENCE LEVEL: familiar");
    expect(sceneSystemPrompt(kind, assets, false, undefined, { level: "new" })).toMatch(/AUDIENCE LEVEL: new[\s\S]*Vocabulary: accessible/);
  });
});
