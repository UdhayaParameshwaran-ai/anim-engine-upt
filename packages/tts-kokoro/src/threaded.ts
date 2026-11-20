import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { TtsCapabilities, TtsProvider, TtsRequest, TtsResult } from "@anim/tts";
import { KokoroTtsProvider, type KokoroOptions } from "./index.js";
import type { WorkerReply, WorkerRequest } from "./worker.js";

/**
 * Kokoro on a thread of its own. The model call runs on the thread that makes it and holds it for seconds
 * (one stretch measured 10 s, 86% of a synthesis), so inside the server it froze every other request. Here the
 * server's thread only passes the text over and waits for the audio.
 *
 * It needs the built worker (`pnpm build`, which writes dist/worker.js). Without it, or when the sources are newer
 * than the build (a build that would run old code), it speaks in the server's own thread, as KokoroTtsProvider does.
 */
export class ThreadedKokoroProvider implements TtsProvider {
  readonly id: string;
  readonly capabilities: TtsCapabilities;
  /** True when speech runs on a thread of its own; false when it fell back to the calling thread. */
  readonly threaded: boolean;
  private readonly local: KokoroTtsProvider;
  private worker?: Worker;
  private readonly file: string | undefined;
  private next = 0;
  private readonly pending = new Map<number, { ok: (r: WorkerReply) => void; fail: (e: Error) => void }>();

  constructor(private readonly opts: KokoroOptions = {}) {
    this.local = new KokoroTtsProvider(opts);
    this.id = this.local.id;
    this.capabilities = this.local.capabilities;
    this.file = builtWorker();
    this.threaded = this.file !== undefined;
  }

  warmup(): Promise<void> {
    return this.file ? this.call({ op: "warmup" }).then(() => undefined) : this.local.warmup();
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    if (!this.file) return this.local.synthesize(req);
    const reply = await this.call({ op: "synthesize", req });
    if (!reply.ok || !reply.result) throw new Error(reply.ok ? "the voice returned nothing" : reply.error);
    return reply.result;
  }

  /** Ends the thread (it starts again on the next request). */
  async close(): Promise<void> {
    await this.worker?.terminate();
    this.worker = undefined;
  }

  private call(m: { op: "warmup" } | { op: "synthesize"; req: TtsRequest }): Promise<WorkerReply> {
    const worker = (this.worker ??= this.start());
    const id = this.next++;
    return new Promise((ok, fail) => {
      this.pending.set(id, { ok, fail });
      worker.postMessage({ ...m, id } as WorkerRequest);
    });
  }

  private start(): Worker {
    const worker = new Worker(this.file!, { workerData: this.opts });
    // The thread must not keep the process alive on its own.
    worker.unref();
    worker.on("message", (r: WorkerReply) => {
      this.pending.get(r.id)?.ok(r);
      this.pending.delete(r.id);
    });
    const lost = (e: Error) => {
      if (this.worker === worker) this.worker = undefined;
      for (const p of this.pending.values()) p.fail(e);
      this.pending.clear();
    };
    worker.on("error", lost);
    worker.on("exit", (code) => lost(new Error(`the voice thread stopped (exit ${code})`)));
    return worker;
  }
}

let warned = false;

/** The built worker next to this file (running from dist) or in ../dist (running from the sources), unless it is older than the sources. */
function builtWorker(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const fromDist = join(here, "worker.js");
  if (existsSync(fromDist)) return fromDist;
  const dist = join(here, "..", "dist");
  const built = join(dist, "worker.js");
  if (!existsSync(built)) return warn("not built (run pnpm build)");
  // Each source file against its own build output (an incremental build only rewrites what changed).
  const stale = readdirSync(here)
    .filter((f) => f.endsWith(".ts"))
    .some((f) => {
      const out = join(dist, f.replace(/\.ts$/, ".js"));
      return !existsSync(out) || statSync(join(here, f)).mtimeMs > statSync(out).mtimeMs;
    });
  return stale ? warn("older than the sources (run pnpm build)") : built;
}

function warn(why: string): undefined {
  if (!warned) {
    warned = true;
    console.warn(`kokoro: speaking on the server's own thread, the voice worker is ${why}`);
  }
  return undefined;
}
