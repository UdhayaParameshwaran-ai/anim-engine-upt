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
  { name: "focus", version: 1, category: "camera", summary: "zoom the camera to an element, or `reset`", defaultDuration: 0.9, mustFinish: false, targets: "required", supportsFit: true, params: { ease: { ...EASE, default: "inout" } } },
];

export const SLOTS = ["TL", "T", "TR", "L", "C", "R", "BL", "B", "BR"] as const;
export const RELATIONS = ["right-of", "left-of", "above", "below", "inside"] as const;
export const LAYOUTS = ["center", "row", "col", "grid", "split", "stack", "cycle"] as const;
export const TRANSITIONS = ["cut", "fade", "slide"] as const;
export const THEMES = ["chalk", "paper", "dark", "light", "editorial"] as const;
export const CHART_TYPES = ["bar", "line", "pie"] as const;
/** Scene attributes the DSL understands. */
export const SCENE_ATTRS = ["template", "grid", "in", "out", "keep"] as const;

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
}

const VISUAL = ["icon", "asset", "shape", "box", "circle", "card", "chart", "formula"] as const;
const TEXTUAL = ["title", "text", "label", "list"] as const;

export const TEMPLATES: readonly TemplateManifest[] = [
  { name: "title", version: 1, summary: "big title with optional subtitle", slots: [{ name: "title", accepts: ["title", "text"], required: true }, { name: "subtitle", accepts: ["text", "label"], required: false }] },
  { name: "compare", version: 1, summary: "two things side by side", slots: [{ name: "left", accepts: [...VISUAL, ...TEXTUAL], required: true }, { name: "right", accepts: [...VISUAL, ...TEXTUAL], required: true }, { name: "title", accepts: ["title", "text"], required: false }] },
  { name: "steps", version: 1, summary: "ordered sequence left to right", slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 6 } },
  { name: "cycle", version: 1, summary: "items on a loop with arrows", slots: [{ name: "center", accepts: [...VISUAL, ...TEXTUAL], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 3, max: 6 } },
  { name: "flow", version: 1, summary: "flowchart / graph of nodes and edges", slots: [], graph: { maxNodes: 12 } },
  { name: "timeline", version: 1, summary: "events along a horizontal line", slots: [], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 7 } },
  { name: "hub", version: 1, summary: "central idea with spokes", slots: [{ name: "center", accepts: [...VISUAL, ...TEXTUAL], required: true }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 8 } },
  { name: "grid", version: 1, summary: "cards in a grid", slots: [{ name: "title", accepts: ["title", "text"], required: false }], items: { accepts: [...VISUAL, ...TEXTUAL], min: 2, max: 9 } },
  { name: "spotlight", version: 1, summary: "one large visual with labels around it", slots: [{ name: "main", accepts: [...VISUAL], required: true }], items: { accepts: ["label", "text"], min: 0, max: 6 } },
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
  parts?: readonly string[] | "items" | "words";
  drawable: boolean;
}

export const COMPONENTS: readonly ComponentManifest[] = [
  { kind: "title", version: 1, layer: "svg", summary: "large heading", named: "none", texts: { min: 1, max: 1 }, link: false, params: {}, parts: "words", drawable: true },
  { kind: "text", version: 1, layer: "svg", summary: "body text", named: "none", texts: { min: 1, max: 1 }, link: false, params: {}, parts: "words", drawable: true },
  { kind: "label", version: 1, layer: "svg", summary: "short caption next to something", named: "none", texts: { min: 1, max: 1 }, link: false, params: {}, parts: "words", drawable: true },
  { kind: "list", version: 1, layer: "svg", summary: "bullet list; items split on ;", named: "none", texts: { min: 1, max: 1 }, link: false, params: {}, parts: "items", drawable: true },
  { kind: "card", version: 1, layer: "html", summary: "heading + body card", named: "none", texts: { min: 1, max: 2 }, link: false, params: {}, parts: ["head", "body"], drawable: false },
  { kind: "formula", version: 1, layer: "html", summary: "math formula (TeX)", named: "none", texts: { min: 1, max: 1 }, link: false, params: {}, parts: "items", drawable: false },
  { kind: "box", version: 1, layer: "svg", summary: "rounded rectangle, optional label", named: "none", texts: { min: 0, max: 1 }, link: false, params: { color: { type: "color", default: "fg" } }, drawable: true },
  { kind: "circle", version: 1, layer: "svg", summary: "circle, optional label", named: "none", texts: { min: 0, max: 1 }, link: false, params: { color: { type: "color", default: "fg" } }, drawable: true },
  { kind: "arrow", version: 1, layer: "svg", summary: "arrow between two elements", named: "none", texts: { min: 0, max: 1 }, link: true, params: { curve: { type: "enum", values: ["straight", "arc"], default: "straight" } }, drawable: true },
  { kind: "line", version: 1, layer: "svg", summary: "line between two elements", named: "none", texts: { min: 0, max: 1 }, link: true, params: { style: { type: "enum", values: ["solid", "dashed"], default: "solid" } }, drawable: true },
  { kind: "node", version: 1, layer: "svg", summary: "graph node for the flow template", named: "none", texts: { min: 1, max: 1 }, link: false, params: {}, drawable: true },
  { kind: "edge", version: 1, layer: "svg", summary: "graph edge (a -> b \"label\")", named: "none", texts: { min: 0, max: 1 }, link: true, params: {}, drawable: true },
  { kind: "icon", version: 1, layer: "svg", summary: "icon from the semantic library", named: "required", texts: { min: 0, max: 1 }, link: false, params: {}, drawable: true },
  { kind: "asset", version: 1, layer: "svg", summary: "illustration from the semantic library", named: "required", texts: { min: 0, max: 1 }, link: false, params: {}, drawable: true },
  { kind: "placeholder", version: 1, layer: "svg", summary: "labeled box standing in for a missing asset", named: "none", texts: { min: 0, max: 1 }, link: false, params: {}, drawable: true },
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

export function findTemplate(name: string): TemplateManifest | undefined {
  return TEMPLATES.find((t) => t.name === name);
}

export function findComponent(kind: string): ComponentManifest | undefined {
  return COMPONENTS.find((c) => c.kind === kind);
}

export * from "./grid.js";
export { findPlace, PLACES } from "./places.js";
export { AssetLibrary, flowNodes, partsOf, SEED_ASSETS, type AssetMatch, type PartsInput } from "./assets.js";
