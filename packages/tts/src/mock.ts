import type { ProviderTimings, TimingUnit, TtsCapabilities, TtsProvider, TtsRequest, TtsResult } from "./provider.js";
import { wav } from "./wav.js";

export interface MockOptions {
  /** Seconds per letter at speed 1. */
  charDuration?: number;
  /** Speaking rate multiplier; 1.2 is 20% faster. Lets tests change narration length. */
  speed?: number;
  /** Granularity of returned timings, to exercise the aligner. */
  timing?: TimingUnit | "none";
  /** Emit real (silent) WAV data. Off in tests that don't need it. */
  audio?: boolean;
}

/**
 * Deterministic TTS stand-in: duration comes from characters and
 * punctuation pauses, so timelines are reproducible in tests and offline
 * development. The same text always yields the same timings.
 */
export class MockTtsProvider implements TtsProvider {
  readonly id: string;
  readonly capabilities: TtsCapabilities;
  private readonly charDuration: number;
  private readonly speed: number;
  private readonly timing: TimingUnit | "none";
  private readonly audio: boolean;

  constructor(opts: MockOptions = {}) {
    this.charDuration = opts.charDuration ?? 0.06;
    this.speed = opts.speed ?? 1;
    this.timing = opts.timing ?? "char";
    this.audio = opts.audio ?? true;
    this.id = `mock:${this.charDuration}:${this.speed}:${this.timing}`;
    this.capabilities = { timing: this.timing, ssml: false, maxChars: 100_000 };
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const chars: { start: number; end: number; t0: number; t1: number }[] = [];
    const unit = this.charDuration / this.speed;
    let t = 0.05;
    for (let i = 0; i < req.text.length; i++) {
      const c = req.text[i]!;
      const d = /\s/.test(c) ? unit * 0.5 : unit;
      chars.push({ start: i, end: i + 1, t0: round(t), t1: round(t + d) });
      t += d;
      if (/[,;:]/.test(c)) t += 0.18 / this.speed;
      else if (/[.!?]/.test(c)) t += 0.35 / this.speed;
    }
    const duration = round(t + 0.05);
    const result: TtsResult = {
      audio: this.audio ? wav(duration) : new Uint8Array(),
      format: "wav",
      sampleRate: 16000,
      duration,
    };
    const timings = this.timings(req.text, chars);
    if (timings) result.timings = timings;
    return result;
  }

  private timings(text: string, chars: { start: number; end: number; t0: number; t1: number }[]): ProviderTimings | undefined {
    if (this.timing === "none") return undefined;
    if (this.timing === "char") return { unit: "char", items: chars };
    const re = this.timing === "word" ? /\S+/g : /[^.!?]+[.!?]*/g;
    const items = [...text.matchAll(re)]
      .map((m) => {
        let s = m.index!;
        let e = s + m[0].length;
        while (s < e && /\s/.test(text[s]!)) s++;
        while (e > s && /\s/.test(text[e - 1]!)) e--;
        return { start: s, end: e };
      })
      .filter((r) => r.end > r.start)
      .map((r) => ({ ...r, t0: chars[r.start]!.t0, t1: chars[r.end - 1]!.t1 }));
    return { unit: this.timing, items };
  }
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
