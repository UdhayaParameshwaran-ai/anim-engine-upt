import { findPlace, flowNodes } from "@anim/registry";
import type { ElementIR } from "@anim/ir";
import { fitText, round, svg, type Instance } from "./components.js";
import type { Theme } from "./theme.js";

/**
 * Grid elements from the Template Rule Book v2. Each one draws itself
 * inside its slot (origin at the slot center) in tone and pattern rather
 * than hue, and plays its signature motion as `draw` goes from 0 to 1:
 * stats count up, bars grow, ticks draw, items enter in turn.
 *
 * Motion functions set every attribute they own on every call, so a frame
 * depends only on the draw value, never on earlier frames.
 */

export const WIDGET_KINDS = new Set([
  "stat", "multistat", "gauge", "scorecard", "progress", "body", "quote", "callout", "definition", "proscons",
  "bullets", "numbered", "checklist", "table", "comparison", "stepper", "timeline", "flowchart", "funnel", "cycle",
  "matrix", "image", "video", "avatar", "logo", "map", "footer", "chart",
]);

type Motion = (k: number) => void;

interface Ctx {
  doc: Document;
  inst: Instance;
  theme: Theme;
  el: ElementIR;
  g: SVGGElement;
  w: number;
  h: number;
  /** Left and top edges in local coordinates. */
  L: number;
  T: number;
  /** Prefix for SVG ids (unique per stage and element). */
  ids: string;
}

export function buildWidget(doc: Document, inst: Instance, g: SVGGElement, el: ElementIR, theme: Theme, ids: string): void {
  const { w, h } = el.box;
  const c: Ctx = { doc, inst, theme, el, g, w, h, L: -w / 2, T: -h / 2, ids };
  // Builds are synchronous, so text() and textHeight() measure alike.
  charW = theme.charW;
  fontScale = theme.fontScale;
  const kind = el.kind === "chart" ? `chart:${el.component.split(":")[1] ?? "bar"}` : el.kind;
  const build = BUILDERS[kind] ?? BUILDERS.body!;
  inst.motion = build(c);
}

// --------------------------------------------------------------- helpers ---

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const out = (x: number) => 1 - (1 - clamp01(x)) ** 3;
const items = (s = "") => s.split(";").map((x) => x.trim()).filter(Boolean);
const fields = (s: string) => s.split("|").map((x) => x.trim());

/** Progress of item i of n when items enter in turn (overlapping by `overlap`). */
function stagger(k: number, i: number, n: number, overlap = 0.4): number {
  if (n <= 1) return clamp01(k);
  const span = 1 / (1 + (n - 1) * (1 - overlap));
  return clamp01((k - i * span * (1 - overlap)) / span);
}

/** Progress of k within [a, b]. */
const phase = (k: number, a: number, b: number) => clamp01((k - a) / (b - a));

function node<T extends SVGElement = SVGElement>(c: Ctx, tag: string, attrs: Record<string, string | number>, parent: Element = c.g): T {
  const n = svg<T>(c.doc, tag, attrs);
  parent.append(n);
  return n;
}

interface TextOpts {
  size: number;
  weight?: number;
  anchor?: "start" | "middle" | "end";
  fill?: string;
  mono?: boolean;
  /** Wrap within this width (and shrink to fit maxH). */
  maxW?: number;
  maxH?: number;
  upper?: boolean;
  lineHeight?: number;
}

/** Text whose first line's baseline sits at y + size·0.8 (so y is the top of the text). */
function text(c: Ctx, content: string, x: number, y: number, opts: TextOpts, parent: Element = c.g): SVGTextElement {
  const o = scaled(opts);
  const str = o.upper ? content.toUpperCase() : content;
  const lh = o.lineHeight ?? 1.25;
  const fitted = o.maxW ? fitText(str, o.size, o.maxW, o.maxH ?? o.size * lh * 8, charW) : { lines: [str], font: o.size };
  // Bold text (values, headings) uses the look's display face.
  const display = !o.mono && (o.weight ?? 400) >= 700;
  const t = node<SVGTextElement>(c, "text", {
    "font-size": round(fitted.font),
    "font-family": o.mono ? (o.size >= 56 ? c.theme.numbers : c.theme.mono) : display ? c.theme.headingFont : c.theme.font,
    "font-weight": display ? Math.max(o.weight ?? 400, c.theme.headingWeight) : (o.weight ?? 400),
    "text-anchor": o.anchor ?? "start",
    fill: o.fill ?? c.theme.fg,
    stroke: "none",
    ...(o.mono && o.upper && { "letter-spacing": round(fitted.font * 0.08) }),
  }, parent);
  fitted.lines.forEach((line, i) => {
    const s = svg(c.doc, "tspan", { x: round(x), y: round(y + fitted.font * 0.8 + i * fitted.font * lh) });
    s.textContent = line;
    t.append(s);
  });
  return t;
}

/** Height a wrapped text block will take. */
function textHeight(content: string, opts: TextOpts): number {
  const o = scaled(opts);
  const lh = o.lineHeight ?? 1.25;
  if (!o.maxW) return o.size * lh;
  const f = fitText(content, o.size, o.maxW, o.maxH ?? o.size * lh * 8, charW);
  return f.lines.length * f.font * lh;
}

/** The current look's glyph width estimate and size multiplier (set per build). */
let charW = 0.55;
let fontScale = 1;
const scaled = (o: TextOpts): TextOpts => (fontScale === 1 ? o : { ...o, size: o.size * fontScale });

const rule = (c: Ctx, x1: number, y1: number, x2: number, y2: number, parent: Element = c.g, width = 1.5) =>
  node(c, "line", { x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2), stroke: c.theme.muted, "stroke-opacity": 0.45, "stroke-width": width }, parent);

/** A group whose opacity/transform the motion owns; parts are registered on a wrapper so emphasis never fights it. */
function item(c: Ctx, part?: string): { outer: SVGGElement; inner: SVGGElement } {
  const outer = node<SVGGElement>(c, "g", part ? { "data-part": part } : {});
  const inner = node<SVGGElement>(c, "g", {}, outer);
  if (part) addPart(c.inst, part, outer);
  return { outer, inner };
}

function addPart(inst: Instance, name: string, n: Element): void {
  const list = inst.parts.get(name);
  if (list) list.push(n);
  else inst.parts.set(name, [n]);
}

function setVis(n: Element, opacity: number, dx = 0, dy = 0, scale = 1, cx = 0, cy = 0): void {
  n.setAttribute("opacity", String(round(opacity, 3)));
  const parts: string[] = [];
  if (dx || dy) parts.push(`translate(${round(dx)} ${round(dy)})`);
  if (scale !== 1) parts.push(`translate(${round(cx)} ${round(cy)}) scale(${round(scale, 4)}) translate(${round(-cx)} ${round(-cy)})`);
  if (parts.length) n.setAttribute("transform", parts.join(" "));
  else n.removeAttribute("transform");
}

/**
 * Left-to-right wipe of the band [y, y+h]: the element is clipped to
 * everything above and below the band plus the revealed part of it, so
 * whatever is behind (gradients, patterns) stays visible.
 */
function wipe(c: Ctx, x: number, y: number, w: number, h: number): (k: number) => void {
  const id = `${c.ids}-wipe`;
  const clip = svg(c.doc, "clipPath", { id });
  const far = 4000; // content may overflow the box a little; keep it outside the band visible
  clip.append(
    svg(c.doc, "rect", { x: -far, y: -far, width: far * 2, height: round(y + far) }),
    svg(c.doc, "rect", { x: -far, y: round(y + h), width: far * 2, height: far }),
  );
  const shown = svg(c.doc, "rect", { x: round(x), y: round(y), width: 0, height: round(h) });
  clip.append(shown);
  c.g.prepend(clip);
  c.g.setAttribute("clip-path", `url(#${id})`);
  return (k) => {
    const p = out(k);
    shown.setAttribute("width", String(round(w * p)));
    // Fully revealed: drop the clip so nothing (shadows, overflow) is cut.
    if (p >= 1) c.g.removeAttribute("clip-path");
    else c.g.setAttribute("clip-path", `url(#${id})`);
  };
}

/** Stroke path drawn by `pathLength` dashes. */
function drawn(c: Ctx, tag: string, attrs: Record<string, string | number>, parent: Element = c.g): (k: number) => void {
  const n = node(c, tag, { ...attrs, pathLength: 1, fill: attrs.fill ?? "none" }, parent);
  return (k) => {
    if (k >= 1) {
      n.removeAttribute("stroke-dasharray");
      n.removeAttribute("stroke-dashoffset");
    } else {
      n.setAttribute("stroke-dasharray", "1 1");
      n.setAttribute("stroke-dashoffset", String(round(1 - clamp01(k), 4)));
    }
  };
}

/** "95%" at progress k: the number counts up, prefix/suffix and formatting kept. */
export function countUp(target: string, k: number): string {
  const m = /^(.*?)(-?\d[\d,]*\.?\d*)(.*)$/.exec(target);
  if (!m) return target;
  const raw = m[2]!;
  const value = parseFloat(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return target;
  const decimals = (raw.split(".")[1] ?? "").length;
  let s = (value * clamp01(k)).toFixed(decimals);
  if (raw.includes(",")) s = s.replace(/^(-?\d+)/, (d) => d.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
  return `${m[1]}${s}${m[3]}`;
}

const numberOf = (s: string) => parseFloat(s.replace(/[^\d.-]/g, "")) || 0;

/** Tones from ink to paper, for series and slices. */
function tone(c: Ctx, i: number): string {
  const mix = [100, 62, 38, 22, 12][i % 5]!;
  return `color-mix(in srgb, ${c.theme.ink} ${mix}%, ${c.theme.toneBase === "fg" ? c.theme.fg : c.theme.bg})`;
}

// --------------------------------------------------------------- builders ---

type Builder = (c: Ctx) => Motion;

const BUILDERS: Record<string, Builder> = {
  stat(c) {
    const value = c.el.texts[0] ?? "";
    const label = c.el.texts[1] ?? "";
    const size = Math.min(c.h * 0.5, (c.w * 0.92) / Math.max(1, value.length * 0.62));
    const labelSize = Math.max(22, Math.min(32, c.h * 0.11));
    const total = size * 1.05 + (label ? labelSize * 2.6 + 16 : 0);
    const top = -total / 2;
    const num = item(c);
    const t = text(c, value, c.L + c.w * 0.04, top, { size, weight: 700, mono: true }, num.inner);
    const lab = item(c);
    if (label) text(c, label, c.L + c.w * 0.04, top + size * 1.05 + 16, { size: labelSize, fill: c.theme.muted, maxW: c.w * 0.92, maxH: labelSize * 2.6 }, lab.inner);
    const span = t.firstElementChild!;
    return (k) => {
      span.textContent = countUp(value, out(phase(k, 0, 0.8)));
      const pop = k > 0.8 && k < 1 ? 1 + 0.05 * Math.sin(phase(k, 0.8, 1) * Math.PI) : 1;
      setVis(num.inner, k > 0 ? 1 : 0, 0, 0, pop, c.L + c.w * 0.04, top + size / 2);
      setVis(lab.inner, out(phase(k, 0.3, 0.8)));
    };
  },

  multistat(c) {
    const values = items(c.el.texts[0]);
    const labels = items(c.el.texts[1]);
    const n = Math.max(1, values.length);
    const cw = c.w / n;
    const size = Math.min(c.h * 0.42, (cw * 0.85) / Math.max(1, Math.max(...values.map((v) => v.length)) * 0.62));
    const labelSize = Math.max(20, Math.min(28, c.h * 0.12));
    const top = -(size * 1.05 + labelSize * 1.4 + 12) / 2;
    const spans: { span: Element; inner: SVGGElement; value: string }[] = [];
    values.forEach((v, i) => {
      const x = c.L + i * cw + (i ? 28 : 0);
      if (i) rule(c, c.L + i * cw, c.T + c.h * 0.15, c.L + i * cw, c.T + c.h * 0.85);
      const it = item(c, String(i + 1));
      const t = text(c, v, x, top, { size, weight: 700, mono: true }, it.inner);
      if (labels[i]) text(c, labels[i]!, x, top + size * 1.05 + 12, { size: labelSize, fill: c.theme.muted, maxW: cw - 40 }, it.inner);
      spans.push({ span: t.firstElementChild!, inner: it.inner, value: v });
    });
    return (k) =>
      spans.forEach((s, i) => {
        const p = stagger(k, i, n, 0.3);
        s.span.textContent = countUp(s.value, out(p));
        setVis(s.inner, p > 0 ? out(phase(p, 0, 0.25)) : 0);
      });
  },

  gauge(c) {
    const value = c.el.texts[0] ?? "0";
    const label = c.el.texts[1] ?? "";
    const max = Number(c.el.params.max ?? 100) || 100;
    const frac = clamp01(numberOf(value) / max);
    const labelH = label ? 48 : 0;
    const r = Math.min(c.w, c.h - labelH) / 2 - 20;
    const cy = -labelH / 2;
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const arc = (to: number) => {
      const a1 = a0 + sweep * to;
      const [x0, y0] = [Math.cos(a0) * r, cy + Math.sin(a0) * r];
      const [x1, y1] = [Math.cos(a1) * r, cy + Math.sin(a1) * r];
      return `M${round(x0)} ${round(y0)}A${round(r)} ${round(r)} 0 ${sweep * to > Math.PI ? 1 : 0} 1 ${round(x1)} ${round(y1)}`;
    };
    node(c, "path", { d: arc(1), stroke: c.theme.muted, "stroke-opacity": 0.3, "stroke-width": Math.max(10, r * 0.12), fill: "none", "stroke-linecap": "butt" });
    const valueArc = drawn(c, "path", { d: arc(Math.max(frac, 0.001)), stroke: c.theme.ink, "stroke-width": Math.max(10, r * 0.12), "stroke-linecap": "butt" });
    const size = Math.min(r * 0.6, (r * 1.4) / Math.max(1, value.length * 0.62));
    const t = text(c, value, 0, cy - size * 0.55, { size, weight: 700, mono: true, anchor: "middle" });
    if (label) text(c, label, 0, c.h / 2 - labelH + 8, { size: 26, fill: c.theme.muted, anchor: "middle", maxW: c.w * 0.9, maxH: 40 });
    text(c, "0", Math.cos(a0) * r, cy + Math.sin(a0) * r + 18, { size: 18, mono: true, anchor: "middle", fill: c.theme.muted });
    text(c, String(max), Math.cos(a0 + sweep) * r, cy + Math.sin(a0 + sweep) * r + 18, { size: 18, mono: true, anchor: "middle", fill: c.theme.muted });
    const span = t.firstElementChild!;
    return (k) => {
      valueArc(out(k));
      span.textContent = countUp(value, out(k));
    };
  },

  scorecard(c) {
    const value = numberOf(c.el.texts[0] ?? "0");
    const max = Math.min(10, Number(c.el.params.max ?? 5) || 5);
    const label = c.el.texts[1] ?? "";
    const size = Math.min(c.h * 0.36, 120);
    const top = -c.h / 2 + c.h * 0.12;
    text(c, `${c.el.texts[0] ?? ""}/${max}`, c.L + 24, top, { size, weight: 700, mono: true });
    const m = Math.min((c.w - 48) / max - 12, c.h * 0.2);
    const y = top + size * 1.15;
    const marks: SVGElement[] = [];
    for (let i = 0; i < max; i++) {
      const it = item(c, String(i + 1));
      node(c, "rect", { x: round(c.L + 24 + i * (m + 12)), y: round(y), width: round(m), height: round(m), fill: "none", stroke: c.theme.fg, "stroke-width": 2 }, it.inner);
      marks.push(node(c, "rect", { x: round(c.L + 24 + i * (m + 12) + 5), y: round(y + 5), width: round(m - 10), height: round(m - 10), fill: c.theme.ink, stroke: "none" }, it.inner));
    }
    if (label) text(c, label, c.L + 24, y + m + 18, { size: 26, fill: c.theme.muted, maxW: c.w - 48, maxH: 40 });
    return (k) =>
      marks.forEach((mk, i) => {
        const filled = Math.min(1, Math.max(0, value - i));
        mk.setAttribute("opacity", String(round(filled * out(stagger(k, i, max, 0.5)), 3)));
      });
  },

  progress(c) {
    const value = c.el.texts[0] ?? "0%";
    const label = c.el.texts[1] ?? "";
    const frac = clamp01(numberOf(value) / (value.includes("%") || numberOf(value) > 1 ? 100 : 1));
    const barH = Math.max(14, Math.min(28, c.h * 0.16));
    const y = c.h * 0.08;
    if (label) text(c, label, c.L + 8, y - 64, { size: 28, maxW: c.w * 0.7, maxH: 40 });
    const t = text(c, value, c.L + c.w - 8, y - 64, { size: 30, weight: 700, mono: true, anchor: "end" });
    node(c, "rect", { x: round(c.L + 8), y: round(y), width: round(c.w - 16), height: round(barH), fill: c.theme.surface, stroke: c.theme.muted, "stroke-opacity": 0.45, "stroke-width": 1.5 });
    const fill = node(c, "rect", { x: round(c.L + 8), y: round(y), width: 0, height: round(barH), fill: c.theme.ink, stroke: "none" });
    const span = t.firstElementChild!;
    return (k) => {
      fill.setAttribute("width", String(round((c.w - 16) * frac * out(k))));
      span.textContent = countUp(value, out(k));
    };
  },

  body(c) {
    const size = Math.max(24, Math.min(30, c.h * 0.12));
    // Fit at the look's real size; text() scales again, so it gets the unscaled size back.
    const fitted = fitText(c.el.texts[0] ?? "", size * fontScale, c.w - 16, c.h - 16, charW);
    const lh = fitted.font * 1.4;
    const top = -(fitted.lines.length * lh) / 2;
    const lines = fitted.lines.map((line, i) => {
      const it = item(c);
      text(c, line, c.L + 8, top + i * lh, { size: fitted.font / fontScale }, it.inner);
      return it.inner;
    });
    return (k) => lines.forEach((ln, i) => {
      const p = out(stagger(k, i, lines.length, 0.6));
      setVis(ln, p, 0, 14 * (1 - p));
    });
  },

  quote(c) {
    const words = c.el.texts[0] ?? "";
    const source = c.el.texts[1] ?? "";
    const size = Math.max(30, Math.min(48, c.h * 0.16));
    const qh = textHeight(words, { size, maxW: c.w - 96, maxH: c.h - 120, lineHeight: 1.3 });
    const top = -(qh + (source ? 60 : 0)) / 2;
    node(c, "rect", { x: round(c.L + 8), y: round(top), width: 8, height: round(qh + (source ? 60 : 0)), fill: c.theme.ink, stroke: "none" });
    text(c, `“${words}”`, c.L + 48, top, { size, weight: 600, maxW: c.w - 96, maxH: c.h - 120, lineHeight: 1.3 });
    if (source) text(c, `— ${source}`, c.L + 48, top + qh + 22, { size: 20, mono: true, upper: true, fill: c.theme.muted, maxW: c.w - 96 });
    const w = wipe(c, c.L, -c.h / 2, c.w, c.h);
    return (k) => w(k);
  },

  callout(c) {
    const size = Math.max(26, Math.min(40, c.h * 0.2));
    const th = textHeight(c.el.texts[0] ?? "", { size, maxW: c.w - 96, maxH: c.h - 48 });
    const bh = Math.min(c.h, th + 56);
    node(c, "rect", { x: round(c.L), y: round(-bh / 2), width: round(c.w), height: round(bh), fill: c.theme.surface, stroke: "none" });
    node(c, "rect", { x: round(c.L), y: round(-bh / 2), width: 12, height: round(bh), fill: c.theme.ink, stroke: "none" });
    text(c, c.el.texts[0] ?? "", c.L + 44, -th / 2, { size, weight: 600, maxW: c.w - 96, maxH: c.h - 48 });
    const w = wipe(c, c.L, -c.h / 2, c.w, c.h);
    return (k) => w(k);
  },

  definition(c) {
    const term = c.el.texts[0] ?? "";
    const meaning = c.el.texts[1] ?? "";
    const tsize = Math.min(64, c.h * 0.26, (c.w * 0.9) / Math.max(1, term.length * 0.58));
    const mh = textHeight(meaning, { size: 28, maxW: c.w - 16, maxH: c.h * 0.5 });
    const top = -(tsize * 1.2 + 36 + mh) / 2;
    const t = item(c, "term");
    text(c, term, c.L + 8, top, { size: tsize, weight: 700 }, t.inner);
    rule(c, c.L + 8, top + tsize * 1.2 + 16, c.L + c.w - 8, top + tsize * 1.2 + 16, t.inner, 2);
    const m = item(c, "meaning");
    text(c, meaning, c.L + 8, top + tsize * 1.2 + 36, { size: 28, fill: c.theme.muted, maxW: c.w - 16, maxH: c.h * 0.5 }, m.inner);
    const w = wipe(c, c.L, top + tsize * 1.2 + 30, c.w, mh + 20);
    return (k) => {
      const p = out(phase(k, 0, 0.45));
      setVis(t.inner, p, 0, -18 * (1 - p));
      w(phase(k, 0.4, 1));
    };
  },

  proscons(c) {
    const cols = [items(c.el.texts[0]), items(c.el.texts[1])];
    const cw = (c.w - 48) / 2;
    const longest = Math.max(1, ...cols.map((l) => l.length));
    const lh = Math.min(72, (c.h - 72) / longest);
    // Both columns share a top edge; the block is centered vertically.
    const top = -(64 + longest * lh) / 2;
    const groups = cols.map((list, ci) => {
      const it = item(c, ci ? "cons" : "pros");
      const x = c.L + ci * (cw + 48);
      text(c, ci ? "Against" : "For", x, top + 12, { size: 20, mono: true, upper: true, weight: 600, fill: c.theme.muted }, it.inner);
      rule(c, x, top + 48, x + cw, top + 48, it.inner, 2);
      list.forEach((s, i) => {
        const y = top + 64 + i * lh;
        text(c, ci ? "−" : "+", x, y, { size: 30, weight: 700, mono: true }, it.inner);
        text(c, s, x + 36, y, { size: 28, maxW: cw - 40, maxH: lh - 8 }, it.inner);
      });
      return it.inner;
    });
    return (k) => groups.forEach((g, i) => {
      const p = out(phase(k, i * 0.45, i * 0.45 + 0.55));
      setVis(g, p, (i ? 24 : -24) * (1 - p));
    });
  },

  bullets: (c) => listWidget(c, "bullet"),
  numbered: (c) => listWidget(c, "number"),
  checklist: (c) => listWidget(c, "check"),

  "chart:bar"(c) {
    const data = String(c.el.params.data ?? "").split(",").map(Number).filter((n) => !Number.isNaN(n));
    const labels = String(c.el.params.labels ?? "").split(",").filter(Boolean);
    const n = Math.max(1, data.length);
    const max = Math.max(1e-9, ...data);
    const base = c.h / 2 - 48;
    const top = -c.h / 2 + 48;
    const slot = (c.w - 16) / n;
    const bw = slot * 0.62;
    rule(c, c.L + 8, base, c.L + c.w - 8, base, c.g, 2).setAttribute("stroke-opacity", "1");
    const bars = data.map((v, i) => {
      const it = item(c, String(i + 1));
      const x = c.L + 8 + i * slot + (slot - bw) / 2;
      const full = ((base - top) * v) / max;
      const rect = node(c, "rect", { x: round(x), y: round(base), width: round(bw), height: 0, fill: tone(c, i === data.indexOf(max) ? 0 : 1), stroke: "none" }, it.inner);
      const val = text(c, String(v), x + bw / 2, base - full - 36, { size: 24, weight: 700, mono: true, anchor: "middle" }, it.inner);
      if (labels[i]) text(c, labels[i]!, x + bw / 2, base + 12, { size: 20, mono: true, anchor: "middle", fill: c.theme.muted, upper: true }, it.inner);
      return { rect, span: val.firstElementChild!, full, v };
    });
    return (k) => bars.forEach((b, i) => {
      const p = out(stagger(k, i, n, 0.6));
      b.rect.setAttribute("y", String(round(base - b.full * p)));
      b.rect.setAttribute("height", String(round(b.full * p)));
      b.span.textContent = countUp(String(b.v), p);
      b.span.parentElement!.setAttribute("opacity", String(round(phase(p, 0.2, 1), 3)));
    });
  },

  "chart:line"(c) {
    const series = [c.el.params.data, c.el.params.data2].filter((d) => d !== undefined).map((d) => String(d).split(",").map(Number).filter((n) => !Number.isNaN(n)));
    const labels = String(c.el.params.labels ?? "").split(",").filter(Boolean);
    const all = series.flat();
    const max = Math.max(1e-9, ...all);
    const min = Math.min(0, ...all);
    const [x0, x1, y0, y1] = [c.L + 56, c.L + c.w - 24, c.h / 2 - 48, -c.h / 2 + 24];
    rule(c, x0, y0, x1, y0, c.g, 2).setAttribute("stroke-opacity", "1");
    for (let i = 1; i <= 3; i++) rule(c, x0, y0 + ((y1 - y0) * i) / 3, x1, y0 + ((y1 - y0) * i) / 3);
    text(c, String(max), x0 - 12, y1 - 10, { size: 18, mono: true, anchor: "end", fill: c.theme.muted });
    const len = Math.max(...series.map((s) => s.length), 2);
    const px = (i: number) => x0 + ((x1 - x0) * i) / (len - 1);
    const py = (v: number) => y0 + ((y1 - y0) * (v - min)) / (max - min);
    labels.slice(0, len).forEach((l, i) => text(c, l, px(i), y0 + 12, { size: 18, mono: true, anchor: "middle", fill: c.theme.muted, upper: true }));
    const lines = series.map((s, si) => {
      const d = s.map((v, i) => `${i ? "L" : "M"}${round(px(i))} ${round(py(v))}`).join("");
      // The second series is dashed (pattern, not hue); dashes can't also animate the draw, so it fades in.
      const g = item(c, si ? "series2" : "series1").inner;
      const draw = si ? undefined : drawn(c, "path", { d, stroke: c.theme.ink, "stroke-width": 4 }, g);
      if (si) node(c, "path", { d, fill: "none", stroke: c.theme.fg, "stroke-width": 3, "stroke-dasharray": "10 8" }, g);
      const dots = s.map((v, i) => node(c, "circle", { cx: round(px(i)), cy: round(py(v)), r: si ? 5 : 7, fill: si ? c.theme.bg : c.theme.ink, stroke: si ? c.theme.fg : c.theme.ink, "stroke-width": 2 }, g));
      return { g, draw, dots, n: s.length };
    });
    return (k) => lines.forEach((l) => {
      if (!l.draw) return setVis(l.g, out(phase(k, 0.5, 1)));
      l.draw(out(k));
      l.dots.forEach((d, i) => d.setAttribute("opacity", out(k) >= i / Math.max(1, l.n - 1) - 1e-6 ? "1" : "0"));
    });
  },

  "chart:pie"(c) {
    const data = String(c.el.params.data ?? "").split(",").map(Number).filter((n) => n > 0);
    const labels = String(c.el.params.labels ?? "").split(",").filter(Boolean);
    const total = data.reduce((a, b) => a + b, 0) || 1;
    // Legend beside the donut in wide slots, underneath otherwise.
    const side = c.w > c.h * 1.3;
    const legendW = side ? c.w * 0.42 : 0;
    const legendH = side ? 0 : Math.min(c.h * 0.3, 44 * data.length);
    const r = Math.min(c.w - legendW, c.h - legendH) / 2 - 24;
    const cx = c.L + (c.w - legendW) / 2;
    const cy = -legendH / 2;
    const sw = r * 0.42;
    const rr = r - sw / 2;
    let cum = 0;
    const slices = data.map((v, i) => {
      const it = item(c, String(i + 1));
      const frac = v / total;
      const circle = node(c, "circle", { cx: round(cx), cy: round(cy), r: round(rr), fill: "none", stroke: tone(c, i), "stroke-width": round(sw), "stroke-linecap": "butt", pathLength: 1, transform: `rotate(-90 ${round(cx)} ${round(cy)})` }, it.inner);
      const entry = `${labels[i] ?? ""}  ${Math.round(frac * 100)}%`;
      const [lx, ly] = side
        ? [c.L + c.w - legendW + 16, -((data.length - 1) * 56) / 2 + i * 56]
        : [c.L + (c.w / data.length) * i + 16, c.h / 2 - legendH / 2];
      node(c, "rect", { x: round(lx), y: round(ly - 14), width: 28, height: 28, fill: tone(c, i), stroke: c.theme.fg, "stroke-width": 1 }, it.inner);
      text(c, entry, lx + 44, ly - 15, { size: 24, maxW: (side ? legendW : c.w / data.length) - 64 }, it.inner);
      const s = { circle, start: cum, frac };
      cum += frac;
      return s;
    });
    return (k) => {
      const shown = out(k);
      for (const s of slices) {
        const vis = clamp01(Math.min(s.frac, shown - s.start));
        s.circle.setAttribute("stroke-dasharray", `${round(vis, 5)} ${round(1 - vis, 5)}`);
        s.circle.setAttribute("stroke-dashoffset", String(round(-s.start, 5)));
      }
    };
  },

  table(c) {
    const rows = items(c.el.texts[0]).map(fields);
    const key = Number(c.el.params.key ?? 0);
    const cols = Math.max(1, ...rows.map((r) => r.length));
    const rh = Math.min(72, c.h / Math.max(1, rows.length));
    const top = -(rows.length * rh) / 2;
    const cw = c.w / cols;
    const size = Math.min(26, rh * 0.42);
    const anims = rows.map((r, ri) => {
      const it = item(c, ri ? String(ri) : "head");
      const y = top + ri * rh;
      const keyBg = ri && ri === key ? node(c, "rect", { x: round(c.L), y: round(y), width: round(c.w), height: round(rh), fill: c.theme.ink, stroke: "none", opacity: 0 }, it.inner) : undefined;
      const cells = r.map((cell, ci) =>
        text(c, cell, c.L + ci * cw + 16, y + (rh - size * 1.1) / 2, { size: ri ? size : size * 0.8, weight: ri ? (ci ? 400 : 600) : 600, mono: !ri || /^[\d$€£%.,+-]+$/.test(cell), upper: !ri, fill: ri ? c.theme.fg : c.theme.muted, maxW: cw - 24, maxH: rh - 8 }, it.inner),
      );
      rule(c, c.L, y + rh, c.L + c.w, y + rh, it.inner, ri ? 1.5 : 2.5).setAttribute("stroke-opacity", ri ? "0.45" : "1");
      return { inner: it.inner, keyBg, cells };
    });
    return (k) => anims.forEach((a, i) => {
      const p = out(stagger(phase(k, 0, 0.85), i, anims.length, 0.5));
      setVis(a.inner, p, 0, 10 * (1 - p));
      if (a.keyBg) {
        const f = phase(k, 0.85, 1);
        a.keyBg.setAttribute("opacity", String(round(f, 3)));
        for (const t of a.cells) t.setAttribute("fill", f > 0.5 ? c.theme.onInk : c.theme.fg);
      }
    });
  },

  comparison(c) {
    const [a = "", b = ""] = fields(c.el.texts[0] ?? "");
    const rows = items(c.el.texts[1]).map(fields);
    const cw = (c.w - 32) / 2;
    const rh = Math.min(76, (c.h - 90) / Math.max(1, rows.length));
    const sides = [a, b].map((head, si) => {
      const it = item(c, si ? "2" : "1");
      const x = c.L + si * (cw + 32);
      node(c, "rect", { x: round(x), y: round(c.T), width: round(cw), height: 72, fill: si ? c.theme.surface : c.theme.ink, stroke: c.theme.fg, "stroke-width": 2 }, it.inner);
      text(c, head, x + 20, c.T + 20, { size: 30, weight: 700, fill: si ? c.theme.fg : c.theme.onInk, maxW: cw - 40, maxH: 40 }, it.inner);
      rows.forEach((r, ri) => {
        const y = c.T + 90 + ri * rh;
        text(c, r[si] ?? "", x + 20, y + (rh - 34) / 2, { size: 26, maxW: cw - 40, maxH: rh - 8 }, it.inner);
        rule(c, x, y + rh, x + cw, y + rh, it.inner);
      });
      return it.inner;
    });
    return (k) => sides.forEach((s, i) => {
      const p = out(phase(k, i * 0.3, i * 0.3 + 0.7));
      setVis(s, p, (i ? 40 : -40) * (1 - p));
    });
  },

  stepper(c) {
    const steps = items(c.el.texts[0]).map(fields);
    const n = Math.max(1, steps.length);
    const cw = c.w / n;
    const d = Math.min(64, cw * 0.3);
    const tallest = Math.max(...steps.map(([title = "", line = ""]) => textHeight(title, { size: 30, maxW: cw - 24, maxH: 76 }) + 10 + (line ? textHeight(line, { size: 24, maxW: cw - 24, maxH: c.h * 0.4 }) : 0)));
    // The whole stepper is centered vertically in its slot.
    const cy = -(d + 24 + tallest) / 2 + d / 2;
    const anims = steps.map(([title = "", line = ""], i) => {
      const it = item(c, String(i + 1));
      const x = c.L + i * cw;
      const conn = i < n - 1 ? drawn(c, "line", { x1: round(x + d + 12), y1: round(cy), x2: round(x + cw - 12), y2: round(cy), stroke: c.theme.fg, "stroke-width": 2 }) : undefined;
      node(c, "rect", { x: round(x), y: round(cy - d / 2), width: round(d), height: round(d), fill: c.theme.ink, stroke: "none" }, it.inner);
      text(c, String(i + 1).padStart(2, "0"), x + d / 2, cy - d * 0.28, { size: d * 0.42, weight: 700, mono: true, anchor: "middle", fill: c.theme.bg }, it.inner);
      text(c, title, x, cy + d / 2 + 24, { size: 30, weight: 700, maxW: cw - 24, maxH: 76 }, it.inner);
      if (line) text(c, line, x, cy + d / 2 + 24 + textHeight(title, { size: 30, maxW: cw - 24, maxH: 76 }) + 10, { size: 24, fill: c.theme.muted, maxW: cw - 24, maxH: c.h * 0.4 }, it.inner);
      return { inner: it.inner, conn };
    });
    return (k) => anims.forEach((a, i) => {
      const p = stagger(k, i, n, 0.25);
      const e = out(phase(p, 0, 0.6));
      setVis(a.inner, e, 0, 12 * (1 - e));
      a.conn?.(phase(p, 0.6, 1));
    });
  },

  timeline(c) {
    const events = items(c.el.texts[0]).map(fields);
    const n = Math.max(1, events.length);
    const y = 0;
    const x0 = c.L + 24;
    const x1 = c.L + c.w - 24;
    const line = drawn(c, "line", { x1: round(x0), y1: y, x2: round(x1), y2: y, stroke: c.theme.fg, "stroke-width": 3 });
    const cw = (x1 - x0) / n;
    const marks = events.map(([date = "", what = ""], i) => {
      const it = item(c, String(i + 1));
      const x = x0 + cw * (i + 0.5);
      const up = i % 2 === 0;
      node(c, "rect", { x: round(x - 9), y: round(y - 9), width: 18, height: 18, fill: c.theme.ink, stroke: "none" }, it.inner);
      node(c, "line", { x1: round(x), y1: round(up ? y - 16 : y + 16), x2: round(x), y2: round(up ? y - 40 : y + 40), stroke: c.theme.fg, "stroke-width": 1.5 }, it.inner);
      const wh = textHeight(what, { size: 24, maxW: cw * 1.6 - 16, maxH: c.h / 2 - 110 });
      const top = up ? y - 52 - 40 - wh : y + 52;
      text(c, date, x, top, { size: 30, weight: 700, mono: true, anchor: "middle" }, it.inner);
      text(c, what, x, top + 40, { size: 24, anchor: "middle", fill: c.theme.muted, maxW: cw * 1.6 - 16, maxH: c.h / 2 - 110 }, it.inner);
      return { inner: it.inner, at: (i + 0.5) / n };
    });
    return (k) => {
      const lp = out(phase(k, 0, 0.8));
      line(lp);
      for (const m of marks) {
        const p = out(phase(lp, m.at - 0.05, m.at + 0.1));
        setVis(m.inner, p, 0, 0, 0.8 + 0.2 * p, 0, 0);
      }
    };
  },

  flowchart(c) {
    const spec = c.el.texts[0] ?? "";
    const names = flowNodes(spec);
    const edges = items(spec).map((e) => {
      const [from = "", rest = ""] = e.split(">").map((s) => s.trim());
      const [to = "", label = ""] = rest.split(":").map((s) => s.trim());
      return { from, to, label };
    });
    // Longest-path ranks, declaration order within a rank.
    const rank = new Map(names.map((n) => [n, 0]));
    for (let pass = 0; pass < names.length; pass++) {
      for (const e of edges) if (rank.has(e.from) && rank.has(e.to) && names.indexOf(e.to) > names.indexOf(e.from)) rank.set(e.to, Math.max(rank.get(e.to)!, rank.get(e.from)! + 1));
    }
    const layers: string[][] = [];
    for (const n of names) (layers[rank.get(n)!] ??= []).push(n);
    const horizontal = c.w / c.h > 1.4;
    const L = layers.length;
    const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
    layers.forEach((layer, li) => {
      layer.forEach((name, i) => {
        const bandMain = (horizontal ? c.w : c.h) / L;
        const bandCross = (horizontal ? c.h : c.w) / layer.length;
        const nw = Math.min(horizontal ? bandMain * 0.7 : bandCross * 0.8, 300);
        const nh = Math.min(horizontal ? bandCross * 0.55 : bandMain * 0.55, 96);
        const mx = (horizontal ? c.L : c.T) + bandMain * (li + 0.5);
        const my = (horizontal ? c.T : c.L) + bandCross * (i + 0.5);
        pos.set(name, horizontal ? { x: mx, y: my, w: nw, h: nh } : { x: my, y: mx, w: nw, h: nh });
      });
    });
    const order: { kind: "node" | "edge"; idx: number }[] = [];
    const nodeAnims = names.map((name, i) => {
      const p = pos.get(name)!;
      const it = item(c, String(i + 1));
      const decision = name.endsWith("?");
      if (decision) node(c, "path", { d: `M${round(p.x)} ${round(p.y - p.h / 2)}L${round(p.x + p.w / 2)} ${round(p.y)}L${round(p.x)} ${round(p.y + p.h / 2)}L${round(p.x - p.w / 2)} ${round(p.y)}Z`, fill: c.theme.surface, stroke: c.theme.fg, "stroke-width": 2 }, it.inner);
      else node(c, "rect", { x: round(p.x - p.w / 2), y: round(p.y - p.h / 2), width: round(p.w), height: round(p.h), fill: i === 0 ? c.theme.ink : c.theme.surface, stroke: c.theme.fg, "stroke-width": 2 }, it.inner);
      const fs = Math.min(26, p.h * 0.32);
      const th = textHeight(name, { size: fs, maxW: p.w * (decision ? 0.6 : 0.88), maxH: p.h * 0.8 });
      text(c, name, p.x, p.y - th / 2, { size: fs, weight: 600, anchor: "middle", fill: i === 0 && !decision ? c.theme.onInk : c.theme.fg, maxW: p.w * (decision ? 0.6 : 0.88), maxH: p.h * 0.8 }, it.inner);
      return it.inner;
    });
    const edgeAnims = edges.map((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return undefined;
      const [ax, ay, bx, by] = horizontal
        ? [a.x + a.w / 2, a.y, b.x - b.w / 2 - 10, b.y]
        : [a.x, a.y + a.h / 2, b.x, b.y - b.h / 2 - 10];
      const d = horizontal ? `M${round(ax)} ${round(ay)}C${round((ax + bx) / 2)} ${round(ay)} ${round((ax + bx) / 2)} ${round(by)} ${round(bx)} ${round(by)}` : `M${round(ax)} ${round(ay)}C${round(ax)} ${round((ay + by) / 2)} ${round(bx)} ${round((ay + by) / 2)} ${round(bx)} ${round(by)}`;
      const draw = drawn(c, "path", { d, stroke: c.theme.fg, "stroke-width": 2 });
      const head = node(c, "path", { d: horizontal ? `M${round(bx + 10)} ${round(by)}l-14 -7v14z` : `M${round(bx)} ${round(by + 10)}l-7 -14h14z`, fill: c.theme.ink, stroke: "none" });
      const label = e.label ? text(c, e.label, (ax + bx) / 2, (ay + by) / 2 - 30, { size: 18, mono: true, upper: true, anchor: "middle", fill: c.theme.muted }) : undefined;
      return { draw, head, label, from: e.from, to: e.to };
    });
    // Reveal order: first node, then each edge followed by its target, in edge order.
    const shown = new Set<string>([names[0] ?? ""]);
    order.push({ kind: "node", idx: 0 });
    edgeAnims.forEach((e, i) => {
      if (!e) return;
      order.push({ kind: "edge", idx: i });
      if (!shown.has(e.to)) {
        shown.add(e.to);
        order.push({ kind: "node", idx: names.indexOf(e.to) });
      }
    });
    names.forEach((n, i) => !shown.has(n) && order.push({ kind: "node", idx: i }));
    return (k) => order.forEach((o, i) => {
      const p = stagger(k, i, order.length, 0.3);
      if (o.kind === "node") {
        const e = out(p);
        setVis(nodeAnims[o.idx]!, e, 0, 0, 0.85 + 0.15 * e, pos.get(names[o.idx]!)!.x, pos.get(names[o.idx]!)!.y);
      } else {
        const e = edgeAnims[o.idx]!;
        e.draw(out(p));
        e.head.setAttribute("opacity", p >= 0.95 ? "1" : "0");
        e.label?.setAttribute("opacity", String(round(phase(p, 0.5, 1), 3)));
      }
    });
  },

  funnel(c) {
    const stages = items(c.el.texts[0]).map(fields);
    const n = Math.max(1, stages.length);
    const sh = (c.h - (n - 1) * 8) / n;
    const fw = c.w * 0.62;
    const anims = stages.map(([name = "", value = ""], i) => {
      const it = item(c, String(i + 1));
      const y = c.T + i * (sh + 8);
      const wTop = fw * (1 - (i / n) * 0.7);
      const wBot = fw * (1 - ((i + 1) / n) * 0.7);
      const x = c.L + fw / 2;
      node(c, "path", { d: `M${round(x - wTop / 2)} ${round(y)}H${round(x + wTop / 2)}L${round(x + wBot / 2)} ${round(y + sh)}H${round(x - wBot / 2)}Z`, fill: tone(c, i), stroke: c.theme.fg, "stroke-width": 1.5 }, it.inner);
      if (value) text(c, value, x, y + sh / 2 - 16, { size: Math.min(30, sh * 0.4), weight: 700, mono: true, anchor: "middle", fill: i < 2 ? c.theme.onInk : c.theme.fg }, it.inner);
      text(c, name, c.L + fw + 32, y + sh / 2 - 16, { size: Math.min(28, sh * 0.38), maxW: c.w - fw - 40, maxH: sh }, it.inner);
      return it.inner;
    });
    return (k) => anims.forEach((a, i) => {
      const p = out(stagger(k, i, n, 0.4));
      setVis(a, p, 0, -30 * (1 - p));
    });
  },

  cycle(c) {
    const stages = items(c.el.texts[0]);
    const n = Math.max(1, stages.length);
    const R = Math.min(c.w, c.h) / 2 - Math.min(c.w, c.h) * 0.16;
    const nr = Math.min(R * Math.sin(Math.PI / n) * 0.8, Math.min(c.w, c.h) * 0.15);
    const anims = stages.map((s, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const [x, y] = [Math.cos(a) * R, Math.sin(a) * R];
      // Arc to the next stage, trimmed at both circles.
      const gap = Math.asin(Math.min(0.95, (nr + 10) / R)) * 1.2;
      const a0 = a + gap;
      const a1 = a + (2 * Math.PI) / n - gap;
      const arc = drawn(c, "path", { d: `M${round(Math.cos(a0) * R)} ${round(Math.sin(a0) * R)}A${round(R)} ${round(R)} 0 0 1 ${round(Math.cos(a1) * R)} ${round(Math.sin(a1) * R)}`, stroke: c.theme.fg, "stroke-width": 2 });
      const hx = Math.cos(a1) * R;
      const hy = Math.sin(a1) * R;
      const tang = a1 + Math.PI / 2;
      const head = node(c, "path", { d: `M${round(hx + Math.cos(tang) * 8)} ${round(hy + Math.sin(tang) * 8)}L${round(hx - Math.cos(tang) * 8 + Math.cos(a1) * 7)} ${round(hy - Math.sin(tang) * 8 + Math.sin(a1) * 7)}L${round(hx - Math.cos(tang) * 8 - Math.cos(a1) * 7)} ${round(hy - Math.sin(tang) * 8 - Math.sin(a1) * 7)}Z`, fill: c.theme.ink, stroke: "none" });
      const it = item(c, String(i + 1));
      const disc = node(c, "circle", { cx: round(x), cy: round(y), r: round(nr), fill: c.theme.surface, stroke: c.theme.fg, "stroke-width": 2 }, it.inner);
      const fs = Math.min(24, nr * 0.34);
      const th = textHeight(s, { size: fs, maxW: nr * 1.6, maxH: nr * 1.4 });
      const label = text(c, s, x, y - th / 2, { size: fs, weight: 600, anchor: "middle", maxW: nr * 1.6, maxH: nr * 1.4 }, it.inner);
      return { inner: it.inner, disc, label, arc, head, x, y };
    });
    return (k) => anims.forEach((a, i) => {
      const p = stagger(k, i, n, 0.2);
      const e = out(phase(p, 0, 0.5));
      setVis(a.inner, e, 0, 0, 0.8 + 0.2 * e, a.x, a.y);
      // The stage "lights up" (fills with ink) as it arrives, then settles.
      const lit = p > 0.3 && p < 0.9;
      a.disc.setAttribute("fill", lit ? c.theme.ink : c.theme.surface);
      a.label.setAttribute("fill", lit ? c.theme.onInk : c.theme.fg);
      a.arc(phase(p, 0.5, 1));
      a.head.setAttribute("opacity", p >= 0.98 ? "1" : "0");
    });
  },

  matrix(c) {
    const [xl = "", yl = ""] = fields(c.el.texts[0] ?? "");
    const dots = items(c.el.texts[1]).map(fields);
    const size = Math.min(c.w - 80, c.h - 60);
    const [x0, y0] = [-size / 2 + 30, -size / 2];
    const axes = [
      drawn(c, "line", { x1: round(x0), y1: round(y0 + size), x2: round(x0 + size), y2: round(y0 + size), stroke: c.theme.fg, "stroke-width": 3 }),
      drawn(c, "line", { x1: round(x0), y1: round(y0 + size), x2: round(x0), y2: round(y0), stroke: c.theme.fg, "stroke-width": 3 }),
    ];
    rule(c, x0 + size / 2, y0, x0 + size / 2, y0 + size);
    rule(c, x0, y0 + size / 2, x0 + size, y0 + size / 2);
    text(c, xl, x0 + size, y0 + size + 10, { size: 20, mono: true, upper: true, anchor: "end", fill: c.theme.muted });
    const yt = text(c, yl, 0, 0, { size: 20, mono: true, upper: true, anchor: "end", fill: c.theme.muted });
    yt.setAttribute("transform", `translate(${round(x0 - 34)} ${round(y0)}) rotate(-90)`);
    const marks = dots.map(([name = "", at = "5,5"], i) => {
      const [vx = 5, vy = 5] = at.split(",").map(Number);
      const x = x0 + (size * clamp01(vx / 10));
      const y = y0 + size - size * clamp01(vy / 10);
      const it = item(c, String(i + 1));
      node(c, "circle", { cx: round(x), cy: round(y), r: 11, fill: c.theme.ink, stroke: "none" }, it.inner);
      text(c, name, x + 18, y - 16, { size: 22, weight: 600 }, it.inner);
      return { inner: it.inner, x, y };
    });
    return (k) => {
      const a = out(phase(k, 0, 0.45));
      axes.forEach((d) => d(a));
      marks.forEach((m, i) => {
        const p = out(stagger(phase(k, 0.4, 1), i, marks.length, 0.4));
        setVis(m.inner, p, 0, -24 * (1 - p), 1, m.x, m.y);
      });
    };
  },

  image: (c) => picture(c, false),
  video: (c) => picture(c, true),

  avatar(c) {
    const name = c.el.texts[0] ?? "";
    const role = c.el.texts[1] ?? "";
    const d = Math.min(c.w * 0.5, c.h - 110);
    const cy = c.T + 12 + d / 2;
    const photo = item(c);
    node(c, "circle", { cx: 0, cy: round(cy), r: round(d / 2), fill: c.theme.surface, stroke: c.theme.fg, "stroke-width": 2 }, photo.inner);
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
    text(c, initials, 0, cy - d * 0.2, { size: d * 0.36, weight: 700, anchor: "middle" }, photo.inner);
    const nameT = text(c, name, 0, cy + d / 2 + 18, { size: 30, weight: 700, anchor: "middle" });
    if (role) text(c, role, 0, cy + d / 2 + 60, { size: 20, mono: true, upper: true, anchor: "middle", fill: c.theme.muted, maxW: c.w - 16, maxH: 30 });
    const span = nameT.firstElementChild!;
    return (k) => {
      setVis(photo.inner, out(phase(k, 0, 0.5)));
      span.textContent = name.slice(0, Math.round(name.length * phase(k, 0.4, 1)));
    };
  },

  logo(c) {
    const brand = c.el.texts[0] ?? "";
    const size = Math.min(c.h * 0.45, (c.w * 0.8) / Math.max(1, brand.length * 0.62));
    node(c, "rect", { x: round(c.L + 4), y: round(c.T + 4), width: round(c.w - 8), height: round(c.h - 8), fill: "none", stroke: c.theme.fg, "stroke-width": 2 });
    text(c, brand, 0, -size * 0.55, { size, weight: 700, anchor: "middle" });
    return () => {};
  },

  map(c) {
    const places = items(c.el.texts[0]);
    const [lon0, lon1, lat0, lat1] = [-170, 190, 80, -58];
    const mw = Math.min(c.w, c.h * ((lon1 - lon0) / (lat0 - lat1)));
    const mh = mw / ((lon1 - lon0) / (lat0 - lat1));
    const px = (lon: number) => -mw / 2 + ((lon - lon0) / (lon1 - lon0)) * mw;
    const py = (lat: number) => -mh / 2 + ((lat0 - lat) / (lat0 - lat1)) * mh;
    for (const poly of CONTINENTS) {
      node(c, "path", { d: `M${poly.map(([lo, la]) => `${round(px(lo))} ${round(py(la))}`).join("L")}Z`, fill: c.theme.surface, stroke: c.theme.muted, "stroke-opacity": 0.6, "stroke-width": 1.5 });
    }
    const pins = places.map((p, i) => {
      const at = findPlace(p);
      const it = item(c, String(i + 1));
      const [x, y] = at ? [px(at[0]), py(at[1])] : [-mw / 2 + 40 + i * 200, mh / 2 - 40];
      node(c, "path", { d: `M${round(x)} ${round(y)}l-11 -22a12 12 0 1 1 22 0z`, fill: c.theme.fg, stroke: c.theme.bg, "stroke-width": 2 }, it.inner);
      const right = x < mw / 4;
      text(c, p, right ? x + 18 : x - 18, y - 44, { size: 22, weight: 700, anchor: right ? "start" : "end" }, it.inner);
      return { inner: it.inner };
    });
    return (k) => pins.forEach((p, i) => {
      const e = stagger(k, i, pins.length, 0.4);
      setVis(p.inner, e > 0 ? 1 : 0, 0, -40 * (1 - out(e)));
    });
  },

  footer(c) {
    rule(c, c.L, c.T, c.L + c.w, c.T, c.g, 1.5);
    const brand = String(c.el.params.brand ?? "");
    node(c, "rect", { x: round(c.L), y: round(c.T + 14), width: 14, height: 14, fill: c.theme.ink, stroke: "none" });
    if (brand) text(c, brand, c.L + 26, c.T + 12, { size: 16, mono: true, upper: true, weight: 600, maxW: c.w * 0.3, maxH: 20 });
    if (c.el.texts[0]) text(c, c.el.texts[0], 0, c.T + 12, { size: 16, mono: true, anchor: "middle", fill: c.theme.muted, maxW: c.w * 0.45, maxH: 20 });
    text(c, String(c.el.params.page ?? "").padStart(2, "0"), c.L + c.w, c.T + 12, { size: 16, mono: true, weight: 600, anchor: "end" });
    return () => {};
  },
};

function listWidget(c: Ctx, style: "bullet" | "number" | "check"): Motion {
  const list = items(c.el.texts[0]);
  const n = Math.max(1, list.length);
  const lh = Math.min(96, c.h / n);
  const size = Math.max(24, Math.min(32, lh * 0.4));
  const indent = style === "bullet" ? 40 : 64;
  const heights = list.map((s) => textHeight(s, { size, maxW: c.w - indent - 16, maxH: lh - 8 }));
  const top = -(n * lh) / 2;
  const rows = list.map((s, i) => {
    const it = item(c, String(i + 1));
    const y = top + i * lh + (lh - heights[i]!) / 2;
    let tick: ((k: number) => void) | undefined;
    if (style === "bullet") node(c, "rect", { x: round(c.L + 8), y: round(y + size * 0.36), width: 12, height: 12, fill: c.theme.ink, stroke: "none" }, it.inner);
    if (style === "number") text(c, String(i + 1).padStart(2, "0"), c.L + 8, y, { size, weight: 700, mono: true }, it.inner);
    if (style === "check") {
      const b = size * 1.1;
      node(c, "rect", { x: round(c.L + 8), y: round(y - 2), width: round(b), height: round(b), fill: "none", stroke: c.theme.fg, "stroke-width": 2 }, it.inner);
      tick = drawn(c, "path", { d: `M${round(c.L + 8 + b * 0.2)} ${round(y - 2 + b * 0.52)}L${round(c.L + 8 + b * 0.42)} ${round(y - 2 + b * 0.74)}L${round(c.L + 8 + b * 0.82)} ${round(y - 2 + b * 0.26)}`, stroke: c.theme.fg, "stroke-width": 3.5 }, it.inner);
    }
    const label = item(c);
    it.inner.append(label.outer);
    text(c, s, c.L + indent, y, { size, maxW: c.w - indent - 16, maxH: lh - 8 }, label.inner);
    rule(c, c.L, top + (i + 1) * lh, c.L + c.w, top + (i + 1) * lh, it.inner, 1);
    return { inner: it.inner, label: label.inner, tick };
  });
  return (k) => rows.forEach((r, i) => {
    const p = stagger(k, i, n, 0.35);
    if (style === "check") {
      setVis(r.inner, 1);
      r.tick!(out(phase(p, 0.2, 1)));
      setVis(r.label, out(phase(p, 0, 0.6)), 16 * (1 - out(phase(p, 0, 0.6))));
    } else if (style === "number") {
      setVis(r.inner, out(phase(p, 0, 0.4)));
      setVis(r.label, out(phase(p, 0.3, 1)), 16 * (1 - out(phase(p, 0.3, 1))));
    } else {
      setVis(r.inner, out(p), 20 * (1 - out(p)));
      setVis(r.label, 1);
    }
  });
}

/** Image/video slot: a cover-cropped frame with crop marks and a caption. */
function picture(c: Ctx, video: boolean): Motion {
  const inner = item(c).inner;
  node(c, "rect", { x: round(c.L), y: round(c.T), width: round(c.w), height: round(c.h), fill: c.theme.surface, stroke: "none" }, inner);
  // Subject in the middle 60%: a simple horizon-and-sun glyph, or a play button.
  const s = Math.min(c.w, c.h) * 0.3;
  if (video) {
    node(c, "circle", { cx: 0, cy: 0, r: round(s / 2), fill: c.theme.ink, stroke: "none" }, inner);
    node(c, "path", { d: `M${round(-s * 0.14)} ${round(-s * 0.2)}L${round(s * 0.22)} 0L${round(-s * 0.14)} ${round(s * 0.2)}Z`, fill: c.theme.bg, stroke: "none" }, inner);
  } else {
    node(c, "path", { d: `M${round(-s)} ${round(s * 0.5)}L${round(-s * 0.35)} ${round(-s * 0.2)}L${round(0)} ${round(s * 0.2)}L${round(s * 0.35)} ${round(-s * 0.05)}L${round(s)} ${round(s * 0.5)}`, fill: "none", stroke: c.theme.muted, "stroke-width": 3 }, inner);
    node(c, "circle", { cx: round(s * 0.45), cy: round(-s * 0.45), r: round(s * 0.14), fill: "none", stroke: c.theme.muted, "stroke-width": 3 }, inner);
  }
  const m = 28;
  for (const [x, y, dx, dy] of [[c.L + 16, c.T + 16, 1, 1], [c.L + c.w - 16, c.T + 16, -1, 1], [c.L + 16, c.T + c.h - 16, 1, -1], [c.L + c.w - 16, c.T + c.h - 16, -1, -1]] as const) {
    node(c, "path", { d: `M${round(x)} ${round(y + dy * m)}V${round(y)}H${round(x + dx * m)}`, fill: "none", stroke: c.theme.fg, "stroke-width": 2 }, inner);
  }
  text(c, `${video ? "Video" : "Image"} · ${c.el.texts[0] ?? ""}`, c.L + 24, c.T + c.h - 52, { size: 18, mono: true, upper: true, fill: c.theme.muted, maxW: c.w - 48, maxH: 24 }, inner);
  const cx = 0;
  const cy = 0;
  return (k) => setVis(inner, out(phase(k, 0, 0.6)), 0, 0, 1.04 - 0.04 * out(k), cx, cy);
}

/** Very rough continent outlines, [longitude, latitude]. */
const CONTINENTS: readonly (readonly [number, number])[][] = [
  [[-165, 68], [-140, 70], [-110, 73], [-85, 70], [-75, 62], [-60, 53], [-66, 45], [-75, 38], [-81, 31], [-80, 25], [-90, 29], [-97, 26], [-97, 20], [-87, 15], [-83, 9], [-78, 8], [-90, 14], [-105, 20], [-112, 29], [-117, 33], [-124, 40], [-124, 48], [-135, 57], [-150, 60], [-160, 58], [-165, 62]],
  [[-55, 60], [-42, 60], [-20, 70], [-20, 80], [-40, 83], [-60, 80], [-72, 77], [-55, 70]],
  [[-80, 8], [-72, 12], [-60, 8], [-50, 0], [-35, -5], [-38, -13], [-40, -22], [-48, -26], [-53, -34], [-58, -38], [-65, -45], [-68, -55], [-74, -50], [-72, -35], [-71, -18], [-76, -14], [-81, -5], [-80, 0]],
  [[-10, 36], [-9, 43], [-2, 44], [-5, 48], [0, 50], [5, 53], [8, 57], [5, 62], [12, 66], [20, 70], [30, 71], [40, 67], [45, 60], [40, 48], [30, 45], [28, 41], [22, 37], [15, 40], [12, 44], [8, 44], [3, 42], [-2, 37]],
  [[-6, 50], [2, 51], [0, 54], [-3, 58], [-6, 57]],
  [[-17, 15], [-17, 21], [-10, 30], [-5, 36], [10, 37], [20, 33], [32, 32], [35, 28], [43, 12], [51, 12], [42, -2], [40, -15], [35, -25], [30, -32], [20, -35], [17, -28], [12, -17], [13, -5], [9, 4], [-5, 5], [-12, 7]],
  [[44, -25], [50, -15], [49, -12], [43, -17]],
  [[28, 41], [40, 48], [45, 60], [40, 67], [60, 70], [80, 73], [105, 77], [140, 73], [170, 70], [180, 66], [170, 60], [160, 55], [142, 50], [135, 43], [127, 38], [122, 30], [120, 22], [108, 20], [106, 10], [100, 13], [98, 8], [103, 2], [100, 7], [95, 16], [90, 22], [80, 15], [77, 8], [72, 20], [67, 25], [57, 25], [52, 28], [48, 30], [44, 13], [38, 20], [35, 28], [35, 36]],
  [[130, 31], [136, 34], [141, 38], [142, 44], [139, 40], [133, 34]],
  [[95, 5], [105, -6], [115, -8], [120, -9], [110, -3], [100, 2]],
  [[114, -22], [122, -18], [130, -12], [137, -12], [142, -11], [146, -19], [153, -26], [151, -34], [145, -38], [138, -35], [131, -31], [115, -34], [114, -26]],
  [[166, -46], [174, -41], [178, -38], [173, -35], [172, -41], [168, -46]],
];
