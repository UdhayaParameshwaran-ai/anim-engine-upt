import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SceneIR, SceneSpeech, VideoIR, WordTiming } from "@anim/ir";
import { align } from "./align.js";
import { toSpoken, type SpokenText } from "./spoken.js";
import type { TtsProvider, TtsRequest } from "./provider.js";

/** Cached synthesis result: audio bytes plus normalized word timings. */
export interface CachedSpeech {
  audio: Uint8Array;
  format: "wav" | "mp3";
  duration: number;
  words: WordTiming[];
}

export interface SpeechCache {
  get(key: string): Promise<CachedSpeech | undefined>;
  set(key: string, value: CachedSpeech): Promise<void>;
  /** Where the audio for `key` lives, as referenced from the timeline. */
  path(key: string, format: string): string;
}

export class MemoryCache implements SpeechCache {
  private readonly map = new Map<string, CachedSpeech>();
  async get(key: string) {
    return this.map.get(key);
  }
  async set(key: string, value: CachedSpeech) {
    this.map.set(key, value);
  }
  path(key: string, format: string) {
    return `tts/${key}.${format}`;
  }
}

/** Content-addressed on-disk cache: `<dir>/<key>.<format>` + `<dir>/<key>.json`. */
export class FileCache implements SpeechCache {
  constructor(private readonly dir: string) {}

  async get(key: string): Promise<CachedSpeech | undefined> {
    try {
      const meta = JSON.parse(await readFile(join(this.dir, `${key}.json`), "utf8")) as Omit<CachedSpeech, "audio">;
      const audio = new Uint8Array(await readFile(join(this.dir, `${key}.${meta.format}`)));
      return { ...meta, audio };
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: CachedSpeech): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const { audio, ...meta } = value;
    await writeFile(join(this.dir, `${key}.${value.format}`), audio);
    await writeFile(join(this.dir, `${key}.json`), JSON.stringify(meta));
  }

  path(key: string, format: string): string {
    return join(this.dir, `${key}.${format}`).replace(/\\/g, "/");
  }
}

/**
 * Cache key: everything that can change the audio. `written` is the narration as written when `req.text` is how it is spoken
 * (the cached word timings are over the written one).
 */
export function speechKey(provider: TtsProvider, req: TtsRequest, written?: string): string {
  const settings = Object.fromEntries(Object.entries(req.settings ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify([provider.id, req.voice, req.lang, settings, req.text, ...(written === undefined ? [] : [written])])).digest("hex").slice(0, 32);
}

/** The voice's word timings (over the spoken text) as timings of the written words: a written word takes the span of the words it became. */
function toWritten(written: string, spoken: SpokenText, timed: WordTiming[]): WordTiming[] {
  let prevEnd = 0;
  return spoken.words.map((w) => {
    const covered = timed.filter((x) => x.start >= w.sStart && x.end <= w.sEnd);
    const t0 = covered.length ? covered[0]!.t0 : prevEnd;
    const t1 = covered.length ? covered[covered.length - 1]!.t1 : prevEnd;
    prevEnd = t1;
    return { text: written.slice(w.start, w.end), start: w.start, end: w.end, t0, t1, precision: covered.length ? covered[0]!.precision : ("interpolated" as const) };
  });
}

/**
 * The text TTS speaks for a scene: speech beats joined by single spaces,
 * plus each beat's char range so cue offsets can be mapped back.
 */
export function sceneText(scene: SceneIR): { text: string; beats: { start: number; end: number }[] } {
  let text = "";
  const beats: { start: number; end: number }[] = [];
  for (const step of scene.steps) {
    for (const beat of step.beats) {
      if (beat.type !== "speech") continue;
      if (text) text += " ";
      beats.push({ start: text.length, end: text.length + beat.text.length });
      text += beat.text;
    }
  }
  return { text, beats };
}

export interface SpeakOptions {
  provider: TtsProvider;
  cache?: SpeechCache;
  settings?: TtsRequest["settings"];
}

/**
 * Synthesizes one scene (one TTS request per scene keeps prosody natural
 * across sentences), normalizes timings to words, and caches the result.
 */
export async function speakScene(scene: SceneIR, video: Pick<VideoIR, "voice" | "lang">, opts: SpeakOptions): Promise<SceneSpeech> {
  const cache = opts.cache ?? new MemoryCache();
  const { text, beats } = sceneText(scene);
  // The voice is given what a person would say (numbers, ids and addresses in words); the captions and the cues keep what is written.
  const spoken = toSpoken(text, video.lang);
  const changed = spoken.text !== text;
  const req: TtsRequest = { text: spoken.text, voice: video.voice, lang: video.lang, ...(opts.settings && { settings: opts.settings }) };
  const key = speechKey(opts.provider, req, changed ? text : undefined);

  let cached = await cache.get(key);
  if (!cached) {
    if (spoken.text.length > opts.provider.capabilities.maxChars) {
      throw new Error(`scene ${scene.id}: ${spoken.text.length} chars exceeds ${opts.provider.id} limit of ${opts.provider.capabilities.maxChars}`);
    }
    // A scene already being spoken (an earlier build of the same script) is shared, not spoken twice.
    let pending = inFlight.get(key);
    if (!pending) {
      pending = (async () => {
        const result = spoken.text ? await opts.provider.synthesize(req) : { audio: new Uint8Array(), format: "wav" as const, duration: 0 };
        const speech: CachedSpeech = {
          audio: result.audio,
          format: result.format,
          duration: result.duration,
          words: changed ? toWritten(text, spoken, align(spoken.text, result.duration, "timings" in result ? result.timings : undefined)) : align(text, result.duration, "timings" in result ? result.timings : undefined),
        };
        await cache.set(key, speech);
        return speech;
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    cached = await pending;
    // Shared with a caller that had another cache: store it in this one too.
    if (!(await cache.get(key))) await cache.set(key, cached);
  }
  return { scene: scene.id, src: cache.path(key, cached.format), duration: cached.duration, text, words: cached.words, beats };
}

/** Syntheses under way, by speech key (shared by overlapping builds in one process). */
const inFlight = new Map<string, Promise<CachedSpeech>>();

/** Synthesizes every scene of a video, in parallel. */
export function speakVideo(video: VideoIR, opts: SpeakOptions): Promise<SceneSpeech[]> {
  return Promise.all(video.scenes.map((s) => speakScene(s, video, opts)));
}
