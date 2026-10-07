import type { Box, ElementIR } from "@anim/ir";
import { ICONS, ILLUSTRATIONS } from "./art.js";
import { color, shadowFilter, type Theme } from "./theme.js";
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
  /** Connectors are re-routed every frame between their endpoints. */
  connector?: { from: string; to: string; path: SVGPathElement; head?: SVGPathElement; label?: SVGTextElement };
}

const CHAR_W = 0.55;
const FONT: Record<string, number> = { title: 80, text: 44, label: 34, node: 32, list: 40, box: 36, circle: 32, placeholder: 28, edge: 26, arrow: 26, line: 26, icon: 30, asset: 32 };

/** `ids` prefixes any SVG ids the element defines (clip paths), unique per stage. */
export function build(doc: Document, el: ElementIR, theme: Theme, ids = `anim-${el.id}`): Instance {
  const inst: Instance = { el, layer: el.layer, root: undefined!, parts: new Map(), strokes: [], fills: [], chars: [], lines: [], innerText: [] };
  if (el.layer === "html") {
    inst.root = buildHtml(doc, el, theme, inst);
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
      const font = left ? Math.min(FONT[el.kind]!, h * 0.85) : FONT[el.kind]!;
      g.append(text(doc, inst, el.texts[0] ?? "", font, w, h, theme, { heading: el.kind === "title", parts: true, align: left ? "left" : "center", ...(el.params.tone === "muted" && { fill: theme.muted }) }));
      break;
    }
    case "list":
      g.append(list(doc, inst, el.texts[0] ?? "", w, h, theme));
      break;
    case "box":
    case "node":
    case "placeholder": {
      const r = svg(doc, "rect", { x: -w / 2, y: -h / 2, width: w, height: h, rx: Math.min(theme.radius + (el.kind === "node" ? 4 : 0), h / 2), "data-fill": "surface" });
      shadow(g, theme);
      if (el.kind === "placeholder") r.setAttribute("stroke-dasharray", "10 8");
      g.append(stroke(inst, r));
      const label = el.texts[0];
      if (label) g.append(text(doc, inst, label, FONT[el.kind]!, w - 32, h - 20, theme, { inner: true }));
      break;
    }
    case "circle": {
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
    if (lines.length * f * 1.25 <= maxH || f < 10) return { lines, font: f };
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
  const labelH = label ? 56 : 0;
  const size = Math.max(10, Math.min(el.box.w, el.box.h - labelH));
  const k = size / grid;
  const holder = svg(doc, "g", { transform: `translate(${round(-size / 2)} ${round(-el.box.h / 2)}) scale(${round(k, 4)})`, "stroke-width": round(theme.stroke / k, 3) });
  if (markup) {
    holder.innerHTML = markup;
  } else {
    holder.append(svg(doc, "rect", { x: 2, y: 2, width: grid - 4, height: grid - 4, rx: grid / 8, "stroke-dasharray": `${grid / 10} ${grid / 14}` }));
  }
  g.append(holder);
  for (const shape of holder.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon")) stroke(inst, shape as SVGElement);
  for (const p of holder.querySelectorAll("[data-part]")) addPart(inst, p.getAttribute("data-part")!, p);
  if (label) {
    const t = text(doc, inst, label, FONT[kind]!, el.box.w, labelH, theme, {});
    t.setAttribute("transform", `translate(0 ${round(el.box.h / 2 - labelH / 2)})`);
    g.append(t);
  }
}

function connector(doc: Document, inst: Instance, g: SVGGElement, el: ElementIR, theme: Theme): void {
  const path = stroke(inst, svg(doc, "path", { d: "M0 0", ...(el.params.style === "dashed" && { "stroke-dasharray": "12 10" }) })) as SVGPathElement;
  g.append(path);
  const c: NonNullable<Instance["connector"]> = { from: el.link!.from, to: el.link!.to, path };
  if (el.kind !== "line") {
    c.head = svg(doc, "path", { d: "M0 0", fill: theme.fg, stroke: "none" }) as SVGPathElement;
    g.append(c.head);
  }
  if (el.texts[0]) {
    c.label = svg(doc, "text", { "text-anchor": "middle", "font-size": FONT.edge!, "font-family": theme.font, fill: theme.muted, stroke: "none", "paint-order": "stroke" }) as SVGTextElement;
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
  for (const f of inst.fills) f.setAttribute("fill", color(theme, f.getAttribute("data-fill")!));
}

export type { Box };
