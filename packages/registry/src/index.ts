import { CHART, COMPARE, STATS, STEPS, TIMELINE, TITLE, UI } from "@anim/html-templates";
/** The four themes of the designer templates. */
export { THEMES as MOTION_THEMES } from "@anim/html-templates";
import { SHAPES, TEMPLATE_GUIDES, type Shape, type TemplateGuide, type VariantGuide } from "./guide.js";
import { EXTRA_VARIANTS } from "./variants.js";

/**
 * The registry is the single source of truth for everything the DSL may
 * name: verbs, templates, layouts, slots, components and assets. The
 * validator, the engine and the LLM prompt builder all read from here, so
 * the LLM is never asked for something the engine cannot render.
 */

export type VerbCategory = "enter" | "exit" | "emphasis" | "transform" | "relation" | "camera";

export interface ParamSpec {
  type: "number" | "enum" | "string" | "color" | "bool" | "ref";
  values?: readonly string[];
  min?: number;
  max?: number;
  default?: string | number | boolean;
}

export interface VerbManifest {
  name: string;
  version: number;
  category: VerbCategory;
  /** One line for the LLM catalog and editor hovers. */
  summary: string;
  /** Seconds, used when the DSL gives none. */
  defaultDuration: number;
  /** If true, the resolver inserts silence rather than cutting this short. */
  mustFinish: boolean;
  /** Whether targets are required (`clear` and `focus reset` take none). */
  targets: "required" | "optional" | "none";
  supportsFit: boolean;
  params: Record<string, ParamSpec>;
  /** Written by the compiler, never by a script or the LLM (state lines lower to these): left out of prompts. */
  internal?: boolean;
}

const EASE: ParamSpec = { type: "enum", values: ["in", "out", "inout", "spring", "linear"], default: "out" };

export const VERBS: readonly VerbManifest[] = [
  { name: "fade", version: 1, category: "enter", summary: "fade in", defaultDuration: 0.5, mustFinish: false, targets: "required", supportsFit: true, params: { ease: EASE } },
  { name: "pop", version: 1, category: "enter", summary: "scale up with a small overshoot", defaultDuration: 0.45, mustFinish: false, targets: "required", supportsFit: false, params: { ease: { ...EASE, default: "spring" } } },
  { name: "draw", version: 1, category: "enter", summary: "draw strokes in (fades if not drawable)", defaultDuration: 0.9, mustFinish: false, targets: "required", supportsFit: true, params: { ease: EASE } },
  { name: "write", version: 1, category: "enter", summary: "reveal text", defaultDuration: 0, mustFinish: false, targets: "required", supportsFit: true, params: { by: { type: "enum", values: ["char", "word", "line"], default: "char" }, sync: { type: "bool", default: false }, until: { type: "ref" } } },
  { name: "hide", version: 1, category: "exit", summary: "fade out", defaultDuration: 0.4, mustFinish: false, targets: "required", supportsFit: false, params: { ease: EASE } },
  { name: "clear", version: 1, category: "exit", summary: "fade out everything on stage", defaultDuration: 0.5, mustFinish: true, targets: "none", supportsFit: false, params: {} },
  { name: "highlight", version: 1, category: "emphasis", summary: "tint and glow", defaultDuration: 1.2, mustFinish: false, targets: "required", supportsFit: true, params: { color: { type: "color", default: "accent" }, style: { type: "enum", values: ["glow", "marker", "underline"], default: "glow" }, until: { type: "ref" } } },
  { name: "pulse", version: 1, category: "emphasis", summary: "brief scale bump", defaultDuration: 0.5, mustFinish: false, targets: "required", supportsFit: false, params: {} },
  { name: "dim", version: 1, category: "emphasis", summary: "fade to 30% to push back", defaultDuration: 0.4, mustFinish: false, targets: "required", supportsFit: false, params: {} },
  { name: "move", version: 1, category: "transform", summary: "move to a slot or next to an element", defaultDuration: 0.7, mustFinish: false, targets: "required", supportsFit: true, params: { ease: { ...EASE, default: "inout" } } },
  { name: "scale", version: 1, category: "transform", summary: "scale by a factor", defaultDuration: 0.5, mustFinish: false, targets: "required", supportsFit: true, params: { by: { type: "number", min: 0.1, max: 5, default: 1.2 } } },
  { name: "send", version: 1, category: "relation", summary: "a packet travels along a connector (drawing it if it isn't shown yet); back=true goes the other way; fail=true stops it halfway (red); wait=<s> makes it pause halfway", defaultDuration: 0.9, mustFinish: false, targets: "required", supportsFit: true, params: { back: { type: "bool", default: false }, fail: { type: "bool", default: false }, wait: { type: "number", min: 0, max: 5, default: 0 } } },
  { name: "stream", version: 1, category: "relation", summary: "steady traffic: several packets in a row along a connector", defaultDuration: 1.8, mustFinish: false, targets: "required", supportsFit: true, params: { count: { type: "number", min: 2, max: 8, default: 3 }, back: { type: "bool", default: false } } },
  { name: "visit", version: 1, category: "emphasis", summary: "the current-position ring moves to this element (a search, a state machine, a traversal); the previous one is released", defaultDuration: 0.6, mustFinish: false, targets: "required", supportsFit: false, params: {} },
  { name: "mark", version: 1, category: "emphasis", summary: "leave a status tint on an element: as=ok (green), fail (red), visited (grey)", defaultDuration: 0.4, mustFinish: false, targets: "required", supportsFit: false, params: { as: { type: "enum", values: ["ok", "fail", "visited"], default: "ok" } } },
  { name: "set", version: 1, category: "transform", summary: 'change an element\'s text in place with a small bump: set status to="404 Not Found" (a status code, a label, a state name)', defaultDuration: 0.6, mustFinish: false, targets: "required", supportsFit: false, params: { to: { type: "string" } } },
  { name: "count", version: 1, category: "emphasis", summary: "a number counts up or down in the element's text: count hits from=0 to=1200 (suffix=\"ms\", prefix=\"$\", decimals=1)", defaultDuration: 1.4, mustFinish: false, targets: "required", supportsFit: true, params: { from: { type: "number" }, to: { type: "number" }, prefix: { type: "string" }, suffix: { type: "string" }, decimals: { type: "number", min: 0, max: 3, default: 0 } } },
  { name: "strike", version: 1, category: "emphasis", summary: "a line is struck through an element and it dims: a wrong option, a rejected request, something removed", defaultDuration: 0.5, mustFinish: false, targets: "required", supportsFit: false, params: {} },
  { name: "clone", version: 1, category: "relation", summary: "a copy flies from the first element to the others: clone a,b,c (a stays; b and c are declared hidden and appear as copies)", defaultDuration: 0.8, mustFinish: false, targets: "required", supportsFit: false, params: {} },
  { name: "merge", version: 1, category: "relation", summary: "several elements fly into the last one and it appears: merge a,b,c (c is declared hidden; a and b disappear into it)", defaultDuration: 0.9, mustFinish: false, targets: "required", supportsFit: false, params: {} },
  { name: "shake", version: 1, category: "emphasis", summary: "a quick sideways shake: an error, a rejection", defaultDuration: 0.5, mustFinish: false, targets: "required", supportsFit: false, params: {} },
  { name: "drop", version: 1, category: "enter", summary: "drops in from above and settles (push onto a stack, add to a queue)", defaultDuration: 0.6, mustFinish: false, targets: "required", supportsFit: false, params: { ease: { ...EASE, default: "spring" } } },
  { name: "lift", version: 1, category: "exit", summary: "lifts up and away (pop off a stack, remove)", defaultDuration: 0.5, mustFinish: false, targets: "required", supportsFit: false, params: {} },
  { name: "swap", version: 1, category: "transform", summary: "two elements trade places along arcs: swap a,b", defaultDuration: 0.8, mustFinish: false, targets: "required", supportsFit: false, params: {} },
  { name: "frame", version: 1, category: "camera", summary: "the camera frames several elements together: frame a,b,c (focus reset to pull out)", defaultDuration: 0.9, mustFinish: false, targets: "required", supportsFit: true, params: { ease: { ...EASE, default: "inout" } } },
  { name: "focus", version: 1, category: "camera", summary: "zoom the camera to an element, or `reset`", defaultDuration: 0.9, mustFinish: false, targets: "required", supportsFit: true, params: { ease: { ...EASE, default: "inout" } } },
  // Written by the compiler for trace scenes: a state line is `state`, a mark change is `tint` (it can also clear).
  { name: "state", version: 1, category: "relation", summary: "the whole contents of a collection from now on (a state line)", defaultDuration: 0, mustFinish: false, targets: "required", supportsFit: false, params: {}, internal: true },
  { name: "tint", version: 1, category: "relation", summary: "set an element's status tint, or clear it", defaultDuration: 0.3, mustFinish: false, targets: "required", supportsFit: false, params: { to: { type: "number", min: 0, max: 1, default: 1 }, color: { type: "color", default: "accent" } }, internal: true },
];

/**
 * A motion personality: how the same verbs move. Scripts never change; the
 * personality rescales default durations, reinterprets ease names and gives
 * enter verbs their own entrance (rise, blur, slide, zoom).
 */
export interface MotionProfile {
  name: string;
  summary: string;
  /** Multiplies verb default durations (explicit, fit and until durations are kept). */
  durScale: number;
  /** Multiplies explicit staggers. */
  staggerScale: number;
  /** Ease name in the script → ease the engine uses. */
  ease: Partial<Record<"in" | "out" | "inout" | "spring" | "linear", string>>;
  /** How `fade` (and non-drawable `draw`) enters, besides opacity. */
  fade: "plain" | "rise" | "blur" | "slide" | "zoom";
  /** How `pop` enters: starting scale, ease, optional starting blur (px). */
  pop: { from: number; ease: string; blur?: number };
  /** Distance for rise/slide entrances, in px on a 1920-wide canvas. */
  distance: number;
  /**
   * Distance template items travel as they enter, from the direction their
   * template gives them (out of a hub, in toward a result, along a sequence).
   * 0 = they enter in place.
   */
  drift: number;
  /** Slow camera move over each scene, as a share of the frame: in on one scene, out on the next (0 = the camera holds still). */
  push: number;
  /** How far pictures float while they are on screen, in px on a 1920-wide canvas (0 = they hold still). */
  idle: number;
  /** Peak scale of `pulse`. */
  pulse: number;
  /** Scene transitions `in=auto` rotates through, scene by scene. */
  transitions: string[];
}

export const MOTIONS: readonly MotionProfile[] = [
  // The original behavior: older scripts render exactly as before.
  { name: "standard", summary: "balanced fades and springy pops", durScale: 1, staggerScale: 1, ease: {}, fade: "plain", pop: { from: 0.6, ease: "spring" }, distance: 0, drift: 36, push: 0.03, idle: 3, pulse: 1.15, transitions: ["fade"] },
  { name: "playful", summary: "bouncy and overshooting; things hop in", durScale: 0.9, staggerScale: 1, ease: { out: "back", spring: "elastic" }, fade: "rise", pop: { from: 0.3, ease: "elastic" }, distance: 48, drift: 80, push: 0.035, idle: 6, pulse: 1.25, transitions: ["zoom", "iris", "rise"] },
  { name: "corporate", summary: "quick, clean, subtle rise-ins", durScale: 0.8, staggerScale: 0.8, ease: { out: "quart", spring: "quart" }, fade: "rise", pop: { from: 0.94, ease: "quart" }, distance: 18, drift: 32, push: 0.025, idle: 2, pulse: 1.06, transitions: ["rise", "wipe", "fade"] },
  { name: "cinematic", summary: "slow and smooth; blur-to-focus reveals", durScale: 1.5, staggerScale: 1.6, ease: { out: "expo", spring: "expo", inout: "sine" }, fade: "blur", pop: { from: 1.08, ease: "expo", blur: 14 }, distance: 0, drift: 28, push: 0.05, idle: 3, pulse: 1.08, transitions: ["blur", "fade", "zoom"] },
  { name: "energetic", summary: "fast, punchy slides that snap into place", durScale: 0.65, staggerScale: 0.7, ease: { out: "back", spring: "back", inout: "quart" }, fade: "slide", pop: { from: 0.2, ease: "back" }, distance: 90, drift: 130, push: 0.035, idle: 4, pulse: 1.3, transitions: ["wipe", "slide", "zoom"] },
  { name: "minimal", summary: "calm, quiet fades only", durScale: 1.1, staggerScale: 1.2, ease: { out: "sine", spring: "sine", inout: "sine" }, fade: "plain", pop: { from: 1, ease: "sine" }, distance: 0, drift: 0, push: 0, idle: 0, pulse: 1.04, transitions: ["fade"] },
  { name: "dramatic", summary: "weighty zoom-ins from depth", durScale: 1.25, staggerScale: 1.3, ease: { out: "expo", spring: "back" }, fade: "zoom", pop: { from: 1.6, ease: "expo", blur: 8 }, distance: 0, drift: 0, push: 0.06, idle: 2, pulse: 1.2, transitions: ["zoom", "iris", "blur"] },
];

export function findMotion(name: string | undefined): MotionProfile {
  return MOTIONS.find((m) => m.name === name) ?? MOTIONS[0]!;
}

export const SLOTS = ["TL", "T", "TR", "L", "C", "R", "BL", "B", "BR"] as const;
export const RELATIONS = ["right-of", "left-of", "above", "below", "inside"] as const;
export const LAYOUTS = ["center", "row", "col", "grid", "split", "stack", "cycle"] as const;
/** Scene transitions; `auto` (the default) takes the next one from the motion personality's set. */
export const TRANSITIONS = ["auto", "cut", "fade", "slide", "wipe", "iris", "zoom", "blur", "rise"] as const;

/**
 * Decor kits: how the lines and cards a template draws look, one per video (besides its look).
 * `plain` is the look's own; the others change connectors and panels.
 */
export const KITS = ["plain", "dashed", "bold", "soft"] as const;
export const KIT_SUMMARIES: Record<(typeof KITS)[number], string> = {
  plain: "the look's own lines and cards",
  dashed: "dashed connectors, dashed card borders: sketched, draft-like",
  bold: "thick connectors, strong card borders: loud and clear",
  soft: "dotted connectors, borderless cards: light and airy",
};

/** Looks: token sets the engine defines (fonts, palette, shapes, emphasis). Picked per video with `theme`. */
export const THEMES = ["chalk", "paper", "dark", "light", "editorial", "neo-brutal", "soft-pastel", "tech-neon", "magazine", "bold-pop", "crayon", "midnight-luxe", "blueprint"] as const;
/** One line per look, for the LLM and the style director. */
export const THEME_SUMMARIES: Record<(typeof THEMES)[number], string> = {
  // Every look draws on a white board for now; they differ in ink, type and shapes.
  chalk: "handwritten marker on a whiteboard, friendly classroom",
  paper: "warm ink, clean and neutral",
  dark: "near-black ink, blue accent, calm and modern",
  light: "crisp product style, Apple-like",
  editorial: "monochrome print layout, black on white",
  "neo-brutal": "thick black outlines, hard shadows, loud orange",
  "soft-pastel": "lavender pastels, rounded and gentle",
  "tech-neon": "techy cyan accents, uppercase grotesk, mono labels",
  magazine: "serif headlines, burgundy accent",
  "bold-pop": "electric blue, heavy rounded type, punchy",
  crayon: "kids' notebook, crayon colors, handwriting",
  "midnight-luxe": "navy ink, gold accents, elegant serif",
  blueprint: "engineering drawing, navy mono lines, square corners",
};
export const CHART_TYPES = ["bar", "line", "pie"] as const;
/** Scene attributes the DSL understands. */
export const SCENE_ATTRS = ["template", "grid", "compose", "in", "out", "keep", "carry", "frame", "variant", "emphasis", "density", "mirror", "check", "theme"] as const;

/** `compose=`: arrangements the constraint solver understands (`auto` tries them all). */
export const COMPOSE_PATTERNS = ["auto", "hero-left", "hero-right", "hero-top", "hero-center", "columns", "rows", "pyramid", "z"] as const;

/** Layout knobs (scene attributes) every template and grid scene understands. */
export const LAYOUT_KNOBS = {
  /** `emphasis=first|last|<id>`: that element gets more room. */
  emphasis: "first|last|<id>",
  density: ["airy", "normal", "tight"],
  /** Flip the layout left↔right. */
  mirror: ["true", "false"],
  /** `close`: the scene opens with the camera close on its first item (or the emphasized one) and pulls out. */
  frame: ["close"],
} as const;

/** A template slot: where content goes. The template decides geometry. */
export interface SlotSpec {
  name: string;
  accepts: readonly string[];
  required: boolean;
}

/**
 * Scene template. The LLM picks the template and fills slots in the DSL;
 * `layout` (implemented in the engine) computes all coordinates.
 */
export interface TemplateManifest {
  name: string;
  version: number;
  summary: string;
  /** Named slots, filled by element ids that match the slot name. */
  slots: readonly SlotSpec[];
  /** For item templates (steps, cycle, grid): element ids fill in order. */
  items?: { accepts: readonly string[]; min: number; max: number };
  /** Graph templates take nodes and edges. */
  graph?: { maxNodes: number };
  /** Arrangements of the same slots (`variant=`); the first is the default. */
  variants: readonly string[];
  /** Drawn by one of the designer's HTML pages (packages/html-templates) instead of by our layout: the items' texts go to the page. */
  html?: boolean;
  /** What the template means and when to use it (guide.ts). */
  guide: TemplateGuide;
}

const VISUAL = ["icon", "asset", "shape", "box", "circle", "card", "chart", "formula"] as const;
const TEXTUAL = ["title", "text", "label", "list"] as const;

const TECH = ["code", "terminal"] as const;
/** The collections of a trace scene: declared once, their contents written after each sentence. */
export const COLLECTIONS = ["row", "stack", "queue", "set", "pairs", "chain", "buckets", "graph", "tree", "heap", "plot", "ring", "lanes", "net"] as const;

const BASE_TEMPLATES: readonly Omit<TemplateManifest, "guide">[] = [
  { name: "title", version: 2, summary: "the opening headline, shown by a designed motion; optional subtitle, kicker, byline, brand and one icon", html: true, slots: [{ name: "title", accepts: ["title", "text"], required: true }, { name: "subtitle", accepts: ["text", "label"], required: false }, { name: "kicker", accepts: ["text", "label"], required: false }, { name: "byline", accepts: ["text", "label"], required: false }, { name: "brand", accepts: ["text", "label"], required: false }], items: { accepts: ["icon", "asset"], min: 0, max: 1 }, variants: TITLE.variants.map((v) => v.id) },
  { name: "compare", version: 2, summary: "two things contrasted: side names (left, right), then rows of matching points (the right side is the better one), shown by a designed motion", html: true, slots: [{ name: "left", accepts: ["label", "text"], required: true }, { name: "right", accepts: ["label", "text"], required: true }, { name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 1, max: 5 }, variants: COMPARE.variants.map((v) => v.id) },
  { name: "steps", version: 2, summary: "ordered steps, each with a title and a detail line, shown by a motion (a rolling number rail, a card deck, a walked path...)", html: true, slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 6 }, variants: STEPS.variants.map((v) => v.id) },
  { name: "stats", version: 1, summary: "key figures: each is a label and a value (with an optional change), shown by a designed motion", html: true, slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 1, max: 6 }, variants: STATS.variants.map((v) => v.id) },
  { name: "chart", version: 1, summary: "values as a chart: bars, a line or a ring; each item is a label and a value, shown by a designed motion", html: true, slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: ["label", "text", ...VISUAL], min: 2, max: 8 }, variants: CHART.variants.map((v) => v.id) },
  { name: "ui", version: 1, summary: "someone using an interface: clicking, typing and sending, toggling, dragging or swiping; each item is a control and what it does, shown by a designed motion", html: true, slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 1, max: 6 }, variants: UI.variants.map((v) => v.id) },
  { name: "cycle", version: 1, summary: "items on a loop with arrows", slots: [{ name: "center", accepts: [...VISUAL, ...TEXTUAL], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 3, max: 6 }, variants: ["ring", "arc"] },
  { name: "flow", version: 1, summary: "flowchart / graph of nodes and edges", slots: [], graph: { maxNodes: 12 }, variants: ["auto", "down", "across"] },
  { name: "timeline", version: 2, summary: "dated events in order: each event is a date, a title and a detail, shown by a designed motion", html: true, slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: ["label", "text", ...VISUAL], min: 2, max: 8 }, variants: TIMELINE.variants.map((v) => v.id) },
  { name: "hub", version: 1, summary: "central idea with spokes", slots: [{ name: "center", accepts: [...VISUAL, ...TEXTUAL], required: true }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 8 }, variants: ["ring", "sides"] },
  { name: "cards", version: 1, summary: "cards of equal weight in rows", slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 9 }, variants: ["auto", "feature", "strip"] },
  { name: "spotlight", version: 1, summary: "one large visual with labels around it", slots: [{ name: "main", accepts: [...VISUAL], required: true }], items: { accepts: ["label", "text"], min: 0, max: 6 }, variants: ["center", "left", "right"] },
  // Flow shapes: the template places the parts; declared arrows (a1 = arrow sun->leaf) connect them.
  { name: "converge", version: 1, summary: "several inputs flow into one result (the template draws the arrows)", slots: [{ name: "result", accepts: [...VISUAL, ...TEXTUAL], required: true }, { name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 5 }, variants: ["left", "top", "around"] },
  { name: "diverge", version: 1, summary: "one source produces several outputs (the template draws the arrows)", slots: [{ name: "source", accepts: [...VISUAL, ...TEXTUAL], required: true }, { name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 5 }, variants: ["right", "bottom", "around"] },
  { name: "process", version: 1, summary: "inputs go through a process and come out as outputs: declare inputs, then process, then outputs (the template draws the arrows)", slots: [{ name: "process", accepts: [...VISUAL, ...TEXTUAL], required: true }, { name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 8 }, variants: ["across", "down", "equation"] },
  // Software & tech concepts.
  { name: "exchange", version: 1, summary: "a sequence diagram: participants side by side with lifelines; arrows between them are messages, in time order top to bottom", slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 5 }, variants: ["lanes", "compact"] },
  { name: "architecture", version: 1, summary: "components grouped into zones (tiers), joined by the arrows you declare", slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL, "zone"], min: 2, max: 14 }, variants: ["tiers", "layers"] },
  { name: "stack", version: 1, summary: "layers stacked on each other, top layer declared first", slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 7 }, variants: ["bands", "centered"] },
  { name: "structure", version: 1, summary: "a data structure made of value cells (array, linked list, stack, queue); pointers are labels placed @above:<cell>", slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: ["box", "text", "label", "circle", "icon"], min: 2, max: 8 }, variants: ["array", "list", "stack", "queue"] },
  { name: "tree", version: 1, summary: "a hierarchy: the lines you declare join each parent to its children", slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 12 }, variants: ["down", "right"] },
  { name: "states", version: 1, summary: "a state machine: states joined by the transitions you declare", slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL, "node"], min: 2, max: 8 }, variants: ["across", "down"] },
  { name: "gitgraph", version: 1, summary: "commits on branch lanes: a zone starts a lane, the lines you declare join each commit to the next", slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL, "zone"], min: 2, max: 14 }, variants: ["lanes"] },
  { name: "anatomy", version: 1, summary: "the parts of a message or format side by side; labels placed @below:<part> name them", slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: ["box", "text", "label"], min: 2, max: 7 }, variants: ["bar", "stacked"] },
  { name: "trace", version: 1, summary: "data that changes step by step (an algorithm run, a queue, a cache): declare collections, then write their whole contents after each sentence; the engine animates the difference", slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...COLLECTIONS], min: 1, max: 3 }, variants: ["main"] },
  { name: "code", version: 1, summary: "a code or terminal panel with notes beside it", slots: [{ name: "code", accepts: [...TECH], required: true }, { name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...TEXTUAL, "icon", "box", ...TECH], min: 0, max: 4 }, variants: ["notes", "stacked", "split"] },
];

/** Component (element kind) manifest: `icon`, `text`, `arrow`, `chart`, ... */
export interface ComponentManifest {
  kind: string;
  version: number;
  layer: "svg" | "html";
  summary: string;
  /** Whether `kind:name` is required (icon:sun) or forbidden (text). */
  named: "required" | "none";
  /** How many quoted strings it takes. */
  texts: { min: number; max: number };
  /** Needs `a->b`. */
  link: boolean;
  params: Record<string, ParamSpec>;
  /** Named sub-parts addressable as `id.part`; "items" means numbered (list.1). */
  parts?: readonly string[] | "items" | "words" | "lines";
  drawable: boolean;
}

export const COMPONENTS: readonly ComponentManifest[] = [
  { kind: "title", version: 1, layer: "svg", summary: "large heading", named: "none", texts: { min: 1, max: 1 }, link: false, params: {}, parts: "words", drawable: true },
  { kind: "text", version: 1, layer: "svg", summary: "body text", named: "none", texts: { min: 1, max: 1 }, link: false, params: {}, parts: "words", drawable: true },
  { kind: "label", version: 1, layer: "svg", summary: "short caption next to something; more strings after the first are read by templates that show them: a date, title and detail (timeline), a label and a value (chart)", named: "none", texts: { min: 1, max: 3 }, link: false, params: {}, parts: "words", drawable: true },
  { kind: "list", version: 1, layer: "svg", summary: "bullet list; items split on ;", named: "none", texts: { min: 1, max: 1 }, link: false, params: {}, parts: "items", drawable: true },
  { kind: "card", version: 1, layer: "html", summary: "heading + body card", named: "none", texts: { min: 1, max: 2 }, link: false, params: {}, parts: ["head", "body"], drawable: false },
  { kind: "formula", version: 1, layer: "html", summary: "math formula (TeX)", named: "none", texts: { min: 1, max: 1 }, link: false, params: {}, parts: "items", drawable: false },
  { kind: "box", version: 1, layer: "svg", summary: "rounded rectangle, optional label", named: "none", texts: { min: 0, max: 1 }, link: false, params: { color: { type: "color", default: "fg" } }, drawable: true },
  { kind: "circle", version: 1, layer: "svg", summary: "circle, optional label", named: "none", texts: { min: 0, max: 1 }, link: false, params: { color: { type: "color", default: "fg" } }, drawable: true },
  { kind: "arrow", version: 1, layer: "svg", summary: "arrow between two elements", named: "none", texts: { min: 0, max: 1 }, link: true, params: { curve: { type: "enum", values: ["straight", "arc"], default: "straight" } }, drawable: true },
  { kind: "line", version: 1, layer: "svg", summary: "line between two elements", named: "none", texts: { min: 0, max: 1 }, link: true, params: { style: { type: "enum", values: ["solid", "dashed"], default: "solid" } }, drawable: true },
  { kind: "node", version: 1, layer: "svg", summary: "graph node for the flow template", named: "none", texts: { min: 1, max: 1 }, link: false, params: {}, drawable: true },
  { kind: "edge", version: 1, layer: "svg", summary: "graph edge (a -> b \"label\")", named: "none", texts: { min: 0, max: 1 }, link: true, params: {}, drawable: true },
  { kind: "icon", version: 1, layer: "svg", summary: "icon from the semantic library; more strings after the label are read by templates that show them: a detail (steps, interaction), a value and a change (stats)", named: "required", texts: { min: 0, max: 3 }, link: false, params: {}, drawable: true },
  { kind: "asset", version: 1, layer: "svg", summary: "illustration from the semantic library; more strings after the label are read by templates that show them: a detail (steps)", named: "required", texts: { min: 0, max: 3 }, link: false, params: {}, drawable: true },
  { kind: "placeholder", version: 1, layer: "svg", summary: "labeled box standing in for a missing asset", named: "none", texts: { min: 0, max: 1 }, link: false, params: {}, drawable: true },
  { kind: "code", version: 1, layer: "svg", summary: 'code panel (look=window|tabs|card|light, anim=type|lines|walk, file=name for tabs); lines split on \\n: code "const a = 1;\\nreturn a" lang=js', named: "none", texts: { min: 1, max: 1 }, link: false, params: { lang: { type: "string", default: "" }, file: { type: "string", default: "" }, look: { type: "enum", values: ["window", "tabs", "card", "light", "terminal"] }, anim: { type: "enum", values: ["type", "lines", "walk"], default: "type" } }, parts: "lines", drawable: true },
  { kind: "terminal", version: 1, layer: "svg", summary: 'terminal; lines starting "$ " are commands, the rest output: terminal "$ git status\\nOn branch main"', named: "none", texts: { min: 1, max: 1 }, link: false, params: { look: { type: "enum", values: ["window", "tabs", "card", "light", "terminal"] }, anim: { type: "enum", values: ["type", "lines", "walk"], default: "type" } }, parts: "lines", drawable: true },
  // Collections of a trace scene. Never drawn as such: the compiler turns their states into cells.
  { kind: "row", version: 1, layer: "svg", summary: "trace collection: an array of cells in a row, index numbers under the slots", named: "none", texts: { min: 0, max: 1 }, link: false, params: {}, drawable: false },
  { kind: "stack", version: 1, layer: "svg", summary: "trace collection: cells piled upward, the last one on top", named: "none", texts: { min: 0, max: 1 }, link: false, params: {}, drawable: false },
  { kind: "queue", version: 1, layer: "svg", summary: "trace collection: cells in line, front on the left, back on the right", named: "none", texts: { min: 0, max: 1 }, link: false, params: {}, drawable: false },
  { kind: "set", version: 1, layer: "svg", summary: "trace collection: a panel of values in the order they were added (visited nodes, a result list)", named: "none", texts: { min: 0, max: 1 }, link: false, params: {}, drawable: false },
  { kind: "pairs", version: 1, layer: "svg", summary: "trace collection: key and value rows (distances, counts, a cache); items are key:value", named: "none", texts: { min: 0, max: 1 }, link: false, params: {}, drawable: false },
  { kind: "chain", version: 1, layer: "svg", summary: "trace collection: a linked list. Nodes in order with an arrow from each to the next and null at the end; `/` starts a detached chain below, `| d->c` adds an arrow", named: "none", texts: { min: 0, max: 1 }, link: false, params: {}, drawable: false },
  { kind: "buckets", version: 1, layer: "svg", summary: "trace collection: a hash table. n numbered rows, each a chain of nodes (`buckets n=5`); write a bucket as `2: 12 7` (its number, then its nodes in order)", named: "none", texts: { min: 0, max: 1 }, link: false, params: { n: { type: "number", min: 2, max: 8, default: 5 } }, drawable: false },
  { kind: "graph", version: 1, layer: "svg", summary: "trace collection: a graph drawn from its edges, `graph \"A-B A-C B-D:4\"` (A-B:4 gives the edge a weight); a state lists the nodes to show, with marks and `node:value` labels", named: "none", texts: { min: 1, max: 2 }, link: false, params: {}, drawable: false },
  { kind: "tree", version: 1, layer: "svg", summary: "trace collection: a tree drawn from parent>child edges, `tree \"R>A R>B A>C\"`; a state lists the nodes to show (a node appears when it is listed), with marks and `node:value` labels", named: "none", texts: { min: 1, max: 2 }, link: false, params: {}, drawable: false },
  { kind: "heap", version: 1, layer: "svg", summary: "trace collection: a binary heap. Write its values like an array (`h: 1 3 8 5`); it is drawn as a tree, the children of slot i being slots 2i+1 and 2i+2, so a swap moves values along the tree", named: "none", texts: { min: 0, max: 1 }, link: false, params: {}, drawable: false },
  { kind: "plot", version: 1, layer: "svg", summary: "trace collection: a curve with points on it. `plot \"(x-3)^2\" from=0 to=9`; a state lists x values, each a point on the curve joined by an arrow to the one before (a descent, a search)", named: "none", texts: { min: 1, max: 2 }, link: false, params: { from: { type: "number" }, to: { type: "number" } }, drawable: false },
  { kind: "ring", version: 1, layer: "svg", summary: "trace collection: positions on a circle. Items are `name:angle` (0 to 359, clockwise from the top); `| k->B` adds an arrow, a clockwise walk to the owner", named: "none", texts: { min: 0, max: 1 }, link: false, params: {}, drawable: false },
  { kind: "lanes", version: 1, layer: "svg", summary: "trace collection: a time axis with parallel lanes. Write a lane as its name and its segments, each `label:start-end` in seconds (`lanes to=30`; `t: poll: a:0-1 b:5-6 push: c:0-30`); a mark colours a segment (! red for a failure)", named: "none", texts: { min: 0, max: 1 }, link: false, params: { to: { type: "number", min: 1 } }, drawable: false },
  { kind: "net", version: 1, layer: "svg", summary: "trace collection: a neural network from its layer sizes, `net \"2 3 1\"`; nodes are x1.. (inputs), a1.. b1.. (hidden layers), y1.. (outputs), each joined to every node of the next layer; a state lists the nodes shown with `node:value` and marks (`*` forward, `!` blame travelling back)", named: "none", texts: { min: 1, max: 2 }, link: false, params: {}, drawable: false },
  { kind: "zone", version: 1, layer: "svg", summary: "named group of components (architecture): the elements declared after it belong to it", named: "none", texts: { min: 1, max: 1 }, link: false, params: {}, drawable: true },
  { kind: "chart", version: 1, layer: "svg", summary: "chart:bar|line|pie data=3,5,8 labels=A,B,C", named: "required", texts: { min: 0, max: 1 }, link: false, params: { data: { type: "string" }, data2: { type: "string" }, labels: { type: "string" } }, parts: "items", drawable: true },
  // Grid elements (Template Rule Book v2). Lists use `;`, fields within an item use `|`.
  ...widgets([
    ["stat", "headline number with a label", 1, 2, {}, "none"],
    ["multistat", "2 to 4 numbers", 1, 2, {}, "items"],
    ["gauge", "one value against a range", 1, 2, { max: { type: "number", min: 1, default: 100 } }, "none"],
    ["scorecard", "score as filled marks", 1, 2, { max: { type: "number", min: 1, max: 10, default: 5 } }, "items"],
    ["progress", "progress bar with a label", 1, 2, {}, "none"],
    ["body", "short paragraph", 1, 1, {}, "none"],
    ["quote", "pull quote with its source", 1, 2, {}, "none"],
    ["callout", "boxed key takeaway", 1, 1, {}, "none"],
    ["definition", "term and its meaning", 1, 2, {}, ["term", "meaning"]],
    ["proscons", "for and against columns", 2, 2, {}, ["pros", "cons"]],
    ["bullets", "bullet list", 1, 1, {}, "items"],
    ["numbered", "numbered list", 1, 1, {}, "items"],
    ["checklist", "list with tick boxes", 1, 1, {}, "items"],
    ["table", "rows and columns", 1, 1, { key: { type: "number", min: 1, max: 6 } }, "items"],
    ["comparison", "two options compared row by row", 2, 2, {}, "items"],
    ["stepper", "numbered steps", 1, 1, {}, "items"],
    ["timeline", "events along a line", 1, 1, {}, "items"],
    ["flowchart", "boxes joined by arrows", 1, 1, {}, "items"],
    ["funnel", "narrowing stages", 1, 1, {}, "items"],
    ["cycle", "repeating loop of stages", 1, 1, {}, "items"],
    ["matrix", "2 x 2 matrix with dots", 2, 2, {}, "items"],
    ["image", "picture slot (cover crop)", 1, 1, {}, "none"],
    ["video", "muted clip slot", 1, 1, {}, "none"],
    ["avatar", "person card", 1, 2, {}, "none"],
    ["logo", "brand mark", 1, 1, {}, "none"],
    ["map", "outline map with pins", 1, 1, {}, "items"],
    ["footer", "page footer with a note", 0, 1, {}, "none"],
  ]),
];

function widgets(rows: [string, string, number, number, Record<string, ParamSpec>, readonly string[] | "items" | "none"][]): ComponentManifest[] {
  return rows.map(([kind, summary, min, max, params, parts]) => ({
    kind,
    version: 1,
    layer: "svg" as const,
    summary,
    named: "none" as const,
    texts: { min, max },
    link: false,
    params,
    ...(parts !== "none" && { parts }),
    drawable: true,
  }));
}

/**
 * Entry in the semantic SVG library. Assets are named by meaning; the
 * resolver maps what the LLM wrote (`sunlight`) to an entry via synonyms.
 */
export interface AssetManifest {
  /** Namespaced semantic name: `sun`, `cell.plant`. */
  name: string;
  version: string;
  kind: "icon" | "asset";
  file: string;
  tags: readonly string[];
  synonyms: readonly string[];
  /** Width / height. */
  aspect: number;
  drawable: boolean;
  parts: readonly string[];
  /** Connection points for arrows; defaults to n/s/e/w/center. */
  ports?: readonly string[];
  /** ≤10 words; shown to the LLM in the retrieved catalog. */
  description: string;
}

export function findVerb(name: string): VerbManifest | undefined {
  return VERBS.find((v) => v.name === name);
}

/** Templates, with approved variants from the authoring pipeline appended. */
export const TEMPLATES: readonly TemplateManifest[] = BASE_TEMPLATES.map((t) => {
  const extra = EXTRA_VARIANTS.filter((v) => v.template === t.name && v.status === "approved");
  const guide = TEMPLATE_GUIDES[t.name]!;
  const variants: Record<string, VariantGuide> = { ...guide.variants };
  for (const v of extra) variants[v.name] ??= { when: v.summary, ...(v.items && { items: v.items }) };
  return { ...t, variants: [...t.variants, ...extra.map((v) => v.name)], guide: { ...guide, variants } };
});

/** How to use one variant of a template (falls back to the template summary). */
export function variantGuide(tpl: TemplateManifest, variant: string): VariantGuide {
  return tpl.guide.variants[variant] ?? { when: tpl.summary };
}

/** Templates that show a shape, in registry order. */
export function templatesFor(shape: Shape): TemplateManifest[] {
  return TEMPLATES.filter((t) => t.guide.shape === shape);
}

/** Old or mistaken template names: `grid` was renamed `cards` (it clashed with `grid=` pages). */
export const TEMPLATE_ALIASES: Readonly<Record<string, string>> = { grid: "cards" };

/**
 * The template a name means: a template name, an alias (`grid` → `cards`)
 * or a shape name written as a template (`template=transform` → `process`).
 */
export function resolveTemplate(name: string): TemplateManifest | undefined {
  const alias = TEMPLATE_ALIASES[name];
  if (alias) return findTemplate(alias);
  return findTemplate(name) ?? (name in SHAPES ? templatesFor(name as Shape)[0] : undefined);
}

/** Draft variants of a template (usable only when drafts are allowed). */
export function draftVariants(template: string): string[] {
  return EXTRA_VARIANTS.filter((v) => v.template === template && v.status === "draft").map((v) => v.name);
}

export function findTemplate(name: string): TemplateManifest | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

export function findComponent(kind: string): ComponentManifest | undefined {
  return COMPONENTS.find((c) => c.kind === kind);
}

export * from "./grid.js";
export { SHAPES, TEMPLATE_GUIDES, type Shape, type TemplateGuide, type VariantGuide } from "./guide.js";
export { EXTRA_VARIANTS, type ExtraVariant } from "./variants.js";
export { findPlace, PLACES } from "./places.js";
export { AssetIndex, stem, tokens, type SearchHit, type SearchOptions } from "./search.js";
export { AssetLibrary, flowNodes, iconSet, isSetIcon, partsOf, SEED_ASSETS, type AssetMatch, type PartsInput } from "./assets.js";
