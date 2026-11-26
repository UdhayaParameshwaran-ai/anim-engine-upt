/**
 * What the compiler and the engine need to know about the designer's HTML templates.
 *
 * The pages themselves (designer/phaseN) are kept exactly as delivered. Here we describe them: which page is which variant,
 * how many items and how much text each takes (measured by scripts/html-limits.mjs, see limits.json), and when each fits.
 */
import limits from "./limits.json" with { type: "json" };

/** How much copy the LLM may write: a short line is read at a glance, and the pages are sized for that. */
export const TITLE_CHARS_MAX = 40;
export const DETAIL_CHARS_MAX = 100;

/** How a template's items are written and read: which strings an item has, and what the page does with them. */
export type SetKind = "steps" | "compare" | "timeline" | "title" | "stats" | "chart" | "interaction";

export interface MotionVariant {
  /** The `variant=` value in a script. */
  id: string;
  /** The designer's page, without `.html`, and the folder it is in. */
  file: string;
  dir: string;
  /** The key under which the page reads its data (we answer it ourselves, see prelude.js). */
  key: string;
  /** The designer's name for it. */
  name: string;
  /** When this motion fits, in a few words (for the LLM). */
  when: string;
  /** How many items it lays out cleanly. */
  items: readonly [number, number];
  /** Characters an item's title and detail may have before text clips (a short line reads at a glance). */
  titleChars: number;
  detailChars: number;
  /** True when the limits were not seen on screen at the stated size. */
  provisional: boolean;
  /** The meaning group it belongs to, when the set has one (a bar chart, a ring, a line): the LLM chooses it, the motion within is style. */
  family?: string;
}

export interface MotionSet {
  /** The template name in scripts. */
  template: string;
  kind: SetKind;
  /** Which designer phase the pages come from. */
  phase: string;
  /** Used when a script names no variant: the one with the most room for text. */
  defaultVariant: string;
  variants: readonly MotionVariant[];
  /**
   * What the LLM chooses with `variant=`: "family" when the variants differ in meaning (a bar chart, a line, a ring), "variant" when each
   * is a different thing to show (the five kinds of interaction), "none" when they are all the same content in another motion (the
   * Director picks one).
   */
  choose: "family" | "variant" | "none";
  families?: readonly { id: string; when: string }[];
}

interface LimitRow { set: string; variant: string; items: { min: number; effectiveMax: number | null }; titleChars: number | null; detailChars: number | null; provisional?: boolean }
const rows = (limits as { variants: LimitRow[] }).variants;

/** Where each designer folder keeps its pages, and the key its pages read their data under. */
const PAGES = {
  steps: { limitSet: "steps", dir: "process-steps-motion", key: "process-steps-data-v1" },
  comparison: { limitSet: "comparison", dir: "comparison-motion", key: "comparison-data-v1" },
  timeline: { limitSet: "timeline", dir: "timeline-component", key: "timeline-component-data-v1" },
  titles: { limitSet: "titles", dir: "titles", key: "titles-data-v1" },
  stats: { limitSet: "stats", dir: "stats-motion", key: "stats-data-v2" },
  bar: { limitSet: "bar", dir: "charts/bar", key: "chart-bar-v1" },
  line: { limitSet: "line", dir: "charts/line", key: "chart-line-v1" },
  donut: { limitSet: "donut", dir: "charts/donut", key: "chart-donut-v1" },
  interaction: { limitSet: "interaction", dir: "interaction-motion", key: "interaction-kit-data-v1" },
} as const;
type Pages = keyof typeof PAGES;
const CHART_FAMILY: Partial<Record<Pages, string>> = { bar: "bars", line: "line", donut: "ring" };

function variant(pages: Pages, id: string, file: string, name: string, when: string, family?: string): MotionVariant {
  const p = PAGES[pages];
  const r = rows.find((x) => x.set === p.limitSet && x.variant === file);
  if (!r || r.titleChars === null) throw new Error(`no measured limits for ${p.limitSet}/${file}; run scripts/html-limits.mjs`);
  // A title opener's headline is measured at 1.6x the item scale (a headline is bigger than a step title).
  const headline = pages === "titles";
  return {
    id, file, name, when, dir: p.dir, key: p.key,
    // The comparison pages count the header (the side names) as item 1; for a script, items are the rows.
    items: pages === "comparison" ? [Math.max(1, r.items.min - 1), (r.items.effectiveMax ?? r.items.min) - 1] : [r.items.min, r.items.effectiveMax ?? r.items.min],
    titleChars: headline ? Math.min(Math.round(r.titleChars * 1.6), 60) : Math.min(r.titleChars, TITLE_CHARS_MAX),
    detailChars: Math.min(r.detailChars ?? DETAIL_CHARS_MAX, DETAIL_CHARS_MAX),
    provisional: r.provisional ?? false,
    ...((family ?? CHART_FAMILY[pages]) && { family: family ?? CHART_FAMILY[pages] }),
  };
}

export const STEPS: MotionSet = {
  choose: "none",
  template: "steps", kind: "steps", phase: "phase1", defaultVariant: "rail",
  variants: [
    variant("steps", "rail", "v3-number-rail", "Number Rail", "a numbered how-to: a big numeral rolls to each step beside its title and detail; the most neutral choice"),
    variant("steps", "deck", "v2-card-deck", "Card Deck", "self-contained steps, each a card with a title and detail; finished cards drop into a tray"),
    variant("steps", "accordion", "v3-accordion-focus", "Accordion Focus", "steps with a detail line, read like a list that opens one row at a time"),
    variant("steps", "path", "v1-path-walker", "Path Walker", "a journey with a start and an end: a traveller walks a winding road through the steps"),
    variant("steps", "stack", "v5-block-stack", "Block Stack", "each step builds on the last (layers, foundations): blocks drop onto each other"),
    variant("steps", "domino", "v6-domino-chain", "Domino Chain", "a chain reaction: each step triggers the next"),
    variant("steps", "orbit", "v4-orbit", "Orbit", "a process that repeats, 3 to 6 steps turning on a ring"),
    variant("steps", "dolly", "v6-dolly-pan", "Dolly Pan", "a few steps that each deserve the whole screen; the camera moves from one to the next"),
    variant("steps", "morph", "v1-morph-relay", "Morph Relay", "a transformation: one shape changes form at each step (keep the text short)"),
  ],
};

export const COMPARE: MotionSet = {
  choose: "family",
  families: [
    { id: "sides", when: "two options or a before and after put point against point, with no winner: a trade-off, or two things that differ" },
    { id: "verdict", when: "the right side wins: it is the better, newer or correct one on every row (ticks and crosses, or a scale that tips toward it)" },
  ],
  template: "compare", kind: "compare", phase: "phase1", defaultVariant: "split",
  variants: [
    variant("comparison", "split", "v1-split-wipe", "Split Wipe", "a before and after, or two options, as rows of matching points; a slider sweeps the frame apart (neither wins)", "sides"),
    variant("comparison", "verdict", "v2-verdict-columns", "Verdict Columns", "two cards where every row ends in a cross for the left and a tick for the right (the right is the better side)", "verdict"),
    variant("comparison", "balance", "v3-balance", "Balance", "a weighing scale that tips further toward the right side with every point (the right is the better side)", "verdict"),
    variant("comparison", "flip", "v4-flip-cards", "Flip Cards", "a problem on the front of each card and its solution on the back", "sides"),
    variant("comparison", "versus", "v5-versus", "Versus", "two rivals that clash in the middle, then each point is called out", "sides"),
  ],
};

export const TIMELINE: MotionSet = {
  choose: "none",
  template: "timeline", kind: "timeline", phase: "phase1", defaultVariant: "camera",
  variants: [
    variant("timeline", "camera", "v2-camera", "Camera Track", "dated events along a track while a camera moves from one to the next"),
    variant("timeline", "ribbon", "v1-ribbon", "Ribbon", "up to 8 dated events on one ribbon with cards above and below"),
    variant("timeline", "filmstrip", "v3-filmstrip", "Filmstrip Focus", "dated events as frames of a film strip, one in focus at a time"),
  ],
};

export const TITLE: MotionSet = {
  choose: "none",
  template: "title", kind: "title", phase: "phase1", defaultVariant: "rise",
  variants: [
    variant("titles", "rise", "v1-rise", "Rise", "the clean default opener: words slide up under an accent rule, then the subtitle settles in"),
    variant("titles", "curtain", "v2-curtain", "Curtain", "a theatrical opener: two panels part to reveal the title"),
    variant("titles", "logo", "v3-logo", "Logo reveal", "a brand or product opener: a ring and icon draw, then the name unfolds (needs one icon)"),
    variant("titles", "shine", "v4-shine", "Shine", "a premium, calm opener: the title resolves from a blur under a sweep of light"),
    variant("titles", "card", "v5-card", "Card", "a chapter or episode card tilted in 3D with an icon (needs one icon)"),
    variant("titles", "cinema", "v6-cinema", "Cinema", "a quiet, filmic opener with letterbox bars and a slow push-in"),
    variant("titles", "beam", "v7-beam", "Beam", "a band of light travels across and leaves the title sharp behind it"),
    variant("titles", "weight", "v8-weight", "Weight wave", "pure typography: letters swell from hairlines to full weight (keep the title short)"),
    variant("titles", "elastic", "v9-elastic", "Elastic", "letters snap in from tall and thin and settle with a wobble"),
    variant("titles", "depth", "v10-depth", "Depth", "each word arrives from far behind the screen"),
    variant("titles", "reel", "v11-reel", "Reel", "every letter spins like a slot reel and lands on the right character"),
    variant("titles", "liquid", "v12-liquid", "Liquid", "the title surfaces through rippling water"),
    variant("titles", "spot", "v13-spot", "Spotlight", "a pool of light travels along the title and leaves it lit"),
    variant("titles", "converge", "v14-converge", "Convergence", "three colour layers slide together into one sharp title"),
  ],
};

export const STATS: MotionSet = {
  choose: "family",
  families: [
    { id: "figures", when: "separate key figures one after another, or a series that changes (users, speed, cost, growth)" },
    { id: "shares", when: "parts of a whole, or sizes compared by area (a share out of 100, who has the most)" },
  ],
  template: "stats", kind: "stats", phase: "phase1", defaultVariant: "odometer",
  variants: [
    variant("stats", "odometer", "v1-odometer", "Odometer", "one big number at a time as a rolling counter, with a history rail of the earlier ones", "figures"),
    variant("stats", "tape", "v1-tape-measure", "Tape Measure", "values locked onto a ruler; the distance travelled is the change", "figures"),
    variant("stats", "swarm", "v2-unit-swarm", "Unit Swarm", "each figure pulls its share out of a cloud of 100 dots (shares of a whole)", "shares"),
    variant("stats", "tubes", "v3-liquid-tubes", "Liquid Tubes", "tubes that fill to each value, for comparing a few levels", "figures"),
    variant("stats", "bubbles", "v4-bubble-pack", "Bubble Pack", "bubbles whose area is the value, packed into a cluster (3 at most for now)", "shares"),
    variant("stats", "zoom", "v5-scale-zoom", "Scale Zoom", "nested squares whose area is the number; the camera pulls out as values grow (3 at most for now)", "shares"),
    variant("stats", "comet", "v6-comet-trail", "Comet Trail", "a comet draws a line through the values and the number rides on it (a trend, 2 to 8 points)", "figures"),
  ],
};

export const CHART: MotionSet = {
  choose: "family",
  families: [
    { id: "bars", when: "values compared across categories: sizes, a ranking, a few levels" },
    { id: "line", when: "a trend: how one value changes over time" },
    { id: "ring", when: "shares of a whole: each category's part of 100%" },
  ],
  template: "chart", kind: "chart", phase: "phase1", defaultVariant: "bar-rise",
  variants: [
    variant("bar", "bar-rise", "v1-spring-rise", "Spring Rise", "vertical bars that spring up one after another, values counting up"),
    variant("bar", "bar-race", "v2-sort-race", "Sort Race", "bars that rise, then slide into ranked order (a ranking)"),
    variant("bar", "bar-sweep", "v3-scan-sweep", "Scan Sweep", "bars shoot up as a scan line passes over them"),
    variant("bar", "bar-led", "v4-led-segments", "LED Segments", "bars as level meters that light up segment by segment"),
    variant("bar", "bar-wipe", "v5-glow-wipe", "Glow Wipe", "horizontal bars revealed by a bright edge (labels up to 14 characters, 5 bars)"),
    variant("line", "line-flat", "v1-rise-from-flat", "Rise from Flat", "a trend: the line springs up from the baseline point by point"),
    variant("line", "line-constellation", "v2-constellation", "Constellation", "a trend as glowing dots that link up, with the area glowing under it"),
    variant("line", "line-bars", "v3-bars-to-line", "Bars to Line", "columns whose tops join into a smooth line"),
    variant("line", "line-zoom", "v4-focus-zoom", "Focus Zoom", "a trend, then the camera pushes in on the peak and shows how far it rose"),
    variant("donut", "donut-focus", "v1-focus-ring", "Focus Ring", "shares of a whole as a ring, each slice lighting up in turn"),
    variant("donut", "donut-rings", "v2-activity-rings", "Activity Rings", "each category its own concentric ring filling to its share (5 at most)"),
    variant("donut", "donut-bar", "v3-bar-to-ring", "Bar to Ring", "shares as one 100% bar that bends into a ring"),
    variant("donut", "donut-ticks", "v4-radial-ticks", "Radial Ticks", "a ring of fine ticks lit by a sweeping beam, slice by slice"),
  ],
};

export const UI: MotionSet = {
  choose: "variant",
  template: "ui", kind: "interaction", phase: "phase1", defaultVariant: "prompt",
  variants: [
    variant("interaction", "prompt", "v3-prompt-send", "Prompt & Send", "someone typing a request and sending it (a chat or search box)"),
    variant("interaction", "click", "v1-cursor-click", "Cursor & Click", "a cursor clicking buttons one after another"),
    variant("interaction", "toggle", "v4-toggle-switches", "Toggle Switches", "a cursor flipping settings on and off (5 at most)"),
    variant("interaction", "drag", "v2-drag-drop", "Drag & Drop", "a card dragged into a drop zone"),
    variant("interaction", "swipe", "v5-touch-swipe", "Touch & Swipe", "a finger swiping through cards on a phone"),
  ],
};

export const MOTION_SETS: Record<string, MotionSet> = { steps: STEPS, compare: COMPARE, timeline: TIMELINE, title: TITLE, stats: STATS, chart: CHART, ui: UI };

export function motionSet(template: string): MotionSet | undefined {
  return MOTION_SETS[template];
}

export function motionVariant(set: MotionSet, id: string | undefined): MotionVariant {
  return set.variants.find((v) => v.id === id) ?? set.variants.find((v) => v.id === set.defaultVariant)!;
}

/** The page for a variant, under `base` (the host's answer for template URLs; see files.mjs). */
export function templateUrl(base: string, set: MotionSet, v: MotionVariant, theme: string): string {
  return `${base.replace(/\/$/, "")}/${set.phase}/${v.dir}/${v.file}.html?embed&paused&theme=${encodeURIComponent(theme)}`;
}

/** The four themes every designer template supports. */
export const THEMES = ["daylight-clean", "daylight-plain", "aurora-night", "aurora-plain"] as const;
export type MotionTheme = (typeof THEMES)[number];

/**
 * How many characters each string of an item may have, by position, for a variant. Strings past the end are not used.
 * (A short line is read at a glance; these are what the pages were measured to hold, see limits.json.)
 */
export function itemLimits(set: MotionSet, v: MotionVariant): number[] {
  switch (set.kind) {
    case "steps":
    case "interaction":
      return [v.titleChars, v.detailChars];
    case "compare":
      return [v.detailChars, v.detailChars];
    case "timeline":
      return [12, v.titleChars, v.detailChars];
    case "stats":
      return [v.titleChars, 12, 28];
    case "chart":
      return [Math.min(v.titleChars, 24), 12];
    case "title":
      return [];
  }
}

/** Characters for elements that fill a named slot (the heading, a side name, the byline...). */
export function slotLimits(set: MotionSet, v: MotionVariant): Record<string, number> {
  const heading = set.kind === "title" ? v.titleChars : 80;
  const named: Record<string, number> = { title: heading, kicker: 40 };
  if (set.kind === "compare") Object.assign(named, { left: 24, right: 24 });
  if (set.kind === "title") Object.assign(named, { subtitle: v.detailChars, kicker: 40, byline: 40, brand: 24 });
  return named;
}

/** What a scene says, as far as choosing a motion goes: the strings of each item, and the text in each named slot (`left`, `subtitle`...). */
export interface SceneContent {
  items: readonly (readonly string[])[];
  slots: Readonly<Record<string, string>>;
}

/** Whether every string of the scene is within what the variant was measured to hold. */
export function fitsText(set: MotionSet, v: MotionVariant, content: SceneContent): boolean {
  const per = itemLimits(set, v);
  const named = slotLimits(set, v);
  return content.items.every((texts) => texts.every((t, i) => t.length <= (per[i] ?? Infinity))) && Object.entries(content.slots).every(([id, t]) => t.length <= (named[id] ?? Infinity));
}

/** The names a script may write for `variant=` besides a variant id: the families the LLM chooses between. */
export function isFamily(set: MotionSet, name: string): boolean {
  return !!set.families?.some((f) => f.id === name);
}

/**
 * The variants a scene may be drawn with, given what it asked for: a variant id (just that one), a family (its variants), or nothing
 * / `auto` (the family of the default variant when the set has families, else all). Of those, the ones that take this many items
 * and this text. `fits` is false when none of the variants that take the items takes the text: the text is too long for the scene
 * (the pool then holds the variants that take the items, so the page still draws, with its own shrinking).
 */
export function motionPool(set: MotionSet, want: string | undefined, content: SceneContent): { pool: MotionVariant[]; fits: boolean } {
  const exact = set.variants.find((v) => v.id === want);
  if (exact) return { pool: [exact], fits: fitsText(set, exact, content) };
  const home = set.variants.find((v) => v.id === set.defaultVariant)!;
  const family = want && isFamily(set, want) ? want : home.family;
  const scope = set.variants.filter((v) => !family || v.family === family);
  const n = content.items.length;
  const byCount = scope.filter((v) => n >= v.items[0] && n <= v.items[1]);
  const roomy = (byCount.length ? byCount : scope).filter((v) => fitsText(set, v, content));
  return roomy.length ? { pool: roomy, fits: true } : { pool: byCount.length ? byCount : scope, fits: false };
}

/**
 * The variant a script gets when the Director has not picked one. A variant id is kept. With nothing written the default is used when
 * it fits the scene, else one that does; a family or `auto` picks among the variants that fit, the same one for the same `seed`.
 */
export function chooseVariant(set: MotionSet, want: string | undefined, content: SceneContent, seed: number): MotionVariant {
  const { pool } = motionPool(set, want, content);
  const exact = set.variants.find((v) => v.id === want);
  if (exact) return exact;
  if (want === undefined) return pool.find((v) => v.id === set.defaultVariant) ?? pool[seed % pool.length]!;
  return pool[seed % pool.length]!;
}

/** What the LLM may write for `variant=`, each with when to choose it. Empty when it is left to the engine. */
export function variantChoices(set: MotionSet): { id: string; when: string }[] {
  if (set.choose === "family") return [...(set.families ?? [])];
  if (set.choose === "variant") return set.variants.map((v) => ({ id: v.id, when: v.when }));
  return [];
}

/**
 * How long a title and a detail may be: `safe` fits every variant of the choice (a family, or the whole set), `max` fits at least one,
 * and past that it is an error. With text between the two, the engine has fewer motions to choose from.
 */
export function textLimits(set: MotionSet, choice?: string): { safe: { titleChars: number; detailChars: number }; max: { titleChars: number; detailChars: number } } {
  const vs = set.variants.filter((v) => !choice || v.family === choice || v.id === choice);
  const t = vs.map((v) => v.titleChars);
  const d = vs.map((v) => v.detailChars);
  return { safe: { titleChars: Math.min(...t), detailChars: Math.min(...d) }, max: { titleChars: Math.max(...t), detailChars: Math.max(...d) } };
}

/** What each string of an item is called, by template kind, for telling a writer how long it may be. */
const STRING_NAMES: Record<SetKind, string[]> = {
  steps: ["title", "detail"],
  interaction: ["label", "text"],
  compare: ["point", "point"],
  timeline: ["date", "title", "detail"],
  stats: ["label", "value", "change"],
  chart: ["label", "value"],
  title: [],
};

/**
 * The text limits of a choice (a family, or the whole set) in words: `safe` is what every variant of it takes, `max` what at least one
 * takes (past that it is an error). Per kind of string, so a chart says "label up to 14, value up to 12", not a title and a detail.
 */
export function limitsText(set: MotionSet, choice?: string): { safe: string; max: string } {
  const vs = set.variants.filter((v) => !choice || v.family === choice || v.id === choice);
  const per = vs.map((v) => ({ items: itemLimits(set, v), slots: slotLimits(set, v) }));
  const names = STRING_NAMES[set.kind];
  const words = (pick: (xs: number[]) => number) => {
    const parts = names.map((n, i) => `${n} up to ${pick(per.map((p) => p.items[i] ?? Infinity))}`);
    if (set.kind === "title") for (const slot of ["title", "subtitle"]) parts.push(`${slot === "title" ? "headline" : slot} up to ${pick(per.map((p) => p.slots[slot] ?? Infinity))}`);
    if (set.kind === "compare") parts.push(`side names up to ${pick(per.map((p) => p.slots.left ?? Infinity))}`);
    // Two strings with the same name (a compare row's two points) read as one limit.
    return [...new Set(parts)].join(", ");
  };
  return { safe: words((xs) => Math.min(...xs)), max: words((xs) => Math.max(...xs)) };
}

/** The strings an item has by position (see limitsText) and how many of them it must have: a compare row without its right point is empty on the page. */
export function itemStrings(set: MotionSet): { names: string[]; required: number } {
  const names = STRING_NAMES[set.kind];
  return { names, required: set.kind === "steps" ? 1 : names.length === 0 ? 0 : set.kind === "timeline" ? 2 : names.length > 2 ? 2 : names.length };
}

export * from "./page.js";
