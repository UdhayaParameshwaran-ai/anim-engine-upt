import type { ResolvedTimeline, Tween } from "@anim/ir";
import { findVerb } from "@anim/registry";
import { escape } from "./util.js";

export interface TimelinePanelEvents {
  seek(t: number): void;
  /** A source line was picked (beat, cue or tween). */
  select(line: number): void;
}

const LABEL_W = 150;

/**
 * Everything the resolver decided, on one time axis: scenes, beats (with
 * inserted holds), spoken words, cues, sync-report flags and one track per
 * animated target with its tween bars. Click to seek; click a bar to jump to
 * its source line. Ctrl+wheel zooms.
 */
export class TimelinePanel {
  private tl: ResolvedTimeline | undefined;
  private pxPerSec = 0;
  private zoom = 1;
  private readonly labels: HTMLDivElement;
  private readonly scroll: HTMLDivElement;
  private tracks!: HTMLDivElement;
  private head!: HTMLDivElement;
  private following = true;

  constructor(
    private readonly root: HTMLElement,
    private readonly on: TimelinePanelEvents,
  ) {
    root.classList.add("tl");
    this.labels = document.createElement("div");
    this.labels.className = "tl-labels";
    this.scroll = document.createElement("div");
    this.scroll.className = "tl-scroll";
    root.append(this.labels, this.scroll);

    this.scroll.addEventListener("click", (e) => {
      const bar = (e.target as HTMLElement).closest<HTMLElement>("[data-t]");
      const t = bar ? Number(bar.dataset.t) : this.timeAt(e.clientX);
      if (bar?.dataset.line && Number(bar.dataset.line) > 0) this.on.select(Number(bar.dataset.line));
      this.on.seek(t);
    });
    this.scroll.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey || !this.tl) return;
        e.preventDefault();
        const t = this.timeAt(e.clientX);
        const x = e.clientX - this.scroll.getBoundingClientRect().left;
        this.zoom = Math.min(40, Math.max(1, this.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
        this.draw();
        this.scroll.scrollLeft = t * this.pxPerSec - x;
      },
      { passive: false },
    );
    // Stop auto-follow while the user scrolls by hand; resume on seek.
    this.scroll.addEventListener("pointerdown", () => (this.following = false));
    new ResizeObserver(() => this.tl && this.draw()).observe(root);
  }

  set(tl: ResolvedTimeline): void {
    const keepView = this.tl !== undefined && tl.duration >= this.tl.duration && tl.scenes[0]?.id === this.tl.scenes[0]?.id;
    this.tl = tl;
    if (!keepView) this.zoom = 1;
    this.draw();
  }

  clear(): void {
    this.tl = undefined;
    this.labels.innerHTML = "";
    this.scroll.innerHTML = "";
  }

  /** Moves the playhead; keeps it in view while following playback. */
  update(t: number, playing: boolean): void {
    if (!this.tl || !this.head) return;
    const x = t * this.pxPerSec;
    this.head.style.left = `${x}px`;
    if (!playing) this.following = true;
    if (this.following) {
      const { scrollLeft, clientWidth } = this.scroll;
      if (x < scrollLeft || x > scrollLeft + clientWidth - 40) this.scroll.scrollLeft = x - clientWidth * 0.2;
    }
  }

  private timeAt(clientX: number): number {
    const x = clientX - this.tracks.getBoundingClientRect().left;
    return Math.min(Math.max(x / this.pxPerSec, 0), this.tl?.duration ?? 0);
  }

  private draw(): void {
    const tl = this.tl!;
    const avail = Math.max(200, this.root.clientWidth - LABEL_W - 12);
    this.pxPerSec = (avail / Math.max(tl.duration, 1)) * this.zoom;
    const px = (t: number) => `${(t * this.pxPerSec).toFixed(1)}px`;
    const span = (t0: number, t1: number) => `left:${px(t0)};width:${px(Math.max(t1 - t0, 1 / tl.fps))}`;

    const rows: { label: string; cls?: string; html: string }[] = [];

    // Ruler: a tick every 1, 2, 5 or 10 seconds depending on zoom.
    const step = [1, 2, 5, 10, 30].find((s) => s * this.pxPerSec >= 48) ?? 60;
    let ruler = "";
    for (let s = 0; s <= tl.duration; s += step) ruler += `<span class="tick" style="left:${px(s)}">${s}s</span>`;
    rows.push({ label: "", cls: "ruler", html: ruler });

    rows.push({
      label: "scenes",
      html: tl.scenes.map((s) => `<i class="bar scene" data-t="${s.t0}" style="${span(s.t0, s.t1)}" title="${escape(s.id)} ${s.t0.toFixed(2)}–${s.t1.toFixed(2)}s">${escape(s.id)}</i>`).join(""),
    });
    rows.push({
      label: "beats",
      html: tl.scenes
        .flatMap((s) =>
          s.beats.map(
            (b) =>
              `<i class="bar beat" data-t="${b.t0}" data-line="${b.line}" style="${span(b.t0, b.t1)}" title="L${b.line} ${b.t0.toFixed(2)}–${b.t1.toFixed(2)}s${b.hold ? ` · hold ${b.hold.toFixed(2)}s` : ""}">` +
              (b.hold ? `<b class="hold" style="width:${px(b.hold)}"></b>` : "") +
              `L${b.line}</i>`,
          ),
        )
        .join(""),
    });
    rows.push({
      label: "words",
      html: tl.words.map((w) => `<i class="bar word" data-t="${w.t0}" style="${span(w.t0, w.t1)}" title="${escape(w.text)} ${w.t0.toFixed(2)}s">${escape(w.text)}</i>`).join(""),
    });
    rows.push({
      label: "cues",
      html: tl.cues
        .map((c) => {
          const title = `{${c.id}} ${c.scene} L${c.line} ${c.t.toFixed(2)}s${c.precision === "interpolated" ? " (interpolated)" : ""}`;
          const cls = c.precision === "interpolated" ? "cue approx" : "cue";
          return c.tEnd !== undefined
            ? `<i class="bar ${cls} spanned" data-t="${c.t}" data-line="${c.line}" style="${span(c.t, c.tEnd)}" title="${title}">${escape(c.id)}</i>`
            : `<i class="mark ${cls}" data-t="${c.t}" data-line="${c.line}" style="left:${px(c.t)}" title="${title}">${escape(c.id)}</i>`;
        })
        .join(""),
    });
    const flagged = tl.report.filter((r) => r.t !== undefined);
    if (flagged.length) {
      rows.push({
        label: "sync report",
        html: flagged.map((r) => `<i class="mark flag" data-t="${r.t}" data-line="${r.line ?? 0}" style="left:${px(r.t!)}" title="${escape(`${r.code} ${r.message}`)}">!</i>`).join(""),
      });
    }

    // One row per animated target, in order of first appearance.
    const byTarget = new Map<string, Tween[]>();
    for (const tw of tl.tracks) (byTarget.get(tw.target) ?? byTarget.set(tw.target, []).get(tw.target)!).push(tw);
    for (const [target, tweens] of byTarget) {
      const [scene, id] = target.split("/") as [string, string];
      rows.push({
        label: `<span class="muted">${escape(scene)}/</span>${escape(id)}`,
        cls: "target",
        html: tweens
          .map((tw) => {
            const cat = tw.prop === "camera" ? "camera" : (findVerb(tw.verb)?.category ?? "other");
            const title = `${tw.verb} · ${tw.prop} ${fmt(tw.from)} → ${fmt(tw.to)} · ${tw.t0.toFixed(2)}–${tw.t1.toFixed(2)}s${tw.line ? ` · L${tw.line}` : ""}`;
            return `<i class="bar tw ${cat}" data-t="${tw.t0}" data-line="${tw.line}" style="${span(tw.t0, tw.t1)}" title="${escape(title)}">${escape(tw.verb)}</i>`;
          })
          .join(""),
      });
    }

    this.labels.innerHTML = rows.map((r) => `<div class="row ${r.cls ?? ""}">${r.label}</div>`).join("");
    const width = tl.duration * this.pxPerSec;
    this.scroll.innerHTML = `<div class="tl-tracks" style="width:${width.toFixed(0)}px">${rows.map((r) => `<div class="row ${r.cls ?? ""}">${r.html}</div>`).join("")}<div class="tl-head"></div></div>`;
    this.tracks = this.scroll.firstElementChild as HTMLDivElement;
    this.head = this.tracks.querySelector(".tl-head") as HTMLDivElement;
  }
}

function fmt(v: Tween["from"]): string {
  return typeof v === "number" ? String(Math.round(v * 100) / 100) : `[${Math.round(v.x)},${Math.round(v.y)} ${Math.round(v.w)}×${Math.round(v.h)}]`;
}
