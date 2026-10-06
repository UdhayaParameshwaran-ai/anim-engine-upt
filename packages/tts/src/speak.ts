import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SceneIR, SceneSpeech, VideoIR, WordTiming } from "@anim/ir";
import { align } from "./align.js";
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

/** Cache key: everything that can change the audio. */
export function speechKey(provider: TtsProvider, req: TtsRequest): string {
  const settings = Object.fromEntries(Object.entries(req.settings ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify([provider.id, req.voice, req.lang, settings, req.text])).digest("hex").slice(0, 32);
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
  const req: TtsRequest = { text, voice: video.voice, lang: video.lang, ...(opts.settings && { settings: opts.settings }) };
  const key = speechKey(opts.provider, req);

  let cached = await cache.get(key);
  if (!cached) {
    if (text.length > opts.provider.capabilities.maxChars) {
      throw new Error(`scene ${scene.id}: ${text.length} chars exceeds ${opts.provider.id} limit of ${opts.provider.capabilities.maxChars}`);
    }
    const result = text ? await opts.provider.synthesize(req) : { audio: new Uint8Array(), format: "wav" as const, duration: 0 };
    cached = {
      audio: result.audio,
      format: result.format,
      duration: result.duration,
      words: align(text, result.duration, "timings" in result ? result.timings : undefined),
    };
    await cache.set(key, cached);
  }
  return { scene: scene.id, src: cache.path(key, cached.format), duration: cached.duration, text, words: cached.words, beats };
}

/** Synthesizes every scene of a video, in parallel. */
export function speakVideo(video: VideoIR, opts: SpeakOptions): Promise<SceneSpeech[]> {
  return Promise.all(video.scenes.map((s) => speakScene(s, video, opts)));
}
