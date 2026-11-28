import type { Box, Prop, ResolvedScene, ResolvedTimeline, SceneIR, Tween, VideoIR } from "@anim/ir";
import { findMotion } from "@anim/registry";
import { createEvaluator, EASES, type FrameState, type Value } from "@anim/timeline";
import { build, paintFills, round, svg, SVG_NS, type Instance } from "./components.js";
import { fontFace, fontFaceCss } from "./fonts.js";
import { color, getTheme, type Theme } from "./theme.js";
import { crossLook, noOverlays, still, type Css, type Overlays, type SceneLook } from "./transitions.js";

export interface StageOptions {
  /** Override the video's theme. */
  theme?: string;
  /** Scale the stage to fill its container (and follow resizes). Default true. */
  autoFit?: boolean;
  /** URL prefix the bundled font files are served from (see fonts.ts). Default "/fonts/". */
  fontBase?: string;
  /** URL prefix the designer's HTML pages are served from (scenes drawn by a hosted page). Default https://tpl.anim.local. */
  templateBase?: string;
}

/**
 * One scene on the stage: a frame (the scene's background and everything in it, what a transition moves, clips or turns) holding
 * its content (what a transition shifts a little inside the frame), which holds the scene's SVG layer and its HTML layer, each
 * under the scene's own camera. Two scenes are on screen together while a transition runs between them.
 */
interface SceneView {
  res: ResolvedScene;
  ir: SceneIR;
  frame: HTMLDivElement;
  content: HTMLDivElement;
  svgCamera: SVGGElement;
  htmlCamera: HTMLDivElement;
  svg: SVGGElement;
  html: HTMLDivElement;
  instances: Map<string, Instance>;
  /** The scene shows a designer's page. Such a page measures its own layout while it loads, so it must keep one while it waits. */
  hosted: boolean;
}

type Props = Partial<Record<Prop, Value>>;
/** Element kinds that are pictures (they float while idle, and glow when highlighted). */
const PICTURES = new Set(["icon", "asset"]);

let stageCount = 0;
const SVG_ROOT_BASE = "position: absolute; left: 0px; top: 0px;";
const SCENE_HTML_BASE = "position: absolute; inset: 0px;";
const CONTENT_BASE = "position: absolute; inset: 0px;";
const OVERLAY_BASE = "position: absolute; inset: 0px; z-index: 5; pointer-events: none; overflow: hidden;";

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
  /** Filters the scenes share (highlight marks, the ripple transition's distortion). */
  private readonly defs: SVGSVGElement;
  /** The transitions' own pieces, over every scene. */
  private readonly overlay: { layer: HTMLDivElement; edge: HTMLElement; ring: HTMLElement; seam: HTMLElement; panel: HTMLElement; sheen: HTMLElement };
  private readonly ripple: { turbulence: SVGElement; displace: SVGElement };
  private readonly frameBase: string;
  private readonly scenes: SceneView[] = [];
  /** Instances that host a designer page; they are told the time every frame and the frame waits for them. */
  private readonly pages: Instance[] = [];
  private evaluator: ReturnType<typeof createEvaluator>;
  private readonly templateBase: string | undefined;
  private readonly tints = new Map<string, Tween[]>();
  private readonly revealBy = new Map<string, string>();
  /** `send` tweens per connector: while one runs, its packet travels along the connector. */
  private readonly sends = new Map<string, Tween[]>();
  /** `set` tweens per element (meta.set is the new text, shown from the end of the tween), in time order. */
  private readonly sets = new Map<string, Tween[]>();
  /** `count` tweens per element (meta: from, to, prefix, suffix, decimals; the tween's value is the progress). */
  private readonly counts = new Map<string, Tween[]>();
  /** When each element has finished appearing (pictures start to float from then on). */
  private readonly shownAt = new Map<string, number>();
  /** How far pictures float while on screen (px), from the motion personality. */
  private readonly idle: number;
  /** Build-time inline styles that dynamic styles are appended to. */
  private readonly baseStyle = new WeakMap<Element, string>();
  private readonly width: number;
  private readonly height: number;
  private time = 0;
  private resizer: ResizeObserver | undefined;
  /** Unique per stage, so two stages on one page don't share filter ids. */
  private readonly markId = `anim-mark-${++stageCount}`;

  constructor(
    private readonly container: HTMLElement,
    public ir: VideoIR,
    public timeline: ResolvedTimeline,
    opts: StageOptions = {},
  ) {
    this.templateBase = opts.templateBase;
    const doc = container.ownerDocument;
    this.theme = { ...getTheme(opts.theme ?? ir.theme), ...(ir.kit && { kit: ir.kit }) };
    this.width = ir.canvas.width;
    this.height = ir.canvas.height;
    this.evaluator = createEvaluator(timeline);
    this.idle = findMotion(ir.motion).idle * (this.width / 1920);
    this.indexTracks();

    this.root = doc.createElement("div");
    this.root.className = "anim-stage";
    // Absolutely positioned so the fixed-size stage never affects its container's layout.
    Object.assign(this.root.style, { position: "absolute", left: "0px", top: "0px", width: `${this.width}px`, height: `${this.height}px`, overflow: "hidden", background: this.theme.bg, transformOrigin: "0 0" });

    const fonts = doc.createElement("style");
    fonts.textContent = fontFaceCss(this.theme.faces, opts.fontBase ?? "/fonts/");
    this.root.append(fonts);

    // Filters any scene's layer may use (an id is the document's, whichever SVG holds it).
    this.defs = svg(doc, "svg", { width: 0, height: 0, "aria-hidden": "true" }) as SVGSVGElement;
    this.defs.style.cssText = "position: absolute; width: 0px; height: 0px;";
    if (this.theme.emphasis === "mark") this.defs.append(this.markFilters(doc));
    const rip = svg(doc, "filter", { id: `${this.markId}-ripple`, x: 0, y: 0, width: "100%", height: "100%" });
    const turbulence = svg(doc, "feTurbulence", { type: "fractalNoise", baseFrequency: "0.003 0.008", numOctaves: 2, seed: 7, result: "n" });
    const displace = svg(doc, "feDisplacementMap", { in: "SourceGraphic", in2: "n", scale: 0, xChannelSelector: "R", yChannelSelector: "G" });
    rip.append(turbulence, displace);
    const defs = svg(doc, "defs", {});
    defs.append(rip);
    this.defs.append(defs);
    this.ripple = { turbulence, displace };
    this.root.append(this.defs);
    // Every scene's frame has the look's background, so a scene that slides or opens over another covers it.
    this.frameBase = `position: absolute; inset: 0px; overflow: hidden; background: ${this.theme.bg};`;

    const piece = (base: string) => {
      const n = doc.createElement("div");
      this.baseStyle.set(n, base);
      n.style.cssText = `${base} display: none;`;
      return n;
    };
    const layer = doc.createElement("div");
    layer.style.cssText = OVERLAY_BASE;
    layer.dataset.transition = "";
    const panel = piece("position: absolute; inset: 0px; overflow: hidden;");
    const sheen = piece("position: absolute; inset: 0px;");
    panel.append(sheen);
    this.overlay = { layer, edge: piece("position: absolute;"), ring: piece("position: absolute; border-radius: 50%; box-sizing: border-box;"), seam: piece("position: absolute;"), panel, sheen };
    layer.append(this.overlay.edge, this.overlay.ring, this.overlay.seam, panel);
    this.root.append(layer);

    for (const res of timeline.scenes) this.addScene(res);

    this.wirePages();

    container.append(this.root);
    if (opts.autoFit ?? true) {
      this.fit();
      const RO = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
      if (RO) (this.resizer = new RO(() => this.fit())).observe(container);
    }
    this.render(0);
  }

  /** Indexes the timeline's tracks by what they do to an element (read every frame). */
  private indexTracks(): void {
    for (const m of [this.shownAt, this.tints, this.revealBy, this.sends, this.sets, this.counts] as Map<string, unknown>[]) m.clear();
    const timeline = this.timeline;
    for (const tw of timeline.tracks) {
      if (tw.prop === "opacity" && tw.to === 1 && !this.shownAt.has(tw.target)) this.shownAt.set(tw.target, tw.t1);
      if (tw.prop === "tint") (this.tints.get(tw.target) ?? this.tints.set(tw.target, []).get(tw.target)!).push(tw);
      if (tw.prop === "reveal" && tw.meta?.by && !this.revealBy.has(tw.target)) this.revealBy.set(tw.target, String(tw.meta.by));
      if (tw.prop === "reveal" && tw.meta?.send) (this.sends.get(tw.target) ?? this.sends.set(tw.target, []).get(tw.target)!).push(tw);
      if (tw.prop === "scale" && tw.meta?.set !== undefined) (this.sets.get(tw.target) ?? this.sets.set(tw.target, []).get(tw.target)!).push(tw);
      if (tw.prop === "count") (this.counts.get(tw.target) ?? this.counts.set(tw.target, []).get(tw.target)!).push(tw);
    }
  }

  /** Builds one scene's layers from the current ir and timeline and puts them on the stage (after the scenes already there). */
  private addScene(res: ResolvedScene): void {
    const doc = this.container.ownerDocument;
    const sceneIr = this.ir.scenes.find((s) => s.id === res.id)!;
    const g = svg(doc, "g", { "data-scene": res.id }) as SVGGElement;
    const html = doc.createElement("div");
    html.dataset.scene = res.id;
    html.style.cssText = SCENE_HTML_BASE;
    const instances = new Map<string, Instance>();
    // Panels and axes at the back, then connectors (behind what they connect), then elements, then badges.
    const depth = (e: (typeof sceneIr.elements)[number]) => (e.kind === "panel" || e.kind === "rule" || e.kind === "zone" || e.kind === "chevron" ? 0 : e.link ? 1 : e.kind === "badge" ? 3 : 2);
    const ordered = [...sceneIr.elements].sort((a, b) => depth(a) - depth(b));
    for (const el of ordered) {
      const inst = build(doc, el, this.theme, `${this.markId}-${res.id}-${el.id}`, this.templateBase);
      paintFills(inst, this.theme);
      this.baseStyle.set(inst.root, inst.root.style.cssText);
      for (const nodes of inst.parts.values()) for (const n of nodes) this.baseStyle.set(n, (n as SVGElement).style.cssText);
      instances.set(el.id, inst);
      if (inst.setCues) this.pages.push(inst);
      (inst.layer === "html" ? html : g).append(inst.root);
      // An element that gets struck through carries its line from the start (hidden until `strike`).
      if (inst.layer === "svg" && !inst.connector && this.timeline.tracks.some((tw) => tw.prop === "strike" && tw.target === `${res.id}/${el.id}`)) {
        const line = svg(doc, "line", { x1: round(-el.box.w * 0.46), y1: 0, x2: round(el.box.w * 0.46), y2: 0, pathLength: 1, "stroke-width": 7, "stroke-linecap": "round", stroke: color(this.theme, "warn") }) as SVGLineElement;
        line.style.opacity = "0";
        inst.root.append(line);
        inst.strikeLine = line;
      }
    }
    // Connector labels sit above everything else in the scene: a node drawn over a label would cut its ends off.
    // (The connector's own group has no transform, so the label keeps its coordinates; applyElement keeps it in step.)
    const labels = svg(doc, "g", { "data-layer": "labels" }) as SVGGElement;
    for (const inst of instances.values()) if (inst.connector?.label) labels.append(inst.connector.label);
    if (labels.childNodes.length) g.append(labels);

    const frame = doc.createElement("div");
    frame.dataset.sceneFrame = res.id;
    frame.style.cssText = this.frameBase;
    const content = doc.createElement("div");
    content.style.cssText = CONTENT_BASE;
    const svgRoot = svg(doc, "svg", { viewBox: `0 0 ${this.width} ${this.height}`, width: this.width, height: this.height }) as SVGSVGElement;
    svgRoot.style.cssText = SVG_ROOT_BASE;
    const svgCamera = svg(doc, "g", {
      "data-camera": "",
      stroke: this.theme.fg,
      "stroke-width": this.theme.stroke,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      fill: "none",
    }) as SVGGElement;
    svgCamera.append(g);
    svgRoot.append(svgCamera);
    const htmlCamera = doc.createElement("div");
    htmlCamera.style.cssText = this.htmlCameraBase;
    htmlCamera.append(html);
    content.append(svgRoot, htmlCamera);
    frame.append(content);
    this.root.insertBefore(frame, this.overlay.layer);
    this.scenes.push({ res, ir: sceneIr, frame, content, svgCamera, htmlCamera, svg: g, html, instances, hosted: [...instances.values()].some((i) => i.setCues) });
  }

  private get htmlCameraBase(): string {
    return `position: absolute; left: 0px; top: 0px; width: ${this.width}px; height: ${this.height}px; transform-origin: 0 0;`;
  }

  /** A hosted page shows each item when the script shows it: the first moment its element becomes visible in its scene. */
  private wirePages(): void {
    for (const view of this.scenes) {
      for (const inst of view.instances.values()) {
        if (!inst.setCues) continue;
        const ids = String(inst.el.params.items ?? "").split(",").filter(Boolean);
        inst.setCues(ids.map((id) => this.firstShown(`${view.res.id}/${id}`, view.res.t0)));
      }
    }
  }

  /**
   * Adds the scenes a longer timeline brings, on this stage, so what is on screen is not rebuilt: a designer page that is playing
   * would reload (and flash) with a new stage. The scenes already here keep their layers and their pages; they only learn their
   * resolved times again (a scene that was last may now end with a transition). Returns false when that is not possible (the
   * canvas, the look or the motion changed, the scenes are not the old ones followed by new ones, or an old scene was rewritten):
   * the caller then builds a new stage.
   */
  extend(ir: VideoIR, timeline: ResolvedTimeline): boolean {
    const old = this.scenes;
    if (ir.canvas.width !== this.width || ir.canvas.height !== this.height || ir.theme !== this.ir.theme || ir.motion !== this.ir.motion) return false;
    if (timeline.scenes.length < old.length || old.some((v, i) => timeline.scenes[i]!.id !== v.res.id)) return false;
    // A scene that was the last has a closing transition of its own; once another follows it gets the transition between the two.
    // That is the only thing that changes in an old scene when scenes are appended (the timeline carries it too).
    const same = (a: SceneIR, b: SceneIR) => JSON.stringify({ ...a, transitionOut: undefined }) === JSON.stringify({ ...b, transitionOut: undefined });
    const next = old.map((v) => ir.scenes.find((x) => x.id === v.res.id));
    if (next.some((n, i) => !n || !same(n, old[i]!.ir))) return false;
    old.forEach((v, i) => (v.ir = next[i]!));
    this.ir = ir;
    this.timeline = timeline;
    this.evaluator = createEvaluator(timeline);
    this.indexTracks();
    old.forEach((v, i) => (v.res = timeline.scenes[i]!));
    for (const res of timeline.scenes.slice(old.length)) this.addScene(res);
    this.wirePages();
    this.render(this.time);
    return true;
  }

  /** The earliest time (scene-local) at which an element's opacity rises above zero, or undefined when it never does. */
  private firstShown(target: string, sceneStart: number): number | undefined {
    let first: number | undefined;
    for (const tw of this.timeline.tracks) {
      if (tw.target !== target || tw.prop !== "opacity" || typeof tw.to !== "number" || tw.to <= 0) continue;
      first = first === undefined ? tw.t0 : Math.min(first, tw.t0);
    }
    return first === undefined ? undefined : Math.max(0, first - sceneStart);
  }

  /** Resolves once the look's fonts have loaded and every hosted page has built itself; capture frames only after this. */
  async fontsReady(): Promise<void> {
    await Promise.all(this.pages.map((p) => p.ready));
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
    const { on, overlays } = this.looks(state);
    // The ripple's distortion, on both scenes while it runs.
    const s = overlays.ripple;
    const k = this.width / 1920;
    this.ripple.displace.setAttribute("scale", String(round(s * 48 * k, 1)));
    this.ripple.turbulence.setAttribute("baseFrequency", `${round((0.003 + s * 0.0018) / k, 5)} ${round((0.008 + s * 0.004) / k, 5)}`);
    const extra = s > 0 ? `url(#${this.markId}-ripple)` : "";
    // Scenes off screen are rendered too, so no node ever keeps state from an earlier frame.
    for (const view of this.scenes) this.renderScene(view, state, on.get(view), extra);
    const o = this.overlay;
    for (const [node, entries] of [[o.edge, overlays.edge], [o.ring, overlays.ring], [o.seam, overlays.seam], [o.panel, overlays.panel], [o.sheen, overlays.sheen]] as const) {
      css(node, this.baseStyle.get(node) ?? "", entries.length ? [...entries] : [["display", "none"]]);
    }
  }

  /**
   * The scenes on screen at this moment and how each looks: the one playing, or the two a transition is running between (the old
   * one for the exit part of the transition, at the end of its own time, and the new one for the rest, at the start of its time).
   * Before the first scene and after the last the stage's background stands in for the missing one.
   */
  private looks(state: FrameState): { on: Map<SceneView, SceneLook>; overlays: Overlays } {
    const t = this.time;
    const n = this.scenes.length;
    const on = new Map<SceneView, SceneLook>();
    let overlays = noOverlays();
    this.scenes.forEach((v, i) => {
      if ((t >= v.res.t0 && t < v.res.t1) || (i === n - 1 && t >= v.res.t1)) on.set(v, still());
    });
    for (let i = 0; i <= n; i++) {
      const A = this.scenes[i - 1];
      const B = this.scenes[i];
      const before = A ? A.res.transitionOut.duration : 0;
      const after = B ? B.res.transitionIn.duration : 0;
      if (before + after <= 0) continue;
      const at = A ? A.res.t1 : B!.res.t0;
      if (t < at - before || (B && t >= at + after)) continue;
      const p = clamp01((t - (at - before)) / (before + after));
      const type = A ? A.res.transitionOut.type : B!.res.transitionIn.type;
      if (type.startsWith("into:")) {
        if (A && before > 0) on.set(A, this.into(A, state, p * (before + after) / before));
        continue;
      }
      const cross = crossLook(type, p, { width: this.width, height: this.height, accent: this.theme.accent, cool: this.theme.cool });
      if (A) on.set(A, cross.a);
      if (B) on.set(B, cross.b);
      overlays = cross.overlays;
    }
    return { on, overlays };
  }

  /** `into:<id>`: the camera pushes into the element and the scene dissolves as it fills the frame (q: 0 → 1 over the exit). */
  private into(view: SceneView, state: FrameState, q: number): SceneLook {
    const k = 1 - EASES.out!(clamp01(1 - q));
    const look = still();
    if (k <= 0) return look;
    look.transform = `scale(${round(1 + k * 2.2, 4)})`;
    look.opacity = 1 - clamp01((k - 0.35) / 0.65);
    const focus = view.res.transitionOut.focus;
    if (focus) {
      // the element's spot in the scene, where the scene's camera shows it on the frame
      const cam = this.camera(view, state);
      look.origin = `${round(((focus.x - cam.x) * this.width) / cam.w)}px ${round(((focus.y - cam.y) * this.width) / cam.w)}px`;
    }
    return look;
  }

  private camera(view: SceneView, state: FrameState): Box {
    return (state.get(`${view.res.id}/camera`)?.camera as Box | undefined) ?? { x: 0, y: 0, w: this.width, h: this.height };
  }

  /** Renders one scene: its frame as the transition shows it (look; none = off screen), its camera and its elements. */
  private renderScene(view: SceneView, state: FrameState, look: SceneLook | undefined, extraFilter: string): void {
    const { res } = view;
    const shown = look?.visible ?? false;
    const l = look ?? still();
    const filter = shown ? [l.filter, extraFilter].filter(Boolean).join(" ") : "";
    // A hosted page that is waiting for its scene is hidden, not removed: with `display: none` the iframe has no layout, and pages that
    // fix their letter widths or fit themselves on the first frame (weight, reel, logo) would measure nothing and keep it for good.
    css(view.frame, this.frameBase, [
      ["display", shown || view.hosted ? "" : "none"],
      ["visibility", shown ? "" : "hidden"],
      ["z-index", shown && l.top ? "1" : ""],
      ["opacity", l.opacity < 1 ? String(round(Math.max(0, l.opacity), 4)) : ""],
      ["transform-origin", l.origin],
      ["transform", l.transform],
      ["filter", filter],
      ["clip-path", l.clip],
      ["box-shadow", l.shadow],
      ["backface-visibility", l.backface ? "hidden" : ""],
    ]);
    css(view.content, CONTENT_BASE, [
      ["transform", l.inner],
      ["filter", l.innerFilter],
    ]);

    const cam = this.camera(view, state);
    const camTransform = `scale(${round(this.width / cam.w, 5)}) translate(${round(-cam.x)}px, ${round(-cam.y)}px)`;
    css(view.svgCamera, "", [["transform-origin", "0 0"], ["transform", camTransform]]);
    css(view.htmlCamera, this.htmlCameraBase, [["transform", camTransform]]);

    for (const inst of view.instances.values()) {
      const target = `${res.id}/${inst.el.id}`;
      const props = state.get(target) ?? {};
      this.applyElement(inst, target, props);
      if (inst.tick) inst.tick(Math.min(Math.max(this.time, res.t0), res.t1) - res.t0);
      for (const [part, nodes] of inst.parts) {
        const pp = state.get(`${target}.${part}`) ?? (inst.el.params.anim === "walk" ? {} : undefined);
        if (pp) this.applyPart(nodes, `${target}.${part}`, pp);
      }
    }
    for (const inst of view.instances.values()) if (inst.connector) this.route(inst, view, state);
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

    // set / count: the element's text changes (a pure function of time, so seeking agrees)
    if (inst.retext) {
      let want = inst.el.texts[0] ?? "";
      for (const tw of this.sets.get(target) ?? []) if (this.time >= tw.t1) want = String(tw.meta!.set);
      const counting = (this.counts.get(target) ?? []).filter((tw) => this.time >= tw.t0).pop();
      if (counting) {
        const m = counting.meta ?? {};
        const k = clamp01(num(p.count, 0));
        const v = Number(m.from ?? 0) + (Number(m.to ?? 0) - Number(m.from ?? 0)) * k;
        want = `${m.prefix ?? ""}${v.toFixed(Math.max(0, Math.min(3, Number(m.decimals ?? 0))))}${m.suffix ?? ""}`;
      }
      if (want !== (inst.shown ?? (inst.el.texts[0] ?? ""))) {
        inst.retext(want);
        inst.shown = want;
      }
    }
    // strike: a line across the element
    if (inst.strikeLine) {
      const k = clamp01(num(p.strike, 0));
      inst.strikeLine.setAttribute("stroke-dasharray", "1 1");
      inst.strikeLine.setAttribute("stroke-dashoffset", String(round(1 - k, 4)));
      inst.strikeLine.style.opacity = k > 0.001 ? "1" : "0";
    }

    // tint (highlight)
    const tint = num(p.tint, 0);
    const c = color(this.theme, this.tintMeta(target).color);
    const blur = num(p.blur, 0);
    // A marker block suits text; behind a picture it is a crude rectangle, so pictures glow instead.
    const glow = this.emphasis(tint, c, 4, 14, PICTURES.has(inst.el.kind));
    // A glow goes on the element's shapes and picture, never on its text: a halo of the same color around
    // every glyph makes a highlighted label unreadable. (Marker blocks and HTML widgets stay whole.)
    const perChild = inst.layer !== "html" && !glow.startsWith("url(");
    const filters = [root.getAttribute("data-shadow") ?? "", blur > 0.05 ? `blur(${round(blur, 2)}px)` : "", perChild ? "" : glow];
    style.push(["filter", filters.filter(Boolean).join(" ")]);
    if (perChild) for (const child of Array.from(root.children)) if (child.tagName.toLowerCase() !== "text") (child as SVGElement).style.filter = glow;
    if (textual) {
      for (const t of root.querySelectorAll("text")) t.setAttribute("fill", tint > 0.01 ? `color-mix(in srgb, ${c} ${Math.round(tint * 100)}%, ${this.theme.fg})` : this.theme.fg);
    }
    css(root, this.baseStyle.get(root) ?? "", style);
    // A connector's label lives in the scene's label layer: it shows and fades with its connector.
    const label = inst.connector?.label;
    if (label) {
      label.style.opacity = String(round(innerK * opacity, 4));
      label.style.visibility = opacity <= 0.001 ? "hidden" : "";
    }
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

  /**
   * One line of code. A bar behind it is the status (the current line, added, removed); a sign in the gutter says which
   * (▶, +, −); `write` types the characters with a caret (or, in anim=lines, brings the whole line in); `strike` crosses
   * it out; and in anim=walk every line is dim until it is the one being talked about.
   */
  private codeLine(n: SVGElement, bar: Element, target: string, p: Props, tint: number, c: string): void {
    const anim = n.getAttribute("data-anim") ?? "type";
    const reveal = num(p.reveal, 1);
    const strike = num(p.strike, 0);
    const meta = this.tintMeta(target);
    // The editor is dark in most looks whatever the page is, so its status colors are fixed bright ones there; a light editor uses the look's own.
    const dark = n.getAttribute("data-dark") === "1";
    const paint = (name: string, fixed: string) => (dark ? fixed : color(this.theme, name));
    const red = paint("warn", "#ff7b72");
    const lit = meta.color === "good" ? paint("good", "#3fb950") : meta.color === "warn" ? red : meta.color === "muted" ? paint("muted", "#8b949e") : paint("accent", "#58a6ff");
    const status = strike > 0.01 && tint < 0.5 ? red : lit;
    bar.setAttribute("opacity", String(round(strike > 0.01 && tint < 0.5 ? strike * 0.22 : tint * 0.32, 3)));
    bar.setAttribute("fill", status);

    const chars = [...n.querySelectorAll("tspan")].filter((t) => t.textContent !== " ");
    const lineMode = anim === "lines";
    const shown = lineMode ? (reveal > 0.001 ? chars.length : 0) : Math.floor(chars.length * reveal + 1e-9);
    chars.forEach((t, i) => ((t as SVGElement).style.opacity = i < shown ? "1" : "0"));

    const sign = n.querySelector("[data-sign]");
    if (sign) {
      const added = meta.color === "good" && tint > 0.3;
      const here = meta.color === "accent" && tint > 0.3;
      const removed = strike > 0.3;
      sign.textContent = removed ? "−" : added ? "+" : here ? "▶" : "";
      sign.setAttribute("fill", removed ? red : lit);
      sign.setAttribute("opacity", String(round(Math.max(removed ? strike : 0, added || here ? tint : 0), 3)));
    }

    const x0 = Number(n.getAttribute("data-x0") ?? 0);
    const cw = Number(n.getAttribute("data-cw") ?? 10);
    const len = Number(n.getAttribute("data-len") ?? 0);
    const line = n.querySelector("[data-strike]");
    if (line) {
      line.setAttribute("width", String(round(len * cw * strike, 2)));
      line.setAttribute("opacity", String(round(strike > 0.01 ? 0.9 : 0, 3)));
    }
    const caret = n.querySelector("[data-caret]");
    if (caret) {
      const typing = !lineMode && reveal > 0.001 && reveal < 0.999 && num(p.opacity, 1) > 0.5;
      // The caret sits after the last typed character, spaces counted (the column is kept on each character).
      const last = shown > 0 ? chars[shown - 1] : undefined;
      const col = last ? Number(last.getAttribute("data-i") ?? shown - 1) + 1 : 0;
      caret.setAttribute("x", String(round(x0 + col * cw, 2)));
      caret.setAttribute("opacity", typing ? "0.85" : "0");
    }

    // A walk-through keeps every line dim until it is the current one; a line brought in whole slides in from the left.
    const dim = anim === "walk" ? 0.38 + 0.62 * Math.max(tint, strike > 0.01 ? 0.5 : 0) : 1;
    const slide = lineMode && reveal < 1 ? (1 - Math.min(1, reveal * 1.5)) * -28 : 0;
    css(n, this.baseStyle.get(n) ?? "", [
      ["opacity", String(round(num(p.opacity, 1) * dim * (lineMode ? Math.min(1, reveal * 1.5) : 1), 4))],
      ["transform", slide ? `translateX(${round(slide, 2)}px)` : ""],
    ]);
  }

  private applyPart(nodes: Element[], target: string, p: Props): void {
    const tint = num(p.tint, 0);
    const c = color(this.theme, this.tintMeta(target).color);
    for (const n of nodes) {
      const bar = n.querySelector?.("[data-bar]");
      if (bar) {
        this.codeLine(n as SVGElement, bar, target, p, tint, c);
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
    // A picture's label can be wider than its box: clip at the label's width, or the arrowhead ends inside the text.
    const wide = (id: string, box: Box | undefined): Box | undefined => {
      const lw = Number(view.instances.get(id)?.el.params.labelW ?? 0);
      return box && lw > box.w ? { ...box, x: box.x + box.w / 2 - lw / 2, w: lw } : box;
    };
    const a = wide(c.from, this.currentBox(view, c.from, state));
    const b = wide(c.to, this.currentBox(view, c.to, state));
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
      let off = 10 + Math.abs(nx) * halfW + Math.abs(ny) * 13;
      // A label longer than the gap between its two boxes would lie across them: it moves off the line, clear of both.
      if (!row && !arc && halfW * 2 + 16 > len) off = Math.max(off, (Math.abs(ny) * Math.max(a.h, b.h) + Math.abs(nx) * Math.max(a.w, b.w)) / 2 + 18);
      // On an arc the label sits just outside the curve's apex (halfway between the chord and the control point).
      const apex: [number, number] = arc ? [(mx + ctrl[0]) / 2, (my + ctrl[1]) / 2] : ctrl;
      const side = arc ? Math.sign(bend) || 1 : 1;
      // Never past the canvas edge, where the frame would cut the label.
      const lx = row ? (start[0] + end[0]) / 2 : apex[0] + nx * off * side;
      c.label.setAttribute("x", String(round(Math.min(Math.max(lx, halfW + 12), this.width - halfW - 12))));
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
        c.token.setAttribute("fill", color(this.theme, sending.meta?.fail ? "warn" : "accent"));
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
