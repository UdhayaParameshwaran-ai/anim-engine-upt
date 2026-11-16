import { isPromptId, type PromptId } from "./prompt-slots.js";
import { isLength, lengthAdvice, lengthSpec, type Length, type LengthSpec } from "./length.js";

/**
 * What a person may change about the prompts, one field per thing. Every field is optional:
 * an unset field means "the default". The language itself (syntax, verbs, templates, output format)
 * is never part of this, so no setting can break what the compiler and the repair loop rely on.
 */
export interface PromptSettings {
  // 1. Everyone: added to the planning call and every scene call.
  /** Who watches ("beginners", "backend developers"). */
  audience?: string;
  /** How it sounds ("friendly", "dry and precise"). */
  tone?: string;
  /** Narration language ("English", "Hindi"). Labels and the script syntax stay as they are. */
  language?: string;
  /** Free instructions: product names, words to use or avoid. */
  notes?: string;

  // 2. Planning
  length?: Length;
  /** Exact scene range; wins over the length preset. */
  scenes?: { min: number; max: number };
  /** Replaces the planning advice of the length preset ("" turns it off). */
  planningAdvice?: string;

  // 3. Scene writing
  /** Most words in one narration sentence. */
  maxWords?: number;
  /** Narration sentences per scene (per chapter in a growing diagram); wins over the preset. */
  sentences?: { min: number; max: number };
  /** Story-motion hint per template name, replacing the built-in one ("" turns it off). */
  motionHints?: Record<string, string>;
  /** Extra advice per template name, added after its card. */
  templateNotes?: Record<string, string>;
  /** The scene-writing playbook of a use case (algorithm, protocol, …), replacing the built-in one ("" turns it off). */
  playbooks?: Record<string, string>;

  // 4. Whole prompts: the person's own version of a prompt, with its {{slots}}. Unset = the built-in text.
  prompts?: Partial<Record<PromptId, string>>;

  /** Internal: build the default text with its {{slots}} left in (used to show the defaults). Never read from outside. */
  tokens?: boolean;
}

export const DEFAULT_MAX_WORDS = 25;

const LIMITS = { prompt: 60000, text: 1500, hint: 600, scenes: 30, sentences: 12, words: 60 };

const text = (v: unknown, max = LIMITS.text): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\r/g, "").trim().slice(0, max);
  return t || undefined;
};

const range = (v: unknown, cap: number): { min: number; max: number } | undefined => {
  if (!v || typeof v !== "object") return undefined;
  const { min, max } = v as { min?: unknown; max?: unknown };
  const lo = Math.round(Number(min));
  const hi = Math.round(Number(max ?? min));
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 1) return undefined;
  return { min: Math.min(lo, cap), max: Math.min(Math.max(lo, hi), cap) };
};

const byName = (v: unknown): Record<string, string> | undefined => {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[a-z0-9-]{1,24}$/.test(k) || typeof val !== "string") continue;
    // "" is a real value for motion hints: it switches the built-in hint off.
    out[k] = val.replace(/\r/g, "").trim().slice(0, LIMITS.hint);
  }
  return Object.keys(out).length ? out : undefined;
};

/** Anything that came from outside (a URL, a file) → settings that are safe to use; unknown fields are dropped. */
export function sanitizeSettings(raw: unknown): PromptSettings {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: PromptSettings = {};
  const set = <K extends keyof PromptSettings>(k: K, v: PromptSettings[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("audience", text(r.audience, 200));
  set("tone", text(r.tone, 200));
  set("language", text(r.language, 60));
  set("notes", text(r.notes));
  if (isLength(r.length)) out.length = r.length;
  set("scenes", range(r.scenes, LIMITS.scenes));
  if (typeof r.planningAdvice === "string") out.planningAdvice = r.planningAdvice.replace(/\r/g, "").trim().slice(0, LIMITS.text);
  const words = Math.round(Number(r.maxWords));
  if (Number.isFinite(words) && words >= 5) out.maxWords = Math.min(words, LIMITS.words);
  set("sentences", range(r.sentences, LIMITS.sentences));
  set("motionHints", byName(r.motionHints));
  set("playbooks", byName(r.playbooks));
  const notes = byName(r.templateNotes);
  if (notes) {
    for (const k of Object.keys(notes)) if (!notes[k]) delete notes[k];
    if (Object.keys(notes).length) out.templateNotes = notes;
  }
  if (r.prompts && typeof r.prompts === "object") {
    const prompts: Partial<Record<PromptId, string>> = {};
    for (const [k, v] of Object.entries(r.prompts as Record<string, unknown>)) {
      // Empty means the default, so it is not kept.
      if (isPromptId(k) && typeof v === "string" && v.trim()) prompts[k] = v.replaceAll(String.fromCharCode(13), "").slice(0, LIMITS.prompt);
    }
    if (Object.keys(prompts).length) out.prompts = prompts;
  }
  return out;
}

/** The preset the settings choose, with the scene and sentence ranges they set on top. */
export function effectiveSpec(settings: PromptSettings, length: Length | undefined): LengthSpec {
  const base = lengthSpec(settings.length ?? length);
  return {
    ...base,
    ...(settings.scenes && { scenes: settings.scenes }),
    ...(settings.sentences && { sentences: settings.sentences, chapterSentences: settings.sentences }),
  };
}

/** The planning advice in force: the person's own text, or the preset's. */
export function planningAdvice(spec: LengthSpec, settings: PromptSettings): string {
  return settings.planningAdvice !== undefined ? settings.planningAdvice : lengthAdvice(spec);
}

/** The lines every call gets for audience, tone, language and notes; empty when nothing is set. */
export function styleGuide(settings: PromptSettings): string {
  const lines = [
    settings.audience && `- Audience: ${settings.audience}. Choose the depth for them (this replaces any guess from the topic).`,
    settings.tone && `- Tone of the narration: ${settings.tone}.`,
    settings.language && `- Write the narration sentences in ${settings.language}. Keep the script syntax, ids, verbs and keywords exactly as specified; only the spoken words and the on-screen labels are ${settings.language}.`,
    settings.notes && `- Also: ${settings.notes.replace(/\n+/g, " ")}`,
  ].filter(Boolean);
  return lines.length ? `\nHOUSE STYLE (set by the person who asked for this video)\n${lines.join("\n")}` : "";
}

/** What each field does when it is not set, for showing next to the person's edit. */
export function settingsDefaults(motionHints: Record<string, string>): {
  maxWords: number;
  lengths: Record<Length, { scenes: { min: number; max: number }; sentences: { min: number; max: number }; chapters: { min: number; max: number }; advice: string; summary: string }>;
  motionHints: Record<string, string>;
} {
  const lengths = Object.fromEntries(
    (["short", "standard", "long", "deep"] as const).map((n) => {
      const s = lengthSpec(n);
      return [n, { scenes: s.scenes, sentences: s.sentences, chapters: s.chapters, advice: lengthAdvice(s), summary: s.summary }];
    }),
  ) as ReturnType<typeof settingsDefaults>["lengths"];
  return { maxWords: DEFAULT_MAX_WORDS, lengths, motionHints };
}
