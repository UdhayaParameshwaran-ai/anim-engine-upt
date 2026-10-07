import type { Box, ElementIR, Prop } from "@anim/ir";
import { findMotion, type MotionProfile } from "@anim/registry";
import { OVERSHOOT } from "./evaluate.js";
import type { Value } from "./evaluate.js";

/** One property change produced by a primitive. Times are absolute seconds. */
export interface TweenSpec {
  prop: Prop;
  t0: number;
  t1: number;
  /** Forced start value; otherwise the property's value at t0 (baked by the resolver). */
  from?: Value;
  to: Value;
  ease: string;
  meta?: Record<string, string | number | boolean>;
}

export interface PrimitiveContext {
  t0: number;
  dur: number;
  params: Record<string, string | number | boolean>;
  /** The element, or undefined for parts/camera. */
  el: ElementIR | undefined;
  /** Current value of a property of this target at t0. */
  cur: (prop: Prop) => Value | undefined;
  canvas: { width: number; height: number };
  dest?: Box;
  /** Spoken words (absolute times) inside the anchoring span, for `write sync=true`. */
  words?: { t0: number; t1: number }[];
  /** The video's motion personality; standard when absent. */
  motion?: MotionProfile;
}

export type Primitive = (c: PrimitiveContext) => TweenSpec[];

const motionOf = (c: PrimitiveContext) => c.motion ?? findMotion(undefined);
/** The ease a script names, as the personality plays it. */
const ease = (c: PrimitiveContext, fallback: string) => {
  const name = String(c.params.ease ?? fallback);
  return motionOf(c).ease[name as keyof MotionProfile["ease"]] ?? name;
};
/** Same, for progress properties (draw, reveal) that must stay within [0, 1]. */
const progressEase = (c: PrimitiveContext, fallback: string) => {
  const e = ease(c, fallback);
  return OVERSHOOT.has(e) ? "quart" : e;
};

/**
 * The personality's entrance besides opacity: rise from below, slide in
 * from the left, blur into focus, or zoom in from depth. Parts and
 * connectors only fade (they have no box of their own to move).
 */
function entrance(c: PrimitiveContext, e: string): TweenSpec[] {
  const m = motionOf(c);
  if (!c.el || c.el.link) return [];
  const t1 = end(c);
  const k = c.canvas.width / 1920;
  switch (m.fade) {
    case "rise": {
      const y = num(c.cur("y"), 0);
      return [{ prop: "y", t0: c.t0, t1, from: y + m.distance * k, to: y, ease: e }];
    }
    case "slide": {
      const x = num(c.cur("x"), 0);
      return [{ prop: "x", t0: c.t0, t1, from: x - m.distance * k, to: x, ease: e }];
    }
    case "blur":
      return [{ prop: "blur", t0: c.t0, t1, from: 12, to: 0, ease: e }];
    case "zoom": {
      const s = num(c.cur("scale"), 1);
      return [
        { prop: "scale", t0: c.t0, t1, from: s * 1.25, to: s, ease: e },
        { prop: "blur", t0: c.t0, t1, from: 6, to: 0, ease: e },
      ];
    }
    default:
      return [];
  }
}
const end = (c: PrimitiveContext) => c.t0 + c.dur;
const num = (v: Value | undefined, d: number) => (typeof v === "number" ? v : d);
/** HTML-layer elements (cards, formulas) have no strokes to draw. */
const drawable = (el: ElementIR | undefined) => el?.layer !== "html";

/**
 * Verb → property tweens. Primitives are pure: adding a verb means adding a
 * function here and a manifest in the registry; the engine never changes.
 */
export const PRIMITIVES: Record<string, Primitive> = {
  fade: (c) => [{ prop: "opacity", t0: c.t0, t1: end(c), to: 1, ease: progressEase(c, "out") }, ...entrance(c, ease(c, "out"))],

  pop: (c) => {
    const m = motionOf(c);
    // An explicit ease wins; otherwise the personality's pop ease.
    const e = c.params.ease !== undefined && c.params.ease !== "spring" ? ease(c, "spring") : m.pop.ease;
    const out: TweenSpec[] = [
      { prop: "opacity", t0: c.t0, t1: c.t0 + c.dur * 0.5, from: 0, to: 1, ease: "out" },
      { prop: "scale", t0: c.t0, t1: end(c), from: m.pop.from, to: 1, ease: e },
    ];
    if (m.pop.blur && c.el) out.push({ prop: "blur", t0: c.t0, t1: end(c), from: m.pop.blur, to: 0, ease: OVERSHOOT.has(e) ? "out" : e });
    return out;
  },

  draw: (c) =>
    drawable(c.el)
      ? [
          { prop: "opacity", t0: c.t0, t1: c.t0, to: 1, ease: "linear" },
          { prop: "draw", t0: c.t0, t1: end(c), from: 0, to: 1, ease: progressEase(c, "out") },
        ]
      : PRIMITIVES.fade!(c),

  write: (c) => {
    const meta = { by: String(c.params.by ?? "char") };
    const show: TweenSpec = { prop: "opacity", t0: c.t0, t1: c.t0, to: 1, ease: "linear" };
    if (c.params.sync === true && c.words?.length) {
      // Reveal in step with the spoken words: word k reveals k/n → (k+1)/n while it is said.
      const n = c.words.length;
      return [
        show,
        { prop: "reveal", t0: c.t0, t1: c.t0, from: 0, to: 0, ease: "linear", meta },
        ...c.words.map((w, k): TweenSpec => ({ prop: "reveal", t0: w.t0, t1: w.t1, from: k / n, to: (k + 1) / n, ease: "linear", meta })),
      ];
    }
    return [show, { prop: "reveal", t0: c.t0, t1: end(c), from: 0, to: 1, ease: "linear", meta }];
  },

  hide: (c) => [{ prop: "opacity", t0: c.t0, t1: end(c), to: 0, ease: progressEase(c, "in") }],

  highlight: (c) => {
    const meta = { color: String(c.params.color ?? "accent"), style: String(c.params.style ?? "glow") };
    const fadeIn = Math.min(0.25, c.dur / 3);
    const fadeOut = Math.min(0.3, c.dur / 3);
    return [
      { prop: "tint", t0: c.t0, t1: c.t0 + fadeIn, to: 1, ease: "out", meta },
      { prop: "tint", t0: end(c) - fadeOut, t1: end(c), to: 0, ease: "in", meta },
    ];
  },

  pulse: (c) => {
    const s = num(c.cur("scale"), 1);
    const mid = c.t0 + c.dur / 2;
    return [
      { prop: "scale", t0: c.t0, t1: mid, to: s * motionOf(c).pulse, ease: "out" },
      { prop: "scale", t0: mid, t1: end(c), to: s, ease: "in" },
    ];
  },

  dim: (c) => [{ prop: "opacity", t0: c.t0, t1: end(c), to: 0.3, ease: progressEase(c, "out") }],

  move: (c) => {
    if (!c.dest) return [];
    const e = ease(c, "inout");
    const out: TweenSpec[] = [
      { prop: "x", t0: c.t0, t1: end(c), to: c.dest.x + c.dest.w / 2, ease: e },
      { prop: "y", t0: c.t0, t1: end(c), to: c.dest.y + c.dest.h / 2, ease: e },
    ];
    if (c.el && c.el.box.w > 0 && Math.abs(c.dest.w - c.el.box.w) > 1) out.push({ prop: "scale", t0: c.t0, t1: end(c), to: c.dest.w / c.el.box.w, ease: e });
    return out;
  },

  scale: (c) => [{ prop: "scale", t0: c.t0, t1: end(c), to: num(c.cur("scale"), 1) * Number(c.params.by ?? 1.2), ease: ease(c, "out") }],
};

/** Camera framing for `focus <id>`: the element plus context, canvas aspect, clamped to the canvas. */
export function focusBox(target: { x: number; y: number; w: number; h: number }, canvas: { width: number; height: number }): Box {
  const aspect = canvas.width / canvas.height;
  let w = Math.max(target.w * 1.8, target.h * 1.8 * aspect, canvas.width / 4);
  w = Math.min(w, canvas.width);
  const h = w / aspect;
  const cx = target.x + target.w / 2;
  const cy = target.y + target.h / 2;
  return {
    x: Math.min(Math.max(cx - w / 2, 0), canvas.width - w),
    y: Math.min(Math.max(cy - h / 2, 0), canvas.height - h),
    w,
    h,
  };
}
