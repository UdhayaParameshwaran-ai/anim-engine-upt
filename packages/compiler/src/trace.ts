import type { Action, ElementDecl, Scene, Span, StateItem, StateSnapshot, VerbCall } from "@anim/dsl";
import type { Box } from "@anim/ir";
import { diffStates, isChainCollection, isCollection, isNodeCollection, parseCurve, stateEvents, topology, type Topology } from "@anim/validate";

/**
 * A trace scene writes the data, not the motion: collections declared once, their whole contents after each
 * sentence. This turns those states into what the rest of the compiler already understands: one element per
 * cell (placed once, in a layout sized for the fullest state, so nothing ever jumps), pointer labels, arrows
 * between linked cells, and actions (pop, lift, swap, move, set, tint, draw, hide) worked out from what changed
 * between one state and the next.
 */

export interface TraceCanvas {
  width: number;
  height: number;
}

/** Room kept at the top for the scene's heading. */
const BAND = 110;
const GAP = 10;
const PTR_H = 48;
const ARROW_GAP = 70;
const MARK_COLOR = { "*": "accent", "+": "good", "~": "muted", "!": "warn" } as const;

/** What a collection's states say about its size, gathered before anything is laid out. */
interface Extent {
  /** Most cells in any state. */
  cap: number;
  /** Longest text, in characters. */
  chars: number;
  /** Longest chain (chains and buckets). */
  maxLen: number;
  /** Most chains in any state. */
  rows: number;
  /** Smallest and largest x of a plot's points. */
  xmin: number;
  xmax: number;
  /** Lanes, in the order their names first appear, and the latest end time of any segment. */
  lanes: string[];
  tmax: number;
}

/** Where the cells of one collection go. */
interface Geometry {
  kind: string;
  /** Where item `i` of `snap` goes. */
  at(snap: StateSnapshot, i: number): Box;
  /** Under each slot, a number (arrays). */
  indexed: boolean;
  /** Pointers sit above the cell or to its right. */
  pointerAbove: boolean;
  caption?: Box;
  /** Chains: the cell at a row and position (also just past the end, for `null`). */
  cell?(row: number, pos: number): Box;
  /** Buckets: where a row's number goes. */
  rowLabel?(row: number): Box;
  rows?: number;
  /** Graphs and trees: what was declared. */
  topo?: Topology;
  /** A curve, axes or circle drawn once from hidden points: anchors, the segments joining them, and labels. */
  decor?: { anchors: Box[]; segments: [number, number][]; labels: { text: string; box: Box }[] };
  /** Plots: arrows join each point to the one before. */
  stepArrows?: boolean;
}

interface Frame extends Box {}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Every collection's frame: the first is the main picture, the others are panels in a right column. */
function frames(count: number, canvas: TraceCanvas): Frame[] {
  const mx = Math.round(canvas.width * 0.05);
  const my = Math.round(canvas.height * 0.067);
  const area: Box = { x: mx, y: my + BAND, w: canvas.width - 2 * mx, h: canvas.height - 2 * my - BAND };
  if (count <= 1) return [area];
  const mainW = Math.round(area.w * 0.6);
  const panelX = area.x + mainW + 40;
  const panelW = area.w - mainW - 40;
  const panels = count - 1;
  const gap = 30;
  const h = (area.h - gap * (panels - 1)) / panels;
  return [{ x: area.x, y: area.y, w: mainW, h: area.h }, ...Array.from({ length: panels }, (_, i) => ({ x: panelX, y: area.y + i * (h + gap), w: panelW, h }))];
}

/** How wide a cell must be for a text of `chars` characters (at the cell font), within [lo, hi]. */
const wide = (chars: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, chars * 24 + 36));

/** The row and position of item `i` in its chain. */
function chainPlace(kind: string, snap: StateSnapshot, i: number): { row: number; pos: number } {
  const c = snap.items[i]?.chain ?? 0;
  let pos = 0;
  for (let j = 0; j < i; j++) if ((snap.items[j]!.chain ?? 0) === c) pos++;
  const label = snap.chains?.[c]?.label;
  const row = kind === "buckets" && label !== undefined && /^\d+$/.test(label) ? Number(label) : c;
  return { row, pos };
}

/** Positions for the nodes of a tree (parents over their children) or a graph (layers by distance from the first node). */
function layoutNodes(kind: string, topo: Topology, f: Frame): Map<string, Box> {
  const out = new Map<string, Box>();
  const names = topo.nodes;
  if (!names.length) return out;
  if (kind === "net" && topo.layers) {
    const cols = topo.layers.length;
    const widest = Math.max(...topo.layers.map((l) => l.length));
    const d = Math.min(96, (f.w * 0.8) / cols, (f.h * 0.85) / widest);
    topo.layers.forEach((l, li) => l.forEach((n, k) => out.set(n, { x: r1(f.x + ((li + 0.5) * f.w) / cols - d / 2), y: r1(f.y + ((k + 0.5) * f.h) / l.length - d / 2), w: r1(d), h: r1(d) })));
    return out;
  }
  if (kind === "tree") {
    const kids = new Map<string, string[]>(names.map((n) => [n, []]));
    const hasParent = new Set<string>();
    for (const e of topo.edges) {
      kids.get(e.from)!.push(e.to);
      hasParent.add(e.to);
    }
    const roots = names.filter((n) => !hasParent.has(n));
    let leaf = 0;
    let depthMax = 0;
    const at = new Map<string, { x: number; depth: number }>();
    const place = (n: string, depth: number): number => {
      depthMax = Math.max(depthMax, depth);
      const c = (kids.get(n) ?? []).filter((k) => !at.has(k));
      let x: number;
      if (!c.length) x = leaf++;
      else {
        const xs = c.map((k) => place(k, depth + 1));
        x = xs.reduce((a, b) => a + b, 0) / xs.length;
      }
      at.set(n, { x, depth });
      return x;
    };
    for (const r of roots.length ? roots : [names[0]!]) place(r, 0);
    for (const n of names) if (!at.has(n)) at.set(n, { x: leaf++, depth: 0 });
    const d = Math.min(104, (f.w * 0.86) / Math.max(leaf, 1), (f.h * 0.8) / (depthMax + 1));
    for (const [n, p] of at) {
      out.set(n, { x: r1(f.x + ((p.x + 0.5) * f.w) / Math.max(leaf, 1) - d / 2), y: r1(f.y + ((p.depth + 0.5) * f.h) / (depthMax + 1) - d / 2), w: r1(d), h: r1(d) });
    }
    return out;
  }
  // Graph: BFS layers from the first node, left to right.
  const adj = new Map<string, string[]>(names.map((n) => [n, []]));
  for (const e of topo.edges) {
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const layer = new Map<string, number>();
  const order: string[][] = [];
  for (const start of names) {
    if (layer.has(start)) continue;
    let level = order.length;
    layer.set(start, level);
    let frontier = [start];
    while (frontier.length) {
      (order[level] ??= []).push(...frontier);
      const next: string[] = [];
      for (const n of frontier) for (const m of adj.get(n)!) if (!layer.has(m)) (layer.set(m, level + 1), next.push(m));
      frontier = next;
      level++;
    }
  }
  const widest = Math.max(...order.map((l) => l?.length ?? 0), 1);
  const d = Math.min(104, (f.w * 0.8) / order.length, (f.h * 0.85) / widest);
  order.forEach((col, li) => {
    (col ?? []).forEach((n, k) => {
      out.set(n, { x: r1(f.x + ((li + 0.5) * f.w) / order.length - d / 2), y: r1(f.y + ((k + 0.5) * f.h) / (col ?? []).length - d / 2), w: r1(d), h: r1(d) });
    });
  });
  return out;
}

function geometry(kind: string, frame: Frame, ext: Extent, captioned: boolean, decl: ElementDecl): Geometry {
  const { cap, chars } = ext;
  const top = captioned ? 56 : 0;
  const f: Frame = { x: frame.x, y: frame.y + top, w: frame.w, h: frame.h - top };
  const caption = captioned ? { x: frame.x, y: frame.y, w: frame.w, h: 48 } : undefined;
  if (isNodeCollection(kind)) {
    const topo = topology(kind, decl.texts[0] ?? "");
    const boxes = layoutNodes(kind, topo, f);
    return { kind, indexed: false, pointerAbove: true, caption, topo, at: (snap, i) => boxes.get(snap.items[i]?.id ?? snap.items[i]?.value ?? "") ?? { x: f.x, y: f.y, w: 80, h: 80 } };
  }
  if (kind === "plot") {
    const f2: Frame = { x: f.x + 70, y: f.y + 10, w: f.w - 90, h: f.h - 70 };
    const curve = parseCurve(decl.texts[0] ?? "") ?? ((x: number) => x);
    const x0 = Number.isFinite(Number(decl.attrs.from)) && decl.attrs.from !== undefined ? Number(decl.attrs.from) : Math.min(0, Number.isFinite(ext.xmin) ? ext.xmin - 1 : 0);
    const x1 = Number.isFinite(Number(decl.attrs.to)) && decl.attrs.to !== undefined ? Number(decl.attrs.to) : (Number.isFinite(ext.xmax) ? ext.xmax + 1 : 10);
    const N = 40;
    const xs = Array.from({ length: N + 1 }, (_, k) => x0 + ((x1 - x0) * k) / N);
    const ys = xs.map(curve).map((y) => (Number.isFinite(y) ? y : NaN));
    const finite = ys.filter((y) => Number.isFinite(y));
    const y0 = Math.min(...finite, 0);
    const y1 = Math.max(...finite, y0 + 1);
    const px = (x: number) => f2.x + ((x - x0) / (x1 - x0 || 1)) * f2.w;
    const py = (y: number) => f2.y + f2.h - ((y - y0) / (y1 - y0 || 1)) * f2.h;
    const pt = (x: number, size: number): Box => ({ x: r1(px(x) - size / 2), y: r1(py(curve(x)) - size / 2), w: size, h: size });
    const anchors: Box[] = [];
    const segments: [number, number][] = [];
    xs.forEach((x, k) => {
      anchors.push({ x: r1(px(x)), y: r1(py(Number.isFinite(ys[k]!) ? ys[k]! : y0)), w: 2, h: 2 });
      if (k > 0 && Number.isFinite(ys[k]!) && Number.isFinite(ys[k - 1]!)) segments.push([k - 1, k]);
    });
    // Axes along the bottom and left edges of the plot.
    const base = anchors.length;
    anchors.push({ x: r1(f2.x), y: r1(f2.y + f2.h), w: 2, h: 2 }, { x: r1(f2.x + f2.w), y: r1(f2.y + f2.h), w: 2, h: 2 }, { x: r1(f2.x), y: r1(f2.y), w: 2, h: 2 });
    segments.push([base, base + 1], [base, base + 2]);
    const fmt = (v: number) => String(Math.round(v * 100) / 100);
    const labels = [
      { text: fmt(x0), box: { x: r1(f2.x - 30), y: r1(f2.y + f2.h + 8), w: 60, h: 40 } },
      { text: fmt(x1), box: { x: r1(f2.x + f2.w - 30), y: r1(f2.y + f2.h + 8), w: 60, h: 40 } },
    ];
    return { kind, indexed: false, pointerAbove: true, caption, decor: { anchors, segments, labels }, stepArrows: true, at: (snap, i) => pt(Number(snap.items[i]?.value ?? x0), 56) };
  }
  if (kind === "ring") {
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    const R = Math.min(f.w, f.h) * 0.36;
    const spot = (deg: number, size: number): Box => {
      const a = (deg * Math.PI) / 180;
      return { x: r1(cx + R * Math.sin(a) - size / 2), y: r1(cy - R * Math.cos(a) - size / 2), w: size, h: size };
    };
    const anchors: Box[] = Array.from({ length: 48 }, (_, k) => spot((k * 360) / 48, 2));
    const segments: [number, number][] = anchors.map((_, k) => [k, (k + 1) % 48] as [number, number]);
    return { kind, indexed: false, pointerAbove: true, caption, decor: { anchors, segments, labels: [] }, at: (snap, i) => spot(Number(snap.items[i]?.value ?? 0), 84) };
  }
  if (kind === "heap") {
    // Slot i sits where a complete binary tree puts it: row floor(log2(i+1)), spread across that row.
    const levels = Math.max(1, Math.ceil(Math.log2(cap + 1)));
    const d = Math.min(100, (f.w * 0.9) / 2 ** (levels - 1) / 1.15, (f.h * 0.8) / levels);
    const slot = (i: number): Box => {
      const level = Math.floor(Math.log2(i + 1));
      const k = i + 1 - 2 ** level;
      return { x: r1(f.x + ((k + 0.5) * f.w) / 2 ** level - d / 2), y: r1(f.y + ((level + 0.5) * f.h) / levels - d / 2), w: r1(d), h: r1(d) };
    };
    return { kind, indexed: false, pointerAbove: true, caption, at: (_s, i) => slot(Math.max(0, i)) };
  }
  if (kind === "lanes") {
    const names = ext.lanes.length ? ext.lanes : [""];
    const labelW = names.some((n) => n) ? 190 : 0;
    const plot: Frame = { x: f.x + labelW, y: f.y + 10, w: f.w - labelW - 20, h: f.h - 80 };
    const T = Number.isFinite(Number(decl.attrs.to)) && decl.attrs.to !== undefined ? Number(decl.attrs.to) : Math.max(ext.tmax, 1);
    const rowH = Math.min(120, plot.h / names.length);
    const h = Math.min(70, rowH * 0.62);
    const seg = (lane: number, start: number, end: number): Box => ({ x: r1(plot.x + (start / T) * plot.w), y: r1(plot.y + lane * rowH + (rowH - h) / 2), w: r1(Math.max(((end - start) / T) * plot.w, 24)), h: r1(h) });
    const lane = (snap: StateSnapshot, i: number): number => {
      const c = snap.items[i]?.chain ?? 0;
      const label = snap.chains?.[c]?.label ?? (c === 0 ? "" : `lane ${c}`);
      return Math.max(0, names.indexOf(label));
    };
    const anchors: Box[] = [{ x: r1(plot.x), y: r1(plot.y + names.length * rowH + 6), w: 2, h: 2 }, { x: r1(plot.x + plot.w), y: r1(plot.y + names.length * rowH + 6), w: 2, h: 2 }];
    const segments: [number, number][] = [[0, 1]];
    const fmt = (v: number) => `${Math.round(v * 10) / 10}s`;
    const labels = [
      { text: "0s", box: { x: r1(plot.x - 30), y: r1(plot.y + names.length * rowH + 14), w: 60, h: 40 } },
      { text: fmt(T), box: { x: r1(plot.x + plot.w - 30), y: r1(plot.y + names.length * rowH + 14), w: 60, h: 40 } },
      ...names.map((n, k) => ({ text: n, box: { x: r1(f.x), y: r1(plot.y + k * rowH + (rowH - 44) / 2), w: labelW - 12, h: 44 } })).filter((l) => l.text),
    ];
    return { kind, indexed: false, pointerAbove: true, caption, decor: { anchors, segments, labels }, at: (snap, i) => { const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(snap.items[i]?.value ?? ""); return seg(lane(snap, i), Number(m?.[1] ?? 0), Number(m?.[2] ?? 1)); } };
  }
  if (isChainCollection(kind)) {
    const n = Math.max(2, Math.min(8, Number(decl.attrs.n ?? 5)));
    const rows = kind === "buckets" ? n : Math.max(1, ext.rows);
    const labelW = kind === "buckets" ? 80 : 0;
    const nullW = kind === "chain" ? 110 : 0;
    const len = Math.max(1, ext.maxLen);
    const w = Math.min(wide(chars, 90, 170), (f.w - labelW - nullW - ARROW_GAP * len) / (len + (kind === "chain" ? 0 : 0)));
    const h = Math.min(Math.max(48, w * 0.7), f.h / rows - (kind === "buckets" ? 14 : 60), 110);
    const rowH = Math.min(f.h / rows, h + 56);
    const y0 = f.y + (f.h - rows * rowH) / 2;
    const cell = (row: number, pos: number): Box => ({ x: r1(f.x + labelW + pos * (w + ARROW_GAP)), y: r1(y0 + row * rowH + (rowH - h) / 2), w: r1(w), h: r1(h) });
    return {
      kind,
      indexed: false,
      pointerAbove: true,
      caption,
      rows,
      cell,
      rowLabel: (row) => ({ x: f.x, y: cell(row, 0).y, w: 64, h: cell(row, 0).h }),
      at: (snap, i) => {
        const p = chainPlace(kind, snap, i);
        return cell(p.row, p.pos);
      },
    };
  }
  if (kind === "stack") {
    const h = Math.min(96, (f.h * 0.8) / cap);
    const w = Math.min(wide(chars, 200, 380), f.w * 0.9);
    const x = f.x + (f.w - w) / 2;
    const bottom = f.y + f.h * 0.92;
    return { kind, indexed: false, pointerAbove: false, caption, at: (_s, i) => ({ x, y: r1(bottom - (i + 1) * (h + 8) + 8), w, h }) };
  }
  if (kind === "set") {
    const w = Math.min(wide(chars, 72, 240), f.w);
    const h = 72;
    const cols = Math.max(1, Math.floor((f.w + GAP) / (w + GAP)));
    return { kind, indexed: false, pointerAbove: false, caption, at: (_s, i) => ({ x: r1(f.x + (i % cols) * (w + GAP)), y: r1(f.y + Math.floor(i / cols) * (h + GAP)), w, h }) };
  }
  if (kind === "pairs") {
    const h = Math.min(72, f.h / Math.max(cap, 1) - 8);
    const w = Math.min(wide(chars, 240, 560), f.w);
    return { kind, indexed: false, pointerAbove: false, caption, at: (_s, i) => ({ x: f.x, y: r1(f.y + i * (h + 8)), w, h }) };
  }
  // row and queue: one line of square cells, centered, with room above for pointers and below for numbers.
  // Wider than tall when the values are long, as far as the frame allows.
  const h = Math.min(kind === "queue" ? 130 : 200, f.h * 0.4);
  const w = Math.min(Math.max(h, wide(chars, h, 320)), (f.w - GAP * (cap - 1)) / cap);
  const hh = Math.min(h, Math.max(w, 72));
  const total = cap * w + GAP * (cap - 1);
  const x0 = f.x + (f.w - total) / 2;
  const y = f.y + (f.h - hh) / 2;
  return { kind, indexed: kind === "row", pointerAbove: true, caption, at: (_s, i) => ({ x: r1(x0 + i * (w + GAP)), y: r1(y), w: r1(w), h: r1(hh) }) };
}

/** A cell's text: a key and its value (`A: 4`) in tables and nodes, the value alone elsewhere. */
const display = (kind: string, it: StateItem): string => (kind === "lanes" ? (it.id ?? it.value) : kind === "ring" ? (it.id ?? it.value) : (kind === "pairs" || isNodeCollection(kind)) && it.id ? `${it.id}: ${it.value}` : it.value);
const boxAttr = (b: Box): string => `${b.x},${b.y},${b.w},${b.h}`;

/** Where a pointer label goes for item `i` (and how high, when several share one). */
function pointerBox(g: Geometry, snap: StateSnapshot, i: number, level: number): Box {
  const s = g.at(snap, Math.max(0, Math.min(i, Math.max(0, snap.items.length - 1))));
  // A slot just outside the data (-1, or one past the end) keeps its place in a row.
  const shift = i < 0 ? -1 : i >= snap.items.length ? i - Math.max(0, snap.items.length - 1) : 0;
  const step = s.w + (isChainCollection(g.kind) ? ARROW_GAP : GAP);
  const sx = s.x + shift * (g.kind === "row" || g.kind === "queue" || isChainCollection(g.kind) ? step : 0);
  if (g.pointerAbove) return { x: r1(sx + (s.w - 56) / 2), y: r1(s.y - PTR_H - 8 - level * PTR_H), w: 56, h: PTR_H };
  return { x: r1(s.x + s.w + 12 + level * 70), y: s.y, w: 64, h: Math.min(s.h, PTR_H + 10) };
}

interface Live {
  items: StateItem[];
  chains?: StateSnapshot["chains"];
  /** The element of the cell in each item's place. */
  ids: string[];
  /** Pointer elements shown now: name → element and the slot it points at. */
  pointers: Map<string, { id: string; at: number }>;
  /** Arrow elements by the cells they join, and which are on stage now. */
  arrowIds: Map<string, string>;
  arrowsOn: Set<string>;
  nullAt?: number;
  decorMade?: boolean;
  /** Heap places that have their hidden anchor. */
  anchors: Set<number>;
  born: number;
  arrowsMade: number;
  shown: boolean;
}

type Decl = (id: string, kind: "box" | "circle" | "label", text: string, box: Box, span: Span) => void;
type DeclLink = (id: string, kind: "arrow" | "line", from: string, to: string, text: string | undefined, span: Span) => void;

/** Turns a trace scene into ordinary elements and actions. Anything else comes back unchanged. */
export function expandTrace(scene: Scene, canvas: TraceCanvas): Scene {
  if (scene.attrs.template !== "trace") return scene;
  const decls = scene.steps.flatMap((s) => s.elements);
  const colls = decls.filter((e) => isCollection(e.kind));
  if (!colls.length) return scene;
  const events = stateEvents(scene);

  const extent = new Map<string, Extent>(colls.map((c) => [c.id, { cap: 1, chars: 1, maxLen: 1, rows: 1, xmin: Infinity, xmax: -Infinity, lanes: [], tmax: 0 }]));
  for (const ev of events) {
    const x = extent.get(ev.coll);
    const kind = colls.find((c) => c.id === ev.coll)?.kind ?? "row";
    if (!x) continue;
    x.cap = Math.max(x.cap, ev.snap.items.length);
    x.chars = Math.max(x.chars, ...ev.snap.items.map((it) => display(kind, it).length));
    const perChain = new Map<number, number>();
    for (const it of ev.snap.items) perChain.set(it.chain ?? 0, (perChain.get(it.chain ?? 0) ?? 0) + 1);
    x.maxLen = Math.max(x.maxLen, ...perChain.values());
    x.rows = Math.max(x.rows, ev.snap.chains?.length ?? 1);
    if (kind === "lanes") {
      (ev.snap.chains ?? [{}]).forEach((c, k) => {
        const name = c.label ?? (k === 0 ? "" : `lane ${k}`);
        if (ev.snap.items.some((it) => (it.chain ?? 0) === k) && !x.lanes.includes(name)) x.lanes.push(name);
      });
      for (const it of ev.snap.items) x.tmax = Math.max(x.tmax, Number(/-(\d+(?:\.\d+)?)$/.exec(it.value)?.[1] ?? 0));
    }
    for (const it of ev.snap.items) {
      const v = Number(it.value);
      if (Number.isFinite(v)) (x.xmin = Math.min(x.xmin, v), (x.xmax = Math.max(x.xmax, v)));
    }
  }
  const place = frames(colls.length, canvas);
  const geo = new Map(colls.map((c, i) => [c.id, geometry(c.kind, place[i]!, extent.get(c.id)!, !!(isNodeCollection(c.kind) ? c.texts[1] : c.texts[0]), c)]));
  const live = new Map<string, Live>(colls.map((c) => [c.id, { items: [], ids: [], pointers: new Map(), arrowIds: new Map(), arrowsOn: new Set(), anchors: new Set(), born: 0, arrowsMade: 0, shown: false }]));
  const kindOf = new Map(colls.map((c) => [c.id, c.kind]));

  const steps = scene.steps.map((step) => {
    const made: ElementDecl[] = [];
    const decl: Decl = (id, kind, text, box, span) => {
      made.push({ id, kind, texts: [text], attrs: { tbox: boxAttr(box) }, span });
    };
    const declLink: DeclLink = (id, kind, from, to, text, span) => {
      made.push({ id, kind, texts: text !== undefined ? [text] : [], link: { from, to }, attrs: {}, span });
    };
    const beats = step.beats.map((beat) => {
      const rank = (a: Action): number => (a.anchor === "start" ? -1 : a.anchor === "end" ? Infinity : beat.type === "speech" ? (beat.cues.find((c) => c.id === a.anchor)?.start ?? Infinity) : Infinity);
      const out: Action[] = [];
      for (const action of [...beat.actions].sort((a, b) => rank(a) - rank(b))) {
        const state = action.calls[0]?.state && action.calls[0].verb === "state" ? action.calls[0] : undefined;
        if (!state) {
          // A verb aimed at a whole collection (highlight, pulse, frame) reaches the cells it holds right now.
          const calls = action.calls.map((c) => ({ ...c, targets: c.targets.flatMap((t) => (live.has(t) ? live.get(t)!.ids : [t])) })).filter((c) => c.targets.length);
          if (calls.length) out.push({ ...action, calls });
          continue;
        }
        const coll = state.targets[0]!;
        const g = geo.get(coll);
        const L = live.get(coll);
        if (!g || !L) continue;
        out.push(...states(coll, kindOf.get(coll)!, g, L, extent.get(coll)!.cap, state, action, decl, declLink, colls.find((c) => c.id === coll)!));
      }
      return { ...beat, actions: out };
    });
    return { ...step, elements: [...step.elements.filter((e) => !isCollection(e.kind)), ...made], beats };
  });
  return { ...scene, steps };
}

/** The actions that take one collection from its last state to this one. */
function states(
  coll: string,
  kind: string,
  g: Geometry,
  L: Live,
  capacity: number,
  call: VerbCall,
  action: Action,
  decl: Decl,
  declLink: DeclLink,
  collDecl: ElementDecl,
): Action[] {
  const snap = call.state!;
  const next = snap.items;
  const prev = L.items;
  const span = call.span;
  const byName = isNodeCollection(kind);
  const diff = diffStates(prev, next, byName);
  const out: Action[] = [];
  const add = (verb: string, targets: string[], delay: number, duration: number | undefined, params: Record<string, string> = {}, stagger?: number): void => {
    out.push({
      anchor: action.anchor,
      span,
      calls: [{ verb, targets, span, args: { delay: r1(delay) === 0 ? undefined : r1(delay), ...(duration !== undefined && { duration }), ...(stagger !== undefined && { stagger }), params } }],
    });
  };
  const fresh = (): string => `${coll}__${++L.born}`;
  const prevSnap: StateSnapshot = { items: prev, ...(L.chains && { chains: L.chains }), pointers: [] };

  // Which element is in which slot now.
  const ids: string[] = Array(next.length).fill("");
  const moves: { id: string; from: number; to: number }[] = [];
  const sets: { id: string; text: string }[] = [];
  for (const k of diff.kept) {
    const id = L.ids[k.from]!;
    ids[k.to] = id;
    // A cell moves when its place changes: its slot, or (chains) its row or position.
    const was = g.at(prevSnap, k.from);
    const now = g.at(snap, k.to);
    if (was.x !== now.x || was.y !== now.y) moves.push({ id, from: k.from, to: k.to });
    if (display(kind, prev[k.from]!) !== display(kind, next[k.to]!)) sets.push({ id, text: display(kind, next[k.to]!) });
  }
  for (const c of diff.changed) {
    const id = L.ids[c.from]!;
    ids[c.to] = id;
    sets.push({ id, text: display(kind, next[c.to]!) });
  }
  const exits = diff.exited.map((i) => L.ids[i]!);
  const enters = diff.entered.map((j) => {
    const id = fresh();
    ids[j] = id;
    decl(id, byName || kind === "heap" || kind === "plot" || kind === "ring" ? "circle" : "box", display(kind, next[j]!), g.at(snap, j), span);
    return { id, slot: j };
  });

  // The first state puts the collection on stage: its caption, slot numbers, row numbers and null come with it.
  if (!L.shown) {
    L.shown = true;
    const caption = isNodeCollection(kind) ? collDecl.texts[1] : collDecl.texts[0];
    if (g.caption && caption) {
      decl(`${coll}__cap`, "label", caption, g.caption, span);
      add("fade", [`${coll}__cap`], 0, undefined);
    }
    if (g.indexed) {
      const numbers = Array.from({ length: capacity }, (_, i) => `${coll}__i${i}`);
      numbers.forEach((id, i) => decl(id, "label", String(i), { ...g.at(snap, i), y: r1(g.at(snap, i).y + g.at(snap, i).h + 6), h: 44 }, span));
      add("fade", numbers, 0, 0.4, {}, 0.05);
    }
    if (kind === "buckets" && g.rowLabel) {
      const labels = Array.from({ length: g.rows ?? 0 }, (_, r) => `${coll}__b${r}`);
      labels.forEach((id, r) => decl(id, "label", String(r), g.rowLabel!(r), span));
      add("fade", labels, 0, 0.4, {}, 0.05);
    }
  }
  // A curve, axes or circle outline: drawn once from hidden points, left to right.
  if (g.decor && !L.decorMade) {
    L.decorMade = true;
    const d = g.decor;
    d.anchors.forEach((box, k) => decl(`${coll}__d${k}`, "box", "", box, span));
    const lines: string[] = [];
    d.segments.forEach(([a, b], k) => {
      const id = `${coll}__l${k}`;
      declLink(id, "line", `${coll}__d${a}`, `${coll}__d${b}`, undefined, span);
      lines.push(id);
    });
    if (lines.length) add("draw", lines, 0, 0.5, {}, 0.02);
    d.labels.forEach((l, k) => decl(`${coll}__t${k}`, "label", l.text, l.box, span));
    if (d.labels.length) add("fade", d.labels.map((_, k) => `${coll}__t${k}`), 0, 0.4);
  }
  // A linked list ends in null, just past its last node.
  if (kind === "chain" && g.cell) {
    const length = next.filter((it) => (it.chain ?? 0) === 0).length;
    const box = { ...g.cell(0, length), w: 90 };
    if (L.nullAt === undefined) {
      decl(`${coll}__null`, "label", "null", box, span);
      add("pop", [`${coll}__null`], 0.2, 0.3);
    } else if (L.nullAt !== length) add("move", [`${coll}__null`], 0.3, 0.5, { dest: boxAttr(box) });
    L.nullAt = length;
  }

  // Pointers: where each points now, higher when several share a slot.
  const levels = new Map<number, number>();
  const target = new Map<string, number>();
  for (const p of snap.pointers) {
    const named = next.findIndex((it) => (byName ? (it.id ?? it.value) : it.id) === p.at);
    const at = /^-?\d+$/.test(p.at) ? Number(p.at) : Math.max(0, named);
    const level = levels.get(at) ?? 0;
    levels.set(at, level + 1);
    target.set(p.name, at);
    const box = pointerBox(g, snap, at, level);
    const known = L.pointers.get(p.name);
    if (!known) {
      const id = `${coll}__p_${p.name}`;
      decl(id, "label", p.name, box, span);
      L.pointers.set(p.name, { id, at });
      add("pop", [id], 0, 0.3);
    } else if (known.at !== at) {
      known.at = at;
      add("move", [known.id], 0, 0.35, { dest: boxAttr(box) });
    }
  }
  for (const [name, p] of [...L.pointers]) {
    if (target.has(name)) continue;
    L.pointers.delete(name);
    add("hide", [p.id], 0, 0.25);
  }

  // Marks change on the cells that stay (a cell that arrives is marked once it is there).
  const tint = (id: string, mark: StateItem["mark"], delay: number): void => {
    if (mark) add("tint", [id], delay, 0.25, { to: "1", color: MARK_COLOR[mark] });
    else add("tint", [id], delay, 0.25, { to: "0" });
  };
  for (const k of diff.kept) {
    const was = prev[k.from]!.mark;
    const now = next[k.to]!.mark;
    if (was !== now) tint(ids[k.to]!, now, 0);
  }
  for (const c of diff.changed) if (prev[c.from]!.mark !== next[c.to]!.mark) tint(ids[c.to]!, next[c.to]!.mark, 0.3);

  // Arrows between cells: neighbours in a chain, extra links, or the edges of a graph or tree whose ends are both shown.
  const want = new Map<string, { from: string; to: string; text?: string; kind: "arrow" | "line" }>();
  // A heap's edges join fixed places in the tree (hidden anchors), not the values sitting there: a swap must not redraw them.
  if (kind === "heap") {
    const anchor = (i: number): string => {
      const id = `${coll}__s${i}`;
      if (!L.anchors.has(i)) {
        L.anchors.add(i);
        decl(id, "box", "", g.at(snap, i), span);
      }
      return id;
    };
    for (let i = 1; i < next.length; i++) want.set(`${anchor((i - 1) >> 1)}>${anchor(i)}`, { from: anchor((i - 1) >> 1), to: anchor(i), kind: "arrow" });
  }
  const want1 = (from: number, to: number, text?: string): void => {
    const f = ids[from];
    const t = ids[to];
    if (f && t) want.set(`${f}>${t}`, { from: f, to: t, kind: byName && kind === "graph" ? "line" : "arrow", ...(text !== undefined && { text }) });
  };
  if (isChainCollection(kind)) {
    const last = new Map<number, number>();
    next.forEach((it, i) => {
      const c = it.chain ?? 0;
      if (last.has(c)) want1(last.get(c)!, i);
      last.set(c, i);
    });
    for (const l of snap.links ?? []) want1(next.findIndex((it) => it.id === l.from), next.findIndex((it) => it.id === l.to));
  } else if (g.stepArrows) {
    for (let i = 1; i < next.length; i++) want1(i - 1, i);
  } else if (kind === "ring") {
    for (const l of snap.links ?? []) want1(next.findIndex((it) => it.id === l.from), next.findIndex((it) => it.id === l.to));
  } else if (byName && g.topo) {
    const at = new Map(next.map((it, i) => [it.id ?? it.value, i]));
    for (const e of g.topo.edges) if (at.has(e.from) && at.has(e.to)) want1(at.get(e.from)!, at.get(e.to)!, e.weight);
  }
  const gone = [...L.arrowsOn].filter((k) => !want.has(k));
  const fresh1 = [...want.keys()].filter((k) => !L.arrowsOn.has(k));

  // Structure: leaving cells and their arrows, moving cells, new text, then arrivals and new arrows.
  let t = 0.3;
  const hideIds = [...exits, ...gone.map((k) => L.arrowIds.get(k)!)];
  if (hideIds.length) {
    if (exits.length) add("lift", exits, t, 0.35);
    const arrowsOut = gone.map((k) => L.arrowIds.get(k)!);
    if (arrowsOut.length) add("hide", arrowsOut, t, 0.3);
  }
  // Two cells trading places are one swap (arcs), anything else slides.
  const used = new Set<number>();
  moves.forEach((m, a) => {
    if (used.has(a)) return;
    // Only when each lands exactly where the other stood (in chains, slot numbers alone say nothing).
    const sameBox = (x: Box, y: Box) => x.x === y.x && x.y === y.y;
    const b = moves.findIndex((o, j) => j !== a && !used.has(j) && o.from === m.to && o.to === m.from && sameBox(g.at(snap, m.to), g.at(prevSnap, o.from)) && sameBox(g.at(snap, o.to), g.at(prevSnap, m.from)));
    if (b >= 0) {
      used.add(a);
      used.add(b);
      add("swap", [m.id, moves[b]!.id], t, 0.6);
    }
  });
  moves.forEach((m, a) => {
    if (!used.has(a)) add("move", [m.id], t, 0.5, { dest: boxAttr(g.at(snap, m.to)) });
  });
  for (const s of sets) add("set", [s.id], t, 0.4, { to: s.text });
  if (moves.length) t += 0.6;
  else if (hideIds.length || sets.length) t += 0.35;
  // The very first state: everything arrives together (a short stagger), no waiting for pointers.
  const firstState = prev.length === 0;
  const tEnter = firstState ? 0.1 : t;
  if (enters.length) add("pop", enters.map((e) => e.id), tEnter, 0.35, {}, 0.08);
  for (const e of enters) if (next[e.slot]!.mark) tint(e.id, next[e.slot]!.mark, tEnter + 0.45 + e.slot * 0.08);
  // New arrows are drawn once their cells are there.
  const tArrow = enters.length ? tEnter + 0.4 + enters.length * 0.08 : t;
  const drawn: string[] = [];
  for (const k of fresh1) {
    let id = L.arrowIds.get(k);
    if (!id) {
      const a = want.get(k)!;
      id = `${coll}__a${++L.arrowsMade}`;
      L.arrowIds.set(k, id);
      declLink(id, a.kind, a.from, a.to, a.text, span);
    }
    drawn.push(id);
  }
  if (drawn.length) add("draw", drawn, tArrow, 0.45, {}, 0.1);
  L.arrowsOn = new Set(want.keys());

  // Remember what is on stage for the next state.
  L.items = next.map((it) => ({ ...it }));
  L.chains = snap.chains;
  L.ids = ids;
  return out;
}
