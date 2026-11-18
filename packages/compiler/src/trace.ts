import type { Action, ElementDecl, Scene, Span, StateItem, VerbCall } from "@anim/dsl";
import type { Box } from "@anim/ir";
import { diffStates, isCollection, stateEvents } from "@anim/validate";

/**
 * A trace scene writes the data, not the motion: collections declared once, their whole contents after each
 * sentence. This turns those states into what the rest of the compiler already understands: one element per
 * cell (placed once, in a layout sized for the fullest state, so nothing ever jumps), pointer labels, and
 * actions (pop, lift, swap, move, set, tint) worked out from what changed between one state and the next.
 */

export interface TraceCanvas {
  width: number;
  height: number;
}

/** Room kept at the top for the scene's heading. */
const BAND = 110;
const GAP = 10;
const PTR_H = 48;
const MARK_COLOR = { "*": "accent", "+": "good", "~": "muted", "!": "warn" } as const;

/** Where the cells of one collection go. */
interface Geometry {
  kind: string;
  slot(i: number): Box;
  /** Under each slot, a number (arrays). */
  indexed: boolean;
  /** Pointers sit above the cell (rows) or to its right (piles, panels). */
  pointerAbove: boolean;
  caption?: Box;
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

function geometry(kind: string, frame: Frame, cap: number, captioned: boolean): Geometry {
  const top = captioned ? 56 : 0;
  const f: Frame = { x: frame.x, y: frame.y + top, w: frame.w, h: frame.h - top };
  const caption = captioned ? { x: frame.x, y: frame.y, w: frame.w, h: 48 } : undefined;
  if (kind === "stack") {
    const h = Math.min(96, (f.h * 0.8) / cap);
    const w = Math.min(280, f.w * 0.5);
    const x = f.x + (f.w - w) / 2;
    const bottom = f.y + f.h * 0.92;
    return { kind, indexed: false, pointerAbove: false, caption, slot: (i) => ({ x, y: r1(bottom - (i + 1) * (h + 8) + 8), w, h }) };
  }
  if (kind === "set") {
    const s = Math.min(110, (f.w - GAP * 5) / 6);
    const cols = Math.max(1, Math.floor((f.w + GAP) / (s + GAP)));
    return { kind, indexed: false, pointerAbove: false, caption, slot: (i) => ({ x: r1(f.x + (i % cols) * (s + GAP)), y: r1(f.y + Math.floor(i / cols) * (s + GAP)), w: s, h: s }) };
  }
  if (kind === "pairs") {
    const h = Math.min(64, f.h / Math.max(cap, 1) - 8);
    return { kind, indexed: false, pointerAbove: false, caption, slot: (i) => ({ x: f.x, y: r1(f.y + i * (h + 8)), w: Math.min(f.w, 520), h }) };
  }
  // row and queue: one line of square cells, centered, with room above for pointers and below for numbers.
  const s = Math.min(kind === "queue" ? 130 : 200, (f.w - GAP * (cap - 1)) / cap, f.h * 0.4);
  const total = cap * s + GAP * (cap - 1);
  const x0 = f.x + (f.w - total) / 2;
  const y = f.y + (f.h - s) / 2;
  return { kind, indexed: kind === "row", pointerAbove: true, caption, slot: (i) => ({ x: r1(x0 + i * (s + GAP)), y: r1(y), w: r1(s), h: r1(s) }) };
}

const display = (kind: string, it: StateItem): string => (kind === "pairs" && it.id ? `${it.id}: ${it.value}` : it.value);
const boxAttr = (b: Box): string => `${b.x},${b.y},${b.w},${b.h}`;

/** Where a pointer label goes for slot `i` (and how high, when several share a slot). */
function pointerBox(g: Geometry, i: number, level: number): Box {
  const s = g.slot(i);
  if (g.pointerAbove) return { x: r1(s.x + (s.w - 56) / 2), y: r1(s.y - PTR_H - level * PTR_H), w: 56, h: PTR_H };
  return { x: r1(s.x + s.w + 12 + level * 70), y: s.y, w: 64, h: Math.min(s.h, PTR_H + 10) };
}

interface Live {
  items: StateItem[];
  /** The element of the cell in each slot. */
  ids: string[];
  /** Pointer elements shown now: name → element and the slot it points at. */
  pointers: Map<string, { id: string; at: number }>;
  born: number;
  shown: boolean;
}

/** Turns a trace scene into ordinary elements and actions. Anything else comes back unchanged. */
export function expandTrace(scene: Scene, canvas: TraceCanvas): Scene {
  if (scene.attrs.template !== "trace") return scene;
  const decls = scene.steps.flatMap((s) => s.elements);
  const colls = decls.filter((e) => isCollection(e.kind));
  if (!colls.length) return scene;
  const events = stateEvents(scene);

  const cap = new Map<string, number>();
  for (const ev of events) cap.set(ev.coll, Math.max(cap.get(ev.coll) ?? 1, ev.snap.items.length));
  const place = frames(colls.length, canvas);
  const geo = new Map(colls.map((c, i) => [c.id, geometry(c.kind, place[i]!, cap.get(c.id) ?? 1, !!c.texts[0])]));
  const live = new Map<string, Live>(colls.map((c) => [c.id, { items: [], ids: [], pointers: new Map(), born: 0, shown: false }]));
  const kindOf = new Map(colls.map((c) => [c.id, c.kind]));

  const steps = scene.steps.map((step) => {
    const made: ElementDecl[] = [];
    const decl = (id: string, kind: "box" | "label", text: string, box: Box, span: Span): void => {
      made.push({ id, kind, texts: [text], attrs: { tbox: boxAttr(box) }, span });
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
        out.push(...states(coll, kindOf.get(coll)!, g, L, cap.get(coll) ?? 1, state, action, decl, colls.find((c) => c.id === coll)!));
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
  decl: (id: string, kind: "box" | "label", text: string, box: Box, span: Span) => void,
  collDecl: ElementDecl,
): Action[] {
  const next = call.state!.items;
  const prev = L.items;
  const span = call.span;
  const diff = diffStates(prev, next);
  const out: Action[] = [];
  const add = (verb: string, targets: string[], delay: number, duration: number | undefined, params: Record<string, string> = {}, stagger?: number): void => {
    out.push({
      anchor: action.anchor,
      span,
      calls: [{ verb, targets, span, args: { delay: r1(delay) === 0 ? undefined : r1(delay), ...(duration !== undefined && { duration }), ...(stagger !== undefined && { stagger }), params } }],
    });
  };
  const fresh = (): string => `${coll}__${++L.born}`;

  // Which element is in which slot now.
  const ids: string[] = Array(next.length).fill("");
  const marks = new Map<string, StateItem["mark"]>();
  prev.forEach((it, i) => marks.set(L.ids[i]!, it.mark));
  const moves: { id: string; from: number; to: number }[] = [];
  const sets: { id: string; text: string }[] = [];
  for (const k of diff.kept) {
    const id = L.ids[k.from]!;
    ids[k.to] = id;
    if (k.from !== k.to) moves.push({ id, from: k.from, to: k.to });
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
    decl(id, "box", display(kind, next[j]!), g.slot(j), span);
    return { id, slot: j };
  });

  // The first state puts the collection on stage: its caption and slot numbers come with it.
  if (!L.shown) {
    L.shown = true;
    if (g.caption && collDecl.texts[0]) {
      decl(`${coll}__cap`, "label", collDecl.texts[0], g.caption, span);
      add("fade", [`${coll}__cap`], 0, undefined);
    }
    if (g.indexed) {
      // Slot numbers for the row at its fullest, under each slot.
      const numbers = Array.from({ length: capacity }, (_, i) => `${coll}__i${i}`);
      numbers.forEach((id, i) => decl(id, "label", String(i), { ...g.slot(i), y: r1(g.slot(i).y + g.slot(i).h + 6), h: 44 }, span));
      add("fade", numbers, 0, 0.4, {}, 0.05);
    }
  }

  // Pointers: where each points now, higher when several share a slot.
  const levels = new Map<number, number>();
  const target = new Map<string, number>();
  for (const p of call.state!.pointers) {
    const at = /^-?\d+$/.test(p.at) ? Number(p.at) : Math.max(0, next.findIndex((it) => it.id === p.at));
    const level = levels.get(at) ?? 0;
    levels.set(at, level + 1);
    target.set(p.name, at);
    const box = pointerBox(g, at, level);
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

  // Structure: leaving cells, moving cells, new text, then arrivals.
  let t = 0.3;
  if (exits.length) add("lift", exits, t, 0.35);
  // Two cells trading places are one swap (arcs), anything else slides.
  const used = new Set<number>();
  moves.forEach((m, a) => {
    if (used.has(a)) return;
    const b = moves.findIndex((o, j) => j !== a && !used.has(j) && o.from === m.to && o.to === m.from);
    if (b >= 0) {
      used.add(a);
      used.add(b);
      add("swap", [m.id, moves[b]!.id], t, 0.6);
    }
  });
  moves.forEach((m, a) => {
    if (!used.has(a)) add("move", [m.id], t, 0.5, { dest: boxAttr(g.slot(m.to)) });
  });
  for (const s of sets) add("set", [s.id], t, 0.4, { to: s.text });
  if (moves.length) t += 0.6;
  else if (exits.length || sets.length) t += 0.35;
  // The very first state: everything arrives together (a short stagger), no waiting for pointers.
  const firstState = prev.length === 0;
  if (enters.length) add("pop", enters.map((e) => e.id), firstState ? 0.1 : t, 0.35, {}, 0.08);
  for (const e of enters) if (next[e.slot]!.mark) tint(e.id, next[e.slot]!.mark, (firstState ? 0.1 : t) + 0.45 + e.slot * 0.08);

  // Remember what is on stage for the next state.
  L.items = next.map((it) => ({ ...it }));
  L.ids = ids;
  return out;
}
