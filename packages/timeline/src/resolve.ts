import {
  IR_VERSION,
  type AudioClip,
  type Box,
  type ElementIR,
  type Prop,
  type ResolvedScene,
  type ResolvedTimeline,
  type SceneIR,
  type SceneSpeech,
  type SyncReportItem,
  type TimingPrecision,
  type Tween,
  type VideoIR,
  type WordTiming,
} from "@anim/ir";
import { findMotion, findVerb, type MotionProfile } from "@anim/registry";
import { tweenValue, type Value } from "./evaluate.js";
import { focusBox, PRIMITIVES, type TweenSpec } from "./primitives.js";

export const TimelineCodes = {
  HoldInserted: "NAR501",
  Overridden: "NAR502",
  LowPrecision: "NAR503",
  DurationClamped: "NAR504",
} as const;

export interface ResolveOptions {
  /** Silence between a scene's transition-in and its first word. */
  leadIn?: number;
  /** Silence after a scene's last beat before its transition-out. */
  tailPad?: number;
  /** Breathing room after a must-finish action before the next beat. */
  holdPad?: number;
  /** Shortest animation; `fit`/`until` spans shorter than this are clamped. */
  minDuration?: number;
  /** Shortest elastic highlight, so emphasis on one short word still reads. */
  minEmphasis?: number;
  transitions?: Record<string, number>;
}

const DEFAULT_TRANSITIONS: Record<string, number> = { cut: 0, fade: 0.5, slide: 0.6, wipe: 0.6, iris: 0.7, zoom: 0.6, blur: 0.7, rise: 0.6 };
const ENTER = new Set(["fade", "pop", "draw", "write"]);

/**
 * Resolves anchors to absolute, frame-quantized time and expands every
 * action into baked property tweens.
 *
 * Clock rules: narration is the master clock and is never stretched;
 * animations adapt (`fit`, `until`, defaults); the only time ever inserted
 * is silence after a beat whose must-finish actions (anchored at `end`,
 * on a `wait`, or verbs flagged mustFinish) need it.
 */
export function resolve(video: VideoIR, speech: readonly SceneSpeech[], options: ResolveOptions = {}): ResolvedTimeline {
  return new Resolver(video, speech, options).run();
}

interface Scheduled {
  order: number;
  verb: string;
  targets: string[];
  t0: number;
  dur: number;
  stagger: number;
  params: Record<string, string | number | boolean>;
  dest?: Box;
  words?: { t0: number; t1: number }[];
  line: number;
}

interface CueTime {
  t: number;
  tEnd?: number;
  precision: TimingPrecision;
  words: { t0: number; t1: number }[];
}

class Resolver {
  private readonly fps: number;
  private readonly motion: MotionProfile;
  private readonly leadIn: number;
  private readonly tailPad: number;
  private readonly holdPad: number;
  private readonly minDuration: number;
  private readonly minEmphasis: number;
  private readonly transitions: Record<string, number>;

  private readonly tracks: Tween[] = [];
  private readonly byKey = new Map<string, Tween[]>();
  private readonly forcedFrom = new WeakSet<Tween>();
  private readonly orderOf = new WeakMap<Tween, number>();
  private readonly callOf = new WeakMap<Tween, number>();
  private readonly initial: ResolvedTimeline["initial"] = {};
  private readonly report: SyncReportItem[] = [];
  private readonly audio: AudioClip[] = [];
  private readonly cues: ResolvedTimeline["cues"] = [];
  private readonly words: ResolvedTimeline["words"] = [];
  private readonly scenes: ResolvedScene[] = [];
  private order = 0;

  constructor(
    private readonly video: VideoIR,
    private readonly speech: readonly SceneSpeech[],
    opts: ResolveOptions,
  ) {
    this.fps = video.canvas.fps;
    this.motion = findMotion(video.motion);
    this.leadIn = opts.leadIn ?? 0.3;
    this.tailPad = opts.tailPad ?? 0.6;
    this.holdPad = opts.holdPad ?? 0.15;
    this.minDuration = opts.minDuration ?? 0.15;
    this.minEmphasis = opts.minEmphasis ?? 0.8;
    this.transitions = { ...DEFAULT_TRANSITIONS, ...opts.transitions };
  }

  /** Snap to the frame grid. Every time in the output passes through here. */
  private q(t: number): number {
    return Math.round(t * this.fps) / this.fps;
  }

  run(): ResolvedTimeline {
    const bySceneId = new Map(this.speech.map((s) => [s.scene, s]));
    let t = 0;
    let prev: SceneIR | undefined;
    for (const scene of this.video.scenes) {
      const sp = bySceneId.get(scene.id);
      if (!sp) throw new Error(`no synthesized speech for scene \`${scene.id}\``);
      t = this.scene(scene, sp, t, prev);
      prev = scene;
    }
    this.tracks.sort((a, b) => a.t0 - b.t0 || this.orderOf.get(a)! - this.orderOf.get(b)!);
    return {
      irVersion: IR_VERSION,
      fps: this.fps,
      duration: t,
      scenes: this.scenes,
      audio: this.audio,
      cues: this.cues,
      words: this.words,
      initial: this.initial,
      tracks: this.tracks,
      report: this.report,
    };
  }

  // ------------------------------------------------------------ schedule ---

  private scene(scene: SceneIR, sp: SceneSpeech, start: number, prev: SceneIR | undefined): number {
    // Transitions take the personality's tempo (cinematic ones are slower).
    const trIn = { type: scene.transitionIn, duration: this.q((this.transitions[scene.transitionIn] ?? 0) * this.motion.durScale) };
    const trOut = { type: scene.transitionOut, duration: this.q((this.transitions[scene.transitionOut] ?? 0) * this.motion.durScale) };
    const t0 = this.q(start);
    this.initScene(scene, prev);

    const beatWords = sp.beats.map((r) => sp.words.filter((w) => w.start >= r.start && w.end <= r.end));
    const bounds = this.beatBounds(beatWords, sp.duration);
    const scheduled: Scheduled[] = [];
    const steps: ResolvedScene["steps"] = [];
    const beats: ResolvedScene["beats"] = [];
    let cursor = this.q(t0 + trIn.duration + this.leadIn);
    let speechIndex = 0;
    let lowPrecision = 0;

    for (const step of scene.steps) {
      const stepT0 = cursor;
      if (step.focus) {
        const focus = findVerb("focus")!;
        scheduled.push({ order: this.order++, verb: "focus", targets: [step.focus], t0: cursor, dur: focus.defaultDuration, stagger: 0, params: { ease: "inout" }, line: 0 });
      }
      for (const beat of step.beats) {
        const B = cursor;
        let naturalEnd: number;
        let speechEnd: number;
        const cueTimes = new Map<string, CueTime>();

        if (beat.type === "speech") {
          const i = speechIndex++;
          const range = sp.beats[i]!;
          const [srcStart, srcEnd] = [bounds[i]!, bounds[i + 1]!];
          const shift = B - srcStart;
          if (srcEnd > srcStart) this.audio.push({ src: sp.src, offset: round(srcStart), t0: B, duration: round(srcEnd - srcStart) });
          const abs = beatWords[i]!.map((w) => ({ ...w, t0: w.t0 + shift, t1: w.t1 + shift }));
          for (const w of abs) this.words.push({ scene: scene.id, text: w.text, t0: this.q(w.t0), t1: this.q(w.t1) });
          speechEnd = abs.length ? this.q(abs[abs.length - 1]!.t1) : B;
          naturalEnd = this.q(B + srcEnd - srcStart);
          for (const cue of beat.cues) {
            const ct = this.cueTime(range.start + cue.start, cue.end === undefined ? undefined : range.start + cue.end, abs, speechEnd);
            cueTimes.set(cue.id, ct);
            if (ct.precision === "interpolated" || ct.precision === "sentence") lowPrecision++;
            this.cues.push({ scene: scene.id, beat: beats.length, id: cue.id, t: ct.t, ...(ct.tEnd !== undefined && { tEnd: ct.tEnd }), precision: ct.precision, line: beat.line });
          }
        } else {
          naturalEnd = this.q(B + beat.seconds);
          speechEnd = naturalEnd;
        }

        const anchorTime = (a: string) => (a === "start" ? B : a === "end" ? speechEnd : cueTimes.get(a)?.t ?? speechEnd);
        let mustEnd = 0;
        for (const action of beat.actions) {
          const cue = cueTimes.get(action.anchor);
          let prevEnd = anchorTime(action.anchor);
          for (const call of action.calls) {
            const t = this.q(prevEnd + call.delay);
            let target: number;
            let elastic = true;
            if (typeof call.duration === "number") {
              target = t + call.duration;
              elastic = false;
            } else if (call.duration === "fit") {
              target = cue?.tEnd ?? speechEnd;
            } else {
              target = cueTimes.get(call.duration.until)?.t ?? speechEnd;
            }
            let end = this.q(target);
            if (end - t < this.minDuration) {
              if (elastic) this.note(TimelineCodes.DurationClamped, "warning", `\`${call.verb}\` span is ${round(Math.max(0, end - t))}s; clamped to ${this.minDuration}s`, action.line, t);
              end = this.q(t + this.minDuration);
            }
            if (elastic && call.verb === "highlight") end = Math.max(end, this.q(t + this.minEmphasis));
            const dur = end - t;
            const n = call.targets.includes("*") ? 1 : Math.max(1, call.targets.length);
            const callEnd = this.q(t + (n - 1) * call.stagger + dur);
            scheduled.push({
              order: this.order++,
              verb: call.verb,
              targets: call.targets,
              t0: t,
              dur,
              stagger: call.stagger,
              params: call.params,
              ...(call.dest && { dest: call.dest }),
              ...(call.verb === "write" && call.params.sync === true && cue?.words.length && { words: cue.words }),
              line: action.line,
            });
            prevEnd = callEnd;
            if (findVerb(call.verb)?.mustFinish || action.anchor === "end" || beat.type === "wait") mustEnd = Math.max(mustEnd, callEnd);
          }
        }

        const beatEnd = this.q(Math.max(naturalEnd, mustEnd ? mustEnd + this.holdPad : 0));
        const hold = round(beatEnd - naturalEnd);
        if (hold > 0 && beat.type === "speech") {
          this.note(TimelineCodes.HoldInserted, "info", `inserted ${hold}s of silence after this beat so its actions can finish`, beat.line, naturalEnd);
        }
        beats.push({ t0: B, t1: beatEnd, speechEnd, hold, line: beat.line });
        cursor = beatEnd;
      }
      steps.push({ ...(step.id !== undefined && { id: step.id }), t0: stepT0, t1: cursor });
    }

    if (lowPrecision) {
      this.note(TimelineCodes.LowPrecision, "info", `${lowPrecision} cue(s) in scene \`${scene.id}\` use interpolated word timing`, undefined, t0);
    }

    const contentEnd = Math.max(cursor, ...scheduled.map((s) => s.t0 + s.dur + Math.max(0, s.targets.length - 1) * s.stagger));
    const t1 = this.q(contentEnd + this.tailPad + trOut.duration);
    this.expand(scene, scheduled);
    this.scenes.push({ id: scene.id, t0, t1, transitionIn: trIn, transitionOut: trOut, steps, beats });
    return t1;
  }

  /**
   * Where each speech beat's audio starts/ends in the scene's source file:
   * halfway through the pause between beats, so silence can be inserted
   * between beats without cutting a word.
   */
  private beatBounds(beatWords: WordTiming[][], duration: number): number[] {
    const n = beatWords.length;
    const lastT1 = (i: number): number => (i < 0 ? 0 : beatWords[i]!.length ? beatWords[i]![beatWords[i]!.length - 1]!.t1 : lastT1(i - 1));
    const firstT0 = (i: number): number => (i >= n ? duration : beatWords[i]!.length ? beatWords[i]![0]!.t0 : firstT0(i + 1));
    const bounds = [0];
    for (let i = 1; i < n; i++) bounds.push(Math.max(bounds[i - 1]!, (lastT1(i - 1) + firstT0(i)) / 2));
    bounds.push(Math.max(bounds[n - 1] ?? 0, duration));
    return bounds;
  }

  private cueTime(start: number, end: number | undefined, words: WordTiming[], speechEnd: number): CueTime {
    const at = (off: number): { t: number; precision: TimingPrecision } => {
      const w = words.find((w) => off >= w.start && off < w.end);
      if (w) return { t: w.t0 + ((w.t1 - w.t0) * (off - w.start)) / (w.end - w.start), precision: w.precision };
      const next = words.find((w) => w.start >= off);
      if (next) return { t: next.t0, precision: next.precision };
      return { t: speechEnd, precision: words[words.length - 1]?.precision ?? "interpolated" };
    };
    const s = at(start);
    if (end === undefined) return { t: this.q(s.t), precision: s.precision, words: [] };
    const last = [...words].reverse().find((w) => w.start < end && w.end > start);
    // A span ends when its last word has been spoken, even if trailing punctuation sits outside the braces.
    const tEnd = last ? last.t1 : s.t;
    const inside = words.filter((w) => w.start < end && w.end > start).map((w) => ({ t0: this.q(w.t0), t1: this.q(w.t1) }));
    return { t: this.q(s.t), tEnd: this.q(tEnd), precision: s.precision, words: inside };
  }

  // -------------------------------------------------------------- expand ---

  private initScene(scene: SceneIR, prev: SceneIR | undefined): void {
    const { width, height } = this.video.canvas;
    this.initial[`${scene.id}/camera`] = { camera: { x: 0, y: 0, w: width, h: height } };
    for (const el of scene.elements) {
      const target = `${scene.id}/${el.id}`;
      if (prev && scene.keep.includes(el.id) && this.initial[`${prev.id}/${el.id}`]) {
        const from = `${prev.id}/${el.id}`;
        const props: Partial<Record<Prop, Value>> = {};
        for (const p of Object.keys(this.initial[from]!) as Prop[]) props[p] = this.valueAt(from, p, Infinity);
        this.initial[target] = props;
      } else {
        this.initial[target] = { opacity: 0, x: el.box.x + el.box.w / 2, y: el.box.y + el.box.h / 2, scale: 1, rotate: 0, draw: 1, reveal: 1, tint: 0 };
      }
    }
  }

  private expand(scene: SceneIR, scheduled: Scheduled[]): void {
    const elements = new Map(scene.elements.map((e) => [e.id, e]));
    const visible = new Set(scene.keep.filter((id) => (this.initial[`${scene.id}/${id}`]?.opacity as number) > 0));
    const canvas = this.video.canvas;
    scheduled.sort((a, b) => a.t0 - b.t0 || a.order - b.order);

    for (const s of scheduled) {
      if (s.verb === "focus") {
        const target = `${scene.id}/camera`;
        const id = s.targets[0]!;
        const box = id === "reset" ? { x: 0, y: 0, w: canvas.width, h: canvas.height } : focusBox(this.currentBox(scene, elements.get(id), s.t0), canvas);
        const camEase = String(s.params.ease ?? "inout");
        this.add(target, { prop: "camera", t0: s.t0, t1: s.t0 + s.dur, to: box, ease: this.motion.ease[camEase as keyof MotionProfile["ease"]] ?? camEase }, s);
        continue;
      }
      const targets = s.verb === "clear" || s.targets.includes("*") ? [...visible] : s.targets;
      targets.forEach((id, k) => {
        const t0 = this.q(s.t0 + k * s.stagger);
        const base = id.split(".")[0]!;
        const isPart = id !== base;
        const target = `${scene.id}/${id}`;
        if (!this.initial[target]) this.initial[target] = { opacity: 1, scale: 1, tint: 0, draw: 1, reveal: 1 };
        const verb = s.verb === "clear" ? "hide" : s.verb;
        const specs = PRIMITIVES[verb]?.({
          t0,
          dur: s.dur,
          params: s.params,
          el: isPart ? undefined : elements.get(base),
          cur: (p) => this.valueAt(target, p, t0),
          canvas,
          ...(s.dest && { dest: s.dest }),
          ...(s.words && { words: s.words }),
          motion: this.motion,
        }) ?? [];
        for (const spec of specs) this.add(target, spec, s);
        if (!isPart && ENTER.has(verb)) visible.add(base);
        if (!isPart && verb === "hide") visible.delete(base);
      });
    }
  }

  /** The element's on-screen box at t (its layout box moved/scaled by tweens). */
  private currentBox(scene: SceneIR, el: ElementIR | undefined, t: number): Box {
    if (!el) return { x: 0, y: 0, w: this.video.canvas.width, h: this.video.canvas.height };
    const target = `${scene.id}/${el.id}`;
    const x = this.valueAt(target, "x", t) as number;
    const y = this.valueAt(target, "y", t) as number;
    const s = this.valueAt(target, "scale", t) as number;
    const w = el.box.w * s;
    const h = el.box.h * s;
    return { x: x - w / 2, y: y - h / 2, w, h };
  }

  /**
   * Inserts a tween in t0 order and bakes its `from`. If it lands before
   * later tweens of the same property, their unforced `from` values are
   * re-baked so evaluation stays continuous.
   */
  private add(target: string, spec: TweenSpec, s: Scheduled): void {
    const t0 = this.q(spec.t0);
    const t1 = Math.max(t0, this.q(spec.t1));
    const key = `${target}\u0000${spec.prop}`;
    let list = this.byKey.get(key);
    if (!list) this.byKey.set(key, (list = []));

    for (const prev of list) {
      if (prev.t0 < t0 && prev.t1 > t0 && this.callOf.get(prev) !== s.order) {
        const lost = (prev.t1 - t0) / (prev.t1 - prev.t0);
        if (lost > 0.5) this.note(TimelineCodes.Overridden, "warning", `\`${s.verb}\` on \`${target}\` cuts off \`${prev.verb}\` (line ${prev.line}) ${Math.round(lost * 100)}% early`, s.line, t0);
      }
    }

    const tween: Tween = {
      target,
      prop: spec.prop,
      t0,
      t1,
      from: spec.from ?? this.valueAt(target, spec.prop, t0),
      to: spec.to,
      ease: spec.ease,
      ...(spec.meta && { meta: spec.meta }),
      verb: s.verb,
      line: s.line,
    };
    if (spec.from !== undefined) this.forcedFrom.add(tween);
    this.orderOf.set(tween, this.order++);
    this.callOf.set(tween, s.order);

    let i = list.length;
    while (i > 0 && list[i - 1]!.t0 > t0) i--;
    list.splice(i, 0, tween);
    for (let j = i + 1; j < list.length; j++) {
      const later = list[j]!;
      if (!this.forcedFrom.has(later)) later.from = this.valueBefore(target, spec.prop, list, j);
    }
    this.tracks.push(tween);
  }

  /** Property value at t: the latest-started tween with t0 ≤ t, else the initial value. */
  private valueAt(target: string, prop: Prop, t: number): Value {
    const list = this.byKey.get(`${target}\u0000${prop}`) ?? [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.t0 <= t) return tweenValue(list[i]!, t);
    return this.initial[target]?.[prop] ?? defaultValue(prop, this.video.canvas);
  }

  /** Value just as list[j] takes over: governed only by the tweens before it. */
  private valueBefore(target: string, prop: Prop, list: Tween[], j: number): Value {
    const t = list[j]!.t0;
    for (let i = j - 1; i >= 0; i--) if (list[i]!.t0 <= t) return tweenValue(list[i]!, t);
    return this.initial[target]?.[prop] ?? defaultValue(prop, this.video.canvas);
  }

  private note(code: string, severity: SyncReportItem["severity"], message: string, line: number | undefined, t: number): void {
    this.report.push({ code, severity, message, ...(line !== undefined && { line }), t: round(t) });
  }
}

function defaultValue(prop: Prop, canvas: { width: number; height: number }): Value {
  switch (prop) {
    case "camera":
      return { x: 0, y: 0, w: canvas.width, h: canvas.height };
    case "opacity":
    case "scale":
    case "draw":
    case "reveal":
      return 1;
    default:
      return 0;
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
