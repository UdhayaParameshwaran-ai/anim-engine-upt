import { parentPort, workerData } from "node:worker_threads";
import type { TtsRequest, TtsResult } from "@anim/tts";
import { KokoroTtsProvider, type KokoroOptions } from "./index.js";

/**
 * The thread Kokoro runs on for `ThreadedKokoroProvider` (see threaded.ts). The model call holds its thread for
 * seconds at a time, so it gets one of its own; the server's thread keeps answering requests meanwhile.
 */
export type WorkerRequest = { id: number; op: "warmup" } | { id: number; op: "synthesize"; req: TtsRequest };
export type WorkerReply = { id: number; ok: true; result?: TtsResult } | { id: number; ok: false; error: string };

const port = parentPort;
if (port) {
  const provider = new KokoroTtsProvider(workerData as KokoroOptions);
  port.on("message", async (m: WorkerRequest) => {
    try {
      if (m.op === "warmup") {
        await provider.warmup();
        port.postMessage({ id: m.id, ok: true } satisfies WorkerReply);
        return;
      }
      const result = await provider.synthesize(m.req);
      // The audio moves to the other thread instead of being copied.
      const buffer = result.audio.buffer.slice(result.audio.byteOffset, result.audio.byteOffset + result.audio.byteLength) as ArrayBuffer;
      port.postMessage({ id: m.id, ok: true, result: { ...result, audio: new Uint8Array(buffer) } } satisfies WorkerReply, [buffer]);
    } catch (e) {
      port.postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) } satisfies WorkerReply);
    }
  });
}
