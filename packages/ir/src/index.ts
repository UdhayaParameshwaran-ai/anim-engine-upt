/**
 * Internal representations. Never written by the LLM, so plain JSON is fine.
 *
 *   DSL text ──parse/validate/lower──► VideoIR ──TTS + resolve──► ResolvedTimeline ──► engine
 */

export const IR_VERSION = 1;

/** Seconds. All resolved times are quantized to frame boundaries. */
export type Seconds = number;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------- VideoIR ---

export interface VideoIR {
  irVersion: typeof IR_VERSION;
  dslVersion: number;
  title?: string;
  canvas: { width: number; height: number; fps: number };
  theme: string;
  voice: string;
  lang: string;
  scenes: SceneIR[];
  /** Pinned component/asset versions, so re-renders are identical. */
  lock: Record<string, string>;
}

export interface SceneIR {
  id: string;
  title?: string;
  template?: string;
  transitionIn: string;
  transitionOut: string;
  keep: string[];
  elements: ElementIR[];
  steps: StepIR[];
}

export interface ElementIR {
  id: string;
  kind: string;
  /** Resolved registry entry, e.g. `icon:sun@1`. */
  component: string;
  texts: string[];
  link?: { from: string; to: string };
  params: Record<string, string | number | boolean>;
  /** Computed by the template/layout engine; never by the LLM. */
  box: Box;
  layer: "svg" | "html";
  parts: string[];
  /** Step index in which the element was declared. */
  step: number;
  /** DSL source line, for Studio jump-to-source. */
  line: number;
}

export interface StepIR {
  id?: string;
  title?: string;
  layout?: string;
  focus?: string;
  beats: BeatIR[];
}

export type BeatIR =
  | { type: "speech"; text: string; cues: CueIR[]; actions: ActionIR[]; line: number }
  | { type: "wait"; seconds: Seconds; actions: ActionIR[]; line: number };

export interface CueIR {
  id: string;
  /** Char offsets into the beat text. */
  start: number;
  end?: number;
}

export interface ActionIR {
  anchor: string;
  /** Sequential chain; every default filled in. */
  calls: {
    verb: string;
    verbVersion: number;
    targets: string[];
    duration: Seconds | "fit" | { until: string };
    delay: Seconds;
    stagger: Seconds;
    to?: string;
    dest?: Box;
    params: Record<string, string | number | boolean>;
  }[];
  line: number;
}

// ------------------------------------------------------- Narration timing ---

export type TimingPrecision = "char" | "word" | "interpolated" | "sentence";

export interface WordTiming {
  text: string;
  /** Char offsets into the narration text that was synthesized. */
  start: number;
  end: number;
  t0: Seconds;
  t1: Seconds;
  precision: TimingPrecision;
}

// ------------------------------------------------------- ResolvedTimeline ---

export type Prop = "opacity" | "x" | "y" | "scale" | "rotate" | "draw" | "reveal" | "tint" | "camera";

export interface Tween {
  /** Element id, `id.part`, or "camera". */
  target: string;
  prop: Prop | string;
  t0: Seconds;
  t1: Seconds;
  /** Baked by the resolver so evaluation is stateless (seek anywhere). */
  from: number | Box;
  to: number | Box;
  ease: string;
  /** Source action line, for the inspector. */
  line: number;
}

export interface ResolvedTimeline {
  irVersion: typeof IR_VERSION;
  fps: number;
  duration: Seconds;
  scenes: { id: string; t0: Seconds; t1: Seconds; steps: { id?: string; t0: Seconds; t1: Seconds }[] }[];
  audio: { src: string; t0: Seconds; duration: Seconds }[];
  cues: { scene: string; beat: number; id: string; t: Seconds; tEnd?: Seconds; precision: TimingPrecision }[];
  words: { text: string; t0: Seconds; t1: Seconds }[];
  /** Initial property values per element, before any tween. */
  initial: Record<string, Record<string, number | Box>>;
  tracks: Tween[];
  report: SyncReportItem[];
}

export interface SyncReportItem {
  code: string;
  severity: "warning" | "info";
  message: string;
  line?: number;
  t?: Seconds;
}
