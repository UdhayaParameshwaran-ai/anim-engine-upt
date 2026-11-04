import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wav, type TimedSpan, type TtsCapabilities, type TtsProvider, type TtsRequest, type TtsResult } from "@anim/tts";

/**
 * Piper: fast local neural TTS (VITS voices, ONNX), many times faster than
 * real time on a CPU. Runs the Piper binary once per request, one sentence
 * per input line, so each sentence comes back as its own WAV; those give
 * sentence timings, which the aligner spreads over the words.
 *
 * Files live in .cache/piper: the binary (piper/piper.exe) and a voice
 * (<voice>.onnx with its .onnx.json).
 */
export interface PiperOptions {
  /** Folder with piper/ (the binary) and the voice files; default .cache/piper. */
  dir?: string;
  /** Voice file name without .onnx; default en_US-lessac-medium. */
  voice?: string;
  /** Speaking rate, 1 = normal (Piper's length scale is its inverse). */
  speed?: number;
  /** Silence between sentences, seconds. */
  pause?: number;
}

export class PiperTtsProvider implements TtsProvider {
  readonly id: string;
  readonly capabilities: TtsCapabilities = { timing: "sentence", ssml: false, maxChars: 100_000 };
  private readonly dir: string;
  private readonly voice: string;
  private readonly speed: number;
  private readonly pause: number;

  constructor(opts: PiperOptions = {}) {
    this.dir = opts.dir ?? join(process.cwd(), ".cache", "piper");
    this.voice = opts.voice ?? "en_US-lessac-medium";
    this.speed = opts.speed ?? 1;
    this.pause = opts.pause ?? 0.25;
    this.id = `piper:${this.voice}:${this.speed}`;
  }

  /** The binary and the voice model are present. */
  available(): boolean {
    return existsSync(this.binary()) && existsSync(this.model());
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    if (!this.available()) throw new Error(`piper: missing ${this.binary()} or ${this.model()} (see README: local voices)`);
    const sentences = splitSentences(req.text);
    const speed = Number(req.settings?.speed ?? this.speed) || 1;
    const out = await mkdtemp(join(tmpdir(), "piper-"));
    try {
      const files = await this.run(sentences.map((s) => s.text), out, speed);
      if (files.length !== sentences.length) throw new Error(`piper: ${files.length} audio files for ${sentences.length} sentences`);
      const parts = await Promise.all(files.map(async (f) => pcm(await readFile(f))));
      const rate = parts[0]?.rate ?? 22050;
      const gap = Math.round(this.pause * rate);
      const total = parts.reduce((n, p) => n + p.samples.length, 0) + gap * Math.max(0, parts.length - 1);
      const samples = new Int16Array(total);
      const items: TimedSpan[] = [];
      let at = 0;
      parts.forEach((p, i) => {
        samples.set(p.samples, at);
        items.push({ start: sentences[i]!.start, end: sentences[i]!.end, t0: at / rate, t1: (at + p.samples.length) / rate });
        at += p.samples.length + (i < parts.length - 1 ? gap : 0);
      });
      return { audio: wav(total / rate, rate, samples), format: "wav", sampleRate: rate, duration: total / rate, timings: { unit: "sentence", items } };
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  }

  private binary(): string {
    return join(this.dir, "piper", process.platform === "win32" ? "piper.exe" : "piper");
  }

  private model(): string {
    return join(this.dir, `${this.voice}.onnx`);
  }

  /** One Piper process: a line per sentence in, a WAV path per line out (in order). */
  private run(lines: string[], outDir: string, speed: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary(), ["--model", this.model(), "--output_dir", outDir, "--length_scale", String(1 / speed), "--sentence_silence", "0"], {
        cwd: join(this.dir, "piper"),
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
      child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
      child.on("error", (e) => reject(new Error(`piper: could not start (${e.message})`)));
      child.on("close", (code) => {
        if (code !== 0) return reject(new Error(`piper exited with ${code}: ${stderr.trim().split("\n").slice(-3).join(" ")}`));
        resolve(stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.toLowerCase().endsWith(".wav")));
      });
      // Piper reads one utterance per line.
      child.stdin.end(lines.map((l) => l.replace(/\s+/g, " ")).join("\n") + "\n", "utf8");
    });
  }
}

/** Sentences with their char ranges in `text` (the ranges become timing spans). */
export function splitSentences(text: string): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  const re = /[^.!?]+(?:[.!?]+["')\]]*|$)/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim();
    if (!/[A-Za-z0-9]/.test(body)) continue;
    out.push({ text: body, start: m.index! + lead, end: m.index! + lead + body.length });
  }
  return out.length ? out : [{ text: text.trim() || ".", start: 0, end: text.length }];
}

/** Samples and rate of a 16-bit mono PCM WAV (finds the data chunk). */
function pcm(buf: Uint8Array): { samples: Int16Array; rate: number } {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const rate = v.getUint32(24, true);
  let o = 12;
  while (o + 8 <= buf.length) {
    const id = String.fromCharCode(buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!);
    const size = v.getUint32(o + 4, true);
    if (id === "data") {
      const n = Math.floor(Math.min(size, buf.length - o - 8) / 2);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i++) samples[i] = v.getInt16(o + 8 + i * 2, true);
      return { samples, rate };
    }
    o += 8 + size + (size % 2);
  }
  return { samples: new Int16Array(0), rate };
}
