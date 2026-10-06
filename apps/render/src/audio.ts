import { readFile, writeFile } from "node:fs/promises";
import type { AudioClip } from "@anim/ir";
import { wav } from "@anim/tts";
import { ffmpeg } from "./ffmpeg.js";

export interface Pcm {
  rate: number;
  /** Mono samples. */
  samples: Int16Array;
}

/** Parses a 16-bit PCM WAV (any chunk order), downmixing stereo to mono. */
export function parseWav(data: Uint8Array): Pcm {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = (o: number) => String.fromCharCode(data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let rate = 0;
  let channels = 1;
  let bits = 16;
  for (let o = 12; o + 8 <= data.length; ) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      if (v.getUint16(o + 8, true) !== 1) throw new Error("only PCM WAV is supported");
      channels = v.getUint16(o + 10, true);
      rate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    } else if (id === "data") {
      if (bits !== 16) throw new Error(`only 16-bit WAV is supported (got ${bits})`);
      const n = Math.floor(size / 2 / channels);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += v.getInt16(o + 8 + (i * channels + c) * 2, true);
        samples[i] = Math.round(sum / channels);
      }
      return { rate, samples };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}

/** Loads any clip source as PCM; non-WAV sources (mp3 from real providers) are decoded with ffmpeg. */
async function load(src: string, rate: number | undefined, tmp: (name: string) => string): Promise<Pcm> {
  if (/\.wav$/i.test(src)) return parseWav(new Uint8Array(await readFile(src)));
  const out = tmp(`decoded-${Buffer.from(src).toString("base64url").slice(-40)}.wav`);
  await ffmpeg(["-i", src, "-ac", "1", ...(rate ? ["-ar", String(rate)] : []), "-c:a", "pcm_s16le", out]);
  return parseWav(new Uint8Array(await readFile(out)));
}

/**
 * Lays every narration clip at its timeline position into one mono track
 * covering [from, to). Inserted holds become real silence between clips.
 */
export async function mixNarration(clips: readonly AudioClip[], from: number, to: number, out: string, tmp: (name: string) => string): Promise<void> {
  const cache = new Map<string, Pcm>();
  let rate: number | undefined;
  for (const clip of clips) {
    if (!cache.has(clip.src)) {
      const pcm = await load(clip.src, rate, tmp);
      rate ??= pcm.rate;
      cache.set(clip.src, pcm);
    }
  }
  rate ??= 16000;
  const mix = new Int16Array(Math.max(1, Math.round((to - from) * rate)));
  for (const clip of clips) {
    const pcm = cache.get(clip.src)!;
    if (pcm.rate !== rate) throw new Error(`clip ${clip.src} is ${pcm.rate} Hz, expected ${rate} Hz`);
    const start = Math.round((clip.t0 - from) * rate);
    const offset = Math.round(clip.offset * rate);
    const len = Math.round(clip.duration * rate);
    for (let i = 0; i < len; i++) {
      const dst = start + i;
      const s = pcm.samples[offset + i];
      if (dst < 0 || dst >= mix.length || s === undefined) continue;
      mix[dst] = Math.max(-32768, Math.min(32767, mix[dst]! + s));
    }
  }
  await writeFile(out, wav(mix.length / rate, rate, mix));
}
