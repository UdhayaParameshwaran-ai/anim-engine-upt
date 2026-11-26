import type { Box, ElementIR } from "@anim/ir";
import { ICONS, ILLUSTRATIONS } from "./art.js";
import { color, itemColor, shadowFilter, type Theme } from "./theme.js";
import { buildMotion, DEFAULT_TEMPLATE_BASE } from "./motion.js";
import { buildWidget, WIDGET_KINDS } from "./widgets.js";

export const SVG_NS = "http://www.w3.org/2000/svg";

/** A built element. Content is drawn centered on the origin, sized to `box`. */
export interface Instance {
  el: ElementIR;
  layer: "svg" | "html";
  /** Node that receives transform/opacity/filter. */
  root: SVGGElement | HTMLElement;
  /** Addressable parts (`id.part`) → nodes that receive opacity/tint/scale. */
  parts: Map<string, Element[]>;
  /** Stroke shapes animated by `draw`. */
  strokes: SVGElement[];
  /** Theme-filled shapes; their fill fades in during the second half of `draw`. */
  fills: SVGElement[];
  /** Characters in reveal order, for `write` and text `draw`. */
  chars: Element[];
  /** Lines (list items) for `write by=line`. */
  lines: Element[][];
  /** Text that should appear as the shape is drawn (labels inside nodes, boxes). */
  innerText: Element[];
  /** Grid elements: plays the element's signature motion for draw progress k (0..1). */
  motion?: (k: number) => void;
  /** Replaces the element's main text (`set`, `count`): refits it and rebuilds its characters. */
  retext?: (content: string) => void;
  /** The text shown now (what `retext` last set); the element's own text until then. */
  shown?: string;
  /** A line across the element, drawn by `strike`. */
  strikeLine?: SVGLineElement;
  /** A page-hosting element: called every frame with the scene's own time. */
  tick?: (sceneTime: number) => void;
  /** Resolves when the hosted page can be shown (fonts loaded, stage built). */
  ready?: Promise<void>;
  /** Told, once the timeline is known, when each item of the page is shown (scene-local seconds). */
  setCues?: (cues: (number | undefined)[]) => void;
  /** Told how long the scene shows (scene-local seconds, before its closing transition): a page that plays out ends with it. */
  setSceneEnd?: (seconds: number) => void;
  /** Connectors are re-routed every frame between their endpoints. */
  connector?: { from: string; to: string; path: SVGPathElement; head?: SVGPathElement; label?: SVGTextElement; token?: SVGCircleElement };
}

const CHAR_W = 0.55;
const FONT: Record<string, number> = { title: 80, text: 44, label: 34, node: 32, list: 40, box: 36, circle: 32, placeholder: 28, edge: 26, arrow: 26, line: 26, icon: 30, asset: 32 };

/** `ids` prefixes any SVG ids the element defines (clip paths), unique per stage. */
export function build(doc: Document, el: ElementIR, theme: Theme, ids = `anim-${el.id}`, templateBase = DEFAULT_TEMPLATE_BASE): Instance {
  const inst: Instance = { el, layer: el.layer, root: undefined!, parts: new Map(), strokes: [], fills: [], chars: [], lines: [], innerText: [] };
  // Drawn by a hosted page instead (see compiler/html.ts): the element is there for its verbs and timing, with nothing to show.
  if (el.params.virtual) {
    inst.layer = "svg";
    inst.root = svg<SVGGElement>(doc, "g", { "data-id": el.id, "data-kind": el.kind, "data-virtual": "" });
    return inst;
  }
  if (el.layer === "html") {
    inst.root = el.kind === "motion" ? buildMotion(doc, el, theme, inst, templateBase) : buildHtml(doc, el, theme, inst);
    return inst;
  }
  const g = svg<SVGGElement>(doc, "g", { "data-id": el.id, "data-kind": el.kind });
  inst.root = g;
  const { w, h } = el.box;
  if (WIDGET_KINDS.has(el.kind)) {
    buildWidget(doc, inst, g, el, theme, ids);
    return inst;
  }
  switch (el.kind) {
    case "title":
    case "text":
    case "label": {
      const left = el.params.align === "left";
      // Grid headers: left-aligned, sized to their band.
      // A layout may ask for a size (notes beside code); grid headers are sized to their band.
      const base = el.params.size !== undefined ? Number(el.params.size) : FONT[el.kind]!;
      const font = left ? Math.min(base, Math.max(h * 0.85, el.params.size !== undefined ? base : 0)) : base;
      g.append(text(doc, inst, el.texts[0] ?? "", font, w, h, theme, { heading: el.kind === "title", parts: true, align: left ? "left" : "center", ...(el.params.tone === "muted" && { fill: theme.muted }) }));
      break;
    }
    case "list":
      g.append(list(doc, inst, el.texts[0] ?? "", w, h, theme));
      break;
    case "code":
    case "terminal":
      codePanel(doc, inst, g, el, theme);
      break;
    case "zone": {
      const c = el.params.hue !== undefined ? itemColor(theme, Number(el.params.hue)) : theme.muted;
      if (el.params.lane) {
        // A branch lane: its name at the left, a thick line in its color along the row.
        const y = -h * 0.12;
        g.append(stroke(inst, svg(doc, "path", { d: `M${round(-w / 2 + 230)} ${round(y)}H${round(w / 2 - 10)}`, stroke: c, "stroke-width": 8, "stroke-opacity": 0.35 })));
        const t = text(doc, inst, el.texts[0] ?? "", 34, 200, 60, theme, { align: "left", fill: c });
        t.setAttribute("transform", `translate(${round(-w / 2 + 100)} ${round(y)})`);
        t.setAttribute("font-family", theme.mono);
        t.setAttribute("font-weight", "700");
        g.append(t);
        break;
      }
      // A group boundary: a dashed outline on a faint tint, its name at the top left.
      g.append(svg(doc, "rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: Math.min(theme.radius + 8, 28), fill: `color-mix(in srgb, ${c} 7%, ${theme.bg})`, stroke: c, "stroke-opacity": 0.55, "stroke-width": 2, "stroke-dasharray": "10 8" }));
      const t = text(doc, inst, (el.texts[0] ?? "").toUpperCase(), 26, w - 48, 40, theme, { align: "left", fill: c });
      t.setAttribute("transform", `translate(${round(24)} ${round(-h / 2 + 34)})`);
      t.setAttribute("font-weight", "700");
      t.setAttribute("letter-spacing", "0.08em");
      g.append(t);
      break;
    }
    case "chevron": {
      // A pipeline stage: an arrow-shaped band; the first has a flat left edge.
      const c = itemColor(theme, Number(el.params.hue ?? 0));
      const n = Math.min(h * 0.3, w * 0.22);
      const x0 = -w / 2;
      const x1 = w / 2;
      const d = el.params.first ? `M${x0} ${-h / 2}H${x1 - n}L${x1} 0L${x1 - n} ${h / 2}H${x0}Z` : `M${x0} ${-h / 2}H${x1 - n}L${x1} 0L${x1 - n} ${h / 2}H${x0}L${x0 + n} 0Z`;
      g.append(svg(doc, "path", { d, fill: `color-mix(in srgb, ${c} 16%, ${theme.bg})`, stroke: c, "stroke-width": 2.5, "stroke-linejoin": "round" }));
      break;
    }
    case "caption": {
      const left = el.params.align === "left";
      g.append(text(doc, inst, el.texts[0] ?? "", 26, w, h, theme, { fill: theme.muted, ...(left && { align: "left" }) }));
      for (const t of g.querySelectorAll("text")) t.setAttribute("font-family", theme.mono);
      break;
    }
    case "box":
    case "node":
    case "placeholder": {
      const hue = el.params.hue !== undefined && (el.kind === "box" || el.params.round) ? itemColor(theme, Number(el.params.hue)) : undefined;
      const r = svg(doc, "rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: el.params.round ? h / 2 : Math.min(theme.radius + (el.kind === "node" ? 4 : 0), h / 2), "data-fill": hue ? `color-mix(in srgb, ${hue} 14%, ${theme.bg})` : "surface", ...(hue && { "data-solid": "", stroke: hue }) });
      shadow(g, theme);
      if (el.kind === "placeholder") r.setAttribute("stroke-dasharray", "10 8");
      g.append(stroke(inst, r));
      const label = el.texts[0];
      const size = el.kind === "box" ? Math.max(FONT.box!, Math.min(52, h * 0.34)) : FONT[el.kind]!;
      if (label) g.append(text(doc, inst, label, size, w - 32, h - 20, theme, { inner: true }));
      break;
    }
    case "circle": {
      if (el.params.dot) {
        // A commit: a dot in its lane's color, its label under it.
        const c = itemColor(theme, Number(el.params.hue ?? 0));
        const r = Math.min(26, w * 0.18);
        g.append(stroke(inst, svg(doc, "circle", { cx: 0, cy: -h * 0.12, r, "data-fill": c, "data-solid": "", stroke: theme.bg, "stroke-width": 5 })));
        if (el.texts[0]) {
          const t = text(doc, inst, el.texts[0], 28, w, h * 0.4, theme, { inner: true });
          t.setAttribute("transform", `translate(0 ${round(-h * 0.12 + r + 34)})`);
          t.setAttribute("font-family", theme.mono);
          // A halo keeps the lines that run to a commit out of its label.
          Object.entries({ stroke: theme.bg, "stroke-width": "9", "stroke-linejoin": "round", "paint-order": "stroke" }).forEach(([k, v]) => t.setAttribute(k, v));
          g.append(t);
        }
        break;
      }
      const r = Math.min(w, h) / 2;
      g.append(stroke(inst, svg(doc, "circle", { cx: 0, cy: 0, r, "data-fill": "surface" })));
      shadow(g, theme);
      if (el.texts[0]) g.append(text(doc, inst, el.texts[0], FONT.circle!, r * 1.5, r * 1.2, theme, { inner: true }));
      break;
    }
    case "icon":
    case "asset":
      art(doc, inst, g, el, theme);
      break;
    case "panel": {
      // A card behind an item: the look's surface, a quiet border, the look's shadow.
      const hard = theme.shadow === "hard";
      const kit = theme.kit;
      const r = svg(doc, "rect", {
        x: -w / 2, y: -h / 2, width: w, height: h, rx: Math.min(theme.radius + 6, h / 2), "data-fill": theme.panel, "data-solid": "",
        stroke: hard || kit === "bold" ? theme.fg : theme.muted,
        "stroke-opacity": kit === "soft" ? 0 : kit === "bold" ? 0.9 : hard ? 1 : kit === "dashed" ? 0.6 : 0.35,
        "stroke-width": kit === "bold" ? theme.stroke * 1.4 : hard ? theme.stroke : Math.max(1.5, theme.stroke * 0.6),
        ...(kit === "dashed" && { "stroke-dasharray": "0.006 0.005" }),
      });
      shadow(g, theme);
      g.append(stroke(inst, r));
      break;
    }
    case "badge": {
      // A number, "vs" or a plain dot on the look's solid ink.
      const d = Math.min(w, h);
      const label = el.texts[0] ?? "";
      const shape = theme.iconShape === "square" ? svg(doc, "rect", { x: -d / 2, y: -d / 2, width: d, height: d, rx: Math.min(theme.radius, d / 4), fill: theme.ink, stroke: "none" }) : svg(doc, "circle", { cx: 0, cy: 0, r: d / 2, fill: theme.ink, stroke: "none" });
      g.append(shape);
      if (label) {
        const size = d * (label.length > 1 ? 0.4 : 0.52);
        const t = svg(doc, "text", { "text-anchor": "middle", y: round(size * 0.35), "font-size": round(size), "font-family": theme.headingFont, "font-weight": 700, fill: theme.onInk, stroke: "none" });
        t.textContent = theme.headingCase === "upper" ? label.toUpperCase() : label;
        g.append(t);
      }
      break;
    }
    case "kicker": {
      // A scene heading: an accent bar, then the title in the look's heading face.
      const label = el.texts[0] ?? "";
      const font = Math.min(52, h * 0.62);
      g.append(svg(doc, "rect", { x: -w / 2, y: -font * 0.5, width: Math.max(6, theme.stroke * 2), height: font, rx: 2, fill: theme.accent, stroke: "none" }));
      const t = text(doc, inst, label, font / theme.fontScale, w - 40, h, theme, { heading: true, align: "left" });
      t.setAttribute("transform", "translate(28 0)");
      g.append(t);
      break;
    }
    case "rule": {
      // An axis along the longer side of its box (dashed: a sequence lifeline).
      const across = w >= h;
      g.append(stroke(inst, svg(doc, "path", { d: across ? `M${-w / 2} 0H${w / 2}` : `M0 ${-h / 2}V${h / 2}`, stroke: theme.muted, "stroke-width": theme.stroke, ...(el.params.style === "dashed" && { "stroke-dasharray": "10 10", "stroke-opacity": 0.6 }) })));
      break;
    }
    case "arrow":
    case "line":
    case "edge":
      connector(doc, inst, g, el, theme);
      break;
    default:
      g.append(stroke(inst, svg(doc, "rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: Math.min(theme.radius, h / 2) })));
  }
  return inst;
}

/** The look's shape shadow on a group (none, soft or hard). */
function shadow(g: SVGGElement, theme: Theme): void {
  const f = shadowFilter(theme);
  if (f) g.setAttribute("data-shadow", f);
}

// ------------------------------------------------------------------ text ---

interface TextOpts {
  heading?: boolean;
  /** `[bracketed]` words become parts 1..n. */
  parts?: boolean;
  /** Appears with the enclosing shape's draw instead of on its own. */
  inner?: boolean;
  fill?: string;
  align?: "center" | "left";
}

/** Wraps by estimated glyph width (same estimate as the layout engine), shrinking to fit the box. */
export function fitText(content: string, font: number, maxW: number, maxH: number, charW = CHAR_W): { lines: string[]; font: number } {
  let f = font;
  for (let i = 0; i < 40; i++) {
    const perLine = Math.max(1, Math.floor(maxW / (charW * f)));
    const lines = wrap(content, perLine);
    // An unbreakable word (a token, a long path) wider than a line shrinks the text too, not only height.
    const widest = Math.max(...lines.map((l) => l.replace(/[[\]]/g, "").length));
    if ((lines.length * f * 1.25 <= maxH && widest <= perLine) || f < 10) return { lines, font: f };
    f *= 0.94;
  }
  return { lines: wrap(content, Math.max(1, Math.floor(maxW / (charW * f)))), font: f };
}

function wrap(content: string, perLine: number): string[] {
  const words = content.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const visible = w.replace(/[[\]]/g, "");
    if (cur && cur.replace(/[[\]]/g, "").length + 1 + visible.length > perLine) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

function text(doc: Document, inst: Instance, content: string, font: number, maxW: number, maxH: number, theme: Theme, opts: TextOpts = {}): SVGTextElement {
  const chars0 = inst.chars.length;
  const upper = opts.heading && theme.headingCase === "upper";
  // Capitals and tracking widen the text; fit with the wider estimate.
  const charW = theme.charW * (upper ? 1.15 : 1) + (opts.heading ? theme.headingTracking : 0);
  // `wrap` measures without brackets, so part markers don't affect line breaks.
  const fitted = fitText(upper ? content.toUpperCase() : content, font * theme.fontScale, maxW, maxH, charW);
  const left = opts.align === "left";
  const t = svg(doc, "text", {
    "text-anchor": left ? "start" : "middle",
    "font-size": round(fitted.font),
    "font-family": opts.heading ? theme.headingFont : theme.font,
    "font-weight": opts.heading ? theme.headingWeight : 400,
    ...(opts.heading && theme.headingTracking && { "letter-spacing": `${theme.headingTracking}em` }),
    fill: opts.fill ?? theme.fg,
    stroke: "none",
  }) as SVGTextElement;
  const lh = fitted.font * 1.25;
  const top = -((fitted.lines.length - 1) * lh) / 2 + fitted.font * 0.35;
  let part = 0;
  let inPart = false;
  fitted.lines.forEach((line, li) => {
    const ln = svg(doc, "tspan", { x: left ? round(-maxW / 2) : 0, y: round(top + li * lh) });
    for (const ch of line) {
      if (opts.parts && ch === "[") {
        inPart = true;
        part++;
        continue;
      }
      if (opts.parts && ch === "]") {
        inPart = false;
        continue;
      }
      const c = svg(doc, "tspan", {});
      c.textContent = ch;
      ln.append(c);
      if (ch !== " ") inst.chars.push(c);
      if (inPart) addPart(inst, String(part), c);
    }
    // keep a word space between wrapped lines for reveal pacing
    t.append(ln);
  });
  if (opts.inner) inst.innerText.push(t);
  // The first text of an element is its main one: `set` and `count` replace it (refitted, characters rebuilt).
  if (!inst.retext) {
    let mine = inst.chars.slice(chars0);
    let current: SVGTextElement = t;
    inst.retext = (next: string) => {
      const before = inst.chars.length;
      const fresh = text(doc, inst, next, font, maxW, maxH, theme, opts);
      const added = inst.chars.slice(before);
      inst.chars = [...inst.chars.slice(0, before).filter((c) => !mine.includes(c)), ...added];
      // The caller may have set attributes after building the node (position, fill): they carry over, the size is refitted.
      for (const a of Array.from(current.attributes)) if (a.name !== "font-size" && a.name !== "text-anchor") fresh.setAttribute(a.name, a.value);
      const i = inst.innerText.indexOf(current);
      if (i >= 0) inst.innerText.splice(i, 1);
      inst.innerText = inst.innerText.filter((n) => n !== fresh);
      if (i >= 0) inst.innerText.push(fresh);
      current.replaceWith(fresh);
      current = fresh;
      mine = added;
    };
  }
  return t;
}

function list(doc: Document, inst: Instance, content: string, w: number, h: number, theme: Theme): SVGGElement {
  const items = content.split(";").map((s) => s.trim()).filter(Boolean);
  const g = svg<SVGGElement>(doc, "g", {});
  const lh = Math.min(h / Math.max(1, items.length), FONT.list! * 1.5);
  const font = Math.min(FONT.list! * theme.fontScale, (lh / 1.4) * Math.min(theme.fontScale, 1.15));
  items.forEach((item, i) => {
    const row = svg(doc, "g", { "data-part": String(i + 1) });
    const y = -((items.length - 1) * lh) / 2 + i * lh;
    const t = svg(doc, "text", { x: -w / 2 + 40, y: round(y + font * 0.35), "font-size": round(font), "font-family": theme.font, fill: theme.fg, stroke: "none" });
    const bullet = svg(doc, "circle", { cx: -w / 2 + 14, cy: round(y), r: 5, "data-fill": "accent" });
    inst.fills.push(bullet);
    const chars: Element[] = [];
    for (const ch of item) {
      const c = svg(doc, "tspan", {});
      c.textContent = ch;
      t.append(c);
      if (ch !== " ") {
        inst.chars.push(c);
        chars.push(c);
      }
    }
    chars.unshift(bullet);
    inst.lines.push(chars);
    row.append(bullet, t);
    addPart(inst, String(i + 1), row);
    g.append(row);
  });
  return g;
}

// ------------------------------------------------------------------- art ---

function art(doc: Document, inst: Instance, g: SVGGElement, el: ElementIR, theme: Theme): void {
  const [kind, name] = el.component.split(":") as [string, string];
  const markup = kind === "icon" ? ICONS[name] : ILLUSTRATIONS[name];
  const grid = kind === "icon" ? 24 : 200;
  const label = el.texts[0];
  // The layout says how tall the label band is and how big its text (they scale with the picture).
  // An icon in a big slot (grid pages) stays an icon: capped, with its label right under it.
  const roomy = el.params.labelH === undefined && el.box.h > 420;
  // A band (a stack layer): the picture at the left, the label large beside it.
  const band = el.params.band !== undefined;
  const labelH = label && !band ? Number(el.params.labelH ?? (roomy ? 72 : 56)) : 0;
  const labelFont = band ? Math.max(30, Math.min(46, el.box.h * 0.36)) : Number(el.params.labelFont ?? (roomy ? 40 : FONT[kind]!));
  const size = band ? Math.max(10, el.box.h * (kind === "asset" ? 0.86 : 0.62)) : Math.max(10, Math.min(el.box.w, el.box.h - labelH, kind === "icon" && !el.params.sized ? 300 : Infinity));
  const top = -(size + labelH) / 2;
  const k = size / grid;
  const left = band ? -el.box.w / 2 + 28 : -size / 2;
  const holder = svg(doc, "g", { transform: `translate(${round(left)} ${round(top)}) scale(${round(k, 4)})`, "stroke-width": round(theme.stroke / k, 3) });
  // A template item takes its color from the look's palette; other icons keep the ink color.
  const hue = el.params.hue !== undefined ? itemColor(theme, Number(el.params.hue)) : undefined;
  if (kind === "icon" && markup) {
    iconArt(doc, holder, markup, theme, hue, k);
  } else if (markup) {
    holder.innerHTML = markup;
  } else {
    holder.append(svg(doc, "rect", { x: 2, y: 2, width: grid - 4, height: grid - 4, rx: grid / 8, "stroke-dasharray": `${grid / 10} ${grid / 14}` }));
  }
  // The scaled art sits in an unscaled group: a glow on the picture is then measured in canvas pixels,
  // not in the icon's 24-unit grid (where it would be several times wider).
  const picture = svg(doc, "g", { "data-picture": "" });
  picture.append(holder);
  g.append(picture);
  for (const shape of holder.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon")) stroke(inst, shape as SVGElement);
  for (const p of holder.querySelectorAll("[data-part]")) addPart(inst, p.getAttribute("data-part")!, p);
  if (label && band) {
    const x = left + size + 28;
    const t = text(doc, inst, label, labelFont, el.box.w / 2 - x - 24, el.box.h, theme, { align: "left" });
    t.setAttribute("transform", `translate(${round(x + (el.box.w / 2 - x - 24) / 2)} 0)`);
    g.append(t);
  } else if (label) {
    const t = text(doc, inst, label, labelFont, Number(el.params.labelW ?? Math.max(el.box.w, size * 1.15)), labelH, theme, {});
    t.setAttribute("transform", `translate(0 ${round(top + size + labelH / 2)})`);
    g.append(t);
  }
}

/** The colors of a code panel. Dark is the editor of every look; light and terminal are the other two. */
interface CodePalette {
  bg: string;
  bar: string;
  text: string;
  muted: string;
  keyword: string;
  string: string;
  number: string;
  comment: string;
  fn: string;
  prompt: string;
  output: string;
  edge: string;
}
const DARK: CodePalette = { bg: "#0f1623", bar: "#1a2333", text: "#e6edf3", muted: "#7d8590", keyword: "#ff7b72", string: "#a5d6ff", number: "#79c0ff", comment: "#8b949e", fn: "#d2a8ff", prompt: "#7ee787", output: "#9da7b3", edge: "#27324a" };
const LIGHT: CodePalette = { bg: "#fbfbfc", bar: "#eceef2", text: "#24292f", muted: "#8c959f", keyword: "#cf222e", string: "#0a3069", number: "#0550ae", comment: "#6e7781", fn: "#8250df", prompt: "#1a7f37", output: "#57606a", edge: "#d0d7de" };
const TERM: CodePalette = { ...DARK, bg: "#080b08", bar: "#141a14", text: "#d8f3dc", muted: "#6b8f72", output: "#9db8a3", edge: "#1f2a1f" };
const KEYWORDS = new Set(
  "const let var function return if else for while do switch case break continue new class extends import export from default async await try catch finally throw typeof instanceof in of yield def lambda pass elif not and or is None True False self print select from where join on group by order having insert into values update set delete create table index primary key foreign references as limit offset distinct null true false public private static void int string bool fn let mut impl struct enum match use mod pub get post put patch".split(" "),
);

export type CodeLook = "window" | "tabs" | "card" | "light" | "terminal";
const CONFIG_LANGS = new Set(["yaml", "yml", "json", "toml", "ini", "dockerfile", "env", "xml", "html", "css"]);

/** Which of the five panels a snippet gets: its own look=, else what suits it (a terminal, a config file, a few lines, a program). */
export function codeLook(el: ElementIR, lineCount: number): CodeLook {
  const set = String(el.params.look ?? "");
  if (set === "window" || set === "tabs" || set === "card" || set === "light" || set === "terminal") return set;
  if (el.kind === "terminal") return "terminal";
  if (CONFIG_LANGS.has(String(el.params.lang ?? "").toLowerCase())) return "tabs";
  return lineCount <= 3 ? "card" : "window";
}

/** Splits one line of code into colored tokens (strings, comments, numbers, keywords, calls, the rest). */
function tokens(line: string, terminal: boolean, pal: CodePalette): { text: string; color: string }[] {
  if (terminal) {
    if (line.startsWith("$ ")) return [{ text: "$ ", color: pal.prompt }, { text: line.slice(2), color: pal.text }];
    return [{ text: line, color: pal.output }];
  }
  const out: { text: string; color: string }[] = [];
  const re = /(\/\/.*$|#.*$|--.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)(?=\s*\()|([A-Za-z_][A-Za-z0-9_]*)|(\s+|.)/g;
  for (const m of line.matchAll(re)) {
    const [t, comment, str, num, call, word] = m;
    const color = comment ? pal.comment : str ? pal.string : num ? pal.number : call ? pal.fn : word && KEYWORDS.has(word.toLowerCase()) ? pal.keyword : pal.text;
    out.push({ text: t, color });
  }
  return out;
}

/**
 * A code or terminal panel in one of five looks (window, tabs, card, light, terminal). Each line is a part
 * (`code.3`) with a bar behind it, a sign in the gutter (+ added, − removed, ▶ current), a strike-through and
 * a caret; the stage drives them: `write` types, `visit` lights one line, `mark` leaves a status, `strike` crosses out.
 */
function codePanel(doc: Document, inst: Instance, g: SVGGElement, el: ElementIR, theme: Theme): void {
  const { w, h } = el.box;
  const terminal = el.kind === "terminal";
  const lines = (el.texts[0] ?? "").split("\n");
  const look = codeLook(el, lines.length);
  const pal = look === "light" ? LIGHT : look === "terminal" ? TERM : DARK;
  const barH = look === "card" ? 0 : look === "terminal" ? 40 : 44;
  const numbered = !terminal && look !== "card";
  const padX = terminal ? 28 : numbered ? 72 : 36;
  const longest = Math.max(8, ...lines.map((l) => l.length));
  const top0 = barH ? 18 : 30;
  const font = Math.max(14, Math.min(40, (h - barH - top0 - 18) / (lines.length * 1.55), (w - padX - 28) / (longest * 0.6)));
  const lh = font * 1.55;
  const cw = font * 0.6;
  const radius = Math.min(theme.radius + 6, 18);
  const mono = theme.mono;
  g.append(svg(doc, "rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: radius, fill: pal.bg, stroke: look === "light" || look === "card" ? pal.edge : "none", "stroke-width": 2 }));
  const label = (txt: string, attrs: Record<string, string | number>) => {
    const t = svg(doc, "text", { "font-size": 18, "font-family": mono, fill: pal.muted, stroke: "none", ...attrs });
    t.textContent = txt;
    g.append(t);
  };
  if (barH) {
    g.append(svg(doc, "path", { d: `M${round(-w / 2)} ${round(-h / 2 + barH)}V${round(-h / 2 + radius)}a${radius} ${radius} 0 0 1 ${radius} ${-radius}H${round(w / 2 - radius)}a${radius} ${radius} 0 0 1 ${radius} ${radius}V${round(-h / 2 + barH)}Z`, fill: pal.bar, stroke: "none" }));
  }
  const tag = terminal ? "terminal" : String(el.params.lang ?? "") || "code";
  if (look === "window" || look === "light") {
    ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => g.append(svg(doc, "circle", { cx: round(-w / 2 + 26 + i * 22), cy: round(-h / 2 + barH / 2), r: 6.5, fill: c, stroke: "none" })));
    label(tag, { x: round(w / 2 - 20), y: round(-h / 2 + barH / 2 + 6), "text-anchor": "end" });
  } else if (look === "terminal") {
    ["#3a463c", "#3a463c", "#3a463c"].forEach((c, i) => g.append(svg(doc, "circle", { cx: round(-w / 2 + 26 + i * 22), cy: round(-h / 2 + barH / 2), r: 6, fill: c, stroke: "none" })));
    label("bash", { x: 0, y: round(-h / 2 + barH / 2 + 6), "text-anchor": "middle" });
  } else if (look === "tabs") {
    const file = String(el.params.file ?? "") || `main.${String(el.params.lang ?? "") || "txt"}`;
    const tabW = Math.min(w - 40, 40 + file.length * 11);
    g.append(svg(doc, "path", { d: `M${round(-w / 2 + 14)} ${round(-h / 2 + barH)}V${round(-h / 2 + 12)}a8 8 0 0 1 8 -8H${round(-w / 2 + 14 + tabW - 8)}a8 8 0 0 1 8 8V${round(-h / 2 + barH)}Z`, fill: pal.bg, stroke: "none" }));
    g.append(svg(doc, "rect", { x: round(-w / 2 + 14), y: round(-h / 2 + 4), width: tabW, height: 3, rx: 1.5, fill: theme.accent, stroke: "none" }));
    label(file, { x: round(-w / 2 + 30), y: round(-h / 2 + barH / 2 + 8), fill: pal.text });
  } else {
    // card: no title bar, just the language in a corner
    label(tag, { x: round(w / 2 - 20), y: round(-h / 2 + 30), "text-anchor": "end" });
  }
  if (look === "tabs") g.append(svg(doc, "rect", { x: round(-w / 2 + padX - 10), y: round(-h / 2 + barH), width: 1.5, height: round(h - barH), fill: pal.edge, stroke: "none" }));
  const top = -h / 2 + barH + top0;
  const anim = String(el.params.anim ?? "type");
  lines.forEach((line, i) => {
    const y = top + i * lh;
    const part = svg<SVGGElement>(doc, "g", { "data-part": String(i + 1), "data-anim": anim, "data-dark": pal === LIGHT ? "0" : "1", "data-x0": round(-w / 2 + padX), "data-cw": round(cw, 3), "data-len": line.length });
    const bar = svg(doc, "rect", { x: round(-w / 2 + 6), y: round(y), width: round(w - 12), height: round(lh), rx: 6, fill: theme.accent, stroke: "none", opacity: 0, "data-bar": "" });
    part.append(bar);
    // The sign in the gutter: + for a line added, − for one removed, ▶ for the line being talked about.
    const sign = svg(doc, "text", { x: round(-w / 2 + 17), y: round(y + lh * 0.7), "text-anchor": "middle", "font-size": round(font * 0.7), "font-family": mono, fill: pal.muted, stroke: "none", opacity: 0, "data-sign": "" });
    part.append(sign);
    if (numbered) {
      const num = svg(doc, "text", { x: round(-w / 2 + padX - 22), y: round(y + lh * 0.7), "text-anchor": "end", "font-size": round(font * 0.8), "font-family": mono, fill: pal.muted, stroke: "none" });
      num.textContent = String(i + 1);
      part.append(num);
    }
    const t = svg(doc, "text", { x: round(-w / 2 + padX), y: round(y + lh * 0.7), "font-size": round(font), "font-family": mono, stroke: "none", "xml:space": "preserve" });
    t.setAttribute("style", "white-space: pre");
    const chars: Element[] = [];
    let col = 0;
    for (const tok of tokens(line, terminal, pal)) {
      for (const ch of tok.text) {
        const c = svg(doc, "tspan", { fill: tok.color, "data-i": col++ });
        c.textContent = ch;
        t.append(c);
        if (ch !== " ") {
          inst.chars.push(c);
          chars.push(c);
        }
      }
    }
    part.append(t);
    part.append(svg(doc, "rect", { x: round(-w / 2 + padX), y: round(y + lh * 0.52), width: 0, height: 3, rx: 1.5, fill: pal.keyword, stroke: "none", opacity: 0, "data-strike": "" }));
    part.append(svg(doc, "rect", { x: round(-w / 2 + padX), y: round(y + lh * 0.16), width: round(font * 0.12, 2), height: round(font * 1.1), fill: pal.text, stroke: "none", opacity: 0, "data-caret": "" }));
    inst.lines.push(chars);
    addPart(inst, String(i + 1), part);
    g.append(part);
  });
  shadow(g, theme);
}

/**
 * An icon in the look's style. The glyph sits on a 24-unit grid; with a
 * backing it is drawn smaller, centred on a circle or rounded square.
 * A glyph with a fill of its own (water is blue, fire is red) keeps that
 * color and gives it to the backing.
 */
function iconArt(doc: Document, holder: SVGElement, markup: string, theme: Theme, hue: string | undefined, k: number): void {
  const own = /data-fill="(\w+)"/.exec(markup)?.[1];
  const c = own ? color(theme, own) : (hue ?? theme.fg);
  const style = theme.iconStyle;
  if (style === "plain") {
    holder.innerHTML = markup;
    if (hue && !own) holder.setAttribute("stroke", c);
    return;
  }
  const square = theme.iconShape === "square";
  const shape = (inset: number, attrs: Record<string, string | number>) =>
    square ? svg(doc, "rect", { x: inset, y: inset, width: 24 - 2 * inset, height: 24 - 2 * inset, rx: Math.min(theme.radius / k, 5), ...attrs }) : svg(doc, "circle", { cx: 12, cy: 12, r: 12 - inset, ...attrs });
  const tinted = `color-mix(in srgb, ${c} 14%, ${theme.bg})`;
  if (style === "block") {
    // Hard offset shadow, then a solid block with a dark outline.
    const off = 5 / k;
    const shade = shape(0.6, { fill: theme.fg, stroke: "none", transform: `translate(${round(off, 3)} ${round(off, 3)})`, "data-solid": "", "data-fill": theme.fg });
    holder.append(shade, shape(0.6, { "data-fill": c === theme.fg ? theme.surface : c, "data-solid": "", stroke: theme.fg }));
  } else if (style === "solid") {
    holder.append(shape(0.4, { "data-fill": c, "data-solid": "", stroke: "none" }));
  } else if (style === "outline") {
    holder.append(shape(0.6, { "data-fill": theme.surface, "data-solid": "", stroke: c }));
  } else {
    holder.append(shape(0.4, { "data-fill": tinted, "data-solid": "", stroke: "none" }));
  }
  const s = 0.56;
  const glyph = svg(doc, "g", { transform: `translate(12 12) scale(${s}) translate(-12 -12)`, stroke: style === "solid" ? "#ffffff" : style === "block" ? theme.fg : c, "stroke-width": round(Math.max(theme.stroke * 0.9, 2.4) / (k * s), 3) });
  // On a solid backing the glyph is a plain outline; its own fill would vanish into the backing.
  glyph.innerHTML = style === "solid" || style === "block" ? markup.replace(/\sdata-fill="\w+"/g, "") : markup;
  holder.append(glyph);
}

function connector(doc: Document, inst: Instance, g: SVGGElement, el: ElementIR, theme: Theme): void {
  // Lines a template draws by itself (spokes, leader lines) stay quiet.
  const quiet = el.params.tone === "muted";
  // A line with a color index (a git branch) is drawn thick in that color.
  const hued = el.kind === "line" && el.params.hue !== undefined ? itemColor(theme, Number(el.params.hue)) : undefined;
  // Dashes are in path-length units (the stroke is normalized for `draw`): a few percent of the line.
  const kit = theme.kit;
  const dashed = el.params.style === "dashed" || kit === "dashed";
  const path = stroke(inst, svg(doc, "path", {
    d: "M0 0",
    ...(dashed && { "stroke-dasharray": "0.025 0.02" }),
    ...(kit === "soft" && !dashed && { "stroke-dasharray": "0.002 0.022", "stroke-linecap": "round", "stroke-width": theme.stroke * 1.5 }),
    ...(kit === "bold" && { "stroke-width": theme.stroke * 1.7 }),
    ...(quiet && { stroke: theme.muted, "stroke-opacity": 0.7 }),
    ...(hued && { stroke: hued, "stroke-width": 6 }),
  })) as SVGPathElement;
  g.append(path);
  const c: NonNullable<Instance["connector"]> = { from: el.link!.from, to: el.link!.to, path };
  if (el.kind !== "line") {
    c.head = svg(doc, "path", { d: "M0 0", fill: quiet ? theme.muted : theme.fg, stroke: "none" }) as SVGPathElement;
    g.append(c.head);
  }
  // The packet a `send` moves along the connector (hidden until then).
  c.token = svg(doc, "circle", { r: 12, cx: 0, cy: 0, fill: theme.accent, stroke: theme.bg, "stroke-width": 4, opacity: 0 }) as SVGCircleElement;
  g.append(c.token);
  if (el.texts[0]) {
    const row = el.params.route === "row";
    c.label = svg(doc, "text", { "text-anchor": "middle", "font-size": row ? 30 : FONT.edge!, "font-family": row ? theme.mono : theme.font, fill: theme.muted, stroke: theme.bg, "stroke-width": 9, "stroke-linejoin": "round", "paint-order": "stroke" }) as SVGTextElement; // the halo keeps lines and borders out of the text
    c.label.textContent = el.texts[0];
    inst.innerText.push(c.label);
    g.append(c.label);
  }
  inst.connector = c;
}

// ------------------------------------------------------------------ html ---

function buildHtml(doc: Document, el: ElementIR, theme: Theme, inst: Instance): HTMLElement {
  const div = doc.createElement("div");
  div.dataset.id = el.id;
  div.dataset.kind = el.kind;
  Object.assign(div.style, {
    position: "absolute",
    left: "0px",
    top: "0px",
    width: `${el.box.w}px`,
    height: `${el.box.h}px`,
    boxSizing: "border-box",
    fontFamily: theme.font,
    color: theme.fg,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    transformOrigin: "50% 50%",
  });
  if (el.kind === "card") {
    Object.assign(div.style, { background: theme.surface, border: `${theme.stroke}px solid ${theme.fg}`, borderRadius: `${theme.radius + 4}px`, padding: "24px 28px", gap: "10px", textAlign: "left" });
    if (shadowFilter(theme)) div.dataset.shadow = shadowFilter(theme);
    const head = doc.createElement("div");
    head.textContent = el.texts[0] ?? "";
    Object.assign(head.style, { fontFamily: theme.headingFont, fontWeight: String(theme.headingWeight), fontSize: "38px", lineHeight: "1.15", textTransform: theme.headingCase === "upper" ? "uppercase" : "none" });
    const body = doc.createElement("div");
    body.textContent = el.texts[1] ?? "";
    Object.assign(body.style, { fontSize: "28px", lineHeight: "1.3", color: theme.muted });
    div.append(head, body);
    addPart(inst, "head", head);
    addPart(inst, "body", body);
    for (const node of [head, body]) inst.chars.push(node);
  } else {
    Object.assign(div.style, { alignItems: "center", fontSize: `${Math.min(64, (el.box.h * 0.5) | 0)}px`, fontFamily: `"Cambria Math", "STIX Two Math", Georgia, serif`, fontStyle: "italic", whiteSpace: "nowrap" });
    div.textContent = el.texts[0] ?? "";
    inst.chars.push(div);
  }
  return div;
}

// --------------------------------------------------------------- helpers ---

export function svg<T extends SVGElement = SVGElement>(doc: Document, tag: string, attrs: Record<string, string | number>): T {
  const node = doc.createElementNS(SVG_NS, tag) as T;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Registers a shape for `draw` (pathLength-normalized dashes) and theme fills. */
function stroke(inst: Instance, shape: SVGElement): SVGElement {
  shape.setAttribute("pathLength", "1");
  shape.setAttribute("data-d", "");
  // Remember authored dashes; `draw` temporarily replaces them.
  const dash = shape.getAttribute("stroke-dasharray");
  if (dash) shape.setAttribute("data-dash", dash);
  inst.strokes.push(shape);
  if (shape.hasAttribute("data-fill")) inst.fills.push(shape);
  else shape.setAttribute("fill", "none");
  return shape;
}

function addPart(inst: Instance, name: string, node: Element): void {
  const list = inst.parts.get(name);
  if (list) list.push(node);
  else inst.parts.set(name, [node]);
}

export function round(n: number, digits = 2): number {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
}

/** Resolves `data-fill` tokens to theme colors once, at build time. */
export function paintFills(inst: Instance, theme: Theme): void {
  for (const f of inst.fills) {
    const token = f.getAttribute("data-fill")!;
    // A concrete color (an icon backing) is used as is.
    f.setAttribute("fill", /^(#|rgb|color-mix)/.test(token) ? token : color(theme, token));
  }
}

export type { Box };
