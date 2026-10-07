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
  /** Motion personality (registry MOTIONS): how verbs move. */
  motion: string;
  /** Background generators (registry BACKGROUNDS; "auto" = the look's) and their seed. */
  background: { kinds: string[]; seed: number };
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

/**
 * Synthesized narration for one scene: the TTS → resolver hand-off.
 * Speech beats are joined with single spaces into `text`.
 */
export interface SceneSpeech {
  scene: string;
  /** Audio artifact path (content-addressed). */
  src: string;
  duration: Seconds;
  text: string;
  words: WordTiming[];
  /** Char range of each speech beat in `text`, in beat order (wait beats excluded). */
  beats: { start: number; end: number }[];
}

// ------------------------------------------------------- ResolvedTimeline ---

/**
 * Animatable properties. x/y are the element's center; camera is a Box
 * (the visible region of the canvas).
 */
export type Prop = "opacity" | "x" | "y" | "scale" | "rotate" | "draw" | "reveal" | "tint" | "blur" | "camera";

export interface Tween {
  /** `scene/id`, `scene/id.part`, or `scene/camera`. */
  target: string;
  prop: Prop;
  t0: Seconds;
  /** t1 === t0 means an instant set. */
  t1: Seconds;
  /** Baked by the resolver so evaluation is stateless (seek anywhere). */
  from: number | Box;
  to: number | Box;
  ease: string;
  /** Verb-specific rendering hints (highlight color/style, write `by`). */
  meta?: Record<string, string | number | boolean>;
  verb: string;
  /** Source action line, for the inspector. */
  line: number;
}

export interface ResolvedScene {
  id: string;
  t0: Seconds;
  t1: Seconds;
  transitionIn: { type: string; duration: Seconds };
  transitionOut: { type: string; duration: Seconds };
  steps: { id?: string; t0: Seconds; t1: Seconds }[];
  beats: { t0: Seconds; t1: Seconds; speechEnd: Seconds; hold: Seconds; line: number }[];
}

export interface AudioClip {
  src: string;
  /** Seconds into the source file. */
  offset: Seconds;
  t0: Seconds;
  duration: Seconds;
}

export interface ResolvedTimeline {
  irVersion: typeof IR_VERSION;
  fps: number;
  duration: Seconds;
  scenes: ResolvedScene[];
  audio: AudioClip[];
  cues: { scene: string; beat: number; id: string; t: Seconds; tEnd?: Seconds; precision: TimingPrecision; line: number }[];
  words: { scene: string; text: string; t0: Seconds; t1: Seconds }[];
  /** Initial property values per target, before any tween. */
  initial: Record<string, Partial<Record<Prop, number | Box>>>;
  /** Sorted by t0, then source order. */
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
