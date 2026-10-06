import type { ResolvedTimeline } from "@anim/ir";
import type { Stage } from "./stage.js";

export interface PlayerOptions {
  /** Maps a timeline audio `src` to a fetchable URL. */
  resolveAudio?: (src: string) => string;
  /** Called on every rendered frame while playing, and on seek. */
  onTime?: (t: number) => void;
  onEnd?: () => void;
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
  private playing = false;
  private t = 0;
  private startedAt = 0;
  private startT = 0;
  private raf = 0;

  constructor(
    private readonly stage: Stage,
    private readonly timeline: ResolvedTimeline,
    private readonly opts: PlayerOptions = {},
  ) {}

  get duration(): number {
    return this.timeline.duration;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get time(): number {
    if (!this.playing) return this.t;
    const elapsed = this.ctx ? this.ctx.currentTime - this.startedAt : (performance.now() - this.startedAt) / 1000;
    return this.startT + elapsed;
  }

  /** Fetches and decodes narration. Safe to skip: playback then runs silent on a timer. */
  async load(): Promise<void> {
    const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!AC) return;
    this.ctx ??= new AC();
    const resolve = this.opts.resolveAudio ?? ((s: string) => s);
    const srcs = [...new Set(this.timeline.audio.map((a) => a.src))];
    await Promise.all(
      srcs.map(async (src) => {
        const res = await fetch(resolve(src));
        if (!res.ok) throw new Error(`audio ${src}: HTTP ${res.status}`);
        this.buffers.set(src, await this.ctx!.decodeAudioData(await res.arrayBuffer()));
      }),
    );
  }

  play(): void {
    if (this.playing) return;
    if (this.t >= this.duration) this.t = 0;
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
    if (!this.playing) return;
    this.t = this.time;
    this.playing = false;
    this.stopSources();
    cancelAnimationFrame(this.raf);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number): void {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    this.t = Math.min(Math.max(t, 0), this.duration);
    this.stage.render(this.t);
    this.opts.onTime?.(this.t);
    if (wasPlaying) this.play();
  }

  /** Schedules every narration clip that is still to be heard from t onward. */
  private schedule(t: number): void {
    const ctx = this.ctx!;
    for (const clip of this.timeline.audio) {
      const end = clip.t0 + clip.duration;
      const buffer = this.buffers.get(clip.src);
      if (!buffer || end <= t) continue;
      const into = Math.max(0, t - clip.t0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(this.startedAt + Math.max(0, clip.t0 - t), clip.offset + into, clip.duration - into);
      this.sources.push(src);
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
  }

  private loop = (): void => {
    if (!this.playing) return;
    const t = this.time;
    if (t >= this.duration) {
      this.pause();
      this.t = this.duration;
      this.stage.render(this.duration);
      this.opts.onTime?.(this.duration);
      this.opts.onEnd?.();
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
