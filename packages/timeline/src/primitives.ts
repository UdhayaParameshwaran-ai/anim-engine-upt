import type { Box, ElementIR, Prop } from "@anim/ir";
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
}

export type Primitive = (c: PrimitiveContext) => TweenSpec[];

const ease = (c: PrimitiveContext, fallback: string) => String(c.params.ease ?? fallback);
const end = (c: PrimitiveContext) => c.t0 + c.dur;
const num = (v: Value | undefined, d: number) => (typeof v === "number" ? v : d);
/** HTML-layer elements (cards, formulas) have no strokes to draw. */
const drawable = (el: ElementIR | undefined) => el?.layer !== "html";

/**
 * Verb → property tweens. Primitives are pure: adding a verb means adding a
 * function here and a manifest in the registry; the engine never changes.
 */
export const PRIMITIVES: Record<string, Primitive> = {
  fade: (c) => [{ prop: "opacity", t0: c.t0, t1: end(c), to: 1, ease: ease(c, "out") }],

  pop: (c) => [
    { prop: "opacity", t0: c.t0, t1: c.t0 + c.dur * 0.5, from: 0, to: 1, ease: "out" },
    { prop: "scale", t0: c.t0, t1: end(c), from: 0.6, to: 1, ease: ease(c, "spring") },
  ],

  draw: (c) =>
    drawable(c.el)
      ? [
          { prop: "opacity", t0: c.t0, t1: c.t0, to: 1, ease: "linear" },
          { prop: "draw", t0: c.t0, t1: end(c), from: 0, to: 1, ease: ease(c, "out") },
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

  hide: (c) => [{ prop: "opacity", t0: c.t0, t1: end(c), to: 0, ease: ease(c, "in") }],

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
      { prop: "scale", t0: c.t0, t1: mid, to: s * 1.15, ease: "out" },
      { prop: "scale", t0: mid, t1: end(c), to: s, ease: "in" },
    ];
  },

  dim: (c) => [{ prop: "opacity", t0: c.t0, t1: end(c), to: 0.3, ease: ease(c, "out") }],

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
