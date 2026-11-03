import { describe, expect, it } from "vitest";
import { THEMES, WHITEBOARD } from "../src/theme.js";

const lum = (hex: string) => {
  const n = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

describe("looks on the whiteboard", () => {
  it("all draw on white", () => {
    for (const t of Object.values(THEMES)) expect(t.bg, t.name).toBe(WHITEBOARD);
  });

  it("keep text readable and colors visible on white", () => {
    for (const t of Object.values(THEMES)) {
      // Body text: WCAG AA for normal text. Colors: 3:1, the minimum for graphics and large text.
      expect(contrast(t.fg, t.bg), `${t.name}.fg`).toBeGreaterThanOrEqual(4.5);
      for (const k of ["muted", "accent", "warn", "good", "cool"] as const) expect(contrast(t[k], t.bg), `${t.name}.${k}`).toBeGreaterThanOrEqual(3);
      expect(contrast(t.ink, t.onInk), `${t.name} ink/onInk`).toBeGreaterThanOrEqual(3);
    }
  });
});
