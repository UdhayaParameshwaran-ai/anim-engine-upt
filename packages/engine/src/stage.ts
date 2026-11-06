import type { Box, Prop, ResolvedScene, ResolvedTimeline, SceneIR, Tween, VideoIR } from "@anim/ir";
import { findMotion } from "@anim/registry";
import { createEvaluator, EASES, type FrameState, type Value } from "@anim/timeline";
import { build, paintFills, round, svg, SVG_NS, type Instance } from "./components.js";
import { fontFace, fontFaceCss } from "./fonts.js";
import { color, getTheme, type Theme } from "./theme.js";

export interface StageOptions {
  /** Override the video's theme. */
  theme?: string;
  /** Scale the stage to fill its container (and follow resizes). Default true. */
  autoFit?: boolean;
  /** URL prefix the bundled font files are served from (see fonts.ts). Default "/fonts/". */
  fontBase?: string;
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
/** Element kinds that are pictures (they float while idle, and glow when highlighted). */
const PICTURES = new Set(["icon", "asset"]);

let stageCount = 0;
const SVG_ROOT_BASE = "position: absolute; left: 0px; top: 0px;";

/** How a transition shows a scene at a moment. */
interface SceneLook {
  opacity: number;
  dx: number;
  dy: number;
  scale: number;
  blur: number;
  /** CSS clip-path on the scene's layers ("" = none). */
  clip: string;
}
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
  /** `send` tweens per connector: while one runs, its packet travels along the connector. */
  private readonly sends = new Map<string, Tween[]>();
  /** When each element has finished appearing (pictures start to float from then on). */
  private readonly shownAt = new Map<string, number>();
  /** How far pictures float while on screen (px), from the motion personality. */
  private readonly idle: number;
  /** Build-time inline styles that dynamic styles are appended to. */
  private readonly baseStyle = new WeakMap<Element, string>();
  private readonly htmlCameraBase: string;
  private readonly width: number;
  private readonly height: number;
  private time = 0;
  private resizer: ResizeObserver | undefined;
  /** Unique per stage, so two stages on one page don't share filter ids. */
  private readonly markId = `anim-mark-${++stageCount}`;

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
    this.idle = findMotion(ir.motion).idle * (this.width / 1920);
    for (const tw of timeline.tracks) {
      if (tw.prop === "opacity" && tw.to === 1 && !this.shownAt.has(tw.target)) this.shownAt.set(tw.target, tw.t1);
      if (tw.prop === "tint") (this.tints.get(tw.target) ?? this.tints.set(tw.target, []).get(tw.target)!).push(tw);
      if (tw.prop === "reveal" && tw.meta?.by && !this.revealBy.has(tw.target)) this.revealBy.set(tw.target, String(tw.meta.by));
      if (tw.prop === "reveal" && tw.meta?.send) (this.sends.get(tw.target) ?? this.sends.set(tw.target, []).get(tw.target)!).push(tw);
    }

    this.root = doc.createElement("div");
    this.root.className = "anim-stage";
    // Absolutely positioned so the fixed-size stage never affects its container's layout.
    Object.assign(this.root.style, { position: "absolute", left: "0px", top: "0px", width: `${this.width}px`, height: `${this.height}px`, overflow: "hidden", background: this.theme.bg, transformOrigin: "0 0" });

    const fonts = doc.createElement("style");
    fonts.textContent = fontFaceCss(this.theme.faces, opts.fontBase ?? "/fonts/");
    this.root.append(fonts);

    this.svgRoot = svg(doc, "svg", { viewBox: `0 0 ${this.width} ${this.height}`, width: this.width, height: this.height }) as SVGSVGElement;
    this.svgRoot.style.cssText = SVG_ROOT_BASE;
    if (this.theme.emphasis === "mark") this.svgRoot.append(this.markFilters(doc));
    this.svgCamera = svg(doc, "g", {
      "data-camera": "",
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
      // Panels and axes at the back, then connectors (behind what they connect), then elements, then badges.
      const depth = (e: (typeof sceneIr.elements)[number]) => (e.kind === "panel" || e.kind === "rule" || e.kind === "zone" || e.kind === "chevron" ? 0 : e.link ? 1 : e.kind === "badge" ? 3 : 2);
      const ordered = [...sceneIr.elements].sort((a, b) => depth(a) - depth(b));
      for (const el of ordered) {
        const inst = build(doc, el, this.theme, `${this.markId}-${res.id}-${el.id}`);
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
      if (RO) (this.resizer = new RO(() => this.fit())).observe(container);
    }
    this.render(0);
  }

  /** Resolves once the look's fonts have loaded; capture frames only after this. */
  async fontsReady(): Promise<void> {
    const fonts = (this.root.ownerDocument as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts?.load) return;
    const faces = this.theme.faces.map(fontFace).filter((f) => f !== undefined);
    await Promise.all(faces.map((f) => fonts.load(`${f.weight} 32px "${f.family}"`).catch(() => [])));
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
    // Clip transitions (wipe, iris) act on the active scene's layers, never the stage color behind them.
    let clip = "";
    const last = this.scenes[this.scenes.length - 1];
    for (const view of this.scenes) {
      const { t0, t1 } = view.res;
      const active = (this.time >= t0 && this.time < t1) || (view === last && this.time >= t1);
      // Inactive scenes are rendered too, so no node ever keeps state from an earlier frame.
      const c = this.renderScene(view, state, active);
      if (active) clip = c;
    }
    css(this.svgRoot, SVG_ROOT_BASE, [["clip-path", clip]]);
  }

  /** Renders one scene's layers; returns the clip-path its transition puts on the stage. */
  private renderScene(view: SceneView, state: FrameState, active: boolean): string {
    const { res } = view;
    const s = this.transition(res);
    const moved = s.dx || s.dy || s.scale !== 1;
    const transform = moved ? `translate(${round(s.dx)}px, ${round(s.dy)}px) scale(${round(s.scale, 4)})` : "";
    const sceneCss: Css = [
      ["display", active ? "" : "none"],
      ["opacity", String(round(s.opacity, 4))],
      ["transform-origin", moved ? `${this.width / 2}px ${this.height / 2}px` : ""],
      ["transform", transform],
      ["filter", s.blur > 0.05 ? `blur(${round(s.blur, 2)}px)` : ""],
    ];
    css(view.svg, "", sceneCss);
    css(view.html, SCENE_HTML_BASE, [...sceneCss, ["clip-path", s.clip]]);

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
    return s.clip;
  }

  /** Scene-level opacity, offset, scale, blur and clip from its in/out transitions. */
  private transition(res: ResolvedScene): SceneLook {
    const t = this.time;
    const look: SceneLook = { opacity: 1, dx: 0, dy: 0, scale: 1, blur: 0, clip: "" };
    const out = EASES.out!;
    // k: how far the scene still is from fully shown (1 → 0 entering, 0 → 1 leaving).
    const apply = (type: string, k: number, leaving: boolean) => {
      if (k <= 0) return;
      const dir = leaving ? -1 : 1;
      switch (type) {
        case "fade":
          look.opacity *= 1 - k;
          break;
        case "slide":
          look.opacity *= 1 - k;
          look.dx += dir * k * this.width * 0.25;
          break;
        case "rise":
          look.opacity *= 1 - k;
          look.dy += dir * k * this.height * 0.12;
          break;
        case "zoom":
          look.opacity *= 1 - k;
          look.scale *= leaving ? 1 - k * 0.06 : 1 + k * 0.12;
          break;
        case "blur":
          look.opacity *= 1 - k;
          look.blur += k * 18;
          break;
        case "wipe":
          // Enters left to right; leaves left to right too.
          look.clip = leaving ? `inset(0 0 0 ${round(k * 100, 3)}%)` : `inset(0 ${round(k * 100, 3)}% 0 0)`;
          break;
        case "iris":
          look.clip = `circle(${round((1 - k) * 75, 3)}% at 50% 50%)`;
          break;
      }
    };
    if (res.transitionIn.duration > 0) apply(res.transitionIn.type, 1 - out(clamp01((t - res.t0) / res.transitionIn.duration)), false);
    if (res.transitionOut.duration > 0) apply(res.transitionOut.type, 1 - out(clamp01((res.t1 - t) / res.transitionOut.duration)), true);
    return look;
  }

  private applyElement(inst: Instance, target: string, p: Props): void {
    const opacity = num(p.opacity, 0);
    const root = inst.root as SVGGElement & HTMLElement;
    const style: Css = [
      ["opacity", String(round(opacity, 4))],
      ["visibility", opacity <= 0.001 ? "hidden" : ""],
    ];

    const x = num(p.x, 0);
    const y = num(p.y, 0) + this.float(inst, target, opacity);
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
    for (const f of inst.fills) f.setAttribute("fill-opacity", String(round(fillK * (f.getAttribute("data-fill") === "surface" || f.hasAttribute("data-solid") ? 1 : 0.85), 3)));
    const innerK = clamp01((draw - 0.6) / 0.4);
    for (const t of inst.innerText) (t as SVGElement).style.opacity = String(round(innerK, 3));

    // reveal (write) — and `draw` on plain text behaves like a wipe-in.
    const textual = ["title", "text", "label", "list"].includes(inst.el.kind);
    const reveal = Math.min(num(p.reveal, 1), textual ? draw : 1);
    // Grid elements play their own motion; `write` drives it like `draw`.
    inst.motion?.(clamp01(Math.min(draw, num(p.reveal, 1))));
    if (inst.layer === "html") style.push(["clip-path", reveal < 1 ? `inset(0 ${round((1 - reveal) * 100)}% 0 0)` : ""]);
    else this.reveal(inst, target, reveal);

    // tint (highlight)
    const tint = num(p.tint, 0);
    const c = color(this.theme, this.tintMeta(target).color);
    const blur = num(p.blur, 0);
    // A marker block suits text; behind a picture it is a crude rectangle, so pictures glow instead.
    const filters = [root.getAttribute("data-shadow") ?? "", blur > 0.05 ? `blur(${round(blur, 2)}px)` : "", this.emphasis(tint, c, 4, 14, PICTURES.has(inst.el.kind))];
    style.push(["filter", filters.filter(Boolean).join(" ")]);
    if (textual) {
      for (const t of root.querySelectorAll("text")) t.setAttribute("fill", tint > 0.01 ? `color-mix(in srgb, ${c} ${Math.round(tint * 100)}%, ${this.theme.fg})` : this.theme.fg);
    }
    css(root, this.baseStyle.get(root) ?? "", style);
  }

  /**
   * Idle float of a picture: a slow, small rise and fall once it has
   * appeared, each picture on its own phase. A pure function of time, so
   * seeking and frame export agree.
   */
  private float(inst: Instance, target: string, opacity: number): number {
    if (!this.idle || !PICTURES.has(inst.el.kind) || opacity < 0.5) return 0;
    const since = this.time - (this.shownAt.get(target) ?? 0);
    if (since <= 0) return 0;
    let h = 0;
    for (const ch of inst.el.id) h = (h * 31 + ch.charCodeAt(0)) % 628;
    // Eases in over the first second so the entrance settles before the float starts.
    return Math.sin(this.time * 1.3 + h / 100) * this.idle * Math.min(1, since);
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
      const bar = n.querySelector?.("[data-bar]");
      if (bar) {
        // A line of code: a bar behind it marks the highlight; `write` types its characters.
        bar.setAttribute("opacity", String(round(tint * 0.32, 3)));
        bar.setAttribute("fill", c);
        const chars = [...n.querySelectorAll("tspan")].filter((t) => t.textContent !== " ");
        const shown = Math.floor(chars.length * num(p.reveal, 1) + 1e-9);
        chars.forEach((t, i) => ((t as SVGElement).style.opacity = i < shown ? "1" : "0"));
        css(n as SVGElement, this.baseStyle.get(n) ?? "", [["opacity", String(round(num(p.opacity, 1), 4))]]);
        continue;
      }
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
        ["filter", this.emphasis(tint, c, 5, 12)],
      ]);
    }
  }

  /** Straight connector between the current boxes of its endpoints, clipped at their borders. */
  private route(inst: Instance, view: SceneView, state: FrameState): void {
    const c = inst.connector!;
    const a = this.currentBox(view, c.from, state);
    const b = this.currentBox(view, c.to, state);
    if (!a || !b) return;
    const row = inst.el.params.route === "row";
    const [ax, ay] = [a.x + a.w / 2, a.y + a.h / 2];
    const [bx, by] = [b.x + b.w / 2, b.y + b.h / 2];
    // A sequence message runs level between two lifelines, at its own row.
    const rowY = inst.el.box.y + inst.el.box.h / 2;
    const dir = Number(inst.el.params.dir ?? 1);
    // Leader lines (quiet, no head) reach right up to what they join.
    const lead = !c.head && inst.el.params.tone === 'muted' ? 2 : 12;
    const start: [number, number] = row ? [inst.el.box.x + (dir > 0 ? 8 : inst.el.box.w - 8), rowY] : clipToBox(ax, ay, bx, by, a, lead);
    const end: [number, number] = row ? [inst.el.box.x + (dir > 0 ? inst.el.box.w - 10 : 10), rowY] : clipToBox(bx, by, ax, ay, b, inst.connector!.head ? 16 : lead);
    const arc = inst.el.params.curve === "arc";
    const mx = (start[0] + end[0]) / 2;
    const my = (start[1] + end[1]) / 2;
    const len = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1;
    const [nx, ny] = [-(end[1] - start[1]) / len, (end[0] - start[0]) / len];
    // bend: how far the arc bows, as a share of its length; negative bows the other way.
    const bend = Number(inst.el.params.bend ?? 0.2);
    const ctrl: [number, number] = arc ? [mx + nx * len * bend, my + ny * len * bend] : [mx, my];
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
      // Clear the line by half the label's extent along the line's normal (estimated glyph width); a message's label sits above it.
      const halfW = ((c.label.textContent ?? "").length * 0.55 * 26) / 2;
      const off = 10 + Math.abs(nx) * halfW + Math.abs(ny) * 13;
      // On an arc the label sits just outside the curve's apex (halfway between the chord and the control point).
      const apex: [number, number] = arc ? [(mx + ctrl[0]) / 2, (my + ctrl[1]) / 2] : ctrl;
      const side = arc ? Math.sign(bend) || 1 : 1;
      c.label.setAttribute("x", String(round(row ? (start[0] + end[0]) / 2 : apex[0] + nx * off * side)));
      c.label.setAttribute("y", String(round(row ? rowY - 16 : apex[1] + ny * off * side + 8)));
      if (row) c.label.setAttribute("fill", this.theme.fg);
    }
    if (c.token) {
      // The packet of a running `send`: at the tween's progress along the line (or the arc).
      const sending = (this.sends.get(`${view.res.id}/${inst.el.id}`) ?? []).find((tw) => tw.t0 <= this.time && this.time < tw.t1);
      if (sending) {
        const p = num(props.reveal, 0);
        const k = sending.meta?.back ? 1 - p : p;
        const at = (t: number): [number, number] =>
          arc
            ? [(1 - t) ** 2 * start[0] + 2 * (1 - t) * t * ctrl[0] + t * t * end[0], (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * ctrl[1] + t * t * end[1]]
            : [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
        const [tx, ty] = at(k);
        c.token.setAttribute("cx", String(round(tx)));
        c.token.setAttribute("cy", String(round(ty)));
        c.token.setAttribute("fill", color(this.theme, "accent"));
        c.token.setAttribute("opacity", "1");
      } else c.token.setAttribute("opacity", "0");
    }
  }

  private currentBox(view: SceneView, id: string, state: FrameState): Box | undefined {
    const inst = view.instances.get(id);
    if (!inst) return undefined;
    const p = state.get(`${view.res.id}/${id}`) ?? {};
    const s = num(p.scale, 1);
    const w = inst.el.box.w * s;
    const h = inst.el.box.h * s;
    const cx = num(p.x, inst.el.box.x + inst.el.box.w / 2);
    const cy = num(p.y, inst.el.box.y + inst.el.box.h / 2);
    if (inst.el.params.dot) {
      const r = Math.min(26, inst.el.box.w * 0.18) * s;
      return { x: cx - r, y: cy - h * 0.12 - r, w: 2 * r, h: 2 * r };
    }
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  private tintMeta(target: string): { color: string; style: string } {
    const list = this.tints.get(target);
    let governing: Tween | undefined;
    if (list) for (const tw of list) if (tw.t0 <= this.time) governing = tw;
    return { color: String(governing?.meta?.color ?? "accent"), style: String(governing?.meta?.style ?? "glow") };
  }

  /** CSS filter for a highlight of strength `tint`: glow, or one of four marker blocks. */
  private emphasis(tint: number, c: string, inner: number, outer: number, glow = false): string {
    if (tint <= 0.01) return "";
    if (this.theme.emphasis === "mark" && !glow) return `url(#${this.markId}-${Math.min(4, Math.ceil(tint * 4))})`;
    return `drop-shadow(0 0 ${round(inner * tint)}px ${c}) drop-shadow(0 0 ${round(outer * tint)}px ${c})`;
  }

  /** Marker filters: a flat block filling the target's padded bounding box, under the target. */
  private markFilters(doc: Document): SVGDefsElement {
    const defs = svg(doc, "defs", {}) as SVGDefsElement;
    for (let level = 1; level <= 4; level++) {
      const f = svg(doc, "filter", { id: `${this.markId}-${level}`, x: -0.04, y: -0.12, width: 1.08, height: 1.24 });
      f.append(svg(doc, "feFlood", { "flood-color": this.theme.markColor, "flood-opacity": round((this.theme.markOpacity * level) / 4, 3), result: "mark" }));
      const merge = svg(doc, "feMerge", {});
      merge.append(svg(doc, "feMergeNode", { in: "mark" }), svg(doc, "feMergeNode", { in: "SourceGraphic" }));
      f.append(merge);
      defs.append(f);
    }
    return defs;
  }

  /** Detaches the stage from its container. */
  destroy(): void {
    this.resizer?.disconnect();
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
