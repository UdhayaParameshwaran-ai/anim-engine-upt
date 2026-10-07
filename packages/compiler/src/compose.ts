import type { Box } from "@anim/ir";
import { COMPOSE_PATTERNS } from "@anim/registry";
import { Constraint, Expression, Operator, Solver, Strength, Variable } from "@lume/kiwi";

export { COMPOSE_PATTERNS };

/**
 * Composition by intent: the script says how elements relate ("a hero on
 * the left, supporting items beside it") and this module finds the boxes.
 * Each pattern becomes linear constraints (inside the safe area, gaps,
 * fixed aspect ratios, alignment, hero/support size ratio, a pull to grow)
 * solved with Cassowary; candidates (pattern × hero ratio) are scored for
 * coverage, balance, hierarchy and readability, and the best one wins.
 */

export type ComposePattern = (typeof COMPOSE_PATTERNS)[number];

export interface ComposeItem {
  id: string;
  /** Natural size; the aspect ratio is kept, the scale is solved. */
  w: number;
  h: number;
  hero: boolean;
  /** Text shrinks badly; its scale counts toward readability. */
  text: boolean;
}

export interface Composition {
  pattern: Exclude<ComposePattern, "auto">;
  ratio: number;
  score: number;
  boxes: Map<string, Box>;
}

interface Vars {
  item: ComposeItem;
  x: Variable;
  y: Variable;
  w: Variable;
  /** h = aspect · w */
  aspect: number;
}

const RATIOS = [1.4, 1.8, 2.3];

export function compose(items: ComposeItem[], area: Box, opts: { pattern: ComposePattern; gap: number; seed: number }): Composition | undefined {
  if (!items.length) return undefined;
  const hero = items.find((i) => i.hero) ?? items[0]!;
  const hasHero = items.length > 1;
  const patterns: Exclude<ComposePattern, "auto">[] =
    opts.pattern === "auto" ? (hasHero ? ["hero-left", "hero-right", "hero-top", "hero-center", "columns", "pyramid", "z"] : ["columns"]) : [opts.pattern];
  const candidates: Composition[] = [];
  for (const pattern of patterns) {
    const ratios = pattern.startsWith("hero") || pattern === "pyramid" ? RATIOS : [1];
    for (const ratio of ratios) {
      const boxes = solve(pattern, items, hero, area, opts.gap, ratio);
      if (boxes) candidates.push({ pattern, ratio, boxes, score: score(boxes, items, hero, area, pattern) });
    }
  }
  if (!candidates.length) return undefined;
  candidates.sort((a, b) => b.score - a.score || a.pattern.localeCompare(b.pattern) || a.ratio - b.ratio);
  // Variety: among candidates within 4% of the best, pick by seed (stable per scene).
  const near = candidates.filter((c) => c.score >= candidates[0]!.score - Math.abs(candidates[0]!.score) * 0.04);
  return near[opts.seed % near.length];
}

function solve(pattern: Exclude<ComposePattern, "auto">, items: ComposeItem[], hero: ComposeItem, area: Box, gap: number, ratio: number): Map<string, Box> | undefined {
  // hero-right is hero-left, mirrored.
  if (pattern === "hero-right") {
    const left = solve("hero-left", items, hero, area, gap, ratio);
    if (!left) return undefined;
    for (const [id, b] of left) left.set(id, { ...b, x: area.x + area.w - (b.x - area.x) - b.w });
    return left;
  }
  const s = new Solver();
  const vars = new Map<string, Vars>();
  for (const item of items) vars.set(item.id, { item, x: new Variable(), y: new Variable(), w: new Variable(), aspect: item.h / Math.max(1, item.w) });
  const V = (id: string) => vars.get(id)!;
  const h = (v: Vars) => new Expression([v.aspect, v.w]);
  const right = (v: Vars) => new Expression(v.x, v.w);
  const bottom = (v: Vars) => new Expression(v.y, [v.aspect, v.w]);
  const cx = (v: Vars) => new Expression(v.x, [0.5, v.w]);
  const cy = (v: Vars) => new Expression(v.y, [0.5 * v.aspect, v.w]);
  const add = (lhs: Expression | Variable, op: Operator, rhs: Expression | Variable | number, strength = Strength.required) => s.addConstraint(new Constraint(lhs, op, rhs, strength));
  const R = area.x + area.w;
  const B = area.y + area.h;
  const midX = area.x + area.w / 2;
  const midY = area.y + area.h / 2;

  for (const v of vars.values()) {
    add(v.x, Operator.Ge, area.x);
    add(v.y, Operator.Ge, area.y);
    add(right(v), Operator.Le, R);
    add(bottom(v), Operator.Le, B);
    add(v.w, Operator.Ge, 40);
    if (v.item.text) {
      // Text keeps (about) its natural size: shrinking it hurts readability, growing it looks odd.
      add(v.w, Operator.Le, v.item.w * 1.3);
      add(v.w, Operator.Eq, v.item.w, Strength.strong);
    } else {
      // Pictures grow toward a generous size, never far beyond their natural one.
      add(v.w, Operator.Le, v.item.w * 2.6);
      add(v.w, Operator.Eq, v.item.w * 2.6, Strength.weak);
    }
  }

  const H = V(hero.id);
  const others = items.filter((i) => i !== hero).map((i) => V(i.id));
  const all = items.map((i) => V(i.id));
  // The hero is `ratio` times as wide as each supporting element.
  const sizeRatio = (big: Vars, small: Vars) => {
    if (!big.item.text && !small.item.text) add(big.w, Operator.Eq, new Expression([ratio, small.w]), Strength.strong);
  };
  const below = (a: Vars, b: Vars) => add(new Expression(bottom(a), gap), Operator.Le, b.y);
  const leftOf = (a: Vars, b: Vars) => add(new Expression(right(a), gap), Operator.Le, b.x);
  const centeredY = (top: Vars, last: Vars) => add(new Expression(top.y, -area.y), Operator.Eq, new Expression(B, [-1, bottom(last)]), Strength.strong);
  const centeredX = (first: Vars, last: Vars) => add(new Expression(first.x, -area.x), Operator.Eq, new Expression(R, [-1, right(last)]), Strength.strong);
  /** Even, compact spacing along a row (or a column): all gaps equal, preferably small. */
  const even = (vs: Vars[], axis: "x" | "y") => {
    const gapAt = (i: number) => new Expression(axis === "x" ? vs[i]!.x : vs[i]!.y, [-1, axis === "x" ? right(vs[i - 1]!) : bottom(vs[i - 1]!)]);
    for (let i = 1; i < vs.length; i++) {
      add(gapAt(i), Operator.Eq, gap * 1.5, Strength.weak);
      if (i >= 2) add(gapAt(i), Operator.Eq, gapAt(i - 1), Strength.strong);
    }
  };

  switch (pattern) {
    case "hero-left":
    case "hero-center": {
      const sides = pattern === "hero-center" ? [others.filter((_, i) => i % 2 === 0), others.filter((_, i) => i % 2 === 1)] : [[], others];
      const [leftCol, rightCol] = sides as [Vars[], Vars[]];
      add(cy(H), Operator.Eq, midY, Strength.strong);
      for (const col of [leftCol, rightCol]) {
        col.forEach((v, i) => {
          if (i) below(col[i - 1]!, v);
          add(cx(v), Operator.Eq, cx(col[0]!), Strength.strong);
          sizeRatio(H, v);
        });
        if (col.length) centeredY(col[0]!, col.at(-1)!);
        even(col, "y");
      }
      for (const v of rightCol) leftOf(H, v);
      for (const v of leftCol) leftOf(v, H);
      // The whole group sits centered left↔right.
      const first = leftCol[0] ?? H;
      const last = rightCol[0] ?? H;
      centeredX(first, last);
      break;
    }
    case "hero-top":
    case "pyramid": {
      add(cx(H), Operator.Eq, midX, Strength.strong);
      others.forEach((v, i) => {
        below(H, v);
        if (i) {
          leftOf(others[i - 1]!, v);
          add(cy(v), Operator.Eq, cy(others[0]!), Strength.strong);
        }
        sizeRatio(H, v);
      });
      even(others, "x");
      if (others.length) {
        centeredX(others[0]!, others.at(-1)!);
        centeredY(H, others[0]!);
      }
      break;
    }
    case "columns": {
      all.forEach((v, i) => {
        if (i) {
          leftOf(all[i - 1]!, v);
          add(cy(v), Operator.Eq, cy(all[0]!), Strength.strong);
          // Equal widths unless one is emphasized.
          if (v.item.hero) sizeRatio(v, all[0]!);
          else if (!all[0]!.item.hero) add(v.w, Operator.Eq, all[0]!.w, Strength.medium);
        }
      });
      even(all, "x");
      add(cy(all[0]!), Operator.Eq, midY, Strength.strong);
      centeredX(all[0]!, all.at(-1)!);
      break;
    }
    case "rows": {
      all.forEach((v, i) => {
        if (i) {
          below(all[i - 1]!, v);
          add(cx(v), Operator.Eq, cx(all[0]!), Strength.strong);
        }
      });
      even(all, "y");
      add(cx(all[0]!), Operator.Eq, midX, Strength.strong);
      centeredY(all[0]!, all.at(-1)!);
      break;
    }
    case "z": {
      // Reading in a Z: alternate columns, each item a step lower than the one before.
      all.forEach((v, i) => {
        if (i >= 2) below(all[i - 2]!, v);
        if (i % 2 === 1) {
          leftOf(all[i - 1]!, v);
          add(v.y, Operator.Ge, new Expression(all[i - 1]!.y, [0.4 * all[i - 1]!.aspect, all[i - 1]!.w]));
        }
        if (i >= 2) add(cx(v), Operator.Eq, cx(all[i - 2]!), Strength.strong);
      });
      if (all.length > 1) centeredX(all[0]!, all[1]!);
      centeredY(all[0]!, all.at(-1)!);
      break;
    }
  }

  try {
    s.updateVariables();
  } catch {
    return undefined;
  }
  const boxes = new Map<string, Box>();
  for (const v of vars.values()) {
    const w = v.w.value();
    const b = { x: Math.round(v.x.value()), y: Math.round(v.y.value()), w: Math.round(w), h: Math.round(w * v.aspect) };
    if (![b.x, b.y, b.w, b.h].every(Number.isFinite) || b.w < 30) return undefined;
    boxes.set(v.item.id, b);
  }
  return overlaps(boxes) ? undefined : boxes;
}

function overlaps(boxes: Map<string, Box>): boolean {
  const list = [...boxes.values()];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) return true;
    }
  return false;
}

/** Higher is better: fills the page well, balanced, clear hierarchy, readable text, even margins. */
function score(boxes: Map<string, Box>, items: ComposeItem[], hero: ComposeItem, area: Box, pattern: string): number {
  const list = items.map((i) => ({ i, b: boxes.get(i.id)! }));
  const areaSum = list.reduce((a, { b }) => a + b.w * b.h, 0);
  const coverage = areaSum / (area.w * area.h);
  let s = 1 - Math.abs(coverage - 0.42) * 2.2;

  const mx = list.reduce((a, { b }) => a + (b.x + b.w / 2) * b.w * b.h, 0) / areaSum;
  const my = list.reduce((a, { b }) => a + (b.y + b.h / 2) * b.w * b.h, 0) / areaSum;
  const off = Math.hypot(mx - (area.x + area.w / 2), my - (area.y + area.h / 2)) / Math.hypot(area.w, area.h);
  s += 1 - off * 4;

  if (items.length > 1 && pattern !== "columns" && pattern !== "rows" && pattern !== "z") {
    const heroArea = boxes.get(hero.id)!.w * boxes.get(hero.id)!.h;
    const maxOther = Math.max(...list.filter(({ i }) => i !== hero).map(({ b }) => b.w * b.h));
    s += Math.min(1, heroArea / maxOther / 2) * 0.6;
  }
  for (const { i, b } of list) if (i.text && b.w / i.w < 0.6) s -= (0.6 - b.w / i.w) * 3;

  const minX = Math.min(...list.map(({ b }) => b.x));
  const maxX = Math.max(...list.map(({ b }) => b.x + b.w));
  const minY = Math.min(...list.map(({ b }) => b.y));
  const maxY = Math.max(...list.map(({ b }) => b.y + b.h));
  const margins = [minX - area.x, area.x + area.w - maxX, minY - area.y, area.y + area.h - maxY];
  const mean = margins.reduce((a, b) => a + b, 0) / 4;
  const spread = Math.sqrt(margins.reduce((a, m) => a + (m - mean) ** 2, 0) / 4) / Math.max(area.w, area.h);
  s -= spread * 2;
  return Math.round(s * 1e4) / 1e4;
}
