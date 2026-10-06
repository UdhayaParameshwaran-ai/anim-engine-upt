import type { Box, Prop, ResolvedScene, ResolvedTimeline, Tween, VideoIR } from "@anim/ir";
import { createEvaluator, type Value } from "@anim/timeline";

export type Evaluator = ReturnType<typeof createEvaluator>;

export interface ElementState {
  id: string;
  kind: string;
  /** Declaration line. */
  line: number;
  visible: boolean;
  props: Partial<Record<Prop, Value>>;
  /** Current box on the canvas (layout box moved/scaled by the timeline). */
  box: Box;
  /** The tween animating it now, else the last one that touched it. */
  driver?: Tween;
  active: boolean;
}

export interface Moment {
  t: number;
  scene?: ResolvedScene;
  stepIndex: number;
  beat?: ResolvedScene["beats"][number];
  word?: string;
  elements: ElementState[];
  camera?: Box;
}

const PROPS: Prop[] = ["opacity", "x", "y", "scale", "rotate", "draw", "reveal", "tint"];

/** The scene shown at t (the last scene stays on screen after the end). */
export function sceneAt(tl: ResolvedTimeline, t: number): ResolvedScene | undefined {
  return tl.scenes.find((s) => t >= s.t0 && t < s.t1) ?? (t >= (tl.scenes.at(-1)?.t1 ?? Infinity) ? tl.scenes.at(-1) : undefined);
}

/**
 * Everything the inspector shows for time t: where we are in the
 * scene/step/beat structure, the word being spoken, and for each element
 * of the active scene its property values and the tween driving them.
 */
export function inspect(ir: VideoIR, tl: ResolvedTimeline, ev: Evaluator, t: number): Moment {
  const scene = sceneAt(tl, t);
  if (!scene) return { t, stepIndex: -1, elements: [] };
  const sceneIr = ir.scenes.find((s) => s.id === scene.id)!;
  const stepIndex = Math.max(0, scene.steps.findIndex((s) => t >= s.t0 && t < s.t1));
  const beat = scene.beats.find((b) => t >= b.t0 && t < b.t1);
  const word = tl.words.find((w) => w.scene === scene.id && t >= w.t0 && t < w.t1)?.text;
  const camera = ev.valueAt(`${scene.id}/camera`, "camera", t) as Box | undefined;

  const elements = sceneIr.elements.map((el): ElementState => {
    const target = `${scene.id}/${el.id}`;
    const props: Partial<Record<Prop, Value>> = {};
    let driver: Tween | undefined;
    for (const p of PROPS) {
      const v = ev.valueAt(target, p, t);
      if (v !== undefined) props[p] = v;
      const g = ev.governing(target, p, t);
      if (g && (!driver || rank(g, t) > rank(driver, t))) driver = g;
    }
    const s = typeof props.scale === "number" ? props.scale : 1;
    const cx = typeof props.x === "number" ? props.x : el.box.x + el.box.w / 2;
    const cy = typeof props.y === "number" ? props.y : el.box.y + el.box.h / 2;
    const box = { x: cx - (el.box.w * s) / 2, y: cy - (el.box.h * s) / 2, w: el.box.w * s, h: el.box.h * s };
    const opacity = typeof props.opacity === "number" ? props.opacity : 0;
    return { id: el.id, kind: el.component, line: el.line, visible: opacity > 0.01, props, box, driver, active: !!driver && t < driver.t1 };
  });
  return { t, scene, stepIndex, beat, word, elements, camera };
}

/** Running tweens outrank finished ones; then the latest start wins. */
function rank(tw: Tween, t: number): number {
  return (t < tw.t1 ? 1e6 : 0) + tw.t0;
}

/** The source line most relevant at t: the running action, else the beat. */
export function lineAt(m: Moment): number {
  const running = m.elements.filter((e) => e.active && e.driver!.line > 0).sort((a, b) => b.driver!.t0 - a.driver!.t0)[0];
  return running?.driver!.line ?? m.beat?.line ?? 0;
}

export { createEvaluator };
