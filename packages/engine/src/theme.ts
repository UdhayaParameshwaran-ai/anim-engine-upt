/**
 * Looks are token sets. The DSL only ever names a look (`theme magazine`)
 * and color tokens (`color=accent`); concrete colors, fonts, shapes and
 * emphasis styles live here. Every look renders every script.
 */
export interface Theme {
  name: string;
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  warn: string;
  good: string;
  /** Cool secondary (water, air, calm). */
  cool: string;
  /** Fill for shapes, cards and nodes. */
  surface: string;
  /** Solid fills in data widgets (bars, markers, key rows), and the text drawn on them. */
  ink: string;
  onInk: string;
  font: string;
  headingFont: string;
  /** Numbers, labels and code. */
  mono: string;
  headingWeight: number;
  headingCase: "none" | "upper";
  /** Letter spacing of headings, in em. */
  headingTracking: number;
  /** Average glyph width of the body font as a fraction of its size; text fitting uses it. */
  charW: number;
  /** Size multiplier for faces that look small at a given size (handwriting). */
  fontScale: number;
  /** Face for big statistics (counters, gauges). */
  numbers: string;
  /** What data tints mix toward: the background, or the text color (better on saturated backgrounds). */
  toneBase: "bg" | "fg";
  /** How `highlight` looks: a colored glow, or a flat marker block behind the target. */
  emphasis: "glow" | "mark";
  markColor: string;
  /** Strongest marker opacity. */
  markOpacity: number;
  stroke: number;
  /** Corner radius of boxes, nodes and cards (px). */
  radius: number;
  /** Shadow under shapes: none, soft (blurred) or hard (offset, no blur). */
  shadow: "none" | "soft" | "hard";
  shadowColor: string;
  /** Font files the look needs (see fonts.ts). */
  faces: string[];
  /** Background generators used by `bg auto` (see background.ts), "+"-joined. */
  background: string;
}

const HAND = `"Patrick Hand", "Segoe Print", "Comic Sans MS", cursive`;
const SANS = `Inter, "Segoe UI", system-ui, sans-serif`;
const MONO = `"JetBrains Mono", "Cascadia Code", Consolas, monospace`;
const GROTESK = `"Space Grotesk", ${SANS}`;

type Spec = Pick<Theme, "name" | "bg" | "fg" | "muted" | "accent" | "warn" | "good" | "cool" | "surface"> & Partial<Theme>;

function look(s: Spec): Theme {
  return {
    ink: s.fg,
    onInk: s.bg,
    font: SANS,
    headingFont: SANS,
    mono: MONO,
    headingWeight: 700,
    headingCase: "none",
    headingTracking: 0,
    charW: 0.55,
    fontScale: 1,
    numbers: MONO,
    toneBase: "bg",
    emphasis: "glow",
    markColor: s.fg,
    markOpacity: 0.1,
    stroke: 3,
    radius: 14,
    shadow: "none",
    shadowColor: "rgba(0,0,0,0.25)",
    faces: ["inter-400", "inter-700", "jetbrains-mono-400"],
    background: "solid",
    ...s,
  };
}

export const THEMES: Record<string, Theme> = {
  chalk: look({ name: "chalk", bg: "#1f3b2d", fg: "#f4f1e8", muted: "#a9b8ad", accent: "#ffd166", warn: "#ef6f6c", good: "#8fd694", cool: "#7cc6fe", surface: "rgba(255,255,255,0.06)", font: HAND, headingFont: HAND, numbers: HAND, fontScale: 1.1, faces: ["patrick-hand-400", "jetbrains-mono-400"] }),
  paper: look({ name: "paper", bg: "#fbf8f1", fg: "#22223b", muted: "#8d8d9e", accent: "#e76f51", warn: "#d62828", good: "#2a9d8f", cool: "#3a86ff", surface: "#ffffff" }),
  dark: look({ name: "dark", bg: "#111318", fg: "#e9ecf2", muted: "#8a90a0", accent: "#5eb1ff", warn: "#ff6b6b", good: "#51cf66", cool: "#74c0fc", surface: "#1c2029" }),
  // Template Rule Book v2: black on white, hairlines, square corners. Tone and pattern, never hue.
  editorial: look({ name: "editorial", bg: "#ffffff", fg: "#000000", muted: "#555555", accent: "#000000", warn: "#000000", good: "#000000", cool: "#555555", surface: "#f2f2f2", stroke: 2, emphasis: "mark" }),
  light: look({ name: "light", bg: "#ffffff", fg: "#1d1d1f", muted: "#86868b", accent: "#0071e3", warn: "#d70015", good: "#248a3d", cool: "#0a84ff", surface: "#f5f5f7" }),

  "neo-brutal": look({
    name: "neo-brutal", bg: "#fff4d6", fg: "#111111", muted: "#5b5446", accent: "#ff5c00", warn: "#e63946", good: "#2a9d8f", cool: "#4361ee", surface: "#ffd84d",
    ink: "#ff5c00", onInk: "#111111",
    font: GROTESK, headingFont: `"Archivo Black", ${GROTESK}`, headingWeight: 400, headingCase: "upper", headingTracking: 0.01, charW: 0.58,
    emphasis: "mark", markColor: "#ff5c00", markOpacity: 0.55, stroke: 5, radius: 0, shadow: "hard", shadowColor: "#111111",
    numbers: `"Archivo Black", ${GROTESK}`, background: "dots",
    faces: ["space-grotesk-400", "space-grotesk-700", "archivo-black-400", "jetbrains-mono-400"],
  }),
  "soft-pastel": look({
    name: "soft-pastel", bg: "#f7f1ff", fg: "#3d3a4b", muted: "#8e88a3", accent: "#9b7bff", warn: "#ff7aa2", good: "#5cc8a8", cool: "#6cb6ff", surface: "#ffffff",
    ink: "#b9a6ff", onInk: "#2b2840",
    font: `Nunito, ${SANS}`, headingFont: `Nunito, ${SANS}`, headingWeight: 800, charW: 0.54,
    stroke: 2.5, radius: 28, shadow: "soft", shadowColor: "rgba(110,80,200,0.18)",
    numbers: `Nunito, ${SANS}`, background: "mesh",
    faces: ["nunito-400", "nunito-800", "jetbrains-mono-400"],
  }),
  "tech-neon": look({
    name: "tech-neon", bg: "#070b14", fg: "#e6f1ff", muted: "#7d8aa6", accent: "#00e5ff", warn: "#ff4d6d", good: "#39ff88", cool: "#7b61ff", surface: "#0f1726",
    ink: "#00e5ff", onInk: "#04121a",
    font: GROTESK, headingFont: GROTESK, headingCase: "upper", headingTracking: 0.06, charW: 0.58,
    stroke: 2, radius: 6, shadow: "soft", shadowColor: "rgba(0,229,255,0.35)", background: "aurora+grid",
    faces: ["space-grotesk-400", "space-grotesk-700", "jetbrains-mono-400", "jetbrains-mono-700"],
  }),
  magazine: look({
    name: "magazine", bg: "#f4eee3", fg: "#1b1a17", muted: "#6f685c", accent: "#b23a48", warn: "#b23a48", good: "#3d6b4f", cool: "#33658a", surface: "#fffaf0",
    ink: "#b23a48", onInk: "#fffaf0",
    headingFont: `"Playfair Display", Georgia, serif`,
    emphasis: "mark", markColor: "#b23a48", markOpacity: 0.22, stroke: 2, radius: 2,
    numbers: `"Playfair Display", Georgia, serif`, background: "grain",
    faces: ["inter-400", "inter-700", "playfair-display-700", "jetbrains-mono-400"],
  }),
  "bold-pop": look({
    name: "bold-pop", bg: "#2331ff", fg: "#ffffff", muted: "#c3c9ff", accent: "#ffd60a", warn: "#ff5d8f", good: "#5dffb0", cool: "#7df9ff", surface: "rgba(255,255,255,0.12)",
    ink: "#ffd60a", onInk: "#1a1a6e",
    font: `Poppins, ${SANS}`, headingFont: `Poppins, ${SANS}`, headingWeight: 800, charW: 0.6,
    stroke: 4, radius: 22, shadow: "hard", shadowColor: "rgba(10,10,80,0.55)",
    numbers: `Poppins, ${SANS}`, toneBase: "fg", background: "shapes",
    faces: ["poppins-400", "poppins-800", "jetbrains-mono-400"],
  }),
  crayon: look({
    name: "crayon", bg: "#fffdf4", fg: "#2b2b2b", muted: "#8a8478", accent: "#ff6b6b", warn: "#f03e3e", good: "#51cf66", cool: "#4dabf7", surface: "#fff3bf",
    ink: "#ffa94d", onInk: "#2b2b2b",
    font: `Caveat, ${HAND}`, headingFont: `Caveat, ${HAND}`, numbers: `Caveat, ${HAND}`, charW: 0.42, fontScale: 1.4, background: "notebook",
    emphasis: "mark", markColor: "#ffe066", markOpacity: 0.85, stroke: 4, radius: 24,
    faces: ["caveat-400", "caveat-700", "jetbrains-mono-400"],
  }),
  "midnight-luxe": look({
    name: "midnight-luxe", bg: "#0b1430", fg: "#f3ead7", muted: "#9aa3bd", accent: "#d4af37", warn: "#e07a5f", good: "#81b29a", cool: "#8ecae6", surface: "#121d40",
    ink: "#d4af37", onInk: "#0b1430",
    headingFont: `"DM Serif Display", Georgia, serif`, headingWeight: 400, headingTracking: 0.01,
    stroke: 1.5, radius: 4, shadow: "soft", shadowColor: "rgba(0,0,0,0.45)",
    numbers: `"DM Serif Display", Georgia, serif`, toneBase: "fg", background: "gradient+grain",
    faces: ["inter-400", "inter-700", "dm-serif-display-400", "jetbrains-mono-400"],
  }),
  blueprint: look({
    name: "blueprint", bg: "#123a73", fg: "#eaf2ff", muted: "#9fb8dd", accent: "#ffffff", warn: "#ffb4a2", good: "#b8f2e6", cool: "#a0c4ff", surface: "rgba(255,255,255,0.06)",
    ink: "#eaf2ff", onInk: "#123a73",
    font: `"Space Mono", ${MONO}`, headingFont: `"Space Mono", ${MONO}`, mono: `"Space Mono", ${MONO}`, headingCase: "upper", headingTracking: 0.04, charW: 0.62,
    stroke: 2, radius: 0, faces: ["space-mono-400", "space-mono-700"], background: "grid",
  }),
};

export function getTheme(name: string): Theme {
  return THEMES[name] ?? THEMES.paper!;
}

const TOKENS = new Set(["fg", "muted", "accent", "warn", "good", "cool", "surface", "ink"]);

/** Theme token → color; unknown tokens fall back to the accent. */
export function color(theme: Theme, token: string): string {
  return TOKENS.has(token) ? (theme[token as keyof Theme] as string) : theme.accent;
}

/** CSS filter for a look's shape shadow ("" when it has none). */
export function shadowFilter(theme: Theme): string {
  if (theme.shadow === "hard") return `drop-shadow(6px 6px 0 ${theme.shadowColor})`;
  if (theme.shadow === "soft") return `drop-shadow(0 10px 18px ${theme.shadowColor})`;
  return "";
}
