import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
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
      // With ANIM_PASSWORD set (the hosted Studio), everything sits behind a login page.
      if (process.env.ANIM_PASSWORD) server.middlewares.use(passwordGate(process.env.ANIM_PASSWORD));
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        // The layout gallery is its own page.
        if (url.pathname === "/gallery" || url.pathname === "/gallery/") req.url = "/gallery.html" + url.search;
        try {
          if (url.pathname === "/api/examples") return json(res, readdirSync(examples).filter((f) => f.endsWith(".txt")));
          if (url.pathname === "/api/source") return send(res, "text/plain; charset=utf-8", readFileSync(join(examples, basename(url.searchParams.get("file") ?? "")), "utf8"));
          if (url.pathname === "/api/build" && req.method === "POST") return json(res, await build(server, await body(req), ttsOf(url), url.searchParams.get("variants") === "exact" ? "exact" : "fit"));
          if (url.pathname === "/api/settings" && req.method === "POST") return json(res, stashSettings(await body(req)));
          if (url.pathname === "/api/prompt-defaults") return json(res, await promptDefaults(server));
          if (url.pathname === "/api/keys" && req.method === "POST") return json(res, saveKeys(await body(req)));
          if (url.pathname === "/api/keys") return json(res, keyHints());
          if (url.pathname === "/api/providers") return json(res, await providers(server));
          if (url.pathname === "/api/history") return json(res, historyApi(req.method ?? "GET", url.searchParams.get("id")));
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

/** Narration voice: "piper" (local, ~4x faster, the default), "kokoro" (local neural TTS, best quality) or "beeps" (instant mock that ticks on every word). */
function defaultTts(): Tts["name"] {
  const v = process.env.ANIM_TTS;
  return v === "beeps" || v === "kokoro" ? v : "piper";
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
  kokoro ??= server.ssrLoadModule("@anim/tts-kokoro").then(async ({ ThreadedKokoroProvider }) => {
    // On a thread of its own: the model call would otherwise freeze every other request for seconds at a time.
    const p = new ThreadedKokoroProvider({ cacheDir: join(repo, ".cache", "models") });
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

/**
 * Prompt settings can hold whole prompts, too long for a URL: the page posts them first and the
 * generate request names them by id. Kept for an hour.
 */
const stash = new Map<string, { settings: unknown; at: number }>();
function stashSettings(raw: string): { id: string } {
  const now = Date.now();
  for (const [k, v] of stash) if (now - v.at > 3_600_000) stash.delete(k);
  const id = Math.random().toString(36).slice(2, 10);
  let settings: unknown = {};
  try {
    settings = JSON.parse(raw);
  } catch {
    /* an unreadable body is the defaults */
  }
  stash.set(id, { settings, at: now });
  return { id };
}

/** What each prompt setting is when the person leaves it alone, for the Studio's settings panel. */
async function promptDefaults(server: ViteDevServer) {
  const llm = await server.ssrLoadModule("@anim/llm");
  const { TEMPLATES } = await server.ssrLoadModule("@anim/registry");
  const { AssetLibrary } = await server.ssrLoadModule("@anim/registry");
  const prompts = llm.defaultPrompts(new AssetLibrary().all());
  const playbooks = Object.fromEntries(llm.USE_CASES.map((u: { name: string; scene: string }) => [u.name, u.scene]));
  return { ...llm.settingsDefaults(llm.STORY_HINTS), playbooks, prompts, promptInfo: llm.PROMPT_INFO, slotInfo: llm.SLOT_INFO, templates: [...TEMPLATES.map((t: { name: string }) => t.name), "grid"] };
}

async function providers(server: ViteDevServer) {
  const { THEMES, THEME_SUMMARIES, MOTIONS } = await server.ssrLoadModule("@anim/registry");
  const { configuredProviders, modelChoices } = await server.ssrLoadModule("@anim/llm");
  const llm: Record<string, boolean> = configuredProviders(process.env);
  // Model menus for the providers that offer a choice (and are set up).
  const models: Record<string, unknown> = {};
  for (const p of ["gemini", "claude"]) if (llm[p]) models[p] = await modelChoices(p, process.env);
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
  const domain = url.searchParams.get("domain") === "tech" ? "tech" : undefined;
  let settings: unknown = {};
  try {
    settings = llm.sanitizeSettings(stash.get(url.searchParams.get("settingsId") ?? "")?.settings ?? {});
  } catch {
    settings = {};
  }
  const length = llm.isLength(url.searchParams.get("length")) ? url.searchParams.get("length") : undefined;
  const tts = ttsOf(url);
  // "canvas": planned like an outline, written as one growing diagram.
  // "auto": a short call decides between one diagram and several scenes.
  const canvas: boolean | "auto" = url.searchParams.get("mode") === "auto" ? "auto" : url.searchParams.get("mode") === "canvas";
  // Every scene is written by its own call; "single" is only how a replayed script is played back.
  let mode = "outline";

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

    // The model chooses look and motion; the director arranges scenes and fills in what the model left out.
    // Look/Motion picks in the Script tab act as locks.
    const { Director, StyleHistory } = await server.ssrLoadModule("@anim/director");
    const store = new StyleHistory(join(repo, ".cache", "style-history.json"));
    const director = new Director({ topic: topic || "replay", history: await store.get("studio"), lock: tts.style, respectScript: "always" });
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
      ...(domain && { domain }),
      ...(length && { length }),
      settings,
      ...(canvas && { canvas }),
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
    const traceFile = saveTrace(topic || "replay", client.name, mode, result, settings);
    if (provider !== "replay" && result.script.trim()) {
      saveHistory({ topic, provider: client.name, ...(length && { length }), ok: result.ok, seconds: (performance.now() - started) / 1000 }, result.script);
    }
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

/**
 * History of generated scripts, so a person can come back later, copy one and build it. One JSON file per
 * generation in .cache/history/, newest 200 kept. Shared by everyone who uses this Studio.
 */
const historyDir = join(repo, ".cache", "history");
const HISTORY_KEEP = 200;
interface HistoryMeta {
  id: string;
  at: string;
  topic: string;
  provider: string;
  length?: string;
  ok: boolean;
  seconds: number;
  scenes: number;
}
const historyId = (id: string | null): string | undefined => (id && /^[a-z0-9-]{8,80}$/.test(id) ? id : undefined);

function saveHistory(meta: Omit<HistoryMeta, "id" | "at" | "scenes">, script: string): void {
  mkdirSync(historyDir, { recursive: true });
  const at = new Date().toISOString();
  const id = `${at.replace(/[^0-9]/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: HistoryMeta & { script: string } = { id, at, ...meta, scenes: (script.match(/^scene\s/gm) ?? []).length, script };
  writeFileSync(join(historyDir, `${id}.json`), JSON.stringify(entry, null, 2));
  for (const old of readdirSync(historyDir).filter((f) => f.endsWith(".json")).sort().reverse().slice(HISTORY_KEEP)) rmSync(join(historyDir, old), { force: true });
}

/** The first time history is opened, scripts from earlier generations (the saved call traces) are brought in. */
function backfillHistory(): void {
  const traces = join(repo, "out", "traces");
  if (!existsSync(traces)) return;
  mkdirSync(historyDir, { recursive: true });
  for (const f of readdirSync(traces).filter((f) => f.endsWith(".json")).sort().slice(-HISTORY_KEEP)) {
    try {
      const t = JSON.parse(readFileSync(join(traces, f), "utf8")) as { topic?: string; provider?: string; ok?: boolean; ms?: number; script?: string };
      if (!t.script?.trim() || t.topic === "replay") continue;
      const m = /^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d+)Z/.exec(f);
      const at = m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : new Date().toISOString();
      const id = `${at.replace(/[^0-9]/g, "")}-${f.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(-6) || "trace"}`;
      const entry = { id, at, topic: t.topic ?? "", provider: t.provider ?? "", ok: Boolean(t.ok), seconds: (t.ms ?? 0) / 1000, scenes: (t.script.match(/^scene\s/gm) ?? []).length, script: t.script };
      writeFileSync(join(historyDir, `${id}.json`), JSON.stringify(entry, null, 2));
    } catch {
      /* an unreadable trace is skipped */
    }
  }
}

function historyApi(method: string, rawId: string | null): unknown {
  const id = historyId(rawId);
  if (rawId && !id) throw new Error("bad history id");
  if (id && method === "DELETE") {
    rmSync(join(historyDir, `${id}.json`), { force: true });
    return { ok: true };
  }
  if (id) return JSON.parse(readFileSync(join(historyDir, `${id}.json`), "utf8"));
  if (!existsSync(historyDir)) backfillHistory();
  if (!existsSync(historyDir)) return [];
  const list: HistoryMeta[] = [];
  for (const f of readdirSync(historyDir).filter((f) => f.endsWith(".json")).sort().reverse()) {
    try {
      const { script: _script, ...meta } = JSON.parse(readFileSync(join(historyDir, f), "utf8"));
      list.push(meta);
    } catch {
      /* an unreadable file is skipped */
    }
  }
  return list;
}

/** Keeps every generation's call trace (prompts, replies, timings, tokens) in out/traces/ for later inspection. */
function saveTrace(topic: string, provider: string, mode: string, result: { trace: unknown[]; usage: unknown; ms: number; ok: boolean; script: string }, settings: unknown = {}): string {
  const dir = join(repo, "out", "traces");
  mkdirSync(dir, { recursive: true });
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "video";
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug}.json`);
  writeFileSync(file, JSON.stringify({ topic, provider, mode, settings, ok: result.ok, ms: result.ms, usage: result.usage, calls: result.trace, script: result.script }, null, 2));
  return relative(repo, file).replace(/\\/g, "/");
}

const LOGIN_PAGE = (error: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;background:Canvas;color:CanvasText}
form{display:grid;gap:12px;width:min(320px,calc(100vw - 32px))}h1{font-size:18px;margin:0}input,button{font:inherit;height:40px;padding:0 12px;border-radius:8px;border:1px solid #8886}
button{background:CanvasText;color:Canvas;border:0;cursor:pointer}p{margin:0;color:#b91c1c;font-size:13px;min-height:1em}</style></head>
<body><form method="post" action="/login"><h1>Animation Studio</h1><input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required><button>Sign in</button><p role="alert">${error}</p></form></body></html>`;

/** Password login: a signed HttpOnly cookie, a few attempts per minute per address. */
function passwordGate(password: string) {
  const token = createHmac("sha256", password).update("anim-studio-session").digest("hex");
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const attempts = new Map<string, { n: number; since: number }>();
  const page = (res: ServerResponse, status: number, error = "") => {
    res.statusCode = status;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(LOGIN_PAGE(error));
  };
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? "/").split("?")[0];
    const cookie = /(?:^|;\s*)anim_session=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "";
    if (same(cookie, token)) return next();
    if (path === "/login" && req.method === "POST") {
      const ip = String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "");
      const now = Date.now();
      const t = attempts.get(ip);
      const rec = t && now - t.since < 60_000 ? t : { n: 0, since: now };
      if (rec.n >= 5) return page(res, 429, "Too many attempts. Wait a minute.");
      const given = new URLSearchParams(await body(req)).get("password") ?? "";
      if (!same(createHmac("sha256", given).update("anim-studio-session").digest("hex"), token)) {
        attempts.set(ip, { n: rec.n + 1, since: rec.since });
        return page(res, 401, "Wrong password.");
      }
      attempts.delete(ip);
      res.setHeader("set-cookie", `anim_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 14}`);
      res.statusCode = 303;
      res.setHeader("location", "/");
      return void res.end();
    }
    if (path.startsWith("/api/") || path.startsWith("/audio/")) {
      res.statusCode = 401;
      return void res.end("Sign in first.");
    }
    return page(res, 401);
  };
}

/** The API keys the Settings sheet may set; nothing else can be written to .env through it. */
const KEY_VARS = ["OPENROUTER_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"];

/** Which keys are set, as the last four characters only. */
function keyHints(): Record<string, string> {
  return Object.fromEntries(KEY_VARS.map((k) => [k, process.env[k] ? `…${process.env[k]!.slice(-4)}` : ""]));
}

/** Saves the given keys to .env and the running process; an empty value removes that key. */
function saveKeys(raw: string): Record<string, string> {
  const given = JSON.parse(raw) as Record<string, unknown>;
  const file = join(repo, ".env");
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  for (const name of KEY_VARS) {
    const v = given[name];
    if (typeof v !== "string") continue;
    const value = v.trim();
    if (/[\r\n"'#\s]/.test(value)) throw new Error(`${name} has characters a key never contains`);
    const at = lines.findIndex((l) => l.startsWith(`${name}=`));
    if (value) {
      process.env[name] = value;
      if (at >= 0) lines[at] = `${name}=${value}`;
      else lines.push(`${name}=${value}`);
    } else {
      delete process.env[name];
      if (at >= 0) lines[at] = `${name}=`;
    }
  }
  writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"));
  return keyHints();
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
  // Local only: the tunnel (cloudflared) is the one way in from outside.
  // ANIM_HMR=off (the hosted instance): no file watching and no live-reload socket. Otherwise a file change, a
  // git pull or a dropped tunnel connection makes every open page reload itself in the middle of a video.
  server: { port: 5199, host: "127.0.0.1", allowedHosts: ["animation.tandemloop.tech"], ...(process.env.ANIM_HMR === "off" && { hmr: false, watch: null }) },
});
