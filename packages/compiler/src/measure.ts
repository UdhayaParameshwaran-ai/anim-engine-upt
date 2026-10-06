import type { ElementDecl } from "@anim/dsl";
import type { AssetLibrary } from "@anim/registry";

export interface Size {
  w: number;
  h: number;
  /** Text can wrap to a narrower width instead of scaling down. */
  wraps?: { font: number; chars: number; lineHeight: number; pad: number };
}

/** Average glyph width as a fraction of font size. Real measurement happens in the browser later. */
const CHAR_W = 0.55;

const FONT: Record<string, number> = { title: 80, text: 44, label: 34, node: 32, list: 40 };

/**
 * Natural size of an element at 1920×1080, from its kind and text. This is
 * a deterministic estimate so layout is reproducible without a browser; the
 * engine re-checks real text metrics at render time (diagnostic NAR6xx).
 */
export function measure(el: ElementDecl, assets: AssetLibrary): Size {
  const text = el.texts[0] ?? "";
  const labelH = el.texts.length && (el.kind === "icon" || el.kind === "asset") ? 56 : 0;
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
      return { w: Math.max(300, Math.round(text.length * CHAR_W * 36 + 60)), h: 150 };
    case "circle":
      return { w: 200, h: 200 };
    case "chart":
      return { w: 760, h: 440 };
    case "icon":
      return { w: 200, h: 200 + labelH };
    case "asset": {
      const aspect = (el.name && assets.resolve("asset", el.name)?.manifest.aspect) || 1;
      return { w: 440, h: Math.round(440 / aspect) + labelH };
    }
    case "placeholder":
      return { w: 280, h: 180 };
    default:
      return { w: 240, h: 160 };
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
