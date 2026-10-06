/**
 * Provider-neutral TTS interface. Adapters (ElevenLabs, Azure, Google,
 * Polly, ...) translate their own timing formats into `ProviderTimings`;
 * the aligner turns any granularity into word timings.
 */

export type TimingUnit = "char" | "word" | "sentence";

export interface TtsCapabilities {
  /** Finest timing the provider returns, or "none". */
  timing: TimingUnit | "none";
  ssml: boolean;
  maxChars: number;
}

export interface TtsRequest {
  text: string;
  voice: string;
  lang: string;
  /** Provider-specific knobs (model, speed, stability, ...); part of the cache key. */
  settings?: Record<string, string | number | boolean>;
}

/** One timed span of the request text. `start`/`end` are char offsets into it. */
export interface TimedSpan {
  start: number;
  end: number;
  t0: number;
  t1: number;
}

export interface ProviderTimings {
  unit: TimingUnit;
  items: TimedSpan[];
}

export interface TtsResult {
  audio: Uint8Array;
  format: "wav" | "mp3";
  sampleRate: number;
  /** Seconds. */
  duration: number;
  timings?: ProviderTimings;
}

export interface TtsProvider {
  /** Stable id; part of the cache key. */
  readonly id: string;
  readonly capabilities: TtsCapabilities;
  synthesize(req: TtsRequest): Promise<TtsResult>;
}
