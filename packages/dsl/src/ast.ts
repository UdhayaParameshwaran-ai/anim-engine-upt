/**
 * AST for the Narrascript DSL. Every node carries a source span so the
 * validator, repair loop and Studio can point at the exact line.
 */

/** 1-based line, 1-based columns; endCol is exclusive. */
export interface Span {
  line: number;
  col: number;
  endCol: number;
}

export interface Script {
  version: number;
  title?: string;
  /** Video-level settings (lines before the first scene). */
  settings: Setting[];
  scenes: Scene[];
  span: Span;
}

export interface Setting {
  key: string;
  args: string[];
  span: Span;
}

export interface Scene {
  id: string;
  title?: string;
  /** in, out, keep, template, ... */
  attrs: Record<string, string>;
  settings: Setting[];
  /** steps[0] is the implicit step holding everything before the first `step` line. */
  steps: Step[];
  span: Span;
}

export interface Step {
  id?: string;
  title?: string;
  implicit: boolean;
  layout?: Named;
  /** Camera focus applied at step start: an element id, or "reset". */
  focus?: Named;
  elements: ElementDecl[];
  beats: Beat[];
  span: Span;
}

export interface Named {
  name: string;
  span: Span;
}

export type Place =
  | { kind: "slot"; slot: string }
  | { kind: "relative"; relation: string; ref: string };

export interface ElementDecl {
  id: string;
  /** Component kind: icon, asset, text, arrow, node, edge, ... */
  kind: string;
  /** Kind-specific name: `icon:sun` → "sun". */
  name?: string;
  /** Pinned component version: `icon:sun@2` → "2". */
  version?: string;
  /** Quoted strings in order (label, body, ...). */
  texts: string[];
  /** `a->b` relation for arrows, lines and graph edges. */
  link?: { from: string; to: string };
  attrs: Record<string, string>;
  place?: Place;
  span: Span;
}

export type Beat = SpeechBeat | WaitBeat;

export interface SpeechBeat {
  type: "speech";
  /** Narration with cue markers stripped; exactly what TTS speaks. */
  text: string;
  cues: Cue[];
  actions: Action[];
  span: Span;
}

export interface WaitBeat {
  type: "wait";
  seconds: number;
  actions: Action[];
  span: Span;
}

/**
 * A moment in the narration. `start`/`end` are char offsets into SpeechBeat.text.
 * Point cue: `start` only (start of the next word). Span cue: [start, end).
 */
export interface Cue {
  id: string;
  start: number;
  end?: number;
  span: Span;
}

export interface Action {
  /** Cue id, "start" or "end". */
  anchor: string;
  /** Sequential chain: calls[i+1] starts when calls[i] ends (`then`). */
  calls: VerbCall[];
  span: Span;
}

export interface VerbCall {
  verb: string;
  /** Element ids, `id.part`, or "*". */
  targets: string[];
  args: Args;
  span: Span;
}

export interface Args {
  /** Seconds. */
  duration?: number;
  /** Duration = length of the anchoring span cue. */
  fit?: boolean;
  /** Seconds after the anchor (`+0.2`). */
  delay?: number;
  /** Seconds between successive targets (`/0.15`). */
  stagger?: number;
  /** Relation target (`->id`). */
  to?: string;
  /** Destination (`@TR`, `@right-of:x`). */
  place?: Place;
  /** Remaining `key=value` args (ease, color, until, by, ...). */
  params: Record<string, string>;
}
