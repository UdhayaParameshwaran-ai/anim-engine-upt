import { describe, expect, it } from "vitest";
import { DECIDE_SYSTEM, decidePrompt, detectLength, generate, guessUseCase, lengthSpec, outlinePrompt, readLengthLine, sceneSystemPrompt, sceneKindOf, systemPrompt, type LlmClient } from "../src/index.js";

describe("length presets", () => {
  it("standard is the old default", () => {
    expect(lengthSpec(undefined).scenes).toEqual({ min: 2, max: 4 });
    expect(systemPrompt([])).toContain("2–6 sentences per scene");
  });

  it("reads the length a topic asks for", () => {
    expect(detectLength("a long video about DNS")).toBe("long");
    expect(detectLength("a quick explainer on TCP")).toBe("short");
    expect(detectLength("a 3 minute video on Git")).toBe("long");
    expect(detectLength("a 5 minute video on Git")).toBe("deep");
    expect(detectLength("a 30 second video on Git")).toBe("short");
    expect(detectLength("a 1 minute video on Git")).toBe("standard");
    expect(detectLength("an in-depth look at the event loop")).toBe("deep");
  });

  it("does not mistake topics for requests", () => {
    for (const t of ["long polling", "quick sort", "short polling vs websockets", "the shortest path problem", "how DNS works"]) expect(detectLength(t)).toBeUndefined();
  });

  it("sets the sentences per scene and the outline's advice", () => {
    const deep = lengthSpec("deep");
    expect(systemPrompt([], deep)).toContain("4–7 sentences per scene");
    expect(sceneSystemPrompt(sceneKindOf(undefined), [], false, deep)).toContain("4–7 sentences per scene");
    const ask = outlinePrompt("dns", deep.scenes, {}, deep);
    expect(ask).toContain("10–14 scenes");
    expect(ask).toContain("No filler scenes");
    expect(outlinePrompt("dns", { min: 2, max: 4 })).not.toContain("No filler");
  });

  it("asks the outline for the preset's scenes; an explicit range wins", async () => {
    const asked: string[] = [];
    const reply = { text: 'video 1 "x"', provider: "spy", model: "m" };
    const client: LlmClient = {
      name: "spy",
      chat: async (req) => (asked.push(req.messages.map((m) => m.content).join(" | ")), reply),
      stream: async () => reply,
    };
    const plan = () => asked.find((a) => a.includes("Plan a narrated"))!;
    // With the teaching decision first, the plan gets the method's scenes, as many as the range allows.
    await generate("how DNS works", { client, length: "long", qualityRepairs: false }).catch(() => undefined);
    expect(plan()).toContain("exactly 6 scenes");
    asked.length = 0;
    await generate("how DNS works", { client, length: "long", scenes: { min: 3, max: 3 }, qualityRepairs: false }).catch(() => undefined);
    // No written arc has 3 scenes: the nearest one wins, the longer on a tie (more of the method is taught).
    expect(plan()).toContain("exactly 4 scenes");
    asked.length = 0;
    await generate("how DNS works", { client, length: "long", qualityRepairs: false, decideTeaching: false }).catch(() => undefined);
    expect(asked[0]).toContain("6–9 scenes");
  });
});

describe("length read from the request", () => {
  it("reads the decision's length line; none means the request asks for none", () => {
    expect(readLengthLine("# usecase: concept\n# method: feynman\n# length: long")).toEqual({ said: true, length: "long" });
    expect(readLengthLine("# length: none")).toEqual({ said: true });
    expect(readLengthLine("# usecase: concept")).toEqual({ said: false });
  });

  it("asks the decision call for the length, with the words that point to each and the topic names that do not", () => {
    const ask = decidePrompt("Long polling vs WebSockets");
    expect(ask).toContain("# length: <none | short | standard | long | deep>");
    expect(ask).toMatch(/long\s+about three minutes: several parts, each explained: "in detail"/);
    expect(ask).toContain("long polling, quick sort, short-circuit evaluation");
    expect(ask).toContain("How long the video should be never changes the use case or the intent.");
  });

  it("'explain' no longer makes every topic a concept", () => {
    expect(guessUseCase("Processes vs threads. Explain it in detail, I need a long narration.")?.name).toBe("comparison");
    expect(guessUseCase("Explain how a CI/CD pipeline ships code")?.name).toBe("system");
    expect(guessUseCase("What is a JWT?")?.name).toBe("concept");
  });

  const plans = (decision: string) => {
    const asked: string[] = [];
    const reply = { text: 'video 1 "x"', provider: "spy", model: "m" };
    const client: LlmClient = {
      name: "spy",
      chat: async (req) => {
        const system = req.messages[0]!.content;
        asked.push(req.messages.map((m) => m.content).join(" | "));
        return system === DECIDE_SYSTEM ? { ...reply, text: decision } : reply;
      },
      stream: async () => reply,
    };
    return { client, plan: () => asked.find((a) => a.includes("Plan a narrated"))! };
  };

  it("plans for the length the request asked for; an explicit length wins; none keeps the default", async () => {
    let s = plans("# usecase: concept\n# method: feynman · why: x\n# length: long");
    await generate("how DNS works, explain it in detail", { client: s.client, qualityRepairs: false }).catch(() => undefined);
    expect(s.plan()).toContain("exactly 6 scenes");
    s = plans("# usecase: concept\n# method: feynman · why: x\n# length: long");
    await generate("how DNS works, explain it in detail", { client: s.client, length: "short", qualityRepairs: false }).catch(() => undefined);
    expect(s.plan()).toContain("exactly 2 scenes");
    // "none" is the model's reading of the whole request, so the topic's words are not consulted.
    s = plans("# usecase: concept\n# method: feynman · why: x\n# length: none");
    await generate("A short video on long polling", { client: s.client, qualityRepairs: false }).catch(() => undefined);
    expect(s.plan()).toContain("exactly 4 scenes");
    // No length line at all: the topic's words are the fallback.
    s = plans("# usecase: concept\n# method: feynman · why: x");
    await generate("A short video on DNS", { client: s.client, qualityRepairs: false }).catch(() => undefined);
    expect(s.plan()).toContain("exactly 2 scenes");
  });
});
