/**
 * Grid scenes, from the Template Rule Book v2: a page frame (header,
 * content, footer), a 12-column grid, 27 approved slot layouts and 34
 * elements that can sit in a slot. The LLM picks a layout code and lists
 * the elements in reading order; every coordinate comes from here.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The page grid at 1920×1080. Other canvas sizes scale it. */
export const GRID = { width: 1920, height: 1080, margin: 96, columns: 12, gutter: 32, baseline: 8 } as const;

export type HeaderMode = "sub" | "title" | "none";

/** Six frame modes: the header and footer only change the content area's height. */
export interface FrameMode {
  id: string;
  header: HeaderMode;
  footer: boolean;
  /** Content area top and height. */
  y: number;
  h: number;
}

export const FRAME_MODES: readonly FrameMode[] = [
  { id: "A", header: "sub", footer: true, y: 230, h: 750 },
  { id: "B", header: "title", footer: true, y: 184, h: 796 },
  { id: "C", header: "none", footer: true, y: 96, h: 884 },
  { id: "D", header: "sub", footer: false, y: 230, h: 754 },
  { id: "E", header: "title", footer: false, y: 184, h: 800 },
  { id: "F", header: "none", footer: false, y: 96, h: 888 },
];

export function frameMode(header: HeaderMode, footer: boolean): FrameMode {
  return FRAME_MODES.find((m) => m.header === header && m.footer === footer)!;
}

export interface GridSlot {
  /** 1-based start column. */
  col: number;
  span: number;
  row: number;
  rowSpan: number;
}

export interface GridLayout {
  code: string;
  name: string;
  family: "Single" | "Columns" | "Rows" | "Rail" | "Featured" | "Banner" | "Grid";
  /** Equal row bands the content area is cut into. */
  rows: number;
  /** In reading order (left to right, top to bottom); also the animation order. */
  slots: readonly GridSlot[];
}

const L = (code: string, name: string, family: GridLayout["family"], rows: number, slots: [number, number, number, number][]): GridLayout => ({
  code,
  name,
  family,
  rows,
  slots: slots.map(([col, span, row, rowSpan]) => ({ col, span, row, rowSpan })),
});

export const GRID_LAYOUTS: readonly GridLayout[] = [
  L("L1-01", "Full width", "Single", 1, [[1, 12, 0, 1]]),
  L("L1-02", "Centered", "Single", 1, [[3, 8, 0, 1]]),
  L("L2-01", "Side by side 50/50", "Columns", 1, [[1, 6, 0, 1], [7, 6, 0, 1]]),
  L("L2-02", "Stacked 50/50", "Rows", 2, [[1, 12, 0, 1], [1, 12, 1, 1]]),
  L("L2-03", "Left 1/3 + Right 2/3", "Columns", 1, [[1, 4, 0, 1], [5, 8, 0, 1]]),
  L("L2-04", "Left 2/3 + Right 1/3", "Columns", 1, [[1, 8, 0, 1], [9, 4, 0, 1]]),
  L("L2-05", "Left 5/12 + Right 7/12", "Columns", 1, [[1, 5, 0, 1], [6, 7, 0, 1]]),
  L("L2-06", "Left 7/12 + Right 5/12", "Columns", 1, [[1, 7, 0, 1], [8, 5, 0, 1]]),
  L("L2-07", "Banner top 1/3 + Body 2/3", "Rows", 3, [[1, 12, 0, 1], [1, 12, 1, 2]]),
  L("L2-08", "Body 2/3 + Banner bottom 1/3", "Rows", 3, [[1, 12, 0, 2], [1, 12, 2, 1]]),
  L("L2-09", "Narrow rail + Wide body", "Rail", 1, [[1, 3, 0, 1], [4, 9, 0, 1]]),
  L("L3-01", "Three columns", "Columns", 1, [[1, 4, 0, 1], [5, 4, 0, 1], [9, 4, 0, 1]]),
  L("L3-02", "Big left + 2 stacked right", "Featured", 2, [[1, 7, 0, 2], [8, 5, 0, 1], [8, 5, 1, 1]]),
  L("L3-03", "2 stacked left + Big right", "Featured", 2, [[1, 5, 0, 1], [1, 5, 1, 1], [6, 7, 0, 2]]),
  L("L3-04", "Wide top + 2 bottom", "Banner", 2, [[1, 12, 0, 1], [1, 6, 1, 1], [7, 6, 1, 1]]),
  L("L3-05", "2 top + Wide bottom", "Banner", 2, [[1, 6, 0, 1], [7, 6, 0, 1], [1, 12, 1, 1]]),
  L("L3-06", "Three rows (list view)", "Rows", 3, [[1, 12, 0, 1], [1, 12, 1, 1], [1, 12, 2, 1]]),
  L("L3-07", "Rail + 2 stacked", "Rail", 2, [[1, 3, 0, 2], [4, 9, 0, 1], [4, 9, 1, 1]]),
  L("L3-08", "Hero 2/3 + 2 thin bottom", "Banner", 3, [[1, 12, 0, 2], [1, 6, 2, 1], [7, 6, 2, 1]]),
  L("L4-01", "2 x 2 grid", "Grid", 2, [[1, 6, 0, 1], [7, 6, 0, 1], [1, 6, 1, 1], [7, 6, 1, 1]]),
  L("L4-02", "Four columns", "Columns", 1, [[1, 3, 0, 1], [4, 3, 0, 1], [7, 3, 0, 1], [10, 3, 0, 1]]),
  L("L4-03", "Four rows (list view)", "Rows", 4, [[1, 12, 0, 1], [1, 12, 1, 1], [1, 12, 2, 1], [1, 12, 3, 1]]),
  L("L4-04", "Big left + 3 stacked right", "Featured", 3, [[1, 7, 0, 3], [8, 5, 0, 1], [8, 5, 1, 1], [8, 5, 2, 1]]),
  L("L4-05", "3 stacked left + Big right", "Featured", 3, [[1, 5, 0, 1], [1, 5, 1, 1], [1, 5, 2, 1], [6, 7, 0, 3]]),
  L("L4-06", "Wide top + 3 bottom", "Banner", 2, [[1, 12, 0, 1], [1, 4, 1, 1], [5, 4, 1, 1], [9, 4, 1, 1]]),
  L("L4-07", "3 top + Wide bottom", "Banner", 2, [[1, 4, 0, 1], [5, 4, 0, 1], [9, 4, 0, 1], [1, 12, 1, 1]]),
  L("L4-08", "Offset 2 + 2 (7/5 over 5/7)", "Grid", 2, [[1, 7, 0, 1], [8, 5, 0, 1], [1, 5, 1, 1], [6, 7, 1, 1]]),
];

export function findGridLayout(code: string): GridLayout | undefined {
  return GRID_LAYOUTS.find((l) => l.code.toLowerCase() === code.toLowerCase());
}

const COL = (GRID.width - 2 * GRID.margin - 11 * GRID.gutter) / 12;
const spanW = (n: number) => n * COL + (n - 1) * GRID.gutter;
const colX = (c: number) => GRID.margin + (c - 1) * (COL + GRID.gutter);

/** Slot rectangles of a layout in a frame mode (at 1920×1080), in reading order. */
export function slotRects(layout: GridLayout, mode: FrameMode): Rect[] {
  const rh = (mode.h - GRID.gutter * (layout.rows - 1)) / layout.rows;
  return layout.slots.map((s) => ({
    x: Math.round(colX(s.col)),
    y: Math.round(mode.y + s.row * (rh + GRID.gutter)),
    w: Math.round(spanW(s.span)),
    h: Math.round(s.rowSpan * rh + (s.rowSpan - 1) * GRID.gutter),
  }));
}

/** Header and footer bands of the frame (at 1920×1080). */
export function frameRects(mode: FrameMode): { title?: Rect; subtitle?: Rect; footer?: Rect } {
  const x = GRID.margin;
  const w = GRID.width - 2 * GRID.margin;
  return {
    ...(mode.header !== "none" && { title: { x, y: GRID.margin, w, h: 64 } }),
    ...(mode.header === "sub" && { subtitle: { x, y: GRID.margin + 72, w, h: 40 } }),
    ...(mode.footer && { footer: { x, y: GRID.height - GRID.margin + 20, w, h: 40 } }),
  };
}

export type SlotShape = "banner" | "wide" | "landscape" | "square" | "portrait";

/** Five slot shapes, one image ratio each. */
export function shapeOf(w: number, h: number): SlotShape {
  const a = w / h;
  return a >= 2.2 ? "banner" : a >= 1.6 ? "wide" : a >= 1.2 ? "landscape" : a >= 0.9 ? "square" : "portrait";
}

export type ElementRole = "primary" | "flex" | "support";

export interface GridElement {
  /** Rule book id: `stat`, `bar`, `illustration`, ... */
  id: string;
  /** DSL kind (and name for `chart:bar`, `asset:<name>`). */
  kind: string;
  chart?: string;
  group: "Pictures" | "Numbers" | "Text" | "Points" | "Data" | "Process";
  /** primary can carry a template · flex can carry or support · support never alone. */
  role: ElementRole;
  minW: number;
  minH: number;
  /** DSL shape shown to the LLM. */
  syntax: string;
  limits: string;
  /** Signature motion, played by `draw`. */
  motion: string;
}

const E = (
  id: string,
  kind: string,
  group: GridElement["group"],
  role: ElementRole,
  minW: number,
  minH: number,
  syntax: string,
  limits: string,
  motion: string,
  chart?: string,
): GridElement => ({ id, kind, group, role, minW, minH, syntax, limits, motion, ...(chart && { chart }) });

export const GRID_ELEMENTS: readonly GridElement[] = [
  E("image", "image", "Pictures", "primary", 400, 300, `image "what the picture shows"`, "cover crop", "slow push-in"),
  E("illustration", "asset", "Pictures", "primary", 400, 300, `asset:<name> ["caption"]`, "from the asset list", "parts draw in, then a slow push-in"),
  E("icon", "icon", "Pictures", "support", 160, 160, `icon:<name> ["label"]`, "one per template", "pops in with a small rotation"),
  E("video", "video", "Pictures", "primary", 400, 300, `video "what the clip shows"`, "max 8 s loop", "starts on the slot's reveal"),
  E("avatar", "avatar", "Pictures", "support", 240, 240, `avatar "Name" "Role"`, "name 1 line, role 1 line", "photo fades in, name types on"),
  E("logo", "logo", "Pictures", "support", 160, 80, `logo "Brand"`, "never the largest slot", "fade in only"),
  E("map", "map", "Pictures", "primary", 560, 360, `map "India;Brazil;Kenya"`, "up to 5 places (countries, continents, big cities)", "pins drop in one by one"),
  E("stat", "stat", "Numbers", "flex", 360, 240, `stat "95%" "label"`, "value max 7 chars, label max 6 words", "counts up, then a small pop"),
  E("multistat", "multistat", "Numbers", "flex", 720, 200, `multistat "95%;12M;3" "label;label;label"`, "2 to 4 values, each max 5 chars, labels max 3 words", "numbers count in turn"),
  E("gauge", "gauge", "Numbers", "flex", 320, 320, `gauge "72" "label" [max=100]`, "one value, one label", "arc sweeps to the value"),
  E("scorecard", "scorecard", "Numbers", "flex", 400, 240, `scorecard "4" "label" [max=5]`, "one score, up to 10 marks", "marks fill in order"),
  E("progress", "progress", "Numbers", "support", 400, 160, `progress "60%" "label"`, "one bar, one label", "fill sweeps to the value"),
  E("body", "body", "Text", "flex", 480, 200, `body "short paragraph"`, "max 60 words", "lines rise in with a short stagger"),
  E("quote", "quote", "Text", "flex", 560, 240, `quote "words" "source"`, "max 25 words, source one line", "left to right wipe"),
  E("callout", "callout", "Text", "support", 400, 150, `callout "key takeaway"`, "max 20 words, one per template", "left to right wipe"),
  E("definition", "definition", "Text", "flex", 480, 200, `definition "Term" "meaning"`, "term max 3 words, meaning max 20", "term lands, meaning wipes in"),
  E("proscons", "proscons", "Text", "flex", 640, 280, `proscons "pro;pro" "con;con"`, "max 4 per column", "columns enter left then right"),
  E("formula", "formula", "Text", "flex", 560, 160, `formula "E = mc²"`, "one line, max 24 chars", "characters type on"),
  E("bullets", "bullets", "Points", "flex", 480, 240, `bullets "point;point;point"`, "max 5 items", "items enter in turn"),
  E("numbered", "numbered", "Points", "flex", 480, 240, `numbered "first;second;third"`, "max 5 items", "numbers then text, in turn"),
  E("checklist", "checklist", "Points", "flex", 480, 280, `checklist "item;item;item"`, "max 5 items", "ticks draw in order"),
  E("bar", "chart", "Data", "primary", 560, 320, `chart:bar data=12,48,95 labels=A,B,C`, "max 6 bars", "bars grow, values count up", "bar"),
  E("line", "chart", "Data", "primary", 640, 320, `chart:line data=1,3,2,5 [data2=..] labels=..`, "max 12 points, 2 series", "line draws left to right", "line"),
  E("pie", "chart", "Data", "primary", 400, 320, `chart:pie data=50,30,20 labels=A,B,C`, "max 5 slices", "slices sweep in clockwise", "pie"),
  E("table", "table", "Data", "primary", 640, 240, `table "Head|Head;cell|cell;cell|cell" [key=2]`, "max 6 rows, 4 columns", "rows enter in turn, key row flips to black"),
  E("comparison", "comparison", "Data", "primary", 640, 320, `comparison "Option A|Option B" "a|b;a|b"`, "2 options, max 5 rows", "options slide in from each side"),
  E("stepper", "stepper", "Process", "primary", 520, 240, `stepper "Step|one line;Step|one line"`, "3 to 5 steps", "steps enter in order, connectors draw"),
  E("timeline", "timeline", "Process", "primary", 640, 280, `timeline "1796|event;1885|event"`, "3 to 6 events", "line draws, events appear in order"),
  E("flowchart", "flowchart", "Process", "primary", 720, 320, `flowchart "Start>Check;Check>Done:yes;Check>Retry:no"`, "max 6 nodes", "nodes enter, arrows draw between them"),
  E("funnel", "funnel", "Process", "primary", 400, 320, `funnel "Visitors|1000;Signups|300;Paid|50"`, "3 to 5 stages", "stages drop in from the top"),
  E("cycle", "cycle", "Process", "primary", 400, 320, `cycle "stage;stage;stage"`, "3 to 5 stages", "stages light up in turn around the loop"),
  E("matrix", "matrix", "Process", "primary", 400, 320, `matrix "X axis|Y axis" "dot|x,y;dot|x,y"`, "x,y from 0 to 10, up to 4 dots", "axes draw, dots land"),
];

/** Element kinds the rule book calls small: never the largest slot, never alone. */
export const SMALL_ELEMENTS = ["icon", "logo", "avatar", "progress"] as const;
export const CHART_ELEMENTS = ["bar", "line", "pie"] as const;

/** The rule-book element for a DSL element, if it can sit in a grid slot. */
export function gridElementOf(kind: string, name?: string): GridElement | undefined {
  if (kind === "chart") return GRID_ELEMENTS.find((e) => e.chart === (name ?? "bar"));
  return GRID_ELEMENTS.find((e) => e.kind === kind);
}

/** Older kinds that have a grid equivalent (auto-fix). */
export const GRID_ALIASES: Record<string, string> = { text: "body", list: "bullets", card: "definition", label: "callout" };

/** Header/footer element ids of a grid scene. */
export const GRID_FRAME_IDS = { title: "title", subtitle: "subtitle" } as const;

export interface GridRule {
  id: string;
  title: string;
  text: string;
}

export const GRID_RULES: readonly GridRule[] = [
  { id: "R1", title: "1 to 4 slots", text: "More items go inside one element, such as a list, table or multi-stat." },
  { id: "R2", title: "Layouts come from the catalog", text: "Use one of the 27 approved layouts." },
  { id: "R3", title: "One element in every slot", text: "No empty slots and no slot with two elements. One idea per slot." },
  { id: "R4", title: "The slot must be big enough", text: "A slot is at least the element's minimum size in both width and height." },
  { id: "R5", title: "Something must carry the template", text: "At least one slot holds a primary or flex element." },
  { id: "R6", title: "Small assets stay small", text: "Icon, logo, avatar and progress are never in the largest slot of a multi-slot layout, and never alone." },
  { id: "R7", title: "Per-template limits", text: "At most 1 callout, 1 icon and 2 charts." },
  { id: "R8", title: "No repeats", text: "The same element is not used twice, except charts and stat." },
  { id: "R9", title: "Fixed spacing", text: "Margin 96 px, 12 columns, gap 32 px, 8 px baseline (applied by the layout engine)." },
  { id: "R10", title: "Text limits", text: "Title max 2 lines. Body max 60 words. Bullets max 5. Callout max 20 words." },
  { id: "R11", title: "Reading order", text: "Slots are numbered left to right, top to bottom. That number is also the animation order." },
  { id: "R12", title: "Pictures are cropped, not stretched", text: "Images, video and illustrations use cover crop (applied by the engine)." },
];
