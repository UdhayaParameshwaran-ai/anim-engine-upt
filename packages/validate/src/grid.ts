import type { Beat, ElementDecl, Scene, Span } from "@anim/dsl";
import {
  CHART_ELEMENTS,
  findGridLayout,
  flowNodes,
  frameMode,
  GRID_ALIASES,
  GRID_ELEMENTS,
  GRID_LAYOUTS,
  gridElementOf,
  slotRects,
  SMALL_ELEMENTS,
  VERBS,
  type FrameMode,
  type GridElement,
  type GridLayout,
} from "@anim/registry";
import { closest } from "./fuzzy.js";

/** Grid-scene diagnostics (Template Rule Book v2, rules R1–R11). */
export const GridCodes = {
  UnknownGridLayout: "NAR420",
  SlotCount: "NAR421",
  NotGridElement: "NAR422",
  SlotTooSmall: "NAR423",
  NoCarrier: "NAR424",
  SmallInLargest: "NAR425",
  TemplateLimit: "NAR426",
  Repeat: "NAR427",
  TextLimit: "NAR428",
  ReadingOrder: "NAR429",
  GridAndTemplate: "NAR430",
  GridPlacement: "NAR431",
} as const;

interface Fix {
  desc: string;
  apply: () => void;
}

export interface GridReporter {
  autofix: boolean;
  error(code: string, message: string, span: Span, fix?: Fix): void;
  warn(code: string, message: string, span: Span, fix?: Fix): void;
}

const G = GridCodes;
const LINK_KINDS = new Set(["arrow", "line", "edge"]);
const HEADER_KINDS = new Set(["title", "text", "label"]);
const ENTER = new Set(VERBS.filter((v) => v.category === "enter").map((v) => v.name));

/** Header, footer and content elements of a grid scene; content in reading (declaration) order. */
export function gridParts(own: readonly ElementDecl[]) {
  const isHeader = (e: ElementDecl) => (e.id === "title" || e.id === "subtitle") && HEADER_KINDS.has(e.kind);
  return {
    title: own.find((e) => e.id === "title" && isHeader(e)),
    subtitle: own.find((e) => e.id === "subtitle" && isHeader(e)),
    footer: own.find((e) => e.kind === "footer"),
    content: own.filter((e) => !isHeader(e) && e.kind !== "footer" && !LINK_KINDS.has(e.kind)),
  };
}

/** The frame mode a grid scene's elements ask for. */
export function gridMode(own: readonly ElementDecl[]): FrameMode {
  const p = gridParts(own);
  return frameMode(p.subtitle ? "sub" : p.title ? "title" : "none", Boolean(p.footer));
}

const spec = (e: ElementDecl): GridElement | undefined => gridElementOf(e.kind, e.name);

/** Rule R4/R6 problems of putting `content` (in order) into `layout`. */
function fitProblems(layout: GridLayout, mode: FrameMode, content: readonly ElementDecl[]) {
  const rects = slotRects(layout, mode);
  const largest = rects.reduce((best, r, i) => (r.w * r.h > rects[best]!.w * rects[best]!.h ? i : best), 0);
  const tooSmall: { el: ElementDecl; slot: number; w: number; h: number; s: GridElement }[] = [];
  const small: { el: ElementDecl; slot: number; alone: boolean }[] = [];
  content.forEach((el, i) => {
    const s = spec(el);
    const r = rects[i];
    if (!s || !r) return;
    if (r.w < s.minW || r.h < s.minH) tooSmall.push({ el, slot: i + 1, w: r.w, h: r.h, s });
    if ((SMALL_ELEMENTS as readonly string[]).includes(s.id) && (rects.length === 1 || i === largest)) small.push({ el, slot: i + 1, alone: rects.length === 1 });
  });
  return { tooSmall, small };
}

/** A layout with the same slot count where everything fits: same family first, then catalog order. */
function betterLayout(current: GridLayout | undefined, n: number, mode: FrameMode, content: readonly ElementDecl[]): GridLayout | undefined {
  const candidates = GRID_LAYOUTS.filter((l) => l.slots.length === n && l !== current);
  candidates.sort((a, b) => Number(b.family === current?.family) - Number(a.family === current?.family));
  return candidates.find((l) => {
    const p = fitProblems(l, mode, content);
    return !p.tooSmall.length && !p.small.length;
  });
}

/** Content element ids in the order an enter verb first shows them. */
function showOrder(scene: Scene): string[] {
  const order: string[] = [];
  const beats: Beat[] = scene.steps.flatMap((s) => s.beats);
  for (const beat of beats) {
    const pos = (anchor: string) => {
      if (anchor === "start") return -1;
      if (anchor === "end" || beat.type === "wait") return Number.MAX_SAFE_INTEGER;
      return beat.cues.find((c) => c.id === anchor)?.start ?? Number.MAX_SAFE_INTEGER;
    };
    const actions = [...beat.actions].sort((a, b) => pos(a.anchor) - pos(b.anchor));
    for (const a of actions)
      for (const call of a.calls) {
        if (!ENTER.has(call.verb)) continue;
        for (const t of call.targets) {
          const id = t.split(".")[0]!;
          if (!order.includes(id)) order.push(id);
        }
      }
  }
  return order;
}

/** R10 and the per-element limits. Returns a problem description, if any. */
export function elementLimit(el: ElementDecl): string | undefined {
  const words = (s = "") => s.split(/\s+/).filter(Boolean).length;
  const items = (s = "") => s.split(";").map((x) => x.trim()).filter(Boolean);
  const t0 = el.texts[0] ?? "";
  const t1 = el.texts[1] ?? "";
  const data = (el.attrs.data ?? "").split(",").filter(Boolean).length;
  const range = (n: number, min: number, max: number, what: string) => (n < min || n > max ? `${what}: ${min === max ? max : `${min} to ${max}`} (got ${n})` : undefined);
  switch (el.kind) {
    case "title":
      return el.id === "title" && t0.length > 110 ? `title max 2 lines (~110 characters, got ${t0.length})` : undefined;
    case "body":
      return words(t0) > 60 ? `body max 60 words (got ${words(t0)})` : undefined;
    case "callout":
      return words(t0) > 20 ? `callout max 20 words (got ${words(t0)})` : undefined;
    case "quote":
      return words(t0) > 25 ? `quote max 25 words (got ${words(t0)})` : undefined;
    case "stat":
      return t0.length > 7 ? `stat value max 7 characters (got "${t0}")` : words(t1) > 6 ? "stat label max 6 words" : undefined;
    case "multistat": {
      const vals = items(t0);
      return range(vals.length, 2, 4, "multistat values") ?? (vals.some((v) => v.length > 5) ? "multistat values max 5 characters each" : undefined);
    }
    case "definition":
      return words(t0) > 3 ? "definition term max 3 words" : words(t1) > 20 ? "definition meaning max 20 words" : undefined;
    case "proscons":
      return items(t0).length > 4 || items(t1).length > 4 ? "pros and cons max 4 per column" : undefined;
    case "formula":
      return t0.length > 24 ? `formula max 24 characters (got ${t0.length})` : undefined;
    case "bullets":
    case "numbered":
    case "checklist":
    case "list":
      return range(items(t0).length, 1, 5, `${el.kind} items`);
    case "table": {
      const rows = items(t0);
      return range(rows.length, 1, 6, "table rows") ?? (rows.some((r) => r.split("|").length > 4) ? "table max 4 columns" : undefined);
    }
    case "comparison":
      return t0.split("|").length !== 2 ? "comparison needs exactly 2 options: \"A|B\"" : range(items(t1).length, 1, 5, "comparison rows");
    case "stepper":
      return range(items(t0).length, 3, 5, "stepper steps");
    case "timeline":
      return range(items(t0).length, 3, 6, "timeline events");
    case "flowchart":
      return range(flowNodes(t0).length, 2, 6, "flowchart nodes");
    case "funnel":
      return range(items(t0).length, 3, 5, "funnel stages");
    case "cycle":
      return range(items(t0).length, 3, 5, "cycle stages");
    case "matrix":
      return t0.split("|").length !== 2 ? "matrix needs two axis labels: \"X|Y\"" : range(items(t1).length, 1, 4, "matrix dots");
    case "map":
      return range(items(t0).length, 1, 5, "map places");
    case "chart":
      if (el.name === "pie") return range(data, 2, 5, "pie slices");
      if (el.name === "line") return range(data, 2, 12, "line points");
      return range(data, 1, 6, "bars");
  }
  return undefined;
}

/**
 * Checks a grid scene against the rule book. Fixable problems (layout
 * code typos, slot count, elements that don't fit, reading order) get
 * deterministic fixes; the rest are reported for the LLM to repair.
 */
export function checkGrid(scene: Scene, own: ElementDecl[], r: GridReporter): void {
  const code = scene.attrs.grid!;
  if (scene.attrs.template !== undefined) {
    r.error(G.GridAndTemplate, "a scene uses either `grid=` or `template=`, not both", scene.span, { desc: "removed `template`", apply: () => delete scene.attrs.template });
  }

  // Placements are decided by the grid: elements fill slots in reading order.
  for (const el of own) {
    if (!el.place) continue;
    r.warn(G.GridPlacement, `\`${el.id}\`: grid scenes place elements in declaration order; \`@\` placements are ignored`, el.span, { desc: "removed the placement", apply: () => delete el.place });
  }

  const parts = gridParts(own);

  // Every content element must be a rule-book element.
  for (const el of parts.content) {
    if (spec(el)) continue;
    const alias = GRID_ALIASES[el.kind];
    r.error(G.NotGridElement, `\`${el.kind}\` can't fill a grid slot (elements: ${GRID_ELEMENTS.map((e) => (e.chart ? `chart:${e.chart}` : e.kind)).join(", ")})`, el.span, alias
      ? { desc: `used \`${alias}\``, apply: () => (el.kind = alias) }
      : undefined);
  }
  if (r.autofix) parts.content.splice(0, parts.content.length, ...gridParts(own).content.filter((e) => own.includes(e)));

  for (const el of own) {
    const problem = elementLimit(el);
    if (problem) r.warn(G.TextLimit, `R10: ${problem}`, el.span);
  }

  const n = parts.content.length;
  if (n === 0) {
    r.error(G.SlotCount, "R3: a grid scene needs 1 to 4 content elements", scene.span);
    return;
  }
  if (n > 4) {
    r.error(G.SlotCount, `R1: at most 4 slots (got ${n} elements); put more items inside one element (bullets, table, multistat)`, scene.span);
    return;
  }

  // R11: the reading order is the animation order.
  const shown = showOrder(scene).filter((id) => parts.content.some((e) => e.id === id));
  const declaredOrder = parts.content.map((e) => e.id).filter((id) => shown.includes(id));
  if (shown.join() !== declaredOrder.join()) {
    const step = scene.steps.find((s) => parts.content.every((e) => s.elements.includes(e)));
    r.warn(G.ReadingOrder, `R11: slots fill in declaration order, which is also the animation order; shown order is ${shown.join(", ")}`, parts.content[0]!.span, step
      ? {
          desc: "reordered the declarations to match",
          apply: () => {
            const rank = (e: ElementDecl) => {
              const i = shown.indexOf(e.id);
              return i < 0 ? shown.length + parts.content.indexOf(e) : i;
            };
            const sorted = [...parts.content].sort((a, b) => rank(a) - rank(b));
            const slots = step.elements.map((e, i) => (parts.content.includes(e) ? i : -1)).filter((i) => i >= 0);
            slots.forEach((pos, k) => (step.elements[pos] = sorted[k]!));
            parts.content.splice(0, n, ...sorted);
          },
        }
      : undefined);
  }

  // R2 (catalog) and R1/R3 (one element per slot).
  const mode = gridMode(own);
  let layout = findGridLayout(code);
  if (!layout) {
    const byName = closest(code, GRID_LAYOUTS.map((l) => l.code), 2) ?? GRID_LAYOUTS.find((l) => l.name.toLowerCase() === code.toLowerCase())?.code;
    const near = byName ? findGridLayout(byName) : undefined;
    const pick = near && near.slots.length === n ? near : (betterLayout(undefined, n, mode, parts.content) ?? GRID_LAYOUTS.find((l) => l.slots.length === n)!);
    r.error(G.UnknownGridLayout, `R2: unknown grid layout \`${code}\`; use a code like L3-02`, scene.span, { desc: `used \`${pick.code}\``, apply: () => (scene.attrs.grid = pick.code) });
    if (!r.autofix) return;
    layout = pick;
  } else if (layout.slots.length !== n) {
    const pick = betterLayout(undefined, n, mode, parts.content) ?? GRID_LAYOUTS.find((l) => l.slots.length === n)!;
    r.error(G.SlotCount, `R3: \`${layout.code}\` has ${layout.slots.length} slot(s) but the scene has ${n} element(s)`, scene.span, { desc: `used \`${pick.code}\` (${pick.name})`, apply: () => (scene.attrs.grid = pick.code) });
    if (!r.autofix) return;
    layout = pick;
  }

  // R4 / R6: try another layout of the same size before giving up.
  const problems = fitProblems(layout, mode, parts.content);
  if (problems.tooSmall.length || problems.small.length) {
    const alt = betterLayout(layout, n, mode, parts.content);
    const fix = alt ? { desc: `used \`${alt.code}\` (${alt.name})`, apply: () => (scene.attrs.grid = alt.code) } : undefined;
    const report = alt ? r.error.bind(r) : r.warn.bind(r);
    for (const p of problems.tooSmall) {
      report(G.SlotTooSmall, `R4: \`${p.el.id}\` (${p.s.id}) needs at least ${p.s.minW}×${p.s.minH} but slot ${p.slot} of ${layout.code} is ${p.w}×${p.h}`, p.el.span, fix);
    }
    for (const p of problems.small) {
      report(G.SmallInLargest, `R6: \`${p.el.id}\` is a small element; it can't be ${p.alone ? "alone in a 1-slot layout" : `in the largest slot of ${layout.code}`}`, p.el.span, fix);
    }
  }

  // R5: something must carry the template.
  const specs = parts.content.map(spec).filter((s): s is GridElement => !!s);
  if (specs.length && specs.every((s) => s.role === "support")) {
    r.error(G.NoCarrier, "R5: every element here is a support element; add a primary or flex one (chart, stat, body, bullets, …)", scene.span);
  }

  // R7: per-template limits. R8: no repeats.
  const count = (pred: (s: GridElement) => boolean) => specs.filter(pred).length;
  const limits: [string, number, number][] = [
    ["callout", count((s) => s.id === "callout"), 1],
    ["icon", count((s) => s.id === "icon"), 1],
    ["chart", count((s) => (CHART_ELEMENTS as readonly string[]).includes(s.id)), 2],
  ];
  for (const [what, got, max] of limits) {
    if (got > max) r.error(G.TemplateLimit, `R7: at most ${max} ${what}${max > 1 ? "s" : ""} per scene (got ${got})`, scene.span);
  }
  const seen = new Set<string>();
  for (const [i, s] of specs.entries()) {
    if (seen.has(s.id) && s.id !== "stat" && !(CHART_ELEMENTS as readonly string[]).includes(s.id)) {
      r.warn(G.Repeat, `R8: \`${s.id}\` is used twice; use one element with more items instead`, parts.content[i]!.span);
    }
    seen.add(s.id);
  }
}

