import type { Box, Prop, ResolvedScene, ResolvedTimeline, SceneIR, Tween, VideoIR } from "@anim/ir";
import { createEvaluator, EASES, type FrameState, type Value } from "@anim/timeline";
import { build, paintFills, round, svg, SVG_NS, type Instance } from "./components.js";
import { color, getTheme, type Theme } from "./theme.js";

export interface StageOptions {
  /** Override the video's theme. */
  theme?: string;
  /** Scale the stage to fill its container (and follow resizes). Default true. */
  autoFit?: boolean;
}

interface SceneView {
  res: ResolvedScene;
  ir: SceneIR;
  svg: SVGGElement;
  html: HTMLDivElement;
  instances: Map<string, Instance>;
}

type Props = Partial<Record<Prop, Value>>;
type Css = [property: string, value: string][];

const SCENE_HTML_BASE = "position: absolute; inset: 0px;";

/**
 * Writes a node's whole inline style in a fixed property order. Setting
 * properties one by one would reorder them as they are removed and re-added,
 * making the DOM depend on render history.
 */
function css(node: HTMLElement | SVGElement, base: string, entries: Css): void {
  const dynamic = entries.filter(([, v]) => v !== "").map(([k, v]) => `${k}: ${v};`).join(" ");
  node.style.cssText = base && dynamic ? `${base} ${dynamic}` : base || dynamic;
}

/**
 * The renderer: a pure function of time. `render(t)` sets every node from
 * the timeline's state at t, with no dependence on previous frames, so live
 * playback, seeking, stepping and frame-by-frame export all agree.
 */
export class Stage {
  readonly root: HTMLDivElement;
  readonly theme: Theme;
  private readonly svgRoot: SVGSVGElement;
  private readonly svgCamera: SVGGElement;
  private readonly htmlCamera: HTMLDivElement;
  private readonly scenes: SceneView[] = [];
  private readonly evaluator: ReturnType<typeof createEvaluator>;
  private readonly tints = new Map<string, Tween[]>();
  private readonly revealBy = new Map<string, string>();
  /** Build-time inline styles that dynamic styles are appended to. */
  private readonly baseStyle = new WeakMap<Element, string>();
  private readonly htmlCameraBase: string;
  private readonly width: number;
  private readonly height: number;
  private time = 0;

  constructor(
    private readonly container: HTMLElement,
    readonly ir: VideoIR,
    readonly timeline: ResolvedTimeline,
    opts: StageOptions = {},
  ) {
    const doc = container.ownerDocument;
    this.theme = getTheme(opts.theme ?? ir.theme);
    this.width = ir.canvas.width;
    this.height = ir.canvas.height;
    this.evaluator = createEvaluator(timeline);
    for (const tw of timeline.tracks) {
      if (tw.prop === "tint") (this.tints.get(tw.target) ?? this.tints.set(tw.target, []).get(tw.target)!).push(tw);
      if (tw.prop === "reveal" && tw.meta?.by && !this.revealBy.has(tw.target)) this.revealBy.set(tw.target, String(tw.meta.by));
    }

    this.root = doc.createElement("div");
    this.root.className = "anim-stage";
    // Absolutely positioned so the fixed-size stage never affects its container's layout.
    Object.assign(this.root.style, { position: "absolute", left: "0px", top: "0px", width: `${this.width}px`, height: `${this.height}px`, overflow: "hidden", background: this.theme.bg, transformOrigin: "0 0" });

    this.svgRoot = svg(doc, "svg", { viewBox: `0 0 ${this.width} ${this.height}`, width: this.width, height: this.height }) as SVGSVGElement;
    Object.assign(this.svgRoot.style, { position: "absolute", left: "0", top: "0" });
    this.svgCamera = svg(doc, "g", {
      stroke: this.theme.fg,
      "stroke-width": this.theme.stroke,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      fill: "none",
    }) as SVGGElement;
    this.svgRoot.append(this.svgCamera);

    this.htmlCamera = doc.createElement("div");
    Object.assign(this.htmlCamera.style, { position: "absolute", left: "0", top: "0", width: `${this.width}px`, height: `${this.height}px`, transformOrigin: "0 0" });
    this.htmlCameraBase = this.htmlCamera.style.cssText;
    this.root.append(this.svgRoot, this.htmlCamera);

    for (const res of timeline.scenes) {
      const sceneIr = ir.scenes.find((s) => s.id === res.id)!;
      const g = svg(doc, "g", { "data-scene": res.id }) as SVGGElement;
      const html = doc.createElement("div");
      html.dataset.scene = res.id;
      html.style.cssText = SCENE_HTML_BASE;
      const instances = new Map<string, Instance>();
      // Connectors first so they sit behind what they connect.
      const ordered = [...sceneIr.elements].sort((a, b) => Number(!a.link) - Number(!b.link));
      for (const el of ordered) {
        const inst = build(doc, el, this.theme);
        paintFills(inst, this.theme);
        this.baseStyle.set(inst.root, inst.root.style.cssText);
        for (const nodes of inst.parts.values()) for (const n of nodes) this.baseStyle.set(n, (n as SVGElement).style.cssText);
        instances.set(el.id, inst);
        (inst.layer === "html" ? html : g).append(inst.root);
      }
      this.svgCamera.append(g);
      this.htmlCamera.append(html);
      this.scenes.push({ res, ir: sceneIr, svg: g, html, instances });
    }

    container.append(this.root);
    if (opts.autoFit ?? true) {
      this.fit();
      const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
      if (RO) new RO(() => this.fit()).observe(container);
    }
    this.render(0);
  }

  get duration(): number {
    return this.timeline.duration;
  }

  get currentTime(): number {
    return this.time;
  }

  /** Scales the fixed-size stage to fit its container, letterboxed and centered. */
  fit(): void {
    if (getComputedStyle(this.container).position === "static") this.container.style.position = "relative";
    const w = this.container.clientWidth || this.width;
    const h = this.container.clientHeight || this.height;
    const k = Math.min(w / this.width, h / this.height);
    this.root.style.left = `${Math.round((w - this.width * k) / 2)}px`;
    this.root.style.top = `${Math.round((h - this.height * k) / 2)}px`;
    this.root.style.transform = `scale(${k})`;
  }

  /** Renders the frame at time t (seconds). */
  render(t: number): void {
    this.time = Math.min(Math.max(t, 0), this.duration);
    const state = this.evaluator.at(this.time);
    const last = this.scenes[this.scenes.length - 1];
    for (const view of this.scenes) {
      const { t0, t1 } = view.res;
      const active = (this.time >= t0 && this.time < t1) || (view === last && this.time >= t1);
      // Inactive scenes are rendered too, so no node ever keeps state from an earlier frame.
      this.renderScene(view, state, active);
    }
  }

  private renderScene(view: SceneView, state: FrameState, active: boolean): void {
    const { res } = view;
    const sceneState = this.transition(res);
    const sceneCss: Css = [
      ["display", active ? "" : "none"],
      ["opacity", String(round(sceneState.opacity, 4))],
      ["transform", sceneState.dx ? `translateX(${round(sceneState.dx)}px)` : ""],
    ];
    css(view.svg, "", sceneCss);
    css(view.html, SCENE_HTML_BASE, sceneCss);

    if (active) {
      const cam = (state.get(`${res.id}/camera`)?.camera as Box | undefined) ?? { x: 0, y: 0, w: this.width, h: this.height };
      const camTransform = `scale(${round(this.width / cam.w, 5)}) translate(${round(-cam.x)}px, ${round(-cam.y)}px)`;
      css(this.svgCamera, "", [["transform-origin", "0 0"], ["transform", camTransform]]);
      css(this.htmlCamera, this.htmlCameraBase, [["transform", camTransform]]);
    }

    for (const inst of view.instances.values()) {
      const target = `${res.id}/${inst.el.id}`;
      const props = state.get(target) ?? {};
      this.applyElement(inst, target, props);
      for (const [part, nodes] of inst.parts) {
        const pp = state.get(`${target}.${part}`);
        if (pp) this.applyPart(nodes, `${target}.${part}`, pp);
      }
    }
    for (const inst of view.instances.values()) if (inst.connector) this.route(inst, view, state);
  }

  /** Scene-level opacity and slide offset from its transitions. */
  private transition(res: ResolvedScene): { opacity: number; dx: number } {
    const t = this.time;
    const inP = res.transitionIn.duration > 0 ? clamp01((t - res.t0) / res.transitionIn.duration) : 1;
    const outP = res.transitionOut.duration > 0 ? clamp01((res.t1 - t) / res.transitionOut.duration) : 1;
    const out = EASES.out!;
    let opacity = 1;
    let dx = 0;
    if (res.transitionIn.type === "fade" || res.transitionIn.type === "slide") opacity = Math.min(opacity, out(inP));
    if (res.transitionIn.type === "slide") dx += (1 - out(inP)) * this.width * 0.25;
    if (res.transitionOut.type === "fade" || res.transitionOut.type === "slide") opacity = Math.min(opacity, out(outP));
    if (res.transitionOut.type === "slide") dx -= (1 - out(outP)) * this.width * 0.25;
    return { opacity, dx };
  }

  private applyElement(inst: Instance, target: string, p: Props): void {
    const opacity = num(p.opacity, 0);
    const root = inst.root as SVGGElement & HTMLElement;
    const style: Css = [
      ["opacity", String(round(opacity, 4))],
      ["visibility", opacity <= 0.001 ? "hidden" : ""],
    ];

    const x = num(p.x, 0);
    const y = num(p.y, 0);
    const s = num(p.scale, 1);
    const r = num(p.rotate, 0);
    if (inst.layer === "html") {
      style.push(["transform", `translate(${round(x - inst.el.box.w / 2)}px, ${round(y - inst.el.box.h / 2)}px) scale(${round(s, 4)}) rotate(${round(r)}deg)`]);
    } else if (!inst.connector) {
      root.setAttribute("transform", `translate(${round(x)} ${round(y)}) scale(${round(s, 4)})${r ? ` rotate(${round(r)})` : ""}`);
    }

    // draw: stroke dashes, then fills, then inner labels.
    const draw = num(p.draw, 1);
    for (const sh of inst.strokes) {
      if (draw >= 1) {
        sh.removeAttribute("stroke-dashoffset");
        if (sh.dataset.dash !== undefined) sh.setAttribute("stroke-dasharray", sh.dataset.dash);
        else sh.removeAttribute("stroke-dasharray");
      } else {
        sh.setAttribute("stroke-dasharray", "1 1");
        sh.setAttribute("stroke-dashoffset", String(round(1 - draw, 4)));
      }
    }
    const fillK = clamp01((draw - 0.5) / 0.5);
    for (const f of inst.fills) f.setAttribute("fill-opacity", String(round(fillK * (f.getAttribute("data-fill") === "surface" ? 1 : 0.85), 3)));
    const innerK = clamp01((draw - 0.6) / 0.4);
    for (const t of inst.innerText) (t as SVGElement).style.opacity = String(round(innerK, 3));

    // reveal (write) — and `draw` on plain text behaves like a wipe-in.
    const textual = ["title", "text", "label", "list"].includes(inst.el.kind);
    const reveal = Math.min(num(p.reveal, 1), textual ? draw : 1);
    if (inst.layer === "html") style.push(["clip-path", reveal < 1 ? `inset(0 ${round((1 - reveal) * 100)}% 0 0)` : ""]);
    else this.reveal(inst, target, reveal);

    // tint (highlight)
    const tint = num(p.tint, 0);
    const c = color(this.theme, this.tintMeta(target).color);
    style.push(["filter", tint > 0.01 ? `drop-shadow(0 0 ${round(4 * tint)}px ${c}) drop-shadow(0 0 ${round(14 * tint)}px ${c})` : ""]);
    if (textual) {
      for (const t of root.querySelectorAll("text")) t.setAttribute("fill", tint > 0.01 ? `color-mix(in srgb, ${c} ${Math.round(tint * 100)}%, ${this.theme.fg})` : this.theme.fg);
    }
    css(root, this.baseStyle.get(root) ?? "", style);
  }

  private reveal(inst: Instance, target: string, reveal: number): void {
    if (this.revealBy.get(target) === "line" || (inst.el.kind === "list" && !this.revealBy.has(target))) {
      const shown = Math.floor(inst.lines.length * reveal + 1e-9);
      inst.lines.forEach((line, i) => line.forEach((n) => ((n as SVGElement).style.opacity = i < shown ? "1" : "0")));
      return;
    }
    const shown = Math.floor(inst.chars.length * reveal + 1e-9);
    inst.chars.forEach((n, i) => ((n as SVGElement).style.opacity = i < shown ? "1" : "0"));
  }

  private applyPart(nodes: Element[], target: string, p: Props): void {
    const tint = num(p.tint, 0);
    const c = color(this.theme, this.tintMeta(target).color);
    for (const n of nodes) {
      if (n.tagName.toLowerCase() === "tspan") {
        // Characters: only recolor, so the write-reveal keeps control of their opacity.
        n.setAttribute("fill", tint > 0.01 ? `color-mix(in srgb, ${c} ${Math.round(tint * 100)}%, ${this.theme.fg})` : this.theme.fg);
        continue;
      }
      const s = num(p.scale, 1);
      css(n as SVGElement, this.baseStyle.get(n) ?? "", [
        ["opacity", String(round(num(p.opacity, 1), 4))],
        ["transform-box", "fill-box"],
        ["transform-origin", "center"],
        ["transform", s !== 1 ? `scale(${round(s, 4)})` : ""],
        ["filter", tint > 0.01 ? `drop-shadow(0 0 ${round(5 * tint)}px ${c}) drop-shadow(0 0 ${round(12 * tint)}px ${c})` : ""],
      ]);
    }
  }

  /** Straight connector between the current boxes of its endpoints, clipped at their borders. */
  private route(inst: Instance, view: SceneView, state: FrameState): void {
    const c = inst.connector!;
    const a = this.currentBox(view, c.from, state);
    const b = this.currentBox(view, c.to, state);
    if (!a || !b) return;
    const [ax, ay] = [a.x + a.w / 2, a.y + a.h / 2];
    const [bx, by] = [b.x + b.w / 2, b.y + b.h / 2];
    const start = clipToBox(ax, ay, bx, by, a, 12);
    const end = clipToBox(bx, by, ax, ay, b, inst.connector!.head ? 16 : 12);
    const arc = inst.el.params.curve === "arc";
    const mx = (start[0] + end[0]) / 2;
    const my = (start[1] + end[1]) / 2;
    const len = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1;
    const [nx, ny] = [-(end[1] - start[1]) / len, (end[0] - start[0]) / len];
    const ctrl: [number, number] = arc ? [mx + nx * len * 0.2, my + ny * len * 0.2] : [mx, my];
    c.path.setAttribute("d", arc ? `M${round(start[0])} ${round(start[1])}Q${round(ctrl[0])} ${round(ctrl[1])} ${round(end[0])} ${round(end[1])}` : `M${round(start[0])} ${round(start[1])}L${round(end[0])} ${round(end[1])}`);
    const props = state.get(`${view.res.id}/${inst.el.id}`) ?? {};
    const draw = num(props.draw, 1);
    if (c.head) {
      const [dx, dy] = arc ? [end[0] - ctrl[0], end[1] - ctrl[1]] : [end[0] - start[0], end[1] - start[1]];
      const dl = Math.hypot(dx, dy) || 1;
      const [ux, uy] = [dx / dl, dy / dl];
      const size = 18;
      const tip = [end[0] + ux * 4, end[1] + uy * 4];
      const p1 = [tip[0]! - ux * size - uy * size * 0.55, tip[1]! - uy * size + ux * size * 0.55];
      const p2 = [tip[0]! - ux * size + uy * size * 0.55, tip[1]! - uy * size - ux * size * 0.55];
      c.head.setAttribute("d", `M${round(tip[0]!)} ${round(tip[1]!)}L${round(p1[0]!)} ${round(p1[1]!)}L${round(p2[0]!)} ${round(p2[1]!)}Z`);
      c.head.style.opacity = String(round(clamp01((draw - 0.85) / 0.15), 3));
    }
    if (c.label) {
      const off = 22;
      c.label.setAttribute("x", String(round(ctrl[0] + nx * off)));
      c.label.setAttribute("y", String(round(ctrl[1] + ny * off + 8)));
    }
  }

  private currentBox(view: SceneView, id: string, state: FrameState): Box | undefined {
    const inst = view.instances.get(id);
    if (!inst) return undefined;
    const p = state.get(`${view.res.id}/${id}`) ?? {};
    const s = num(p.scale, 1);
    const w = inst.el.box.w * s;
    const h = inst.el.box.h * s;
    return { x: num(p.x, inst.el.box.x + inst.el.box.w / 2) - w / 2, y: num(p.y, inst.el.box.y + inst.el.box.h / 2) - h / 2, w, h };
  }

  private tintMeta(target: string): { color: string; style: string } {
    const list = this.tints.get(target);
    let governing: Tween | undefined;
    if (list) for (const tw of list) if (tw.t0 <= this.time) governing = tw;
    return { color: String(governing?.meta?.color ?? "accent"), style: String(governing?.meta?.style ?? "glow") };
  }

  /** Detaches the stage from its container. */
  destroy(): void {
    this.root.remove();
  }
}

/** Point where the segment from (x0,y0) toward (x1,y1) leaves `box`, pushed out by `gap`. */
function clipToBox(x0: number, y0: number, x1: number, y1: number, box: Box, gap: number): [number, number] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const tx = dx !== 0 ? box.w / 2 / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? box.h / 2 / Math.abs(dy) : Infinity;
  const k = Math.min(tx, ty);
  return [x0 + dx * k + (dx / len) * gap, y0 + dy * k + (dy / len) * gap];
}

function num(v: Value | undefined, d: number): number {
  return typeof v === "number" ? v : d;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export { SVG_NS };
