/**
 * Themes are token sets. The DSL only ever names tokens (`color=accent`);
 * concrete colors, fonts and stroke widths live here.
 */
export interface Theme {
  name: string;
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  warn: string;
  good: string;
  /** Fill for shapes, cards and nodes. */
  surface: string;
  font: string;
  headingFont: string;
  stroke: number;
}

const HAND = `"Patrick Hand", "Segoe Print", "Comic Sans MS", cursive`;
const SANS = `Inter, "Segoe UI", system-ui, sans-serif`;

export const THEMES: Record<string, Theme> = {
  chalk: { name: "chalk", bg: "#1f3b2d", fg: "#f4f1e8", muted: "#a9b8ad", accent: "#ffd166", warn: "#ef6f6c", good: "#8fd694", surface: "rgba(255,255,255,0.06)", font: HAND, headingFont: HAND, stroke: 3 },
  paper: { name: "paper", bg: "#fbf8f1", fg: "#22223b", muted: "#8d8d9e", accent: "#e76f51", warn: "#d62828", good: "#2a9d8f", surface: "#ffffff", font: SANS, headingFont: SANS, stroke: 3 },
  dark: { name: "dark", bg: "#111318", fg: "#e9ecf2", muted: "#8a90a0", accent: "#5eb1ff", warn: "#ff6b6b", good: "#51cf66", surface: "#1c2029", font: SANS, headingFont: SANS, stroke: 3 },
  light: { name: "light", bg: "#ffffff", fg: "#1d1d1f", muted: "#86868b", accent: "#0071e3", warn: "#d70015", good: "#248a3d", surface: "#f5f5f7", font: SANS, headingFont: SANS, stroke: 3 },
};

export function getTheme(name: string): Theme {
  return THEMES[name] ?? THEMES.paper!;
}

/** Theme token → color; unknown tokens fall back to the accent. */
export function color(theme: Theme, token: string): string {
  const t = theme as unknown as Record<string, unknown>;
  return typeof t[token] === "string" && token !== "name" && token !== "font" && token !== "headingFont" ? (t[token] as string) : theme.accent;
}
