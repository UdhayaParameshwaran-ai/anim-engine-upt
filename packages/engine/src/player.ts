import type { ResolvedTimeline } from "@anim/ir";
import type { Stage } from "./stage.js";

export interface PlayerOptions {
  /** Maps a timeline audio `src` to a fetchable URL. */
  resolveAudio?: (src: string) => string;
  /** Called on every rendered frame while playing, and on seek. */
  onTime?: (t: number) => void;
  onEnd?: () => void;
  /**
   * Live mode: the timeline is still growing (scenes arrive while generation
   * runs). Reaching its end holds on the last frame instead of ending, until
   * `extend` brings more or `finish` closes it.
   */
  live?: boolean;
  /** Called when a live player starts or stops waiting for more timeline. */
  onWait?: (waiting: boolean) => void;
}

/**
 * Live playback. The clock is the audio clock (AudioContext.currentTime)
 * whenever narration is loaded, so picture follows sound and cannot drift;
 * without audio it falls back to performance.now(). Pause, resume and seek
 * just move the clock — the stage renders any t statelessly.
 */
export class Player {
  private ctx: AudioContext | undefined;
  private readonly buffers = new Map<string, AudioBuffer>();
  private sources: AudioBufferSourceNode[] = [];
  private scheduled = new Set<string>();
  private playing = false;
  private waiting = false;
  private open: boolean;
  private t = 0;
  private startedAt = 0;
  private startT = 0;
  private raf = 0;

  constructor(
    private stage: Stage,
    private timeline: ResolvedTimeline,
    private readonly opts: PlayerOptions = {},
  ) {
    this.open = opts.live ?? false;
  }

  get duration(): number {
    return this.timeline.duration;
  }

  get isPlaying(): boolean {
    return this.playing || this.waiting;
  }

  /** True while a live player holds at the end of the timeline so far. */
  get isWaiting(): boolean {
    return this.waiting;
  }

  get time(): number {
    if (!this.playing) return this.t;
    const elapsed = this.ctx ? this.ctx.currentTime - this.startedAt : (performance.now() - this.startedAt) / 1000;
    return this.startT + elapsed;
  }

  /** Fetches and decodes narration not loaded yet. Safe to skip: playback then runs silent on a timer. */
  async load(): Promise<void> {
    const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!AC) return;
    this.ctx ??= new AC();
    const resolve = this.opts.resolveAudio ?? ((s: string) => s);
    const srcs = [...new Set(this.timeline.audio.map((a) => a.src))].filter((s) => !this.buffers.has(s));
    await Promise.all(
      srcs.map(async (src) => {
        const res = await fetch(resolve(src));
        if (!res.ok) throw new Error(`audio ${src}: HTTP ${res.status}`);
        this.buffers.set(src, await this.ctx!.decodeAudioData(await res.arrayBuffer()));
      }),
    );
  }

  /**
   * Swaps in a longer timeline (and the stage built for it) without
   * interrupting playback: the times already resolved don't change when
   * scenes are appended, so the clock just keeps running. A waiting player
   * resumes. Pass `final` with the last update.
   */
  async extend(stage: Stage, timeline: ResolvedTimeline, final = false): Promise<void> {
    const prev = this.timeline;
    this.timeline = timeline;
    this.stage = stage;
    if (final) this.open = false;
    try {
      if (this.ctx || prev.audio.length === 0) await this.load();
    } finally {
      if (this.playing && this.ctx) this.schedule(this.time);
      if (!this.playing) this.stage.render(this.t);
      if (this.waiting && (this.t < this.duration - 1e-6 || !this.open)) {
        this.setWaiting(false);
        if (this.t < this.duration - 1e-6) this.play();
        else this.end();
      }
    }
  }

  /** Closes a live timeline: reaching its end now ends playback. */
  finish(): void {
    this.open = false;
    if (this.waiting) {
      this.setWaiting(false);
      this.end();
    }
  }

  play(): void {
    if (this.playing) return;
    if (this.t >= this.duration && !this.open) this.t = 0;
    this.playing = true;
    this.startT = this.t;
    if (this.ctx && this.buffers.size) {
      void this.ctx.resume();
      this.startedAt = this.ctx.currentTime;
      this.schedule(this.t);
    } else {
      this.ctx = undefined;
      this.startedAt = performance.now();
    }
    this.loop();
  }

  pause(): void {
    if (this.waiting) this.setWaiting(false);
    if (!this.playing) return;
    this.halt();
  }

  toggle(): void {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  seek(t: number): void {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();
    this.t = Math.min(Math.max(t, 0), this.duration);
    this.stage.render(this.t);
    this.opts.onTime?.(this.t);
    if (wasPlaying) this.play();
  }

  private halt(): void {
    this.t = this.time;
    this.playing = false;
    this.stopSources();
    cancelAnimationFrame(this.raf);
  }

  private end(): void {
    this.t = this.duration;
    this.stage.render(this.duration);
    this.opts.onTime?.(this.duration);
    this.opts.onEnd?.();
  }

  private setWaiting(w: boolean): void {
    this.waiting = w;
    this.opts.onWait?.(w);
  }

  /** Schedules every narration clip still to be heard from t onward that isn't already playing. */
  private schedule(t: number): void {
    const ctx = this.ctx!;
    for (const clip of this.timeline.audio) {
      const key = `${clip.src}@${clip.t0}`;
      const end = clip.t0 + clip.duration;
      const buffer = this.buffers.get(clip.src);
      if (!buffer || end <= t || this.scheduled.has(key)) continue;
      const into = Math.max(0, t - clip.t0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(this.startedAt + Math.max(clip.t0, t) - this.startT, clip.offset + into, clip.duration - into);
      this.sources.push(src);
      this.scheduled.add(key);
    }
  }

  private stopSources(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.sources = [];
    this.scheduled.clear();
  }

  private loop = (): void => {
    if (!this.playing) return;
    const t = this.time;
    if (t >= this.duration) {
      this.halt();
      this.t = this.duration;
      if (this.open) {
        this.stage.render(this.duration);
        this.opts.onTime?.(this.duration);
        this.setWaiting(true);
      } else this.end();
      return;
    }
    this.stage.render(t);
    this.opts.onTime?.(t);
    this.raf = requestAnimationFrame(this.loop);
  };
}

/** Hook for the headless video renderer: deterministic frame stepping. */
export interface RenderHook {
  fps: number;
  duration: number;
  frames: number;
  /** Renders frame `i` (time i/fps). */
  frame(i: number): void;
}

export function exposeForRender(stage: Stage, target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): RenderHook {
  const fps = stage.timeline.fps;
  const hook: RenderHook = {
    fps,
    duration: stage.duration,
    frames: Math.round(stage.duration * fps),
    frame: (i) => stage.render(i / fps),
  };
  target.__anim = hook;
  return hook;
}
