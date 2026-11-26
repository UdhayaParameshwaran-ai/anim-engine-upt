import type { MotionSet } from "./index.js";

/** One item of a scene: the strings the script gave it, the icon it names, and what kind of element it was. */
export interface SceneItem {
  /** The element's id in the script. */
  id?: string;
  /** Its quoted strings in order (a step: title, detail; a timeline event: date, title, detail...). */
  texts: string[];
  /** The icon name (`icon:send` -> "send"), or "". */
  icon: string;
  kind?: string;
  /** Kept for readers of older data: the first and second string. */
  title?: string;
  detail?: string;
}

/** What a scene gives the page: its heading, its items, and the elements that fill named slots (left, right, subtitle...). */
export interface SceneData {
  heading: string;
  items: SceneItem[];
  /** Strings of the elements whose ids are slot names: `left`, `right`, `subtitle`, `kicker`, `byline`, `brand`. */
  named?: Record<string, string[]>;
  /** The motions a scene may ask of the page (scene attributes): see PageOptions. */
  options?: PageOptions;
}

/**
 * The visible options of the designer's pages that a script can set (a scene attribute each). A page ignores an option it has no use
 * for: `bg` and `playout` belong to the opening titles, `highlight` to stats. (The pages also list an entrance direction and an order; they
 * only use them for the timeline's arrows, so they are not offered.)
 */
export interface PageOptions {
  /** relaxed | normal | snappy: how long the page's own animations take. */
  pace?: string;
  /** The title's background: base, tint, deep (auto: the variant's own). */
  bg?: string;
  /** The id of the stat that gets the glow (default: the last). */
  highlight?: string;
  /** The title plays its own exit at the end of the scene. */
  playout?: boolean;
}

/** The values each option takes (the validator and the prompt read these). */
export const PAGE_OPTION_VALUES = {
  pace: ["relaxed", "normal", "snappy"],
  bg: ["auto", "base", "tint", "deep"],
} as const;

const text = (i: SceneItem, n: number) => i.texts?.[n] ?? (n === 0 ? i.title : n === 1 ? i.detail : undefined) ?? "";

/** "$12.5k" -> { prefix: "$", value: "12.5", suffix: "k" }. */
export function parseValue(s: string): { prefix: string; value: string; suffix: string } {
  const m = /^\s*([^\d\-.]*)(-?[\d.,]+)\s*(.*)$/.exec(s);
  if (!m) return { prefix: "", value: "", suffix: s.trim() };
  // A word after the number keeps its space ("6 requests"): the page joins the value and the suffix as they are.
  const unit = m[3]!.trim();
  const spaced = /^\s+[A-Za-z]/.test(s.slice(s.indexOf(m[2]!) + m[2]!.length)) && /^[A-Za-z]/.test(unit);
  return { prefix: m[1]!.trim(), value: m[2]!.replace(/,/g, ""), suffix: spaced ? ` ${unit}` : unit };
}

/** "+45% vs Q3" -> { delta: "45", label: "vs Q3" }; "-12% vs last year" -> { delta: "-12", label: "vs last year" }. */
export function parseDelta(s: string): { delta: string; label: string } {
  const m = /^\s*([+\-−]?)\s*(\d+(?:\.\d+)?)\s*%?\s*(.*)$/.exec(s);
  if (!m) return { delta: "", label: s.trim() };
  return { delta: `${m[1] === "-" || m[1] === "−" ? "-" : ""}${m[2]}`, label: m[3]!.trim() };
}

/**
 * The chart pages read "6 requests" into a number and a unit and drop the space between them ("6requests"). A zero-width space after
 * the number is not whitespace to their parser, so it stops there and the unit keeps its own space.
 */
export function keepUnitSpace(value: string): string {
  return value.replace(/^(\s*[^\d\-.]*-?[\d.,]+)(\s+[A-Za-z])/, "$1​$2");
}

const shell = (data: SceneData, items: unknown[]) => ({ pace: data.options?.pace ?? "normal", motion: "default", order: "forward", kicker: data.named?.kicker?.[0] ?? "", heading: data.heading, items });

/**
 * A timeline event's picture slot (the ribbon draws it above the card; the camera and the filmstrip show no media): a fourth string is
 * a figure ("10,000+ teams": the number counts up, the rest follows it) or, with no digit in it, a short line of text; a fifth is
 * the caption under it.
 */
function eventMedia(i: SceneItem): { media?: unknown } {
  const t = text(i, 3).trim();
  if (!t) return {};
  const label = text(i, 4).trim();
  if (!/\d/.test(t)) return { media: { kind: "text", text: t, label } };
  const v = parseValue(t);
  return { media: { kind: "stat", value: Number(v.value) || 0, prefix: v.prefix, suffix: v.suffix, label } };
}

/** The data object the designer's page reads, from what a scene gives it. */
export function pageData(set: MotionSet, data: SceneData): unknown {
  const items = data.items;
  const named = data.named ?? {};
  switch (set.kind) {
    case "steps":
    case "interaction":
      return shell(data, items.map((i) => ({ title: text(i, 0), detail: text(i, 1), icon: i.icon || "star" })));
    case "compare":
      // Item 1 holds the side names; every other item is a row: the left point, the right point, and an icon for the aspect.
      return shell(data, [
        { title: named.left?.[0] ?? "Before", detail: named.right?.[0] ?? "After" },
        ...items.map((i) => ({ title: text(i, 0), detail: text(i, 1), icon: i.icon || "star" })),
      ]);
    case "chart":
      return shell(data, items.map((i) => ({ title: text(i, 0), detail: keepUnitSpace(text(i, 1)) })));
    case "timeline":
      return { kicker: named.kicker?.[0] ?? "", heading: data.heading, pace: data.options?.pace ?? "normal", motion: "default", order: "forward", items: items.map((i) => ({ date: text(i, 0), title: text(i, 1), detail: text(i, 2), image: "", ...eventMedia(i) })) };
    case "stats":
      return {
        pace: data.options?.pace ?? "normal", motion: "rise", order: "forward", kicker: named.kicker?.[0] ?? "", heading: data.heading,
        items: items.map((i, k) => {
          const v = parseValue(text(i, 1));
          const d = parseDelta(text(i, 2));
          return { label: text(i, 0), value: v.value, prefix: v.prefix, suffix: v.suffix, delta: d.delta, deltaLabel: d.label, icon: i.icon || "user", highlight: data.options?.highlight ? i.id === data.options.highlight : k === items.length - 1 };
        }),
      };
    case "title":
      return {
        pace: data.options?.pace ?? "normal", bg: data.options?.bg ?? "auto", playout: data.options?.playout ?? false,
        kicker: named.kicker?.[0] ?? "", title: data.heading, subtitle: named.subtitle?.[0] ?? "", byline: named.byline?.[0] ?? "", brand: named.brand?.[0] ?? "",
        icon: items[0]?.icon || "star",
      };
  }
}

/**
 * How long before an item the page runs into it: the page's own run-in (a camera pan, a card turning over). The page waits this far
 * before the item until its cue, then plays the run-in at its own speed, so the item lands on the cue and is never caught half-revealed.
 */
const LEAD = 0.6;

/** Items the page starts closer together than this overlap (a bar takes about a second to rise): they cannot be shown one at a time. */
const MIN_GAP = 1;

/** An item starts to appear this long before it is half visible (its fade-in, its first moves). */
const ANCHOR = 0.25;

/** What the page's `measure` found for one item: when it is half visible (appear) and fully visible (landed), by its earliest and its latest string. */
export interface Measured {
  first: { appear: number; landed: number };
  last: { appear: number; landed: number };
}

const median = (xs: number[], fallback: number): number => {
  if (!xs.length) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * The page's own time at which each item starts to appear, and how long it takes to be there, from what the page was measured to do
 * (`measured`, per item or null when its text could not be followed) with the designer's formula (`formula`) as the fallback.
 * - Per item the earliest or the latest of its strings, whichever tells the items apart better (a flip card shows its front for every
 *   item at once and the answer on its back later).
 * - An item that does not come after the one before it was found somewhere else on the page (a number on a ruler): it is dropped and
 *   filled in, like an item that could not be followed, from its neighbours (even spacing).
 */
export function timing(measured: readonly (Measured | null)[] | null, formula: readonly number[] | null): { starts: number[] | null; spans: number[] | null } {
  if (!measured || measured.every((m) => !m)) return { starts: formula ? [...formula] : null, spans: null };
  const score = (xs: ({ appear: number } | undefined)[]) => xs.reduce<number>((n, x, i) => n + (i > 0 && x && xs[i - 1] && x.appear - xs[i - 1]!.appear >= 0.25 ? 1 : 0), 0);
  const firsts = measured.map((m) => m?.first);
  const lasts = measured.map((m) => m?.last);
  const chosen = score(lasts) > score(firsts) ? lasts : firsts;
  const at: (number | null)[] = [];
  let prev = -Infinity;
  for (const x of chosen) {
    if (x && x.appear > prev + 0.05) {
      at.push(x.appear);
      prev = x.appear;
    } else at.push(null);
  }
  const known = at.map((t, i) => (t === null ? -1 : i)).filter((i) => i >= 0);
  const gaps = known.slice(1).map((i, k) => (at[i]! - at[known[k]!]!) / (i - known[k]!));
  const gap = median(gaps, 2.5);
  const times = at.map((t, i) => {
    if (t !== null) return t;
    const before = [...known].reverse().find((k) => k < i);
    const after = known.find((k) => k > i);
    if (before !== undefined && after !== undefined) return at[before]! + ((at[after]! - at[before]!) * (i - before)) / (after - before);
    if (before !== undefined) return at[before]! + (i - before) * gap;
    return at[after!]! - (after! - i) * gap;
  });
  const own = chosen.map((x, i) => (x && at[i] !== null ? x.landed - x.appear + ANCHOR : null));
  const span = median(own.filter((x): x is number => x !== null), ANCHOR);
  return { starts: times.map((t) => Math.max(0, t - ANCHOR)), spans: own.map((x) => x ?? span) };
}

/**
 * Maps scene time to the page's own time so that each item appears when it is spoken, and every motion of the page plays at its own
 * speed.
 *   cues     scene-local seconds at which each item is shown (undefined: the script never shows it)
 *   starts   the page's own time at which each item starts to appear
 *   spans    how long each item takes to be there (optional)
 *
 * The page is never stretched to fill the narration (a 2-second animation spread over 15 seconds is slow motion): it plays, then waits.
 * - Before the first item it opens at its own speed (heading, frame), waits, then runs into the item so that it lands on its cue.
 * - Between two items, when the narration leaves room, the page plays the first item's animation right after its cue, waits at the
 *   moment just before the next item, and runs into the next item so that it lands on its cue.
 * - When the narration is quicker than the page (the next cue comes before the page would reach the item), the page is squeezed to fit.
 * - After the last item it plays on at its own speed (the caller holds the last frame).
 * - A page that starts its items closer together than a second (a bar chart: bars 0.2s apart, each rising for 0.9s) has no state with
 *   one item there and the next not yet started, so its items cannot be shown one by one: it plays once, from the first cue.
 */
export function warpTime(t: number, cues: readonly (number | undefined)[], starts: readonly number[] | null, spans?: readonly number[] | null, outro?: Outro | null): number {
  const p = warpItems(t, cues, starts, spans);
  if (!outro) return p;
  // The exit (a title leaving) is the last thing the page does: it plays at its own speed and ends with the scene, and the page waits
  // before it, however long the narration runs.
  const length = outro.gone - outro.leave;
  const at = outro.end - length;
  return t < at ? Math.min(p, outro.leave) : outro.leave + (t - at);
}

/** When a page's exit plays (page time: it starts to leave, it is gone) and the scene time at which it should be over. */
export interface Outro {
  leave: number;
  gone: number;
  end: number;
}

function warpItems(t: number, cues: readonly (number | undefined)[], starts: readonly number[] | null, spans?: readonly number[] | null): number {
  if (!starts) return t;
  let a: { c: number; s: number; span: number }[] = [];
  cues.forEach((c, i) => {
    const s = starts[i];
    if (c === undefined || s === undefined) return;
    const last = a[a.length - 1];
    if (!last || (c > last.c + 0.01 && s > last.s + 0.01)) a.push({ c, s, span: spans?.[i] ?? 0 });
  });
  if (!a.length) return t;
  if (a.some((p, i) => i < a.length - 1 && a[i + 1]!.s - p.s < Math.max(MIN_GAP, p.span * 0.9))) a = [a[0]!];
  const first = a[0]!;
  if (t <= first.c) {
    if (first.c > first.s) {
      const lead = Math.min(LEAD, first.s);
      return t <= first.c - lead ? Math.max(0, Math.min(t, first.s - lead)) : first.s - (first.c - t);
    }
    // The cue is earlier than the page would get there: the page starts part-way in, so that the item still lands on its cue.
    return Math.max(0, first.s - (first.c - t));
  }
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1]!;
    const q = a[i]!;
    if (t > q.c) continue;
    const gapC = q.c - p.c;
    const gapS = q.s - p.s;
    if (gapC <= gapS) return p.s + ((t - p.c) / gapC) * gapS;
    const lead = Math.min(LEAD, gapS);
    const hold = q.s - lead;
    if (t <= p.c + (hold - p.s)) return p.s + (t - p.c);
    if (t >= q.c - lead) return q.s - (q.c - t);
    return hold;
  }
  const end = a[a.length - 1]!;
  return end.s + (t - end.c);
}
