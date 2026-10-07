import type { VariantLayout } from "./api.js";

/**
 * steps:arch — steps rising along an arch that peaks in the middle.
 * Items keep their order left to right; each sits higher the closer it is
 * to the middle (a half sine), like stones of an arch.
 */
export const stepsArch: VariantLayout = (c) => {
  const n = c.items.length;
  const cells = c.rowCells(c.area, n, n > 1 && c.emphasis >= 0 ? c.items.map((_, i) => (i === c.emphasis ? 1.6 : 1)) : undefined);
  const h = c.area.h * 0.5;
  c.items.forEach((e, i) => {
    const lift = Math.sin((Math.PI * (i + 0.5)) / n); // 1 in the middle, smaller toward the ends
    c.put(e, { ...cells[i]!, y: c.area.y + (c.area.h - h) * (1 - lift), h });
  });
};
