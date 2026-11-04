import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const packages = join(repo, "packages");
const examples = join(repo, "examples");
const ttsDir = join(repo, ".cache", "tts");
if (existsSync(join(repo, ".env"))) process.loadEnvFile(join(repo, ".env"));

// Resolve @anim/* to package sources (client and server) so no build step is needed.
const alias = Object.fromEntries(readdirSync(packages).map((name) => [`@anim/${name}`, join(packages, name, "src", "index.ts")]));

/**
 * Dev API: compiles DSL in Node (parse → validate → layout → TTS →
 * resolve), serves the synthesized narration, and streams LLM generation
 * scene by scene for progressive playback.
 */
function api(): Plugin {
  return {
    name: "anim-studio-api",
    configureServer(server) {
      // Load the voice model in the background so the first build doesn't wait for it.
      if (defaultTts() === "kokoro") void voice(server, "kokoro").catch(() => undefined);
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        // The layout gallery is its own page.
        if (url.pathname === "/gallery" || url.pathname === "/gallery/") req.url = "/gallery.html" + url.search;
        try {
          if (url.pathname === "/api/examples") return json(res, readdirSync(examples).filter((f) => f.endsWith(".txt")));
          if (url.pathname === "/api/source") return send(res, "text/plain; charset=utf-8", readFileSync(join(examples, basename(url.searchParams.get("file") ?? "")), "utf8"));
          if (url.pathname === "/api/build" && req.method === "POST") return json(res, await build(server, await body(req), ttsOf(url), url.searchParams.get("variants") === "exact" ? "exact" : "fit"));
          if (url.pathname === "/api/providers") return json(res, await providers(server));
          if (url.pathname === "/api/generate") return await generateStream(server, url, req, res);
          if (url.pathname.startsWith("/audio/")) return send(res, "audio/wav", readFileSync(join(ttsDir, basename(url.pathname))));
          if (url.pathname.startsWith("/fonts/")) {
            const [pkg, file] = url.pathname.slice("/fonts/".length).split("/");
            return send(res, "font/woff2", readFileSync(join(repo, "node_modules", "@fontsource", basename(pkg ?? ""), "files", basename(file ?? ""))));
          }
        } catch (e) {
          res.statusCode = 500;
          return json(res, { error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
        }
        next();
      });
    },
  };
}

/** Voice plus look/motion overrides ("" keeps what the script says). */
type Tts = { name: "kokoro" | "piper" | "beeps"; speed: number; style: Record<string, string> };

/** Narration voice: "kokoro" (local neural TTS, best quality), "piper" (local, ~4x faster) or "beeps" (instant mock that ticks on every word). */
function defaultTts(): Tts["name"] {
  const v = process.env.ANIM_TTS;
  return v === "beeps" || v === "piper" ? v : "kokoro";
}

function ttsOf(url: URL): Tts {
  const name = url.searchParams.get("tts");
  const style: Record<string, string> = {};
  for (const key of ["theme", "motion"]) {
    const v = url.searchParams.get(key);
    if (v) style[key] = v;
  }
  return { name: name === "beeps" || name === "kokoro" || name === "piper" ? name : defaultTts(), speed: Number(url.searchParams.get("speed") ?? 1) || 1, style };
}

// One Kokoro instance for the server's lifetime: the model stays loaded.
let kokoro: Promise<unknown> | undefined;
async function voice(server: ViteDevServer, name: Tts["name"], speed = 1) {
  if (name === "beeps") {
    const { MockTtsProvider } = await server.ssrLoadModule("@anim/tts");
    return new MockTtsProvider({ audio: "beeps", speed });
  }
  if (name === "piper") {
    const { PiperTtsProvider } = await server.ssrLoadModule("@anim/tts-piper");
    return new PiperTtsProvider({ dir: join(repo, ".cache", "piper") });
  }
  kokoro ??= server.ssrLoadModule("@anim/tts-kokoro").then(async ({ KokoroTtsProvider }) => {
    const p = new KokoroTtsProvider({ cacheDir: join(repo, ".cache", "models") });
    await p.warmup();
    return p;
  });
  kokoro.catch(() => (kokoro = undefined));
  return kokoro;
}

async function build(server: ViteDevServer, source: string, tts: Tts, variants: "fit" | "exact" = "fit") {
  const { compile, report } = await server.ssrLoadModule("@anim/compiler");
  const { FileCache, speakVideo } = await server.ssrLoadModule("@anim/tts");
  const { resolve } = await server.ssrLoadModule("@anim/timeline");
  const compiled = compile(source, { settings: tts.style, variants });
  const diagnostics: string[] = compiled.diagnostics.length ? report(compiled.diagnostics).split("\n") : [];
  if (!compiled.ir) return { ok: false, diagnostics };
  const provider = await voice(server, tts.name, tts.speed);
  // Kokoro's rate is a request setting (part of the cache key); the mock bakes it into its id.
  const settings = tts.name !== "beeps" && tts.speed !== 1 ? { speed: tts.speed } : undefined;
  const speech = await speakVideo(compiled.ir, { provider, cache: new FileCache(ttsDir), ...(settings && { settings }) });
  const timeline = resolve(compiled.ir, speech);
  timeline.audio = timeline.audio.map((a: { src: string }) => ({ ...a, src: `/audio/${basename(a.src)}` }));
  return { ok: true, diagnostics, ir: compiled.ir, timeline };
}

async function providers(server: ViteDevServer) {
  const { THEMES, THEME_SUMMARIES, MOTIONS } = await server.ssrLoadModule("@anim/registry");
  const { configuredProviders, modelChoices } = await server.ssrLoadModule("@anim/llm");
  const llm: Record<string, boolean> = configuredProviders(process.env);
  // Model menus for the providers that offer a choice (and are set up).
  const models: Record<string, unknown> = {};
  for (const p of ["gemini", "azure", "claude"]) if (llm[p]) models[p] = await modelChoices(p, process.env);
  return {
    themes: THEMES.map((name: keyof typeof THEME_SUMMARIES) => ({ name, summary: THEME_SUMMARIES[name] })),
    motions: MOTIONS.map((m: { name: string; summary: string }) => ({ name: m.name, summary: m.summary })),
    llm,
    models,
    tts: defaultTts(),
    examples: readdirSync(examples).filter((f) => f.endsWith(".txt")),
  };
}

/**
 * Server-sent events: `log` lines while the LLM works, a `scene` event
 * with the compiled script prefix each time the next scene is validated,
 * then `done` (final script and stats) or `fail`. Earlier scenes keep their
 * times when later ones are appended, so the client extends playback in place.
 */
async function generateStream(server: ViteDevServer, url: URL, req: IncomingMessage, res: ServerResponse) {
  const llm = await server.ssrLoadModule("@anim/llm");
  const topic = url.searchParams.get("topic")?.trim() ?? "";
  const provider = url.searchParams.get("provider") ?? "auto";
  const model = url.searchParams.get("model")?.trim() || undefined;
  const tts = ttsOf(url);
  let mode = url.searchParams.get("mode") === "single" ? "single" : "outline";

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  let closed = false;
  req.on("close", () => (closed = true));
  const send = (event: string, data: unknown) => {
    if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let client;
    if (provider === "replay") {
      const file = basename(url.searchParams.get("example") ?? "photosynthesis.txt");
      client = new llm.ReplayClient(readFileSync(join(examples, file), "utf8"), { chunk: 16, delayMs: 60 });
      mode = "single"; // a replayed script is one complete reply
    } else {
      client = llm.clientFromEnv(provider === "auto" ? {} : { providers: [provider], ...(model && { model }) });
    }
    if (!topic && provider !== "replay") throw new Error("enter a topic");
    send("log", `generating with ${client.name} (${mode})`);

    // The style director gives each video a fresh look, remembering what this Studio user already saw.
    // Look/Motion picks in the Script tab act as locks.
    const { Director, StyleHistory } = await server.ssrLoadModule("@anim/director");
    const store = new StyleHistory(join(repo, ".cache", "style-history.json"));
    const director = url.searchParams.get("style") === "llm" ? undefined : new Director({ topic: topic || "replay", history: await store.get("studio"), lock: tts.style });
    const styleLine = () => {
      const c = director!.choice;
      return `style: ${c.theme} · ${c.motion} (mood: ${c.mood})`;
    };

    const scenes: string[] = [];
    let chain = Promise.resolve();
    const started = performance.now();
    const result = await llm.generate(topic || "replay", {
      client,
      mode,
      ...(director && { director }),
      onLog: (m: string) => send("log", m),
      onCall: (call: unknown) => send("call", call),
      onScene: (text: string, index: number, header: string) => {
        scenes[index] = text;
        if (index === 0 && director) send("log", styleLine());
        const script = `${header}\n\n${scenes.slice(0, index + 1).join("\n\n")}\n`;
        // Builds run one at a time, in scene order.
        chain = chain.then(async () => {
          if (closed) return;
          const built = await build(server, script, tts);
          send("scene", { index, script, ...built });
        });
      },
    });
    await chain;
    if (director && result.ok) await store.add("studio", director.entry());
    const traceFile = saveTrace(topic || "replay", client.name, mode, result);
    const built = await build(server, result.script, tts);
    send("done", {
      ...built,
      script: result.script,
      generated: result.ok,
      stats: { calls: result.calls, repairs: result.repairs, usage: result.usage, seconds: (performance.now() - started) / 1000, traceFile },
    });
  } catch (e) {
    send("fail", { error: e instanceof Error ? e.message : String(e) });
  }
  res.end();
}

/** Keeps every generation's call trace (prompts, replies, timings, tokens) in out/traces/ for later inspection. */
function saveTrace(topic: string, provider: string, mode: string, result: { trace: unknown[]; usage: unknown; ms: number; ok: boolean; script: string }): string {
  const dir = join(repo, "out", "traces");
  mkdirSync(dir, { recursive: true });
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "video";
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug}.json`);
  writeFileSync(file, JSON.stringify({ topic, provider, mode, ok: result.ok, ms: result.ms, usage: result.usage, calls: result.trace, script: result.script }, null, 2));
  return relative(repo, file).replace(/\\/g, "/");
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => ok(data));
    req.on("error", fail);
  });
}

function send(res: ServerResponse, type: string, data: string | Buffer): void {
  res.setHeader("content-type", type);
  res.end(data);
}

function json(res: ServerResponse, data: unknown): void {
  send(res, "application/json", JSON.stringify(data));
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias },
  plugins: [api()],
  server: { port: 5199 },
});
