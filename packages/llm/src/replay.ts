import type { ChatRequest, ChatResult, LlmClient } from "./client.js";

export interface ReplayOptions {
  /** Characters per streamed chunk. */
  chunk?: number;
  /** Delay between chunks, in ms (simulates generation speed). */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * An offline stand-in for an LLM: answers every request with a fixed
 * script, streamed in chunks. Used with `mode: "single"` to exercise the
 * whole generation → progressive playback path without API keys.
 */
export class ReplayClient implements LlmClient {
  readonly name = "replay";
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly script: string,
    private readonly opts: ReplayOptions = {},
  ) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  }

  async chat(_req: ChatRequest): Promise<ChatResult> {
    return { text: this.script, provider: "replay", model: "replay" };
  }

  async stream(_req: ChatRequest, onDelta: (text: string) => void): Promise<ChatResult> {
    const size = this.opts.chunk ?? 24;
    for (let i = 0; i < this.script.length; i += size) {
      if (i && this.opts.delayMs) await this.sleep(this.opts.delayMs);
      onDelta(this.script.slice(i, i + size));
    }
    return this.chat(_req);
  }
}
