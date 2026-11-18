import type { Action, Beat, Scene, Span, StateItem, StateSnapshot, VerbCall } from "@anim/dsl";
import { COLLECTIONS } from "@anim/registry";

/**
 * Trace scenes: collections declared once, their whole contents written after each sentence (state lines).
 * Everything about what a state line means lives here, so the validator (does it hold together, is it true)
 * and the compiler (what changed, so what moves) read states the same way.
 */

export const isCollection = (kind: string): boolean => (COLLECTIONS as readonly string[]).includes(kind);

/** Collections whose items are nodes of a drawn graph or tree, known by name. */
export const isNodeCollection = (kind: string): boolean => kind === "graph" || kind === "tree";
/** Collections laid out as chains of nodes with arrows between neighbours. */
export const isChainCollection = (kind: string): boolean => kind === "chain" || kind === "buckets";

export interface Topology {
  nodes: string[];
  edges: { from: string; to: string; weight?: string }[];
  /** Tokens that are not edges. */
  bad: string[];
}

/** The nodes and edges of a graph (`A-B A-C:4`) or a tree (`R>A R>B`), nodes in order of first appearance. */
export function topology(kind: string, text: string): Topology {
  const nodes: string[] = [];
  const edges: Topology["edges"] = [];
  const bad: string[] = [];
  const sep = kind === "tree" ? ">" : "-";
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    const m = new RegExp("^(\\w+)" + sep + "(\\w+)(?::(\\S+))?$").exec(tok);
    if (!m) {
      bad.push(tok);
      continue;
    }
    for (const n of [m[1]!, m[2]!]) if (!nodes.includes(n)) nodes.push(n);
    edges.push({ from: m[1]!, to: m[2]!, ...(m[3] !== undefined && { weight: m[3] }) });
  }
  return { nodes, edges, bad };
}

/** An item's identity across states: its name, else its value and which occurrence of that value it is. */
export function keysOf(items: readonly StateItem[], byName = false): string[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    // Graph and tree nodes are their names: `A`, `A*` and `A:3` are the same node.
    if (byName) return `n:${it.id ?? it.value}`;
    if (it.id) return `#${it.id}`;
    const n = (seen.get(it.value) ?? 0) + 1;
    seen.set(it.value, n);
    return `v${n}:${it.value}`;
  });
}

export interface StateDiff {
  /** Cells that stay (their slot may change: from → to). */
  kept: { from: number; to: number }[];
  /** Cells that leave (slot in the old state). */
  exited: number[];
  /** Cells that appear (slot in the new state). */
  entered: number[];
  /** A different value in the same slot: the cell stays, its text changes. */
  changed: { from: number; to: number }[];
}

/** What changed between two states of one collection. */
export function diffStates(prev: readonly StateItem[], next: readonly StateItem[], byName = false): StateDiff {
  const pk = keysOf(prev, byName);
  const nk = keysOf(next, byName);
  const at = new Map(pk.map((k, i) => [k, i]));
  const kept: StateDiff["kept"] = [];
  const used = new Set<number>();
  nk.forEach((k, j) => {
    const i = at.get(k);
    if (i !== undefined) {
      kept.push({ from: i, to: j });
      used.add(i);
    }
  });
  let exited = prev.map((_, i) => i).filter((i) => !used.has(i));
  let entered = next.map((_, j) => j).filter((j) => !kept.some((k) => k.to === j));
  const changed: StateDiff["changed"] = [];
  for (const i of byName ? [] : [...exited]) {
    if (entered.includes(i)) {
      changed.push({ from: i, to: i });
      exited = exited.filter((x) => x !== i);
      entered = entered.filter((x) => x !== i);
    }
  }
  return { kept, exited, entered, changed };
}

/** How many separate things a state change asks the viewer to follow. */
export function changeCount(prev: readonly StateItem[], next: readonly StateItem[]): number {
  const d = diffStates(prev, next);
  // A cell that only slides over because one before it left or arrived is part of that change, not another.
  const unexplained = d.kept.filter((k) => k.to !== k.from + d.entered.filter((e) => e < k.to).length - d.exited.filter((e) => e < k.from).length).length;
  const texts = d.kept.filter((k) => prev[k.from]!.value !== next[k.to]!.value).length + d.changed.length;
  return d.entered.length + d.exited.length + unexplained + texts;
}

/** One state line in play order. */
export interface StateEvent {
  coll: string;
  snap: StateSnapshot;
  /** The narration of the beat the line sits in. */
  text: string;
  beat: Beat;
  action: Action;
  call: VerbCall;
  span: Span;
  /** Position of the beat among all beats of the scene (for "the last state"). */
  order: number;
}

/** State lines of a scene in the order they play (beats in order; within a beat, by the cue they sit on). */
export function stateEvents(scene: Scene): StateEvent[] {
  const events: StateEvent[] = [];
  let order = 0;
  for (const step of scene.steps) {
    for (const beat of step.beats) {
      const rank = (a: Action): number => (a.anchor === "start" ? -1 : a.anchor === "end" ? Infinity : beat.type === "speech" ? (beat.cues.find((c) => c.id === a.anchor)?.start ?? Infinity) : Infinity);
      for (const action of [...beat.actions].sort((a, b) => rank(a) - rank(b))) {
        for (const call of action.calls) {
          if (call.verb === "state" && call.state && call.targets[0]) {
            events.push({ coll: call.targets[0], snap: call.state, text: beat.type === "speech" ? beat.text : "", beat, action, call, span: call.span, order });
          }
        }
      }
      order++;
    }
  }
  return events;
}

export interface TraceProblem {
  code: "NAR601" | "NAR602" | "NAR603" | "NAR604" | "NAR605" | "NAR606" | "NAR607" | "NAR609" | "NAR610" | "NAR611" | "NAR612" | "NAR615";
  severity: "error" | "warning";
  message: string;
  span: Span;
  fix?: { desc: string; apply: () => void };
}

/** Verbs that change where a cell is or what it shows: in a trace scene the states say that, not the script. */
export const CELL_VERBS = new Set(["swap", "move", "drop", "lift", "set", "clone", "merge", "pop", "fade", "draw", "write", "hide", "strike", "count"]);

/** Checks that need no knowledge of any algorithm. */
const SORT_CHECKS = new Set(["sort", "bubble", "insertion", "selection", "partition", "quicksort", "mergesort", "heapsort"]);
const CAPACITY: Record<string, number> = { row: 10, chain: 8, buckets: 12, graph: 12, tree: 12 };
const NEGATED = /\b(not|isn't|isnt|aren't|unsorted|until|before|if|once|when|so that|becomes?|to be)\b/i;

const values = (items: readonly StateItem[]): string[] => items.map((i) => i.value);
const numeric = (items: readonly StateItem[]): number[] | undefined => {
  const n = items.map((i) => Number(i.value));
  return n.every((x) => Number.isFinite(x)) ? n : undefined;
};

/** Everything wrong with a trace scene that can be seen from its states alone. */
export function analyzeTrace(scene: Scene): TraceProblem[] {
  const problems: TraceProblem[] = [];
  const decls = scene.steps.flatMap((s) => s.elements);
  const collections = new Map(decls.filter((e) => isCollection(e.kind)).map((e) => [e.id, e]));
  const isTrace = scene.attrs.template === "trace";
  const events = stateEvents(scene);

  if (!isTrace) {
    for (const ev of events) {
      problems.push({ code: "NAR601", severity: "error", message: `state lines (\`${ev.coll}:\`) need \`template=trace\` on the scene line`, span: ev.span });
      break;
    }
    return problems;
  }

  // Structural verbs are the engine's job here: the states already say what moves.
  for (const step of scene.steps) {
    for (const beat of step.beats) {
      for (const action of beat.actions) {
        for (const call of action.calls) {
          if (call.verb === "state" || !CELL_VERBS.has(call.verb)) continue;
          for (const t of [...call.targets]) {
            const base = t.split(".")[0]!;
            if (!collections.has(base)) continue;
            problems.push({
              code: "NAR610",
              severity: "error",
              message: `\`${call.verb} ${t}\`: in a trace scene the state lines show what changes; write the new state instead of a ${call.verb}`,
              span: call.span,
              fix: {
                desc: `removed \`${call.verb} ${t}\``,
                apply: () => {
                  call.targets = call.targets.filter((x) => x !== t);
                  if (!call.targets.length) action.calls = action.calls.filter((c) => c !== call);
                  if (!action.calls.length) beat.actions = beat.actions.filter((a) => a !== action);
                },
              },
            });
          }
        }
      }
    }
  }

  const last = new Map<string, StateEvent>();
  const first = new Map<string, StateEvent>();
  const before = new Map<string, StateSnapshot | undefined>();
  const main = [...collections.values()].find((e) => e.kind === "row");
  const check = scene.attrs.check ?? "";

  for (const ev of events) {
    const decl = collections.get(ev.coll);
    if (!decl) {
      problems.push({
        code: "NAR601",
        severity: "error",
        message: `\`${ev.coll}:\` is not a collection declared in this scene (declare it: \`${ev.coll} = row\`; kinds: ${COLLECTIONS.join(", ")})`,
        span: ev.span,
        fix: {
          desc: "removed the state line",
          apply: () => {
            ev.action.calls = ev.action.calls.filter((c) => c !== ev.call);
            if (!ev.action.calls.length) ev.beat.actions = ev.beat.actions.filter((a) => a !== ev.action);
          },
        },
      });
      continue;
    }
    const { items, pointers } = ev.snap;
    const kind = decl.kind;
    const prev = before.get(ev.coll);
    if (!first.has(ev.coll)) first.set(ev.coll, ev);

    // A mark on its own is not a value: it belongs right after the item it marks (`7*`, not `7 *`).
    for (const it of [...items]) {
      if (it.id || !/^[*+~!]$/.test(it.value)) continue;
      problems.push({
        code: "NAR602",
        severity: "error",
        message: `\`${it.value}\` stands alone as a cell in \`${ev.coll}\`; a mark goes right after its item with no space (\`fact(4)${it.value}\`, \`7${it.value}\`)`,
        span: ev.span,
        fix: {
          desc: `attached \`${it.value}\` to the item before it`,
          apply: () => {
            const at = items.indexOf(it);
            const before = items[at - 1];
            if (before && !before.mark) before.mark = it.value as StateItem["mark"];
            if (at >= 0) items.splice(at, 1);
          },
        },
      });
    }

    // Arrows written as `d->c` join cells that exist in this state.
    for (const l of ev.snap.links ?? []) {
      const missing = [l.from, l.to].find((n) => !items.some((i) => i.id === n));
      if (missing) problems.push({ code: "NAR604", severity: "error", message: `link \`${l.from}->${l.to}\` names \`${missing}\`, which is not a named cell of \`${ev.coll}\` in this state (name cells like \`d:10\`)`, span: ev.span });
    }
    // A graph or tree draws its nodes from the edges declared with it; a state may only list those nodes.
    if (isNodeCollection(kind)) {
      const topo = topology(kind, decl.texts[0] ?? "");
      if (!topo.nodes.length) {
        problems.push({ code: "NAR604", severity: "error", message: `\`${ev.coll} = ${kind}\` needs its edges: \`${ev.coll} = ${kind} "${kind === "tree" ? "R>A R>B A>C" : "A-B A-C B-D"}"\``, span: decl.span });
      } else {
        const unknown = items.map((i) => i.id ?? i.value).find((n) => !topo.nodes.includes(n));
        if (unknown) problems.push({ code: "NAR604", severity: "error", message: `\`${unknown}\` is not a node of \`${ev.coll}\` (nodes: ${topo.nodes.join(" ")})`, span: ev.span });
      }
    }

    // Names are identities: two cells with one name in a state cannot both be it.
    const names = items.filter((i) => i.id).map((i) => i.id!);
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) problems.push({ code: "NAR605", severity: "error", message: `\`${ev.coll}\` has two cells named \`${dup}\` in one state; names must be unique (use \`${dup}2:\`)`, span: ev.span });

    const cap = CAPACITY[kind] ?? 8;
    if (items.length > cap) problems.push({ code: "NAR615", severity: "error", message: `\`${ev.coll}\` holds ${items.length} cells; at most ${cap} fit (${kind === "row" ? "split the run or use fewer values" : "keep the panel short"})`, span: ev.span });

    for (const p of pointers) {
      const asIndex = /^-?\d+$/.test(p.at);
      const ok = asIndex ? Number(p.at) >= -1 && Number(p.at) <= items.length : items.some((i) => i.id === p.at);
      if (!ok) {
        problems.push({
          code: "NAR603",
          severity: "error",
          message: asIndex ? `pointer \`${p.name}=${p.at}\` is outside \`${ev.coll}\` (slots 0–${Math.max(0, items.length - 1)}, or -1 and ${items.length} just outside)` : `pointer \`${p.name}=${p.at}\` names no cell of \`${ev.coll}\` (cells: ${items.filter((i) => i.id).map((i) => i.id).join(", ") || "none named; use a slot number"})`,
          span: ev.span,
        });
      }
    }

    if (prev) {
      const was = values(prev.items);
      const now = values(items);
      if (kind === "stack") {
        const k = Math.min(was.length, now.length) - 1;
        if (k > 0 && was.slice(0, k).some((v, i) => v !== now[i])) {
          problems.push({ code: "NAR606", severity: "error", message: `\`${ev.coll}\` is a stack: only the top may change between states (it was ${was.join(" ")}, now ${now.join(" ")})`, span: ev.span });
        }
      }
      if (kind === "queue") {
        // Some cells leave at the front, new ones join at the back, nothing else changes.
        const fits = [...Array(was.length + 1).keys()].some((r) => {
          const rest = was.slice(r);
          // Everything left and a fresh set joined: only believable when no old value is still there.
          if (!rest.length) return !now.some((v) => was.includes(v));
          return rest.length <= now.length && rest.every((v, i) => v === now[i]);
        });
        if (!fits) problems.push({ code: "NAR607", severity: "error", message: `\`${ev.coll}\` is a queue: cells leave at the front and join at the back, nothing else changes (it was ${was.join(" ")}, now ${now.join(" ")})`, span: ev.span });
      }
      const changes = changeCount(prev.items, items);
      if (changes > 4) problems.push({ code: "NAR609", severity: "warning", message: `\`${ev.coll}\` changes ${changes} things at once; one change per cue lets the viewer follow it (split the sentence)`, span: ev.span });
      // A sort or partition only moves values around.
      if (SORT_CHECKS.has(check) && kind === "row" && ev.coll === main?.id) {
        const a = [...was].sort().join(",");
        const b = [...now].sort().join(",");
        if (a !== b) {
          problems.push({ code: "NAR612", severity: "error", message: `\`${ev.coll}\` lost or gained a value: it was ${was.join(" ")}, now ${now.join(" ")}; a ${check} only rearranges the same values`, span: ev.span });
        }
      }
    }
    before.set(ev.coll, ev.snap);
    last.set(ev.coll, ev);
  }

  // "Sorted" must be true when it is said: the row at the end of that sentence has to be in order.
  for (const [coll, ev] of last) {
    if (collections.get(coll)?.kind !== "row") continue;
    const words = ev.text;
    if (!/\b(sorted|in order|ascending order|descending order|smallest to largest|largest to smallest)\b/i.test(words) || NEGATED.test(words)) continue;
    const n = numeric(ev.snap.items);
    if (!n || n.length < 2) continue;
    const desc = /\b(descending|largest to smallest)\b/i.test(words);
    const ok = n.every((x, i) => i === 0 || (desc ? n[i - 1]! >= x : n[i - 1]! <= x));
    if (!ok) {
      problems.push({
        code: "NAR611",
        severity: "error",
        message: `the narration says \`${coll}\` is ${desc ? "in descending order" : "sorted"} but the state shows ${values(ev.snap.items).join(" ")}; show the finished ${desc ? "descending " : ""}order`,
        span: ev.span,
      });
    }
  }
  return problems;
}
