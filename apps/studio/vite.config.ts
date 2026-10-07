import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";
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
        try {
          if (url.pathname === "/api/examples") return json(res, readdirSync(examples).filter((f) => f.endsWith(".txt")));
          if (url.pathname === "/api/source") return send(res, "text/plain; charset=utf-8", readFileSync(join(examples, basename(url.searchParams.get("file") ?? "")), "utf8"));
          if (url.pathname === "/api/build" && req.method === "POST") return json(res, await build(server, await body(req), ttsOf(url)));
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
type Tts = { name: "kokoro" | "beeps"; speed: number; style: Record<string, string> };

/** Narration voice: "kokoro" (local neural TTS) or "beeps" (instant mock that ticks on every word). */
function defaultTts(): Tts["name"] {
  return process.env.ANIM_TTS === "beeps" ? "beeps" : "kokoro";
}

function ttsOf(url: URL): Tts {
  const name = url.searchParams.get("tts");
  const style: Record<string, string> = {};
  for (const key of ["theme", "motion"]) {
    const v = url.searchParams.get(key);
    if (v) style[key] = v;
  }
  return { name: name === "beeps" || name === "kokoro" ? name : defaultTts(), speed: Number(url.searchParams.get("speed") ?? 1) || 1, style };
}

// One Kokoro instance for the server's lifetime: the model stays loaded.
let kokoro: Promise<unknown> | undefined;
async function voice(server: ViteDevServer, name: Tts["name"], speed = 1) {
  if (name === "beeps") {
    const { MockTtsProvider } = await server.ssrLoadModule("@anim/tts");
    return new MockTtsProvider({ audio: "beeps", speed });
  }
  kokoro ??= server.ssrLoadModule("@anim/tts-kokoro").then(async ({ KokoroTtsProvider }) => {
    const p = new KokoroTtsProvider({ cacheDir: join(repo, ".cache", "models") });
    await p.warmup();
    return p;
  });
  kokoro.catch(() => (kokoro = undefined));
  return kokoro;
}

async function build(server: ViteDevServer, source: string, tts: Tts) {
  const { compile, report } = await server.ssrLoadModule("@anim/compiler");
  const { FileCache, speakVideo } = await server.ssrLoadModule("@anim/tts");
  const { resolve } = await server.ssrLoadModule("@anim/timeline");
  const compiled = compile(source, { settings: tts.style });
  const diagnostics: string[] = compiled.diagnostics.length ? report(compiled.diagnostics).split("\n") : [];
  if (!compiled.ir) return { ok: false, diagnostics };
  const provider = await voice(server, tts.name, tts.speed);
  // Kokoro's rate is a request setting (part of the cache key); the mock bakes it into its id.
  const settings = tts.name === "kokoro" && tts.speed !== 1 ? { speed: tts.speed } : undefined;
  const speech = await speakVideo(compiled.ir, { provider, cache: new FileCache(ttsDir), ...(settings && { settings }) });
  const timeline = resolve(compiled.ir, speech);
  timeline.audio = timeline.audio.map((a: { src: string }) => ({ ...a, src: `/audio/${basename(a.src)}` }));
  return { ok: true, diagnostics, ir: compiled.ir, timeline };
}

async function providers(server: ViteDevServer) {
  const { THEMES, THEME_SUMMARIES, MOTIONS } = await server.ssrLoadModule("@anim/registry");
  return {
    themes: THEMES.map((name: keyof typeof THEME_SUMMARIES) => ({ name, summary: THEME_SUMMARIES[name] })),
    motions: MOTIONS.map((m: { name: string; summary: string }) => ({ name: m.name, summary: m.summary })),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
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
      client = llm.clientFromEnv(provider === "auto" ? {} : { providers: [provider] });
    }
    if (!topic && provider !== "replay") throw new Error("enter a topic");
    send("log", `generating with ${client.name} (${mode})`);

    const scenes: string[] = [];
    let chain = Promise.resolve();
    const started = performance.now();
    const result = await llm.generate(topic || "replay", {
      client,
      mode,
      onLog: (m: string) => send("log", m),
      onScene: (text: string, index: number, header: string) => {
        scenes[index] = text;
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
    const built = await build(server, result.script, tts);
    send("done", {
      ...built,
      script: result.script,
      generated: result.ok,
      stats: { calls: result.calls, repairs: result.repairs, usage: result.usage, seconds: (performance.now() - started) / 1000 },
    });
  } catch (e) {
    send("fail", { error: e instanceof Error ? e.message : String(e) });
  }
  res.end();
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
