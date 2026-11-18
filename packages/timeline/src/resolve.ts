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
/** Exit length (s) under any personality but standard, whatever the transition. */
const EXIT = 0.6;
/** Length (s) of a zoom into an element at a scene boundary. */
const INTO = 1;
const ENTER = new Set(["fade", "pop", "draw", "write", "send", "stream", "drop"]);

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
  /** The elements each scene's "you are here" ring is on (see `visit`): one, or the pair being compared. */
  private readonly visiting = new Map<string, string[]>();

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
    // Exits all last the same under a personality: appending a scene turns the last scene's
    // closing fade into a boundary transition, and its end time must not move.
    // `into:<id>` (zoom into an element) is always a full second-ish push, under any personality.
    const into = scene.transitionOut.startsWith("into:");
    const outBase = into ? INTO : this.motion.name !== "standard" && scene.transitionOut !== "cut" ? EXIT : (this.transitions[scene.transitionOut] ?? 0);
    const trOut: ResolvedScene["transitionOut"] = { type: scene.transitionOut, duration: this.q(outBase * (into ? 1 : this.motion.durScale)) };
    const t0 = this.q(start);
    this.initScene(scene, prev);
    this.carryIn(scene, prev, t0);

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
            // A negative delay (only the compiler writes one: a scene heading) reaches back at most to the scene start.
            const t = this.q(Math.max(t0, prevEnd + call.delay));
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

    this.autoFrame(scene, scheduled, beats, steps);
    this.frameClose(scene, scheduled);
    const contentEnd = Math.max(cursor, ...scheduled.map((s) => s.t0 + s.dur + Math.max(0, s.targets.length - 1) * s.stagger));
    const t1 = this.q(contentEnd + this.tailPad + trOut.duration);
    this.expand(scene, scheduled);
    // A slow camera move keeps a held frame alive, unless the script moves the camera itself:
    // in on one scene, back out on the next, so consecutive scenes don't move alike.
    const camera = `${scene.id}/camera`;
    // A motion profile without a push still moves a scene that would otherwise sit frozen for seconds (gentler than any profile's own).
    const push = this.motion.push > 0 ? this.motion.push : this.longestStill(scene.id, t0, t1 - trOut.duration) > 3 ? 0.03 : 0;
    if (push > 0 && !this.byKey.get(`${camera}\u0000camera`)?.length) {
      const { width, height } = this.video.canvas;
      const k = push;
      const full = { x: 0, y: 0, w: width, h: height };
      const close = { x: (width * k) / 2, y: (height * k) / 2, w: width * (1 - k), h: height * (1 - k) };
      const out = this.scenes.length % 2 === 1;
      // A scene that pulls out starts close: that is its camera before anything moves.
      if (out) this.initial[camera] = { camera: close };
      this.add(camera, { prop: "camera", t0, t1, to: out ? full : close, ease: "linear" }, { order: -1, verb: "focus", targets: [], t0, dur: t1 - t0, stagger: 0, params: {}, line: 0 });
    }
    if (into) {
      // Where the element is when the scene ends: the zoom goes into that spot (no such element: a plain fade).
      const id = scene.transitionOut.slice(5);
      const el = scene.elements.find((e) => e.id === id);
      if (el && !el.link) trOut.focus = { x: num(this.valueAt(`${scene.id}/${id}`, "x", Infinity) as number, el.box.x + el.box.w / 2), y: num(this.valueAt(`${scene.id}/${id}`, "y", Infinity) as number, el.box.y + el.box.h / 2) };
      else trOut.type = "fade";
    }
    this.scenes.push({ id: scene.id, t0, t1, transitionIn: trIn, transitionOut: trOut, steps, beats });
    return t1;
  }

  /** The longest stretch (seconds) of the scene's time in which none of its elements is being tweened. */
  private longestStill(sceneId: string, t0: number, t1: number): number {
    const spans: [number, number][] = [];
    for (const [key, list] of this.byKey) {
      if (!key.startsWith(`${sceneId}/`)) continue;
      for (const tw of list) if (tw.t1 > tw.t0) spans.push([tw.t0, tw.t1]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    let cursor = t0;
    let gap = 0;
    for (const [a, b] of spans) {
      gap = Math.max(gap, a - cursor);
      cursor = Math.max(cursor, b);
    }
    return Math.max(gap, t1 - cursor);
  }

  /** A slow push of 4% after a camera move that sets `drift` (seconds), ending before the next move. */
  private cameraDrift(target: string, box: Box, s: Scheduled): void {
    const len = Number(s.params.drift ?? 0);
    if (!(len > 0.6)) return;
    const k = 0.04;
    const to = { x: box.x + (box.w * k) / 2, y: box.y + (box.h * k) / 2, w: box.w * (1 - k), h: box.h * (1 - k) };
    this.add(target, { prop: "camera", t0: s.t0 + s.dur, t1: s.t0 + s.dur + len, to, ease: "linear" }, s);
  }

  /**
   * `frame=close`: the scene opens with the camera close on its first element and pulls out to the full
   * view just after the first sentence begins. Not for scenes that move the camera themselves.
   */
  private frameClose(scene: SceneIR, scheduled: Scheduled[]): void {
    if (scene.frame !== "close") return;
    // Camera lines of the scene's own take over only when one comes at the start; a later one (a closing frame) follows the opening.
    const start = Math.min(...scheduled.map((s) => s.t0), Infinity);
    if (scene.steps.some((s) => s.focus) || scheduled.some((s) => (s.verb === "focus" || s.verb === "frame") && s.t0 <= start + 0.6)) return;
    const SKIP = new Set(["panel", "rule", "zone", "chevron", "badge", "kicker", "caption", "title", "footer"]);
    const first = scene.elements.find((e) => !e.link && e.box.w > 0 && !SKIP.has(e.kind) && e.id !== "title");
    if (!first) return;
    const canvas = this.video.canvas;
    const close = focusBox(first.box, canvas, 1.2, 0.3);
    const camera = `${scene.id}/camera`;
    this.initial[camera] = { camera: close };
    const t0 = this.q(Math.min(...scheduled.map((s) => s.t0), Infinity));
    const from = Number.isFinite(t0) ? t0 : this.q(this.initial[camera] ? 0 : 0);
    this.add(camera, { prop: "camera", t0: from, t1: from + 1.4, to: { x: 0, y: 0, w: canvas.width, h: canvas.height }, ease: "inout" }, { order: this.order++, verb: "focus", targets: ["reset"], t0: from, dur: 1.4, stagger: 0, params: {}, line: 0 });
  }

  /**
   * A dense template scene (8+ things) with no camera lines of its own gets a
   * camera that follows the action: each beat frames the group it acts on when
   * that group is a small part of the canvas, pulls out when it isn't, and
   * ends the scene on the full view.
   */
  private autoFrame(scene: SceneIR, scheduled: Scheduled[], beats: { t0: number; t1: number }[], steps: { id?: string; t0: number; t1: number }[]): void {
    // An anatomy bar spans the whole width, so any close-up would cut its neighbouring parts at the frame edge.
    // A branch graph fits the frame, and its lane names sit left of the commits: a close-up would cut them.
    // A data structure is at most 8 cells and also fits the frame: a close-up would cut off what sits beside it.
    if (scene.template === "gitgraph" || scene.template === "structure") return;
    if (!scene.template || scene.template === "anatomy") return;
    const BACK = new Set(["panel", "rule", "zone", "chevron", "badge", "kicker", "caption"]);
    const els = new Map(scene.elements.map((e) => [e.id, e]));
    // A scene written as chapters (several steps) is one diagram that grows: the camera follows it from 5 things on.
    const chapters = scene.steps.filter((s) => s.id !== undefined).length > 1;
    if (scene.elements.filter((e) => !e.link && e.box.w > 0 && !BACK.has(e.kind)).length < (chapters ? 5 : 8)) return;
    if (scene.steps.some((s) => s.focus) || scheduled.some((s) => s.verb === "focus" || s.verb === "frame")) return;
    const { width, height } = this.video.canvas;
    const added: Scheduled[] = [];
    // In a diagram written as chapters the camera keeps creeping in for the rest of the chapter, so a long sentence never sits on a frozen frame.
    const camera = (verb: "frame" | "focus", targets: string[], t0: number, drift = 0): void => {
      added.push({ order: this.order++, verb, targets, t0, dur: 0.9, stagger: 0, params: drift > 0.6 ? { drift } : {}, line: 0 });
    };
    let framed = false;
    // A diagram written as chapters keeps one framing per chapter; any other dense scene re-frames every beat.
    const units = chapters ? steps.filter((st) => st.t1 > st.t0) : beats;
    for (const b of units) {
      const ids = new Set<string>();
      for (const s of scheduled) {
        if (s.t0 < b.t0 - 1e-6 || s.t0 >= b.t1 - 1e-6 || ["clear", "hide", "lift"].includes(s.verb)) continue;
        for (const t of s.targets) {
          const e = els.get(t.split(".")[0]!);
          if (!e || e.id === "title") continue;
          if (e.link) {
            ids.add(e.link.from);
            ids.add(e.link.to);
          } else if (!BACK.has(e.kind)) ids.add(e.id);
        }
      }
      const boxes = [...ids].map((id) => els.get(id)?.box).filter((x): x is Box => !!x && x.w > 0);
      if (!boxes.length) continue;
      const w = Math.max(...boxes.map((x) => x.x + x.w)) - Math.min(...boxes.map((x) => x.x));
      const h = Math.max(...boxes.map((x) => x.y + x.h)) - Math.min(...boxes.map((x) => x.y));
      if ((w * h) / (width * height) < 0.4) {
        camera("frame", [...ids], b.t0, chapters ? b.t1 - b.t0 - 0.95 : 0);
        framed = true;
      } else if (framed || chapters) {
        camera("focus", ["reset"], b.t0, chapters ? b.t1 - b.t0 - 0.95 : 0);
        framed = false;
      }
    }
    if (framed) camera("focus", ["reset"], units[units.length - 1]!.t1);
    scheduled.push(...added);
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
      } else if (prev && scene.carry?.includes(el.id) && this.initial[`${prev.id}/${el.id}`]) {
        // Carried: starts where it ended in the previous scene, as large as it looked there (carryIn moves it to its new place).
        const from = `${prev.id}/${el.id}`;
        const props: Partial<Record<Prop, Value>> = {};
        for (const p of Object.keys(this.initial[from]!) as Prop[]) props[p] = this.valueAt(from, p, Infinity);
        const old = prev.elements.find((e) => e.id === el.id);
        if (old && old.box.w > 0 && el.box.w > 0) props.scale = Math.min(3, Math.max(0.3, (num(props.scale, 1) * old.box.w) / el.box.w));
        this.initial[target] = props;
      } else {
        this.initial[target] = { opacity: 0, x: el.box.x + el.box.w / 2, y: el.box.y + el.box.h / 2, scale: 1, rotate: 0, draw: 1, reveal: 1, tint: 0 };
      }
    }
  }

  /**
   * A scene that carries elements on from the previous one: the carried
   * element moves from where it was to its place in this scene, and what
   * the previous scene still showed (everything else) fades out just before.
   */
  private carryIn(scene: SceneIR, prev: SceneIR | undefined, t0: number): void {
    if (!prev || !scene.carry?.length) return;
    const call = (id: string): Scheduled => ({ order: this.order++, verb: "move", targets: [id], t0, dur: 0.8, stagger: 0, params: {}, line: 0 });
    for (const el of scene.elements) {
      if (!scene.carry.includes(el.id) || !this.initial[`${scene.id}/${el.id}`]) continue;
      const target = `${scene.id}/${el.id}`;
      const s = call(el.id);
      const [cx, cy] = [el.box.x + el.box.w / 2, el.box.y + el.box.h / 2];
      const now = this.initial[target]!;
      if (Math.abs(num(now.x as number, cx) - cx) > 1) this.add(target, { prop: "x", t0, t1: t0 + 0.8, to: cx, ease: "inout" }, s);
      if (Math.abs(num(now.y as number, cy) - cy) > 1) this.add(target, { prop: "y", t0, t1: t0 + 0.8, to: cy, ease: "inout" }, s);
      if (Math.abs(num(now.scale as number, 1) - 1) > 0.01) this.add(target, { prop: "scale", t0, t1: t0 + 0.8, to: 1, ease: "inout" }, s);
    }
    // The rest of the previous scene clears away just before the cut.
    const keepOn = new Set([...scene.carry, ...scene.keep]);
    for (const el of prev.elements) {
      const target = `${prev.id}/${el.id}`;
      if (keepOn.has(el.id) || num(this.valueAt(target, "opacity", Infinity) as number, 0) <= 0.01) continue;
      this.add(target, { prop: "opacity", t0: Math.max(0, t0 - 0.35), t1: t0, to: 0, ease: "in" }, call(el.id));
    }
  }

  private expand(scene: SceneIR, scheduled: Scheduled[]): void {
    const elements = new Map(scene.elements.map((e) => [e.id, e]));
    const visible = new Set([...scene.keep, ...(scene.carry ?? [])].filter((id) => (this.initial[`${scene.id}/${id}`]?.opacity as number) > 0));
    const canvas = this.video.canvas;
    scheduled.sort((a, b) => a.t0 - b.t0 || a.order - b.order);

    for (const s of scheduled) {
      if (s.verb === "focus") {
        const target = `${scene.id}/camera`;
        const id = s.targets[0]!;
        const box = id === "reset" ? { x: 0, y: 0, w: canvas.width, h: canvas.height } : focusBox(this.currentBox(scene, elements.get(id), s.t0), canvas);
        const camEase = String(s.params.ease ?? "inout");
        this.add(target, { prop: "camera", t0: s.t0, t1: s.t0 + s.dur, to: box, ease: this.motion.ease[camEase as keyof MotionProfile["ease"]] ?? camEase }, s);
        this.cameraDrift(target, box, s);
        continue;
      }
      if (s.verb === "frame") {
        // The camera frames the group: the union of the elements' boxes plus context.
        const boxes = s.targets.map((id) => this.currentBox(scene, elements.get(id), s.t0)).filter((b) => b.w > 0);
        if (!boxes.length) continue;
        const x0 = Math.min(...boxes.map((b) => b.x));
        const y0 = Math.min(...boxes.map((b) => b.y));
        const x1 = Math.max(...boxes.map((b) => b.x + b.w));
        const y1 = Math.max(...boxes.map((b) => b.y + b.h));
        const camEase = String(s.params.ease ?? "inout");
        let group = { x0, y0, x1, y1 };
        let framed = focusBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, canvas, 1.5, 0.5);
        // Never cut a shown element in half at the frame edge: take in whatever the frame would cut, until it cuts nothing.
        for (let i = 0; i < 4; i++) {
          const f = framed;
          const cut = [...visible]
            .map((id) => elements.get(id))
            .filter((e): e is NonNullable<typeof e> => !!e && !e.link && e.box.w > 0)
            .map((e) => this.currentBox(scene, e, s.t0))
            .filter((b) => b.x < f.x + f.w && b.x + b.w > f.x && b.y < f.y + f.h && b.y + b.h > f.y)
            .filter((b) => b.x < f.x - 1 || b.y < f.y - 1 || b.x + b.w > f.x + f.w + 1 || b.y + b.h > f.y + f.h + 1);
          if (!cut.length) break;
          group = {
            x0: Math.min(group.x0, ...cut.map((b) => b.x)),
            y0: Math.min(group.y0, ...cut.map((b) => b.y)),
            x1: Math.max(group.x1, ...cut.map((b) => b.x + b.w)),
            y1: Math.max(group.y1, ...cut.map((b) => b.y + b.h)),
          };
          framed = focusBox({ x: group.x0, y: group.y0, w: group.x1 - group.x0, h: group.y1 - group.y0 }, canvas, 1.15, 0.5);
        }
        // A frame that takes in nearly everything is the full view.
        if (framed.w > canvas.width * 0.85) framed = { x: 0, y: 0, w: canvas.width, h: canvas.height };
        this.add(`${scene.id}/camera`, { prop: "camera", t0: s.t0, t1: s.t0 + s.dur, to: framed, ease: this.motion.ease[camEase as keyof MotionProfile["ease"]] ?? camEase }, s);
        this.cameraDrift(`${scene.id}/camera`, framed, s);
        continue;
      }
      if (s.verb === "clone" && s.targets.length >= 2) {
        // A copy flies from the source to each destination (declared hidden) and settles there.
        const src = elements.get(s.targets[0]!);
        if (!src) continue;
        const A = this.currentBox(scene, src, s.t0);
        for (const id of s.targets.slice(1)) {
          const el = elements.get(id);
          if (!el) continue;
          const target = `${scene.id}/${id}`;
          if (!this.initial[target]) this.initial[target] = { opacity: 0, scale: 1, tint: 0, draw: 1, reveal: 1 };
          const [cx, cy] = [el.box.x + el.box.w / 2, el.box.y + el.box.h / 2];
          const k = el.box.w > 0 ? Math.min(3, Math.max(0.3, A.w / el.box.w)) : 1;
          this.add(target, { prop: "opacity", t0: s.t0, t1: s.t0 + 0.15, from: 0, to: 1, ease: "out" }, s);
          this.add(target, { prop: "x", t0: s.t0, t1: s.t0 + s.dur, from: A.x + A.w / 2, to: cx, ease: "inout" }, s);
          this.add(target, { prop: "y", t0: s.t0, t1: s.t0 + s.dur, from: A.y + A.h / 2, to: cy, ease: "inout" }, s);
          this.add(target, { prop: "scale", t0: s.t0, t1: s.t0 + s.dur, from: k, to: 1, ease: "inout" }, s);
          visible.add(id);
        }
        continue;
      }
      if (s.verb === "merge" && s.targets.length >= 2) {
        // The sources fly into the last element and vanish; it appears as they arrive.
        const dest = elements.get(s.targets[s.targets.length - 1]!);
        if (!dest) continue;
        const [cx, cy] = [dest.box.x + dest.box.w / 2, dest.box.y + dest.box.h / 2];
        for (const id of s.targets.slice(0, -1)) {
          const el = elements.get(id);
          if (!el) continue;
          const target = `${scene.id}/${id}`;
          if (!this.initial[target]) this.initial[target] = { opacity: 1, scale: 1, tint: 0, draw: 1, reveal: 1 };
          const k = el.box.w > 0 ? Math.min(3, Math.max(0.3, dest.box.w / el.box.w)) : 1;
          this.add(target, { prop: "x", t0: s.t0, t1: s.t0 + s.dur, to: cx, ease: "inout" }, s);
          this.add(target, { prop: "y", t0: s.t0, t1: s.t0 + s.dur, to: cy, ease: "inout" }, s);
          this.add(target, { prop: "scale", t0: s.t0, t1: s.t0 + s.dur, to: k, ease: "inout" }, s);
          this.add(target, { prop: "opacity", t0: s.t0 + s.dur * 0.6, t1: s.t0 + s.dur, to: 0, ease: "in" }, s);
          visible.delete(id);
        }
        const target = `${scene.id}/${dest.id}`;
        if (!this.initial[target]) this.initial[target] = { opacity: 0, scale: 1, tint: 0, draw: 1, reveal: 1 };
        this.add(target, { prop: "opacity", t0: s.t0 + s.dur * 0.6, t1: s.t0 + s.dur, from: 0, to: 1, ease: "out" }, s);
        visible.add(dest.id);
        continue;
      }
      if (s.verb === "swap" && s.targets.length >= 2) {
        // Two elements trade places along arcs (one over, one under).
        const [a, b] = [s.targets[0]!, s.targets[1]!];
        const [ea, eb] = [elements.get(a), elements.get(b)];
        if (!ea || !eb) continue;
        const [A, B] = [this.currentBox(scene, ea, s.t0), this.currentBox(scene, eb, s.t0)];
        const mid = s.t0 + s.dur / 2;
        const bump = 0.4 * Math.max(A.h, B.h, 120);
        for (const [id, from, to, dir] of [[a, A, B, -1], [b, B, A, 1]] as const) {
          const target = `${scene.id}/${id}`;
          if (!this.initial[target]) this.initial[target] = { opacity: 1, scale: 1, tint: 0, draw: 1, reveal: 1 };
          const [fy, tx, ty] = [from.y + from.h / 2, to.x + to.w / 2, to.y + to.h / 2];
          this.add(target, { prop: "x", t0: s.t0, t1: s.t0 + s.dur, to: tx, ease: "inout" }, s);
          this.add(target, { prop: "y", t0: s.t0, t1: mid, to: (fy + ty) / 2 + dir * bump, ease: "out" }, s);
          this.add(target, { prop: "y", t0: mid, t1: s.t0 + s.dur, to: ty, ease: "in" }, s);
        }
        continue;
      }
      if (s.verb === "visit" || s.verb === "mark") {
        // One ring of "you are here" (on several targets when a pair is visited): a visit releases the previous one (unless it was marked since).
        const ids = s.targets.filter((t) => t !== "*");
        const cur = this.visiting.get(scene.id) ?? [];
        if (s.verb === "visit") {
          for (const c of cur) if (!ids.includes(c)) this.add(`${scene.id}/${c}`, { prop: "tint", t0: s.t0, t1: s.t0 + 0.3, to: 0, ease: "out", meta: { color: "accent", style: "glow" } }, s);
          this.visiting.set(scene.id, ids);
        } else {
          const left = cur.filter((c) => !ids.includes(c));
          if (left.length) this.visiting.set(scene.id, left);
          else this.visiting.delete(scene.id);
        }
      }
      const targets = s.verb === "clear" || s.targets.includes("*") ? [...visible] : s.targets;
      targets.forEach((id, k) => {
        const t0 = this.q(s.t0 + k * s.stagger);
        const base = id.split(".")[0]!;
        const isPart = id !== base;
        const target = `${scene.id}/${id}`;
        const verb = s.verb === "clear" ? "hide" : s.verb;
        if (isPart && ENTER.has(verb) && elements.has(base) && !visible.has(base)) {
          // Showing a part of a hidden element (a list revealed item by item) shows the element;
          // its parts that are entered on their own start hidden and appear on their turn.
          for (const other of scheduled) {
            if (!ENTER.has(other.verb)) continue;
            for (const pid of other.targets) {
              const key = `${scene.id}/${pid}`;
              if (pid.startsWith(`${base}.`) && !this.initial[key]) this.initial[key] = { opacity: 0, scale: 1, tint: 0, draw: 1, reveal: 1 };
            }
          }
          this.add(`${scene.id}/${base}`, { prop: "opacity", t0, t1: t0, to: 1, ease: "linear" }, s);
          visible.add(base);
        }
        if (!this.initial[target]) this.initial[target] = { opacity: 1, scale: 1, tint: 0, draw: 1, reveal: 1 };
        const specs = PRIMITIVES[verb]?.({
          t0,
          dur: s.dur,
          params: s.params,
          el: isPart ? undefined : elements.get(base),
          part: isPart,
          cur: (p) => this.valueAt(target, p, t0),
          canvas,
          ...(s.dest && { dest: s.dest }),
          ...(s.words && { words: s.words }),
          motion: this.motion,
        }) ?? [];
        for (const spec of specs) this.add(target, spec, s);
        if (!isPart && ENTER.has(verb)) visible.add(base);
        if (!isPart && (verb === "hide" || verb === "lift")) visible.delete(base);
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

const num = (v: Value | undefined, d: number): number => (typeof v === "number" ? v : d);

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
