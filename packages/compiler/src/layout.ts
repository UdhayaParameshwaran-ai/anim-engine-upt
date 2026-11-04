import type { Diagnostic, ElementDecl, Place, Scene } from "@anim/dsl";
import type { Box } from "@anim/ir";
import { findGridLayout, findTemplate, frameRects, GRID, slotRects, SLOTS, variantGuide, type AssetLibrary, type Rect, type TemplateManifest } from "@anim/registry";
import { gridMode, gridParts } from "@anim/validate";
import { compose, COMPOSE_PATTERNS, type ComposePattern } from "./compose.js";
import { fit, measure, type Size } from "./measure.js";
import { VARIANT_PLUGINS } from "./variants/index.js";

/**
 * The layout engine: the only place coordinates are decided. The DSL names
 * templates, slots and relations; this module turns them into boxes,
 * deterministically (same scene → same boxes).
 */

export const LayoutCodes = {
  Overflow: "NAR413",
  TextTooSmall: "NAR414",
  Overlap: "NAR415",
  VariantSwitched: "NAR416",
} as const;

/** Layout warnings that make a variant unfit for its content. */
const UNFIT = new Set<string>([LayoutCodes.Overflow, LayoutCodes.TextTooSmall, LayoutCodes.Overlap]);

export interface LayoutContext {
  width: number;
  height: number;
  assets: AssetLibrary;
  /** "exact" lays out the named variant even when it fits badly (the gallery shows each as is). Default "fit". */
  variants?: "fit" | "exact";
}

export interface SceneLayout {
  boxes: Map<string, Box>;
  /** Parameters a layout variant implies for an element (e.g. left-aligned text). */
  params: Map<string, Record<string, string>>;
  diagnostics: Diagnostic[];
  /** The template variant used, when the scene has a template. */
  variant?: string;
  /** Destination box for `move <id> @place`. */
  destination(id: string, place: Place): Box | undefined;
}

const LINK_KINDS = new Set(["arrow", "line", "edge"]);
const GAP = 48;

export function layoutScene(scene: Scene, ctx: LayoutContext, kept: Map<string, Box> = new Map()): SceneLayout {
  const isGrid = scene.attrs.grid !== undefined && findGridLayout(scene.attrs.grid);
  const tpl = !isGrid && scene.attrs.template ? findTemplate(scene.attrs.template) : undefined;
  if (!tpl || tpl.variants.length < 2 || ctx.variants === "exact") return new SceneLayouter(scene, ctx, kept).run();
  return chooseVariant(scene, ctx, kept, tpl);
}

/** How well one variant laid out this scene's content. */
export interface VariantScore {
  variant: string;
  /** No overflow, tiny text or overlap. */
  clean: boolean;
  /** Higher is better: content size, use of space, balance, arrows that run clear. */
  value: number;
  issues: number;
  crossings: number;
}

/**
 * Picks the variant by fit; every candidate is laid out on trial and scored.
 * - variant=auto: among the clean ones within 10% of the best, the scene id
 *   picks (stable per scene, varied across scenes).
 * - a named variant, or none (the template default): kept when clean,
 *   otherwise the best clean variant replaces it. A named variant that had
 *   to be replaced is reported (NAR416).
 */
function chooseVariant(scene: Scene, ctx: LayoutContext, kept: Map<string, Box>, tpl: TemplateManifest): SceneLayout {
  const trial = (v: string) => {
    const l = new SceneLayouter(scene, ctx, kept, v);
    const out = l.run();
    return { out, score: l.score(v) };
  };
  const requested = scene.attrs.variant;
  if (requested !== "auto") {
    const out = new SceneLayouter(scene, ctx, kept).run();
    const unfit = out.diagnostics.find((d) => UNFIT.has(d.code));
    if (!unfit) return out;
    const alt = tpl.variants.filter((v) => v !== out.variant).map(trial).filter((t) => t.score.clean);
    if (!alt.length) return out;
    const best = alt.reduce((a, b) => (b.score.value > a.score.value ? b : a));
    if (requested !== undefined) {
      best.out.diagnostics.push({
        code: LayoutCodes.VariantSwitched,
        severity: "warning",
        message: `variant \`${requested}\` does not fit this content (${unfit.message}); used \`${best.score.variant}\``,
        span: scene.span,
        fixed: `variant=${best.score.variant}`,
      });
    }
    return best.out;
  }
  const trials = tpl.variants.map(trial);
  const clean = trials.filter((t) => t.score.clean);
  if (!clean.length) {
    return trials.reduce((a, b) => (b.score.issues < a.score.issues || (b.score.issues === a.score.issues && b.score.value > a.score.value) ? b : a)).out;
  }
  const top = Math.max(...clean.map((t) => t.score.value));
  const good = clean.filter((t) => t.score.value >= top - 0.1 * Math.abs(top));
  return good[hash(scene.id + (scene.title ?? "")) % good.length]!.out;
}

/** Scores every variant of the scene's template on its content (gallery, tests). */
export function scoreVariants(scene: Scene, ctx: LayoutContext): VariantScore[] {
  const tpl = scene.attrs.template ? findTemplate(scene.attrs.template) : undefined;
  if (!tpl) return [];
  return tpl.variants.map((v) => {
    const l = new SceneLayouter(scene, ctx, new Map(), v);
    l.run();
    return l.score(v);
  });
}

class SceneLayouter {
  private readonly boxes = new Map<string, Box>();
  private readonly scales = new Map<string, number>();
  private readonly sizes = new Map<string, Size>();
  private readonly diags: Diagnostic[] = [];
  private readonly els: ElementDecl[];
  private readonly byId: Map<string, ElementDecl>;
  private readonly safe: Box;
  private readonly params = new Map<string, Record<string, string>>();
  /** Fill factor for put() and gap multiplier, from `density=`. */
  private readonly fill: number;
  private readonly gapK: number;
  private chosen?: string;

  constructor(
    private readonly scene: Scene,
    private readonly ctx: LayoutContext,
    private readonly kept: Map<string, Box>,
    /** A variant to lay out instead of the scene's own (trial layouts). */
    private readonly forced?: string,
  ) {
    this.els = scene.steps.flatMap((s) => s.elements);
    this.byId = new Map(this.els.map((e) => [e.id, e]));
    for (const e of this.els) this.sizes.set(e.id, measure(e, ctx.assets));
    const mx = Math.round(ctx.width * 0.05);
    const my = Math.round(ctx.height * 0.067);
    this.safe = { x: mx, y: my, w: ctx.width - 2 * mx, h: ctx.height - 2 * my };
    const density = scene.attrs.density ?? "normal";
    this.fill = density === "airy" ? 0.78 : density === "tight" ? 0.97 : 0.9;
    this.gapK = density === "airy" ? 1.6 : density === "tight" ? 0.55 : 1;
  }

  private get gap(): number {
    return GAP * this.gapK;
  }

  /** The scene's variant; `auto` picks one from the scene id, so it is stable per scene. */
  private variant(tpl: TemplateManifest): string {
    const v = this.forced ?? this.scene.attrs.variant;
    if (!v) return tpl.variants[0]!;
    if (v === "auto") return tpl.variants[hash(this.scene.id + (this.scene.title ?? "")) % tpl.variants.length]!;
    // Plugins (approved, or drafts the validator let through) count as variants.
    return tpl.variants.includes(v) || VARIANT_PLUGINS[`${tpl.name}:${v}`] ? v : tpl.variants[0]!;
  }

  /** Average width / height of elements at natural size (how wide a grid cell should be). */
  private aspectOf(els: ElementDecl[]): number {
    if (!els.length) return 1;
    return els.reduce((sum, e) => sum + this.sizes.get(e.id)!.w / this.sizes.get(e.id)!.h, 0) / els.length;
  }

  /** Space weights for items: the emphasized one gets more room. */
  private weights(items: ElementDecl[]): number[] {
    const e = this.scene.attrs.emphasis;
    const at = e === "first" ? 0 : e === "last" ? items.length - 1 : items.findIndex((x) => x.id === e);
    return items.map((_, i) => (i === at ? 1.7 : 1));
  }

  run(): SceneLayout {
    for (const [id, box] of this.kept) this.boxes.set(id, box);
    if (this.scene.attrs.grid !== undefined && findGridLayout(this.scene.attrs.grid)) {
      this.grid();
      return this.result();
    }

    // 1. Explicit slots.
    const occupied = new Set<string>();
    for (const e of this.els) {
      if (e.place?.kind === "slot" && !LINK_KINDS.has(e.kind)) {
        this.put(e, this.slotCell(e.place.slot));
        occupied.add(e.place.slot);
      }
    }

    // 2. Free elements: by step layout, else scene template / layout.
    const tpl = this.scene.attrs.template ? findTemplate(this.scene.attrs.template) : undefined;
    const isFree = (e: ElementDecl) => !e.place && !LINK_KINDS.has(e.kind) && !this.kept.has(e.id);
    const scenePool: ElementDecl[] = [];
    for (const step of this.scene.steps) {
      const free = step.elements.filter(isFree);
      if (!step.implicit && step.layout) this.layout(step.layout.name, free, this.safe);
      else scenePool.push(...free);
    }
    const sceneLayout = this.scene.steps[0]?.implicit ? this.scene.steps[0].layout?.name : undefined;
    const area = this.freeArea(occupied, sceneLayout === "col" || sceneLayout === "stack" ? "tall" : "wide");
    if (tpl) this.template(tpl, scenePool, area);
    else if (this.scene.attrs.compose) this.composeScene(scenePool, area);
    else this.layout(sceneLayout ?? (scenePool.length === 1 ? "center" : "row"), scenePool, area);

    // 3. Relative placements (may chain). Connectors are routed in result(), after any mirroring.
    this.relatives();

    this.checkOverlaps();
    return this.result();
  }

  private result(): SceneLayout {
    const self = this;
    if (this.scene.attrs.mirror === "true") this.mirror();
    for (const e of this.els) if (LINK_KINDS.has(e.kind) && e.link) this.connector(e);
    return {
      boxes: this.boxes,
      params: this.params,
      diagnostics: this.diags,
      ...(this.chosen !== undefined && { variant: this.chosen }),
      destination(id, place) {
        const el = self.byId.get(id);
        const cur = self.boxes.get(id);
        if (!cur) return undefined;
        if (place.kind === "slot") {
          const size = el ? self.sizes.get(id)! : { w: cur.w, h: cur.h };
          return center(self.slotCell(place.slot), fit(size, self.slotCell(place.slot).w * 0.9, self.slotCell(place.slot).h * 0.9));
        }
        const ref = self.boxes.get(place.ref);
        return ref ? self.clamp(relative(ref, { w: cur.w, h: cur.h }, place.relation)) : undefined;
      },
    };
  }

  /**
   * Grid scene (Template Rule Book v2): the frame mode follows from the
   * header/footer elements, content fills the layout's slots in reading
   * order, each element taking its whole slot.
   */
  private grid(): void {
    const layout = findGridLayout(this.scene.attrs.grid!)!;
    const parts = gridParts(this.els);
    const mode = gridMode(this.els);
    const sx = this.ctx.width / GRID.width;
    const sy = this.ctx.height / GRID.height;
    const scale = (r: Rect): Box => round({ x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy });
    const frame = frameRects(mode);
    if (parts.title && frame.title) this.boxes.set(parts.title.id, scale(frame.title));
    if (parts.subtitle && frame.subtitle) this.boxes.set(parts.subtitle.id, scale(frame.subtitle));
    if (parts.footer && frame.footer) this.boxes.set(parts.footer.id, scale(frame.footer));
    const rects = slotRects(layout, mode);
    parts.content.forEach((e, i) => {
      const r = rects[i];
      if (r) this.boxes.set(e.id, scale(r));
      else this.put(e, this.safe); // more elements than slots: the validator already reported it
    });
  }

  // ------------------------------------------------------------ placing ---

  /** Places an element centered in a cell, wrapping/scaling to fit. */
  private put(e: ElementDecl, cell: Box, fill = this.fill): void {
    const size = this.sizes.get(e.id)!;
    const f = fit(size, cell.w * fill, cell.h * fill);
    this.boxes.set(e.id, center(cell, f));
    this.scales.set(e.id, f.scale);
    if (f.scale < 0.5 && size.wraps) {
      this.diags.push(warn(LayoutCodes.TextTooSmall, `text of \`${e.id}\` had to shrink to ${Math.round(f.scale * 100)}%; shorten it`, e));
    } else if (f.scale < 0.35) {
      this.diags.push(warn(LayoutCodes.Overflow, `\`${e.id}\` had to shrink to ${Math.round(f.scale * 100)}% to fit`, e));
    }
  }

  private slotCell(slot: string): Box {
    const i = Math.max(0, (SLOTS as readonly string[]).indexOf(slot));
    const cw = this.safe.w / 3;
    const ch = this.safe.h / 3;
    return { x: this.safe.x + (i % 3) * cw, y: this.safe.y + Math.floor(i / 3) * ch, w: cw, h: ch };
  }

  /**
   * Largest rectangle of the 3×3 slot grid that avoids slots already taken,
   * so free elements don't land on top of explicitly placed ones.
   */
  private freeArea(occupied: Set<string>, prefer: "wide" | "tall"): Box {
    if (!occupied.size) return this.safe;
    const taken = (c: number, r: number) => occupied.has(SLOTS[r * 3 + c]!);
    let best: { c0: number; r0: number; c1: number; r1: number; score: number } | undefined;
    for (let r0 = 0; r0 < 3; r0++)
      for (let c0 = 0; c0 < 3; c0++)
        for (let r1 = r0; r1 < 3; r1++)
          for (let c1 = c0; c1 < 3; c1++) {
            let ok = true;
            for (let r = r0; r <= r1 && ok; r++) for (let c = c0; c <= c1 && ok; c++) if (taken(c, r)) ok = false;
            if (!ok) continue;
            const w = c1 - c0 + 1;
            const h = r1 - r0 + 1;
            const score = w * h * 10 + (prefer === "wide" ? w - h : h - w);
            if (!best || score > best.score) best = { c0, r0, c1, r1, score };
          }
    if (!best) return this.safe;
    const a = this.slotCell(SLOTS[best.r0 * 3 + best.c0]!);
    const b = this.slotCell(SLOTS[best.r1 * 3 + best.c1]!);
    return { x: a.x, y: a.y, w: b.x + b.w - a.x, h: b.y + b.h - a.y };
  }

  // ------------------------------------------------------------- layouts ---

  private layout(name: string, els: ElementDecl[], area: Box): void {
    if (!els.length) return;
    switch (name) {
      case "center":
        if (els.length === 1) return this.put(els[0]!, area, 0.7);
        return this.layout("row", els, area);
      case "col":
      case "stack":
        return els.forEach((e, i) => this.put(e, colCells(area, els.length, this.gap, this.weights(els))[i]!));
      case "grid":
        return els.forEach((e, i) => this.put(e, gridCells(area, els.length, this.aspectOf(els), this.gap)[i]!));
      case "split": {
        const [l, r] = rowCells(area, 2);
        const left = els.filter((_, i) => i % 2 === 0);
        const right = els.filter((_, i) => i % 2 === 1);
        left.forEach((e, i) => this.put(e, colCells(l!, left.length)[i]!));
        right.forEach((e, i) => this.put(e, colCells(r!, right.length)[i]!));
        return;
      }
      case "cycle":
        return this.ring(els, area);
      case "row":
      default:
        return els.forEach((e, i) => this.put(e, rowCells(area, els.length, this.gap, this.weights(els))[i]!));
    }
  }

  private template(tpl: TemplateManifest, pool: ElementDecl[], area: Box): void {
    const slot = (name: string) => pool.find((e) => e.id === name);
    const named = new Set(tpl.slots.map((s) => s.name));
    const items = pool.filter((e) => !named.has(e.id));

    // Templates with a title slot reserve a band at the top.
    let content = area;
    const title = named.has("title") ? slot("title") : undefined;
    if (title && tpl.name !== "title") {
      const band = { ...area, h: Math.round(area.h * 0.18) };
      this.put(title, band, 0.95);
      content = { x: area.x, y: band.y + band.h, w: area.w, h: area.h - band.h };
    }

    const variant = this.variant(tpl);
    this.chosen = variant;
    const plugin = VARIANT_PLUGINS[`${tpl.name}:${variant}`];
    if (plugin) {
      const e = this.scene.attrs.emphasis;
      return plugin({
        area: content,
        gap: this.gap,
        items,
        slot,
        put: (el, cell, fill) => this.put(el, cell, fill),
        rowCells: (a, n, w) => rowCells(a, n, this.gap, w),
        colCells: (a, n, w) => colCells(a, n, this.gap, w),
        gridCells: (a, n) => gridCells(a, n, this.aspectOf(items), this.gap),
        emphasis: e === "first" ? 0 : e === "last" ? items.length - 1 : items.findIndex((x) => x.id === e),
      });
    }
    switch (tpl.name) {
      case "title": {
        const sub = slot("subtitle");
        if (variant === "center") {
          const main = { x: area.x, y: area.y + area.h * 0.28, w: area.w, h: area.h * 0.28 };
          if (title) this.put(title, main, 0.95);
          if (sub) this.put(sub, { x: area.x, y: main.y + main.h, w: area.w, h: area.h * 0.16 }, 0.9);
          return this.layout("row", items, { x: area.x, y: area.y + area.h * 0.75, w: area.w, h: area.h * 0.25 });
        }
        // left: a big left-aligned headline with items beside it; split: centered halves.
        const textCol = { x: area.x, y: area.y, w: area.w * (variant === "left" ? 0.6 : 0.5), h: area.h };
        const side = { x: textCol.x + textCol.w + this.gap, y: area.y, w: area.w - textCol.w - this.gap, h: area.h };
        const main = { ...textCol, y: area.y + area.h * (sub ? 0.26 : 0.32), h: area.h * 0.3 };
        if (title) this.putAligned(title, main, variant === "left");
        if (sub) this.putAligned(sub, { ...textCol, y: main.y + main.h, h: area.h * 0.18 }, variant === "left");
        return this.layout(items.length > 1 ? "col" : "center", items, side);
      }
      case "compare": {
        const left = slot("left");
        const right = slot("right");
        const e = this.scene.attrs.emphasis;
        const big = e === "right" || e === "last" ? 1 : 0;
        let cells: Box[];
        if (variant === "stacked") cells = colCells(content, 2, this.gap);
        else if (variant === "diagonal") {
          const w = content.w * 0.56;
          const h = content.h * 0.6;
          cells = [{ x: content.x, y: content.y, w, h }, { x: content.x + content.w - w, y: content.y + content.h - h, w, h }];
        } else if (variant === "asymmetric") cells = rowCells(content, 2, this.gap * 2, big ? [1, 1.618] : [1.618, 1]);
        else cells = rowCells(content, 2, this.gap * 2, e ? (big ? [1, 1.35] : [1.35, 1]) : undefined);
        if (left) this.put(left, cells[0]!, 0.85);
        if (right) this.put(right, cells[1]!, 0.85);
        return this.layout("row", items, { ...content, y: content.y + content.h * 0.8, h: content.h * 0.2 });
      }
      case "steps": {
        if (variant === "column") return this.layout("col", items, content);
        if (variant === "grid") return this.layout("grid", items, content);
        const cells = rowCells(content, items.length, this.gap, this.weights(items));
        if (variant === "zigzag") {
          const h = content.h * 0.62;
          return items.forEach((e, i) => this.put(e, { ...cells[i]!, y: i % 2 ? content.y + content.h - h : content.y, h }));
        }
        if (variant === "staircase") {
          // Rising left to right: each step a little higher.
          const h = content.h * 0.55;
          const rise = items.length > 1 ? (content.h - h) / (items.length - 1) : 0;
          return items.forEach((e, i) => this.put(e, { ...cells[i]!, y: content.y + content.h - h - i * rise, h }));
        }
        return items.forEach((e, i) => this.put(e, cells[i]!));
      }
      case "cards": {
        if (variant === "strip") return this.layout("row", items, content);
        if (variant === "feature" && items.length > 1) {
          const e = this.scene.attrs.emphasis;
          const at = Math.max(0, e === "last" ? items.length - 1 : items.findIndex((x) => x.id === e));
          const hero = items[at]!;
          const rest = items.filter((_, i) => i !== at);
          const [l, r] = rowCells(content, 2, this.gap, [1.2, 1]);
          this.put(hero, l!);
          return this.layout(rest.length > 2 ? "grid" : "col", rest, r!);
        }
        return this.layout("grid", items, content);
      }
      case "timeline": {
        if (variant === "vertical") return this.layout("col", items, content);
        const cells = rowCells(content, items.length, this.gap, this.weights(items));
        if (variant === "line") {
          const h = content.h * 0.5;
          return items.forEach((e, i) => this.put(e, { ...cells[i]!, y: content.y + (content.h - h) / 2, h }));
        }
        // Items alternate above and below the line, so each can spread over its neighbours' columns.
        const h = content.h * 0.42;
        return items.forEach((e, i) => {
          const c = cells[i]!;
          const w = items.length > 2 ? Math.min(content.w, 2 * c.w + this.gap) : c.w;
          const x = Math.min(Math.max(content.x, c.x + c.w / 2 - w / 2), content.x + content.w - w);
          this.put(e, { x, y: i % 2 ? content.y + content.h - h : content.y, w, h });
        });
      }
      case "cycle":
      case "hub": {
        const mid = slot("center");
        if (variant === "arc") return this.arc(items, content, mid);
        if (variant === "sides" && items.length > 1) {
          const [l, m, r] = rowCells(content, 3, this.gap, [1, 1.3, 1]);
          if (mid) this.put(mid, m!);
          const left = items.filter((_, i) => i % 2 === 0);
          const right = items.filter((_, i) => i % 2 === 1);
          left.forEach((e, i) => this.put(e, colCells(l!, left.length, this.gap)[i]!));
          right.forEach((e, i) => this.put(e, colCells(r!, right.length, this.gap)[i]!));
          return;
        }
        return this.ring(items, content, mid);
      }
      case "spotlight": {
        const main = slot("main");
        if (variant === "left" || variant === "right") {
          const [c0, c1] = rowCells(content, 2, this.gap, variant === "left" ? [1.4, 1] : [1, 1.4]);
          const [mainCell, side] = variant === "left" ? [c0!, c1!] : [c1!, c0!];
          if (main) this.put(main, mainCell);
          items.forEach((e, i) => this.put(e, colCells(side, items.length, this.gap)[i]!));
          return;
        }
        const mainCell = { x: content.x + content.w * 0.25, y: content.y, w: content.w * 0.5, h: content.h };
        if (main) this.put(main, mainCell, 0.9);
        const left = items.filter((_, i) => i % 2 === 0);
        const right = items.filter((_, i) => i % 2 === 1);
        const lc = { x: content.x, y: content.y, w: content.w * 0.25, h: content.h };
        const rc = { x: content.x + content.w * 0.75, y: content.y, w: content.w * 0.25, h: content.h };
        left.forEach((e, i) => this.put(e, colCells(lc, left.length)[i]!));
        right.forEach((e, i) => this.put(e, colCells(rc, right.length)[i]!));
        return;
      }
      case "flow":
        return this.flow(pool, content, variant);
      case "converge":
      case "diverge": {
        // The narrow middle cell stays empty: it is where the arrows run.
        const hub = slot(tpl.name === "converge" ? "result" : "source");
        const into = tpl.name === "converge";
        if (variant === "around") return this.orbit(items, content, hub);
        if (variant === "top" || variant === "bottom") {
          const [a, , b] = colCells(content, 3, this.gap, into ? [1, 0.35, 1.4] : [1.4, 0.35, 1]);
          const [many, one] = into ? [a!, b!] : [b!, a!];
          if (hub) this.put(hub, one, 0.85);
          return items.forEach((e, i) => this.put(e, rowCells(many, items.length, this.gap)[i]!));
        }
        const [a, , b] = rowCells(content, 3, this.gap, into ? [1, 0.45, 1.3] : [1.3, 0.45, 1]);
        const [many, one] = into ? [a!, b!] : [b!, a!];
        if (hub) this.put(hub, one, 0.85);
        return items.forEach((e, i) => this.put(e, colCells(many, items.length, this.gap)[i]!));
      }
      case "process": {
        // Inputs are the items declared before `process`, outputs the ones after (half and half if one side is empty).
        const proc = slot("process");
        const at = proc ? this.els.indexOf(proc) : -1;
        let inputs = items.filter((e) => this.els.indexOf(e) < at);
        let outputs = items.filter((e) => this.els.indexOf(e) > at);
        if (!inputs.length || !outputs.length) {
          const half = Math.ceil(items.length / 2);
          inputs = items.slice(0, half);
          outputs = items.slice(half);
        }
        if (variant === "equation") {
          // One line: in + in → [process] → out + out, on a middle band.
          const band = { x: content.x, y: content.y + content.h * 0.22, w: content.w, h: content.h * 0.56 };
          const weights = [...inputs.map(() => 1), 0.4, 1.5, 0.4, ...outputs.map(() => 1)];
          const cells = rowCells(band, weights.length, this.gap * 0.6, weights);
          inputs.forEach((e, i) => this.put(e, cells[i]!));
          if (proc) this.put(proc, cells[inputs.length + 1]!, 0.9);
          outputs.forEach((e, i) => this.put(e, cells[inputs.length + 3 + i]!));
          return;
        }
        // Three bands with wide gaps between them for the arrows (a 16:9 frame has little height to spare going down).
        const down = variant === "down";
        const parts = down ? colCells(content, 3, this.gap * 2.4, [1, 1.5, 1]) : rowCells(content, 5, this.gap, [1, 0.35, 1.25, 0.35, 1]);
        const [first, mid, last] = down ? [parts[0]!, parts[1]!, parts[2]!] : [parts[0]!, parts[2]!, parts[4]!];
        const side = (list: ElementDecl[], cell: Box) => list.forEach((e, i) => this.put(e, (down ? rowCells : colCells)(cell, list.length, this.gap)[i]!));
        side(inputs, first);
        if (proc) this.put(proc, mid, 0.9);
        side(outputs, last);
        return;
      }
      default:
        return this.layout("row", items, content);
    }
  }

/**
   * `compose=<pattern>`: boxes from the constraint solver (compose.ts). A
   * `title` element keeps the top band; the hero is the emphasized element,
   * else the first picture-like one. Falls back to a row if nothing solves.
   */
  private composeScene(pool: ElementDecl[], area: Box): void {
    let content = area;
    const title = pool.find((e) => e.id === "title" && ["title", "text"].includes(e.kind));
    if (title) {
      const band = { ...area, h: Math.round(area.h * 0.18) };
      this.put(title, band, 0.95);
      content = { x: area.x, y: band.y + band.h, w: area.w, h: area.h - band.h };
    }
    const els = pool.filter((e) => e !== title);
    const e = this.scene.attrs.emphasis;
    const heroId = (e === "first" ? els[0] : e === "last" ? els.at(-1) : els.find((x) => x.id === e))?.id ?? els.find((x) => ["asset", "icon", "chart", "card", "formula", "circle"].includes(x.kind))?.id ?? els[0]?.id;
    const pattern = (COMPOSE_PATTERNS as readonly string[]).includes(this.scene.attrs.compose!) ? (this.scene.attrs.compose as ComposePattern) : "auto";
    const result = compose(
      els.map((x) => ({ id: x.id, w: this.sizes.get(x.id)!.w, h: this.sizes.get(x.id)!.h, hero: x.id === heroId, text: ["title", "text", "label", "list"].includes(x.kind) })),
      content,
      { pattern, gap: this.gap, seed: hash(this.scene.id) },
    );
    if (!result) return this.layout("row", els, content);
    for (const x of els) {
      const box = result.boxes.get(x.id)!;
      // Pictures take the solved box as is (it keeps their aspect and may enlarge them); text is fitted.
      if (["title", "text", "label", "list"].includes(x.kind)) this.put(x, box, 1);
      else this.boxes.set(x.id, box);
    }
  }

  /** Places text left-aligned (or centered) in a cell, telling the engine how to align it. */
  private putAligned(e: ElementDecl, cell: Box, left: boolean): void {
    if (!left) return this.put(e, cell, 0.95);
    const size = this.sizes.get(e.id)!;
    const f = fit(size, cell.w * 0.95, cell.h * 0.95);
    this.boxes.set(e.id, round({ x: cell.x, y: cell.y + (cell.h - f.h) / 2, w: cell.w * 0.95, h: f.h }));
    this.params.set(e.id, { ...this.params.get(e.id), align: "left" });
  }

  /** Items along the upper half of a circle, optional center element under the arc. */
  private arc(items: ElementDecl[], area: Box, mid?: ElementDecl): void {
    const n = Math.max(1, items.length);
    const cell = Math.min(260, area.w / (n + 1));
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h - cell * 0.4;
    const r = Math.min(area.w / 2 - cell / 2, area.h - cell);
    items.forEach((e, i) => {
      const a = Math.PI + (n === 1 ? Math.PI / 2 : (i * Math.PI) / (n - 1));
      this.put(e, { x: cx + r * Math.cos(a) - cell / 2, y: cy + r * Math.sin(a) - cell / 2, w: cell, h: cell }, 1);
    });
    if (mid) this.put(mid, { x: cx - r * 0.45, y: cy - r * 0.55, w: r * 0.9, h: r * 0.5 });
  }

  /** Flips the scene left-right (connectors are routed afterwards). */
  private mirror(): void {
    for (const [id, bx] of this.boxes) this.boxes.set(id, { ...bx, x: this.ctx.width - bx.x - bx.w });
  }

  /** Items evenly on a circle (clockwise from the top), optional center element. */
  /**
   * Items on an ellipse that uses the frame's full width, around a central
   * element sized to leave room for the arrows between them.
   */
  private orbit(items: ElementDecl[], area: Box, mid?: ElementDecl): void {
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const n = Math.max(1, items.length);
    const cell = Math.min(220, area.h * 0.28);
    const rx = Math.min(area.w * 0.36, area.w / 2 - cell / 2);
    const ry = area.h / 2 - cell / 2;
    items.forEach((e, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      this.put(e, { x: cx + rx * Math.cos(a) - cell / 2, y: cy + ry * Math.sin(a) - cell / 2, w: cell, h: cell }, 1);
    });
    if (mid) {
      const m = Math.min(area.h * 0.3, rx * 0.5);
      this.put(mid, { x: cx - m / 2, y: cy - m / 2, w: m, h: m }, 0.9);
    }
  }

  private ring(items: ElementDecl[], area: Box, mid?: ElementDecl): void {
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const n = Math.max(1, items.length);
    const cell = Math.min(280, (Math.min(area.w, area.h) * Math.PI) / (n + 2));
    const r = Math.min(area.w, area.h) / 2 - cell / 2;
    items.forEach((e, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      this.put(e, { x: cx + r * Math.cos(a) - cell / 2, y: cy + r * Math.sin(a) - cell / 2, w: cell, h: cell }, 1);
    });
    if (mid) {
      const m = Math.max(cell, r * 1.1);
      this.put(mid, { x: cx - m / 2, y: cy - m / 2, w: m, h: m }, 0.9);
    }
  }

  /**
   * Layered (Sugiyama-style) graph layout: ranks by longest path from the
   * sources, one barycenter pass to reduce crossings, ties broken by
   * declaration order. Top-down for ≤4 ranks, otherwise left-to-right.
   */
  private flow(pool: ElementDecl[], area: Box, variant = "auto"): void {
    const nodes = pool.filter((e) => e.kind === "node" || !LINK_KINDS.has(e.kind));
    const ids = nodes.map((n) => n.id);
    const index = new Map(ids.map((id, i) => [id, i]));
    const edges = this.els
      .filter((e) => LINK_KINDS.has(e.kind) && e.link && index.has(e.link.from) && index.has(e.link.to) && e.link.from !== e.link.to)
      .map((e) => e.link!);

    // Break cycles: DFS in declaration order, drop back edges.
    const out = new Map(ids.map((id) => [id, edges.filter((e) => e.from === id).map((e) => e.to)]));
    const state = new Map<string, 1 | 2>();
    const dag: { from: string; to: string }[] = [];
    const visit = (u: string) => {
      state.set(u, 1);
      for (const v of out.get(u)!) {
        if (state.get(v) === 1) continue; // back edge
        dag.push({ from: u, to: v });
        if (!state.has(v)) visit(v);
      }
      state.set(u, 2);
    };
    for (const id of ids) if (!state.has(id)) visit(id);

    // Longest-path ranks via Kahn's algorithm in declaration order.
    const rank = new Map(ids.map((id) => [id, 0]));
    const indeg = new Map(ids.map((id) => [id, dag.filter((e) => e.to === id).length]));
    const queue = ids.filter((id) => indeg.get(id) === 0);
    while (queue.length) {
      queue.sort((a, b) => index.get(a)! - index.get(b)!);
      const u = queue.shift()!;
      for (const e of dag.filter((e) => e.from === u)) {
        rank.set(e.to, Math.max(rank.get(e.to)!, rank.get(u)! + 1));
        indeg.set(e.to, indeg.get(e.to)! - 1);
        if (indeg.get(e.to) === 0) queue.push(e.to);
      }
    }
    const layers: string[][] = [];
    for (const id of ids) (layers[rank.get(id)!] ??= []).push(id);

    // One barycenter pass, top-down.
    const pos = new Map<string, number>();
    layers[0]?.forEach((id, i) => pos.set(id, i));
    for (let k = 1; k < layers.length; k++) {
      const layer = layers[k]!;
      const bary = (id: string) => {
        const ps = dag.filter((e) => e.to === id && pos.has(e.from)).map((e) => pos.get(e.from)! / Math.max(1, layers[rank.get(e.from)!]!.length));
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity;
      };
      layer.sort((a, b) => bary(a) - bary(b) || index.get(a)! - index.get(b)!);
      layer.forEach((id, i) => pos.set(id, i));
    }

    const topDown = variant === "down" || (variant !== "across" && layers.length <= 4);
    const bands = topDown ? colCells(area, layers.length, GAP) : rowCells(area, layers.length, GAP);
    layers.forEach((layer, k) => {
      const cells = topDown ? rowCells(bands[k]!, layer.length, GAP) : colCells(bands[k]!, layer.length, GAP);
      layer.forEach((id, i) => this.put(this.byId.get(id)!, cells[i]!, 0.9));
    });
  }

  private relatives(): void {
    const pending = this.els.filter((e) => e.place?.kind === "relative" && !LINK_KINDS.has(e.kind));
    for (let pass = 0; pending.length && pass <= this.els.length; pass++) {
      for (const e of [...pending]) {
        const place = e.place as Extract<Place, { kind: "relative" }>;
        const ref = this.boxes.get(place.ref);
        if (!ref) continue;
        const size = this.sizes.get(e.id)!;
        const f = place.relation === "inside" ? fit(size, ref.w * 0.6, ref.h * 0.6) : fit(size, this.safe.w / 3, this.safe.h / 3);
        this.boxes.set(e.id, this.clamp(relative(ref, f, place.relation)));
        pending.splice(pending.indexOf(e), 1);
      }
    }
    // Unresolvable chains (cycles) fall back to the center.
    for (const e of pending) this.put(e, this.slotCell("C"));
  }

  private connector(e: ElementDecl): void {
    const a = this.boxes.get(e.link!.from);
    const b = this.boxes.get(e.link!.to);
    if (!a || !b) return;
    const [ax, ay] = [a.x + a.w / 2, a.y + a.h / 2];
    const [bx, by] = [b.x + b.w / 2, b.y + b.h / 2];
    this.boxes.set(e.id, round({ x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.max(1, Math.abs(bx - ax)), h: Math.max(1, Math.abs(by - ay)) }));
  }

  private clamp(b: Box): Box {
    const s = this.safe;
    return {
      ...b,
      x: Math.min(Math.max(b.x, s.x), s.x + s.w - Math.min(b.w, s.w)),
      y: Math.min(Math.max(b.y, s.y), s.y + s.h - Math.min(b.h, s.h)),
    };
  }

  /**
   * Fit score of the finished layout. Unfit warnings disqualify; among the
   * rest, bigger content, more of the frame used, a centred composition and
   * arrows that don't cut through other elements win. Content outside the
   * variant's declared item range costs a little.
   */
  score(variant: string): VariantScore {
    const issues = this.diags.filter((d) => UNFIT.has(d.code)).length;
    const solid = this.els.filter((e) => !LINK_KINDS.has(e.kind) && this.boxes.has(e.id));
    const boxes = solid.map((e) => this.boxes.get(e.id)!);
    const scales = [...this.scales.values()].map((v) => Math.min(1, v));
    const size = scales.length ? scales.reduce((a, b) => a + b, 0) / scales.length : 1;
    let coverage = 0;
    let balance = 1;
    if (boxes.length) {
      const x0 = Math.min(...boxes.map((b) => b.x));
      const y0 = Math.min(...boxes.map((b) => b.y));
      const x1 = Math.max(...boxes.map((b) => b.x + b.w));
      const y1 = Math.max(...boxes.map((b) => b.y + b.h));
      coverage = ((x1 - x0) * (y1 - y0)) / (this.safe.w * this.safe.h);
      const dx = Math.abs((x0 + x1) / 2 - (this.safe.x + this.safe.w / 2)) / (this.safe.w / 2);
      const dy = Math.abs((y0 + y1) / 2 - (this.safe.y + this.safe.h / 2)) / (this.safe.h / 2);
      balance = 1 - Math.min(1, (dx + dy) / 2);
    }
    let crossings = 0;
    for (const e of this.els) {
      if (!LINK_KINDS.has(e.kind) || !e.link) continue;
      const a = this.boxes.get(e.link.from);
      const b = this.boxes.get(e.link.to);
      if (!a || !b) continue;
      for (const o of solid) {
        if (o.id === e.link.from || o.id === e.link.to) continue;
        if (segmentHits(a, b, shrink(this.boxes.get(o.id)!, 0.15))) crossings++;
      }
    }
    const tpl = this.scene.attrs.template ? findTemplate(this.scene.attrs.template) : undefined;
    const range = tpl ? variantGuide(tpl, variant).items : undefined;
    const items = tpl ? solid.filter((e) => !tpl.slots.some((s) => s.name === e.id)).length : 0;
    const outside = range && (items < range[0] || items > range[1]) ? 0.15 : 0;
    const value = 0.45 * size + 0.3 * Math.min(1, coverage / 0.7) + 0.25 * balance - 0.1 * crossings - outside;
    return { variant, clean: issues === 0, value: Math.round(value * 1000) / 1000, issues, crossings };
  }

  private checkOverlaps(): void {
    const solid = this.els.filter((e) => !LINK_KINDS.has(e.kind) && e.place?.kind !== "relative" && this.boxes.has(e.id));
    for (let i = 0; i < solid.length; i++)
      for (let j = i + 1; j < solid.length; j++) {
        const a = this.boxes.get(solid[i]!.id)!;
        const b = this.boxes.get(solid[j]!.id)!;
        const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        if (ix * iy > 0.1 * Math.min(a.w * a.h, b.w * b.h)) {
          this.diags.push(warn(LayoutCodes.Overlap, `\`${solid[i]!.id}\` and \`${solid[j]!.id}\` overlap; use different slots or a template`, solid[j]!));
        }
      }
  }
}

// ------------------------------------------------------------- geometry ---

/** Splits a length into n parts by weight, with gaps; returns [offset, size] pairs. */
function split(total: number, n: number, gap: number, weights?: number[]): [number, number][] {
  const w = weights && weights.length === n ? weights : Array.from({ length: n }, () => 1);
  const sum = w.reduce((x, y) => x + y, 0);
  const free = total - gap * (n - 1);
  let at = 0;
  return w.map((k) => {
    const size = (free * k) / sum;
    const part: [number, number] = [at, size];
    at += size + gap;
    return part;
  });
}

export function rowCells(area: Box, n: number, gap = GAP, weights?: number[]): Box[] {
  return split(area.w, n, gap, weights).map(([o, w]) => ({ x: area.x + o, y: area.y, w, h: area.h }));
}

export function colCells(area: Box, n: number, gap = GAP, weights?: number[]): Box[] {
  return split(area.h, n, gap, weights).map(([o, h]) => ({ x: area.x, y: area.y + o, w: area.w, h }));
}

/**
 * Cells for n items in rows. The column count is the one that lets items of
 * the given aspect (width / height) be largest; ties go to fewer empty cells,
 * then fewer columns. A shorter last row is centred.
 */
export function gridCells(area: Box, n: number, itemAspect = 1, gap = GAP): Box[] {
  if (n <= 0) return [];
  let cols = 1;
  let best = -1;
  let bestEmpty = Infinity;
  for (let c = 1; c <= n; c++) {
    const r = Math.ceil(n / c);
    const cw = (area.w - gap * (c - 1)) / c;
    const ch = (area.h - gap * (r - 1)) / r;
    const side = Math.round(Math.min(cw / itemAspect, ch));
    const empty = c * r - n;
    if (side > best || (side === best && empty < bestEmpty)) {
      cols = c;
      best = side;
      bestEmpty = empty;
    }
  }
  const rows = Math.ceil(n / cols);
  const rowsBoxes = colCells(area, rows, gap);
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    const cell = rowCells(rowsBoxes[row]!, cols, gap)[i % cols]!;
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const shift = ((cols - inRow) * (cell.w + gap)) / 2;
    return { ...cell, x: cell.x + shift };
  });
}

function shrink(b: Box, k: number): Box {
  return { x: b.x + b.w * k, y: b.y + b.h * k, w: b.w * (1 - 2 * k), h: b.h * (1 - 2 * k) };
}

/** Does the straight line between two boxes' centres pass through box `o`? (Liang–Barsky clipping.) */
function segmentHits(a: Box, b: Box, o: Box): boolean {
  const x0 = a.x + a.w / 2;
  const y0 = a.y + a.h / 2;
  const dx = b.x + b.w / 2 - x0;
  const dy = b.y + b.h / 2 - y0;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [[-dx, x0 - o.x], [dx, o.x + o.w - x0], [-dy, y0 - o.y], [dy, o.y + o.h - y0]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function center(cell: Box, size: { w: number; h: number }): Box {
  return round({ x: cell.x + (cell.w - size.w) / 2, y: cell.y + (cell.h - size.h) / 2, w: size.w, h: size.h });
}

function relative(ref: Box, size: { w: number; h: number }, relation: string, gap = 32): Box {
  const cx = ref.x + ref.w / 2;
  const cy = ref.y + ref.h / 2;
  switch (relation) {
    case "right-of":
      return round({ x: ref.x + ref.w + gap, y: cy - size.h / 2, ...size });
    case "left-of":
      return round({ x: ref.x - gap - size.w, y: cy - size.h / 2, ...size });
    case "above":
      return round({ x: cx - size.w / 2, y: ref.y - gap - size.h, ...size });
    case "below":
      return round({ x: cx - size.w / 2, y: ref.y + ref.h + gap, ...size });
    default:
      return round({ x: cx - size.w / 2, y: cy - size.h / 2, ...size });
  }
}

function round(b: Box): Box {
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) };
}

function warn(code: string, message: string, e: ElementDecl): Diagnostic {
  return { code, severity: "warning", message, span: e.span };
}
