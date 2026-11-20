/**
 * YouTube-style controls on the video: back 10 s, play/pause and forward 10 s in the middle; a click on the
 * picture plays or pauses; a double click on its left or right third skips 10 s, with a "−10 s"/"+10 s" flash on
 * that side (the arrow keys show the same flash). While playing, the controls fade out after a moment without
 * mouse movement; while paused they stay.
 */
export interface VideoControlsHooks {
  toggle(): void;
  skip(seconds: number): void;
}

/** How long a single click waits to be sure it is not the first half of a double click. */
const CLICK_DELAY = 250;
/** How long the controls stay after the mouse stops, while playing. */
const IDLE_AFTER = 2500;

export class VideoControls {
  private playing = false;
  private clickTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly flashTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly root: HTMLElement,
    private readonly hooks: VideoControlsHooks,
    private readonly skipBy = 10,
  ) {
    root.addEventListener("click", (e) => this.onClick(e));
    root.addEventListener("pointermove", () => this.wake());
    root.addEventListener("focusin", () => this.wake());
    root.addEventListener("pointerleave", () => this.sleepSoon(600));
  }

  setEnabled(on: boolean): void {
    this.root.hidden = !on;
    if (!on) this.cancelClick();
  }

  setPlaying(playing: boolean): void {
    if (playing === this.playing) return;
    this.playing = playing;
    this.root.dataset.state = playing ? "playing" : "paused";
    const play = this.root.querySelector<HTMLElement>(".vc-play");
    play?.setAttribute("aria-label", playing ? "Pause" : "Play");
    if (playing) this.sleepSoon(IDLE_AFTER);
    else this.wake(false);
  }

  /** Shows "−10 s" or "+10 s" on the side the skip went. */
  flash(seconds: number): void {
    const side = this.root.querySelector<HTMLElement>(seconds < 0 ? ".vc-flash-left" : ".vc-flash-right");
    if (!side) return;
    side.textContent = `${seconds < 0 ? "−" : "+"}${Math.abs(seconds)} s`;
    side.classList.remove("on");
    // Restart the animation when skips follow each other.
    void side.offsetWidth;
    side.classList.add("on");
    clearTimeout(this.flashTimers.get(side));
    this.flashTimers.set(side, setTimeout(() => side.classList.remove("on"), 650));
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const button = target.closest<HTMLElement>(".vc-btn");
    if (button) {
      this.cancelClick();
      const skip = Number(button.dataset.skip);
      if (skip) this.skip(skip);
      else this.hooks.toggle();
      this.wake();
      return;
    }
    // On the picture: one click plays or pauses, a double click on a side skips.
    const zone = target.closest<HTMLElement>("[data-zone]")?.dataset.zone;
    if (e.detail >= 2) {
      this.cancelClick();
      if (zone === "left") this.skip(-this.skipBy);
      if (zone === "right") this.skip(this.skipBy);
      return;
    }
    this.cancelClick();
    this.clickTimer = setTimeout(() => {
      this.clickTimer = undefined;
      this.hooks.toggle();
    }, CLICK_DELAY);
  }

  private skip(seconds: number): void {
    this.hooks.skip(seconds);
    this.flash(seconds);
  }

  private cancelClick(): void {
    clearTimeout(this.clickTimer);
    this.clickTimer = undefined;
  }

  /** Shows the controls; while playing they hide again after a moment. */
  private wake(again = true): void {
    this.root.classList.remove("idle");
    clearTimeout(this.idleTimer);
    if (again && this.playing) this.sleepSoon(IDLE_AFTER);
  }

  private sleepSoon(ms: number): void {
    clearTimeout(this.idleTimer);
    if (!this.playing) return;
    this.idleTimer = setTimeout(() => {
      if (this.playing) this.root.classList.add("idle");
    }, ms);
  }
}
