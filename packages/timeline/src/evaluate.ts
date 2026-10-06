import type { Box, Prop, ResolvedTimeline, Tween } from "@anim/ir";

export type Value = number | Box;
export type Ease = (x: number) => number;

const BACK = 1.70158;

export const EASES: Record<string, Ease> = {
  linear: (x) => x,
  in: (x) => x * x * x,
  out: (x) => 1 - (1 - x) ** 3,
  inout: (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  /** Ease-out with a small overshoot. */
  spring: (x) => 1 + (BACK + 1) * (x - 1) ** 3 + BACK * (x - 1) ** 2,
};

export function lerp(from: Value, to: Value, k: number): Value {
  if (typeof from === "number" && typeof to === "number") return from + (to - from) * k;
  const a = from as Box;
  const b = to as Box;
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k };
}

/**
 * Value of one tween at time t (t ≥ tween.t0). The governing tween for a
 * property at t is the *latest-starting* tween with t0 ≤ t; a later tween
 * takes over from wherever the earlier one was (its `from` is baked).
 */
export function tweenValue(tw: Tween, t: number): Value {
  if (t >= tw.t1 || tw.t1 <= tw.t0) return tw.to;
  const k = (t - tw.t0) / (tw.t1 - tw.t0);
  return lerp(tw.from, tw.to, (EASES[tw.ease] ?? EASES.linear!)(k));
}

export type FrameState = Map<string, Partial<Record<Prop, Value>>>;

/**
 * Builds a stateless evaluator: `at(t)` returns every target's properties
 * at time t. No history is involved, so seeking is exact and cheap
 * (binary search per property).
 */
export function createEvaluator(timeline: Pick<ResolvedTimeline, "initial" | "tracks">) {
  const index = new Map<string, { target: string; prop: Prop; tweens: Tween[] }>();
  for (const tw of timeline.tracks) {
    const key = `${tw.target}\u0000${tw.prop}`;
    let e = index.get(key);
    if (!e) index.set(key, (e = { target: tw.target, prop: tw.prop, tweens: [] }));
    e.tweens.push(tw); // tracks are sorted by t0, then source order
  }

  /** The tween that sets a property at t (undefined: the initial value applies). */
  function governing(target: string, prop: Prop, t: number): Tween | undefined {
    const e = index.get(`${target}\u0000${prop}`);
    return e && lastStartedBy(e.tweens, t);
  }

  function valueAt(target: string, prop: Prop, t: number): Value | undefined {
    const tw = governing(target, prop, t);
    return tw ? tweenValue(tw, t) : timeline.initial[target]?.[prop];
  }

  function at(t: number): FrameState {
    const state: FrameState = new Map();
    for (const [target, props] of Object.entries(timeline.initial)) state.set(target, { ...props });
    for (const { target, prop, tweens } of index.values()) {
      const governing = lastStartedBy(tweens, t);
      if (!governing) continue;
      let s = state.get(target);
      if (!s) state.set(target, (s = {}));
      s[prop] = tweenValue(governing, t);
    }
    return state;
  }

  return { at, valueAt, governing };
}

/** Last tween with t0 ≤ t (binary search; ties resolved by array order). */
function lastStartedBy(tweens: Tween[], t: number): Tween | undefined {
  let lo = 0;
  let hi = tweens.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tweens[mid]!.t0 <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 ? tweens[found] : undefined;
}
