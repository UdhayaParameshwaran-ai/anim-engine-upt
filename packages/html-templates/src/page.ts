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
 * for: `bg` belongs to the opening titles, `highlight` to stats. (The pages also list an entrance direction and an order; they
 * only use them for the timeline's arrows, so they are not offered.) A page never leaves by itself: how a scene ends and the next one
 * begins is the script's own transition (`in=`, `out=`, the motion preset), the same for every template.
 */
export interface PageOptions {
  /** relaxed | normal | snappy: how long the page's own animations take. */
  pace?: string;
  /** The title's background: base, tint, deep (auto: the variant's own). */
  bg?: string;
  /** The id of the stat that gets the glow (default: the last). */
  highlight?: string;
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
        // What the numbers measure (a line under the heading) and the axis titles the charts draw; the pages leave out what is empty.
        metric: named.metric?.[0] ?? "", xAxis: named.xaxis?.[0] ?? "", yAxis: named.yaxis?.[0] ?? "",
        items: items.map((i, k) => {
          const v = parseValue(text(i, 1));
          const d = parseDelta(text(i, 2));
          return { label: text(i, 0), value: v.value, prefix: v.prefix, suffix: v.suffix, delta: d.delta, deltaLabel: d.label, icon: i.icon || "user", highlight: data.options?.highlight ? i.id === data.options.highlight : k === items.length - 1 };
        }),
      };
    case "title":
      return {
        pace: data.options?.pace ?? "normal", bg: data.options?.bg ?? "auto", playout: false,
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

/** The shortest run-in a quiet moment may give (the page needs a little time to run into an item). */
const MIN_LEAD = 0.3;

/**
 * The page's own opening (its heading, its axes or frame) is over after about this long. Before the first item the page waits, and it
 * must not wait in a frame that is still empty: a chart whose first bar starts at 0.25s would otherwise sit blank (not even its
 * heading) until the narration reaches the first item, seconds into the scene.
 */
const INTRO = 1;

/** The first item is taken to start no earlier than this: the heading needs about this long to be fully there (a page may start an item at 0.15s). */
const OPENING = 0.3;

/** The page time at which a page waits for its first item (which it starts at `start`): the end of its opening, just before the item. */
// (a page that starts its first item later than 0.8s has room to wait a little before it: an item's own motion, a tile starting to tip, begins just
// before the moment its text is read)
const holdBefore = (start: number) => Math.max(0, Math.max(start - LEAD, Math.min(start - (start >= 0.8 ? 0.3 : 0.02), INTRO)));

/** Items the page starts closer together than this overlap (a bar takes about a second to rise): they cannot be shown one at a time. */
const MIN_GAP = 1;

/** An item starts to appear this long before it is half visible (its fade-in, its first moves). */
const ANCHOR = 0.25;

/** What the page's `measure` found for one item: when it is half visible (appear) and fully visible (landed), by its earliest and its latest string. */
export interface Measured {
  first: { appear: number; landed: number };
  last: { appear: number; landed: number };
}

/** The movement the page measured (per step of `step` seconds), when it did. */
interface Moving {
  activity?: number[];
  step?: number;
}

/**
 * For each item, how long before it starts the page should be held: in a quiet moment between the item before and this one, so that
 * nothing is frozen half way (a traveller part-way along a road, a card half turned). The page then plays its run-in at its own speed
 * and lands on the cue. Undefined where the page never goes quiet in between (the default lead applies).
 */
export function quietLeads(activity: readonly number[] | undefined, step: number, starts: readonly number[]): (number | undefined)[] {
  if (!activity || activity.length < 8) return starts.map(() => undefined);
  const sorted = [...activity].sort((x, y) => x - y);
  const floor = sorted[Math.floor(sorted.length * 0.2)]!;
  // quiet is a little above the page's own idle movement (a counter that always rolls, liquid that always sloshes)
  const quiet = Math.max(40, floor * 1.6 + 40);
  // a page that never rises above it has no bursts of motion to avoid freezing in
  if (!activity.some((a) => a > quiet)) return starts.map(() => undefined);
  // runs of quiet steps, as [from, to] in seconds (activity[i] is the change into time i * step)
  const windows: [number, number][] = [];
  let from = -1;
  activity.forEach((a, i) => {
    if (a <= quiet && from < 0) from = i;
    if ((a > quiet || i === activity.length - 1) && from >= 0) {
      const to = a > quiet ? i - 1 : i;
      if ((to - from + 1) * step >= 0.2 - 1e-9) windows.push([(from - 1) * step, to * step]);
      from = -1;
    }
  });
  const lo = (h: number) => Math.max(0, Math.floor((h - 0.2) / step + 1e-9));
  const hi = (h: number) => Math.ceil(h / step - 1e-9);
  /** How much the page moved in the 0.2s before h (what a hold at h would freeze). */
  const before = (h: number) => Math.max(0, ...activity.slice(lo(h), hi(h) + 1));
  /** How much it moves in the `secs` after h (the movement a hold at h is about to interrupt). */
  const ahead = (h: number, secs: number) => Math.max(0, ...activity.slice(hi(h) + 1, hi(h + secs) + 1));
  return starts.map((s, i) => {
    // the latest quiet window between the end of the previous item's own motion (for the first item: the page's opening, whose heading
    // needs about OPENING) and this item's start. For the first item only a pause after the opening has moved counts: the stillness
    // before anything has moved is a blank frame.
    const after = i === 0 ? OPENING : starts[i - 1]! + 0.3;
    const moved = (from: number) => i > 0 || Math.max(0, ...activity.slice(0, Math.max(1, Math.round(from / step)))) > quiet * 3;
    const last = windows.filter(([a, b]) => b > after && a < s - 0.15 && moved(a)).pop();
    let hold = last ? Math.max(i === 0 ? OPENING : 0, Math.min(last[1], s - 0.15)) : undefined;
    if (i === 0) {
      // Where the usual hold (the end of the opening) would freeze the page in the middle of a big movement (dots in flight, a count
      // rolling) or just as one is starting (a camera pan, a wipe: an item's motion begins before the moment its text is read), go back
      // to the calm before it. A page that is settling after its opening keeps the usual hold, and so does one with no calm moment.
      const usual = holdBefore(Math.max(s, OPENING));
      const here = before(usual);
      const rising = ahead(usual, 0.3) >= Math.max(1.25 * here, 250);
      if ((rising || here > Math.max(quiet * 6, 1000)) && usual > OPENING + 0.3) {
        const limit = Math.max(quiet * 3, 0.05 * ahead(usual, 1.5));
        let h = usual;
        while (h > OPENING && before(h) > limit) h -= step;
        if (h > OPENING) hold = Math.max(hold ?? 0, h);
      }
    }
    if (hold === undefined) return undefined;
    hold = Math.min(hold, s - 0.15);
    return Math.min(i === 0 ? 3 : 2, Math.max(MIN_LEAD, s - hold));
  });
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
export function timing(measured: readonly (Measured | null)[] | null, formula: readonly number[] | null): { starts: number[] | null; spans: number[] | null; leads: (number | undefined)[] | null } {
  if (!measured || measured.every((m) => !m)) return { starts: formula ? [...formula] : null, spans: null, leads: null };
  // A set of strings tells the items apart when they follow each other with room between them: gaps of a second or more count most (a
  // number on a ruler shows early as a tick, and would otherwise tie with the right strings at the first small step).
  const score = (xs: ({ appear: number } | undefined)[]) =>
    xs.reduce<number>((n, x, i) => {
      const gap = i > 0 && x && xs[i - 1] ? x.appear - xs[i - 1]!.appear : 0;
      return n + (gap >= MIN_GAP ? 10 : gap >= 0.25 ? 1 : 0);
    }, 0);
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
  const starts = times.map((t) => Math.max(0, t - ANCHOR));
  const m = measured as Moving;
  return { starts, spans: own.map((x) => x ?? span), leads: quietLeads(m.activity, m.step ?? 0.1, starts) };
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
export function warpTime(t: number, cues: readonly (number | undefined)[], starts: readonly number[] | null, spans?: readonly number[] | null, leads?: readonly (number | undefined)[] | null): number {
  if (!starts) return t;
  let a: { c: number; s: number; span: number; lead: number; quiet: boolean }[] = [];
  cues.forEach((c, i) => {
    const s = starts[i];
    if (c === undefined || s === undefined) return;
    const last = a[a.length - 1];
    if (!last || (c > last.c + 0.01 && s > last.s + 0.01)) a.push({ c, s: last ? s : Math.max(s, OPENING), span: spans?.[i] ?? 0, lead: leads?.[i] ?? LEAD, quiet: leads?.[i] !== undefined });
  });
  if (!a.length) return t;
  if (a.some((p, i) => i < a.length - 1 && a[i + 1]!.s - p.s < Math.max(MIN_GAP, p.span * 0.9))) a = [a[0]!];
  const first = a[0]!;
  if (t <= first.c) {
    if (first.c > first.s) {
      // held where the page is quiet when it has such a moment (not in the middle of a count or a flight), else at the end of its opening
      const hold = first.quiet ? Math.max(0, first.s - first.lead) : holdBefore(first.s);
      const runIn = first.s - hold;
      return t <= first.c - runIn ? Math.max(0, Math.min(t, hold)) : first.s - (first.c - t);
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
    const lead = Math.min(q.lead, gapS);
    const hold = q.s - lead;
    if (t <= p.c + (hold - p.s)) return p.s + (t - p.c);
    if (t >= q.c - lead) return q.s - (q.c - t);
    return hold;
  }
  const end = a[a.length - 1]!;
  return end.s + (t - end.c);
}
