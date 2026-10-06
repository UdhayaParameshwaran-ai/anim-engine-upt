import { compile } from "@anim/compiler";
import { AssetLibrary } from "@anim/registry";
import { describe, expect, it } from "vitest";
import {
  clean,
  clientFromEnv,
  FallbackClient,
  generate,
  LlmError,
  OpenAICompatibleClient,
  ReplayClient,
  retrieveAssets,
  systemPrompt,
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
1 pop sun
2 pop water`;
const LEAF_BROKEN = `Here is the scene:
scene leaf "Leaf" template=spotlight
main = asset:leaf
> Look closely at {1 the leaf}.
1 draw mian
3 pulse main`;
const LEAF_OK = `scene leaf "Leaf" template=spotlight
main = asset:leaf
> Look closely at {1 the leaf}.
1 draw main
end pulse main`;

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
    expect(r).toEqual({ text: "video 1", provider: "openrouter", model: "some/model", usage: { prompt: 12, completion: 3 } });
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
    expect(clientFromEnv({ env: { OPENROUTER_API_KEY: "a", GROQ_API_KEY: "b" } }).name).toBe("openrouter:anthropic/claude-sonnet-4.5 → groq:llama-3.3-70b-versatile");
    expect(clientFromEnv({ env: { GROQ_API_KEY: "b", ANIM_GROQ_MODEL: "x/y" } }).name).toBe("groq:x/y");
    expect(clientFromEnv({ env: { OPENROUTER_API_KEY: "a", GROQ_API_KEY: "b", ANIM_LLM_PROVIDERS: "groq,openrouter" }, model: "fast" }).name).toBe("groq:fast → openrouter:anthropic/claude-sonnet-4.5");
    expect(() => clientFromEnv({ env: {} })).toThrow(/OPENROUTER_API_KEY or GROQ_API_KEY/);
  });
});

// ---------------------------------------------------------------- prompt ---

describe("prompt", () => {
  it("is generated from the registry and lists only retrieved assets", () => {
    const assets = retrieveAssets("how leaves use sunlight and water", new AssetLibrary(), 5);
    expect(assets.map((a) => a.name).slice(0, 3)).toEqual(expect.arrayContaining(["leaf", "sun", "droplet"]));
    const sys = systemPrompt(assets);
    for (const verb of ["fade", "pop", "draw", "write", "highlight", "move", "focus"]) expect(sys).toContain(`  ${verb} `);
    for (const tpl of ["compare", "steps", "flow", "cycle"]) expect(sys).toContain(`  ${tpl} `);
    expect(sys).toContain("asset:leaf(blade,vein,stem)");
    expect(sys).not.toContain("heart.anatomy");
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
