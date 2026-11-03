import { COMPOSE_PATTERNS, FRAME_MODES, GRID, GRID_ELEMENTS, GRID_LAYOUTS, TEMPLATES, variantGuide, type GridElement, type GridLayout, type TemplateManifest } from "@anim/registry";

/** One gallery tile: a complete, compilable script and what it shows. */
export interface Case {
  id: string;
  title: string;
  /** Short line under the title (slots, sizes, syntax). */
  note: string;
  script: string;
}

export interface Group {
  id: string;
  title: string;
  intro: string;
  /** Sub-groups, e.g. one per template with its variants as cases. */
  sections: { title: string; note: string; cases: Case[] }[];
}

/** How many items template examples hold: a typical count, the fewest or the most the template allows. */
export type Density = "typical" | "min" | "max";

// Example content: a real topic per template, so arrangements read like real scenes.
const ITEMS: Record<string, [string, string][]> = {
  title: [["icon:sun", "Light"], ["icon:droplet", "Water"], ["icon:wind", "Air"]],
  steps: [["icon:droplet", "Evaporate"], ["icon:cloud", "Condense"], ["icon:bolt", "Storm"], ["icon:droplet", "Rain"], ["asset:earth", "Collect"], ["icon:sun", "Repeat"]],
  cycle: [["icon:sun", "Heat"], ["icon:cloud", "Clouds"], ["icon:droplet", "Rain"], ["asset:tree", "Plants"], ["icon:wind", "Wind"], ["icon:flame", "Energy"]],
  timeline: [["box", "1796 · First vaccine"], ["box", "1885 · Rabies"], ["box", "1955 · Polio"], ["box", "1980 · Smallpox gone"], ["box", "2020 · mRNA"], ["box", "2030 · Next"], ["box", "2040 · Future"]],
  hub: [["icon:server", "Servers"], ["icon:database", "Data"], ["icon:user", "Users"], ["icon:gear", "Settings"], ["icon:clock", "Uptime"], ["icon:check", "Checks"], ["icon:bolt", "Speed"], ["icon:heart", "Health"]],
  grid: [["icon:sun", "Solar"], ["icon:wind", "Wind"], ["icon:droplet", "Hydro"], ["icon:flame", "Gas"], ["icon:bolt", "Grid"], ["icon:cube", "Storage"], ["asset:tree", "Biomass"], ["asset:earth", "Global"], ["icon:lightbulb", "Ideas"]],
  converge: [["icon:sun", "Sunlight"], ["icon:droplet", "Water"], ["icon:wind", "CO₂"], ["icon:bolt", "Minerals"], ["icon:clock", "Time"]],
  diverge: [["icon:lightbulb", "Light"], ["icon:flame", "Heat"], ["icon:gear", "Motion"], ["icon:server", "Computing"], ["icon:wind", "Cooling"]],
  // process: the first half are inputs (declared before the process), the rest outputs.
  process: [["icon:sun", "Light"], ["icon:droplet", "Water"], ["icon:wind", "CO₂"], ["icon:bolt", "Minerals"], ["icon:cube", "Glucose"], ["icon:wind", "Oxygen"], ["icon:droplet", "Vapour"], ["icon:flame", "Heat"]],
  spotlight: [["label", "Left atrium"], ["label", "Right atrium"], ["label", "Left ventricle"], ["label", "Right ventricle"], ["label", "Valve"], ["label", "Aorta"]],
};

/** Every template in every variant. */
export function templateGroup(density: Density): Group {
  return {
    id: "templates",
    title: "Templates",
    intro: "Diagram scenes. The LLM names a template and fills its slots; the engine picks the variant that fits the content (a named variant is kept when it fits). Here every variant is shown as is.",
    sections: TEMPLATES.map((t) => ({
      title: t.name,
      note: `shape: ${t.guide.shape} · use when ${t.guide.useWhen} · not if ${t.guide.avoidWhen}${slotsNote(t)} · ${t.variants.length} variants`,
      cases: t.variants.map((v) => {
        const g = variantGuide(t, v);
        return { id: `tpl-${t.name}-${v}`, title: v, note: `${g.when}${g.items ? ` · fits ${g.items[0]}–${g.items[1]} items` : ""}`, script: templateScript(t, v, density) };
      }),
    })),
  };
}

function slotsNote(t: TemplateManifest): string {
  const slots = t.slots.map((s) => `${s.name}${s.required ? "" : "?"}`).join(", ");
  const items = t.items ? `items ${t.items.min}–${t.items.max}` : t.graph ? `nodes ≤ ${t.graph.maxNodes}` : "";
  return [slots && ` · slots: ${slots}`, items && ` · ${items}`].join("");
}

function itemCount(t: TemplateManifest, density: Density): number {
  if (!t.items) return 0;
  const typical = { title: 2, steps: 4, cycle: 4, timeline: 4, hub: 5, grid: 6, spotlight: 4, converge: 3, diverge: 4, process: 5 }[t.name] ?? Math.round((t.items.min + t.items.max) / 2);
  const n = density === "min" ? t.items.min : density === "max" ? t.items.max : typical;
  return Math.max(t.items.min, Math.min(t.items.max, n));
}

/**
 * A complete script showing template `t` in `variant`. `size` is a density or
 * an exact item count (flow: node count); `long` gives every item a long label
 * (the quality test stresses layouts with it).
 */
export function templateScript(t: TemplateManifest, variant: string, size: Density | number, long = false): string {
  if (t.name === "flow") return flowScript(variant, size, long);
  const label = (l: string) => (long ? `${l} ${LONG}` : l);
  const decl: string[] = [];
  const show: string[] = [];
  const slot = (name: string) => t.slots.some((s) => s.name === name);
  if (slot("title")) {
    decl.push(`title = title "${t.name === "title" ? "How the Water Cycle Works" : TITLES[t.name] ?? "Example"}"`);
    show.push("title");
  }
  if (t.name === "title") (decl.push(`subtitle = text "From sea to sky and back again"`), show.push("subtitle"));
  if (t.name === "compare") decl.push(`left = asset:cell.plant "Plant cell"`, `right = asset:cell.animal "Animal cell"`), show.push("left", "right");
  if (t.name === "cycle") (decl.push(`center = asset:earth "Earth"`), show.push("center"));
  if (t.name === "hub") (decl.push(`center = icon:cloud "Cloud app"`), show.push("center"));
  if (t.name === "spotlight") (decl.push(`main = asset:heart.anatomy "Heart"`), show.push("main"));
  const pool = ITEMS[t.name] ?? [];
  const n = typeof size === "number" ? size : itemCount(t, size);
  const ids = Array.from({ length: n }, (_, i) => `i${i + 1}`);
  // process: inputs, then the process, then outputs, joined by arrows through the process.
  if (t.name === "process") {
    const ins = Math.ceil(n / 2);
    const inputs = ids.slice(0, ins);
    const outputs = ids.slice(ins);
    inputs.forEach((id, i) => decl.push(`${id} = ${pool[i]![0]} "${label(pool[i]![1])}"`));
    decl.push(`process = asset:leaf "Photosynthesis"`);
    outputs.forEach((id, i) => decl.push(`${id} = ${pool[4 + i]![0]} "${label(pool[4 + i]![1])}"`));
    const arrows = [...inputs.map((id, i) => `p${i + 1} = arrow ${id}->process`), ...outputs.map((id, i) => `q${i + 1} = arrow process->${id}`)];
    decl.push(...arrows);
    show.push(...inputs, "process", ...outputs, ...arrows.map((a) => a.split(" ")[0]!));
    return scene(`template=process variant=${variant}`, decl, show);
  }
  ids.forEach((id, i) => {
    const [kind, text] = pool[i % pool.length]!;
    decl.push(`${id} = ${kind} "${label(text)}"`);
    show.push(id);
  });
  // converge / diverge: one arrow per item, into or out of the hub.
  if (t.name === "converge" || t.name === "diverge") {
    const hub = t.name === "converge" ? "result" : "source";
    decl.push(t.name === "converge" ? `result = asset:leaf "Leaf"` : `source = icon:bolt "Electricity"`);
    show.splice(1, 0, hub);
    const arrows = ids.map((id, i) => (t.name === "converge" ? `a${i + 1} = arrow ${id}->result` : `a${i + 1} = arrow source->${id}`));
    decl.push(...arrows);
    show.push(...arrows.map((a) => a.split(" ")[0]!));
  }
  return scene(`template=${t.name} variant=${variant}`, decl, show);
}

/** Appended to every label for the long-label stress setting (about 35 characters in all). */
const LONG = "and what follows";

const TITLES: Record<string, string> = { converge: "What a Plant Needs", diverge: "What Electricity Does", process: "Inside the Leaf", compare: "Plant vs Animal Cells", steps: "The Water Cycle", timeline: "A Short History of Vaccines", grid: "Energy Sources", hub: "What Runs a Cloud App" };

function flowScript(variant: string, size: Density | number, long = false): string {
  const nodes = typeof size === "number" ? Math.min(8, size) : size === "min" ? 3 : size === "max" ? 8 : 5;
  const labels = ["Should I learn to code?", "Pick one language", "Try a free tutorial", "Build a small project", "Share it", "Get feedback", "Improve", "Ship v2"];
  const decl = labels.slice(0, nodes).map((l, i) => `n${i + 1} = node "${long ? `${l} ${LONG}` : l}"`);
  const edges = [[1, 2, "yes"], [1, 3, "not sure"], [2, 4, ""], [3, 4, ""], [4, 5, ""], [5, 6, ""], [6, 7, ""], [7, 8, ""]].filter(([a, b]) => (b as number) <= nodes);
  edges.forEach(([a, b, l], i) => decl.push(`e${i + 1} = n${a} -> n${b}${l ? ` "${l}"` : ""}`));
  const show = [...labels.slice(0, nodes).map((_, i) => `n${i + 1}`), ...edges.map((_, i) => `e${i + 1}`)];
  return scene(`template=flow variant=${variant}`, decl, show);
}

/** Every grid layout, filled with elements that fit its slots. */
export function gridGroup(): Group {
  const families = [...new Set(GRID_LAYOUTS.map((l) => l.family))];
  return {
    id: "grids",
    title: "Grid layouts",
    intro: `Editorial pages from the Template Rule Book: a 12-column grid (${GRID.width}×${GRID.height}, ${GRID.margin}px margins, ${GRID.gutter}px gutters) and ${GRID_LAYOUTS.length} approved slot layouts. Elements fill slots in reading order.`,
    sections: families.map((family) => ({
      title: family,
      note: GRID_LAYOUTS.filter((l) => l.family === family).map((l) => l.code).join(" · "),
      cases: GRID_LAYOUTS.filter((l) => l.family === family).map((l) => {
        const sizes = slotSizes(l);
        return { id: `grid-${l.code}`, title: `${l.code} · ${l.name}`, note: sizes.map((s) => `${s.w}×${s.h}`).join(" · "), script: gridScript(l, sizes, GRID_LAYOUTS.indexOf(l)) };
      }),
    })),
  };
}

/** Slot sizes with a title and no footer (frame mode E), as the validator measures them. */
function slotSizes(l: GridLayout): { w: number; h: number }[] {
  const frame = FRAME_MODES.find((m) => m.header === "title" && !m.footer)!;
  const colW = (GRID.width - 2 * GRID.margin - (GRID.columns - 1) * GRID.gutter) / GRID.columns;
  const rowH = (frame.h - (l.rows - 1) * GRID.gutter) / l.rows;
  return l.slots.map((s) => ({ w: Math.round(s.span * colW + (s.span - 1) * GRID.gutter), h: Math.round(s.rowSpan * rowH + (s.rowSpan - 1) * GRID.gutter) }));
}

// Sample content per grid element, in DSL.
const SAMPLE: Record<string, string> = {
  image: `image "a city skyline at dusk"`,
  illustration: `asset:earth "Our planet"`,
  icon: `icon:lightbulb "Idea"`,
  video: `video "waves on a beach"`,
  avatar: `avatar "Ada Lovelace" "First programmer"`,
  logo: `logo "Acme"`,
  map: `map "India;Brazil;Kenya"`,
  stat: `stat "95%" "of cases prevented"`,
  multistat: `multistat "4.4B;195;88%" "people;countries;coverage"`,
  gauge: `gauge "72" "trial efficacy"`,
  scorecard: `scorecard "4" "expert rating"`,
  progress: `progress "60%" "rollout complete"`,
  body: `body "Vaccines teach the immune system to recognise a germ without the risk of the disease itself."`,
  quote: `quote "The important thing is not to stop questioning." "Albert Einstein"`,
  callout: `callout "Ask why twice before you accept an answer."`,
  definition: `definition "Antibody" "a protein that sticks to one germ and marks it for removal"`,
  proscons: `proscons "Cheap;Fast;Simple" "Fragile;Short-lived"`,
  formula: `formula "E = mc²"`,
  bullets: `bullets "Wash hands;Get vaccinated;Stay home when sick"`,
  numbered: `numbered "Mix;Knead;Rest;Bake"`,
  checklist: `checklist "Plan;Build;Test;Ship"`,
  bar: `chart:bar data=12,48,95 labels=2000,2010,2020`,
  line: `chart:line data=1,3,2,5,4,7 labels=Jan,Feb,Mar,Apr,May,Jun`,
  pie: `chart:pie data=50,30,20 labels=Solar,Wind,Hydro`,
  table: `table "Planet|Moons;Earth|1;Mars|2;Jupiter|95" key=3`,
  comparison: `comparison "Cats|Dogs" "Independent|Loyal;Quiet|Playful;Low cost|More care"`,
  stepper: `stepper "Plan|set a goal;Build|make it work;Ship|let people use it"`,
  timeline: `timeline "1796|first vaccine;1885|rabies;1955|polio;1980|smallpox gone"`,
  flowchart: `flowchart "Start>Check;Check>Done:yes;Check>Retry:no"`,
  funnel: `funnel "Visitors|1000;Signups|300;Paid|50"`,
  cycle: `cycle "Plan;Do;Check;Act"`,
  matrix: `matrix "Effort|Impact" "Quick win|2,8;Big bet|8,9;Chore|3,2"`,
};

// Preference order when filling slots: rich primary elements first for big slots, compact ones after.
const BIG = ["bar", "table", "line", "comparison", "timeline", "stepper", "flowchart", "map", "illustration", "pie", "funnel", "matrix", "cycle"];
const SMALL = ["stat", "bullets", "quote", "gauge", "definition", "callout", "numbered", "checklist", "body", "scorecard", "progress", "formula", "proscons", "multistat", "pie", "icon"];

/** `turn` rotates the preference lists, so successive layouts show different elements. */
function gridScript(l: GridLayout, sizes: { w: number; h: number }[], turn: number): string {
  const rotate = (list: string[], by: number) => list.map((_, i) => list[(i + by) % list.length]!);
  const big = rotate(BIG, turn);
  const small = rotate(SMALL, turn * 3);
  const order = sizes.map((s, i) => ({ i, area: s.w * s.h })).sort((a, b) => b.area - a.area);
  const chosen: string[] = new Array(sizes.length);
  const used = new Set<string>();
  let charts = 0;
  for (const [rank, { i }] of order.entries()) {
    const { w, h } = sizes[i]!;
    const prefs = rank === 0 ? [...big, ...small] : [...small, ...big];
    const fits = (e: GridElement) => e.minW <= w && e.minH <= h;
    const pick = prefs.find((id) => {
      const e = GRID_ELEMENTS.find((x) => x.id === id)!;
      const chart = ["bar", "line", "pie"].includes(id);
      return fits(e) && !used.has(id) && !(chart && charts >= 2) && !(rank === 0 && ["icon", "logo", "avatar", "progress"].includes(id));
    });
    const id = pick ?? "body";
    used.add(id);
    if (["bar", "line", "pie"].includes(id)) charts++;
    chosen[i] = id;
  }
  const decl = [`title = title "${l.name}"`, ...chosen.map((id, i) => `s${i + 1} = ${SAMPLE[id]}`)];
  return scene(`grid=${l.code}`, decl, ["title", ...chosen.map((_, i) => `s${i + 1}`)], true);
}

/** Every grid element on its own, in the centered single-slot layout. */
export function elementGroup(): Group {
  const groups = [...new Set(GRID_ELEMENTS.map((e) => e.group))];
  return {
    id: "elements",
    title: "Grid elements",
    intro: `The ${GRID_ELEMENTS.length} elements a grid slot can hold, each with its own built-in motion when drawn.`,
    sections: groups.map((g) => ({
      title: g,
      note: GRID_ELEMENTS.filter((e) => e.group === g).map((e) => e.id).join(" · "),
      cases: GRID_ELEMENTS.filter((e) => e.group === g).map((e) => ({
        id: `el-${e.id}`,
        title: e.id,
        note: `${e.syntax} · ${e.role} · min ${e.minW}×${e.minH} · ${e.motion}`,
        // Support elements can't fill a page alone (rule R5): they sit in the narrow slot next to a short text.
        script:
          e.role === "support"
            ? scene("grid=L2-03", [`title = title "${e.id}"`, `x = ${SAMPLE[e.id] ?? e.syntax}`, `y = body "A support element sits beside the main content, never alone."`], ["title", "x", "y"], true)
            : scene(`grid=${e.minW > 1141 ? "L1-01" : "L1-02"}`, [`title = title "${e.id}"`, `x = ${SAMPLE[e.id] ?? e.syntax}`], ["title", "x"], true),
      })),
    })),
  };
}

/** Free composition: the constraint solver arranges loose elements by intent. */
export function composeGroup(): Group {
  const els = [`title = title "Inside a Plant Cell"`, `hero = asset:cell.plant "Plant cell"`, `a = icon:sun "Light"`, `b = icon:droplet "Water"`, `c = text "Chloroplasts turn light into sugar"`];
  return {
    id: "compose",
    title: "Compose patterns",
    intro: "For scenes no template fits: compose=<pattern> arranges 2–6 elements; emphasis=<id> names the hero. A constraint solver (Cassowary) computes the boxes.",
    sections: [
      {
        title: "compose",
        note: COMPOSE_PATTERNS.join(" · "),
        cases: COMPOSE_PATTERNS.map((p) => ({ id: `compose-${p}`, title: p, note: `compose=${p} emphasis=hero`, script: scene(`compose=${p} emphasis=hero`, els, ["title", "hero", "a", "b", "c"]) })),
      },
    ],
  };
}

/**
 * A one-scene script that shows every element in turn, so the final frame
 * has everything on screen and playing shows each element's entrance.
 */
function scene(attrs: string, decl: string[], show: string[], grid = false): string {
  const words = show.map((id, i) => `{${i + 1}}${id}`).join(" then ");
  const verb = (id: string) => (grid ? (id === "title" ? "write" : "draw") : id === "title" ? "write" : "fade");
  const actions = show.map((id, i) => `${i + 1} ${verb(id)} ${id}`);
  return `video 1 "Gallery"\n\nscene s "Example" ${attrs}\n${decl.join("\n")}\n> First ${words}.\n${actions.join("\n")}\n`;
}
