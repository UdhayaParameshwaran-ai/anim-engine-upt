/**
 * How long a video should be: one preset sets the scene count, the sentences
 * per scene and the chapters of a growing diagram, so prompts never hard-code them.
 * "standard" is what the pipeline did before presets existed.
 */
export const LENGTHS = ["short", "standard", "long", "deep"] as const;
export type Length = (typeof LENGTHS)[number];

interface Range { min: number; max: number }

export interface LengthSpec {
  name: Length;
  summary: string;
  /** Scenes of a video made of separate scenes. */
  scenes: Range;
  /** Narration sentences per scene. */
  sentences: Range;
  /** Chapters of a video that is one growing diagram. */
  chapters: Range;
  /** Sentences per chapter. */
  chapterSentences: Range;
}

export const LENGTH_SPECS: Record<Length, LengthSpec> = {
  short: { name: "short", summary: "under a minute: the one idea", scenes: { min: 2, max: 2 }, sentences: { min: 2, max: 3 }, chapters: { min: 3, max: 4 }, chapterSentences: { min: 2, max: 3 } },
  standard: { name: "standard", summary: "one to two minutes", scenes: { min: 2, max: 4 }, sentences: { min: 2, max: 6 }, chapters: { min: 4, max: 6 }, chapterSentences: { min: 2, max: 4 } },
  long: { name: "long", summary: "about three minutes: several parts, each explained", scenes: { min: 6, max: 9 }, sentences: { min: 3, max: 6 }, chapters: { min: 7, max: 10 }, chapterSentences: { min: 3, max: 5 } },
  deep: { name: "deep", summary: "five minutes or more: a full walk-through", scenes: { min: 10, max: 14 }, sentences: { min: 4, max: 7 }, chapters: { min: 11, max: 14 }, chapterSentences: { min: 3, max: 5 } },
};

export function lengthSpec(length: Length | undefined): LengthSpec {
  return LENGTH_SPECS[length ?? "standard"] ?? LENGTH_SPECS.standard;
}

export function isLength(v: unknown): v is Length {
  return typeof v === "string" && (LENGTHS as readonly string[]).includes(v);
}

/** Minutes of video → the preset that runs about that long (measured: 3 scenes ≈ 1 min, 8 ≈ 3 min, 11 ≈ 5 min). */
export function lengthForMinutes(minutes: number): Length {
  if (minutes <= 0.75) return "short";
  if (minutes <= 2) return "standard";
  if (minutes <= 4) return "long";
  return "deep";
}

/**
 * The length a topic asks for in its own words ("a short video…", "in depth", "a 5 minute video…"),
 * or undefined when it says nothing. An explicit option always wins over this.
 */
export function detectLength(topic: string): Length | undefined {
  const t = topic.toLowerCase();
  const mins = /(\d+(?:\.\d+)?)\s*[- ]?\s*(?:minutes?|mins?)\b/.exec(t);
  if (mins) return lengthForMinutes(Number(mins[1]));
  if (/(\d+)\s*[- ]?\s*(?:seconds?|secs?)\b/.test(t)) return "short";
  // Needs a video word next to it: "long polling" and "quick sort" are topics, not requests.
  const kind = "(?:video|explainer|animation|overview|version|walk-?through)";
  if (/\b(deep dive|in[- ]depth|comprehensive|exhaustive|full course|complete guide)\b/.test(t)) return "deep";
  if (new RegExp(`\\b(?:long|lengthy|detailed|thorough|extended|longer)\\s+${kind}`).test(t) || /\blengthy\b/.test(t)) return "long";
  if (new RegExp(`\\b(?:short|quick|brief|tiny|one[- ]minute|shorter)\\s+${kind}`).test(t) || /\b(in a nutshell|tl;?dr)\b/.test(t)) return "short";
  return undefined;
}

/** Planning advice that only matters when there are many scenes: no filler, new ground each time. */
export function lengthAdvice(spec: LengthSpec): string {
  if (spec.name === "long" || spec.name === "deep") {
    return `This is a ${spec.name} video: break the topic into its real parts, one scene per part, each teaching something the others do not. No filler scenes and no repeated recaps: at most one recap page, at the very end. Vary the templates from scene to scene.`;
  }
  if (spec.name === "short") return "This is a short video: only the one idea that matters, no side topics.";
  return "";
}
