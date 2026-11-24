import type { ResolvedTimeline } from "@anim/ir";
import type { Choices } from "./choices.js";

/**
 * What happens when a scene ends, chosen in the "Between scenes" menu on the playback bar:
 * - through: the next scene follows at once (an ordinary video);
 * - pause: playback stops on the scene's last frame until the viewer presses Continue (or Space);
 * - auto: playback stops for a short break, counts down, then goes on by itself.
 * The engine's player knows nothing of this: the Studio watches the clock cross a scene's end and holds there.
 */
export type BreakMode = "through" | "pause" | "auto";

export interface SceneBreakHooks {
  /** Stops playback on the last frame before `t`. */
  hold(t: number): void;
  /** Plays on from `t`. */
  resume(t: number): void;
}

const LABELS: Record<BreakMode, string> = { through: "Play through", pause: "Pause each scene", auto: "Short break" };
const MIN_DELAY = 1;
const MAX_DELAY = 30;

export class SceneBreak {
  private mode: BreakMode = "through";
  private delay = 3;
  /** The scene end playback is held at, while the card shows. */
  private holding: number | undefined;
  /** A scene end the viewer already continued past (crossing it again must not stop playback). */
  private released: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private deadline = 0;

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly menu: HTMLElement,
    private readonly card: HTMLElement,
    private readonly hooks: SceneBreakHooks,
    private readonly saved: Choices,
  ) {
    const mode = saved.get("between");
    if (mode === "through" || mode === "pause" || mode === "auto") this.mode = mode;
    const delay = Number(saved.get("betweenDelay"));
    if (Number.isFinite(delay) && delay >= MIN_DELAY && delay <= MAX_DELAY) this.delay = delay;

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });
    menu.addEventListener("click", (e) => e.stopPropagation());
    for (const radio of menu.querySelectorAll<HTMLInputElement>('input[name="between"]')) {
      radio.addEventListener("change", () => this.setMode(radio.value as BreakMode));
    }
    menu.querySelectorAll<HTMLButtonElement>("[data-delay]").forEach((b) => b.addEventListener("click", () => this.setDelay(this.delay + Number(b.dataset.delay))));
    document.addEventListener("click", () => this.closeMenu());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeMenu();
    });
    card.querySelector<HTMLButtonElement>("[data-act=continue]")!.addEventListener("click", (e) => {
      e.stopPropagation();
      this.continue();
    });
    card.querySelector<HTMLButtonElement>("[data-act=stay]")!.addEventListener("click", (e) => {
      e.stopPropagation();
      this.stay();
    });
    this.render();
  }

  /** True while playback is held at a scene's end and the card is showing. */
  get isHolding(): boolean {
    return this.holding !== undefined;
  }

  /** The scene end playback is held at, if any. */
  get heldAt(): number | undefined {
    return this.holding;
  }

  /**
   * Called on every clock tick. Holds playback when it runs across the end of a scene that has another after it.
   * A seek never counts: the player reports it while paused. A long gap between frames still counts (a busy machine
   * or a tab in the background draws rarely), so the stop is never skipped.
   */
  check(tl: ResolvedTimeline, from: number, to: number, playing: boolean, titleOf: (id: string) => string | undefined): void {
    if (this.released !== undefined && to < this.released - 0.05) this.released = undefined;
    if (this.mode === "through" || !playing || this.holding !== undefined || to <= from) return;
    const i = tl.scenes.findIndex((s, k) => k < tl.scenes.length - 1 && from < s.t1 && s.t1 <= to && s.t1 !== this.released);
    if (i < 0) return;
    const end = tl.scenes[i]!.t1;
    this.holding = end;
    this.hooks.hold(end);
    const next = tl.scenes[i + 1]!;
    this.show(i + 1, tl.scenes.length, titleOf(next.id) ?? next.id);
  }

  /** Plays the next scene now. */
  continue(): void {
    const end = this.holding;
    if (end === undefined) return;
    this.dismiss();
    this.released = end;
    this.hooks.resume(end);
  }

  /** Leaves the card without playing on (the viewer seeked, or the video was replaced). */
  dismiss(): void {
    this.stopTimer();
    this.holding = undefined;
    this.card.hidden = true;
  }

  private stay(): void {
    // The countdown stops; the card stays with Continue, as in "pause each scene".
    this.stopTimer();
    this.card.dataset.mode = "pause";
  }

  private show(done: number, total: number, next: string): void {
    this.card.querySelector(".sb-done")!.textContent = `Scene ${done} of ${total} done`;
    this.card.querySelector(".sb-next")!.textContent = next;
    this.card.dataset.mode = this.mode;
    this.card.hidden = false;
    if (this.mode === "auto") this.startTimer();
    this.card.querySelector<HTMLButtonElement>("[data-act=continue]")!.focus({ preventScroll: true });
  }

  private startTimer(): void {
    this.stopTimer();
    this.deadline = performance.now() + this.delay * 1000;
    const tick = () => {
      const left = Math.max(0, this.deadline - performance.now());
      this.card.style.setProperty("--sb-left", String(left / (this.delay * 1000)));
      this.card.querySelector(".sb-count")!.textContent = `Next scene in ${Math.ceil(left / 1000)} s`;
      if (left <= 0) this.continue();
    };
    tick();
    this.timer = setInterval(tick, 100);
  }

  private stopTimer(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private setMode(mode: BreakMode): void {
    this.mode = mode;
    this.saved.set("between", mode);
    // A card already showing follows the new choice.
    if (this.holding !== undefined) {
      if (mode === "through") this.continue();
      else {
        this.card.dataset.mode = mode;
        if (mode === "auto") this.startTimer();
        else this.stopTimer();
      }
    }
    this.render();
  }

  private setDelay(seconds: number): void {
    this.delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.round(seconds)));
    this.saved.set("betweenDelay", String(this.delay));
    if (this.holding !== undefined && this.mode === "auto") this.startTimer();
    this.render();
  }

  private render(): void {
    this.button.querySelector(".between-label")!.textContent = this.mode === "auto" ? `${LABELS.auto} · ${this.delay} s` : LABELS[this.mode];
    this.button.dataset.mode = this.mode;
    for (const radio of this.menu.querySelectorAll<HTMLInputElement>('input[name="between"]')) radio.checked = radio.value === this.mode;
    this.menu.querySelector(".between-delay-value")!.textContent = `${this.delay} s`;
    this.menu.querySelectorAll<HTMLButtonElement>("[data-delay]").forEach((b) => {
      const step = Number(b.dataset.delay);
      b.disabled = (step < 0 && this.delay <= MIN_DELAY) || (step > 0 && this.delay >= MAX_DELAY);
    });
  }

  private toggleMenu(): void {
    const open = this.menu.hidden;
    this.menu.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
    if (open) this.menu.querySelector<HTMLInputElement>('input[name="between"]:checked')?.focus();
  }

  private closeMenu(): void {
    if (this.menu.hidden) return;
    this.menu.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
  }
}
