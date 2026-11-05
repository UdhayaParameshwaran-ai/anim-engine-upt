import type { ElementDecl } from "@anim/dsl";
import { gridElementOf, type AssetLibrary } from "@anim/registry";

export interface Size {
  w: number;
  h: number;
  /** Text can wrap to a narrower width instead of scaling down. */
  wraps?: { font: number; chars: number; lineHeight: number; pad: number };
  /** Pictures may be enlarged up to this factor when their cell has room. */
  grow?: number;
  /** The label under a picture, at natural size: its band height, font and lines. */
  label?: { h: number; font: number; lines: number; chars: number };
}

/** Label under an icon or illustration: one line, or two when it is long. */
const LABEL_FONT = 34;
const LABEL_MAX_W = 340;
function labelOf(text: string): { w: number; h: number; font: number; lines: number; chars: number } | undefined {
  if (!text) return undefined;
  const textW = Math.round(text.length * CHAR_W * LABEL_FONT) + 12;
  const lines = textW <= LABEL_MAX_W ? 1 : 2;
  return { w: lines === 1 ? textW : Math.min(LABEL_MAX_W, Math.round(textW * 0.6)), h: Math.round(lines * LABEL_FONT * 1.25 + 14), font: LABEL_FONT, lines, chars: text.length };
}

/** Average glyph width as a fraction of font size. Real measurement happens in the browser later. */
export const CHAR_W = 0.55;

const FONT: Record<string, number> = { title: 80, text: 44, label: 34, node: 32, list: 40 };

/**
 * Natural size of an element at 1920×1080, from its kind and text. This is
 * a deterministic estimate so layout is reproducible without a browser; the
 * engine re-checks real text metrics at render time (diagnostic NAR6xx).
 */
export function measure(el: ElementDecl, assets: AssetLibrary): Size {
  const text = el.texts[0] ?? "";
  const label = el.kind === "icon" || el.kind === "asset" ? labelOf(text) : undefined;
  const labelH = label?.h ?? 0;
  switch (el.kind) {
    case "title":
    case "text":
    case "label":
      return textSize(text, FONT[el.kind]!, 0);
    case "node": {
      const s = textSize(text, FONT.node!, 40);
      return { ...s, w: Math.max(220, s.w), h: Math.max(96, s.h) };
    }
    case "list": {
      const items = text.split(";").map((s) => s.trim()).filter(Boolean);
      const longest = Math.max(0, ...items.map((s) => s.length));
      return { w: Math.round(longest * CHAR_W * FONT.list! + 60), h: Math.round(items.length * FONT.list! * 1.5) };
    }
    case "card":
      return { w: 400, h: 240 };
    case "formula":
      return { w: Math.max(240, Math.round(text.length * 30)), h: 110 };
    case "box":
      // The engine wraps a box's label (up to the box), so a narrow cell wraps it rather than shrinking the box.
      return { w: Math.max(300, Math.round(text.length * CHAR_W * 36 + 60)), h: 150, wraps: { font: 36, chars: Math.max(1, text.length), lineHeight: 1.25, pad: 36 } };
    case "circle":
      return { w: 200, h: 200 };
    case "chart":
      return { w: 760, h: 440 };
    case "icon":
      return { w: Math.max(200, label?.w ?? 0), h: 200 + labelH, grow: 2.2, ...(label && { label }) };
    case "asset": {
      const aspect = (el.name && assets.resolve("asset", el.name)?.manifest.aspect) || 1;
      return { w: 440, h: Math.round(440 / aspect) + labelH, grow: 1.5, ...(label && { label }) };
    }
    case "placeholder":
      return { w: 280, h: 180 };
    default: {
      // Grid elements outside a grid scene: a little above their minimum slot size.
      const g = gridElementOf(el.kind, el.name);
      return g ? { w: Math.round(g.minW * 1.2), h: Math.round(g.minH * 1.2) } : { w: 240, h: 160 };
    }
  }
}

function textSize(text: string, font: number, pad: number): Size {
  const chars = Math.max(1, text.length);
  return {
    w: Math.round(chars * CHAR_W * font + pad * 2),
    h: Math.round(font * 1.3 + pad),
    wraps: { font, chars, lineHeight: 1.3, pad },
  };
}

/**
 * Fits a size into a max width/height: text wraps first (up to 3 lines),
 * anything else scales down uniformly. Returns the size and the scale used.
 */
export function fit(size: Size, maxW: number, maxH: number): { w: number; h: number; scale: number } {
  if (size.w <= maxW && size.h <= maxH) return { w: size.w, h: size.h, scale: 1 };
  if (size.wraps) {
    const { font, chars, lineHeight, pad } = size.wraps;
    const perLine = Math.max(1, Math.floor((maxW - pad * 2) / (CHAR_W * font)));
    const lines = Math.ceil(chars / perLine);
    if (lines <= 3) {
      const h = Math.round(lines * font * lineHeight + pad);
      const w = Math.min(size.w, maxW);
      if (h <= maxH) return { w, h, scale: 1 };
      const s = maxH / h;
      return { w: Math.round(w * s), h: Math.round(h * s), scale: s };
    }
  }
  const s = Math.min(maxW / size.w, maxH / size.h);
  return { w: Math.round(size.w * s), h: Math.round(size.h * s), scale: s };
}
