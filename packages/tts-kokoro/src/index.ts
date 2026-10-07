import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { AutoTokenizer, env, StyleTextToSpeech2Model, Tensor, type PreTrainedTokenizer } from "@huggingface/transformers";
import { wav, type TimedSpan, type TtsCapabilities, type TtsProvider, type TtsRequest, type TtsResult } from "@anim/tts";
import { phonemize } from "phonemizer";

/**
 * Local TTS with Kokoro-82M (Apache-2.0), run on the CPU through ONNX
 * Runtime. The "timestamped" export also returns how many frames the model
 * spends on every input token; since we build the token sequence word by
 * word, those durations give exact word timings for cue sync.
 */
export interface KokoroOptions {
  /** Kokoro voice used when the script's `voice` isn't one (default af_heart). */
  voice?: string;
  /** Speaking rate multiplier. */
  speed?: number;
  /** Weights: q4f16 is the fastest on CPUs (q8 is slower than full precision there). */
  dtype?: "q4f16" | "q4" | "fp16" | "q8" | "fp32";
  /** Where model files are downloaded to (default ./.cache/models). */
  cacheDir?: string;
  modelId?: string;
}

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX-timestamped";
const RATE = 24000;
/** The model emits 600 samples per duration frame: 40 frames per second. */
const FRAME = 600;
/** Token limit per call is 512 including the two boundary tokens; stay well below. */
const MAX_TOKENS = 400;
/** Punctuation the model knows: it shapes pauses and intonation. */
const PUNCT = /[;:,.!?¡¿—…"«»“”()]/g;
const VOICES = new Set(
  "af_heart af_alloy af_aoede af_bella af_jessica af_kore af_nicole af_nova af_river af_sarah af_sky am_adam am_echo am_eric am_fenrir am_liam am_michael am_onyx am_puck am_santa bf_emma bf_isabella bm_george bm_lewis bf_alice bf_lily bm_daniel bm_fable".split(" "),
);

interface Word {
  start: number;
  end: number;
  ids: number[];
  /** Tokens at the end of `ids` that are punctuation (pause, not speech). */
  tail: number;
}

interface Loaded {
  model: StyleTextToSpeech2Model;
  tokenizer: PreTrainedTokenizer;
  space: number;
}

export class KokoroTtsProvider implements TtsProvider {
  readonly id: string;
  readonly capabilities: TtsCapabilities = { timing: "word", ssml: false, maxChars: 200_000 };
  private readonly opts: Required<Omit<KokoroOptions, "cacheDir">> & { cacheDir: string };
  private loaded?: Promise<Loaded>;
  private readonly voices = new Map<string, Float32Array>();
  private readonly phonemes = new Map<string, Promise<string>>();
  /** One ONNX session: requests run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: KokoroOptions = {}) {
    this.opts = {
      voice: opts.voice ?? "af_heart",
      speed: opts.speed ?? 1,
      dtype: opts.dtype ?? "q4f16",
      cacheDir: opts.cacheDir ?? join(process.cwd(), ".cache", "models"),
      modelId: opts.modelId ?? MODEL,
    };
    this.id = `kokoro:${this.opts.dtype}:${this.opts.speed}`;
  }

  /** Loads the model now instead of on the first request (it takes a second or two). */
  warmup(): Promise<void> {
    return this.load().then(() => undefined);
  }

  synthesize(req: TtsRequest): Promise<TtsResult> {
    const run = this.queue.then(() => this.run(req));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private load(): Promise<Loaded> {
    this.loaded ??= (async () => {
      env.cacheDir = this.opts.cacheDir;
      const [model, tokenizer] = await Promise.all([
        StyleTextToSpeech2Model.from_pretrained(this.opts.modelId, { dtype: this.opts.dtype, device: "cpu" }),
        AutoTokenizer.from_pretrained(this.opts.modelId),
      ]);
      const space = (tokenizer(" ", { add_special_tokens: false }).input_ids as Tensor).data;
      return { model, tokenizer, space: Number(space[0]) };
    })();
    return this.loaded;
  }

  private async run(req: TtsRequest): Promise<TtsResult> {
    const { model, tokenizer, space } = await this.load();
    const voice = VOICES.has(req.voice) ? req.voice : this.opts.voice;
    const lang = voice.startsWith("b") ? "en" : "en-us";
    const speed = Number(req.settings?.speed ?? this.opts.speed);
    const words = await this.words(req.text, lang, tokenizer);

    const audio: Float32Array[] = [];
    const items: TimedSpan[] = [];
    let offset = 0; // samples
    for (const chunk of chunks(words)) {
      const ids = [0];
      const firstToken: number[] = [];
      chunk.forEach((w, i) => {
        if (i) ids.push(space);
        firstToken.push(ids.length);
        ids.push(...w.ids);
      });
      ids.push(0);

      const style = await this.style(voice, ids.length);
      const out = await model({
        input_ids: new Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        style: new Tensor("float32", style, [1, 256]),
        speed: new Tensor("float32", [speed], [1]),
      });
      const wave = out.waveform!.data as Float32Array;
      // The model rounds each token's duration to whole frames; rescale to the exact length it produced.
      const frames = Array.from(out.durations!.data as Float32Array, (d) => Math.max(1, Math.round(d)));
      const scale = wave.length / (frames.reduce((a, b) => a + b, 0) * FRAME);
      const at = (token: number) => offset + frames.slice(0, token).reduce((a, b) => a + b, 0) * FRAME * scale;

      chunk.forEach((w, i) => {
        const first = firstToken[i]!;
        const lastSpoken = first + Math.max(1, w.ids.length - w.tail);
        items.push({ start: w.start, end: w.end, t0: round(at(first) / RATE), t1: round(at(lastSpoken) / RATE) });
      });
      audio.push(wave);
      offset += wave.length;
    }

    const samples = new Int16Array(offset);
    let i = 0;
    for (const part of audio) for (const s of part) samples[i++] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    const duration = round(offset / RATE);
    return { audio: wav(duration, RATE, samples), format: "wav", sampleRate: RATE, duration, timings: { unit: "word", items } };
  }

  /**
   * Every word of the text with its tokens: the phonemes of its letters plus
   * the punctuation around it. Phrases between punctuation are phonemized
   * whole, so words get their reduced, linked forms ("of the" → ʌvðə), then
   * the phrase's phonemes are split back into words (see splitPhonemes).
   */
  private async words(text: string, lang: string, tokenizer: PreTrainedTokenizer): Promise<Word[]> {
    const encode = (s: string) => (s ? Array.from((tokenizer(s, { add_special_tokens: false }).input_ids as Tensor).data as BigInt64Array, Number) : []);
    const parts = [...text.matchAll(/\S+/g)].map((m) => {
      const word = m[0];
      const core = /[\p{L}\p{N}](?:.*[\p{L}\p{N}])?/u.exec(word);
      return {
        start: m.index!,
        end: m.index! + word.length,
        core: core?.[0] ?? "",
        lead: (core ? word.slice(0, core.index) : word).match(PUNCT)?.join("") ?? "",
        trail: core ? (word.slice(core.index + core[0].length).match(PUNCT)?.join("") ?? "") : "",
        phonemes: "",
      };
    });

    // Phrases: runs of words broken by punctuation.
    const phrases: (typeof parts)[] = [];
    let cur: typeof parts = [];
    for (const p of parts) {
      if (p.lead && cur.length) (phrases.push(cur), (cur = []));
      if (p.core) cur.push(p);
      if (p.trail && cur.length) (phrases.push(cur), (cur = []));
    }
    if (cur.length) phrases.push(cur);

    await Promise.all(
      phrases.map(async (phrase) => {
        const [whole, refs] = await Promise.all([
          phonemize(phrase.map((p) => p.core).join(" "), lang).then((r) => r.join(" ").trim()),
          Promise.all(phrase.map((p) => this.phonemize(p.core, lang))),
        ]);
        splitPhonemes(whole, refs).forEach((ph, i) => (phrase[i]!.phonemes = ph));
      }),
    );

    return parts
      .map((p) => {
        const tail = encode(p.trail);
        return { start: p.start, end: p.end, ids: [...encode(p.lead), ...encode(p.phonemes), ...tail], tail: tail.length };
      })
      .filter((w) => w.ids.length);
  }

  private phonemize(word: string, lang: string): Promise<string> {
    const key = `${lang}:${word.toLowerCase()}`;
    let p = this.phonemes.get(key);
    if (!p) {
      p = phonemize(word, lang).then((parts) => parts.join(" ").trim());
      this.phonemes.set(key, p);
    }
    return p;
  }

  /** Kokoro's style vector depends on the sequence length (one per length, 256 floats each). */
  private async style(voice: string, tokens: number): Promise<Float32Array> {
    let pack = this.voices.get(voice);
    if (!pack) {
      const dir = dirname(createRequire(import.meta.url).resolve("kokoro-js")).replace(/[\\/]dist$/, "");
      const buf = await readFile(join(dir, "voices", `${voice}.bin`));
      pack = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      this.voices.set(voice, pack);
    }
    const at = 256 * Math.min(Math.max(tokens - 2, 0), 509);
    return pack.slice(at, at + 256);
  }
}

const STRESS = /[ˈˌ]/;

/**
 * Splits the phonemes of a whole phrase into one string per word, guided
 * by each word's phonemes on its own. The two differ (reductions, links,
 * flaps), so they are aligned by edit distance over the sounds; each phrase
 * sound goes to the word its aligned reference sound came from.
 */
export function splitPhonemes(phrase: string, refs: string[]): string[] {
  if (refs.length <= 1) return [phrase];
  // Reference sounds (no stress marks, no spaces), each tagged with its word.
  const ref: string[] = [];
  const owner: number[] = [];
  refs.forEach((r, w) => {
    for (const ch of r) if (ch !== " " && !STRESS.test(ch)) (ref.push(ch), owner.push(w));
  });
  // Phrase sounds, remembering where each sits in the phrase string.
  const sounds: { ch: string; at: number }[] = [];
  [...phrase].forEach((ch, at) => ch !== " " && !STRESS.test(ch) && sounds.push({ ch, at }));

  // Global alignment (Needleman–Wunsch), unit costs.
  const n = sounds.length;
  const m = ref.length;
  const cost = Array.from({ length: n + 1 }, (_, i) => new Uint16Array(m + 1).map((_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = cost[i - 1]![j - 1]! + (sounds[i - 1]!.ch === ref[j - 1] ? 0 : 1);
      cost[i]![j] = Math.min(sub, cost[i - 1]![j]! + 1, cost[i]![j - 1]! + 1);
    }
  }
  const wordOf = new Array<number>(n).fill(-1);
  for (let i = n, j = m; i > 0; ) {
    if (j > 0 && cost[i]![j] === cost[i - 1]![j - 1]! + (sounds[i - 1]!.ch === ref[j - 1] ? 0 : 1)) wordOf[--i] = owner[--j]!;
    else if (j > 0 && cost[i]![j] === cost[i]![j - 1]! + 1) j--;
    else wordOf[--i] = j > 0 ? owner[j - 1]! : 0;
  }
  // Keep word order monotonic.
  for (let i = 1; i < n; i++) wordOf[i] = Math.max(wordOf[i]!, wordOf[i - 1]!);

  // Cut the phrase: stress marks go with the sound after them; spaces at word changes are dropped.
  const out = refs.map(() => "");
  const chars = [...phrase];
  let s = 0;
  for (let at = 0; at < chars.length; at++) {
    while (s < n && sounds[s]!.at < at) s++;
    const w = s < n ? wordOf[s]! : refs.length - 1;
    const ch = chars[at]!;
    if (ch === " " && (s >= n || (s > 0 && wordOf[s - 1] !== wordOf[s]))) continue;
    out[w] += ch;
  }
  return out.map((p) => p.trim());
}

/** Groups words into model calls of at most MAX_TOKENS, breaking after punctuation where possible. */
function chunks(words: Word[]): Word[][] {
  const out: Word[][] = [];
  let cur: Word[] = [];
  let size = 0;
  let lastBreak = -1; // index in `cur` after which punctuation ended a word
  for (const w of words) {
    if (cur.length && size + w.ids.length + 1 > MAX_TOKENS) {
      const cut = lastBreak >= 0 ? lastBreak + 1 : cur.length;
      out.push(cur.slice(0, cut));
      cur = cur.slice(cut);
      size = cur.reduce((n, x) => n + x.ids.length + 1, 0);
      lastBreak = -1;
    }
    cur.push(w);
    size += w.ids.length + 1;
    if (w.tail) lastBreak = cur.length - 1;
  }
  if (cur.length) out.push(cur);
  return out;
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
