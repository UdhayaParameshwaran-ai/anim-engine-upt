import { Stage } from "@anim/engine";
import type { ResolvedScene, ResolvedTimeline, VideoIR } from "@anim/ir";
import { escape } from "./util.js";

/** One scene as the grid shows it. */
export interface SceneCard {
  /** 1-based position in the video. */
  index: number;
  id: string;
  title: string;
  template?: string;
  t0: number;
  t1: number;
  /** First source line of the scene (its first element or beat), 0 when unknown. */
  line: number;
  /** When the thumbnail is taken: the scene fully built, before it starts to leave. */
  thumbAt: number;
}

/**
 * The scenes of a built video, in order. A resolved scene has no title or source line of its own, so the title
 * comes from the IR and the line from the scene's first element or beat.
 */
export function sceneCards(ir: VideoIR, tl: ResolvedTimeline): SceneCard[] {
  return tl.scenes.map((s, i) => {
    // By position first: two scenes may share an id, and each card must describe its own.
    const sceneIr = ir.scenes[i]?.id === s.id ? ir.scenes[i] : ir.scenes.find((x) => x.id === s.id);
    const lines = [...(sceneIr?.elements ?? []).map((e) => e.line), ...s.beats.map((b) => b.line)].filter((l) => l > 0);
    return {
      index: i + 1,
      id: s.id,
      title: sceneIr?.title?.trim() || s.id,
      ...(sceneIr?.template && { template: sceneIr.template }),
      t0: s.t0,
      t1: s.t1,
      line: lines.length ? Math.min(...lines) : 0,
      thumbAt: thumbTime(s),
    };
  });
}

/** The end of the scene's last beat (everything shown), kept clear of the transitions in and out. */
export function thumbTime(s: ResolvedScene): number {
  const start = s.t0 + (s.transitionIn?.duration ?? 0);
  const end = s.t1 - (s.transitionOut?.duration ?? 0) - 0.05;
  const built = s.beats.length ? s.beats[s.beats.length - 1]!.t1 - 0.05 : (s.t0 + s.t1) / 2;
  return Math.max(s.t0, Math.min(Math.max(built, start), end));
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export interface SceneGridHooks {
  /** Show the video at `t` (the grid's caller pauses there). */
  seek(t: number): void;
  /** Open source line `line` in the script editor. */
  select(line: number): void;
}

/**
 * Every scene of the built video as a card with a thumbnail. A click jumps to the scene; "source" opens it in the
 * script. Thumbnails are snapshots: one offscreen Stage renders each scene's moment and its DOM is copied into the
 * card, so N scenes cost one stage, not N. They are taken one per idle moment, so building never stalls playback.
 * When a video grows (scenes arriving during generation), cards already shown are kept and only new ones are drawn.
 */
export class SceneGrid {
  private cards: SceneCard[] = [];
  /** Position (0-based) of the scene being played. Scenes are told apart by position: two may share an id. */
  private active: number | undefined;
  /** Width of the video canvas, to scale the snapshots. */
  private canvasWidth = 1920;
  private job = 0;
  private pending: Promise<void> = Promise.resolve();
  private readonly resizer: ResizeObserver | undefined;

  constructor(
    private readonly list: HTMLElement,
    private readonly hooks: SceneGridHooks,
    private readonly count?: HTMLElement,
  ) {
    list.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const src = target.closest<HTMLElement>(".sg-src");
      if (src) {
        hooks.select(Number(src.dataset.line));
        return;
      }
      const open = target.closest<HTMLElement>(".sg-open");
      if (!open) return;
      const i = Number(open.closest<HTMLElement>(".sg-card")?.dataset.index);
      const card = this.cards[i];
      if (!card) return;
      this.setActive(i);
      hooks.seek(card.t0);
    });
    const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (RO) (this.resizer = new RO(() => this.scale())).observe(list);
  }

  /** Shows the scenes of a built video. Cards whose scene is unchanged keep their thumbnail. */
  set(ir: VideoIR, tl: ResolvedTimeline): void {
    const next = sceneCards(ir, tl);
    this.canvasWidth = ir.canvas.width;
    // A card is kept when the scene in its place is the same one, at the same time (scenes only ever get appended).
    const same = (a: SceneCard, b: SceneCard | undefined) => b !== undefined && a.id === b.id && Math.abs(a.t0 - b.t0) < 1e-6 && Math.abs(a.t1 - b.t1) < 1e-6 && a.title === b.title;
    const old = [...this.list.querySelectorAll<HTMLElement>(".sg-card")];
    const fresh: SceneCard[] = [];
    const els = next.map((c, i) => {
      const el = same(c, this.cards[i]) ? old[i] : undefined;
      if (el) {
        // An earlier snapshot run may have been cut short by this update: draw what it missed.
        if (!el.querySelector(".sg-shot")) fresh.push(c);
        return el;
      }
      fresh.push(c);
      return this.card(c);
    });
    this.list.replaceChildren(...els);
    this.cards = next;
    if (this.count) this.count.textContent = next.length ? `${next.length} scene${next.length > 1 ? "s" : ""}` : "";
    this.mark();
    this.scale();
    this.pending = this.snapshot(ir, tl, fresh);
  }

  /** Resolves when every thumbnail of the last `set` is drawn (for tests and callers that wait). */
  ready(): Promise<void> {
    return this.pending;
  }

  /** Marks the scene being played, by its position in the video (0-based). */
  setActive(index: number | undefined): void {
    if (index === this.active) return;
    this.active = index;
    this.mark();
    const el = index === undefined ? undefined : this.cardAt(index);
    if (el) keepInView(this.list, el);
  }

  private cardAt(index: number): HTMLElement | undefined {
    return this.list.querySelectorAll<HTMLElement>(".sg-card")[index];
  }

  clear(): void {
    this.job++;
    this.cards = [];
    this.active = undefined;
    this.list.replaceChildren();
    if (this.count) this.count.textContent = "";
  }

  private card(c: SceneCard): HTMLElement {
    const el = this.list.ownerDocument.createElement("div");
    el.className = "sg-card";
    el.setAttribute("role", "listitem");
    el.dataset.scene = c.id;
    el.dataset.index = String(c.index - 1);
    el.innerHTML =
      `<button type="button" class="sg-open" data-scene="${escape(c.id)}" title="Jump to this scene" aria-label="Scene ${c.index}: ${escape(c.title)}, ${fmtDuration(c.t1 - c.t0)}">` +
      `<span class="sg-thumb"></span>` +
      `<span class="sg-meta"><span class="sg-n">${c.index}</span><span class="sg-title">${escape(c.title)}</span></span>` +
      `</button>` +
      `<span class="sg-sub"><span class="sg-time">${fmtDuration(c.t1 - c.t0)}</span>${c.template ? `<span class="sg-tpl">${escape(c.template)}</span>` : ""}` +
      (c.line > 0 ? `<button type="button" class="sg-src" data-line="${c.line}" title="Open this scene in the script">L${c.line}</button>` : "") +
      `</span>`;
    return el;
  }

  private mark(): void {
    this.list.querySelectorAll<HTMLElement>(".sg-card").forEach((el, i) => el.classList.toggle("on", i === this.active));
  }

  /** Snapshots are drawn at the canvas size; scale them to the card width. */
  private scale(): void {
    const thumb = this.list.querySelector<HTMLElement>(".sg-thumb");
    const w = thumb?.clientWidth;
    if (w) this.list.style.setProperty("--sg-k", String(w / this.canvasWidth));
  }

  private async snapshot(ir: VideoIR, tl: ResolvedTimeline, cards: SceneCard[]): Promise<void> {
    if (!cards.length) return;
    const job = ++this.job;
    const doc = this.list.ownerDocument;
    const box = doc.createElement("div");
    box.setAttribute("aria-hidden", "true");
    Object.assign(box.style, { position: "fixed", left: "-100000px", top: "0", width: `${ir.canvas.width}px`, height: `${ir.canvas.height}px`, overflow: "hidden", pointerEvents: "none" });
    doc.body.append(box);
    let stage: Stage | undefined;
    try {
      stage = new Stage(box, ir, tl, { autoFit: false });
      for (const c of cards) {
        await idle();
        if (job !== this.job) return;
        const thumb = this.cardAt(c.index - 1)?.querySelector<HTMLElement>(".sg-thumb");
        if (!thumb) continue;
        stage.render(c.thumbAt);
        const shot = stage.root.cloneNode(true) as HTMLElement;
        shot.classList.add("sg-shot");
        thumb.replaceChildren(shot);
        this.scale();
      }
    } finally {
      stage?.destroy();
      box.remove();
    }
  }
}

/** Waits for a quiet moment of the page (or the next turn, where there is no idle callback). */
function idle(): Promise<void> {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  return new Promise((done) => (ric ? ric(() => done(), { timeout: 200 }) : setTimeout(done, 0)));
}

/** Scrolls `list` (not the page) so `el` is visible. The list is positioned, so offsets are relative to it. */
function keepInView(list: HTMLElement, el: HTMLElement): void {
  if (list.scrollHeight <= list.clientHeight) return;
  const top = el.offsetTop;
  if (top < list.scrollTop) list.scrollTop = top - 8;
  else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + el.offsetHeight - list.clientHeight + 8;
}
