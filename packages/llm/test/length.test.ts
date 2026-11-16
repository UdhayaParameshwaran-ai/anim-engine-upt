import { describe, expect, it } from "vitest";
import { detectLength, generate, lengthSpec, outlinePrompt, sceneSystemPrompt, sceneKindOf, systemPrompt, type LlmClient } from "../src/index.js";

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
    const ask = outlinePrompt("dns", deep.scenes, undefined, {}, deep);
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
    await generate("how DNS works", { client, length: "long", qualityRepairs: false }).catch(() => undefined);
    expect(asked[0]).toContain("6–9 scenes");
    asked.length = 0;
    await generate("how DNS works", { client, length: "long", scenes: { min: 3, max: 3 }, qualityRepairs: false }).catch(() => undefined);
    expect(asked[0]).toContain("3–3 scenes");
  });
});
