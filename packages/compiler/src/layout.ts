import type { Diagnostic, ElementDecl, Place, Scene } from "@anim/dsl";
import type { Box } from "@anim/ir";
import { findGridLayout, findTemplate, frameRects, GRID, slotRects, SLOTS, type AssetLibrary, type Rect, type TemplateManifest } from "@anim/registry";
import { gridMode, gridParts } from "@anim/validate";
import { fit, measure, type Size } from "./measure.js";

/**
 * The layout engine: the only place coordinates are decided. The DSL names
 * templates, slots and relations; this module turns them into boxes,
 * deterministically (same scene → same boxes).
 */

export const LayoutCodes = {
  Overflow: "NAR413",
  TextTooSmall: "NAR414",
  Overlap: "NAR415",
} as const;

export interface LayoutContext {
  width: number;
  height: number;
  assets: AssetLibrary;
}

export interface SceneLayout {
  boxes: Map<string, Box>;
  diagnostics: Diagnostic[];
  /** Destination box for `move <id> @place`. */
  destination(id: string, place: Place): Box | undefined;
}

const LINK_KINDS = new Set(["arrow", "line", "edge"]);
const GAP = 48;

export function layoutScene(scene: Scene, ctx: LayoutContext, kept: Map<string, Box> = new Map()): SceneLayout {
  return new SceneLayouter(scene, ctx, kept).run();
}

class SceneLayouter {
  private readonly boxes = new Map<string, Box>();
  private readonly scales = new Map<string, number>();
  private readonly sizes = new Map<string, Size>();
  private readonly diags: Diagnostic[] = [];
  private readonly els: ElementDecl[];
  private readonly byId: Map<string, ElementDecl>;
  private readonly safe: Box;

  constructor(
    private readonly scene: Scene,
    private readonly ctx: LayoutContext,
    private readonly kept: Map<string, Box>,
  ) {
    this.els = scene.steps.flatMap((s) => s.elements);
    this.byId = new Map(this.els.map((e) => [e.id, e]));
    for (const e of this.els) this.sizes.set(e.id, measure(e, ctx.assets));
    const mx = Math.round(ctx.width * 0.05);
    const my = Math.round(ctx.height * 0.067);
    this.safe = { x: mx, y: my, w: ctx.width - 2 * mx, h: ctx.height - 2 * my };
  }

  run(): SceneLayout {
    for (const [id, box] of this.kept) this.boxes.set(id, box);
    if (this.scene.attrs.grid !== undefined && findGridLayout(this.scene.attrs.grid)) {
      this.grid();
      for (const e of this.els) if (LINK_KINDS.has(e.kind) && e.link) this.connector(e);
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
    else this.layout(sceneLayout ?? (scenePool.length === 1 ? "center" : "row"), scenePool, area);

    // 3. Relative placements (may chain), 4. connectors.
    this.relatives();
    for (const e of this.els) if (LINK_KINDS.has(e.kind) && e.link) this.connector(e);

    this.checkOverlaps();
    return this.result();
  }

  private result(): SceneLayout {
    const self = this;
    return {
      boxes: this.boxes,
      diagnostics: this.diags,
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
  private put(e: ElementDecl, cell: Box, fill = 0.9): void {
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
        return els.forEach((e, i) => this.put(e, colCells(area, els.length)[i]!));
      case "grid":
        return els.forEach((e, i) => this.put(e, gridCells(area, els.length, this.ctx.width / this.ctx.height)[i]!));
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
        return els.forEach((e, i) => this.put(e, rowCells(area, els.length)[i]!));
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

    switch (tpl.name) {
      case "title": {
        const sub = slot("subtitle");
        const main = { x: area.x, y: area.y + area.h * 0.28, w: area.w, h: area.h * 0.28 };
        if (title) this.put(title, main, 0.95);
        if (sub) this.put(sub, { x: area.x, y: main.y + main.h, w: area.w, h: area.h * 0.16 }, 0.9);
        return this.layout("row", items, { x: area.x, y: area.y + area.h * 0.75, w: area.w, h: area.h * 0.25 });
      }
      case "compare": {
        const [l, r] = rowCells(content, 2, GAP * 2);
        const left = slot("left");
        const right = slot("right");
        if (left) this.put(left, l!, 0.85);
        if (right) this.put(right, r!, 0.85);
        return this.layout("row", items, { ...content, y: content.y + content.h * 0.8, h: content.h * 0.2 });
      }
      case "steps":
        return this.layout("row", items, content);
      case "grid":
        return this.layout("grid", items, content);
      case "timeline": {
        const cells = rowCells(content, items.length);
        const h = content.h * 0.42;
        return items.forEach((e, i) => {
          const c = cells[i]!;
          this.put(e, { x: c.x, y: i % 2 ? content.y + content.h - h : content.y, w: c.w, h });
        });
      }
      case "cycle":
      case "hub": {
        const mid = slot("center");
        return this.ring(items, content, mid);
      }
      case "spotlight": {
        const main = slot("main");
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
        return this.flow(pool, content);
      default:
        return this.layout("row", items, content);
    }
  }

  /** Items evenly on a circle (clockwise from the top), optional center element. */
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
  private flow(pool: ElementDecl[], area: Box): void {
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

    const topDown = layers.length <= 4;
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

export function rowCells(area: Box, n: number, gap = GAP): Box[] {
  const w = (area.w - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: area.x + i * (w + gap), y: area.y, w, h: area.h }));
}

export function colCells(area: Box, n: number, gap = GAP): Box[] {
  const h = (area.h - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: area.x, y: area.y + i * (h + gap), w: area.w, h }));
}

export function gridCells(area: Box, n: number, aspect: number): Box[] {
  const cols = Math.min(n, Math.ceil(Math.sqrt(n * aspect)));
  const rows = Math.ceil(n / cols);
  const rowsBoxes = colCells(area, rows);
  return Array.from({ length: n }, (_, i) => rowCells(rowsBoxes[Math.floor(i / cols)]!, cols)[i % cols]!);
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
