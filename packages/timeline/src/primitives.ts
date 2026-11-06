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
  const drifted = drift(c, e);
  // A template direction replaces the personality's own rise or slide.
  if (drifted.length && (m.fade === "rise" || m.fade === "slide" || m.fade === "plain")) return drifted;
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
/**
 * Travel from the direction the element's template gives it (enterDx/enterDy,
 * set by the layout): out of a hub, in toward a result, along a sequence.
 */
function drift(c: PrimitiveContext, e: string): TweenSpec[] {
  const m = motionOf(c);
  const dx = Number(c.el?.params.enterDx ?? 0);
  const dy = Number(c.el?.params.enterDy ?? 0);
  if (!c.el || c.el.link || !m.drift || (!dx && !dy)) return [];
  const d = m.drift * (c.canvas.width / 1920);
  const out: TweenSpec[] = [];
  // Overshooting eases would carry the element past its place; it settles instead.
  const settle = OVERSHOOT.has(e) ? "out" : e;
  if (dx) {
    const x = num(c.cur("x"), 0);
    out.push({ prop: "x", t0: c.t0, t1: end(c), from: x + dx * d, to: x, ease: settle });
  }
  if (dy) {
    const y = num(c.cur("y"), 0);
    out.push({ prop: "y", t0: c.t0, t1: end(c), from: y + dy * d, to: y, ease: settle });
  }
  return out;
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
    out.push(...drift(c, e));
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

  /**
   * A packet travels along a connector. A connector not shown yet is drawn
   * as the packet goes; `reveal` carries the packet's progress (the engine
   * draws the packet while a send tween is running).
   */
  send: (c) => {
    const fail = c.params.fail === true;
    const meta = { send: true, back: c.params.back === true, fail };
    // Already on screen (or still being drawn by an earlier send): only the packet moves.
    const shown = num(c.cur("opacity"), 0) > 0.5;
    const out: TweenSpec[] = [{ prop: "opacity", t0: c.t0, t1: c.t0, to: 1, ease: "linear" }];
    if (!shown) out.push({ prop: "draw", t0: c.t0, t1: end(c), from: 0, to: 1, ease: "inout" });
    const wait = Math.min(Number(c.params.wait ?? 0) || 0, c.dur * 0.6);
    if (fail) {
      // It gets partway and stops (red), and stays there a moment.
      const run = c.t0 + c.dur * 0.65;
      out.push({ prop: "reveal", t0: c.t0, t1: run, from: 0, to: 0.55, ease: "in", meta }, { prop: "reveal", t0: run, t1: end(c), from: 0.55, to: 0.55, ease: "linear", meta });
    } else if (wait > 0) {
      // It stops halfway (the server is busy) and then goes on.
      const leg = (c.dur - wait) / 2;
      out.push(
        { prop: "reveal", t0: c.t0, t1: c.t0 + leg, from: 0, to: 0.5, ease: "out", meta },
        { prop: "reveal", t0: c.t0 + leg, t1: c.t0 + leg + wait, from: 0.5, to: 0.5, ease: "linear", meta },
        { prop: "reveal", t0: c.t0 + leg + wait, t1: end(c), from: 0.5, to: 1, ease: "in", meta },
      );
    } else out.push({ prop: "reveal", t0: c.t0, t1: end(c), from: 0, to: 1, ease: "inout", meta });
    return out;
  },

  /** Several packets in a row along a connector: steady traffic. */
  stream: (c) => {
    const n = Math.max(2, Math.min(8, Math.round(Number(c.params.count ?? 3))));
    const meta = { send: true, back: c.params.back === true, fail: false };
    const shown = num(c.cur("opacity"), 0) > 0.5;
    const out: TweenSpec[] = [{ prop: "opacity", t0: c.t0, t1: c.t0, to: 1, ease: "linear" }];
    if (!shown) out.push({ prop: "draw", t0: c.t0, t1: c.t0 + Math.min(0.5, c.dur / n), from: 0, to: 1, ease: "inout" });
    const leg = c.dur / n;
    for (let i = 0; i < n; i++) out.push({ prop: "reveal", t0: c.t0 + i * leg, t1: c.t0 + (i + 1) * leg, from: 0, to: 1, ease: "linear", meta });
    return out;
  },

  /** The current-position ring: tint on (the resolver releases the previous one). */
  visit: (c) => [{ prop: "tint", t0: c.t0, t1: c.t0 + Math.min(0.3, c.dur / 2), to: 1, ease: "out", meta: { color: "accent", style: "glow" } }],

  /** A status tint that stays. */
  mark: (c) => {
    const as = String(c.params.as ?? "ok");
    const color = as === "fail" ? "warn" : as === "visited" ? "muted" : "good";
    return [{ prop: "tint", t0: c.t0, t1: c.t0 + Math.min(0.3, c.dur / 2), to: 1, ease: "out", meta: { color, style: "glow" } }];
  },

  shake: (c) => {
    if (!c.el || c.el.link) return [];
    const x = num(c.cur("x"), 0);
    const a = 14 * (c.canvas.width / 1920);
    const seg = c.dur / 6;
    const dx = [a, -a, a * 0.7, -a * 0.7, a * 0.35, 0];
    return dx.map((d, i): TweenSpec => ({ prop: "x", t0: c.t0 + i * seg, t1: c.t0 + (i + 1) * seg, to: x + d, ease: "inout" }));
  },

  drop: (c) => {
    const e = c.params.ease !== undefined ? ease(c, "spring") : motionOf(c).pop.ease;
    const y = num(c.cur("y"), 0);
    const k = c.canvas.width / 1920;
    return [
      { prop: "opacity", t0: c.t0, t1: c.t0 + c.dur * 0.4, from: 0, to: 1, ease: "out" },
      { prop: "y", t0: c.t0, t1: end(c), from: y - 140 * k, to: y, ease: e },
    ];
  },

  lift: (c) => {
    const y = num(c.cur("y"), 0);
    const k = c.canvas.width / 1920;
    return [
      { prop: "y", t0: c.t0, t1: end(c), to: y - 140 * k, ease: "in" },
      { prop: "opacity", t0: c.t0 + c.dur * 0.3, t1: end(c), to: 0, ease: "in" },
    ];
  },

  highlight: (c) => {
    const meta = { color: String(c.params.color ?? "accent"), style: String(c.params.style ?? "glow") };
    const fadeIn = Math.min(0.25, c.dur / 3);
    const fadeOut = Math.min(0.3, c.dur / 3);
    const out: TweenSpec[] = [
      { prop: "tint", t0: c.t0, t1: c.t0 + fadeIn, to: 1, ease: "out", meta },
      { prop: "tint", t0: end(c) - fadeOut, t1: end(c), to: 0, ease: "in", meta },
    ];
    // A highlighted element also lifts a little while it is talked about (connectors and parts only tint).
    if (c.el && !c.el.link) {
      const s = num(c.cur("scale"), 1);
      out.push({ prop: "scale", t0: c.t0, t1: c.t0 + fadeIn, to: s * 1.06, ease: "out" }, { prop: "scale", t0: end(c) - fadeOut, t1: end(c), to: s, ease: "inout" });
    }
    return out;
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
export function focusBox(target: { x: number; y: number; w: number; h: number }, canvas: { width: number; height: number }, factor = 1.8): Box {
  const aspect = canvas.width / canvas.height;
  let w = Math.max(target.w * factor, target.h * factor * aspect, canvas.width / 4);
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
