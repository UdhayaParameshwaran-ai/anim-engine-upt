import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { compile } from "@anim/compiler";
import { Director, type HistoryEntry } from "@anim/director";
import { AssetLibrary, TEMPLATES } from "@anim/registry";
import { describe, expect, it } from "vitest";
import {
  CLOSINGS,
  ClaudeCodeClient,
  clean,
  keepPlanned,
  clientFromEnv,
  flatten,
  FallbackClient,
  generate,
  outlineSystemPrompt,
  LlmError,
  modelChoices,
  OPENINGS,
  outlinePrompt,
  OpenAICompatibleClient,
  qualityIssues,
  copiedFrom,
  USE_CASES,
  ReplayClient,
  retrieveAssets,
  routeOutline,
  sceneKindOf,
  scenePrompt,
  castPlan,
  canvasChoicePrompt,
  canvasOutlinePrompt,
  chosenCanvas,
  bindCarry,
  checkScene,
  briefOf,
  pruneCarry,
  sceneSystemPrompt,
  shapeTable,
  storyArc,
  systemPrompt,
  templateCard,
  tidyOutline,
  type CallTrace,
  type ChatRequest,
  type ChatResult,
  type LlmClient,
} from "../src/index.js";

// ----------------------------------------------------------------- fakes ---

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

/** Scripted LLM: answers by inspecting the last user message. */
class ScriptedLlm implements LlmClient {
  readonly name = "scripted";
  readonly requests: ChatRequest[] = [];
  constructor(private readonly respond: (lastUser: string, req: ChatRequest) => string) {}
  async chat(req: ChatRequest): Promise<ChatResult> {
    this.requests.push(req);
    const last = [...req.messages].reverse().find((m) => m.role === "user")!.content;
    return { text: this.respond(last, req), provider: "scripted", model: "m", usage: { prompt: 10, completion: 5 } };
  }
  async stream(req: ChatRequest, onDelta: (t: string) => void): Promise<ChatResult> {
    const r = await this.chat(req);
    for (let i = 0; i < r.text.length; i += 9) onDelta(r.text.slice(i, i + 9));
    return r;
  }
}

const OUTLINE = '```\nvideo 1 "Plants"\ntheme paper\nscene need "Needs" template=steps\n# goal: what plants need\nscene leaf "Leaf" template=spotlight\n# goal: inside the leaf\n```';
const NEED_OK = `scene need "Needs" template=steps
sun = icon:sun "Light"
water = icon:droplet "Water"
> Plants need {1}light and {2}water.
1 pop sun then visit sun
2 pop water then visit water`;
const LEAF_BROKEN = `Here is the scene:
scene leaf "Leaf" template=spotlight
main = asset:leaf
> Look closely at {1 the leaf}.
1 draw mian
3 visit main`;
const LEAF_OK = `scene leaf "Leaf" template=spotlight
main = asset:leaf
> Look closely at {1 the leaf}.
1 draw main
end visit main`;

// ---------------------------------------------------------------- client ---

describe("OpenAI-compatible client", () => {
  it("posts a chat completion with auth, model and headers", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new OpenAICompatibleClient({
      name: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-test",
      model: "some/model",
      headers: { "X-Title": "anim" },
      fetch: async (url, init) => {
        seen = { url: String(url), init: init! };
        return jsonResponse({ model: "some/model", choices: [{ message: { content: "video 1" } }], usage: { prompt_tokens: 12, completion_tokens: 3 } });
      },
    });
    const r = await client.chat({ messages: [{ role: "user", content: "hi" }], temperature: 0.2 });
    expect(seen!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");
    expect(headers["X-Title"]).toBe("anim");
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({ model: "some/model", temperature: 0.2, stream: false, messages: [{ role: "user", content: "hi" }] });
    expect(r).toMatchObject({ text: "video 1", provider: "openrouter", model: "some/model", usage: { prompt: 12, completion: 3 } });
    // What went over the wire, for the calls panel: the body as posted (no credentials) and the raw reply.
    expect(r.wire!.request).toContain("POST https://openrouter.ai/api/v1/chat/completions");
    expect(r.wire!.request).toContain('"model": "some/model"');
    expect(r.wire!.request).not.toContain("sk-test");
    expect(JSON.parse(r.wire!.response).usage).toEqual({ prompt_tokens: 12, completion_tokens: 3 });
  });

  it("streams server-sent events split across chunks", async () => {
    const event = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
    const body = [event({ choices: [{ delta: { content: "video " } }] }), event({ choices: [{ delta: { content: "1\nscene" } }] }), event({ choices: [], x_groq: { usage: { prompt_tokens: 5, completion_tokens: 2 } } }), "data: [DONE]\n\n"].join("");
    const pieces = body.match(/[\s\S]{1,7}/g)!; // split mid-line
    const client = new OpenAICompatibleClient({ name: "groq", baseUrl: "https://x/v1", apiKey: "k", model: "m", fetch: async () => sseResponse(pieces) });
    const deltas: string[] = [];
    const r = await client.stream({ messages: [] }, (d) => deltas.push(d));
    expect(deltas.join("")).toBe("video 1\nscene");
    expect(r.text).toBe("video 1\nscene");
    expect(r.usage).toEqual({ prompt: 5, completion: 2 });
  });

  it("retries rate limits honoring retry-after, but not client errors", async () => {
    const waits: number[] = [];
    let calls = 0;
    const flaky = new OpenAICompatibleClient({
      name: "groq",
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
      sleep: async (ms) => void waits.push(ms),
      fetch: async () => (++calls === 1 ? jsonResponse({ error: "slow down" }, 429, { "retry-after": "3" }) : jsonResponse({ choices: [{ message: { content: "ok" } }] })),
    });
    expect((await flaky.chat({ messages: [] })).text).toBe("ok");
    expect(waits).toEqual([3000]);

    const bad = new OpenAICompatibleClient({ name: "groq", baseUrl: "https://x/v1", apiKey: "k", model: "m", sleep: async () => {}, fetch: async () => jsonResponse({ error: "bad key" }, 401) });
    await expect(bad.chat({ messages: [] })).rejects.toMatchObject({ status: 401, retryable: false });
  });

  it("falls back to the next provider", async () => {
    const failing: LlmClient = { name: "a", chat: async () => Promise.reject(new LlmError("down")), stream: async (_r, d) => (d("partial junk"), Promise.reject(new LlmError("down"))) };
    const working = new ScriptedLlm(() => "video 1");
    const client = new FallbackClient([failing, working]);
    expect((await client.chat({ messages: [{ role: "user", content: "x" }] })).text).toBe("video 1");
    const deltas: string[] = [];
    await client.stream({ messages: [{ role: "user", content: "x" }] }, (d) => deltas.push(d));
    expect(deltas.join("")).toBe("video 1"); // nothing from the failed attempt
  });

  it("builds clients from the environment, skipping providers without keys", () => {
    expect(clientFromEnv({ env: { OPENROUTER_API_KEY: "a", ANTHROPIC_API_KEY: "b" } }).name).toBe("openrouter:anthropic/claude-sonnet-4.5 → anthropic:claude-sonnet-5-5");
    expect(clientFromEnv({ env: { ANTHROPIC_API_KEY: "b", ANIM_ANTHROPIC_MODEL: "x-y" } }).name).toBe("anthropic:x-y");
    expect(clientFromEnv({ env: { OPENROUTER_API_KEY: "a", ANTHROPIC_API_KEY: "b", ANIM_LLM_PROVIDERS: "anthropic,openrouter" }, model: "fast" }).name).toBe("anthropic:fast → openrouter:anthropic/claude-sonnet-4.5");
    expect(() => clientFromEnv({ env: {} })).toThrow(/OPENROUTER_API_KEY or GEMINI_API_KEY or ANTHROPIC_API_KEY/);
  });

  it("talks to Gemini and the Claude API through their OpenAI-compatible endpoints", async () => {
    const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const env = { GEMINI_API_KEY: "gm", ANTHROPIC_API_KEY: "an", ANIM_GEMINI_MODEL: "models/gemini-3-flash-preview" };
    expect(clientFromEnv({ env }).name).toBe("gemini:gemini-3-flash-preview → anthropic:claude-sonnet-5-5");

    const ask = { messages: [{ role: "user" as const, content: "x" }], temperature: 0.4, maxTokens: 50 };
    await clientFromEnv({ env, providers: ["gemini"], fetch }).chat(ask);
    await clientFromEnv({ env, providers: ["anthropic"], fetch }).chat(ask);
    const [gemini, claude] = seen;
    expect(claude!.url).toBe("https://api.anthropic.com/v1/chat/completions");
    expect(claude!.headers.authorization).toBe("Bearer an");
    expect(claude!.body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 50 });
    expect(gemini!.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(gemini!.headers.authorization).toBe("Bearer gm");
    expect(gemini!.body).toMatchObject({ model: "gemini-3-flash-preview", temperature: 0.4, max_tokens: 50 });
  });
});

// ---------------------------------------------------------------- prompt ---

describe("prompt", () => {
  it("is generated from the registry and lists only the pictures it is given", () => {
    const assets = retrieveAssets("how leaves use sunlight and water", new AssetLibrary(), 5);
    expect(assets.map((a) => a.name)).toEqual(expect.arrayContaining(["leaf", "sun", "droplet"]));
    const sys = systemPrompt(assets);
    for (const verb of ["fade", "pop", "draw", "write", "highlight", "move", "focus"]) expect(sys).toContain(`  ${verb} `);
    for (const tpl of ["compare", "steps", "flow", "cycle"]) expect(sys).toContain(`  ${tpl} `);
    expect(sys).toContain("Illustrations, written asset:<name> (parts in brackets): leaf(blade,vein,stem)");
    expect(sys).toContain("glass-water");
    // The example in the prompt must itself be valid.
    const example = sys.slice(sys.indexOf("EXAMPLE\n") + 8);
    expect(compile(example).diagnostics).toEqual([]);
  });

  it("cleans fences and chatter from replies", () => {
    expect(clean("Sure! Here you go:\n```nar\nvideo 1\nscene a\n```\nHope it helps")).toBe("video 1\nscene a\nHope it helps");
  });
});

// ------------------------------------------------------------- pipeline ---

describe("generate", () => {
  const respond = (fixLeaf: boolean) => (last: string) => {
    if (last.startsWith("Plan a narrated")) return OUTLINE;
    if (last.includes('Write scene "need"')) return NEED_OK;
    if (last.includes('Write scene "leaf"')) return LEAF_BROKEN;
    if (last.startsWith("This scene has errors")) return fixLeaf ? LEAF_OK : LEAF_BROKEN;
    throw new Error(`unexpected prompt: ${last.slice(0, 80)}`);
  };

  it("outlines, writes scenes, repairs the broken one and assembles a valid script", async () => {
    const llm = new ScriptedLlm(respond(true));
    const ready: number[] = [];
    const r = await generate("how plants make food", { client: llm, onScene: (_, i) => ready.push(i) });
    expect(r.ok).toBe(true);
    expect(r.repairs).toBe(1);
    expect(r.calls).toBe(4); // outline + 2 scenes + 1 repair
    expect(ready).toEqual([0, 1]);
    expect(r.diagnostics).toEqual([]);
    expect(r.script).toContain("1 draw main");
    expect(r.usage).toEqual({ prompt: 40, completion: 20 });

    // The repair prompt carried scene-relative line numbers and the compiler's messages.
    const repair = llm.requests.find((q) => q.messages.at(-1)!.content.startsWith("This scene has errors"))!;
    const msg = repair.messages.at(-1)!.content;
    expect(msg).toContain("  4| 1 draw mian");
    expect(msg).toContain("L4:3 NAR301 error: `mian` is not declared (did you mean `main`?)");
    expect(msg).toContain("L5:1 NAR303 error");
    expect(repair.messages.at(-2)).toMatchObject({ role: "assistant" });
  });

  it("traces every call with its purpose, tokens, timing and how the reply validated", async () => {
    const seen: CallTrace[] = [];
    const r = await generate("how plants make food", { client: new ScriptedLlm(respond(true)), concurrency: 1, onCall: (c) => seen.push(c) });
    expect(r.trace.map((c) => [c.kind, c.scene, c.attempt])).toEqual([
      ["outline", undefined, undefined],
      ["scene", "need", undefined],
      ["scene", "leaf", undefined],
      ["repair", "leaf", 1],
    ]);
    const [outline, need, leaf, repair] = r.trace;
    expect(outline).toMatchObject({ status: "done", system: "outline", verdict: "2 scenes: need, leaf", usage: { prompt: 10, completion: 5 }, provider: "scripted", model: "m" });
    expect(need).toMatchObject({ system: "scene", check: { errors: 0 }, verdict: "valid" });
    expect(leaf!.check!.errors).toBe(2);
    expect(leaf!.verdict).toBe("has errors → repair");
    expect(repair).toMatchObject({ history: 2, check: { errors: 0 }, verdict: "valid" });
    // The repair carries the diagnostics that triggered it, and both sides of the exchange.
    expect(repair!.reason).toContain("NAR301");
    expect(repair!.prompt).toContain("This scene has errors");
    expect(repair!.reply).toContain("1 draw main");
    for (const c of r.trace) expect(c.ms).toBeGreaterThanOrEqual(0);
    // Each call is reported when it starts, when it ends and once validated (same id, so consumers upsert).
    expect(seen.filter((c) => c.id === 3).map((c) => c.status)).toEqual(["running", "done", "done"]);
    expect(seen.find((c) => c.id === 3 && c.status === "running")!.reply).toBeUndefined();
  });

  it("estimates tokens when the provider reports none", async () => {
    const quiet: LlmClient = { name: "q", chat: async () => ({ text: "x".repeat(400), provider: "q", model: "m" }), stream: async () => ({ text: "", provider: "q", model: "m" }) };
    const seen: CallTrace[] = [];
    // The reply has no scenes, so generation fails, but the call is still traced.
    await expect(generate("plants", { client: quiet, onCall: (c) => seen.push(c) })).rejects.toThrow(/no scenes/);
    expect(seen.find((c) => c.id === 1 && c.status === "done")).toMatchObject({ estimated: true, usage: { completion: 100 } });
  });

  it("falls back to auto-fix when repairs don't help", async () => {
    const r = await generate("how plants make food", { client: new ScriptedLlm(respond(false)), maxRepairs: 2 });
    expect(r.repairs).toBe(2);
    expect(r.ok).toBe(true); // both errors are auto-fixable
    expect(r.diagnostics.every((d) => d.severity === "warning" || d.fixed)).toBe(true);
    expect(compile(r.script).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("streams a single pass and validates scenes as they arrive", async () => {
    const full = `video 1 "Plants"\ntheme paper\n\n${NEED_OK}\n\n${LEAF_BROKEN.replace("Here is the scene:\n", "")}`;
    const llm = new ScriptedLlm((last) => (last.startsWith("Write a complete") ? full : LEAF_OK));
    const ready: string[] = [];
    const r = await generate("plants", { client: llm, mode: "single", onScene: (t) => ready.push(t.split("\n")[0]!) });
    expect(r.ok).toBe(true);
    expect(r.repairs).toBe(1);
    expect(ready).toEqual(['scene need "Needs" template=steps', 'scene leaf "Leaf" template=spotlight']);
  });

  it("reports failure when errors can't be fixed", async () => {
    const outline = 'video 1 "X"\nscene c "Compare" template=compare';
    const scene = 'scene c "Compare" template=compare\nleft = icon:sun\n> Only {1}one side.\n1 pop left';
    const r = await generate("x", { client: new ScriptedLlm((last) => (last.startsWith("Plan") ? outline : scene)), maxRepairs: 1 });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === "NAR407" && d.severity === "error")).toBe(true);
  });
});

describe("progressive output", () => {
  it("hands each scene over with the header, so every prefix is a playable script", async () => {
    const llm = new ScriptedLlm((last) => {
      if (last.startsWith("Plan a narrated")) return OUTLINE;
      return last.includes('Write scene "need"') ? NEED_OK : LEAF_OK;
    });
    const prefixes: string[] = [];
    const parts: string[] = [];
    await generate("plants", {
      client: llm,
      onScene: (text, i, header) => {
        parts[i] = text;
        prefixes.push(`${header}\n\n${parts.slice(0, i + 1).join("\n\n")}\n`);
      },
    });
    expect(prefixes).toHaveLength(2);
    expect(prefixes[0]).toMatch(/^video 1 "Plants"\ntheme paper\n\nscene need/);
    for (const p of prefixes) expect(compile(p).ok).toBe(true);
    expect(compile(prefixes[0]!).ir!.scenes.map((s) => s.id)).toEqual(["need"]);
    expect(compile(prefixes[1]!).ir!.scenes.map((s) => s.id)).toEqual(["need", "leaf"]);
  });

  it("replays a script as a stream for offline runs", async () => {
    const script = `video 1 "Plants"\ntheme paper\n\n${NEED_OK}\n\n${LEAF_OK}\n`;
    const waits: number[] = [];
    const client = new ReplayClient(script, { chunk: 10, delayMs: 5, sleep: async (ms) => void waits.push(ms) });
    const ready: number[] = [];
    const r = await generate("x", { client, mode: "single", onScene: (_, i) => ready.push(i) });
    expect(r.ok).toBe(true);
    expect(r.calls).toBe(1);
    expect(ready).toEqual([0, 1]);
    expect(waits.length).toBe(Math.ceil(script.length / 10) - 1);
  });
});

describe("generation fixes from the traced run", () => {
  const HEADER = 'video 1 "Plants"';
  const tracker = (inner: ScriptedLlm, concurrency?: number): LlmClient & { peak: number } => {
    let busy = 0;
    const c = {
      name: "tracked",
      ...(concurrency && { concurrency }),
      peak: 0,
      chat: async (req: ChatRequest) => {
        c.peak = Math.max(c.peak, ++busy);
        await new Promise((ok) => setTimeout(ok, 5));
        try {
          return await inner.chat(req);
        } finally {
          busy--;
        }
      },
      stream: (req: ChatRequest, d: (t: string) => void) => inner.stream(req, d),
    };
    return c;
  };
  const plain = (last: string) => (last.startsWith("Plan") ? OUTLINE : last.includes('"need"') ? NEED_OK : LEAF_OK);

  it("waits out rate limits for longer than other failures", async () => {
    const waits: number[] = [];
    let calls = 0;
    const client = new OpenAICompatibleClient({
      name: "groq",
      baseUrl: "https://x/v1",
      apiKey: "k",
      model: "m",
      sleep: async (ms) => void waits.push(ms),
      fetch: async () => (++calls <= 5 ? jsonResponse({ error: "tpm" }, 429, { "retry-after": "2" }) : jsonResponse({ choices: [{ message: { content: "ok" } }] })),
    });
    expect((await client.chat({ messages: [] })).text).toBe("ok");
    expect(waits).toEqual([2000, 2000, 2000, 2000, 2000]);
  });

  it("writes scenes one at a time on providers with a concurrency limit", async () => {
    const limited = tracker(new ScriptedLlm(plain), 1);
    await generate("plants", { client: limited });
    expect(limited.peak).toBe(1);
    const open = tracker(new ScriptedLlm(plain));
    await generate("plants", { client: open });
    expect(open.peak).toBe(2);
  });

  it("plans with what choosing needs, and writes each scene with what its kind needs", async () => {
    const llm = new ScriptedLlm(plain);
    await generate("plants", { client: llm });
    const [outline, scene] = llm.requests.map((q) => q.messages[0]!.content);
    expect(outline).toContain("PLANNING RULES");
    // Planning sees how much each template holds and what fits each page layout.
    expect(outline).toMatch(/template=converge \[2–5 items \+ result\]/);
    expect(outline).toMatch(/L2-04 Left 2\/3 \+ Right 1\/3: 1141×800 · 555×800/);
    expect(outline).toMatch(/PAGE ELEMENTS \(the smallest slot each needs\): .*chart 560×320/);
    // A template scene gets no page section, no other templates and no full example: far less than the whole language.
    expect(scene).toContain("template=steps [emphasis");
    expect(scene).not.toContain("GRID SCENES");
    expect(scene).not.toContain("TEMPLATES (");
    expect(scene).not.toContain("EXAMPLE\n");
    expect(scene.length).toBeLessThan(systemPrompt(new AssetLibrary().all()).length / 2.5);
  });

  it("tells later scenes what earlier scenes already said", async () => {
    const llm = new ScriptedLlm(plain);
    await generate("plants", { client: { name: "seq", concurrency: 1, chat: (r) => llm.chat(r), stream: (r, d) => llm.stream(r, d) } });
    const second = llm.requests.find((q) => q.messages.at(-1)!.content.includes('Write scene "leaf"'))!;
    expect(second.messages.at(-1)!.content).toContain("Already narrated in earlier scenes");
    expect(second.messages.at(-1)!.content).toContain("need: Plants need light and water.");
  });

  it("flags valid but weak scenes", () => {
    const boxes = 'scene a "A" template=compare\nleft = box "Light in"\nright = box "Light out"\n> Light goes {1}in and {2}out.\n1 fade left\n2 fade right';
    expect(qualityIssues(HEADER, boxes).map((q) => q.code)).toEqual(["Q1", "Q4"]);
    const quote = 'scene q "Q" grid=L1-01\ns1 = quote "The sky is on fire." "— Atmospheric Scientist"\n> As one {1}scientist said.\n1 draw s1';
    expect(qualityIssues(HEADER, quote)).toMatchObject([{ code: "Q3", line: 2 }]);
    const missing = 'scene m "M" layout row\nx = asset:zzqqxx "Thing"\ny = icon:sun "Sun"\n> A {1}thing and the {2}sun.\n1 fade x\n2 pop y';
    expect(qualityIssues(HEADER, missing).map((q) => q.code)).toEqual(["Q2"]);
    expect(qualityIssues(HEADER, NEED_OK)).toEqual([]);
  });

  it("gives a weak scene one improvement pass and keeps it only if it is better", async () => {
    const weak = 'scene need "Needs" template=steps\na = box "Light"\nb = box "Water"\n> Plants need {1}light and {2}water.\n1 fade a\n2 fade b';
    const answer = (improved: string) => (last: string) =>
      last.startsWith("This scene is valid") ? improved : last.startsWith("Plan") ? OUTLINE : last.includes('"need"') ? weak : LEAF_OK;
    const better = new ScriptedLlm(answer(NEED_OK));
    const r = await generate("plants", { client: better });
    expect(r.script).toContain("icon:sun");
    expect(r.quality).toEqual([]);
    const prompt = better.requests.find((q) => q.messages.at(-1)!.content.startsWith("This scene is valid"))!.messages.at(-1)!.content;
    expect(prompt).toContain("Q1 quality:");

    const same = await generate("plants", { client: new ScriptedLlm(answer(weak)) });
    expect(same.script).toContain('box "Light"');
    expect(same.quality).toHaveLength(2);

    const off = new ScriptedLlm(answer(NEED_OK));
    await generate("plants", { client: off, qualityRepairs: false });
    expect(off.requests).toHaveLength(3);
  });
});

describe("style director in generation", () => {
  const plain = (last: string) => (last.startsWith("Plan") ? OUTLINE : last.includes('"need"') ? NEED_OK : LEAF_OK);

  it("styles the header before the first scene streams and varies looks across a user's videos", async () => {
    const history: HistoryEntry[] = [];
    const looks: string[] = [];
    for (let i = 0; i < 3; i++) {
      const director = new Director({ topic: "how plants make food", history });
      const headers: string[] = [];
      const r = await generate("how plants make food", { client: new ScriptedLlm(plain), director, onScene: (_, __, header) => headers.push(header) });
      expect(r.ok).toBe(true);
      // Every scene was handed over under the directed header.
      for (const h of headers) expect(h).toContain(`theme ${director.choice.theme}`);
      expect(r.script).toContain(`motion ${director.choice.motion}`);
      looks.push(director.choice.theme);
      history.push(director.entry());
    }
    expect(new Set(looks).size).toBe(3);
  });
});

describe("tidyOutline", () => {
  it("fixes numeric and repeated scene ids and variants=", () => {
    const out = tidyOutline(['video 1 "X"', 'scene 1 "A" template=steps variants=row', 'scene stages "B"', "# goal: b", 'scene stages "C"', 'scene stages "D"'].join("\n"));
    expect(out.split("\n").filter((l) => l.startsWith("scene"))).toEqual([
      'scene s1 "A" template=steps variant=row',
      'scene stages "B"',
      'scene stages2 "C"',
      'scene stages3 "D"',
    ]);
  });
});

describe("template knowledge", () => {
  it("repairs prompt syntax copied into the outline", () => {
    const out = tidyOutline(['scene intro "A" template=title | grid=L1-01', 'scene facts "B" grid=L2-01 [mirror=true]'].join("\n"));
    expect(out.split("\n")).toEqual(['scene intro "A" template=title', 'scene facts "B" grid=L2-01 mirror=true']);
  });

  it("routes a planned scene to the template of its shape", () => {
    const outline = [
      'video 1 "Plants"',
      'scene need "Needs" template=steps variant=zigzag',
      "# shape: many-to-one · goal: sun, water and CO2 make a leaf grow",
      'scene make "Make" template=processing',
      "# shape: transform · goal: inputs become glucose",
      'scene loop "Loop" template=cycle',
      "# shape: loop · goal: the cycle repeats",
      'scene facts "Facts" grid=L3-01',
      "# shape: page · goal: numbers",
    ].join("\n");
    const { text, changes } = routeOutline(outline);
    expect(text.split("\n").filter((l) => l.startsWith("scene"))).toEqual([
      'scene need "Needs" template=converge',
      'scene make "Make" template=process',
      'scene loop "Loop" template=cycle',
      'scene facts "Facts" grid=L3-01',
    ]);
    expect(changes).toEqual(["need: steps → converge (shape many-to-one)", "make: processing → process (shape transform)"]);
  });

  it("lists every template under its shape for planning", () => {
    const table = shapeTable();
    for (const t of TEMPLATES) expect(table).toMatch(new RegExp(`→ template=${t.name}[ :]`));
  });

  it("sends the planned template's card, with its example, only with that scene", () => {
    const outline = ['video 1 "Plants"', 'scene need "Needs" template=converge', "# shape: many-to-one · goal: x", 'scene facts "Facts" grid=L3-01'].join("\n");
    const converge = TEMPLATES.find((t) => t.name === "converge")!;
    const prompt = scenePrompt(outline, "need");
    expect(prompt).toContain(templateCard(converge));
    for (const v of converge.variants) expect(prompt).toContain(converge.guide.variants[v]!.when);
    expect(prompt).not.toContain("TEMPLATE process");
    expect(scenePrompt(outline, "facts")).not.toContain("TEMPLATE ");
    // Grid pages get their own card: slots in fill order, what fits each, the page rules.
    expect(scenePrompt(outline, "facts")).toMatch(/GRID PAGE L3-01 Three columns\nExactly 3 content elements[\s\S]*slot 3: /);
  });
});

describe("local fixes", () => {
  it("adds missing cues itself instead of spending a repair call", async () => {
    const UNMARKED = `scene need "Needs" template=steps
sun = icon:sun "Light"
water = icon:droplet "Water"
a1 = arrow sun->water
> Plants need light and then they need water.
1 pop sun then visit sun
2 draw a1 then pop water then visit water`;
    const llm = new ScriptedLlm((last) => (last.startsWith("Plan a narrated") ? OUTLINE : last.includes('Write scene "need"') ? UNMARKED : last.includes('Write scene "leaf"') ? LEAF_OK : "x"));
    const r = await generate("plants", { client: llm });
    expect(r.ok).toBe(true);
    expect(r.repairs).toBe(0);
    expect(r.script).toMatch(/> Plants need .*\{1\}.*\{2\}/);
  });
});

describe("model choices", () => {
  it("offers the Claude models and the Gemini key's text models", async () => {
    expect(await modelChoices("claude", { ANIM_CLAUDE_MODEL: "claude-sonnet-5-5" })).toEqual({
      default: "claude-sonnet-5-5",
      models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
    });
    const list = { data: [{ id: "models/gemini-2.5-flash" }, { id: "models/gemini-3-pro-preview" }, { id: "models/text-embedding-004" }, { id: "models/gemini-2.5-flash-preview-tts" }] };
    const gem = await modelChoices("gemini", { GEMINI_API_KEY: "k-test-1" }, async () => jsonResponse(list));
    expect(gem).toEqual({ default: "gemini-3-flash-preview", models: ["gemini-3-flash-preview", "gemini-3-pro-preview", "gemini-2.5-flash"] });
    const offline = await modelChoices("gemini", { GEMINI_API_KEY: "k-test-2" }, async () => jsonResponse({}, 403));
    expect(offline.models).toEqual(["gemini-3-flash-preview"]);
  });
});

describe("claude (subscription via the Claude Code CLI)", () => {
  /** A fake `claude -p` process that replays stream-json lines. */
  function fakeCli(lines: object[], record: { args?: string[]; input?: string; env?: NodeJS.ProcessEnv } = {}) {
    return (_bin: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => {
      record.args = args;
      record.env = opts.env;
      const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill: () => void };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => undefined;
      let input = "";
      child.stdin.on("data", (c) => (input += c));
      child.stdin.on("finish", () => {
        record.input = input;
        for (const l of lines) child.stdout.write(`${JSON.stringify(l)}\n`);
        child.stdout.end();
        setTimeout(() => child.emit("close", 0), 0);
      });
      return child as never;
    };
  }
  const delta = (text: string) => ({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } });
  const done = { type: "result", is_error: false, result: "scene a", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 }, modelUsage: { "claude-opus-5-5": {} } };

  it("streams the reply, reports usage, and never passes an API key to the CLI", async () => {
    const rec: { args?: string[]; input?: string; env?: NodeJS.ProcessEnv } = {};
    const client = new ClaudeCodeClient({ model: "claude-opus-5-5", spawn: fakeCli([delta("scene "), delta("a"), done], rec), env: { ANTHROPIC_API_KEY: "secret", PATH: "x" } });
    const parts: string[] = [];
    const r = await client.stream({ messages: [{ role: "system", content: "SYS" }, { role: "user", content: "write" }] }, (d) => parts.push(d));
    expect(parts).toEqual(["scene ", "a"]);
    expect(r).toMatchObject({ text: "scene a", provider: "claude", model: "claude-opus-5-5", usage: { prompt: 1010, completion: 5, cached: 900 } });
    // The CLI call as made (arguments, system prompt and stdin) and its raw result event.
    expect(r.wire!.request).toMatch(/^claude -p --output-format stream-json/);
    expect(r.wire!.request).toContain("=== --system-prompt ===");
    expect(r.wire!.request).toContain("=== stdin ===");
    expect(JSON.parse(r.wire!.response).type).toBe("result");
    expect(rec.args).toEqual(expect.arrayContaining(["-p", "--model", "claude-opus-5-5", "--tools", "", "--system-prompt", "SYS"]));
    expect(rec.input).toBe("write");
    expect(rec.env?.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("writes a multi-turn exchange as one prompt", () => {
    const { system, prompt } = flatten([{ role: "system", content: "S" }, { role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "fix it" }]);
    expect(system).toBe("S");
    expect(prompt).toContain("<user>\na\n</user>\n<assistant>\nb\n</assistant>");
    expect(prompt.endsWith("fix it")).toBe(true);
  });

  it("turns a CLI error into a retryable LlmError only when it is a limit", async () => {
    const limit = new ClaudeCodeClient({ model: "m", spawn: fakeCli([{ type: "result", is_error: true, result: "Claude usage limit reached" }]) });
    await expect(limit.chat({ messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ retryable: true });
    const auth = new ClaudeCodeClient({ model: "m", spawn: fakeCli([{ type: "result", is_error: true, result: "Invalid API key · Please run /login" }]) });
    await expect(auth.chat({ messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ retryable: false });
  });
});

describe("pictures, structure and story arcs", () => {
  it("offers each scene the pictures that match its words, plus everyday ones", () => {
    const lib = new AssetLibrary();
    const names = retrieveAssets('How a bill becomes law\nscene vote "Congress votes" template=steps\n# shape: sequence · goal: the House and Senate vote, then the president signs', lib).map((a) => a.name);
    // At most 30 matches, plus the hand-made art and the everyday icons: a fraction of the library.
    expect(names.length).toBeLessThan(lib.all().length / 4);
    expect(names).toEqual(expect.arrayContaining(["vote", "gavel", "signature"]));
    // Hand-made art is always on offer; icons that match nothing and aren't everyday ones are not.
    expect(names).toEqual(expect.arrayContaining(["leaf", "earth"]));
    expect(names).not.toContain("accessibility");
  });

  it("writes a grid page with only the page elements that fit its layout", () => {
    const sys = sceneSystemPrompt(sceneKindOf('scene facts "Facts" grid=L4-03'), new AssetLibrary().all());
    expect(sys).toContain("PAGE RULES");
    expect(sys).toContain("EXAMPLE PAGE");
    expect(sys).toContain('scene <id> "Title" grid=<layout>');
    // Four rows 1728×176: a stat (360×240) doesn't fit, a progress bar (400×160) does.
    expect(sys).toContain('progress "60%" "label"');
    expect(sys).not.toContain('stat "95%" "label"');
    expect(sys).not.toContain("ELEMENT KINDS");
    // No plan for the scene: the whole language.
    expect(sceneSystemPrompt(sceneKindOf(undefined), [])).toBe(systemPrompt([]));
  });

  it("keeps the planned template or grid layout on the written scene line", () => {
    expect(keepPlanned('scene a "A" template=cards variant=strip in=fade\nx = icon:sun', 'scene a "A" template=cards')).toEqual({ text: 'scene a "A" template=cards variant=strip in=fade\nx = icon:sun' });
    expect(keepPlanned('scene a "A" grid=L2-07 in=fade\nx = stat "1" "y"', 'scene a "A" grid=L2-02')).toEqual({
      text: 'scene a "A" grid=L2-02 in=fade\nx = stat "1" "y"',
      changed: "grid=L2-02 (it wrote grid=L2-07)",
    });
    // Another template's variant means nothing to the planned one.
    expect(keepPlanned('scene a "A" template=steps variant=zigzag', 'scene a "A" template=cycle').text).toBe('scene a "A" template=cycle');
    expect(keepPlanned('scene a "A"', 'scene a "A" template=hub').text).toBe('scene a "A" template=hub');
  });

  it("tells the writer what templates draw themselves, and its examples leave that out", () => {
    const sys = systemPrompt([]);
    expect(sys).toContain("Templates draw their own structure");
    for (const name of ["steps", "cycle", "hub", "converge", "diverge", "process", "cards", "compare", "spotlight", "timeline"]) {
      const example = TEMPLATES.find((t) => t.name === name)!.guide.example;
      expect(example, name).not.toMatch(/=\s*(arrow|line)\b/);
      expect(compile(`video 1\n${example}\n`).diagnostics, name).toEqual([]);
    }
  });

  it("asks each plan for one opening and one ending, picked by the topic", () => {
    const arcs = ["water cycle", "how a bill becomes law", "plant and animal cells", "the fire triangle", "compound interest", "history of the internet", "the human heart", "renewable energy"].map((t) => storyArc(t));
    // Stable for a topic, varied across topics.
    expect(storyArc("Water cycle ")).toEqual(arcs[0]);
    expect(new Set(arcs.map((a) => a.open.name)).size).toBeGreaterThan(2);
    expect(new Set(arcs.map((a) => a.close.name)).size).toBeGreaterThan(2);
    const forced = storyArc("water cycle", { open: "cold", close: "recap" });
    const ask = outlinePrompt("water cycle", { min: 4, max: 6 }, forced);
    expect(ask).toContain("Suggested opening: no title scene: open on the first idea itself");
    expect(ask).toContain("Suggested ending: a diagram that pulls the main ideas into one picture");
    expect(OPENINGS.map((o) => o.name)).toEqual(["title", "question", "cold", "number"]);
    expect(CLOSINGS.map((c) => c.name)).toEqual(["bullets", "recap", "checklist", "takeaway"]);
  });
});

describe("quality: story motion (Q4)", () => {
  const head = "video 1\ntheme light\n";
  it("flags an exchange scene whose messages only appear, and accepts one that sends packets", () => {
    const base = 'scene s "Call" template=exchange\na = icon:globe "Browser"\nb = icon:server "Server"\nm1 = arrow a->b "GET /"\n> The {1}browser asks the {2}server.\n1 pop a\n2 pop b\n> It {1}sends a request.\n';
    expect(qualityIssues(head, `${base}1 draw m1`).some((q) => q.code === "Q4")).toBe(true);
    expect(qualityIssues(head, `${base}1 send m1`).some((q) => q.code === "Q4")).toBe(false);
  });
});

describe("variety budget", () => {
  it("never repeats the opening or ending of the last video, and is stable for the same history", () => {
    for (const topic of ["water cycle", "how a bill becomes law", "dns lookup", "tcp handshake", "binary search", "git rebase"]) {
      for (const open of OPENINGS_FOR_TEST) {
        for (const close of CLOSINGS_FOR_TEST) {
          const a = storyArc(topic, {}, { open: [open], close: [close] });
          expect(a.open.name).not.toBe(open);
          expect(a.close.name).not.toBe(close);
          expect(storyArc(topic, {}, { open: [open], close: [close] })).toEqual(a);
        }
      }
    }
  });

  it("an explicit pick still wins over the history", () => {
    expect(storyArc("dns", { open: "cold", close: "recap" }, { open: ["cold"], close: ["recap"] })).toMatchObject({ open: { name: "cold" }, close: { name: "recap" } });
  });

  it("the director remembers how videos opened and ended, and which templates they drew", () => {
    const d = new Director({ topic: "dns" });
    d.header("video 1\n");
    d.recordArc("question", "takeaway");
    const entry = d.entry();
    expect(entry.arc).toEqual({ open: "question", close: "takeaway" });
    const next = new Director({ topic: "tcp", history: [{ ...entry, layouts: ["exchange:lanes", "L2-08", "tree:down"] }] });
    expect(next.recent()).toMatchObject({ open: ["question"], close: ["takeaway"], templates: ["exchange", "tree"] });
  });

  it("the outline asks for other templates when recent videos leaned on some", () => {
    const text = outlinePrompt("dns", { min: 3, max: 4 }, storyArc("dns"), { templates: ["exchange", "exchange", "tree"] });
    expect(text).toContain("leaned on these templates: exchange, tree");
    expect(outlinePrompt("dns", { min: 3, max: 4 })).not.toContain("leaned on");
  });
});

const OPENINGS_FOR_TEST = ["title", "question", "cold", "number"];
const CLOSINGS_FOR_TEST = ["bullets", "recap", "checklist", "takeaway"];

describe("cast and carry", () => {
  const OUTLINE = [
    'video 1 "Request"',
    "theme light",
    "motion corporate",
    '# cast: client = icon:smartphone "Client"; server = icon:server "Server"',
    'scene parts "Parts" template=cards',
    "# shape: parts · goal: the parties",
    'scene call "One request" template=exchange',
    "# shape: interaction · goal: a request and its answer · carry: client, server",
    'scene recap "Recap" grid=L2-08',
    "# shape: page · goal: the idea",
  ].join("\n");

  it("reads the cast and which scenes carry what (never the first scene)", () => {
    const plan = castPlan(OUTLINE);
    expect([...plan.cast]).toEqual([["client", 'icon:smartphone "Client"'], ["server", 'icon:server "Server"']]);
    expect(plan.carry.get("call")).toEqual(["client", "server"]);
    expect(plan.carry.has("parts")).toBe(false);
    expect(castPlan(OUTLINE.replace("goal: the parties", "goal: the parties · carry: client")).carry.has("parts")).toBe(false);
  });

  it("tells the scene that introduces the cast to declare it, and the carrying scene that it is already on screen", () => {
    const first = scenePrompt(OUTLINE, "parts");
    expect(first).toContain('client = icon:smartphone "Client"');
    expect(first).not.toContain("Carried from the previous scene");
    const second = scenePrompt(OUTLINE, "call");
    expect(second).toContain("Carried from the previous scene (client, server)");
    expect(second).toContain("carry=client,server");
    expect(scenePrompt(OUTLINE, "recap")).not.toContain("Recurring elements");
  });

  it("binds carry= on the scene line to the plan", () => {
    expect(bindCarry('scene call "One" template=exchange\nx = icon:sun', ["client"])).toContain('template=exchange carry=client\n');
    expect(bindCarry('scene call "One" carry=a,b\nx = icon:sun', [])).toBe('scene call "One"\nx = icon:sun');
    expect(bindCarry('scene call "One" carry=a\nx = icon:sun', ["c", "d"])).toContain("carry=c,d");
  });
});

describe("pruneCarry", () => {
  const line = (id: string, t: string, carry = "") => `scene ${id} "T" ${t}\n# shape: x · goal: y${carry ? ` · carry: ${carry}` : ""}`;
  it("keeps carry between picture templates and drops it next to a flowchart, a page or code", () => {
    const ok = [line("a", "template=cards"), line("b", "template=exchange", "client")].join("\n");
    expect(pruneCarry(ok)).toContain("carry: client");
    const flow = [line("a", "template=architecture"), line("b", "template=flow", "client")].join("\n");
    expect(pruneCarry(flow)).not.toContain("carry");
    const page = [line("a", "grid=L2-08"), line("b", "template=exchange", "client")].join("\n");
    expect(pruneCarry(page)).not.toContain("carry");
    expect(pruneCarry(line("a", "template=cards", "client"))).not.toContain("carry");
  });
});

describe("one evolving diagram (canvas)", () => {
  it("plans a single scene with chapters, and writes it as one diagram that grows", () => {
    const ask = canvasOutlinePrompt("a page load", { min: 3, max: 5 });
    expect(ask).toContain("ONE diagram that grows chapter by chapter");
    expect(ask).toContain("exactly three \"scene\" lines");
    expect(ask).toContain("scene intro");
    expect(ask).toContain("scene recap");
    expect(ask).toContain("# chapter: <id>");
    const outline = 'scene main "T" template=architecture\n# shape: architecture · goal: x\n# chapter: a · one\n# chapter: b · two';
    const write = scenePrompt(outline, "main", "", true);
    expect(write).toContain("one step per \"# chapter:\" line");
    expect(write).not.toContain("other scenes cover the rest");
    expect(scenePrompt(outline, "main")).toContain("other scenes cover the rest");
    const sys = sceneSystemPrompt(sceneKindOf(outline.split("\n")[0]), [], true);
    expect(sys).toContain("Declare EVERY element of the whole diagram first");
    expect(sceneSystemPrompt(sceneKindOf(outline.split("\n")[0]), [])).not.toContain("Declare EVERY element");
  });
});

describe("a video of separate scenes with one growing scene in it", () => {
  const PLAN = `\`\`\`
video 1 "Sorting"
theme paper
motion minimal
# usecase: algorithm
scene intro "Sorting" template=title
# shape: intro · goal: what sorting is
scene run "A run" template=trace
# shape: structure · goal: the finished sorted row
# chapter: one · the first pass
# chapter: two · the second pass
scene cost "Cost" template=steps
# shape: steps · goal: what it costs
\`\`\``;
  it("writes the scene that has chapters as a growing diagram, shows it a finished example, and gives no other scene one", async () => {
    const seen: Record<string, { user: string; system: string }> = {};
    const client = new ScriptedLlm((user, req) => {
      if (user.startsWith("Plan a narrated")) return PLAN;
      const id = /Write scene "(\w+)"/.exec(user)?.[1] ?? "?";
      seen[id] = { user, system: req.messages.find((m) => m.role === "system")?.content ?? "" };
      return `scene ${id} "S" template=${id === "intro" ? "title" : id === "run" ? "structure" : "steps"}\nt = title "S"\n> Hello {1 there}.\n1 fade t`;
    });
    await generate("Explain the bubble sort", { client, scenes: { min: 3, max: 3 }, qualityRepairs: false, maxRepairs: 0 });
    expect(seen["run"]!.user).toContain("A finished scene of this kind");
    expect(seen["run"]!.user).toContain("Finding the largest of five numbers");
    expect(seen["run"]!.user).toContain('one step per "# chapter:" line');
    expect(seen["run"]!.system).toContain("Declare EVERY element of the whole diagram first");
    for (const id of ["intro", "cost"]) {
      expect(seen[id]!.user).not.toContain("A finished scene of this kind");
      expect(seen[id]!.system).not.toContain("Declare EVERY element");
    }
  });

  it("the planner may plan one growing picture and is no longer told to never repeat a picture", () => {
    const sys = outlineSystemPrompt([], undefined);
    expect(sys).toContain("ONE GROWING PICTURE");
    expect(sys).toContain("# chapter: <id>");
    expect(sys).not.toContain("never show the same things in two scenes");
  });
});

describe("choosing between one diagram and scenes", () => {
  it("reads the one-word answer", () => {
    expect(chosenCanvas("diagram")).toBe(true);
    expect(chosenCanvas("Diagram.")).toBe(true);
    expect(chosenCanvas("scenes")).toBe(false);
    expect(chosenCanvas("scenes, not a diagram")).toBe(false);
    expect(chosenCanvas("")).toBe(false);
  });

  it("asks about the topic, and leans to scenes when unsure", () => {
    const ask = canvasChoicePrompt("How TCP connections change state");
    expect(ask).toContain("Topic: How TCP connections change state");
    expect(ask).toContain("When unsure, answer scenes");
  });
});

describe("extras that fit no slot", () => {
  const header = ["video 1", "theme paper", ""].join("\n");
  const scene = ["scene s \"Two\" template=compare", "title = title \"A or B\"", "left = box \"A: one thing\"", "right = box \"B: another\"", "extra = icon:users \"Extra\"", "> {1}A and {2}B and {3}extra.", "1 fade left", "2 fade right", "3 pop extra", ""].join("\n");

  it("is repaired like an error, so the picture is not cluttered", () => {
    const r = checkScene(header, scene);
    expect(r.errorCodes).toContain("NAR411");
    expect(r.errors).toBeGreaterThan(0);
  });
});

describe("quality Q4 beyond the story templates", () => {
  const HEADER = 'video 1 "Plants"';
  const body = (tpl: string, actions: string) => `scene a "A" template=${tpl}\na = icon:sun "Light"\nb = icon:droplet "Water"\nc = icon:leaf "Leaf"\n> {1}Light, {2}water, {3}leaf.\n${actions}`;
  it("asks for motion in any diagram that only shows things appearing, but not in a title", () => {
    for (const tpl of ["steps", "cycle", "timeline", "cards", "hub", "process", "stack"]) {
      expect(qualityIssues(HEADER, body(tpl, "1 pop a\n2 pop b\n3 pop c")).map((q) => q.code), tpl).toContain("Q4");
      expect(qualityIssues(HEADER, body(tpl, "1 pop a then visit a\n2 pop b\n3 pop c")).map((q) => q.code), tpl).not.toContain("Q4");
    }
    expect(qualityIssues(HEADER, body("title", "1 pop a\n2 pop b\n3 pop c")).map((q) => q.code)).not.toContain("Q4");
  });

  it("asks a number page to count its numbers", () => {
    const page = (actions: string) => `scene n "N" grid=L1-02\ns = stat "95%" "of users"\n> {1}Ninety five percent.\n${actions}`;
    expect(qualityIssues(HEADER, page("1 fade s")).map((q) => q.code)).toContain("Q4");
    expect(qualityIssues(HEADER, page('1 fade s then count s from=0 to=95 suffix="%"')).map((q) => q.code)).not.toContain("Q4");
  });
});

describe("wording copied from a finished example", () => {
  const example = USE_CASES.find((u) => u.name === "comparison")!.example!.text;
  const header = 'video 1 "T"\ntheme paper';
  const scene = (said: string) => `scene s "S" template=structure variant=array\nc1 = box "1"\nc2 = box "2"\n> ${said}\n1 pop c1,c2 then visit c1\n`;

  it("flags a sentence that repeats the example, and nothing that is about the topic", () => {
    const copy = scene("The second option {1}doubles every value.");
    expect(copiedFrom(example, copy.replace("{1}", ""))).toHaveLength(1);
    const own = scene("A {1}stack pops the newest item, while a queue takes the oldest.");
    expect(copiedFrom(example, own)).toEqual([]);
    // Short lines are never compared.
    expect(copiedFrom(example, scene("Here is {1}a row."))).toEqual([]);
  });

  it("is a quality issue only when the scene was shown an example", () => {
    const copy = scene("The second option {1}doubles every value.");
    expect(qualityIssues(header, copy, "comparison", example).some((q) => q.code === "Q6")).toBe(true);
    expect(qualityIssues(header, copy, "comparison").some((q) => q.code === "Q6")).toBe(false);
  });

  it("the examples themselves are checked scenes: they compile and say nothing about any real topic's numbers", () => {
    for (const u of USE_CASES.filter((u) => u.example)) {
      const r = compile(`${header}\n\n${u.example!.text}\n`);
      expect(r.diagnostics.filter((d) => d.severity === "error"), u.name).toEqual([]);
    }
  });
});

describe("comparing options on the same data", () => {
  it("the comparison plan tells the planner to apply each option to the same data in one growing scene", () => {
    const plan = USE_CASES.find((u) => u.name === "comparison")!.plan;
    expect(plan).toContain("SAME data");
    expect(plan).toContain("two data structures");
    expect(outlineSystemPrompt([], undefined)).toContain("two options applied one after the other to the same data");
  });
});

describe("planner brief", () => {
  const good = `video 1 "x"\n# usecase: concept\n# question: How do stack and queue differ?\n# example: values 4, 7, 2, 9\n# outcome: Say which removes first.\nscene a "A" template=structure\n# shape: structure · role: example · goal: run both\nscene b "B" grid=L2-08\n# shape: page · role: takeaway · goal: pick one`;
  it("reads the brief and roles", () => {
    const b = briefOf(good);
    expect(b.question).toContain("stack and queue");
    expect(b.roles).toEqual(["example", "takeaway"]);
    expect(b.problems).toEqual([]);
  });
  it("names what is missing", () => {
    const b = briefOf(`scene a "A" template=cards\n# shape: cards · goal: list`);
    expect(b.problems).toContain("no # question: line");
    expect(b.problems).toContain("a scene has no valid role");
  });
  it("offers the opening and ending as suggestions", () => {
    const ask = outlinePrompt("How a stack works", { min: 4, max: 6 });
    expect(ask).toContain("Suggested opening");
    expect(ask).toContain("# question:");
  });
});

describe("algorithm data scenes", () => {
  const PLAN = `video 1 "Sorting"\n# usecase: algorithm\nscene run "A run" template=structure variant=array\n# shape: structure · goal: the run\nscene cost "Cost" template=steps\n# shape: sequence · goal: cost`;
  it("turns a structure scene into a trace", async () => {
    const { traceForAlgorithms } = await import("../src/index.js");
    const r = traceForAlgorithms(PLAN, "algorithm");
    expect(r.text).toContain('scene run "A run" template=trace');
    expect(r.text).not.toContain("variant=array");
    expect(r.text).toContain("template=steps");
    expect(r.changes).toEqual(["run: structure → trace"]);
    // A still array is a trace with one state: every video routes the same way.
    expect(traceForAlgorithms(PLAN, "concept").text).toContain("template=trace");
  });
});
