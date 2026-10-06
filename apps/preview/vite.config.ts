import { readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const packages = join(repo, "packages");
const examples = join(repo, "examples");
const ttsDir = join(repo, ".cache", "tts");

// Resolve @anim/* to package sources (client and server) so no build step is needed.
const alias = Object.fromEntries(readdirSync(packages).map((name) => [`@anim/${name}`, join(packages, name, "src", "index.ts")]));

/**
 * Dev API: compiles DSL in Node (parse → validate → layout → mock TTS →
 * resolve) and serves the synthesized narration.
 */
function api(): Plugin {
  return {
    name: "anim-preview-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        try {
          if (url.pathname === "/api/examples") return json(res, readdirSync(examples).filter((f) => f.endsWith(".txt")));
          if (url.pathname === "/api/source") return send(res, "text/plain; charset=utf-8", readFileSync(join(examples, basename(url.searchParams.get("file") ?? "")), "utf8"));
          if (url.pathname === "/api/build" && req.method === "POST") return json(res, await build(server, await body(req), Number(url.searchParams.get("speed") ?? 1)));
          if (url.pathname.startsWith("/audio/")) return send(res, "audio/wav", readFileSync(join(ttsDir, basename(url.pathname))));
        } catch (e) {
          res.statusCode = 500;
          return json(res, { error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
        }
        next();
      });
    },
  };
}

async function build(server: ViteDevServer, source: string, speed: number) {
  const { compile, report } = await server.ssrLoadModule("@anim/compiler");
  const { FileCache, MockTtsProvider, speakVideo } = await server.ssrLoadModule("@anim/tts");
  const { resolve } = await server.ssrLoadModule("@anim/timeline");
  const compiled = compile(source);
  const diagnostics: string[] = compiled.diagnostics.length ? report(compiled.diagnostics).split("\n") : [];
  if (!compiled.ir) return { ok: false, diagnostics };
  const speech = await speakVideo(compiled.ir, { provider: new MockTtsProvider({ audio: "beeps", speed }), cache: new FileCache(ttsDir) });
  const timeline = resolve(compiled.ir, speech);
  timeline.audio = timeline.audio.map((a: { src: string }) => ({ ...a, src: `/audio/${basename(a.src)}` }));
  return { ok: true, diagnostics, ir: compiled.ir, timeline };
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
