import type { TimingPrecision, WordTiming } from "@anim/ir";
import type { ProviderTimings, TimedSpan } from "./provider.js";

interface Word {
  text: string;
  start: number;
  end: number;
  t0?: number;
  t1?: number;
  precision?: TimingPrecision;
}

/**
 * Normalizes provider timings of any granularity into word timings over
 * `text`. Words are maximal runs of non-space characters.
 *
 * - char: exact (from first/last char of each word)
 * - word: matched by char overlap
 * - sentence / none: distributed by word length within each timed span ("interpolated")
 *
 * Words the provider missed are interpolated between their neighbors.
 */
export function align(text: string, duration: number, timings?: ProviderTimings): WordTiming[] {
  const words: Word[] = [...text.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index!, end: m.index! + m[0].length }));
  if (!words.length) return [];

  if (timings?.unit === "char") {
    const byChar = new Map(timings.items.map((c) => [c.start, c]));
    for (const w of words) {
      const first = byChar.get(w.start);
      const last = byChar.get(w.end - 1);
      if (first && last) set(w, first.t0, last.t1, "char");
    }
  } else if (timings?.unit === "word") {
    for (const w of words) {
      const best = bestOverlap(w, timings.items);
      if (best) set(w, best.t0, best.t1, "word");
    }
  } else if (timings?.unit === "sentence") {
    for (const s of timings.items) {
      distribute(words.filter((w) => w.start >= s.start && w.end <= s.end), s.t0, s.t1);
    }
  }

  fillGaps(words, duration);
  return words.map((w) => ({ text: w.text, start: w.start, end: w.end, t0: w.t0!, t1: w.t1!, precision: w.precision! }));
}

function set(w: Word, t0: number, t1: number, precision: TimingPrecision): void {
  w.t0 = t0;
  w.t1 = Math.max(t0, t1);
  w.precision = precision;
}

function bestOverlap(w: Word, items: TimedSpan[]): TimedSpan | undefined {
  let best: TimedSpan | undefined;
  let bestLen = 0;
  for (const it of items) {
    const len = Math.min(w.end, it.end) - Math.max(w.start, it.start);
    if (len > bestLen) {
      best = it;
      bestLen = len;
    }
  }
  return best;
}

/** Spreads words over [t0, t1] in proportion to their length (+1 for the following gap). */
function distribute(words: Word[], t0: number, t1: number): void {
  const total = words.reduce((n, w) => n + w.text.length + 1, 0);
  let t = t0;
  for (const w of words) {
    const d = ((w.text.length + 1) / total) * (t1 - t0);
    const speech = (w.text.length / (w.text.length + 1)) * d;
    set(w, round(t), round(t + speech), "interpolated");
    t += d;
  }
}

/** Interpolates runs of untimed words between the nearest timed neighbors. */
function fillGaps(words: Word[], duration: number): void {
  let i = 0;
  while (i < words.length) {
    if (words[i]!.t0 !== undefined) {
      i++;
      continue;
    }
    let j = i;
    while (j < words.length && words[j]!.t0 === undefined) j++;
    const from = i > 0 ? words[i - 1]!.t1! : 0;
    const to = j < words.length ? words[j]!.t0! : duration;
    distribute(words.slice(i, j), from, Math.max(from, to));
    i = j;
  }
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}
