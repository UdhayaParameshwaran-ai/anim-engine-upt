/**
 * Looks are token sets. The DSL only ever names a look (`theme magazine`)
 * and color tokens (`color=accent`); concrete colors, fonts, shapes and
 * emphasis styles live here. Every look renders every script.
 *
 * For now every look draws on a plain white board (WHITEBOARD): looks differ
 * by ink colors, fonts, shapes and emphasis, never by background.
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
  /**
   * How icons are drawn: plain line art; on a tinted backing; on a surface
   * backing with a colored outline; white on a solid colored backing; or
   * (block) dark on a solid backing with a dark outline and a hard shadow.
   */
  iconStyle: "plain" | "tint" | "outline" | "solid" | "block";
  iconShape: "circle" | "square";
  /** Color tokens items of a template take in turn (item 1, 2, 3, ...). */
  palette: string[];
  /** Fill of the panels behind cards and the two sides of a comparison (a quiet color: panels are large). */
  panel: string;
}

/** The one background every look uses for now. */
export const WHITEBOARD = "#ffffff";

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
    iconStyle: "tint",
    iconShape: "circle",
    palette: ["accent", "good", "warn", "cool"],
    panel: s.surface,
    ...s,
  };
}

export const THEMES: Record<string, Theme> = {
  chalk: look({ name: "chalk", bg: WHITEBOARD, fg: "#1f2a24", muted: "#6b7a70", accent: "#d97706", warn: "#dc2626", good: "#16a34a", cool: "#2563eb", surface: "#f6f7f5", font: HAND, headingFont: HAND, numbers: HAND, fontScale: 1.1, faces: ["patrick-hand-400", "jetbrains-mono-400"], iconStyle: "plain" }),
  paper: look({ name: "paper", bg: WHITEBOARD, fg: "#22223b", muted: "#8d8d9e", accent: "#e76f51", warn: "#d62828", good: "#2a9d8f", cool: "#3a86ff", surface: "#fbf8f1" }),
  dark: look({ name: "dark", bg: WHITEBOARD, fg: "#111318", muted: "#6b7080", accent: "#1e6fd9", warn: "#e03131", good: "#2f9e44", cool: "#1c7ed6", surface: "#f3f4f7", iconShape: "square" }),
  // Template Rule Book v2: black on white, hairlines, square corners. Tone and pattern, never hue.
  editorial: look({ name: "editorial", bg: WHITEBOARD, fg: "#000000", muted: "#555555", accent: "#000000", warn: "#000000", good: "#000000", cool: "#555555", surface: "#f2f2f2", stroke: 2, emphasis: "mark", iconStyle: "plain", palette: ["fg"] }),
  light: look({ name: "light", bg: WHITEBOARD, fg: "#1d1d1f", muted: "#86868b", accent: "#0071e3", warn: "#d70015", good: "#248a3d", cool: "#0a84ff", surface: "#f5f5f7", iconShape: "square" }),

  "neo-brutal": look({
    name: "neo-brutal", bg: WHITEBOARD, fg: "#111111", muted: "#5b5446", accent: "#ff5c00", warn: "#e63946", good: "#2a9d8f", cool: "#4361ee", surface: "#ffd84d",
    ink: "#ff5c00", onInk: "#111111",
    font: GROTESK, headingFont: `"Archivo Black", ${GROTESK}`, headingWeight: 400, headingCase: "upper", headingTracking: 0.01, charW: 0.58,
    emphasis: "mark", markColor: "#ff5c00", markOpacity: 0.55, stroke: 5, radius: 0, shadow: "hard", shadowColor: "#111111",
    numbers: `"Archivo Black", ${GROTESK}`,
    iconStyle: "block", iconShape: "square", palette: ["surface", "accent", "cool", "good"], panel: "#fff8dc",
    faces: ["space-grotesk-400", "space-grotesk-700", "archivo-black-400", "jetbrains-mono-400"],
  }),
  "soft-pastel": look({
    name: "soft-pastel", bg: WHITEBOARD, fg: "#3d3a4b", muted: "#8e88a3", accent: "#8a63f5", warn: "#e0507f", good: "#25967a", cool: "#3a87d6", surface: "#f7f1ff",
    ink: "#b9a6ff", onInk: "#2b2840",
    font: `Nunito, ${SANS}`, headingFont: `Nunito, ${SANS}`, headingWeight: 800, charW: 0.54,
    stroke: 2.5, radius: 28, shadow: "soft", shadowColor: "rgba(110,80,200,0.18)",
    numbers: `Nunito, ${SANS}`,
    faces: ["nunito-400", "nunito-800", "jetbrains-mono-400"],
  }),
  "tech-neon": look({
    name: "tech-neon", bg: WHITEBOARD, fg: "#0b1220", muted: "#5b6782", accent: "#0891b2", warn: "#e11d48", good: "#059669", cool: "#6d28d9", surface: "#f1f5fb",
    ink: "#0891b2", onInk: "#ffffff",
    font: GROTESK, headingFont: GROTESK, headingCase: "upper", headingTracking: 0.06, charW: 0.58,
    stroke: 2, radius: 6, shadow: "soft", shadowColor: "rgba(8,145,178,0.28)", iconStyle: "outline", iconShape: "square",
    faces: ["space-grotesk-400", "space-grotesk-700", "jetbrains-mono-400", "jetbrains-mono-700"],
  }),
  magazine: look({
    name: "magazine", bg: WHITEBOARD, fg: "#1b1a17", muted: "#6f685c", accent: "#b23a48", warn: "#b23a48", good: "#3d6b4f", cool: "#33658a", surface: "#f8f3ea",
    ink: "#b23a48", onInk: "#fffaf0",
    headingFont: `"Playfair Display", Georgia, serif`,
    emphasis: "mark", markColor: "#b23a48", markOpacity: 0.22, stroke: 2, radius: 2, iconStyle: "plain", palette: ["accent", "cool", "good", "fg"],
    numbers: `"Playfair Display", Georgia, serif`,
    faces: ["inter-400", "inter-700", "playfair-display-700", "jetbrains-mono-400"],
  }),
  "bold-pop": look({
    name: "bold-pop", bg: WHITEBOARD, fg: "#14148a", muted: "#6a6fb0", accent: "#2331ff", warn: "#e8336d", good: "#12a150", cool: "#0284c7", surface: "#eef0ff",
    ink: "#2331ff", onInk: "#ffffff",
    font: `Poppins, ${SANS}`, headingFont: `Poppins, ${SANS}`, headingWeight: 800, charW: 0.6,
    stroke: 4, radius: 22, shadow: "hard", shadowColor: "rgba(35,49,255,0.35)", iconStyle: "solid",
    numbers: `Poppins, ${SANS}`,
    faces: ["poppins-400", "poppins-800", "jetbrains-mono-400"],
  }),
  crayon: look({
    name: "crayon", bg: WHITEBOARD, fg: "#2b2b2b", muted: "#8a8478", accent: "#e8590c", warn: "#e03131", good: "#2f9e44", cool: "#1c7ed6", surface: "#fff3bf",
    ink: "#ffa94d", onInk: "#2b2b2b",
    font: `Caveat, ${HAND}`, headingFont: `Caveat, ${HAND}`, numbers: `Caveat, ${HAND}`, charW: 0.42, fontScale: 1.4,
    emphasis: "mark", markColor: "#ffe066", markOpacity: 0.85, stroke: 4, radius: 24, iconStyle: "plain",
    faces: ["caveat-400", "caveat-700", "jetbrains-mono-400"],
  }),
  "midnight-luxe": look({
    name: "midnight-luxe", bg: WHITEBOARD, fg: "#0b1430", muted: "#6a7390", accent: "#a88419", warn: "#c2553b", good: "#4f8a6e", cool: "#3b7ea1", surface: "#f7f4ec",
    ink: "#a88419", onInk: "#ffffff",
    headingFont: `"DM Serif Display", Georgia, serif`, headingWeight: 400, headingTracking: 0.01,
    stroke: 1.5, radius: 4, shadow: "soft", shadowColor: "rgba(11,20,48,0.18)", iconStyle: "outline", palette: ["accent", "cool", "good", "warn"],
    numbers: `"DM Serif Display", Georgia, serif`,
    faces: ["inter-400", "inter-700", "dm-serif-display-400", "jetbrains-mono-400"],
  }),
  blueprint: look({
    name: "blueprint", bg: WHITEBOARD, fg: "#123a73", muted: "#6b86ad", accent: "#1d5fbf", warn: "#c2410c", good: "#0f766e", cool: "#2b6cb0", surface: "#f2f6fc",
    ink: "#123a73", onInk: "#ffffff",
    font: `"Space Mono", ${MONO}`, headingFont: `"Space Mono", ${MONO}`, mono: `"Space Mono", ${MONO}`, headingCase: "upper", headingTracking: 0.04, charW: 0.62,
    stroke: 2, radius: 0, iconStyle: "outline", iconShape: "square", palette: ["fg", "accent", "warn", "good"], faces: ["space-mono-400", "space-mono-700"],
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

/** The color of a template item, by its index (items take the look's palette in turn). */
export function itemColor(theme: Theme, index: number): string {
  const n = theme.palette.length;
  return color(theme, theme.palette[((Math.trunc(index) % n) + n) % n]!);
}

/** CSS filter for a look's shape shadow ("" when it has none). */
export function shadowFilter(theme: Theme): string {
  if (theme.shadow === "hard") return `drop-shadow(6px 6px 0 ${theme.shadowColor})`;
  if (theme.shadow === "soft") return `drop-shadow(0 10px 18px ${theme.shadowColor})`;
  return "";
}
