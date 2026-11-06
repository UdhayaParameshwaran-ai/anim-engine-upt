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
  cards: [["icon:sun", "Solar"], ["icon:wind", "Wind"], ["icon:droplet", "Hydro"], ["icon:flame", "Gas"], ["icon:bolt", "Grid"], ["icon:cube", "Storage"], ["asset:tree", "Biomass"], ["asset:earth", "Global"], ["icon:lightbulb", "Ideas"]],
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
  const typical = { title: 2, steps: 4, cycle: 4, timeline: 4, hub: 5, cards: 6, spotlight: 4, converge: 3, diverge: 4, process: 5 }[t.name] ?? Math.round((t.items.min + t.items.max) / 2);
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
  if (TECH_TEMPLATES.has(t.name)) return techScript(t, variant, typeof size === "number" ? size : itemCount(t, size), long);
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

const TECH_TEMPLATES = new Set(["exchange", "architecture", "stack", "structure", "code", "tree", "states", "gitgraph", "anatomy"]);

/** Example scenes for the software & tech templates: a real topic each, n items. */
function techScript(t: TemplateManifest, variant: string, n: number, long: boolean): string {
  const label = (l: string) => (long ? `${l} ${LONG}` : l);
  const decl: string[] = [];
  const show: string[] = [];
  const attrs = `template=${t.name} variant=${variant}`;
  if (t.name === "exchange") {
    const parts: [string, string][] = [["icon:globe", "Browser"], ["icon:server", "Web server"], ["icon:database", "Database"], ["icon:shield", "Auth service"], ["icon:zap", "Cache"]];
    const ids = parts.slice(0, n).map((_, i) => `p${i + 1}`);
    ids.forEach((id, i) => decl.push(`${id} = ${parts[i]![0]} "${label(parts[i]![1])}"`));
    // Requests down the chain, then the replies back up it.
    const msgs: string[] = [];
    for (let i = 0; i + 1 < ids.length; i++) msgs.push(`m${msgs.length + 1} = arrow ${ids[i]}->${ids[i + 1]} "${["GET /home", "SELECT posts", "check token", "lookup"][i]}"`);
    for (let i = ids.length - 1; i > 0 && msgs.length < 8; i--) msgs.push(`m${msgs.length + 1} = arrow ${ids[i]}->${ids[i - 1]} "${["200 OK", "rows", "valid", "hit"][(ids.length - 1 - i) % 4]}"`);
    decl.push(...msgs);
    show.push(...ids, ...msgs.map((m) => m.split(" ")[0]!));
    return techScene(attrs, decl, show);
  }
  if (t.name === "architecture") {
    const zones = n >= 9 ? 4 : n >= 6 ? 3 : n >= 4 ? 2 : 1;
    const comps: [string, string][] = [["icon:globe", "Browser"], ["icon:smartphone", "Mobile app"], ["icon:cloud", "CDN"], ["icon:split", "Load balancer"], ["icon:server", "API"], ["icon:zap", "Cache"], ["icon:database", "Postgres"], ["icon:hard-drive", "Object store"], ["icon:activity", "Metrics"], ["icon:mail", "Queue"]];
    const zoneNames = ["Client", "Edge", "Services", "Data"];
    const count = Math.max(1, n - zones);
    const per = Math.ceil(count / zones);
    let c = 0;
    const ids: string[] = [];
    for (let z = 0; z < zones; z++) {
      decl.push(`z${z + 1} = zone "${zoneNames[z]}"`);
      for (let k = 0; k < per && c < count; k++, c++) {
        decl.push(`c${c + 1} = ${comps[c]![0]} "${label(comps[c]![1])}"`);
        ids.push(`c${c + 1}`);
      }
    }
    const links = ids.slice(1).map((id, i) => `l${i + 1} = arrow ${ids[i]}->${id}`);
    decl.push(...links);
    show.push(...ids, ...links.map((l) => l.split(" ")[0]!));
    return techScene(attrs, decl, show);
  }
  if (t.name === "tree") {
    // A balanced tree: root, then children in turn, n nodes.
    const names = ["project", "src", "docs", "tests", "app.js", "utils.js", "README.md", "guide.md", "app.test.js", "index.js", "api.js", "notes.md"];
    const icons = ["folder", "folder", "folder", "folder", "file", "file", "file-text", "file-text", "file", "file", "file", "file-text"];
    const parentOf = [-1, 0, 0, 0, 1, 1, 2, 2, 3, 1, 1, 2];
    for (let i = 0; i < n; i++) {
      decl.push(`t${i + 1} = icon:${icons[i]} "${label(names[i]!)}"`);
      show.push(`t${i + 1}`);
    }
    for (let i = 1; i < n; i++) {
      decl.push(`e${i} = line t${parentOf[i]! + 1}->t${i + 1}`);
      show.push(`e${i}`);
    }
    return techScene(attrs, decl, show);
  }
  if (t.name === "states") {
    const states = ["Idle", "Connecting", "Connected", "Sending", "Closing", "Closed", "Error", "Retry"];
    states.slice(0, n).forEach((st, i) => (decl.push(`s${i + 1} = node "${label(st)}"`), show.push(`s${i + 1}`)));
    for (let i = 1; i < n; i++) (decl.push(`t${i} = arrow s${i}->s${i + 1} "${["dial", "accept", "write", "close", "done", "fail", "wait"][i - 1]}"`), show.push(`t${i}`));
    if (n >= 3) (decl.push(`back = arrow s${n}->s1 "reset"`), show.push("back"));
    return techScene(attrs, decl, show);
  }
  if (t.name === "gitgraph") {
    // main and feature lanes; commits alternate, the last on main merges the feature.
    const lanes = n >= 8 ? 3 : 2;
    const commits = Math.max(2, n - lanes);
    const laneNames = ["main", "feature", "hotfix"];
    const per = Math.ceil(commits / lanes);
    let c = 0;
    const byLane: string[][] = [];
    for (let l = 0; l < lanes; l++) {
      decl.push(`b${l + 1} = zone "${laneNames[l]}"`);
      byLane.push([]);
      for (let k = 0; k < per && c < commits; k++, c++) {
        decl.push(`c${c + 1} = circle "${label(["init", "login", "form", "tests", "fix", "merge", "docs", "ship", "tag", "bump"][c]!)}"`);
        byLane[l]!.push(`c${c + 1}`);
        show.push(`c${c + 1}`);
      }
    }
    const links: string[] = [];
    byLane.forEach((lane, l) => {
      lane.slice(1).forEach((id, k) => links.push(`${lane[k]}->${id}`));
      if (l > 0 && lane.length && byLane[0]!.length) links.push(`${byLane[0]![0]}->${lane[0]}`);
    });
    links.forEach((ln, i) => (decl.push(`g${i + 1} = line ${ln}`), show.push(`g${i + 1}`)));
    return techScene(attrs, decl, show);
  }
  if (t.name === "anatomy") {
    const parts = ["https://", "shop.example.com", ":443", "/products", "?id=42", "#reviews", "&sort=new"];
    const names = ["protocol", "domain", "port", "path", "query", "fragment", "param"];
    parts.slice(0, n).forEach((pt, i) => {
      decl.push(`p${i + 1} = box "${long ? `${pt}/more/path` : pt}"`, `n${i + 1} = label "${names[i]}" @${variant === "stacked" ? "right-of" : "below"}:p${i + 1}`);
      show.push(`p${i + 1}`, `n${i + 1}`);
    });
    return techScene(attrs, decl, show);
  }
  if (t.name === "stack") {
    const layers = ["Your app", "HTTP", "TLS", "TCP", "IP", "Ethernet", "Physical"];
    layers.slice(0, n).forEach((l, i) => (decl.push(`s${i + 1} = box "${label(l)}"`), show.push(`s${i + 1}`)));
    return techScene(attrs, decl, show);
  }
  if (t.name === "structure") {
    const values = ["3", "8", "15", "23", "42", "57", "64", "91"];
    values.slice(0, n).forEach((v, i) => (decl.push(`c${i + 1} = box "${long ? `${v}000` : v}"`), show.push(`c${i + 1}`)));
    if (variant === "array" && n >= 2) (decl.push(`ptr = label "mid" @above:c${Math.ceil(n / 2)}`), show.push("ptr"));
    return techScene(attrs, decl, show);
  }
  // code: the panel, then notes (or its output in a terminal for split).
  decl.push(`code = code "const res = await fetch(url);\\nif (!res.ok) throw new Error(res.status);\\nconst data = await res.json();\\nshow(data.items);" lang=js`);
  show.push("code");
  if (variant === "split") {
    decl.push(`out = terminal "$ node app.js\\nLoaded 24 items\\nDone in 180 ms"`);
    show.push("out");
  } else {
    const notes = ["Ask the server", "Stop on an error", "Read the JSON", "Show the items"];
    notes.slice(0, n).forEach((l, i) => (decl.push(`n${i + 1} = label "${label(l)}"`), show.push(`n${i + 1}`)));
  }
  return techScene(attrs, decl, show);
}

/** Like scene(), but connectors are sent (a packet travels) instead of faded in. */
function techScene(attrs: string, decl: string[], show: string[]): string {
  const links = new Set(decl.filter((d) => /=\s*arrow\s/.test(d)).map((d) => d.split(" ")[0]!));
  const lines = new Set(decl.filter((d) => /=\s*line\s/.test(d)).map((d) => d.split(" ")[0]!));
  const words = show.map((id, i) => `{${i + 1}}${id}`).join(" then ");
  const actions = show.map((id, i) => `${i + 1} ${links.has(id) ? "send" : lines.has(id) ? "draw" : "fade"} ${id}`);
  return `video 1 "Gallery"\n\nscene s "Example" ${attrs}\n${decl.join("\n")}\n> First ${words}.\n${actions.join("\n")}\n`;
}

/** Appended to every label for the long-label stress setting (about 35 characters in all). */
const LONG = "and what follows";

const TITLES: Record<string, string> = { converge: "What a Plant Needs", diverge: "What Electricity Does", process: "Inside the Leaf", compare: "Plant vs Animal Cells", steps: "The Water Cycle", timeline: "A Short History of Vaccines", cards: "Energy Sources", hub: "What Runs a Cloud App" };

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
