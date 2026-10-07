import { round, svg } from "./components.js";
import type { Theme } from "./theme.js";

/**
 * Procedural backgrounds. Each generator draws from the look's palette with
 * a seeded random generator, so the same video always gets the same
 * background and different videos get different ones. Animated layers are
 * a pure function of time (`update(t)`), like everything else on stage.
 */
export interface Background {
  node: SVGSVGElement;
  update(t: number): void;
}

type Layer = { node: SVGElement; update?: (t: number) => void };
type Generator = (c: Ctx) => Layer;

interface Ctx {
  doc: Document;
  theme: Theme;
  w: number;
  h: number;
  rand: () => number;
  /** Unique id prefix for gradients/filters (several stages can share a page). */
  id: string;
}

let bgCount = 0;

/** Mulberry32: small, fast, deterministic. */
function prng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

const GENERATORS: Record<string, Generator> = {
  solid: (c) => ({ node: svg(c.doc, "g", {}) }),

  gradient(c) {
    const g = svg(c.doc, "g", {});
    const angle = c.rand() * 360;
    const id = `${c.id}-grad`;
    const defs = svg(c.doc, "defs", {});
    const lg = svg(c.doc, "linearGradient", { id, gradientTransform: `rotate(${round(angle)} 0.5 0.5)` });
    lg.append(svg(c.doc, "stop", { offset: 0, "stop-color": c.theme.bg }), svg(c.doc, "stop", { offset: 1, "stop-color": mix(c.theme.accent, c.theme.bg, 22) }));
    defs.append(lg);
    g.append(defs, svg(c.doc, "rect", { width: c.w, height: c.h, fill: `url(#${id})` }));
    return { node: g };
  },

  mesh(c) {
    const g = svg(c.doc, "g", {});
    const defs = svg(c.doc, "defs", {});
    g.append(defs);
    const colors = [c.theme.accent, c.theme.cool, c.theme.good, c.theme.warn];
    const blobs = colors.map((col, i) => {
      const id = `${c.id}-blob${i}`;
      const rg = svg(c.doc, "radialGradient", { id });
      rg.append(svg(c.doc, "stop", { offset: 0, "stop-color": col, "stop-opacity": 0.42 }), svg(c.doc, "stop", { offset: 1, "stop-color": col, "stop-opacity": 0 }));
      defs.append(rg);
      const blob = { x: c.rand() * c.w, y: c.rand() * c.h, r: c.w * (0.28 + c.rand() * 0.22), phase: c.rand() * Math.PI * 2, speed: 0.08 + c.rand() * 0.08 };
      const el = svg(c.doc, "circle", { r: round(blob.r), fill: `url(#${id})` });
      g.append(el);
      return { blob, el };
    });
    return {
      node: g,
      update: (t) => {
        for (const { blob, el } of blobs) {
          el.setAttribute("cx", String(round(blob.x + Math.sin(t * blob.speed + blob.phase) * 90)));
          el.setAttribute("cy", String(round(blob.y + Math.cos(t * blob.speed * 0.8 + blob.phase) * 60)));
        }
      },
    };
  },

  aurora(c) {
    const g = svg(c.doc, "g", {});
    const defs = svg(c.doc, "defs", {});
    g.append(defs);
    const bands = [c.theme.accent, c.theme.cool, c.theme.good].map((col, i) => {
      const id = `${c.id}-aurora${i}`;
      const lg = svg(c.doc, "linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 });
      lg.append(svg(c.doc, "stop", { offset: 0, "stop-color": col, "stop-opacity": 0 }), svg(c.doc, "stop", { offset: 0.5, "stop-color": col, "stop-opacity": 0.22 }), svg(c.doc, "stop", { offset: 1, "stop-color": col, "stop-opacity": 0 }));
      defs.append(lg);
      const path = svg(c.doc, "path", { fill: `url(#${id})` });
      g.append(path);
      return { path, y: c.h * (0.15 + c.rand() * 0.5), amp: 60 + c.rand() * 80, phase: c.rand() * 6, speed: 0.15 + c.rand() * 0.1, thick: 220 + c.rand() * 160 };
    });
    const wave = (b: (typeof bands)[number], t: number, off: number) => {
      const pts: string[] = [];
      for (let x = 0; x <= c.w; x += c.w / 12) pts.push(`${round(x)} ${round(b.y + off + Math.sin(x / 260 + b.phase + t * b.speed) * b.amp)}`);
      return pts;
    };
    return {
      node: g,
      update: (t) => {
        for (const b of bands) {
          const top = wave(b, t, 0);
          const bottom = wave(b, t, b.thick).reverse();
          b.path.setAttribute("d", `M${top.join("L")}L${bottom.join("L")}Z`);
        }
      },
    };
  },

  grain(c) {
    const id = `${c.id}-grain`;
    const g = svg(c.doc, "g", {});
    const f = svg(c.doc, "filter", { id, x: 0, y: 0, width: 1, height: 1 });
    f.append(
      svg(c.doc, "feTurbulence", { type: "fractalNoise", baseFrequency: 0.85, numOctaves: 2, seed: Math.floor(c.rand() * 1000), stitchTiles: "stitch" }),
      svg(c.doc, "feColorMatrix", { type: "saturate", values: 0 }),
    );
    const defs = svg(c.doc, "defs", {});
    defs.append(f);
    g.append(defs, svg(c.doc, "rect", { width: c.w, height: c.h, filter: `url(#${id})`, opacity: 0.07, style: "mix-blend-mode: multiply" }));
    return { node: g };
  },

  grid(c) {
    const g = svg(c.doc, "g", { stroke: c.theme.fg, fill: "none" });
    const step = 60;
    const ox = Math.floor(c.rand() * step);
    for (let x = ox, i = 0; x < c.w; x += step, i++) g.append(svg(c.doc, "line", { x1: x, y1: 0, x2: x, y2: c.h, "stroke-opacity": i % 4 === 0 ? 0.16 : 0.06, "stroke-width": 1 }));
    for (let y = 0, i = 0; y < c.h; y += step, i++) g.append(svg(c.doc, "line", { x1: 0, y1: y, x2: c.w, y2: y, "stroke-opacity": i % 4 === 0 ? 0.16 : 0.06, "stroke-width": 1 }));
    return { node: g };
  },

  dots(c) {
    const id = `${c.id}-dots`;
    const step = 36 + Math.floor(c.rand() * 12);
    const g = svg(c.doc, "g", {});
    const defs = svg(c.doc, "defs", {});
    const pat = svg(c.doc, "pattern", { id, width: step, height: step, patternUnits: "userSpaceOnUse" });
    pat.append(svg(c.doc, "circle", { cx: step / 2, cy: step / 2, r: 2.2, fill: c.theme.fg, "fill-opacity": 0.22 }));
    defs.append(pat);
    g.append(defs, svg(c.doc, "rect", { width: c.w, height: c.h, fill: `url(#${id})` }));
    return { node: g };
  },

  notebook(c) {
    const g = svg(c.doc, "g", { fill: "none" });
    for (let y = 120; y < c.h; y += 56) g.append(svg(c.doc, "line", { x1: 0, y1: y, x2: c.w, y2: y, stroke: c.theme.cool, "stroke-opacity": 0.28, "stroke-width": 2 }));
    g.append(svg(c.doc, "line", { x1: 150, y1: 0, x2: 150, y2: c.h, stroke: c.theme.warn, "stroke-opacity": 0.4, "stroke-width": 2.5 }));
    return { node: g };
  },

  waves(c) {
    const g = svg(c.doc, "g", { stroke: "none" });
    const layers = [c.theme.accent, c.theme.cool, c.theme.good].map((col, i) => {
      const path = svg(c.doc, "path", { fill: col, "fill-opacity": 0.1 + i * 0.03 });
      g.append(path);
      return { path, base: c.h * (0.78 + i * 0.06), amp: 26 + c.rand() * 22, len: 300 + c.rand() * 200, phase: c.rand() * 6, speed: 0.25 + i * 0.08 };
    });
    return {
      node: g,
      update: (t) => {
        for (const l of layers) {
          const pts: string[] = [];
          for (let x = 0; x <= c.w; x += 40) pts.push(`${x} ${round(l.base + Math.sin(x / l.len + l.phase + t * l.speed) * l.amp)}`);
          l.path.setAttribute("d", `M0 ${c.h}L${pts.join("L")}L${c.w} ${c.h}Z`);
        }
      },
    };
  },

  shapes(c) {
    const g = svg(c.doc, "g", { fill: "none", "stroke-width": 4, "stroke-linejoin": "round" });
    const colors = [c.theme.accent, c.theme.cool, c.theme.good, c.theme.fg];
    const items = Array.from({ length: 14 }, (_, i) => {
      const size = 30 + c.rand() * 50;
      const kind = Math.floor(c.rand() * 4);
      const d =
        kind === 0 ? `M${-size} 0a${size} ${size} 0 1 0 ${size * 2} 0a${size} ${size} 0 1 0 ${-size * 2} 0`
        : kind === 1 ? `M0 ${-size}L${size * 0.87} ${size / 2}L${-size * 0.87} ${size / 2}Z`
        : kind === 2 ? `M${-size} ${-size}H${size}V${size}H${-size}Z`
        : `M${-size} 0H${size}M0 ${-size}V${size}`;
      const el = svg(c.doc, "path", { d, stroke: colors[i % colors.length]!, "stroke-opacity": 0.16 });
      g.append(el);
      return { el, x: c.rand() * c.w, y: c.rand() * c.h, spin: (c.rand() - 0.5) * 16, rot: c.rand() * 360 };
    });
    return {
      node: g,
      update: (t) => {
        for (const s of items) s.el.setAttribute("transform", `translate(${round(s.x)} ${round(s.y)}) rotate(${round(s.rot + s.spin * t)})`);
      },
    };
  },
};

/** Builds the stacked background layers ("auto" = the look's own). */
export function buildBackground(doc: Document, kinds: string[], seed: number, theme: Theme, w: number, h: number, ids = `anim-bg-${++bgCount}`): Background {
  const node = svg(doc, "svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h }) as SVGSVGElement;
  Object.assign(node.style, { position: "absolute", left: "0", top: "0" });
  const list = kinds.flatMap((k) => (k === "auto" ? theme.background.split("+") : [k]));
  const layers = list.map((k, i) => (GENERATORS[k] ?? GENERATORS.solid!)({ doc, theme, w, h, rand: prng(seed * 31 + i * 7919), id: `${ids}-${i}` }));
  for (const l of layers) node.append(l.node);
  return {
    node,
    update: (t) => {
      for (const l of layers) l.update?.(t);
    },
  };
}

export const BACKGROUND_KINDS = Object.keys(GENERATORS);
